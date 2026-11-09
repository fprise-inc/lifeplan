// Excel のヒアリングシートの取り込みでも、今の世帯の欄が消えない（0139 の追記 2026-11-09）。取り込みの候補と承認は Web と同じ処理
// （sheet.ts の viewOfResult・applyImport）を通るので、Web の通しの点検（hearing-roundtrip.test.ts）と同じことを Excel でも確かめる
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyImport, approvalTime, defaultSelection, exportSheet, importSheet, sheetFor, withRequest } from "../src/workspace/hearing/sheet.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const OFFICE = { name: "【架空】みらいFP事務所", purpose: "ライフプランの作成のため", privacyContact: "【架空】個人情報の窓口" };
/** 簡易版（basic 版2）の見本 */
const SIMPLE = new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "basic-2-sample.xlsx")));
const AT = approvalTime(new Date(2026, 10, 9, 10, 0, 0));

let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
/** 値の入った世帯（夫婦と子2人・持ち家と住宅ローン・塾・NISA の資産の配分・住まいの評価と持ち分） */
const filled = (): WorkingHousehold => fromRequest(modelHousehold("salariedCoupleTwoKids"));

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** 値のある末端の欄の道（世帯の行は ID で、行の中の並びは番号で） */
function leaves(x: unknown, path: string, out: Set<string>): void {
  if (x === null || x === undefined) return;
  if (Array.isArray(x)) return x.forEach((e, i) => leaves(e, `${path}/${isObj(e) && typeof e.id === "string" && path.split("/").length === 2 ? e.id : String(i)}`, out));
  if (isObj(x)) return Object.entries(x).forEach(([key, v]) => leaves(v, `${path}/${key}`, out));
  out.add(path);
}

/** 今の世帯にあって、取り込みの後に無くなった欄（行が残っている所だけ。hearing-roundtrip.test.ts の lostFields と同じ） */
function lostFields(before: WorkingHousehold, after: WorkingHousehold): string[] {
  const a = new Set<string>();
  const b = new Set<string>();
  leaves(before.request.input.household, "", a);
  leaves(after.request.input.household, "", b);
  return [...a].filter((p) => !b.has(p) && b.has(p.split("/").slice(0, 3).join("/") + "/id")).sort();
}

describe("Excel: 値の入った世帯に取り込んでも、シートで聞かない欄は消えない", () => {
  it("見直し（前回の値つき）で書き出したシートを、そのまま同じ世帯に取り込むと、既定でチェックの付く候補が無い。全部にチェックを入れて承認しても欄は消えない", async () => {
    const wh = filled();
    const sheet = await exportSheet(wh, { definition: sheetFor("review"), prefill: true, customerNo: "A0001", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-11-09", random: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    const src = withRequest(wh, sheet.request);
    const r = await importSheet(sheet.bytes, src, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const sel = defaultSelection(r.view);
    expect(r.view.candidates.filter((c) => sel.has(c.id)).map((c) => `${c.kind}: ${c.title}`)).toEqual([]);
    expect(lostFields(src, applyImport(src, r.view, sel, AT).wh)).toEqual([]);
    const all = applyImport(src, r.view, new Set(r.view.candidates.map((c) => c.id)), AT).wh;
    expect(lostFields(src, all)).toEqual([]);
    // 住まいの入居のイベントへのつながり・評価・持ち分・固定資産税と管理費の上がり方は今のまま（選んだ候補の額には承認の記録が付く）
    const keep = (h: WorkingHousehold) => (h.request.input.household.residences ?? []).map((x) => { const o = x as unknown as Obj; return [o.from, o.valuation, o.ownership, (o.propertyTax as Obj | undefined)?.growth, (o.maintenance as Obj | undefined)?.growth]; });
    expect(keep(all)).toEqual(keep(src));
  });

  it("簡易版の見本を取り込むと、既定のままでも全部にチェックを入れても欄は消えない。全部入れると給与は届いた値（範囲）になり、標準報酬月額・企業年金・失業給付は今の値のまま", async () => {
    const wh = filled();
    const r = await importSheet(SIMPLE, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(lostFields(wh, applyImport(wh, r.view, defaultSelection(r.view), AT).wh)).toEqual([]);
    const after = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT).wh;
    expect(lostFields(wh, after)).toEqual([]);
    const self = wh.request.input.household.members.find((m) => m.kind === "self")?.id;
    const work = (h: WorkingHousehold) => (h.request.input.household.employmentPeriods ?? []).find((p) => p.member === self) as unknown as Obj;
    expect((work(after).salary as Obj).annual).not.toEqual((work(wh).salary as Obj).annual);
    for (const key of ["standardMonthlyRemuneration", "corporatePension", "unemploymentClaim"]) expect(work(after)[key]).toEqual(work(wh)[key]);
  });
});

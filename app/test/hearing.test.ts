// ヒアリングシートを入力のホームにつなぐ部分（workspace/hearing/sheet.ts）: 書き出し → 取り込み → 承認で現状に入る
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyImport, approvalTime, defaultSelection, defaultSheet, exportSheet, importSheet, logOf, withRequest } from "../src/workspace/hearing/sheet.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const OFFICE = { name: "【架空】みらいFP事務所", purpose: "ライフプランの作成のため", privacyContact: "【架空】個人情報の窓口" };
const SAMPLE = new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "basic-1-sample.xlsx")));
const AT = approvalTime(new Date(2026, 9, 18, 10, 0, 0));

let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const blank = (): WorkingHousehold => withRefreshedEstimates(blankHousehold("2026-10", seq));
const exportOf = (wh: WorkingHousehold, prefill: boolean) =>
  exportSheet(wh, { definition: defaultSheet(), prefill, customerNo: "A0001", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-18", random: new Uint8Array([1, 2, 3, 4, 5, 6]) });

/** 承認の記録の無い「ヒアリング」の値の箱を数える（承認すると0になる） */
function unapproved(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((s: number, x) => s + unapproved(x), 0);
  if (v === null || typeof v !== "object") return 0;
  const o = v as Record<string, unknown>;
  const self = typeof o.state === "string" && (o.origin as { kind?: string } | undefined)?.kind === "hearing" && o.approval === undefined ? 1 : 0;
  return self + Object.values(o).reduce((s: number, x) => s + unapproved(x), 0);
}

describe("見本の記入済みシートを空の世帯に取り込む", () => {
  it("候補は新規（家族・仕事・住まい …）と変更（本人の仮の生年月・生活費の目安）に分かれる", async () => {
    const wh = blank();
    const r = await importSheet(SAMPLE, wh, seq);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.view;
    const self = v.candidates.find((c) => c.group === "家族" && c.kind === "changed");
    expect(self?.title).toBe("ご主人");
    expect(v.candidates.filter((c) => c.group === "家族" && c.kind === "new")).toHaveLength(4);
    expect(v.candidates.find((c) => c.group === "生活費")?.kind).toBe("changed");
    expect(v.candidates.filter((c) => c.kind === "new").length).toBeGreaterThan(10);
    // 推定・仮の印（入力の画面と同じ）
    const marks = v.candidates.flatMap((c) => c.fields.map((f) => f.mark));
    expect(marks).toContain("assumed");
    expect(marks).toContain("estimated");
    expect(v.checklist.some((c) => c.reason === "unknown")).toBe(true);
    // 返ってきたシートの依頼が手元の記録に無いことを知らせる（公式のシートなので同梱の定義で読む）
    expect(v.issues.some((i) => i.code === "H_REQUEST_UNKNOWN")).toBe(true);
    expect(v.memo.length).toBeGreaterThan(0);
  });

  it("承認すると現状に入る: 承認の記録が付き、計算でき、入力のホームのカードが変わる", async () => {
    const wh = blank();
    const before = inputItems(wh);
    const r = await importSheet(SAMPLE, wh, seq);
    if (!r.ok) throw new Error("取り込めない");
    const sel = defaultSelection(r.view);
    const out = applyImport(wh, r.view, sel, AT);
    expect(out.skipped).toEqual([]);
    expect(out.added).toBeGreaterThan(10);
    expect(out.replaced).toBe(2);
    const h = out.wh.request.input.household;
    expect(h.members).toHaveLength(5);
    expect(h.members.find((m) => m.kind === "self")?.id).toBe(wh.request.input.household.members[0]?.id);
    expect(h.members.find((m) => m.kind === "self")?.birth.birthYearMonth).toBe("1986-05");
    // 承認の記録（0008 の2・5）
    expect(unapproved(out.wh.request)).toBe(0);
    expect(JSON.stringify(out.wh.request)).toContain(`"approval":{"by":"fp","at":"${AT}"`);
    // 本人の仮の生年月・性別の印は外れ、取り込んだ物の印が入る
    expect(Object.keys(out.wh.assumed).some((k) => k.endsWith("/birth"))).toBe(false);
    expect(Object.values(out.wh.assumed)).toContain("仮の値（出産予定）");
    // 取り込みの記録と同意の下書き
    expect(logOf(out.wh).imports).toHaveLength(1);
    expect(logOf(out.wh).consents.map((c) => `${c.kind}:${c.decision}`)).toEqual(["purpose:given", "familyInfo:given", "externalAi:refused"]);
    expect(out.wh.memo.some((m) => m.startsWith("ヒアリング（R-"))).toBe(true);
    // 計算エンジンが受け付ける（出どころ「ヒアリング」の値は承認の記録が要る）
    const res = preview(withRefreshedEstimates(out.wh).request);
    expect(res.table.length).toBeGreaterThan(0);
    // 入力のホームのカード: 未入力が減り、仕事・住まい・保険などが入る
    const after = inputItems(withRefreshedEstimates(out.wh));
    const none = (xs: typeof before) => xs.filter((i) => i.status === "missing").map((i) => i.id);
    expect(none(after).length).toBeLessThan(none(before).length);
    for (const id of ["work", "insurance"]) {
      expect(before.find((i) => i.id === id)?.status, id).toBe("missing");
      expect(after.find((i) => i.id === id)?.status, id).not.toBe("missing");
    }
    // 住まい: 住まいとローンが入る。シートに無い持ち家の評価額だけが未入力の警告で残る（0052）
    expect(before.find((i) => i.id === "housing")?.status).toBe("missing");
    const housingMissing = allFields(buildStage("housing", withRefreshedEstimates(out.wh))).filter((f) => fieldStatus(f, withRefreshedEstimates(out.wh)).status === "missing").map((f) => f.key.split("/").slice(-2).join("/"));
    expect(housingMissing).toEqual(["valuation/value"]);
  });

  it("承認しなかった家族を指す物は入れない", async () => {
    const wh = blank();
    const r = await importSheet(SAMPLE, wh, seq);
    if (!r.ok) throw new Error("取り込めない");
    const spouse = r.view.candidates.find((c) => c.title === "奥様");
    const sel = defaultSelection(r.view);
    sel.delete(spouse?.id ?? "");
    const out = applyImport(wh, r.view, sel, AT);
    expect(out.wh.request.input.household.members.some((m) => m.kind === "spouse")).toBe(false);
    expect(out.skipped.length).toBeGreaterThan(0);
    expect(out.skipped.every((t) => t.startsWith("奥様"))).toBe(true);
  });
});

describe("書き出しから取り込みまでの往復（画面の中の流れ）", () => {
  it("前回の値入りで書き出したシートを、空の世帯に取り込んで承認すると、元の世帯の値に戻る", async () => {
    const src = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const sheet = await exportOf(src, true);
    expect(sheet.issues.some((i) => i.code === "H_EXPORT_PREFILL")).toBe(true);
    expect(sheet.request.prefilled).toBe(true);
    const wh = withRequest(blank(), sheet.request);
    const r = await importSheet(sheet.bytes, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    // 手元の依頼の記録で読む（知らない依頼の知らせは出ない）
    expect(r.view.issues.some((i) => i.code === "H_REQUEST_UNKNOWN")).toBe(false);
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT);
    const a = src.request.input.household;
    const b = out.wh.request.input.household;
    const births = (h: typeof a) => h.members.map((m) => `${m.kind}:${m.birth.birthYearMonth}:${m.sex}`).sort();
    expect(births(b)).toEqual(births(a));
    const salary = (h: typeof a, kind: string) => {
      const m = h.members.find((x) => x.kind === kind);
      return (h.employmentPeriods ?? []).filter((p) => p.member === m?.id).map((p) => p.salary?.annual.value ?? null)[0];
    };
    expect(salary(b, "self")).toBe(salary(a, "self"));
    expect(salary(b, "spouse")).toBe(salary(a, "spouse"));
    expect(preview(withRefreshedEstimates(out.wh).request).table.length).toBeGreaterThan(0);
  });

  it("同じ世帯に取り込み直すと、家族は「新規」にならない（今の物と対応づける）", async () => {
    const src = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const sheet = await exportOf(src, true);
    const r = await importSheet(sheet.bytes, withRequest(src, sheet.request), seq);
    if (!r.ok) throw new Error("取り込めない");
    const family = r.view.candidates.filter((c) => c.group === "家族");
    expect(family.length).toBe(src.request.input.household.members.length);
    expect(family.every((c) => c.kind !== "new")).toBe(true);
    expect(family.filter((c) => c.kind === "same").length).toBeGreaterThan(0);
  });

  it("住宅ローンは仮の住宅ローン控除の条件と入居のイベントつきで入り、取り込み直しても「同じ」になる", async () => {
    // 2024年4月に借りた住宅ローン（控除の条件なし）の世帯から、前回の値入りで書き出す
    const req = modelHousehold("salariedCoupleTwoKids");
    for (const d of req.input.household.debts ?? []) {
      if (d.kind !== "mortgage") continue;
      d.start = { at: "2024-04" };
      d.rateSchedule = [{ ...d.rateSchedule[0]!, from: { at: "2024-04" } }];
      delete d.housing;
      delete d.balance;
      delete d.balanceAsOf;
    }
    const sheet = await exportOf(fromRequest(req), true);
    const wh = withRequest(blank(), sheet.request);
    const r = await importSheet(sheet.bytes, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT);
    const h = out.wh.request.input.household;
    const d = (h.debts ?? []).find((x) => x.kind === "mortgage");
    expect(d?.housing?.moveIn).toBeDefined();
    expect(h.events?.find((e) => e.id === d?.housing?.moveIn)).toMatchObject({ kind: "moveIn", at: { at: "2024-04" } });
    expect(out.wh.assumed[`housing/debt/${d?.id}/credit`]).toContain("仮の条件");
    expect(preview(withRefreshedEstimates(out.wh).request).table.length).toBeGreaterThan(0);
    // 同じシートを取り込み直すと、住宅ローンは「同じ」（入居のイベントの ID は比べない）で、入居のイベントは増えない
    const again = await importSheet(sheet.bytes, out.wh, seq);
    if (!again.ok) throw new Error("取り込めない");
    expect(again.view.candidates.find((c) => c.group === "住宅ローン")?.kind).toBe("same");
    const out2 = applyImport(out.wh, again.view, new Set(again.view.candidates.map((c) => c.id)), AT);
    expect(out2.wh.request.input.household.events?.filter((e) => e.kind === "moveIn")).toHaveLength(1);
  });

  it("空欄のシート（前回の値なし）は値を載せず、名前の欄も無い", async () => {
    const src = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const sheet = await exportOf(src, false);
    expect(sheet.request.prefilled).toBe(false);
    expect(sheet.issues.some((i) => i.code === "H_EXPORT_PREFILL")).toBe(false);
    const r = await importSheet(sheet.bytes, withRequest(blank(), sheet.request), seq);
    if (!r.ok) throw new Error("取り込めない");
    expect(r.view.candidates.filter((c) => c.group === "仕事と収入")).toEqual([]);
  });

  it("顧客番号は英数字だけ（氏名を入れない）", async () => {
    await expect(exportSheet(blank(), { definition: defaultSheet(), prefill: false, customerNo: "山田", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-18", random: new Uint8Array(6) })).rejects.toThrow("E_HEARING_CUSTOMER_NO");
  });

  it("壊れたファイル・.xlsx 以外は、分かる言葉で止まり、現状は変わらない", async () => {
    const wh = blank();
    const r = await importSheet(new TextEncoder().encode("hello"), wh);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.code === "H_FILE_NOT_XLSX")).toBe(true);
  });
});

describe("承認の日時", () => {
  it("時差つき・秒まで（計算エンジンの approval.at の形。ミリ秒は付けない）", () => {
    expect(approvalTime(new Date(2026, 9, 18, 10, 5, 7))).toMatch(/^2026-10-18T10:05:07[+-]\d{2}:\d{2}$/);
    expect(approvalTime()).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})$/);
  });
});

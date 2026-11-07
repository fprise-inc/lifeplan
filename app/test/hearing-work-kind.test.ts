// ヒアリングシートの取り込みで、働き方の種類が今の期間と違うとき（0139 の追記 2026-11-07）
// - 今（計算基準月）にかかっている期間と、種類が違っても同じ期間として対応づける（今の期間を残したまま新しい期間を足さない。給与が二重にならない）
// - 承認の入れ方は2通り: 今の期間を答えの始めた年月の前の月で終えて足す（既定）・今の期間を置きかえる
// - 定年の答えは推定で上書きしない。定年の「わからない」「該当なし」は、取り込み直しで推定の終わりと「同じ」
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EmploymentPeriod } from "../src/engine/types.ts";
import { applyImport, approvalTime, defaultSelection, defaultWorkModes, importSheet, workChangeTexts, type ImportView, type WorkChangeMode } from "../src/workspace/hearing/sheet.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { withWorkEndEstimates } from "../src/workspace/input/stages/work.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const SAMPLES = join(REPO_DIR, "hearing", "samples");
const sample = (f: string) => new Uint8Array(readFileSync(join(SAMPLES, f)));
const AT = approvalTime(new Date(2026, 9, 18, 10, 0, 0));
let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const model = () => fromRequest(modelHousehold("dualHighTwoKids"));
const memberOf = (wh: WorkingHousehold, kind: "self" | "spouse") => wh.request.input.household.members.find((m) => m.kind === kind)?.id ?? "";
const periods = (wh: WorkingHousehold, member: string): EmploymentPeriod[] => (wh.request.input.household.employmentPeriods ?? []).filter((p) => p.member === member);
const span = (p: EmploymentPeriod) => `${p.type} ${p.from.at ?? "?"}〜${p.to?.at ?? "終わり無し"}`;

async function viewOf(wh: WorkingHousehold, bytes: Uint8Array): Promise<ImportView> {
  const r = await importSheet(bytes, wh, seq);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.view;
}

async function importOnce(wh: WorkingHousehold, bytes: Uint8Array, mode?: WorkChangeMode): Promise<{ view: ImportView; wh: WorkingHousehold }> {
  const view = await viewOf(wh, bytes);
  const modes = defaultWorkModes(view);
  if (mode !== undefined) for (const k of modes.keys()) modes.set(k, mode);
  return { view, wh: applyImport(wh, view, defaultSelection(view), AT, modes).wh };
}

type Row = { row: string; year: number; amount: number; member?: string };
/** その年のその人の給与の行（cf.income.salary・cf.income.salary.executive …） */
const salaryRows = (wh: WorkingHousehold, member: string, year: number) => (preview(forEngine(wh.request)).table as Row[]).filter((r) => r.year === year && r.member === member && r.row.startsWith("cf.income.salary") && r.amount !== 0);

/** 同じ人の働き方の期間が、同じ月に2つ続いていない */
function overlaps(wh: WorkingHousehold, member: string): string[] {
  const ps = periods(wh, member).map((p) => ({ s: span(p), from: p.from.at ?? "0000-00", to: p.to?.at ?? "9999-12" }));
  const out: string[] = [];
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if ((ps[i]?.from ?? "") <= (ps[j]?.to ?? "") && (ps[j]?.from ?? "") <= (ps[i]?.to ?? "")) out.push(`${ps[i]?.s ?? ""} と ${ps[j]?.s ?? ""}`);
  return out;
}

describe("働き方の種類が今の期間と違うシートの取り込み（値の入った世帯）", () => {
  it("今の期間と対応づけ、「働き方 今 → 届いた値」を1つの変更として出す（既定は終えて足す）", async () => {
    const wh = model();
    const view = await viewOf(wh, sample("full-2-sample.xlsx"));
    const work = view.candidates.filter((c) => c.group === "仕事と収入");
    expect(work.map((c) => [c.title, c.kind])).toEqual([
      ["ご本人の仕事と収入", "changed"],
      ["配偶者の仕事と収入", "changed"],
    ]);
    const self = work[0];
    expect(self?.work).toMatchObject({ current: "会社員（正社員）", next: "会社役員", currentFrom: "2004-04", nextFrom: "2009-04", splitEnd: "2009-03", mode: "split", endEstimated: false, following: null });
    const diffs = self?.fields.flatMap((f) => f.diffs.map((d) => `${d.label} 今 ${d.current} → 届いた値 ${d.next}`)) ?? [];
    expect(diffs).toContain("働き方 今 会社員（正社員） → 届いた値 会社役員");
    expect(defaultSelection(view).has(self?.id ?? "")).toBe(true);
    const t = workChangeTexts(self!.work!);
    expect(t.head).toBe("働き方が変わりました: 今 会社員（正社員） → 届いた値 会社役員");
    expect(t.split).toBe("今の期間（会社員（正社員）・2004年4月〜）を2009年3月で終えて、会社役員の期間を2009年4月から足す（転職・独立・役員になったとき）");
  });

  it("既定（終えて足す）で承認すると、今の期間は始めた年月の前の月で終わり、給与は1本。定年の答え（65歳）は推定で上書きしない", async () => {
    const wh = model();
    const self = memberOf(wh, "self");
    const spouse = memberOf(wh, "spouse");
    expect(salaryRows(wh, self, 2027)).toHaveLength(1);
    const { wh: out } = await importOnce(wh, sample("full-2-sample.xlsx"));
    // 計算の結果: その年の給与の行が1本（前は 909万円と 585.8万円の2本）
    expect(salaryRows(out, self, 2027).map((r) => r.row)).toEqual(["cf.income.salary.executive"]);
    expect(salaryRows(out, spouse, 2027)).toHaveLength(1);
    expect(periods(out, self).map(span)).toEqual(["regular 2004-04〜2009-03", "executive 2009-04〜2051-04"]);
    expect(periods(out, spouse).map(span)).toEqual(["regular 2006-04〜2022-09", "partTime 2022-10〜2053-08"]);
    expect(overlaps(out, self)).toEqual([]);
    expect(overlaps(out, spouse)).toEqual([]);
    // 定年の答えのある人には、働く最後の年齢の推定の印を付けない
    expect(Object.keys(out.assumed).filter((k) => k.startsWith(`work/${self}/`))).toEqual([]);
  });

  it("置きかえるを選ぶと、今の期間（同じ ID）が届いた働き方になり、給与は1本", async () => {
    const wh = model();
    const self = memberOf(wh, "self");
    const before = periods(wh, self)[0]?.id;
    const { wh: out } = await importOnce(wh, sample("full-2-sample.xlsx"), "replace");
    expect(salaryRows(out, self, 2027).map((r) => r.row)).toEqual(["cf.income.salary.executive"]);
    expect(periods(out, self).map((p) => [p.id, span(p)])).toEqual([[before, "executive 2009-04〜2051-04"]]);
    expect(salaryRows(out, memberOf(wh, "spouse"), 2027)).toHaveLength(1);
  });

  for (const mode of ["split", "replace"] as const)
    it(`同じシートを取り込み直すと、仕事と収入はすべて「同じ」で中身も変わらない（${mode}）`, async () => {
      for (const f of ["full-2-sample.xlsx", "full-4-sample.xlsx"]) {
        const a = await importOnce(model(), sample(f), mode);
        const view = await viewOf(a.wh, sample(f));
        expect(view.candidates.filter((c) => c.group === "仕事と収入").map((c) => `${c.title} ${c.kind}`), f).toEqual(["ご本人の仕事と収入 same", "配偶者の仕事と収入 same"]);
        const b = applyImport(a.wh, view, defaultSelection(view), AT, defaultWorkModes(view)).wh;
        expect(b.request.input.household.employmentPeriods, f).toEqual(a.wh.request.input.household.employmentPeriods);
      }
    });

  it("取り込みは今の世帯を書き換えない（元に戻すと取り込む前に戻る）", async () => {
    const wh = model();
    const before = structuredClone(wh);
    const { wh: out } = await importOnce(wh, sample("full-4-sample.xlsx"));
    expect(out.request).not.toEqual(before.request);
    expect(wh).toEqual(before);
  });

  it("今の終わりが働く最後の年齢の推定（定年と推定の再雇用）なら、推定の定年後の期間を外し、届いた働き方で推定し直す", async () => {
    const wh = withWorkEndEstimates(model());
    const self = memberOf(wh, "self");
    const spouse = memberOf(wh, "spouse");
    // 推定で、正社員の定年（60歳）と推定の再雇用の期間が入っている
    expect(periods(wh, spouse).length).toBe(2);
    const view = await viewOf(wh, sample("full-4-sample.xlsx"));
    const sp = view.candidates.find((c) => c.title === "配偶者の仕事と収入");
    expect(sp?.work).toMatchObject({ current: "会社員（正社員）", next: "自営業・フリーランス", endEstimated: true, following: null });
    const out = applyImport(wh, view, defaultSelection(view), AT, defaultWorkModes(view)).wh;
    expect(periods(out, spouse).map(span)).toEqual(["regular 2006-04〜2020-03", "selfEmployed 2020-04〜2058-08"]);
    expect(periods(out, self).map(span)).toEqual(["regular 2004-04〜2009-03", "executive 2009-04〜2051-04"]);
    expect(out.postRetirement[spouse]).toBeUndefined();
    expect(out.postRetirement[self]).toBeUndefined();
    // 自営業の働く最後の年齢の推定の印だけ（推定の定年・再雇用の印は外す）。答えた定年の人には印が無い
    expect(Object.keys(out.assumed).filter((k) => k.startsWith("work/") && !k.startsWith("work/period/"))).toEqual([`work/${spouse}/retireAge`]);
    expect(salaryRows(out, self, 2027)).toHaveLength(1);
    for (const y of [2030, 2046, 2050]) expect(salaryRows(out, self, y).length, String(y)).toBeLessThanOrEqual(1);
    expect(salaryRows(out, spouse, 2027)).toHaveLength(0);
    // 取り込み直しで「同じ」
    const again = await viewOf(out, sample("full-4-sample.xlsx"));
    expect(again.candidates.filter((c) => c.group === "仕事と収入").map((c) => c.kind)).toEqual(["same", "same"]);
  });

  it("今の世帯にこの後の働き方の期間（FP が入れた予定）があれば残し、終わりの無い届いた働き方はその前の月で終える", async () => {
    const wh = model();
    const spouse = memberOf(wh, "spouse");
    const h = wh.request.input.household;
    const cur = (h.employmentPeriods ?? []).find((p) => p.member === spouse) as EmploymentPeriod;
    cur.to = { at: "2048-03" };
    h.employmentPeriods?.push({ ...structuredClone(cur), id: "11111111-1111-4111-8111-111111111111", type: "contract", from: { at: "2048-04" }, to: { at: "2053-03" } });
    const view = await viewOf(wh, sample("full-2-sample.xlsx"));
    const sp = view.candidates.find((c) => c.title === "配偶者の仕事と収入");
    expect(sp?.work?.following).toBe("契約社員・派遣・嘱託（2048年4月〜）");
    const out = applyImport(wh, view, defaultSelection(view), AT, defaultWorkModes(view)).wh;
    expect(periods(out, spouse).map(span)).toEqual(["regular 2006-04〜2022-09", "contract 2048-04〜2053-03", "partTime 2022-10〜2048-03"]);
    expect(overlaps(out, spouse)).toEqual([]);
    const replaced = applyImport(wh, view, defaultSelection(view), AT, new Map([[sp?.id ?? "", "replace"]])).wh;
    expect(periods(replaced, spouse).map(span)).toEqual(["partTime 2022-10〜2048-03", "contract 2048-04〜2053-03"]);
  });

  it("始めた年月の答えが無い・今の期間の始まりより前なら、置きかえるだけ（終えて足すは選べない）", () => {
    const t = workChangeTexts({ current: "会社員（正社員）", next: "自営業・フリーランス", currentFrom: "2010-04", nextFrom: null, splitEnd: null, mode: "replace", endEstimated: false, following: null });
    expect(t.split).toBeNull();
    expect(t.notes[0]).toContain("今の期間を自営業・フリーランスに置きかえます");
  });
});

describe("定年の「わからない」「該当なし」と推定の終わり（取り込み直し）", () => {
  const blank = (): WorkingHousehold => withRefreshedEstimates(blankHousehold("2026-10", seq));
  const files = readdirSync(SAMPLES).filter((f) => f.endsWith(".xlsx"));
  // 定年を聞かない票（簡易版）は「お答えなし」（今の推定の終わりのまま）。どちらも候補にならない
  it("空の世帯に取り込み、同じシートを取り込み直すと、仕事と収入はすべて「同じ」か「お答えなし」", async () => {
    for (const f of files) {
      const a = await importOnce(blank(), sample(f));
      const view = await viewOf(a.wh, sample(f));
      const changed = view.candidates.filter((c) => c.group === "仕事と収入" && c.kind !== "same" && c.kind !== "noAnswer").map((c) => `${c.title} ${c.kind} ${c.fields.flatMap((x) => x.diffs.map((d) => `${d.label}:${d.current}→${d.next}`)).join("/")}`);
      expect(changed, f).toEqual([]);
    }
  });
});

// 住民税の決定額の推定（0133 の追記 2026-11-15）: 所得の年は年度の前の年（計算基準月が1〜5月なら計算基準月の年の2年前）で、
// その年に重なる働き方の月の分だけを数える（計算エンジンと同じ月割り）。平均余命の90歳より上の段と、事務所の推定の値の画面の段の名前
import { describe, expect, it } from "vitest";
import type { Box, EmploymentPeriod, EngineRequest, Household, Timepoint } from "../src/engine/types.ts";
import { allFields, type FieldDef, type Val } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { ensureResidentTax, residentTaxEstimate, residentTaxYear, withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { estimateEntry, stepLabel, summaryText } from "../src/workspace/office/estimateCatalog.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyPlan, savePlan, type Proposal } from "../src/workspace/plans/plans.ts";
import { deathEstimate } from "../src/workspace/input/fill.ts";
import { lifeExpectancy } from "../../hearing/src/estimates.ts";
import { preview } from "./helpers.ts";

let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const fieldOf = (wh: WorkingHousehold, key: string, id: "work" | "family" = "work"): FieldDef => {
  const f = allFields(buildStage(id, wh)).find((x) => x.key === key || x.key.endsWith(key));
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const edit = (wh: WorkingHousehold, key: string, v: Val, id: "work" | "family" = "work") => withRefreshedEstimates(fieldOf(wh, key, id).set(wh, v));
const action = (wh: WorkingHousehold, key: string) => {
  const a = buildStage("work", wh)
    .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
    .find((x) => x.key === key);
  if (a === undefined) throw new Error(`ボタンが無い: ${key}`);
  return withRefreshedEstimates(a.run(wh));
};
/** 会社員を1人入れた世帯（勤め始めは目安の働き始め） */
function worker(base: string, birth = "1990-05"): { wh: WorkingHousehold; self: string } {
  let wh = blankHousehold(base, ids());
  const self = wh.request.input.household.members[0]!.id;
  wh = withRefreshedEstimates(fieldOf(wh, `family/${self}/birth`, "family").set(wh, birth));
  wh = action(wh, `work/${self}/start`);
  return { wh, self };
}
const periodsOf = (wh: WorkingHousehold, member: string): EmploymentPeriod[] => (wh.request.input.household.employmentPeriods ?? []).filter((p) => p.member === member);
type Assessment = { id?: string; member: string; fiscalYear: number; amount: Box<number> };
const listOf = (h: Household): Assessment[] => (h.residentTaxAssessments ?? []) as Assessment[];
const assessments = (wh: WorkingHousehold, member: string): Assessment[] => listOf(wh.request.input.household).filter((a) => a.member === member);
const basisOf = (a: { amount: unknown }) => (a.amount as { estimate?: { basis?: string } }).estimate?.basis ?? "";
const taxRows = (req: EngineRequest): Record<number, number> => {
  const out: Record<number, number> = {};
  for (const c of preview(req).table) if (c.row === "cf.taxSi.residentTax") out[c.year] = (out[c.year] ?? 0) + c.amount;
  return out;
};
/** 推定の決定額を外して、計算エンジンに入れた期間から出させた住民税 */
const engineOnly = (req: EngineRequest): Record<number, number> => {
  const none = structuredClone(req);
  none.input.household.residentTaxAssessments = [];
  return taxRows(none);
};
/** 期間をまとめて置き換える（推定を入れ直す） */
const withPeriods = (wh: WorkingHousehold, member: string, f: (p: EmploymentPeriod) => EmploymentPeriod[]): WorkingHousehold =>
  withRefreshedEstimates(
    mutate(wh, (h) => {
      const mine = (h.employmentPeriods ?? []).filter((p) => p.member === member);
      h.employmentPeriods = [...(h.employmentPeriods ?? []).filter((p) => p.member !== member), ...f(mine[0]!)];
    }),
  );
const pay = (p: EmploymentPeriod) => ({ annual: p.salary?.annual.value ?? 0, bonus: p.salary?.bonus?.value ?? 0 });

describe("住民税の推定の所得の年（計算基準月が1〜5月）", () => {
  it("基準月 2027-02・2026年4月に勤め始めた人: 令和8年度（2025年の所得）の推定は0円で、計算エンジンが入れた期間から出す額とそろう", () => {
    const { wh: w0, self } = worker("2027-02");
    const pid = periodsOf(w0, self)[0]!.id;
    const wh = edit(w0, `work/period/${pid}/from`, "2026-04");
    const as = assessments(wh, self);
    expect(as).toHaveLength(1);
    expect(as[0]!.fiscalYear).toBe(2026);
    expect(as[0]!.amount.value).toBe(0); // 前は 297,000円（2026年の給与から出していた）
    expect(basisOf(as[0]!)).toContain("2025年（2026年度の住民税の元の年）");
    // 推定ありの住民税の行（2027年の1〜5月分＝令和8年度）が、推定を外して計算に任せたときと同じ
    const a = taxRows(wh.request);
    const b = engineOnly(wh.request);
    expect(a[2027]).toBe(b[2027]);
    expect(a[2028]).toBe(b[2028]);
  });

  it("年度の境目: 1月・5月は前の年度（所得は2年前の年）、6月はその年度（所得は前の年）", () => {
    for (const [base, fy, incomeYear] of [
      ["2027-01", 2026, 2025],
      ["2027-05", 2026, 2025],
      ["2027-06", 2027, 2026],
      ["2026-12", 2026, 2025],
    ] as const) {
      const { wh: w0, self } = worker(base);
      const pid = periodsOf(w0, self)[0]!.id;
      const wh = edit(w0, `work/period/${pid}/from`, "2026-04");
      const as = assessments(wh, self);
      expect(residentTaxYear(base)).toBe(fy);
      expect(as.map((x) => x.fiscalYear)).toEqual([fy]);
      const p = pay(periodsOf(wh, self)[0]!);
      // 2026年4月からの勤め: 2025年の所得は0、2026年の所得は4〜12月の9か月分と6月・12月の賞与
      const expected = incomeYear === 2025 ? 0 : residentTaxEstimate(Math.round((p.annual * 9) / 12 + p.bonus), 0, 2026).value;
      expect(as[0]!.amount.value, base).toBe(expected);
      if (incomeYear === 2026) expect(basisOf(as[0]!)).toContain("働いた9か月分");
    }
  });

  it("基準月 2026-03・2025年4月から勤めた人: 2025年度（2024年の所得）は0円の推定を入れる（入れないと2024年の制度データが無く計算が止まる）", () => {
    const { wh: w0, self } = worker("2026-03");
    const pid = periodsOf(w0, self)[0]!.id;
    const wh = edit(w0, `work/period/${pid}/from`, "2025-04");
    expect(assessments(wh, self).map((a) => ({ fy: a.fiscalYear, v: a.amount.value }))).toEqual([{ fy: 2025, v: 0 }]);
    expect(() => preview(wh.request)).not.toThrow();
    // 決定額の無い世帯に入れるとき: 所得の年（2024年）に働いていなくても、前の年（2025年）に働いていれば0円の推定を入れる。今年からの人には入れない
    const h = structuredClone(wh.request.input.household);
    h.residentTaxAssessments = [];
    ensureResidentTax(h, self, "2026-03", () => "00000000-0000-4000-8000-00000000eeee");
    expect(listOf(h).map((a) => a.amount.value)).toEqual([0]);
    const later = structuredClone(h);
    later.residentTaxAssessments = [];
    later.employmentPeriods = (later.employmentPeriods ?? []).map((p) => (p.member === self ? { ...p, from: { at: "2026-01" } } : p));
    ensureResidentTax(later, self, "2026-03", () => "00000000-0000-4000-8000-00000000ffff");
    expect(later.residentTaxAssessments).toEqual([]);
  });

  it("ずっと勤めている人は、基準月が1〜5月でも1年分の額（所得の年と、その年の税の決まりで出す）", () => {
    const { wh, self } = worker("2027-03");
    const a = assessments(wh, self)[0]!;
    const p = pay(periodsOf(wh, self)[0]!);
    expect(a.fiscalYear).toBe(2026);
    expect(a.amount.value).toBe(residentTaxEstimate(p.annual + p.bonus, 0, 2025).value);
    expect(a.amount.value).toBeGreaterThan(0);
    expect(basisOf(a)).toContain("2025年（2026年度の住民税の元の年）");
    // 計算基準月が6〜12月なら前の文のまま（保存した世帯の根拠の文を変えない）
    const { wh: w2, self: s2 } = worker("2026-10");
    expect(basisOf(assessments(w2, s2)[0]!)).toBe("前の年の給与・事業の所得からの概算（住民税の決定通知書の年税額を入れると置き換わります）");
  });
});

describe("住民税の推定は、所得の年に働いた月の分だけを数える", () => {
  it("前の年の10月に勤め始めた人: 10〜12月の給与と12月の賞与から（前は1年分の 297,000円）", () => {
    const { wh: w0, self } = worker("2026-10");
    const full = assessments(w0, self)[0]!.amount.value!;
    const pid = periodsOf(w0, self)[0]!.id;
    const wh = edit(w0, `work/period/${pid}/from`, "2025-10");
    const p = pay(periodsOf(wh, self)[0]!);
    const a = assessments(wh, self)[0]!;
    expect(a.amount.value).toBe(residentTaxEstimate(Math.round((p.annual * 3) / 12 + p.bonus / 2), 0, 2025).value);
    expect(a.amount.value!).toBeLessThan(full / 2);
    expect(basisOf(a)).toContain("働いた3か月分");
    // 次の年度（入れた期間から計算エンジンが出す）との差が、前の1年分の推定より小さい
    const withEst = taxRows(wh.request);
    const none = engineOnly(wh.request);
    expect(Math.abs(withEst[2027]! - none[2027]!)).toBeLessThan(20_000);
  });

  it("12月の出来事: 12月に勤め始めた人は1か月分と12月の賞与。12月で辞めた人は1年分", () => {
    const { wh: w0, self } = worker("2026-10");
    const p0 = periodsOf(w0, self)[0]!;
    const dec = withPeriods(w0, self, (p) => [{ ...p, from: { at: "2025-12" } }]);
    const p = pay(p0);
    expect(assessments(dec, self)[0]!.amount.value).toBe(residentTaxEstimate(Math.round(p.annual / 12 + p.bonus / 2), 0, 2025).value);
    expect(basisOf(assessments(dec, self)[0]!)).toContain("働いた1か月分");
    // 2025年12月に辞めて、2026年1月から別の勤め（前の年は12か月そろう）
    const change = withPeriods(w0, self, (q) => [
      { ...q, to: { at: "2025-12" } },
      { ...structuredClone(q), id: "00000000-0000-4000-8000-00000000aaaa", from: { at: "2026-01" }, to: null },
    ]);
    expect(assessments(change, self)[0]!.amount.value).toBe(residentTaxEstimate(p.annual + p.bonus, 0, 2025).value);
  });

  it("転職の年: 前の勤め（1〜6月）と次の勤め（8月から）の月の分を足す。間の7月は収入なし", () => {
    const { wh: w0, self } = worker("2026-10");
    const p = pay(periodsOf(w0, self)[0]!);
    const wh = withPeriods(w0, self, (q) => [
      { ...q, to: { at: "2025-06" } },
      { ...structuredClone(q), id: "00000000-0000-4000-8000-00000000bbbb", from: { at: "2025-08" }, to: null, salary: { annual: { value: 6_000_000, state: "confirmed", origin: { kind: "manual" } }, bonus: { value: 1_200_000, state: "confirmed", origin: { kind: "manual" } } } },
    ]);
    const salary = Math.round((p.annual * 6) / 12 + p.bonus / 2 + (6_000_000 * 5) / 12 + 1_200_000 / 2);
    const a = assessments(wh, self)[0]!;
    expect(a.amount.value).toBe(residentTaxEstimate(salary, 0, 2025).value);
    expect(basisOf(a)).toContain("働いた11か月分");
  });

  it("同じ始まりを年月で入れても年齢で入れても同じ推定（1日生まれ・誕生月の前後）", () => {
    for (const bornOnFirst of [false, true]) {
      const { wh: w0, self } = worker("2026-10", "1990-05");
      const w1 = mutate(w0, (h) => void (h.members[0]!.birth.bornOnFirst = bornOnFirst));
      // 35歳になる月: 5月2日〜31日生まれは2025年5月、5月1日生まれは前の日に年をとるので2025年4月
      const reach = bornOnFirst ? "2025-04" : "2025-05";
      const byAge = withPeriods(w1, self, (p) => [{ ...p, from: { memberAge: { member: self, years: 35 } } as Timepoint }]);
      const byYm = withPeriods(w1, self, (p) => [{ ...p, from: { at: reach } }]);
      expect(assessments(byAge, self)[0]!.amount.value).toBe(assessments(byYm, self)[0]!.amount.value);
      expect(basisOf(assessments(byAge, self)[0]!)).toContain(`働いた${String(13 - Number(reach.slice(5)))}か月分`);
    }
  });

  it("重ねたプラン: 土台のプランで配偶者が働き始め、その上のプランを重ねても、配偶者の推定は同じ決まり（年度の元の年に重なる月の分）", () => {
    const { wh: w0, self } = worker("2027-03");
    // 配偶者を足して、2025年10月から「働いていない」の期間を入れておく（プランで種類を変えると、その期間が勤めになる）
    let wh = mutate(w0, (h) => {
      h.members.push({ id: "00000000-0000-4000-8000-00000000cccc", kind: "spouse", birth: { birthYearMonth: "1991-08", bornOnFirst: false }, sex: "female", joins: null, leaves: null, expected: false });
      (h.employmentPeriods ??= []).push({ id: "00000000-0000-4000-8000-00000000dddd", member: "00000000-0000-4000-8000-00000000cccc", from: { at: "2025-10" }, to: null, type: "unemployed" } as EmploymentPeriod);
    });
    const sp = "00000000-0000-4000-8000-00000000cccc";
    const cat = buildCatalog(wh, self, null);
    const key = `spouse:${sp}:work`;
    expect(cat.byKey.has(key)).toBe(true);
    const b = savePlan(wh, cat, { name: "B", base: null, values: { [key]: { type: "regular", annual: 6_000_000 } }, now: "2026-11-15T00:00:00+09:00" });
    wh = b.wh;
    const c = savePlan(wh, buildCatalog(wh, self, null), { name: "C", base: b.id, values: {}, now: "2026-11-15T00:00:00+09:00" });
    const onB = applyPlan(c.wh, b.id, cat).request.input.household;
    const onC = applyPlan(c.wh, c.id, cat).request.input.household;
    const of = (h: Household) => listOf(h).filter((a) => a.member === sp).map((a) => ({ fy: a.fiscalYear, v: a.amount.value }));
    // 2026年度（2025年の所得）は 10〜12月の3か月分と12月の賞与（前は1年分）
    const q = pay((onB.employmentPeriods ?? []).find((x) => x.member === sp)!);
    const expected = residentTaxEstimate(Math.round((q.annual * 3) / 12 + q.bonus / 2), 0, 2025);
    expect(of(onB)).toEqual([{ fy: 2026, v: expected.value }]);
    expect(of(onC)).toEqual(of(onB));
    expect(basisOf(listOf(onC).find((a) => a.member === sp)!)).toContain("働いた3か月分");
    expect((c.wh.proposals as Proposal[]).map((p) => p.name)).toEqual(["B", "C"]);
  });
});

describe("平均余命の90歳より上（令和7年簡易生命表の全年齢の表）", () => {
  it("95・100・105歳は公表の値、間は直線で補い、105歳から上は105歳以上の値", () => {
    expect(lifeExpectancy(90, "female")!.value).toBeCloseTo(5.66, 6);
    expect(lifeExpectancy(95, "male")!.value).toBeCloseTo(2.9, 6);
    expect(lifeExpectancy(95, "female")!.value).toBeCloseTo(3.58, 6);
    expect(lifeExpectancy(100, "male")!.value).toBeCloseTo(1.81, 6);
    expect(lifeExpectancy(100, "female")!.value).toBeCloseTo(2.05, 6); // 前は 5.66
    expect(lifeExpectancy(105, "male")!.value).toBeCloseTo(1.08, 6);
    expect(lifeExpectancy(110, "female")!.value).toBeCloseTo(1.06, 6); // 表の最後の段から上
    // 91歳（公表 男 4.06）は 90歳と95歳の間を補う
    expect(lifeExpectancy(91, "male")!.value).toBeCloseTo(4.38 + (2.9 - 4.38) / 5, 6);
    // 0〜90歳は変わらない
    expect(lifeExpectancy(40, "female")!.value).toBeCloseTo(48.05, 6);
    expect(lifeExpectancy(31, "female")!.value).toBeCloseTo(57.85 + ((48.05 - 57.85) * 1) / 10, 6);
  });

  it("100歳の母の亡くなる見込みは102歳ごろ（前は105歳ごろ）。誕生月の前後で年齢が変わる", () => {
    const mother = { id: "m", kind: "parent", birth: { birthYearMonth: "1926-11", bornOnFirst: false }, sex: "female", joins: null, leaves: null } as const;
    // 2026年10月は99歳（11月で100歳）、2026年11月は100歳
    expect(deathEstimate(mother, "2026-10")!.age).toBe(Math.floor(99 + 2.05 + (3.58 - 2.05) * (1 / 5)));
    expect(deathEstimate(mother, "2026-11")!.age).toBe(102);
    // 1日生まれは前の月に年をとる
    expect(deathEstimate({ ...mother, birth: { birthYearMonth: "1926-11", bornOnFirst: true } }, "2026-10")!.age).toBe(102);
  });
});

describe("事務所の推定の値の画面: 平均余命の段の名前は1つの年齢（計算の読み方とそろえる）", () => {
  it("「40歳」のように出し、最後は「105歳〜」。区切りなしの段は出さない", () => {
    const e = estimateEntry("lifeTable.lifeExpectancy.female")!;
    expect(e.points).toBe(true);
    const t = e.official.value as readonly { upTo: number | null }[];
    const labels = t.map((_, i) => stepLabel(e.axis, t as never, i, e.points));
    expect(labels.slice(0, 4)).toEqual(["0歳", "20歳", "30歳", "40歳"]);
    expect(labels.at(-2)).toBe("105歳〜");
    expect(t.at(-1)!.upTo).toBeNull();
    expect(summaryText(e, e.official.value)).toBe(`0歳 87.33年 ほか（${String(t.length)}段の表）`);
    // ほかの年齢の表は幅のまま
    const male = estimateEntry("lifeTable.lifeExpectancy.male")!;
    expect(stepLabel(male.axis, t as never, 3)).toBe("31〜40歳");
  });
});

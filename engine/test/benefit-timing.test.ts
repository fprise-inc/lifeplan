// 給付の額と保険料の納期の検算（2026-11-14 の点検）。どれも直す前は落ちた:
// - 育児時短就業給付: 時短中の賃金が時短の前の90%を超え100%未満の月の支給率（雇用保険法61条の12第6項。業務取扱要領 60644）
// - 国民健康保険・介護保険の第1号・後期高齢者医療: 年度の途中で資格を得た年度は、資格を得た月より後の納期だけで払う（0003 の追記）
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import { installmentMonths } from "../src/sdk/helpers.ts";
import { formatYm, monthIndex } from "../src/time/month.ts";
import { household, member, modelHousehold, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
const run = (r: Req): EngineResult => runEngine(r, realPacks(), { checkInternal: true });

describe("育児時短就業給付の支給率（賃金が時短の前の90%を超え100%未満）", () => {
  // 時短の前は月給30万円（賞与なし）。2027-01 から時短。子は 2026-02 生まれ（2歳の前の月 2028-01 まで。給付は翌月に払う）
  const shortHours = (afterAnnual: number): { ym: string; amount: number }[] => {
    const req = household({
      baseMonth: "2026-10",
      endYear: 2029,
      members: [member("h", "self", "1990-05", { sex: "male" }), member("w", "spouse", "1992-03"), member("c", "child", "2026-02")],
      relations: [
        { type: "spouse", a: uid("h"), b: uid("w"), marriage: "legal", from: null, to: null },
        { type: "parentOf", parent: uid("h"), child: uid("c") },
        { type: "parentOf", parent: uid("w"), child: uid("c") },
      ],
      periods: [
        period("ph", { member: "h", from: "2013-04", annual: 6000000 }),
        period("p1", { member: "w", from: "2014-04", to: "2026-12", annual: 3600000, bonus: 0 }),
        period("p2", { member: "w", from: "2027-01", annual: afterAnnual, bonus: 0, extra: { childcareShortHours: { child: uid("c") } } }),
      ],
    });
    const a = (req.input as unknown as { assumptions: Record<string, unknown> }).assumptions;
    a.inflation = { default: "0" };
    a.wageGrowth = { default: "0" };
    return run(req)
      .flows.filter((f) => f.formula === "benefit.employment.shortHours")
      .map((f) => ({ ym: f.ym, amount: f.amount }));
  };

  it("95%（28.5万円）: 賃金率 95.00、支給率 9,000÷95−90＝4.74%（小数点以下第3位を四捨五入）→ 13,509円（直す前は一律10%の 28,500円）", () => {
    const got = shortHours(3420000);
    expect(got.length).toBe(14);
    expect(got.every((x) => x.amount === 13509)).toBe(true);
  });

  it("92%（27.6万円）: 支給率 9,000÷92−90＝7.83% → 21,610円（円未満切り捨て）", () => {
    expect(shortHours(3312000).every((x) => x.amount === 21610)).toBe(true);
  });

  it("80%（24万円）は今までどおり10%の 24,000円", () => {
    const got = shortHours(2880000);
    expect(got.length).toBe(14);
    expect(got.every((x) => x.amount === 24000)).toBe(true);
  });

  it("99.5%: 支給率 0.45% の 1,343円は、賃金日額の下限額の8割（3,203円×0.8）以下なので出ない（業務取扱要領 60644 ニ）", () => {
    expect(shortHours(3582000)).toEqual([]);
  });
});

describe("年度の途中で資格を得た年度の納期", () => {
  const ym = (y: number, m: number) => monthIndex(y, m);
  const months = (fy: number, special: boolean, joined?: number) => installmentMonths(fy, special, joined as never).map(formatYm);

  it("普通徴収の10回のうち、資格を得た月より後の納期だけ。3月に得たら翌月（翌年度の4月）。年金からの差し引き（特別徴収）はその年度は始まらない", () => {
    expect(months(2029, false)).toEqual(["2029-06", "2029-07", "2029-08", "2029-09", "2029-10", "2029-11", "2029-12", "2030-01", "2030-02", "2030-03"]);
    expect(months(2029, false, ym(2029, 9))).toEqual(["2029-10", "2029-11", "2029-12", "2030-01", "2030-02", "2030-03"]);
    expect(months(2029, true, ym(2029, 6))).toEqual(["2029-07", "2029-08", "2029-09", "2029-10", "2029-11", "2029-12", "2030-01", "2030-02", "2030-03"]);
    expect(months(2029, false, ym(2030, 2))).toEqual(["2030-03"]);
    expect(months(2029, false, ym(2030, 3))).toEqual(["2030-04"]);
    // 4月・5月に得たときは10回のまま。年度の外の月は渡されても使わない
    expect(months(2029, false, ym(2029, 4))).toHaveLength(10);
    expect(months(2029, true, ym(2028, 7))).toEqual(["2029-04", "2029-06", "2029-08", "2029-10", "2029-12", "2030-02"]);
  });

  /** 年度（accrualYear）ごとの、払う月と額 */
  const paid = (name: string, prefix: string, fy: number, who?: (m: string | undefined) => boolean) => {
    const r = run(modelHousehold(name) as Req);
    const by = new Map<string, number>();
    for (const f of r.flows) if (f.formula.startsWith(prefix) && f.accrualYear === fy && (who === undefined || who(f.member))) by.set(f.ym, (by.get(f.ym) ?? 0) + f.amount);
    return [...by].sort(([a], [b]) => (a < b ? -1 : 1));
  };

  it("国民健康保険（sampleSeniorCouple。2030-02 に入る）: 2029年度の2か月分 56,611円は 2030-03 に払う（直す前は 2029-06 から10回）", () => {
    expect(paid("sampleSeniorCouple", "socialInsurance.nationalHealth", 2029)).toEqual([["2030-03", 56611]]);
  });

  it("国民健康保険（retirementSequence。2036-07 に入る）: 2036年度は 2036-08〜2037-03 の8回", () => {
    const got = paid("retirementSequence", "socialInsurance.nationalHealth", 2036);
    expect(got.map(([m]) => m)).toEqual(["2036-08", "2036-09", "2036-10", "2036-11", "2036-12", "2037-01", "2037-02", "2037-03"]);
  });

  it("介護保険の第1号（retirementSequence。2036-06 に65歳）: 2036年度は普通徴収で 2036-07〜2037-03 の9回（直す前は 2036-04 から年金で差し引き）。翌年度から年金で差し引く", () => {
    const r = run(modelHousehold("retirementSequence") as Req);
    const self = r.flows.find((f) => f.formula === "socialInsurance.careFirst.annual" && f.accrualYear === 2036)?.member;
    const got = paid("retirementSequence", "socialInsurance.careFirst", 2036, (m) => m === self);
    expect(got.map(([m]) => m)).toEqual(["2036-07", "2036-08", "2036-09", "2036-10", "2036-11", "2036-12", "2037-01", "2037-02", "2037-03"]);
    expect(got.reduce((s, [, a]) => s + a, 0)).toBe(24900 * 6);
    expect(paid("retirementSequence", "socialInsurance.careFirst", 2037, (m) => m === self).map(([m]) => m)).toEqual(["2037-04", "2037-06", "2037-08", "2037-10", "2037-12", "2038-02"]);
  });

  it("後期高齢者医療（pensionCouple。2028-07 に75歳になる人）: 2028年度は普通徴収で 2028-08〜2029-03 の8回", () => {
    // 2027年度にもう後期高齢者医療に入っている人（年金から差し引く）を除く
    const r = run(modelHousehold("pensionCouple") as Req);
    const already = new Set(r.flows.filter((f) => f.formula.startsWith("socialInsurance.lateElderly") && f.accrualYear === 2027).map((f) => f.member));
    const got = paid("pensionCouple", "socialInsurance.lateElderly", 2028, (m) => !already.has(m));
    expect(got.map(([m]) => m)).toEqual(["2028-08", "2028-09", "2028-10", "2028-11", "2028-12", "2029-01", "2029-02", "2029-03"]);
  });
});

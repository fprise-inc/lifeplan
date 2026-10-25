// 計算基準月より前の年度の判定（製品の制度データ。所得税・社会保険の多くの値は2025年・2025年度から）。
// 表に載らない年度の住民税・保険料で判定して、その年度の制度の値（最初の行より前の日。0007 の追記で値が無い）を引いて
// E_PARAM_NO_VALUE で止まらないことを確かめる。きっかけ: 大学在学中の子に進路を入れると、修学支援の判定で計算が止まった
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { box, household, member, modelHousehold, period, realPacks, uid } from "./helpers.ts";

type Req = EngineRequest;
type Obj = Record<string, unknown>;
type Cell = { row: string; year: number; amount: number };
type Flow = { row: string; ym: string; amount: number; formula: string };
const A = uid("a");
const B = uid("b");
const C = uid("c");
const run = (req: Req) => runEngine(req, realPacks(), {}) as EngineResult;
const entry = <T>(req: Req, component: string, input: unknown) => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const cellsOf = (r: EngineResult, row: string) => (r.table as unknown as Cell[]).filter((c) => c.row === row).reduce((s, c) => s + c.amount, 0);
/** 自動で入った推定（アプリが入れる今年度の住民税の決定額の形） */
const estimated = (value: number) => ({ value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: "テスト" } });
/** 計算基準月に払っている住民税の年度（6月から翌年5月） */
const taxYear = (base: string) => (Number(base.slice(5)) >= 6 ? Number(base.slice(0, 4)) : Number(base.slice(0, 4)) - 1);
const UNIVERSITY = [{ stage: "university", sector: "private", field: "humanities", living: "home" }];

/**
 * 50代の夫婦と子（夫は会社員 年収580万円＋賞与120万円、妻はパート100万円）。アプリの入力の画面が入れる形にそろえる:
 * 標準報酬月額と、今年度の住民税の決定額（推定。夫 377,000円・妻 0円）を持つ
 */
function family(o: { base: string; child: string; stages: Obj[] }): Req {
  const fy = taxYear(o.base);
  const req = household({
    baseMonth: o.base,
    endYear: 2073,
    members: [member("a", "self", "1973-04", { sex: "male" }), member("b", "spouse", "1975-04"), member("c", "child", o.child, { sex: "male" })],
    relations: [
      { type: "spouse", a: A, b: B, marriage: "legal", from: null, to: null },
      { type: "parentOf", parent: A, child: C },
      { type: "parentOf", parent: B, child: C },
    ],
    periods: [
      period("pa", { member: "a", from: "1995-04", to: "2033-03", annual: 5800000, bonus: 1200000, std: [483000, 483000] }),
      period("pb", { member: "b", from: "1997-04", to: "2035-03", type: "partTime", annual: 1000000, std: [83000, 83000] }),
    ],
    residentTaxAssessments: [
      { id: uid("ra"), member: A, fiscalYear: fy, amount: estimated(377000) },
      { id: uid("rb"), member: B, fiscalYear: fy, amount: estimated(0) },
    ],
  });
  (req.input.household as unknown as Obj).goals = [{ id: uid("g"), kind: "education", owner: C, education: { stages: o.stages } }];
  return req;
}

/** アプリの「＋ 進路を入れる」と同じ初めの形（まだ終わっていない段。大学は私立・文系・自宅）。幼稚園の前の年齢なら保育所の段も */
function stagesFor(birth: string, base: string): Obj[] {
  const [y, m] = birth.split("-").map(Number) as [number, number];
  const entryYear = y + 6 + (m < 4 ? 0 : 1);
  const schoolYear = Number(base.slice(5)) >= 4 ? Number(base.slice(0, 4)) : Number(base.slice(0, 4)) - 1;
  const spans: [string, number, number][] = [
    ["kindergarten", entryYear - 3, 3],
    ["elementary", entryYear, 6],
    ["juniorHigh", entryYear + 6, 3],
    ["highSchool", entryYear + 9, 3],
    ["university", entryYear + 12, 4],
  ];
  const out: Obj[] = entryYear - 3 > schoolYear ? [{ stage: "nursery" }] : [];
  for (const [stage, start, years] of spans) if (start + years > schoolYear) out.push(stage === "university" ? UNIVERSITY[0] as Obj : { stage, sector: "public" });
  return out;
}

describe("修学支援（education.support）: 計算基準月より前の年度で判定しない", () => {
  it("大学在学中の子（2005年4月〜2008年3月生まれ）に進路を入れても止まらない（前は給与所得控除・修学支援の区分の値が無く E_PARAM_NO_VALUE）", () => {
    for (const child of ["2003-04", "2005-04", "2006-04", "2007-04", "2008-03"]) {
      expect(() => run(family({ base: "2026-10", child, stages: UNIVERSITY })), child).not.toThrow();
    }
  });

  it("年収700万円の世帯は修学支援の対象外（今年度の住民税が決定額だけの年度も、決定額の10分の6で区分を決める）", () => {
    // 前は課税標準額を0円とみなして第I区分になり、2026年10月〜2027年3月に授業料の減免と給付型奨学金が出ていた
    const r = run(family({ base: "2026-10", child: "2006-04", stages: UNIVERSITY }));
    expect(cellsOf(r, "cf.income.benefit.education")).toBe(0);
    const later = run(family({ base: "2026-10", child: "2008-04", stages: UNIVERSITY }));
    expect(cellsOf(later, "cf.income.benefit.education")).toBe(0);
  });

  it("計算基準月が6〜9月の年も止まらない（4〜9月の分を、表に載らない前の年度の住民税で判定しない）", () => {
    for (const base of ["2026-06", "2026-07", "2026-09", "2027-06", "2027-09"]) {
      expect(() => run(family({ base, child: "2006-04", stages: UNIVERSITY })), base).not.toThrow();
    }
  });

  it("計算基準月が2026年6月以後なら、どの年齢の子に初めの形の進路を入れても止まらない", () => {
    for (const base of ["2026-06", "2026-07", "2026-10", "2027-01", "2027-04", "2027-07", "2027-10"]) {
      for (let age = 0; age <= 23; age++) {
        const child = `${Number(base.slice(0, 4)) - age}-05`;
        expect(() => run(family({ base, child, stages: stagesFor(child, base) })), `${base} ${child}`).not.toThrow();
      }
    }
  });
});

describe("保育料・年金生活者支援給付金: 計算基準月より前の年度の住民税で判定しない", () => {
  it("保育料: 計算基準月が2027年7月なら、7・8月の分を2026年度の住民税で決めない（前は2024年12月分の保険料の値が無く止まった）", () => {
    const r = run(family({ base: "2027-07", child: "2025-05", stages: [{ stage: "nursery" }] }));
    expect((r.flows as unknown as Flow[]).some((f) => f.row === "cf.expense.education.nursery" && f.ym === "2027-07")).toBe(true);
  });

  it("年金生活者支援給付金: 計算基準月が2026年6〜9月でも止まらない（前は2025年度の住民税の非課税の判定で、扶養の所得の上限の値が無く止まった）", () => {
    for (const base of ["2026-06", "2026-07", "2026-09"]) {
      const req = modelHousehold("pensionCouple");
      req.input.baseMonth = base;
      expect(() => run(req), base).not.toThrow();
    }
  });
});

describe("国民健康保険・介護保険（第1号）・後期高齢者医療: 前の年の社会保険料控除のためだけに計算する年度", () => {
  /** 定年で辞めた人（今年度の住民税の決定額は無い。住民税は前の年の年金の所得から計算する） */
  const retired = (birth: string, type: string, o: Obj = {}) => {
    const y = Number(birth.slice(0, 4));
    return household({
      baseMonth: "2026-10",
      endYear: y + 100,
      members: [member("a", "self", birth, { sex: "male" })],
      periods: [period("pa", { member: "a", from: `${y + 22}-04`, to: `${y + 60}-05`, type, annual: 4500000, bonus: 1600000, std: [375000, 375000], ...o })],
    });
  };

  it("計算基準月の年度より前の年度は、計算基準月の年度の所得と制度の値で計算する（前は2024年度の値が無く止まった）", () => {
    // 72歳・80歳（介護保険の第1号・後期高齢者医療。年金からの特別徴収の下限）、66歳の元公務員（国民健康保険）
    expect(() => run(retired("1954-06", "regular"))).not.toThrow();
    expect(() => run(retired("1946-06", "regular"))).not.toThrow();
    expect(() => run(retired("1960-06", "civilServant", { healthInsurance: { kind: "mutualAid", employeeRate: box("0.046") }, pensionCategory: "employee3" }))).not.toThrow();
  });

  it("国民健康保険: 2024年度（計算基準月 2026年6月より前）の保険料は、2026年度の保険料と同じ年額（同じ所得・同じ制度の値）", () => {
    const req = household({
      baseMonth: "2026-06",
      endYear: 2027,
      members: [member("a", "self", "1981-01")],
      periods: [{ id: uid("p"), member: A, from: { at: "2010-04" }, to: null, type: "selfEmployed", business: { income: box(3000000) } }],
    });
    (req.input.household as unknown as Obj).premiumRates = [{ id: uid("pr"), kind: "nationalHealth", parts: { medical: { incomeRate: box("0.07"), perCapita: box(40000), perHousehold: box(20000) } } }];
    const amounts = (fiscalYear: number) => entry<{ flows: Flow[] }>(req, "socialInsurance.nationalHealth", { fiscalYear }).flows.map((f) => [f.formula, Number(f.ym.slice(0, 4)) - fiscalYear, f.ym.slice(5), f.amount]);
    expect(amounts(2024)).toEqual(amounts(2026));
    expect(amounts(2026).length).toBe(10);
  });
});

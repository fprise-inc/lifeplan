// 変額保険を解約するプラン（0233）の計算の側: 円の目安の形の変額保険の死亡保険金の最低保証（基本保険金額）と
// 数表の解約返戻金の下限（insurance.policy 改訂7）、解約の月の前後の保険料・解約返戻金、解約返戻金の一時所得（払込総額を下回る・上回る）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { InsuranceIncomeOutput, InsurancePolicyOutput } from "../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = EngineRequest;
type Obj = Record<string, unknown>;
const H = uid("h");
const W = uid("w");
const V = uid("var");
const at = (ym: string) => ({ at: ym });
const run = (req: Req) => runEngine(req, realPacks(), { checkInternal: true });
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const policy = (req: Req, id = V) => call<InsurancePolicyOutput>(req, "insurance.policy", { object: id });

const family = (baseMonth = "2026-10") =>
  household({
    baseMonth,
    endYear: 2060,
    members: [member("h", "self", "1981-07", { sex: "male" }), member("w", "spouse", "1983-10")],
    relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }],
    periods: [period("ph", { member: "h", from: "2004-04", annual: 6000000, std: [500000, 500000] })],
    residentTaxAssessments: [{ id: uid("rta"), member: H, fiscalYear: 2026, amount: box(300000) }],
  });

/** 2016年4月から月2万円（65歳の月の前まで）、基本保険金額1000万円の変額保険（円の目安の形） */
const variable = (o: Obj = {}, baseMonth?: string): Req => {
  const req = JSON.parse(JSON.stringify(family(baseMonth))) as Req;
  ((req.input as unknown as Obj).household as Obj).insuranceContracts = [
    {
      id: V,
      template: "insurance.variable",
      subtype: "variable",
      policyholder: H,
      insured: H,
      contractDate: "2016-04",
      currency: "JPY",
      premium: { amount: 20000, frequency: "monthly", payUntil: { memberAge: { member: H, years: 65, months: 0 } } },
      deductionCategory: { type: "general", regime: "new" },
      coverages: [{ id: uid("vd"), role: "main", benefit: "death", amount: 10000000, to: null }],
      simple: { estimate: true },
      ...o,
    },
  ];
  return req;
};
const year = (out: InsurancePolicyOutput, y: number) => out.years.find((e) => e.year === y)!;

describe("円の目安の形の変額保険の死亡保険金（改訂7）", () => {
  it("数表の解約返戻金が基本保険金額を超えた年は、その解約返戻金を下限にする（積立金は解約返戻金を下回らない）", () => {
    const out = policy(variable({ schedule: { rows: [{ policyYear: 20, surrenderValue: 12000000 }, { policyYear: 21, surrenderValue: 9000000 }] } }));
    // 2036年12月は21保険年度の途中（終わった保険年度は20）
    expect(year(out, 2036).deathBenefit).toBe(12000000);
    // 2037年12月は終わった保険年度が21（解約返戻金900万円は基本保険金額より少ない）
    expect(year(out, 2037).deathBenefit).toBe(10000000);
    // 数表の行の無い年は基本保険金額
    expect(year(out, 2030).deathBenefit).toBe(10000000);
  });

  it("数表の死亡保障が基本保険金額より少ない行は、基本保険金額を最低保証にする", () => {
    const out = policy(variable({ schedule: { rows: [{ policyYear: 11, deathBenefit: 8000000 }, { policyYear: 12, deathBenefit: 13000000 }] } }));
    // 2026年12月は11保険年度
    expect(year(out, 2026).deathBenefit).toBe(10000000);
    expect(year(out, 2027).deathBenefit).toBe(13000000);
  });

  it("前の入れ方（積立金を伸ばす形）と外貨建て保険の目安の形は今までどおり", () => {
    const fx = JSON.parse(JSON.stringify(variable({ template: "insurance.foreignCurrency", subtype: "foreignCurrency", schedule: { rows: [{ policyYear: 20, surrenderValue: 12000000 }] } }))) as Req;
    expect(year(policy(fx), 2036).deathBenefit).toBe(10000000);
    const grows = policy(variable({ simple: { assetClass: "equity.global", loadRate: "0.1" } }));
    expect(year(grows, 2026).deathBenefit).toBeGreaterThanOrEqual(10000000);
  });
});

describe("解約の月と一時所得", () => {
  const rows = (n: number, f: (py: number) => number) => Array.from({ length: n }, (_, i) => ({ policyYear: i + 1, surrenderValue: f(i + 1) }));

  it("解約の月から保険料を払わず、その月に終わった保険年度の解約返戻金を受け取る（計算基準月に解約）", () => {
    const req = variable({ surrender: at("2026-10"), schedule: { rows: rows(30, (py) => py * 200000) } });
    const r = run(req);
    const s = r.flows.filter((f) => f.row === "cf.income.lumpSum.surrender");
    // 2016年4月から2026年10月までに終わった保険年度は10
    expect(s.map((f) => [f.ym, f.amount])).toEqual([["2026-10", 2000000]]);
    const prem = r.flows.filter((f) => f.row === "cf.expense.insurance" && f.object === V);
    expect(prem.every((f) => f.ym < "2026-10")).toBe(true);
  });

  it("解約返戻金が払込総額を下回ると一時所得は出ない", () => {
    // 2026年10月まで126か月×2万円＝252万円を払い、解約返戻金は200万円
    const req = variable({ surrender: at("2026-10"), schedule: { rows: rows(30, (py) => py * 200000) } });
    const inc = call<InsuranceIncomeOutput>(req, "insurance.income", { member: H, year: 2026 });
    expect(inc.temporary).toBe(0);
    expect(inc.temporaryIncluded).toBe(0);
  });

  it("上回ると、50万円の特別控除の後の2分の1を総所得金額に入れる", () => {
    // 2036年1月に解約: 終わった保険年度は19、払込は237か月×2万円＝474万円、解約返戻金は19×30万円＝570万円
    const req = variable({ surrender: at("2036-01"), schedule: { rows: rows(30, (py) => py * 300000) } });
    const inc = call<InsuranceIncomeOutput>(req, "insurance.income", { member: H, year: 2036 });
    expect(inc.temporaryGross).toBe(5700000 - 4740000);
    expect(inc.temporary).toBe(5700000 - 4740000 - 500000);
    expect(inc.temporaryIncluded).toBe((5700000 - 4740000 - 500000) / 2);
  });

  it("計算基準月が2月の世帯: 計算基準月に解約すると、表の保険料は無く、払込保険料の累計は1月まで", () => {
    const req = variable({ surrender: at("2027-02"), schedule: { rows: rows(30, (py) => py * 200000) } }, "2027-02");
    const r = run(req);
    expect(r.flows.filter((f) => f.row === "cf.income.lumpSum.surrender").map((f) => [f.ym, f.amount])).toEqual([["2027-02", 2000000]]);
    expect(r.flows.filter((f) => f.row === "cf.expense.insurance" && f.object === V)).toEqual([]);
    // 2016年4月から2027年1月まで130か月
    expect(year(policy(req), 2027).paid).toBe(130 * 20000);
    // 解約した年からは解約返戻金・死亡保障を持たない
    expect(year(policy(req), 2027)).toMatchObject({ deathBenefit: 0, surrenderValue: 0 });
  });
});

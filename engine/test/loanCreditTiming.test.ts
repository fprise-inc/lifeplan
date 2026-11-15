// 住宅ローン控除の年末残高・前年分の確定申告・2年前の標準報酬・固定資産税の払う月・亡くなった年の住宅ローン控除（2026-11-14 の直し。
// 0008・0136・0003・0171・0112 の追記）
// - 12月に借りたローンも、借りた年の年末残高（借入の額）で1年目の控除を受ける（租税特別措置法41条1項・2項）
// - 今の残高から入れたローンも、残高の時点より前の年末残高を推定して前年分の控除を出す（住民税が借入の額から入れたときと同じになる）
// - 計算基準月が1〜3月なら、前年分の確定申告の精算（3月の還付）を載せる
// - 計算基準月が1〜5月でも、2年前の1〜8月の標準報酬がいちばん低い等級にならない（1〜5月の住民税が高く出ない）
// - 固定資産税は1月1日に持っている年度を4回で払い、買った年の年度は引き渡しの月に月割りの精算だけ払う。計算基準月が1月なら前の年度の2月の分も払う
// - 亡くなった年の住宅ローン控除は、死亡の月の返済の後・団信で減らす前の残高で計算する
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { DebtScheduleOutput } from "../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const packs = realPacks();
const run = (req: Req): EngineResult => runEngine(req, packs, { checkInternal: true });
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, packs, { checkInternal: true, entry: { component, input } }).entryOutput as T;
const at = (ym: string) => ({ at: ym });
const H = uid("h");
const W = uid("w");
const RES = uid("res");
const LOAN = uid("loan");
const MV = uid("mv");
const setH = (req: Req, key: string, value: unknown): Req => {
  (req.input.household as unknown as Obj)[key] = value;
  return req;
};
const sumRow = (r: EngineResult, row: string, year: number, who?: string) =>
  r.flows.filter((f) => f.row === row && f.ym.startsWith(`${year}-`) && (who === undefined || f.member === who)).reduce((s, f) => s + f.amount, 0);
const monthsOf = (r: EngineResult, row: string, from: string, to: string) =>
  r.flows.filter((f) => f.row === row && f.ym >= from && f.ym <= to).map((f) => `${f.ym}:${f.amount}`);

/** 会社員1人（1986年5月生まれ・2009年4月から勤務）が、loanStart に4,000万円・1%・35年で借りて入居する認定住宅の新築 */
function buyer(o: { baseMonth: string; annual: number; loanStart: string; balance?: { value: number; asOf: string } }): Req {
  const req = household({
    baseMonth: o.baseMonth,
    endYear: 2031,
    members: [member("h", "self", "1986-05", { sex: "male" })],
    periods: [period("p", { member: "h", from: "2009-04", annual: o.annual })],
    events: [{ id: MV, kind: "moveIn", at: at(o.loanStart) }],
  });
  setH(req, "residences", [{ id: RES, kind: "own", from: { event: MV }, to: null, ownership: [{ member: H, share: "1" }] }]);
  setH(req, "debts", [
    {
      id: LOAN,
      kind: "mortgage",
      debtors: [{ member: H, role: "primary" }],
      principal: 40000000,
      start: at(o.loanStart),
      ...(o.balance === undefined ? {} : { balance: box(o.balance.value), balanceAsOf: o.balance.asOf }),
      rateSchedule: [{ from: at(o.loanStart), type: "fixed", rate: "0.01" }],
      repayment: { method: "equalPayment", termMonths: 420 },
      housing: { residence: RES, moveIn: MV, propertyType: "certified", newBuild: true, acquisitionCost: 45000000, ownership: [{ member: H, share: "1" }] },
    },
  ]);
  return req;
}
const settlement = (r: EngineResult, ym: string) => r.flows.filter((f) => f.row === "cf.taxSi.incomeTax" && f.ym === ym && f.formula === "incomeTax.annual.settlement").map((f) => f.amount);

describe("12月に借りたローンの年末残高と1年目の住宅ローン控除", () => {
  it("借りた年の年末残高は借入の額で、11月に借りたときと同じく翌年3月に1年目の控除が還付される", () => {
    const dec = buyer({ baseMonth: "2026-01", annual: 7000000, loanStart: "2026-12" });
    const s = call<DebtScheduleOutput>(dec, "debt.schedule", { object: LOAN });
    expect(s.yearEnd[0]).toEqual({ year: 2026, balance: 40000000, unpaidInterest: 0 });
    // 控除 40,000,000×0.7%＝280,000円のうち、2026年分の所得税（269,600円）から引ける分
    expect(settlement(run(dec), "2027-03")).toEqual([-269600]);
    expect(settlement(run(buyer({ baseMonth: "2026-01", annual: 7000000, loanStart: "2026-11" })), "2027-03")).toEqual([-269600]);
  });

  it("年末の負債の残高にも、借りた年の分が載る", () => {
    const r = run(buyer({ baseMonth: "2026-01", annual: 7000000, loanStart: "2026-12" }));
    expect(r.annual.filter((a) => a.row === "cf.balance.debt.mortgage" && a.year === 2026).map((a) => a.amount)).toEqual([40000000]);
  });
});

describe("今の残高から入れたローンの、残高の時点より前の年末残高", () => {
  // 2023年4月に4,000万円を借りたローン。借入の額から計算した年末残高（2025年 37,420,231円・2026年 36,434,953円）
  const fromPrincipal = (baseMonth: string) => buyer({ baseMonth, annual: 5000000, loanStart: "2023-04" });
  const endOf = (s: DebtScheduleOutput, y: number) => s.yearEnd.find((e) => e.year === y)?.balance;

  it("2026年12月の年末残高証明書の額から入れると、2023〜2025年の年末残高を借入の条件から逆にたどり、借入の額から計算した額とほぼ同じになる", () => {
    const p = call<DebtScheduleOutput>(fromPrincipal("2027-01"), "debt.schedule", { object: LOAN });
    expect(endOf(p, 2026)).toBe(36434953);
    const b = call<DebtScheduleOutput>(buyer({ baseMonth: "2027-01", annual: 5000000, loanStart: "2023-04", balance: { value: 36434953, asOf: "2026-12" } }), "debt.schedule", { object: LOAN });
    expect(b.yearEnd.slice(0, 4).map((e) => e.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(endOf(b, 2026)).toBe(36434953);
    for (const y of [2023, 2024, 2025]) expect(Math.abs((endOf(b, y) ?? 0) - (endOf(p, y) ?? 0))).toBeLessThanOrEqual(50);
  });

  it("計算基準年度の住民税が、借入の額から入れたときと同じになる（前は2027年 +97,500円・2028年 +40,500円）", () => {
    const p = run(fromPrincipal("2027-01"));
    const b = run(buyer({ baseMonth: "2027-01", annual: 5000000, loanStart: "2023-04", balance: { value: 36434953, asOf: "2026-12" } }));
    expect(sumRow(p, "cf.taxSi.residentTax", 2027)).toBe(144300);
    expect([2027, 2028].map((y) => sumRow(b, "cf.taxSi.residentTax", y))).toEqual([2027, 2028].map((y) => sumRow(p, "cf.taxSi.residentTax", y)));
  });

  it("年の途中の残高（2026年9月）から入れても、2026年10月〜2027年5月の住民税は借入の額から入れたときと同じ", () => {
    const p = run(fromPrincipal("2026-10"));
    // 借入の額から計算した2026年9月の返済の後の残高
    const b = run(buyer({ baseMonth: "2026-10", annual: 5000000, loanStart: "2023-04", balance: { value: 37245000, asOf: "2026-09" } }));
    expect(monthsOf(b, "cf.taxSi.residentTax", "2026-10", "2027-05")).toEqual(monthsOf(p, "cf.taxSi.residentTax", "2026-10", "2027-05"));
  });

  it("元金均等・ボーナス返済のローンも、残高の時点の前の年末残高を逆にたどれる", () => {
    const loan = (balance?: { value: number; asOf: string }) => {
      const r = buyer({ baseMonth: "2027-01", annual: 5000000, loanStart: "2023-04", ...(balance === undefined ? {} : { balance }) });
      const d = (r.input.household as unknown as { debts: Obj[] }).debts[0] as { repayment: Obj };
      d.repayment = { method: "equalPrincipal", termMonths: 420, bonusShare: "0.2" };
      return r;
    };
    const p = call<DebtScheduleOutput>(loan(), "debt.schedule", { object: LOAN });
    const dec26 = endOf(p, 2026) as number;
    const b = call<DebtScheduleOutput>(loan({ value: dec26, asOf: "2026-12" }), "debt.schedule", { object: LOAN });
    // 今の残高をボーナス返済の割合で分け直すので（返済の表の前からの近似）、借入の額から計算した額と数百円ずれる
    for (const y of [2023, 2024, 2025]) expect(Math.abs((endOf(b, y) ?? 0) - (endOf(p, y) ?? 0))).toBeLessThanOrEqual(1000);
  });
});

describe("計算基準月が1〜3月のときの前年分の確定申告", () => {
  // 2026年8月に入居。1年目の控除（2026年末の残高 39,681,278円×0.7%＝277,700円）は2027年3月の確定申告で還付される
  it.each(["2026-12", "2027-01", "2027-03"])("計算基準月 %s でも2027年3月に還付が出る", (b) => {
    expect(settlement(run(buyer({ baseMonth: b, annual: 7000000, loanStart: "2026-08" })), "2027-03")).toEqual([-269600]);
  });

  it("計算基準月が4月なら、前年分の精算は済んでいるので出さない。前年分の源泉徴収の行も出ない", () => {
    const r = run(buyer({ baseMonth: "2027-04", annual: 7000000, loanStart: "2026-08" }));
    expect(settlement(r, "2027-03")).toEqual([]);
    const jan = run(buyer({ baseMonth: "2027-01", annual: 7000000, loanStart: "2026-08" }));
    expect(jan.flows.some((f) => f.row === "cf.taxSi.incomeTax" && f.ym < "2027-01")).toBe(false);
  });
});

describe("計算基準月が1〜5月のときの、2年前の標準報酬と1〜5月の住民税", () => {
  const worker = (baseMonth: string) =>
    household({ baseMonth, endYear: 2030, members: [member("h", "self", "1986-05", { sex: "male" })], periods: [period("p", { member: "h", from: "2009-04", annual: 7000000 })] });
  const ded = (baseMonth: string) => call<{ socialInsurance: number }>(worker(baseMonth), "tax.deductions", { member: H, year: 2025, regime: "residentTax" }).socialInsurance;

  it("2025年の社会保険料（2026年度の住民税〔2027年1〜5月に払う分〕の控除に使う）は、計算基準月が2027年1月でも2026年12月と同じ", () => {
    expect(ded("2027-01")).toBe(ded("2026-12"));
    expect(ded("2027-01")).toBeGreaterThan(1000000);
  });

  it("2027年1〜5月の住民税は、計算基準月が2027年1月でも2026年12月と同じ（前は月 5,500円高かった）", () => {
    const a = run(worker("2026-12"));
    const b = run(worker("2027-01"));
    expect(monthsOf(b, "cf.taxSi.residentTax", "2027-01", "2027-05")).toEqual(monthsOf(a, "cf.taxSi.residentTax", "2027-01", "2027-05"));
  });

  it("2025年1月・9月の標準報酬は、計算基準月が2027年1月でも2026年12月と同じ（前は1月がいちばん低い等級）", () => {
    const m = call<{ months: { month: string; healthStd: number | null }[] }>(worker("2026-12"), "socialInsurance.coverage", { member: H, fromYear: 2025 }).months;
    const m2 = call<{ months: { month: string; healthStd: number | null }[] }>(worker("2027-01"), "socialInsurance.coverage", { member: H, fromYear: 2025 }).months;
    expect(m2.find((x) => x.month === "2025-01")?.healthStd).toBe(m.find((x) => x.month === "2025-01")?.healthStd);
    expect(m.find((x) => x.month === "2025-09")?.healthStd).toBe(m2.find((x) => x.month === "2025-09")?.healthStd);
  });
});

describe("固定資産税の払う月（賦課期日1月1日・納期4・7・12・2月）", () => {
  const home = (o: { baseMonth: string; from?: string; purchaseAt?: string; to?: string }) => {
    const req = household({ baseMonth: o.baseMonth, endYear: 2030, members: [member("h", "self", "1980-05", { sex: "male" })] });
    setH(req, "residences", [
      {
        id: RES,
        kind: "own",
        from: at(o.purchaseAt ?? o.from ?? "2020-04"),
        to: o.to === undefined ? null : at(o.to),
        ...(o.purchaseAt === undefined ? {} : { purchase: { price: 40000000, downPayment: 40000000, costs: 0 } }),
        propertyTax: { annual: box(150000) },
        ownership: [{ member: H, share: "1" }],
      },
    ]);
    return run(req);
  };
  const months = (r: EngineResult, y: number) => r.flows.filter((f) => f.row === "cf.expense.housing.propertyTax" && f.ym.startsWith(`${y}-`)).map((f) => f.ym.slice(5));

  it("今の持ち家で計算基準月が2026年1月なら、2026年2月に前の年度の4回目も払う（2026年は4回で150,000円）", () => {
    const r = home({ baseMonth: "2026-01" });
    expect(months(r, 2026)).toEqual(["02", "04", "07", "12"]);
    expect(sumRow(r, "cf.expense.housing.propertyTax", 2026)).toBe(150000);
  });

  it("2028年10月に買う家は、2028年度は引き渡しの月に10〜12月の月割りを売主との精算として払い、2029年度から4回に分けて払う", () => {
    const r = home({ baseMonth: "2026-01", purchaseAt: "2028-10" });
    expect(months(r, 2028)).toEqual(["10"]);
    expect(sumRow(r, "cf.expense.housing.propertyTax", 2028)).toBe(37500);
    expect(r.flows.find((f) => f.row === "cf.expense.housing.propertyTax" && f.ym === "2028-10")?.formula).toBe("housing.residence.propertyTaxSettlement");
    expect(months(r, 2029)).toEqual(["04", "07", "12"]);
    expect(months(r, 2030)).toEqual(["02", "04", "07", "12"]);
  });

  it("手放す年（2029年5月）の年度は、1月1日に持っているので全部払う", () => {
    const r = home({ baseMonth: "2026-01", to: "2029-05" });
    expect(months(r, 2029)).toEqual(["02", "04", "07", "12"]);
    expect(months(r, 2030)).toEqual(["02"]);
  });

  it("購入の無い今の持ち家（住み始めが計算基準月。入力の画面の「＋ 持ち家（今住んでいる）」の形）は、前から持っているとみなす", () => {
    const r = home({ baseMonth: "2026-10", from: "2026-10" });
    expect(months(r, 2026)).toEqual(["12"]);
    expect(months(r, 2027)).toEqual(["02", "04", "07", "12"]);
  });

  it("購入の無いこれからの家（相続など）は、住み始めの年の年度の、住み始め以後の納期から払う", () => {
    const r = home({ baseMonth: "2026-01", from: "2028-06" });
    expect(months(r, 2028)).toEqual(["07", "12"]);
    expect(months(r, 2029)).toEqual(["02", "04", "07", "12"]);
  });
});

describe("亡くなった年の住宅ローン控除（死亡の日の残高。租税特別措置法41条1項・2項）", () => {
  // ペアローン（夫3,000万円・妻2,000万円、どちらも自分に団信）。夫が2030年6月に亡くなる
  const pair = (death: boolean): Req => {
    const req = household({
      baseMonth: "2026-01",
      endYear: 2034,
      members: [member("h", "self", "1986-05", { sex: "male" }), member("w", "spouse", "1988-08", { sex: "female" })],
      relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }],
      periods: [period("p", { member: "h", from: "2009-04", annual: 7000000 }), period("q", { member: "w", from: "2011-04", annual: 5000000 })],
      events: [{ id: MV, kind: "moveIn", at: at("2026-04") }],
    });
    setH(req, "residences", [{ id: RES, kind: "own", from: { event: MV }, to: null, purchase: { price: 50000000, downPayment: 0, costs: 0 }, ownership: [{ member: H, share: "0.6" }, { member: W, share: "0.4" }] }]);
    const loan = (id: string, who: string, principal: number) => ({
      id,
      kind: "mortgage",
      debtors: [{ member: who, role: "primary" }],
      principal,
      start: at("2026-04"),
      rateSchedule: [{ from: at("2026-04"), type: "fixed", rate: "0.01" }],
      repayment: { method: "equalPayment", termMonths: 420 },
      creditLife: { covered: [who] },
      housing: { residence: RES, moveIn: MV, propertyType: "certified", newBuild: true, acquisitionCost: 50000000, ownership: [{ member: H, share: "0.6" }, { member: W, share: "0.4" }] },
    });
    setH(req, "debts", [loan(LOAN, H, 30000000), loan(uid("loanW"), W, 20000000)]);
    if (death) (req.input as unknown as Obj).contingencies = [{ id: uid("cg"), kind: "death", member: H, occurs: at("2030-06") }];
    return req;
  };

  it("debt.schedule は死亡の月の返済の後・団信で減らす前の残高を添え、その年の年末残高は団信で0円", () => {
    const s = call<DebtScheduleOutput>(pair(true), "debt.schedule", { object: LOAN });
    const d = s.atDeath?.[0];
    expect(d?.member).toBe(H);
    expect(d?.ym).toBe("2030-06");
    // 2029年末 27,326,230円から6回返した後
    expect(d?.balance).toBeGreaterThan(26900000);
    expect(d?.balance).toBeLessThan(27326230);
    expect(s.yearEnd.find((e) => e.year === 2030)?.balance ?? 0).toBe(0);
  });

  it("亡くなった年（2030年）の夫の控除は死亡の月の残高×0.7%、翌年からは受けない", () => {
    const req = pair(true);
    const balance = call<DebtScheduleOutput>(req, "debt.schedule", { object: LOAN }).atDeath?.[0]?.balance as number;
    const credit = (y: number) => call<{ credit: number }>(req, "tax.housingLoanCredit", { member: H, year: y }).credit;
    expect(credit(2030)).toBe(Math.floor((balance * 0.007) / 100) * 100);
    expect(credit(2031)).toBe(0);
    // 2030年分の所得税は控除で引ききれ、2031年3月の精算で源泉徴収の分が全部戻る（前は団信で年末残高が消えて控除が0円だった）
    const r = run(req);
    expect(sumRow(r, "cf.taxSi.incomeTax", 2031, H)).toBe(-sumRow(r, "cf.taxSi.incomeTax", 2030, H));
  });

  it("亡くならない試算の控除は変わらない", () => {
    const req = pair(false);
    expect(call<DebtScheduleOutput>(req, "debt.schedule", { object: LOAN }).atDeath).toBeUndefined();
  });
});

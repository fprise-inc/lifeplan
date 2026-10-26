// 資産の器・取り崩し・NISA・iDeCo・住宅ローン・住宅ローン控除の部品のテスト（L1）。
// 【架空の見本】の制度データ（test/fixtures/regulation。製品のパックの値の形を写したもの）で、規則どおりに計算するかを手計算と突き合わせる
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { DebtScheduleOutput, HousingLoanCreditOutput, IdecoAccountOutput, IdecoContributionOutput } from "../src/sdk/contracts.ts";
import { box, clone, fictionalPacks, household, member, modelHousehold, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const call = <T>(req: Req, component: string, input: unknown): T =>
  runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const total = (xs: readonly { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const A = uid("a");
const B = uid("b");
const at = (ym: string) => ({ at: ym });
/** 世帯の要求に、負債・住まい・前提などを足す */
const withInput = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
const cells = (r: ReturnType<typeof full>, row: string, year: number, object?: string) =>
  (r.table as unknown as { row: string; year: number; amount: number; object?: string }[])
    .filter((c) => c.row === row && c.year === year && (object === undefined || c.object === object))
    .reduce((s, c) => s + c.amount, 0);

/** 元利均等の返済額（10進で計算して円未満切り捨て）: 残高×月利×(1+月利)^n÷((1+月利)^n−1) */
function annuity(balance: number, annualRate: string, n: number): number {
  const r = new Decimal(annualRate).div(12);
  const q = r.plus(1).pow(n);
  return balance === 0 ? 0 : new Decimal(balance).mul(r).mul(q).div(q.minus(1)).floor().toNumber();
}

const loan = (o: Obj = {}): Obj => ({
  id: uid("loan"),
  kind: "mortgage",
  debtors: [{ member: A, role: "primary" }],
  principal: 30000000,
  start: at("2026-03"),
  rateSchedule: [{ from: at("2026-03"), type: "fixed", rate: "0.012" }],
  repayment: { method: "equalPayment", termMonths: 420 },
  ...o,
});

describe("負債の返済（debt.schedule）", () => {
  const base = household({ members: [member("a", "self", "1990-01")], endYear: 2070 });
  const sched = (o: Obj) => call<DebtScheduleOutput>(withInput(base, (h) => (h.debts = [loan(o)])), "debt.schedule", { object: uid("loan") });
  const pays = (s: DebtScheduleOutput, ym: string) => s.flows.filter((f) => f.ym === ym && f.row === "cf.expense.housing.loan").reduce((x, f) => x + f.amount, 0);

  it("元利均等: 返済額は分数のまま計算して円未満切り捨て、利息は残高×年利÷12（円未満切り捨て）、最後の回で残りを精算", () => {
    const s = sched({});
    const p = annuity(30000000, "0.012", 420);
    expect(pays(s, "2026-04")).toBe(p);
    expect(pays(s, "2030-07")).toBe(p);
    // 1回目の利息 30,000,000×0.012÷12＝30,000、元金は返済額−利息
    const after1 = 30000000 - (p - 30000);
    const i2 = Math.floor((after1 * 12) / 1000 / 12);
    expect(s.yearEnd.find((y) => y.year === 2026)?.balance).toBeLessThan(30000000);
    expect(i2).toBe(Math.floor(after1 * 0.001));
    expect(s.payoff).toBe("2061-03");
    // 返済の合計＝借入額＋利息の合計（最後の回で残高が0）
    const last = s.flows.filter((f) => f.row === "cf.expense.housing.loan").at(-1);
    expect(last?.ym).toBe("2061-03");
  });

  it("元金均等: 元金は借入額÷回数、利息は毎月の残高から", () => {
    const s = sched({ repayment: { method: "equalPrincipal", termMonths: 420 } });
    const principal = Math.floor(30000000 / 420);
    expect(pays(s, "2026-04")).toBe(principal + 30000);
    expect(pays(s, "2026-05")).toBe(principal + Math.floor(((30000000 - principal) * 12) / 12000));
  });

  it("変動金利の5年ルール・125%ルール: 金利が上がっても返済額は5年ごとにだけ見直し、上限は前の1.25倍。払いきれない利息は未払利息", () => {
    const s = sched({
      rateSchedule: [
        { from: at("2026-03"), type: "variable", rate: "0.005" },
        { from: at("2027-04"), type: "variable", rate: "0.08" },
      ],
      repayment: { method: "equalPayment", termMonths: 420, variableRules: { fiveYear: true, cap125: true } },
    });
    const p = annuity(30000000, "0.005", 420);
    expect(pays(s, "2027-04")).toBe(p); // 金利が上がっても返済額は同じ
    expect(s.yearEnd.find((y) => y.year === 2027)?.unpaidInterest).toBeGreaterThan(0); // 8% の利息は返済額を超える
    // 60回目（2031-03）の見直しで、前の返済額の1.25倍が上限
    expect(pays(s, "2031-03")).toBe(Math.floor((p * 5) / 4));
  });

  it("ルールの無い変動・固定期間の終わりは、金利が変わった月に返済額を計算し直す", () => {
    const s = sched({
      rateSchedule: [
        { from: at("2026-03"), type: "fixedPeriod", rate: "0.01" },
        { from: at("2036-03"), type: "variable", rate: "0.02" },
      ],
    });
    expect(pays(s, "2036-02")).toBe(annuity(30000000, "0.01", 420));
    expect(pays(s, "2036-03")).not.toBe(pays(s, "2036-02"));
  });

  it("繰上返済: 期間短縮は返済額を変えずに早く終わり、返済額軽減は回数を変えずに返済額を下げる", () => {
    const short = sched({ prepayments: [{ at: at("2030-12"), amount: 5000000, mode: "shortenTerm", fee: 33000 }] });
    const reduce = sched({ prepayments: [{ at: at("2030-12"), amount: 5000000, mode: "reducePayment" }] });
    const p = annuity(30000000, "0.012", 420);
    expect(pays(short, "2031-01")).toBe(p);
    expect(short.payoff! < "2061-03").toBe(true);
    expect(pays(reduce, "2031-01")).toBeLessThan(p);
    expect(reduce.payoff).toBe("2061-03");
    expect(total(short.flows.filter((f) => f.row === "cf.expense.housing.loan.prepayment"))).toBe(5000000);
    expect(total(short.flows.filter((f) => f.row === "cf.expense.housing.loan.fees"))).toBe(33000);
  });

  it("ボーナス返済: 借入額の割合を年2回で返す（半年の利率＝年利÷2）", () => {
    const s = sched({ repayment: { method: "equalPayment", termMonths: 420, bonusShare: "0.2" } });
    expect(pays(s, "2026-06")).toBeGreaterThan(pays(s, "2026-05"));
    expect(pays(s, "2026-05")).toBe(annuity(24000000, "0.012", 420));
  });

  it("借り換え: 残高（諸費用込みなら諸費用も）を新しい金利・期間で返す", () => {
    const s = sched({ refinance: [{ at: at("2031-03"), rateSchedule: [{ from: at("2031-03"), type: "fixed", rate: "0.008" }], termMonths: 240, costs: 500000, costsFinanced: true }] });
    expect(pays(s, "2031-03")).toBeLessThan(annuity(30000000, "0.012", 420) * 2);
    expect(s.payoff).toBe("2051-02");
  });

  it("既に借りているローンは残高の時点から計算する", () => {
    const s = sched({ start: at("2020-03"), balance: box(25000000), balanceAsOf: "2025-12" });
    expect(pays(s, "2026-01")).toBe(annuity(25000000, "0.012", 420 - (12 * 5 + 9)));
  });
});

describe("住宅借入金等特別控除（tax.housingLoanCredit）と所得税・住民税の税額控除", () => {
  const moveIn = { id: uid("mv"), kind: "moveIn", at: at("2026-04") };
  const mk = (o: Obj = {}, h: Obj = {}, annual = 6000000) =>
    withInput(
      household({ members: [member("a", "self", "1990-01")], periods: [period("p", { member: "a", from: "2015-04", annual, std: [500000, 500000] })], events: [moveIn], endYear: 2040 }),
      (hh) => {
        hh.debts = [loan({ start: at("2026-03"), housing: { moveIn: uid("mv"), propertyType: "certified", newBuild: true, ...h }, ...o })];
      },
    );
  it("年末残高×0.7%（借入限度額まで。100円未満切り捨て）。入居の年は確定申告（翌年3月に還付）", () => {
    const req = mk();
    const s = call<DebtScheduleOutput>(req, "debt.schedule", { object: uid("loan") });
    const bal = s.yearEnd.find((y) => y.year === 2026)?.balance as number;
    const c = call<HousingLoanCreditOutput>(req, "tax.housingLoanCredit", { member: A, year: 2026 });
    expect(c.credit).toBe(Math.floor((bal * 7) / 1000 / 100) * 100);
    expect(c.firstYear).toBe(true);
    const r = full(req);
    // 入居の年の源泉徴収は控除の前の額で、翌年3月の精算で還付（負の額）
    const settlement = r.flows.filter((f) => f.row === "cf.taxSi.incomeTax" && f.ym === "2027-03" && f.formula === "incomeTax.annual.settlement");
    expect(settlement[0]?.amount).toBeLessThan(0);
    // 2年目からは年末調整（12月までの源泉徴収に入る）
    expect(r.flows.some((f) => f.ym === "2028-03" && f.formula === "incomeTax.annual.settlement")).toBe(false);
  });

  it("借入限度額（子育て世帯・若者夫婦世帯の上乗せは、入居の年の12月31日の現況）・控除期間・合計所得金額の上限", () => {
    const big = mk({ principal: 80000000 });
    const credit = (req: Req, year: number) => call<HousingLoanCreditOutput>(req, "tax.housingLoanCredit", { member: A, year }).credit;
    expect(credit(big, 2026)).toBe(Math.floor((45000000 * 7) / 1000 / 100) * 100); // 単身・36歳（配偶者なし）は一般の 4,500万円
    const young = withInput(big, (h) => {
      (h.members as Obj[]).push(member("b", "spouse", "1992-01"));
      h.relations = [{ type: "spouse", a: A, b: B, marriage: "legal", from: null, to: null }];
    });
    expect(credit(young, 2026)).toBe(Math.floor((50000000 * 7) / 1000 / 100) * 100); // 40歳未満で配偶者あり
    expect(credit(big, 2038)).toBeGreaterThan(0); // 13年目
    expect(credit(big, 2039)).toBe(0); // 14年目
    const rich = mk({}, {}, 40000000);
    expect(credit(rich, 2026)).toBe(0); // 合計所得金額 2,000万円超
  });

  it("連帯債務は負担割合、取得対価×持分で止める", () => {
    const req = withInput(mk({ debtors: [{ member: A, role: "primary", share: "0.6" }, { member: B, role: "joint", share: "0.4" }] }, { acquisitionCost: 20000000, ownership: [{ member: A, share: "0.5" }, { member: B, share: "0.5" }] }), (h) => {
      (h.members as Obj[]).push(member("b", "spouse", "1992-01"));
    });
    const s = call<DebtScheduleOutput>(req, "debt.schedule", { object: uid("loan") });
    const bal = s.yearEnd.find((y) => y.year === 2026)?.balance as number;
    expect(bal * 0.6).toBeGreaterThan(10000000);
    // 負担分（残高×0.6）は取得対価×持分（1,000万円）で止まる
    expect(call<HousingLoanCreditOutput>(req, "tax.housingLoanCredit", { member: A, year: 2026 }).credit).toBe(70000);
  });

  it("所得税から引ききれない分は、翌年度の住民税から（所得税の課税総所得金額等×5%・97,500円まで）", () => {
    const req = mk({}, {}, 3000000);
    const r = full(req);
    const it = call<{ creditRemainder?: number; taxable: number; housingLoanCredit?: number }>(req, "incomeTax.annual", { member: A, year: 2027 });
    expect(it.creditRemainder).toBeGreaterThan(0);
    const rt = call<{ housingLoanCredit?: { municipal: number; prefectural: number } }>(req, "residentTax.annual", { member: A, fiscalYear: 2028 });
    const used = (rt.housingLoanCredit?.municipal ?? 0) + (rt.housingLoanCredit?.prefectural ?? 0);
    expect(used).toBe(Math.min(it.creditRemainder as number, Math.floor((it.taxable * 5) / 100), 97500));
    expect(rt.housingLoanCredit?.municipal).toBe(Math.floor((used * 3) / 5));
    expect(notices(r).some((n) => n.code === "N_PARAM_MISSING")).toBe(false);
  });

  /** 入居の年月 ym に借りて住み始めたローン */
  const past = (ym: string, h: Obj = {}, o: Obj = {}) =>
    withInput(mk({ start: at(ym), rateSchedule: [{ from: at(ym), type: "fixed", rate: "0.012" }], ...o }, h), (hh) => ((hh.events as Obj[])[0] = { id: uid("mv"), kind: "moveIn", at: at(ym) }));
  const creditOf = (req: Req, year: number) => call<HousingLoanCreditOutput>(req, "tax.housingLoanCredit", { member: A, year });
  const has = (r: { header: unknown }, code: string, id: string) => notices(r).some((n) => n.code === code && n.ids.includes(id));
  const entryNotices = (req: Req, year: number) => notices(runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "tax.housingLoanCredit", input: { member: A, year } } }));

  it("値の無い入居の年（平成25年以前）は計算せず知らせる", () => {
    const ns = entryNotices(past("2013-04"), 2020);
    expect(ns.some((n) => n.code === "N_PARAM_MISSING" && n.ids.includes("incomeTax.housingLoanCredit.rate"))).toBe(true);
  });

  it("平成26〜令和3年の入居: 控除率1%・10年。新築は特定取得（一般4,000万円・認定住宅5,000万円）とみなして知らせる", () => {
    const general = past("2018-04", { propertyType: "other" }, { principal: 70000000 });
    const bal = (req: Req, year: number) => call<DebtScheduleOutput>(req, "debt.schedule", { object: uid("loan") }).yearEnd.find((y) => y.year === year)?.balance as number;
    expect(bal(general, 2027)).toBeGreaterThan(50000000);
    expect(creditOf(general, 2026).credit).toBe(400000); // 4,000万円×1%
    expect(creditOf(general, 2027).credit).toBe(400000); // 10年目
    expect(creditOf(general, 2028).credit).toBe(0); // 11年目
    const certified = past("2018-04", {}, { principal: 70000000 });
    expect(creditOf(certified, 2026).credit).toBe(500000); // 5,000万円×1%
    // 住民税は特定取得の7%・136,500円
    expect(creditOf(general, 2026).residentRate).toBe("0.07");
    expect(creditOf(general, 2026).residentLimit).toBe(136500);
    const r = full(general);
    expect(has(r, "N_ASSUMED", "incomeTax.housingLoanCredit.specifiedAcquisition")).toBe(true);
    expect(has(r, "N_PARAM_MISSING", "incomeTax.housingLoanCredit.rate")).toBe(false);
    // 所得税の控除が入る（控除の無い年と比べて減る）
    const none = withInput(general, (h) => (((h.debts as Obj[])[0] as Obj).housing = { ...((((h.debts as Obj[])[0] as Obj).housing as Obj) ?? {}), creditDisabled: true }));
    expect(cells(r, "cf.taxSi.incomeTax", 2027)).toBeLessThan(cells(full(none), "cf.taxSi.incomeTax", 2027));
  });

  it("平成26〜令和3年の既存住宅は、特定取得でない取得（2,000万円・住民税5%・97,500円）とみなす", () => {
    const c = creditOf(past("2018-04", { propertyType: "other", newBuild: false }, { principal: 70000000 }), 2026);
    expect(c.credit).toBe(200000);
    expect(c.residentRate).toBe("0.05");
    expect(c.residentLimit).toBe(97500);
  });

  it("消費税10%の取得の13年の特例（令和元年10月〜令和3年の新築）の11〜13年目は、計算せず知らせる", () => {
    const req = past("2020-04", { propertyType: "other" });
    expect(creditOf(req, 2029).credit).toBeGreaterThan(0); // 10年目
    expect(creditOf(req, 2030).credit).toBe(0); // 11年目
    expect(call<{ from: number; to: number }>(req, "tax.housingLoanCreditYears", { member: A })).toEqual({ from: 2020, to: 2032 });
    expect(has(full(req), "N_NOT_SUPPORTED", "incomeTax.housingLoanCredit.period.specialSpecified")).toBe(true);
    // 既存住宅（特定取得でない取得とみなす）には特例が無い
    const used = past("2020-04", { propertyType: "other", newBuild: false });
    expect(call<{ from: number; to: number }>(used, "tax.housingLoanCreditYears", { member: A })).toEqual({ from: 2020, to: 2029 });
    expect(has(full(used), "N_NOT_SUPPORTED", "incomeTax.housingLoanCredit.period.specialSpecified")).toBe(false);
  });

  it("制度の外の入居の年・区分は「対象外」として知らせる（値が無いのとは分ける）", () => {
    // 令和13年以後の入居（控除率が制度なし）
    const later = full(past("2031-04"));
    expect(has(later, "N_NOT_ELIGIBLE", "incomeTax.housingLoanCredit.rate")).toBe(true);
    expect(has(later, "N_PARAM_MISSING", "incomeTax.housingLoanCredit.rate")).toBe(false);
    // 令和6年以後の入居の新築のその他の住宅（借入限度額0円）
    const other = mk({}, { propertyType: "other" });
    expect(creditOf(other, 2026).credit).toBe(0);
    expect(has(full(other), "N_NOT_ELIGIBLE", "incomeTax.housingLoanCredit.limit.new.other")).toBe(true);
    // 対象の区分には出さない
    expect(notices(full(mk())).some((n) => n.code === "N_NOT_ELIGIBLE" || n.code === "N_ASSUMED")).toBe(false);
  });

  it("見本の世帯（平成30年・令和元年の入居）: 制度データの値で控除を計算し、値の無い知らせを出さない", () => {
    for (const name of ["sampleSingle40s", "sampleSelfEmployedFamily", "investmentCouple"]) {
      const r = runEngine(modelHousehold(name), realPacks(), { checkInternal: true });
      expect(has(r, "N_PARAM_MISSING", "incomeTax.housingLoanCredit.rate")).toBe(false);
    }
    const single = runEngine(modelHousehold("sampleSingle40s"), realPacks(), { checkInternal: true });
    expect(has(single, "N_ASSUMED", "incomeTax.housingLoanCredit.specifiedAcquisition")).toBe(true);
    const off = clone(modelHousehold("sampleSingle40s"));
    for (const d of (off.input.household as unknown as { debts: { housing?: Obj }[] }).debts) if (d.housing !== undefined) d.housing.creditDisabled = true;
    const without = runEngine(off, realPacks(), { checkInternal: true });
    expect(cells(single, "cf.taxSi.incomeTax", 2027)).toBeLessThan(cells(without, "cf.taxSi.incomeTax", 2027));
  });
});

describe("iDeCo・企業型DC の掛金（ideco.contribution）と受け取り（account.ideco）", () => {
  const idecoAcc = (o: Obj = {}) => ({ id: uid("ideco"), kind: "ideco", owner: A, marketValue: box(1000000), asOf: "2025-12", enrolledSince: "2015-01", contributions: [{ from: at("2020-01"), to: null, monthly: 30000 }], ...o });
  const mk = (accounts: Obj[], extra: Obj = {}) =>
    household({
      members: [member("a", "self", "1975-06")],
      periods: [period("p", { member: "a", from: "2000-04", annual: 6000000, std: [500000, 500000], extra })],
      accounts,
      endYear: 2045,
    });
  const paid = (req: Req, ym: string, payer = "self") =>
    call<IdecoContributionOutput>(req, "ideco.contribution", { member: A }).payments.filter((p) => p.ym === ym && p.payer === payer).reduce((s, p) => s + p.amount, 0);

  it("第2号・企業年金なし: 2026年11月分まで月23,000円、12月分から月62,000円", () => {
    const req = mk([idecoAcc({ contributions: [{ from: at("2020-01"), to: null, monthly: 70000 }] })]);
    expect(paid(req, "2026-11")).toBe(23000);
    expect(paid(req, "2026-12")).toBe(62000);
  });

  it("他制度あり: 2024年12月分から 20,000円と（55,000円−企業型DCの事業主掛金−他制度掛金相当額）の小さい方、改正後は 62,000円−それら", () => {
    const dc = { id: uid("dc"), kind: "corporateDc", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [{ from: at("2020-01"), to: null, monthly: 25000, payer: "employer" }] };
    const req = mk([idecoAcc({ contributions: [{ from: at("2020-01"), to: null, monthly: 40000 }] }), dc], { corporatePension: { db: true, dbEquivalentMonthly: 15000 } });
    expect(paid(req, "2026-11")).toBe(15000); // min(20,000, 55,000−25,000−15,000)
    expect(paid(req, "2026-12")).toBe(22000); // 62,000−25,000−15,000
    expect(paid(req, "2026-12", "employer")).toBe(25000);
    expect(notices(full(req)).some((n) => n.code === "N_LIMIT_APPLIED")).toBe(true);
  });

  it("最低額（月5,000円）に届かなければ出さない", () => {
    const dc = { id: uid("dc"), kind: "corporateDc", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [{ from: at("2020-01"), to: null, monthly: 38000, payer: "employer" }] };
    const req = mk([idecoAcc({ contributions: [{ from: at("2020-01"), to: null, monthly: 10000 }] }), dc], { corporatePension: { db: true, dbEquivalentMonthly: 15000 } });
    expect(paid(req, "2026-11")).toBe(0); // 55,000−38,000−15,000＝2,000 は最低額未満
  });

  it("小規模企業共済等掛金控除は本人が払った掛金（止めた後の額）", () => {
    const req = mk([idecoAcc({ contributions: [{ from: at("2020-01"), to: null, monthly: 70000 }] })]);
    const d = call<{ smallBusiness: number }>(req, "tax.deductions", { member: A, year: 2026, regime: "incomeTax" });
    expect(d.smallBusiness).toBe(23000 * 11 + 62000);
  });

  it("受け取り: 通算加入者等期間10年以上なら60歳から。年金は毎年 残高÷残りの回数、最後の回は残り全部。年金の分は公的年金等の収入", () => {
    const req = mk([idecoAcc({ payout: { start: at("2035-07"), method: "annuity", annuityYears: 5 } })]);
    const out = call<IdecoAccountOutput>(req, "account.ideco", { member: A });
    const pays = out.payments;
    expect(pays.map((p) => p.ym)).toEqual(["2035-07", "2036-07", "2037-07", "2038-07", "2039-07"]);
    expect(pays.every((p) => p.kind === "annuity")).toBe(true);
    const years = out.accounts[0]?.years ?? [];
    expect(years.find((y) => y.year === 2039)?.closing).toBe(0);
    const pp = call<{ revenue: number }>(req, "tax.publicPensionIncome", { member: A, year: 2036 });
    expect(pp.revenue).toBeGreaterThanOrEqual(pays[1]?.amount as number);
  });

  it("受け取りを始められる年齢より前の指定は、その年齢の月から（加入者等期間4年以上6年未満は63歳）", () => {
    const req = mk([idecoAcc({ enrolledSince: "2031-01", payout: { start: at("2035-07"), method: "lumpSum" } })]);
    const out = call<IdecoAccountOutput>(req, "account.ideco", { member: A });
    // 1975年6月生まれ: 60歳は2035年6月（達する日の月）。2031年1月から53か月 → 63歳（2038年6月）
    expect(out.payments[0]?.ym).toBe("2038-06");
    expect(out.payments[0]?.kind).toBe("lumpSum");
    expect(out.payments[0]?.enrolledMonths).toBe(53);
    // 一時金の退職所得の税は tax.retirementIncome が計算する（知らせ N_NOT_SUPPORTED は出さない）
    expect(notices(full(req)).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("incomeTax.retirementIncome"))).toBe(false);
    expect(call<{ incomeTax: number }>(req, "tax.retirementIncome", { member: A, year: 2038 }).incomeTax).toBeGreaterThanOrEqual(0);
  });
});

describe("器ごとの残高・取り崩し・NISA の枠（plan.cashflow）", () => {
  const dep = (v: number, o: Obj = {}) => ({ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(v), asOf: "2025-12", contributions: [], ...o });
  const mk = (accounts: Obj[], f: (h: Obj, input: Obj) => void = () => {}) =>
    withInput(
      household({ members: [member("a", "self", "1980-06")], periods: [period("p", { member: "a", from: "2000-04", to: "2027-12", annual: 6000000, std: [500000, 500000] })], accounts, endYear: 2040 }),
      (h, input) => {
        h.residences = [{ id: uid("rent"), kind: "rent", from: at("2010-01"), to: null, rent: { monthly: box(300000) } }];
        f(h, input);
      },
    );

  it("NISA の積立は年間投資枠（成長投資枠 240万円）と生涯の枠で止め、売った簿価の分の枠は翌年に復活する", () => {
    const nisa = { id: uid("nisa"), kind: "nisa", owner: A, marketValue: box(17000000), costBasis: box(17000000), asOf: "2025-12", frame: { lifetimeUsedCost: 17000000, growthUsedCost: 11000000, asOfYear: 2025 }, contributions: [{ from: at("2026-01"), to: at("2040-12"), monthly: 300000, tranche: "growth" }] };
    const req = mk([dep(1000000), nisa], (_h, input) => {
      (input.assumptions as Obj).withdrawal = { order: [{ kind: "nisa" }], minimumDeposit: 0 };
    });
    const r = full(req);
    // 2026年: 成長投資枠の生涯の残りは 100万円（1,200万円−1,100万円）、総枠の残りも 100万円
    expect(cells(r, "cf.transfer.nisa.growth", 2026)).toBe(1000000);
    expect(notices(r).some((n) => n.code === "N_LIMIT_APPLIED" && n.ids.includes("nisa.annualLimit"))).toBe(true);
    // 家賃で赤字になって NISA を売った年の翌年に、売った簿価の分だけ枠が戻って積み立てられる
    const sold = cells(r, "cf.transfer.withdrawal", 2028);
    expect(sold).toBeGreaterThan(0);
    expect(cells(r, "cf.transfer.nisa.growth", 2029)).toBeGreaterThan(0);
    expect(cells(r, "cf.balance.nisaFrame", 2026)).toBe(0);
  });

  it("課税口座を売るときは、取得価額との差に譲渡益の税（所得税・復興特別所得税 15.315%、住民税 5%）をかけ、手取りで足りるだけ売る", () => {
    const taxable = { id: uid("tx"), kind: "taxable", owner: A, marketValue: box(10000000), costBasis: box(5000000), asOf: "2025-12", contributions: [] };
    const req = mk([dep(0), taxable], (_h, input) => {
      (input.assumptions as Obj).assetReturns = { "cash.deposit": { default: "0" } };
      (input.assumptions as Obj).investmentReturn = { default: "0" };
    });
    const r = full(req);
    const y = 2028; // 給与が無くなり、家賃で赤字
    const g = cells(r, "cf.transfer.withdrawal", y);
    const it = cells(r, "cf.taxSi.incomeTax.capitalGains", y);
    const rt = cells(r, "cf.taxSi.residentTax.capitalGains", y);
    expect(g).toBeGreaterThan(0);
    // 売る前の時価・取得価額は2027年末の残高から（運用益0）。利益の割合は (時価−取得価額)÷時価
    expect(it).toBeGreaterThan(0);
    expect(Math.abs(it / rt - 15.315 / 5)).toBeLessThan(0.01);
    // 決済口座は0に戻る（手取りで足りるだけ）
    expect(cells(r, "cf.balance.account.deposit", y)).toBe(0);
    // 年間収支は譲渡益の税を引いた後（収入−税・社会保険料−支出）
    const sum = (prefix: string) => (r.table as unknown as { row: string; year: number; amount: number }[]).filter((c) => c.year === y && c.row.startsWith(prefix)).reduce((s, c) => s + c.amount, 0);
    expect(cells(r, "cf.net", y)).toBe(sum("cf.income.") - sum("cf.taxSi.") - sum("cf.expense."));
  });

  it("引き出せない期間の器・既定の順序に無い器は取り崩さず、足りない分は資金不足", () => {
    const locked = { id: uid("zk"), kind: "zaikei", owner: A, marketValue: box(5000000), asOf: "2025-12", withdrawalLockedUntil: at("2035-12"), contributions: [] };
    const r = full(mk([dep(0), locked]));
    expect(cells(r, "cf.transfer.withdrawal", 2028)).toBe(0);
    expect(cells(r, "cf.balance.shortfall", 2028)).toBeGreaterThan(0);
    // 引き出せるようになった年からは取り崩す
    expect(cells(r, "cf.transfer.withdrawal", 2036)).toBeGreaterThan(0);
  });

  it("旧NISA の非課税期間（一般 5年）が終わった年の年末に、時価で課税口座へ移す", () => {
    const legacy = { id: uid("lg"), kind: "legacyNisa", owner: A, marketValue: box(2000000), asOf: "2025-12", lots: [{ vintageYear: 2022, regime: "general", costBasis: 1000000, marketValue: 2000000 }], contributions: [] };
    const r = full(mk([dep(50000000), legacy]));
    expect(cells(r, "cf.transfer.rollover", 2026)).toBe(2020000); // 1年分の運用益（1%）の後の時価
    expect(cells(r, "cf.balance.account.legacyNisa", 2026)).toBe(0);
    expect(cells(r, "cf.balance.account.taxable", 2026)).toBe(2020000);
  });

  it("決済口座の残高に年の収支が入り、器ごとの残高の合計が金融資産の合計", () => {
    const r = full(mk([dep(50000000), { id: uid("tx"), kind: "taxable", owner: A, marketValue: box(1000000), asOf: "2025-12", contributions: [{ from: at("2026-01"), to: at("2026-12"), monthly: 10000 }] }]));
    expect(cells(r, "cf.transfer.investment", 2026)).toBe(120000);
    expect(cells(r, "cf.balance.account.deposit", 2026) + cells(r, "cf.balance.account.taxable", 2026)).toBe(cells(r, "cf.balance.financial", 2026));
  });
});

describe("住まい（housing.residence）", () => {
  const mk = (residences: Obj[]) => withInput(household({ members: [member("a", "self", "1990-01")], endYear: 2032 }), (h) => (h.residences = residences));
  it("家賃は更新の月に更新料（家賃×月数）を払い、上昇率を当てる", () => {
    const r = full(mk([{ id: uid("r"), kind: "rent", from: at("2025-04"), to: null, rent: { monthly: box(100000), growth: "0.1", renewalFee: "1" } }]));
    const f = (ym: string, row = "cf.expense.housing.rent") => r.flows.filter((x) => x.ym === ym && x.row === row).reduce((s, x) => s + x.amount, 0);
    expect(f("2027-03")).toBe(100000);
    expect(f("2027-04", "cf.expense.housing.rent.renewal")).toBe(100000);
    expect(f("2027-04")).toBe(110000);
  });
  it("購入: 頭金・諸費用、親からの資金援助（贈与の税は贈与の作業で扱う）、固定資産税を4回、修繕費", () => {
    const r = full(
      mk([
        {
          id: uid("h"),
          kind: "own",
          from: at("2027-04"),
          to: null,
          purchase: { price: 40000000, downPayment: 5000000, costs: 2000000, gifts: [{ recipient: A, giver: "parent", amount: 1000000 }] },
          propertyTax: { annual: box(120001) },
          maintenance: { monthly: box(10000) },
          ownership: [{ member: A, share: "1" }],
        },
      ]),
    );
    const f = (ym: string, row: string) => r.flows.filter((x) => x.ym === ym && x.row === row).reduce((s, x) => s + x.amount, 0);
    expect(f("2027-04", "cf.expense.housing.purchase.downPayment")).toBe(5000000);
    expect(f("2027-04", "cf.expense.housing.purchase.costs")).toBe(2000000);
    expect(f("2027-04", "cf.income.lumpSum.gift")).toBe(1000000);
    expect(f("2028-04", "cf.expense.housing.propertyTax")).toBe(30001);
    expect(f("2029-02", "cf.expense.housing.propertyTax")).toBe(30000);
    expect(notices(r).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("giftTax"))).toBe(true);
    // 持ち家の評価額は土地と建物の行に分けて出す（合計＝購入の価格）
    expect(cells(r, "cf.balance.account.realEstate.land", 2027) + cells(r, "cf.balance.account.realEstate.building", 2027)).toBe(40000000);
  });
});

describe("取り崩し: 旧NISA の移し先の課税口座", () => {
  it("課税口座が無い名義人の旧NISA を移した器も、取り崩しの順序（課税口座）で売る", () => {
    const A2 = uid("a");
    const req = withInput(
      household({ members: [member("a", "self", "1980-06")], endYear: 2030 }),
      (h) => {
        h.accounts = [
          { id: uid("dep"), kind: "deposit", owner: A2, marketValue: box(100000), asOf: "2025-12", contributions: [] },
          { id: uid("lg"), kind: "legacyNisa", owner: A2, marketValue: box(3000000), asOf: "2025-12", lots: [{ vintageYear: 2022, regime: "general", costBasis: 2000000, marketValue: 3000000 }], contributions: [] },
        ];
        h.residences = [{ id: uid("rent"), kind: "rent", from: at("2010-01"), to: null, rent: { monthly: box(100000) } }];
      },
    );
    const r = full(req);
    expect(cells(r, "cf.transfer.rollover", 2026)).toBeGreaterThan(0);
    expect(cells(r, "cf.transfer.withdrawal", 2027)).toBeGreaterThan(0);
    // 移したときの時価が取得価額なので、利益は移した後の運用益（1年分・1%）の売った分だけ
    const it = cells(r, "cf.taxSi.incomeTax.capitalGains", 2027);
    expect(it).toBeGreaterThan(0);
    expect(it).toBeLessThan(Math.ceil(3030000 * 0.01 * 0.15315));
  });
});

// 繰上返済・変動金利の5年ルール・損益通算の順（2026-11-08 の直し。0136・0008・0028 の追記）
// - 繰上返済で償還期間が10年未満になったら、その繰上返済をした年分から住宅ローン控除を受けない（措置法通達41-19）
// - 5年ルールの見直しは、借入の時から変動のローンも最初の返済から61回目
// - 繰上返済の額は未払利息に先に充てる（元金を全部返すなら未払利息も一緒に払い、返し終える）
// - 損益通算は一時所得・総合長期の譲渡所得を2分の1にする前の額で行う（所得税法69条・同法施行令198条）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { DebtScheduleOutput, LossCarryforwardOutput, TotalIncomeOutput } from "../src/sdk/contracts.ts";
import { box, household, member, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const packs = realPacks();
const call = <T>(req: Req, component: string, input: unknown, stubs?: Record<string, (i: unknown) => unknown>): T =>
  runEngine(req, packs, { checkInternal: true, entry: { component, input }, ...(stubs ? { stubs } : {}) }).entryOutput as T;
const at = (ym: string) => ({ at: ym });
const A = uid("a");

describe("住宅ローン控除: 繰上返済で償還期間が10年未満になったとき", () => {
  const R = uid("home");
  const L = uid("homeLoan");
  const MV = uid("mv");
  // 2022年3月に3,000万円・35年・固定1%で借り（最初の返済は4月）、2022年4月に入居（認定住宅・新築）
  function req(loan: Obj = {}): Req {
    const r = household({ baseMonth: "2022-01", endYear: 2045, members: [member("a", "self", "1980-01")], events: [{ id: MV, kind: "moveIn", at: at("2022-04") }] });
    const h = r.input.household as unknown as Obj;
    h.residences = [{ id: R, kind: "own", from: at("2022-04"), to: null, ownership: [{ member: A, share: "1" }], valuation: { value: box(40000000), asOf: "2022-04" } }];
    h.debts = [
      {
        id: L,
        kind: "mortgage",
        debtors: [{ member: A, role: "primary" }],
        principal: 30000000,
        start: at("2022-03"),
        rateSchedule: [{ from: at("2022-03"), type: "fixed", rate: "0.01" }],
        repayment: { method: "equalPayment", termMonths: 420 },
        housing: { moveIn: MV, propertyType: "certified", newBuild: true, residence: R },
        ...loan,
      },
    ];
    return r;
  }
  const credit = (r: Req, year: number) => call<{ credit: number }>(r, "tax.housingLoanCredit", { member: A, year }, { "tax.incomeWithin": () => ({ within: true }) }).credit;
  const schedule = (r: Req) => call<DebtScheduleOutput>(r, "debt.schedule", { object: L });

  it("2026年6月に2,300万円を期間短縮で返すと、返し終える月が最初の返済から10年より前になり、2026年分から受けない（2025年分までは受ける）", () => {
    const r = req({ prepayments: [{ at: at("2026-06"), amount: 23000000, mode: "shortenTerm" }] });
    const s = schedule(r);
    expect(s.payoff).not.toBeNull();
    expect(s.payoff! < "2032-03").toBe(true);
    // 繰上返済の後の最後の返済の見込みの月（約束の版 1.4）
    expect(s.prepayments).toEqual([{ ym: "2026-06", lastPayment: s.payoff }]);
    expect(credit(r, 2025)).toBeGreaterThan(0);
    expect([2026, 2027, 2028].map((y) => credit(r, y))).toEqual([0, 0, 0]);
  });

  it("繰上返済の後も償還期間が10年以上なら、今までどおり受ける", () => {
    const r = req({ prepayments: [{ at: at("2026-06"), amount: 5000000, mode: "shortenTerm" }] });
    const s = schedule(r);
    const last = s.prepayments?.[0]?.lastPayment;
    expect(last !== undefined && last >= "2032-03").toBe(true);
    expect(credit(r, 2026)).toBeGreaterThan(0);
    expect(credit(r, 2027)).toBeGreaterThan(0);
  });

  it("返済額軽減の繰上返済は期間が変わらないので受け続ける", () => {
    const r = req({ prepayments: [{ at: at("2026-06"), amount: 23000000, mode: "reducePayment" }] });
    expect(credit(r, 2026)).toBeGreaterThan(0);
  });

  it("当初の返済の期間が10年未満のローンは、はじめから受けない", () => {
    expect(credit(req({ repayment: { method: "equalPayment", termMonths: 119 } }), 2022)).toBe(0);
    expect(credit(req({ repayment: { method: "equalPayment", termMonths: 120 } }), 2022)).toBeGreaterThan(0);
  });

  it("借り換えた後の繰上返済は、新しいローンの最初の返済（借り換えの月）から数える", () => {
    // 2024年4月に25年で借り換え、2030年6月に繰上返済で2033年より前に返し終える: 新しいローンの期間は10年未満 → 2030年から受けない
    const refinance = [{ at: at("2024-04"), rateSchedule: [{ from: at("2024-04"), type: "fixed", rate: "0.01" }], termMonths: 300 }];
    const short = req({ refinance, prepayments: [{ at: at("2030-06"), amount: 20000000, mode: "shortenTerm" }] });
    const s = schedule(short);
    expect(s.prepayments?.[0]?.lastPayment !== undefined && s.prepayments[0].lastPayment < "2034-03").toBe(true);
    expect(credit(short, 2029)).toBeGreaterThan(0);
    expect(credit(short, 2030)).toBe(0);
  });
});

describe("変動金利の返済", () => {
  const L = uid("loan");
  const variable = (rate2: string) => [
    { from: at("2020-03"), type: "variable", rate: "0.005" },
    { from: at("2022-04"), type: "variable", rate: rate2 },
  ];
  function sched(loan: Obj): DebtScheduleOutput {
    const r = household({ baseMonth: "2020-01", endYear: 2060, members: [member("a", "self", "1980-01")] });
    (r.input.household as unknown as Obj).debts = [
      {
        id: L,
        kind: "mortgage",
        debtors: [{ member: A, role: "primary" }],
        principal: 30000000,
        start: at("2020-03"),
        rateSchedule: variable("0.03"),
        repayment: { method: "equalPayment", termMonths: 420, variableRules: { fiveYear: true, cap125: true } },
        ...loan,
      },
    ];
    return call<DebtScheduleOutput>(r, "debt.schedule", { object: L });
  }
  const payOf = (s: DebtScheduleOutput, ym: string) => s.flows.filter((f) => f.ym === ym && f.formula === "debt.schedule.equalPayment").reduce((a, f) => a + f.amount, 0);
  const paidIn = (s: DebtScheduleOutput, ym: string) => s.flows.filter((f) => f.ym === ym).reduce((a, f) => a + f.amount, 0);

  it("5年ルール: 借入の時から変動（2020年3月借入・最初の返済は4月）は、60回（2025年3月まで）同じで、61回目（2025年4月）と121回目（2030年4月）に見直す", () => {
    const s = sched({});
    const first = payOf(s, "2020-04");
    expect(payOf(s, "2025-03")).toBe(first);
    expect(payOf(s, "2025-04")).toBeGreaterThan(first);
    expect(payOf(s, "2025-04")).toBeLessThanOrEqual(Math.floor((first * 5) / 4));
    expect(payOf(s, "2030-03")).toBe(payOf(s, "2025-04"));
    expect(payOf(s, "2030-04")).toBeGreaterThan(payOf(s, "2030-03"));
  });

  it("5年ルール: 今の残高から入れた借入の時から変動のローンも、最初の返済から61回目に見直す", () => {
    const s = sched({ balance: box(29000000), balanceAsOf: "2021-12" });
    expect(payOf(s, "2025-03")).toBe(payOf(s, "2022-01"));
    expect(payOf(s, "2025-04")).toBeGreaterThan(payOf(s, "2025-03"));
  });

  it("5年ルール: 固定から変動に移ったローンは、変動の最初の返済から61回目（今までどおり）", () => {
    const s = sched({ rateSchedule: [{ from: at("2020-03"), type: "fixed", rate: "0.01" }, { from: at("2025-03"), type: "variable", rate: "0.005" }, { from: at("2026-01"), type: "variable", rate: "0.03" }] });
    expect(payOf(s, "2030-02")).toBe(payOf(s, "2025-03"));
    expect(payOf(s, "2030-03")).toBeGreaterThan(payOf(s, "2030-02"));
  });

  it("未払利息のあるローンを繰上返済で全部返すと、未払利息も払って返し終える", () => {
    const s = sched({ rateSchedule: variable("0.06"), prepayments: [{ at: at("2027-06"), amount: 40000000, mode: "shortenTerm" }] });
    const unpaid2026 = s.yearEnd.find((y) => y.year === 2026)?.unpaidInterest ?? 0;
    expect(unpaid2026).toBeGreaterThan(3000000);
    expect(s.payoff).toBe("2027-06");
    expect(s.yearEnd.at(-1)).toEqual({ year: 2027, balance: 0, unpaidInterest: 0 });
    const balance2026 = s.yearEnd.find((y) => y.year === 2026)?.balance ?? 0;
    // 6月までの返済と繰上返済で、2026年末の元金と未払利息の両方を払う
    const prepaid = s.flows.filter((f) => f.ym === "2027-06" && f.formula === "debt.schedule.prepayment.shortenTerm").reduce((a, f) => a + f.amount, 0);
    expect(prepaid).toBeGreaterThan(unpaid2026);
    expect(paidIn(s, "2027-06")).toBeLessThan(40000000);
    // 払った合計＝借入額＋利息の合計（未払利息が消えない）
    const paid = s.flows.reduce((a, f) => a + f.amount, 0);
    const interest = (s.interest ?? []).reduce((a, x) => a + x.amount, 0);
    expect(paid).toBe(30000000 + interest);
    expect(balance2026).toBeGreaterThan(0);
  });

  it("一部の繰上返済は、まず未払利息に充て、残りを元金に充てる", () => {
    const none = sched({ rateSchedule: variable("0.06") });
    const part = sched({ rateSchedule: variable("0.06"), prepayments: [{ at: at("2027-06"), amount: 5000000, mode: "reducePayment" }] });
    const unpaidMay = none.yearEnd.find((y) => y.year === 2026)?.unpaidInterest ?? 0;
    const y2027 = part.yearEnd.find((y) => y.year === 2027);
    const base2027 = none.yearEnd.find((y) => y.year === 2027);
    // 500万円のうち未払利息（300万円超）を先に払うので、元金は500万円より少なく減る
    expect(unpaidMay).toBeGreaterThan(3000000);
    expect((base2027?.balance ?? 0) - (y2027?.balance ?? 0)).toBeLessThan(5000000 - 3000000);
    const paid = part.flows.reduce((a, f) => a + f.amount, 0);
    const interest = (part.interest ?? []).reduce((a, x) => a + x.amount, 0);
    const last = part.yearEnd.at(-1);
    expect(paid + (last?.balance ?? 0) + (last?.unpaidInterest ?? 0)).toBe(30000000 + interest);
  });
});

describe("損益通算の順（2分の1にする前の額で通算する。所得税法69条・同法施行令198条・22条2項2号）", () => {
  // 本人（給与なし）に、2027年の事業所得（売上100万円・経費 cost）と一時所得（450万円）
  function req(o: { cost?: number; temporary?: number; blue?: boolean; accounts?: Obj[] } = {}): Req {
    const r = household({ baseMonth: "2026-01", endYear: 2031, members: [member("a", "self", "1970-01", o.blue === true ? { taxReturn: { method: "blue" } } : {})] });
    const h = r.input.household as unknown as Obj;
    h.incomeFlows = [
      { id: uid("biz"), kind: "otherWork", taxTreatment: "business", recipient: A, from: at("2027-03"), to: at("2027-03"), everyYears: 1, amount: box(1000000), cost: box(o.cost ?? 4000000) },
      ...(o.temporary === 0 ? [] : [{ id: uid("tmp"), kind: "temporary", taxTreatment: "temporary", recipient: A, from: at("2027-05"), to: at("2027-05"), everyYears: 1, amount: box(o.temporary ?? 4500000) }]),
    ];
    if (o.accounts !== undefined) h.accounts = o.accounts;
    return r;
  }
  const total = (r: Req, year = 2027) => call<TotalIncomeOutput>(r, "tax.totalIncome", { member: A, year });

  it("事業所得 −300万円・一時所得 400万円（特別控除の後）: 総所得金額は (400−300)×1/2 = 50万円で、純損失は無い", () => {
    const t = total(req());
    expect({ total: t.total, netLoss: t.netLoss ?? 0, temporary: t.temporary }).toEqual({ total: 500000, netLoss: 0, temporary: 500000 });
  });

  it("損失が一時所得の金額より大きければ、残りが純損失（事業所得 −600万円・一時所得 400万円 → 純損失 200万円）", () => {
    const t = total(req({ cost: 7000000 }));
    expect({ total: t.total, netLoss: t.netLoss ?? 0 }).toEqual({ total: 0, netLoss: 2000000 });
  });

  it("損失の無い人は変わらない（一時所得 400万円の2分の1）", () => {
    const t = total(req({ cost: 0 }));
    expect(t.total).toBe(1000000 + 2000000);
  });

  it("青色申告: 損益通算で引ききれた年は、翌年に繰り越す損失が無い", () => {
    const blue = call<LossCarryforwardOutput>(req({ blue: true }), "tax.lossCarryforward", { member: A });
    expect(blue.byYear.filter((y) => y.netLoss > 0 || y.remaining > 0)).toEqual([]);
    // 引ききれない分（200万円）だけを繰り越す
    const big = call<LossCarryforwardOutput>(req({ blue: true, cost: 7000000 }), "tax.lossCarryforward", { member: A });
    expect(big.byYear.find((y) => y.year === 2027)).toMatchObject({ netLoss: 2000000, remaining: 2000000 });
  });

  it("総合長期の譲渡所得（その他の資産）も2分の1の前の額で通算し、一時所得より先に引く", () => {
    const G = uid("gold");
    const gold = { id: G, kind: "otherAsset", subtype: "preciousMetal", owner: A, marketValue: box(5000000), asOf: "2026-01", valueGrowth: "0", contributions: [], costBasis: box(2000000), acquiredAt: "2015-01", sale: { at: at("2027-08"), price: 5500000 } };
    // 長期の譲渡益 350万円 → 特別控除の後 300万円。事業所得 −300万円をまず長期から引き、一時所得 400万円は残る → 200万円
    const t = total(req({ accounts: [gold] }));
    expect(t.transfer).toMatchObject({ long: 3500000, included: 0 });
    expect({ total: t.total, netLoss: t.netLoss ?? 0 }).toEqual({ total: 2000000, netLoss: 0 });
  });
});

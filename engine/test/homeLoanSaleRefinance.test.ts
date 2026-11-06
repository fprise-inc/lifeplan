// 住まいの住宅ローンを、住まいを売ったときに返す（debt.schedule 改訂6）と、借り換えた後の住宅ローン控除（tax.housingLoanCredit 改訂5。
// 国税庁 タックスアンサー No.1233「住宅ローン等の借換えをしたとき」）のテスト（L1）。手計算は別に書き、エンジンの結果と突き合わせる
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { DebtScheduleOutput } from "../src/sdk/contracts.ts";
import { box, household, member, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const packs = realPacks();
const call = <T>(req: Req, component: string, input: unknown, stubs?: Record<string, (i: unknown) => unknown>): T =>
  runEngine(req, packs, { checkInternal: true, entry: { component, input }, ...(stubs ? { stubs } : {}) }).entryOutput as T;
const at = (ym: string) => ({ at: ym });
const A = uid("a");
const R = uid("home");
const L = uid("homeLoan");
const MV = uid("mv");

/** 2020年4月に買って住んでいる持ち家と、その住宅ローン（3,000万円・35年・固定1%） */
function req(o: { residence?: Obj; loan?: Obj; housing?: boolean } = {}): Req {
  const r = household({ baseMonth: "2026-10", endYear: 2045, members: [member("a", "self", "1980-01")], events: [{ id: MV, kind: "moveIn", at: at("2020-04") }] });
  const h = r.input.household as unknown as Obj;
  h.residences = [{ id: R, kind: "own", from: at("2020-04"), to: null, ownership: [{ member: A, share: "1" }], valuation: { value: box(40000000), asOf: "2020-04" }, ...o.residence }];
  h.debts = [
    {
      id: L,
      kind: "mortgage",
      debtors: [{ member: A, role: "primary" }],
      principal: 30000000,
      start: at("2020-04"),
      rateSchedule: [{ from: at("2020-04"), type: "fixed", rate: "0.01" }],
      repayment: { method: "equalPayment", termMonths: 420 },
      ...(o.housing === false ? {} : { housing: { moveIn: MV, propertyType: "certified", newBuild: true, residence: R } }),
      ...o.loan,
    },
  ];
  return r;
}
const sched = (r: Req) => call<DebtScheduleOutput>(r, "debt.schedule", { object: L });
const payoffs = (s: DebtScheduleOutput) => s.flows.filter((f) => f.formula === "debt.schedule.salePayoff");

describe("住まいを売ったときに住宅ローンを返す", () => {
  it("住み終わりの月に売る（既定は返す）: 住み終わりの月の返済の後に残りを一括で返し、その後の返済は無い", () => {
    const s = sched(req({ residence: { to: at("2035-03"), sale: {} } }));
    const p = payoffs(s);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ ym: "2035-03", row: "cf.expense.housing.loan.prepayment" });
    expect(p[0]?.amount).toBeGreaterThan(15_000_000);
    expect(s.payoff).toBe("2035-03");
    expect(s.flows.some((f) => f.ym > "2035-03")).toBe(false);
  });

  it("売ったときに返さない（repayLoan: false）・売らない・住み終わりが無いなら予定のまま返す", () => {
    for (const residence of [{ to: at("2035-03"), sale: { repayLoan: false } }, { to: at("2035-03") }, {}]) {
      const s = sched(req({ residence }));
      expect(payoffs(s)).toEqual([]);
      expect(s.flows.some((f) => f.ym > "2040-01")).toBe(true);
    }
  });

  it("控除の条件が無いローン（今の残高から入れた）も、借入の月に住んでいる持ち家を売れば返す", () => {
    const s = sched(req({ housing: false, residence: { to: at("2035-03"), sale: {} } }));
    expect(payoffs(s).map((f) => f.ym)).toEqual(["2035-03"]);
  });

  it("購入の予定の家のローン（控除の条件の住まいが無くても、借入の月に購入する家）", () => {
    const r = req({ housing: false, residence: { from: at("2028-04"), to: at("2040-03"), purchase: { at: at("2028-04"), price: 40000000, downPayment: 10000000, costs: 2000000 }, sale: {} }, loan: { start: at("2028-04"), rateSchedule: [{ from: at("2028-04"), type: "fixed", rate: "0.01" }] } });
    expect(payoffs(sched(r)).map((f) => f.ym)).toEqual(["2040-03"]);
  });
});

describe("借り換えた後の住宅ローン控除", () => {
  const credit = (r: Req, year: number) => call<{ credit: number }>(r, "tax.housingLoanCredit", { member: A, year }, { "tax.incomeWithin": () => ({ within: true }) }).credit;
  const refi = (o: Obj = {}) => ({ refinance: [{ at: at("2027-06"), rateSchedule: [{ from: at("2027-06"), type: "variable", rate: "0.005" }], termMonths: 300, ...o }] });

  it("借り換えの後も、当初の入居の年からの期間の間は新しいローンの年末残高で控除する（借入額＝直前の残高なら比で減らさない）", () => {
    const r = req({ loan: refi() });
    const s = sched(r);
    expect(s.refinances).toHaveLength(1);
    const rf = s.refinances![0]!;
    expect(rf.principal).toBe(rf.before);
    const bal2028 = s.yearEnd.find((e) => e.year === 2028)!.balance;
    // 2020年入居の認定住宅（新築）: 控除率1%・借入限度額5,000万円。残高×1%（100円未満切り捨て）
    expect(credit(r, 2028)).toBe(Math.floor((bal2028 * 0.01) / 100) * 100);
    // 期間は延びない（2020年入居は10年で2029年まで。11〜13年目の特例は計算しない）
    expect(credit(r, 2029)).toBeGreaterThan(0);
    expect(credit(r, 2030)).toBe(0);
  });

  it("費用を新しいローンに含めて借入額が直前の残高より多いと、年末残高×直前の残高÷新しい借入額にする", () => {
    const r = req({ loan: refi({ costs: 1_000_000, costsFinanced: true }) });
    const s = sched(r);
    const rf = s.refinances![0]!;
    expect(rf.principal - rf.before).toBe(1_000_000);
    const bal = s.yearEnd.find((e) => e.year === 2028)!.balance;
    const eligible = Math.floor((bal * rf.before) / rf.principal);
    expect(credit(r, 2028)).toBe(Math.floor((eligible * 0.01) / 100) * 100);
    expect(credit(r, 2028)).toBeLessThan(Math.floor((bal * 0.01) / 100) * 100);
  });

  it("新しいローンの償還期間が10年未満なら、借り換えた年から控除を受けない（前の年は受ける）", () => {
    const r = req({ loan: refi({ termMonths: 96 }) });
    expect(credit(r, 2026)).toBeGreaterThan(0);
    expect(credit(r, 2027)).toBe(0);
    expect(credit(r, 2028)).toBe(0);
  });
});

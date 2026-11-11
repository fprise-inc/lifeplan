// 負債の年ごとの利息とその年の金利（debt.schedule 約束の版 1.5 の byYear・plan.cashflow 約束の版 1.9 の details.loans・エンジンの summary.loans。0204）のテスト（L1）。
// 手計算は別に書き（元利均等の返済額＝残高×月利×(1＋月利)^n÷((1＋月利)^n−1) を円未満切り捨て、利息＝残高×年利÷12 を円未満切り捨て）、エンジンの結果と突き合わせる
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { DebtScheduleOutput } from "../src/sdk/contracts.ts";
import { box, household, member, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const packs = realPacks();
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, packs, { checkInternal: true, entry: { component, input } }).entryOutput as T;
const at = (ym: string) => ({ at: ym });
const A = uid("a");
const L = uid("loan");
const R = uid("home");

function req(loan: Obj, o: { baseMonth?: string; endYear?: number; assumptions?: Obj; residence?: Obj } = {}): Req {
  const r = household({ baseMonth: o.baseMonth ?? "2026-01", endYear: o.endYear ?? 2060, members: [member("a", "self", "1980-01")] });
  const h = r.input.household as unknown as Obj;
  if (o.residence !== undefined) h.residences = [{ id: R, kind: "own", from: at("2020-04"), to: null, ownership: [{ member: A, share: "1" }], valuation: { value: box(40000000), asOf: "2020-04" }, ...o.residence }];
  h.debts = [{ id: L, kind: "mortgage", debtors: [{ member: A, role: "primary" }], ...loan }];
  if (o.assumptions !== undefined) Object.assign(r.input.assumptions as unknown as Obj, o.assumptions);
  return r;
}
const sched = (r: Req) => call<DebtScheduleOutput>(r, "debt.schedule", { object: L });

/** その年の、このローンのお金の動きの合計（返済・繰上返済・売ったときの返済。手数料・諸費用を除く） */
const paidIn = (s: DebtScheduleOutput, y: number) => s.flows.filter((f) => f.accrualYear === y && !/Fee|Costs/.test(f.formula ?? "")).reduce((a, f) => a + f.amount, 0);
/** 年末の残高（未払利息を除く。前の年が無ければ start） */
const balanceAt = (s: DebtScheduleOutput, y: number, start: number) => (s.yearEnd.find((e) => e.year === y)?.balance ?? (s.yearEnd.some((e) => e.year < y) ? 0 : start)) as number;

describe("固定金利: 手計算と同じ利息と金利", () => {
  // 2026年1月に120万円・12回・固定1.2%（月0.1%）で借りる（最初の返済は2月）。
  // 返済額 = 1,200,000×0.001×1.001^12÷(1.001^12−1) = 100,651.6… → 100,651円。
  // 利息は毎月の残高÷1,000（円未満切り捨て）: 2月 1,200 円、3月 1,100 円（残高 1,100,549）… 2026年（11回）の合計 7,707 円、2027年1月（最後の回）100 円
  const loan = { principal: 1200000, start: at("2026-01"), rateSchedule: [{ from: at("2026-01"), type: "fixed", rate: "0.012" }], repayment: { method: "equalPayment", termMonths: 12 } };

  it("年ごとの利息は手計算と同じで、金利は 1.2%", () => {
    const s = sched(req(loan));
    expect(s.byYear).toEqual([
      { year: 2026, interestPaid: 7707, rate: "0.012" },
      { year: 2027, interestPaid: 100, rate: "0.012" },
    ]);
    // 未払利息の無いローンは、利息に充てた額と、かかった利息（interest。0028）が同じ
    expect(s.interest).toEqual([
      { year: 2026, amount: 7707 },
      { year: 2027, amount: 100 },
    ]);
    // 返済の合計＝元金＋利息（2026年は 11回×100,651、2027年は最後の回の残り＋利息）
    expect(paidIn(s, 2026)).toBe(11 * 100651);
    expect(paidIn(s, 2027)).toBe(1200000 + 7707 + 100 - 11 * 100651);
  });

  it("エンジンの要約 summary.loans に、年ごとの利息と金利・表の期間の利息の合計が出る", () => {
    const out = runEngine(req(loan), packs, { checkInternal: true }) as { summary: { loans?: unknown } };
    expect(out.summary.loans).toEqual([
      {
        object: L,
        kind: "mortgage",
        years: [
          { year: 2026, interest: 7707, rate: "0.012" },
          { year: 2027, interest: 100, rate: "0.012" },
        ],
        interestTotal: 7807,
      },
    ]);
  });

  it("計算基準月より前の返済は入れない（今の残高から入れたローンも、計算基準月の年から）", () => {
    const s = sched(req(loan, { baseMonth: "2026-07" }));
    // 2026年は7月〜12月の6回だけ（7月の残高は 6回返した後）
    const y2026 = s.byYear?.find((e) => e.year === 2026);
    expect(y2026?.rate).toBe("0.012");
    expect(y2026?.interestPaid).toBeLessThan(7707);
    expect(s.byYear?.map((e) => e.year)).toEqual([2026, 2027]);
  });
});

describe("変動金利: 5年ルール・125%ルール・未払利息", () => {
  // 2020年3月に3,000万円・35年・変動0.5%（5年ルール・125%ルールあり）、2022年4月から4%。基準月は2020年1月。
  // 返済額 = 30,000,000×(0.005/12)×(1+0.005/12)^420÷((1+0.005/12)^420−1) = 77,875円（円未満切り捨て）。
  // 2022年4月から利息（残高×4%÷12 ≒ 9.5万円）が返済額を超えるので、返済額の全部が利息に充たり、残りは未払利息になる
  const loan = {
    principal: 30000000,
    start: at("2020-03"),
    rateSchedule: [
      { from: at("2020-03"), type: "variable", rate: "0.005" },
      { from: at("2022-04"), type: "variable", rate: "0.04" },
    ],
    repayment: { method: "equalPayment", termMonths: 420, variableRules: { fiveYear: true, cap125: true } },
  };
  const s = sched(req(loan, { baseMonth: "2020-01" }));
  const by = (y: number) => s.byYear?.find((e) => e.year === y);

  it("手計算の利息（2020年 111,514円・2021年 145,240円・2022年 736,568円・2023年 934,500円＝返済額 77,875円×12回）", () => {
    expect([2020, 2021, 2022, 2023].map((y) => by(y)?.interestPaid)).toEqual([111514, 145240, 736568, 934500]);
  });

  it("その年の金利は、その年の最後の返済に当てた金利（2022年は4月から4%）", () => {
    expect([2020, 2021, 2022, 2023].map((y) => by(y)?.rate)).toEqual(["0.005", "0.005", "0.04", "0.04"]);
  });

  it("返済額が利息に足りない年は、かかった利息との差が未払利息に積み上がる", () => {
    const acc = (y: number) => s.interest?.find((e) => e.year === y)?.amount ?? 0;
    expect(acc(2022)).toBe(888389);
    expect(acc(2023)).toBe(1136928);
    expect(s.yearEnd.find((e) => e.year === 2023)?.unpaidInterest).toBe(acc(2022) - 736568 + acc(2023) - 934500);
    // 未払利息がある年も、返済の合計＝元金に充てた額（年末の残高の減り）＋利息に充てた額
    for (const y of [2021, 2022, 2023, 2026, 2031]) expect(paidIn(s, y)).toBe(balanceAt(s, y - 1, 30000000) - balanceAt(s, y, 30000000) + (by(y)?.interestPaid ?? 0));
  });

  it("どの年も、返済の合計＝元金に充てた額＋利息に充てた額。利息の合計は、かかった利息の合計と同じ（返し終えれば未払利息も払う）", () => {
    for (const e of s.byYear ?? []) expect(paidIn(s, e.year)).toBe(balanceAt(s, e.year - 1, 30000000) - balanceAt(s, e.year, 30000000) + e.interestPaid);
    expect(s.payoff).not.toBeNull();
    const total = (s.byYear ?? []).reduce((a, e) => a + e.interestPaid, 0);
    expect(total).toBe((s.interest ?? []).reduce((a, e) => a + e.amount, 0));
  });
});

describe("前提の変動金利の上乗せ・繰上返済・借り換え・売ったときの返済", () => {
  const base = { principal: 30000000, start: at("2020-04"), rateSchedule: [{ from: at("2020-04"), type: "variable", rate: "0.005" }], repayment: { method: "equalPayment", termMonths: 420 } };
  const total = (s: DebtScheduleOutput) => (s.byYear ?? []).reduce((a, e) => a + e.interestPaid, 0);

  it("ストレステストの上乗せ（loanRateShifts）は、その月からの金利に入る", () => {
    const s = sched(req(base, { assumptions: { loanRateShifts: [{ from: "2030-07", add: "0.01" }] } }));
    expect(s.byYear?.find((e) => e.year === 2029)?.rate).toBe("0.005");
    expect(s.byYear?.find((e) => e.year === 2030)?.rate).toBe("0.015");
    expect(total(s)).toBeGreaterThan(total(sched(req(base))));
  });

  it("繰上返済（期間短縮）で利息の合計が減り、返し終えた年の後は年が無い", () => {
    const plain = sched(req(base));
    const s = sched(req({ ...base, prepayments: [{ at: at("2030-06"), amount: 10000000, mode: "shortenTerm" }] }));
    expect(total(s)).toBeLessThan(total(plain));
    const last = s.byYear?.[s.byYear.length - 1]?.year;
    expect(last).toBe(Number(s.payoff?.slice(0, 4)));
    for (const e of s.byYear ?? []) expect(paidIn(s, e.year)).toBe(balanceAt(s, e.year - 1, 30000000) - balanceAt(s, e.year, 30000000) + e.interestPaid);
  });

  it("借り換えると、その月から新しい金利になる（諸費用は利息に入れない）", () => {
    const s = sched(req({ ...base, refinance: [{ at: at("2031-04"), rateSchedule: [{ from: at("2031-04"), type: "fixed", rate: "0.018" }], termMonths: 300, costs: 500000 }] }));
    expect(s.byYear?.find((e) => e.year === 2030)?.rate).toBe("0.005");
    expect(s.byYear?.find((e) => e.year === 2031)?.rate).toBe("0.018");
    for (const e of s.byYear ?? []) expect(paidIn(s, e.year)).toBe(balanceAt(s, e.year - 1, 30000000) - balanceAt(s, e.year, 30000000) + e.interestPaid);
  });

  it("住まいを売ったときに返すと、売った年で終わる", () => {
    const s = sched(req(base, { residence: { to: at("2035-03"), sale: {} } }));
    expect(s.payoff).toBe("2035-03");
    expect(s.byYear?.[s.byYear.length - 1]?.year).toBe(2035);
    for (const e of s.byYear ?? []) expect(paidIn(s, e.year)).toBe(balanceAt(s, e.year - 1, 30000000) - balanceAt(s, e.year, 30000000) + e.interestPaid);
  });
});

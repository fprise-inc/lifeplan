// 車のひな形（0008 の追記）: 構成員ごとの車の買い替え・ローン・車検・保険・自動車税。
// - 買い替え: 最初の購入の月から n年ごと（手放す月まで）。車両の価格（計算基準年の価格。伸び方で伸ばす）から、2回目からの購入（owned なら1回目から）は
//   下取りの額を引く。そのうちローンで借りる分（share。省略は全部）を除いた額を購入の月に払う（cf.expense.lumpSum.car）
// - 自動車ローン: 購入のたびに debt.schedule（約束の版 1.1 の loan）で返済を計算する（固定金利・購入の月の翌月から）
// - 車検: 購入から firstAfterYears 年後（省略は3年）、その後 everyYears 年ごと（省略は2年）。次の買い替え・手放す月の前まで（cf.expense.living.car）
// - 自動車保険: 年額を、持っている間の毎年の購入の月に（cf.expense.insurance.nonLife）。自動車税: 年額を、持っている間の毎年5月に（cf.expense.living.car）
// 車を持っている期間は、最初の購入の月（owned なら計算基準月）から手放す月まで
import {
  addMonths,
  defineComponent,
  formatYm,
  grownByYear,
  monthIndex,
  monthOf,
  yearOf,
  yen,
  type CarInput,
  type CarOutput,
  type DebtScheduleOutput,
  type Flow,
  type MonthIndex,
  type Yen,
} from "../../sdk/index.ts";


export default defineComponent<{ member: string }, CarOutput>({
  id: "expense.car",
  title: "車（買い替え・ローン・車検・保険・自動車税）",
  contract: "1.0",
  revision: 1,
  requires: { "debt.schedule": ">=1 <2" },
  params: [],
  reads: ["car.owner", "car.purchase", "car.until", "car.loan", "car.inspection", "car.insurance", "car.tax", "car.growth", "assumptions.inflation"],
  memberScope: ["car"],
  input: "member.input",
  output: "expense.car.output",
  compute(input, ctx) {
    const { base, end } = ctx.time;
    const member = input.member;
    const flows: Flow[] = [];
    const loans: { object: string; yearEnd: DebtScheduleOutput["yearEnd"] }[] = [];
    for (const c of ctx.list<CarInput>("car")) {
      const first = ctx.time.resolve(c.purchase.first);
      const until: MonthIndex = c.until === undefined || c.until === null ? end : ctx.time.resolve(c.until);
      const ownedFrom = c.purchase.owned === true ? base : first;
      if (until < base || ownedFrom > end) continue;
      const g = (amount: Yen) => grownByYear(ctx, amount, c.growth, yearOf(base), yearOf(end));
      const price = g(c.purchase.price);
      const tradeIn = g(yen(c.purchase.tradeIn ?? 0));
      const inspection = c.inspection === undefined ? null : g(c.inspection.amount);
      const insurance = c.insurance === undefined ? null : g(c.insurance.annual);
      const tax = c.tax === undefined ? null : g(c.tax.annual);
      const push = (m: MonthIndex, row: string, amount: Yen, formula: string) => {
        if (amount > 0 && m >= base && m <= end) flows.push({ row, ym: formatYm(m), amount, accrualYear: yearOf(m), member, object: c.id, formula });
      };
      const at = (map: Map<number, Yen> | null, m: MonthIndex) => (map === null ? yen(0) : (map.get(yearOf(m)) ?? map.get(yearOf(base)) ?? yen(0)));
      // 購入の月
      const purchases: MonthIndex[] = [];
      for (let m: MonthIndex = first; m <= until && m <= end; m = addMonths(m, 12 * c.purchase.everyYears)) purchases.push(m);
      purchases.forEach((m, k) => {
        if (m < base) return;
        const net = yen(Math.max(0, at(price, m) - (k > 0 || c.purchase.owned === true ? at(tradeIn, m) : 0)));
        let borrowed = yen(0);
        if (c.loan !== undefined && net > 0) {
          borrowed = c.loan.share === undefined ? net : ctx.money.mulRate(net, ctx.rate.of(c.loan.share), "conv.expense.share");
          const out = ctx.call<DebtScheduleOutput>("debt.schedule", {
            loan: {
              id: c.id,
              kind: "car",
              debtors: [{ member, role: "primary" }],
              principal: borrowed,
              start: { at: formatYm(m) },
              rateSchedule: [{ from: { at: formatYm(m) }, type: "fixed", rate: c.loan.rate }],
              repayment: { method: c.loan.method ?? "equalPayment", termMonths: c.loan.termMonths },
            },
          });
          for (const f of out.flows) flows.push(f);
          loans.push({ object: c.id, yearEnd: out.yearEnd });
        }
        push(m, "cf.expense.lumpSum.car", yen(net - borrowed), "expense.car.purchase");
      });
      // 車検（購入ごとに数え直す）
      if (inspection !== null) {
        const firstAfter = c.inspection?.firstAfterYears ?? 3;
        const every = c.inspection?.everyYears ?? 2;
        const starts = c.purchase.owned === true && first > base ? [addMonths(first, -12 * c.purchase.everyYears), ...purchases] : purchases;
        starts.forEach((p, k) => {
          const next = k + 1 < starts.length ? (starts[k + 1] as MonthIndex) : addMonths(until, 1);
          for (let m = addMonths(p, 12 * firstAfter); m < next && m <= until; m = addMonths(m, 12 * every)) push(m, "cf.expense.living.car", at(inspection, m), "expense.car.inspection");
        });
      }
      // 保険（持っている間の毎年の購入の月）・自動車税（毎年5月）
      const anniversary = monthOf(first);
      for (let y = yearOf(ownedFrom); y <= yearOf(until); y++) {
        const im = monthIndex(y, anniversary);
        if (insurance !== null && im >= ownedFrom && im <= until) push(im, "cf.expense.insurance.nonLife", at(insurance, im), "expense.car.insurance");
        const tm = monthIndex(y, 5);
        if (tax !== null && tm >= ownedFrom && tm <= until) push(tm, "cf.expense.living.car", at(tax, tm), "expense.car.tax");
      }
    }
    return { flows, loans };
  },
});

// 周期的な支出（0008 の追記）: 最初の支払いの月から n年ごと（同じ月）に、1回の額（計算基準年の価格。伸び方で伸ばす）を払う。終わりの月まで。
// 万一のときの扱い（onContingency）は、世帯の万一の想定（contingency.event）の月の翌月から当てる（割合は万一の後の全期間で1つ。改訂2）
// 段階と例外の年（改訂3。0040）: 支払いの月の段の額（計算基準年の価格。割合の段は1回の額×割合）を、同じ伸び方で伸ばす。
// 例外の年は、その年の支払いだけ例外の額（計算基準年の価格）にする（0円は払わない。支払いの無い年に支払いを足さない）
import {
  addMonths,
  boxValue,
  contingencyRatio,
  defineComponent,
  formatYm,
  grownByYear,
  stagedYen,
  yearOf,
  yen,
  type Flow,
  type FlowsResult,
  type ContingencyEvent,
  type ContingencyEventOutput,
  type MonthIndex,
  type PeriodicExpenseInput,
  type Yen,
} from "../../sdk/index.ts";

export default defineComponent<Record<string, never>, FlowsResult>({
  id: "expense.periodic",
  title: "周期的な支出",
  contract: "1.0",
  revision: 3,
  requires: { "contingency.event": ">=1 <2" },
  params: [],
  reads: ["member.kind", "periodicExpense.onContingency", "periodicExpense.row", "periodicExpense.from", "periodicExpense.to", "periodicExpense.everyYears", "periodicExpense.amount", "periodicExpense.growth", "periodicExpense.stages", "periodicExpense.exceptions", "assumptions.inflation"],
  input: "empty.input",
  output: "flows.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const flows: Flow[] = [];
    const list = ctx.list<PeriodicExpenseInput>("periodicExpense");
    let ev: ContingencyEvent | null = null;
    if (list.some((e) => e.onContingency !== undefined)) {
      for (const m of ctx.list<{ id: string }>("member")) {
        ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: m.id }).event;
        if (ev !== null) break;
      }
    }
    for (const e of list) {
      const from = ctx.time.resolve(e.from);
      const to = e.to === undefined || e.to === null ? end : ctx.time.resolve(e.to);
      const amount = boxValue(e.amount) ?? yen(0);
      const staged = stagedYen(ctx, amount, e, "conv.expense.share");
      if ((amount <= 0 && !staged.anyPositive) || from > end) continue;
      // 計算基準年の価格の額ごとの、年ごとに伸ばした額（段階が無ければ1つの額だけ）
      const series = new Map<number, Map<number, Yen>>();
      const grownOf = (a: Yen): Map<number, Yen> => {
        let g = series.get(a);
        if (g === undefined) {
          g = grownByYear(ctx, a, e.growth, yearOf(base), yearOf(end));
          series.set(a, g);
        }
        return g;
      };
      for (let m: MonthIndex = from; m <= to && m <= end; m = addMonths(m, 12 * e.everyYears)) {
        if (m < base) continue;
        const a = staged.plain ? amount : staged.at(m);
        if (a <= 0) continue;
        const v0 = grownOf(a).get(yearOf(m)) ?? a;
        const cr = contingencyRatio(ctx, e.onContingency, ev, m);
        const v = cr === null ? v0 : ctx.money.mulRate(v0, cr, "conv.expense.share");
        if (v > 0) flows.push({ row: e.row, ym: formatYm(m), amount: v, accrualYear: yearOf(m), object: e.id, formula: cr === null ? "expense.periodic.payment" : "expense.periodic.contingency" });
      }
    }
    return { flows };
  },
});

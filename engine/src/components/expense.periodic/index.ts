// 周期的な支出（0008 の追記）: 最初の支払いの月から n年ごと（同じ月）に、1回の額（計算基準年の価格。伸び方で伸ばす）を払う。終わりの月まで。
// 万一のときの扱い（onContingency）は入力として持つだけ（万一の部品で使う）
import {
  addMonths,
  boxValue,
  defineComponent,
  formatYm,
  grownByYear,
  yearOf,
  yen,
  type Flow,
  type FlowsResult,
  type MonthIndex,
  type PeriodicExpenseInput,
} from "../../sdk/index.ts";

export default defineComponent<Record<string, never>, FlowsResult>({
  id: "expense.periodic",
  title: "周期的な支出",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: [],
  reads: ["periodicExpense.row", "periodicExpense.from", "periodicExpense.to", "periodicExpense.everyYears", "periodicExpense.amount", "periodicExpense.growth", "assumptions.inflation"],
  input: "empty.input",
  output: "flows.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const flows: Flow[] = [];
    for (const e of ctx.list<PeriodicExpenseInput>("periodicExpense")) {
      const from = ctx.time.resolve(e.from);
      const to = e.to === undefined || e.to === null ? end : ctx.time.resolve(e.to);
      const amount = boxValue(e.amount) ?? yen(0);
      if (amount <= 0 || from > end) continue;
      const grown = grownByYear(ctx, amount, e.growth, yearOf(base), yearOf(end));
      for (let m: MonthIndex = from; m <= to && m <= end; m = addMonths(m, 12 * e.everyYears)) {
        if (m < base) continue;
        const v = grown.get(yearOf(m)) ?? amount;
        flows.push({ row: e.row, ym: formatYm(m), amount: v, accrualYear: yearOf(m), object: e.id, formula: "expense.periodic.payment" });
      }
    }
    return { flows };
  },
});

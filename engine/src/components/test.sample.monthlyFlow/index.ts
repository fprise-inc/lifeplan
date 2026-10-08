// 【架空の見本】毎月の定額の収入・支出。土台が動くことを示すためのもの（実在の制度の計算ではない）
import { defineComponent, formatYm, yearOf, type Flow, type FlowInput, type MonthIndex } from "../../sdk/index.ts";

export default defineComponent<{ object: string }, { flows: Flow[] }>({
  id: "test.sample.monthlyFlow",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: [],
  reads: ["test.sample.flows"],
  replaceable: true,
  input: "test.sample.monthlyFlow.input",
  output: "flows.output",
  compute(input, ctx) {
    const f = ctx.readObject<FlowInput>("test.sample.flows", input.object);
    // 期間は始まりの月と終わりの月を含む（0003 の4）。表の範囲の外は作らない
    const from = ctx.time.resolve(f.from);
    const to = f.to === null ? ctx.time.end : ctx.time.resolve(f.to);
    const first = from > ctx.time.base ? from : ctx.time.base;
    const last = to < ctx.time.end ? to : ctx.time.end;
    const flows: Flow[] = [];
    for (let m = first; m <= last; m = (m + 1) as MonthIndex) {
      flows.push({
        row: f.row,
        ym: formatYm(m),
        amount: f.amount,
        accrualYear: yearOf(m),
        ...(f.member !== undefined ? { member: f.member } : {}),
        object: f.id,
        formula: "test.sample.monthlyFlow.fixed",
      });
    }
    return { flows };
  },
});

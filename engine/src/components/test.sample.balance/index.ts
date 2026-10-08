// 【架空の見本】残高の積み上げ。他の部品を部品表を通して呼び、年ごとの収支・運用益・残高を出す
import {
  addYen,
  defineComponent,
  formatYm,
  monthOf,
  netByYear,
  yearOf,
  yen,
  type AnnualRow,
  type Flow,
  type FlowsOutput,
  type Yen,
} from "../../sdk/index.ts";

export default defineComponent<Record<string, never>, { flows: Flow[]; annual: AnnualRow[] }>({
  id: "test.sample.balance",
  contract: "1.0",
  revision: 1,
  requires: { "test.sample.monthlyFlow": "1", "test.sample.lumpSum": "1" },
  params: [],
  reads: ["test.sample.flows", "test.sample.annualLumpSums", "test.sample.openingBalance", "assumptions.investmentReturn"],
  slots: ["slot.expense.flow"],
  input: "test.sample.balance.input",
  output: "test.sample.balance.output",
  compute(_input, ctx) {
    const flows: Flow[] = [];
    for (const f of ctx.read<readonly { id: string }[]>("test.sample.flows")) {
      flows.push(...ctx.call<FlowsOutput>("test.sample.monthlyFlow", { object: f.id }).flows);
    }
    for (const l of ctx.read<readonly { id: string }[]>("test.sample.annualLumpSums")) {
      flows.push(...ctx.call<FlowsOutput>("test.sample.lumpSum", { object: l.id }).flows);
    }
    const { base, end } = ctx.time;
    for (const out of ctx.slot("slot.expense.flow", { fromMonth: formatYm(base), toMonth: formatYm(end) })) flows.push(...out.flows);

    const { aggregation, investmentTiming } = ctx.conventions;
    const net = netByYear(flows, aggregation, base, end);
    let balance = ctx.read<Yen>("test.sample.openingBalance");
    const annual: AnnualRow[] = [];
    for (let y = yearOf(base); y <= yearOf(end); y++) {
      const n = net.get(y) ?? yen(0);
      // 0003 の3: 運用益＝期首残高×年利＋その年の収支×年利×1/2（midYear）。初年度は残りの月数÷12 で按分（0003 の5）
      const months = y === yearOf(base) ? 13 - monthOf(base) : 12;
      const r = ctx.rate.fraction(ctx.assumption("investmentReturn", y));
      const [amount, half] =
        investmentTiming === "midYear" ? [addYen(addYen(balance, balance), n), 2n] : investmentTiming === "beginning" ? [addYen(balance, n), 1n] : [balance, 1n];
      // 1回の丸めで計算する: amount × 年利 × months/12 (/2)
      const ret = ctx.money.mulRatio(amount, r.num * BigInt(months), r.den * 12n * half, "conv.investment.return");
      balance = addYen(addYen(balance, n), ret);
      annual.push(
        { row: "cf.net", year: y, amount: n, formula: "test.sample.balance.net" },
        { row: "cf.balance.return", year: y, amount: ret, formula: "test.sample.balance.return" },
        { row: "cf.balance.financial", year: y, amount: balance, formula: "test.sample.balance.closing" },
      );
    }
    return { flows, annual };
  },
});


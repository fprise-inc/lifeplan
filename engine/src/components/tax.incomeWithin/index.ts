// 合計所得金額が上限（扶養親族・同一生計配偶者の所得の要件など）以下か。要件を満たすかだけを読むための小さな部品（0006 の追記）
import { defineComponent, type TotalIncomeOutput, type Yen } from "../../sdk/index.ts";

export default defineComponent<{ member: string; year: number; limit: Yen }, { within: boolean }>({
  id: "tax.incomeWithin",
  title: "合計所得金額が上限以下か",
  contract: "1.0",
  revision: 1,
  requires: { "tax.totalIncome": ">=1 <2" },
  params: [],
  reads: [],
  input: "tax.incomeWithin.input",
  output: "tax.incomeWithin.output",
  compute(input, ctx) {
    return { within: ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: input.member, year: input.year }).total <= input.limit };
  },
});

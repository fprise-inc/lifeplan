// 2人の合計所得金額の大小（a が多ければ 1、同じなら 0、少なければ -1）。控除を受ける人（夫婦のうち所得の多い方）を決める部品が、
// 所得の額そのものではなく大小だけを読むための小さな部品（0006 の追記: 配偶者の年収が変わっても大小が同じなら、本人の控除を計算し直さない）
import { defineComponent, type TotalIncomeOutput } from "../../sdk/index.ts";

export default defineComponent<{ a: string; b: string; year: number }, { order: -1 | 0 | 1 }>({
  id: "tax.incomeOrder",
  title: "合計所得金額の大小",
  contract: "1.0",
  revision: 1,
  requires: { "tax.totalIncome": ">=1 <2" },
  params: [],
  reads: [],
  input: "tax.incomeOrder.input",
  output: "tax.incomeOrder.output",
  compute(input, ctx) {
    const a = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: input.a, year: input.year }).total;
    const b = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: input.b, year: input.year }).total;
    return { order: a > b ? 1 : a < b ? -1 : 0 };
  },
});

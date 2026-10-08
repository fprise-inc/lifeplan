// 合計所得金額（いまは給与所得だけ。年金・事業などの所得は次の作業）
import { defineComponent, type EmploymentIncomeOutput, type TotalIncomeOutput } from "../../sdk/index.ts";

export default defineComponent<{ member: string; year: number }, TotalIncomeOutput>({
  id: "tax.totalIncome",
  title: "合計所得金額",
  contract: "1.0",
  revision: 1,
  requires: { "tax.employmentIncome": ">=1 <2" },
  params: [],
  reads: [],
  input: "tax.memberYear.input",
  output: "tax.totalIncome.output",
  compute(input, ctx) {
    const e = ctx.call<EmploymentIncomeOutput>("tax.employmentIncome", input);
    return { total: e.income, employment: e.income };
  },
});

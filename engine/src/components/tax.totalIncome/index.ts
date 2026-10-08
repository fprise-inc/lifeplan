// 合計所得金額＝給与所得（所得金額調整控除の後）＋公的年金等に係る雑所得＋その他の所得（事業所得）。
// 所得の区分は給与・公的年金等・その他（0008 の追記）。給与と公的年金等の両方があるときは、
// 給与所得（10万円まで）＋公的年金等に係る雑所得（10万円まで）−10万円 を給与所得から引く（所得金額調整控除）
import {
  defineComponent,
  monthIndex,
  yen,
  type BusinessOutput,
  type EmploymentIncomeOutput,
  type PublicPensionIncomeOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const ADJUST = "incomeTax.incomeAdjustment.salaryAndPension.limit";

export default defineComponent<{ member: string; year: number }, TotalIncomeOutput>({
  id: "tax.totalIncome",
  title: "合計所得金額",
  contract: "1.1",
  revision: 2,
  requires: { "tax.employmentIncome": ">=1 <2", "tax.publicPensionIncome": ">=1 <2", "income.business": ">=1 <2" },
  params: [ADJUST],
  reads: [],
  input: "tax.memberYear.input",
  output: "tax.totalIncome.output",
  compute(input, ctx) {
    const e = ctx.call<EmploymentIncomeOutput>("tax.employmentIncome", input);
    const p = ctx.call<PublicPensionIncomeOutput>("tax.publicPensionIncome", input);
    const other = ctx.call<BusinessOutput>("income.business", { member: input.member }).byYear.find((b) => b.year === input.year)?.income ?? yen(0);
    let employment = e.income;
    let adjustment = yen(0);
    if (employment > 0 && p.income > 0) {
      const limit = ctx.at(monthIndex(input.year, 1)).paramYen(ADJUST);
      if (limit !== null) {
        const v = Math.min(employment, limit) + Math.min(p.income, limit) - limit;
        if (v > 0) {
          adjustment = yen(v);
          employment = yen(employment - adjustment);
        }
      }
    }
    const total: Yen = yen(employment + p.income + other);
    return { total, employment, publicPension: p.income, other, adjustment };
  },
});

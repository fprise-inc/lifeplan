// 公的年金等に係る雑所得＝公的年金等の収入−公的年金等控除額（所得税法35条。住民税も同じ年分の計算による）
// 控除額は、その年の12月31日の年齢（65歳未満・以上）と、公的年金等に係る雑所得以外の所得の合計所得金額（1,000万円以下・2,000万円以下・超）
// の表（収入×率＋額）。令和9年分からは、給与所得控除額と公的年金等控除額の合計が上限を超える分を公的年金等控除額から除く
import {
  ageMonth,
  bracketFor,
  defineComponent,
  monthIndex,
  paymentsInYear,
  RATE_ZERO,
  subYen,
  yen,
  type BusinessOutput,
  type EmploymentIncomeOutput,
  type PensionOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  age: "incomeTax.publicPensionDeduction.elderlyAge",
  limit1: "incomeTax.publicPensionDeduction.otherIncomeLimit1",
  limit2: "incomeTax.publicPensionDeduction.otherIncomeLimit2",
  combined: "incomeTax.publicPensionDeduction.combinedLimit",
};
const table = (elderly: boolean, tier: number) => `incomeTax.publicPensionDeduction.${elderly ? "over65" : "under65"}.tier${tier}`;

export default defineComponent<{ member: string; year: number }, { revenue: Yen; deduction: Yen; income: Yen }>({
  id: "tax.publicPensionIncome",
  title: "公的年金等に係る雑所得",
  contract: "1.0",
  revision: 1,
  requires: { "pension.oldAge": ">=1 <2", "tax.employmentIncome": ">=1 <2", "income.business": ">=1 <2" },
  params: [...Object.values(P), ...[false, true].flatMap((e) => [1, 2, 3].map((t) => table(e, t)))],
  reads: [],
  input: "tax.memberYear.input",
  output: "tax.publicPensionIncome.output",
  compute(input, ctx) {
    const { member, year } = input;
    let revenue = yen(0);
    for (const p of paymentsInYear(ctx.call<PensionOutput>("pension.oldAge", { member }).payments, year)) revenue = yen(revenue + p.amount);
    if (revenue === 0) return { revenue, deduction: yen(0), income: yen(0) };
    const at = ctx.at(monthIndex(year, 1));
    const elderly = ageMonth(ctx, monthIndex(year, 1), P.age, member) <= monthIndex(year, 12);
    const emp = ctx.call<EmploymentIncomeOutput>("tax.employmentIncome", input);
    const business = ctx.call<BusinessOutput>("income.business", { member }).byYear.find((b) => b.year === year)?.income ?? yen(0);
    const other = yen(emp.income + business);
    const tier = other <= (at.paramYen(P.limit1) ?? 0) ? 1 : other <= (at.paramYen(P.limit2) ?? 0) ? 2 : 3;
    const b = bracketFor(at.paramBrackets(table(elderly, tier)) ?? [], revenue);
    const variable = b.rate === undefined || ctx.rate.compare(b.rate, RATE_ZERO) === 0 ? yen(0) : ctx.money.mulRate(revenue, b.rate, "conv.tax.fractionalDeduction");
    let deduction = yen(variable + (b.amount ?? 0));
    const combined = at.paramYen(P.combined);
    if (combined !== null && emp.deduction > 0 && emp.deduction + deduction > combined) {
      const over = emp.deduction + deduction - combined;
      deduction = yen(deduction > over ? deduction - over : 0);
    }
    if (deduction > revenue) deduction = revenue;
    return { revenue, deduction, income: subYen(revenue, deduction) };
  },
});

// 給与所得＝給与収入−給与所得控除額（所得税法28条。住民税も同じ年分の計算による）
// revenue を渡すと、その給与収入で計算する（年の途中で辞めた年の源泉徴収の近似に使う）
// 給与収入が別表第五の範囲（660万円未満）で控除額が式の段にあるときは、収入金額を4,000円単位に切り下げてから計算する
import {
  bracketFor,
  defineComponent,
  monthIndex,
  parseYm,
  RATE_ZERO,
  subYen,
  yearOf,
  yen,
  type Bracket,
  type Ctx,
  type EmploymentIncomeOutput,
  type SalaryOutput,
  type Yen,
} from "../../sdk/index.ts";

const TABLE = "incomeTax.employmentIncomeDeduction";
const TABLE_BELOW = "incomeTax.employmentIncome.tableBelow";
const TABLE_ROUNDING = "incomeTax.employmentIncome.tableRounding";

function deductionOf(ctx: Ctx, b: Bracket, revenue: Yen): Yen {
  // 控除額＝収入×率＋加算額（率の無い段は定額）
  const variable = b.rate === undefined || ctx.rate.compare(b.rate, RATE_ZERO) === 0 ? yen(0) : ctx.money.mulRate(revenue, b.rate, "conv.tax.fractionalDeduction");
  return yen(variable + (b.amount ?? 0));
}

export default defineComponent<{ member: string; year: number; revenue?: number }, EmploymentIncomeOutput>({
  id: "tax.employmentIncome",
  title: "給与所得",
  contract: "1.1",
  revision: 2,
  requires: { "income.salary": ">=1 <2" },
  params: [TABLE, TABLE_BELOW, TABLE_ROUNDING],
  reads: [],
  input: "tax.employmentIncome.input",
  output: "tax.employmentIncome.output",
  compute(input, ctx) {
    let revenue = yen(0);
    if (input.revenue !== undefined) revenue = yen(input.revenue);
    else {
      const { payments } = ctx.call<SalaryOutput>("income.salary", { member: input.member });
      for (const p of payments) if (yearOf(parseYm(p.ym)) === input.year) revenue = yen(revenue + p.salary + p.bonus);
    }
    if (revenue === 0) return { revenue, deduction: yen(0), income: yen(0) };
    const at = ctx.at(monthIndex(input.year, 1));
    const table = at.paramBrackets(TABLE) ?? [];
    let b = bracketFor(table, revenue);
    let base = revenue;
    const below = at.paramYen(TABLE_BELOW);
    if (below !== null && revenue < below && b.rate !== undefined && ctx.rate.compare(b.rate, RATE_ZERO) !== 0) {
      base = at.money.round(revenue, TABLE_ROUNDING);
      b = bracketFor(table, base);
    }
    const deduction = deductionOf(ctx, b, base);
    const income = deduction >= base ? yen(0) : subYen(base, deduction);
    return { revenue, deduction: subYen(revenue, income), income };
  },
});

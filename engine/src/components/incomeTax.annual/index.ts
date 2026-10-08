// 所得税（復興特別所得税・防衛特別所得税を含む）。給与所得者は年末調整で年税額を精算するとみなし、
// 年税額をその年の給与の支払いの月に、支払額の割合で分けて載せる（端数は最後の支払いの月）
import {
  bracketFor,
  defineComponent,
  monthIndex,
  parseYm,
  subYen,
  yearOf,
  yen,
  type DeductionsOutput,
  type Flow,
  type IncomeTaxOutput,
  type SalaryOutput,
  type TotalIncomeOutput,
} from "../../sdk/index.ts";

const ZERO = { flows: [], total: yen(0), taxable: yen(0), computedTax: yen(0), reconstructionSurtax: yen(0), defenseSurtax: yen(0) };

export default defineComponent<{ member: string; year: number }, IncomeTaxOutput>({
  id: "incomeTax.annual",
  title: "所得税",
  contract: "1.0",
  revision: 1,
  requires: { "tax.totalIncome": ">=1 <2", "tax.deductions": ">=1 <2", "income.salary": ">=1 <2" },
  params: [
    "incomeTax.taxRateTable",
    "incomeTax.taxableIncome.rounding",
    "incomeTax.reconstructionSurtax.rate",
    "incomeTax.defenseSurtax.rate",
    "incomeTax.surtax.rounding",
    "incomeTax.taxAmount.rounding",
  ],
  reads: [],
  input: "tax.memberYear.input",
  output: "incomeTax.annual.output",
  compute(input, ctx) {
    const { member, year } = input;
    const total = ctx.call<TotalIncomeOutput>("tax.totalIncome", input).total;
    if (total <= 0) return ZERO;
    const ded = ctx.call<DeductionsOutput>("tax.deductions", { member, year, regime: "incomeTax" });
    const at = ctx.at(monthIndex(year, 1));
    const taxable = at.money.round(total > ded.total ? subYen(total, ded.total) : yen(0), "incomeTax.taxableIncome.rounding");
    // 算出税額＝課税所得金額×税率−控除額（速算表）
    const b = bracketFor(at.paramBrackets("incomeTax.taxRateTable") ?? [], taxable);
    const computed = b.rate === undefined ? yen(0) : subYen(ctx.money.mulRate(taxable, b.rate, "conv.tax.exact"), b.amount ?? yen(0));
    const base = computed > 0 ? computed : yen(0);
    // 基準所得税額×率（1円未満切り捨て）を足し、100円未満を切り捨てる
    const surtax = (id: string) => {
      const r = at.paramRate(id);
      return r === null ? yen(0) : at.money.mulRate(base, r, "incomeTax.surtax.rounding");
    };
    const reconstructionSurtax = surtax("incomeTax.reconstructionSurtax.rate");
    const defenseSurtax = surtax("incomeTax.defenseSurtax.rate");
    const annual = at.money.round(yen(base + reconstructionSurtax + defenseSurtax), "incomeTax.taxAmount.rounding");
    const detail = { taxable, computedTax: base, reconstructionSurtax, defenseSurtax };
    if (annual <= 0) return { ...ZERO, ...detail };
    const pays = ctx
      .call<SalaryOutput>("income.salary", { member })
      .payments.filter((p) => yearOf(parseYm(p.ym)) === year && p.salary + p.bonus > 0);
    if (pays.length === 0) return { flows: [], total: annual, ...detail };
    // 同じ月の支払い（期間をまたぐ月）はまとめる
    const months = [...new Set(pays.map((p) => p.ym))];
    const weights = months.map((ym) => pays.filter((p) => p.ym === ym).reduce((s, p) => s + p.salary + p.bonus, 0));
    const parts = ctx.money.allocate(annual, weights, "conv.tax.allocate", "last");
    const flows: Flow[] = months.map((ym, i) => ({
      row: "cf.taxSi.incomeTax",
      ym,
      amount: parts[i] as never,
      accrualYear: year,
      member,
      formula: "incomeTax.annual.withholding",
    }));
    return { flows: flows.filter((f) => f.amount > 0), total: annual, ...detail };
  },
});

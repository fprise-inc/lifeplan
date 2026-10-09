// 所得税（復興特別所得税・防衛特別所得税を含む）。年税額をどの月に払うかは次のとおり（0003 の追記）。
// - 給与だけで、12月に給与を受ける年（年末調整を受ける年）: 年税額をその年の給与の支払いの月に支払額の割合で分ける（端数は最後の月）
// - それ以外の年（年の途中で辞めた年・年金や事業の所得がある年）: 源泉徴収とみなす額を支払いの月に載せ、年税額との差を翌年3月に
//   確定申告で精算する（還付は負の額）。給与の源泉徴収は、年末調整を受ける年は給与だけの年税額、受けない年はその年の給与を
//   12か月分に換算した収入の年税額を、給与の月数の割合にした額（月額表の近似）。年金の源泉徴収は年金だけの年税額（近似）。
//   公的年金等の収入が400万円以下でその他の所得が20万円以下なら、追加の納付は申告しない（確定申告不要制度）
// 税額控除の差し込み口: 住宅借入金等特別控除（tax.housingLoanCredit）を算出税額（基準所得税額）から引き、付加税はその後の額に掛ける。
//   入居の年は確定申告で受ける（源泉徴収とみなす額は控除の前の額にし、翌年3月の精算で還付）。2年目からは年末調整を受ける年は年末調整で、
//   受けない年は確定申告で受ける。引ききれなかった額（creditRemainder）は翌年度の住民税から引く（residentTax.annual）
import {
  bracketFor,
  defineComponent,
  formatYm,
  monthIndex,
  subYen,
  yearOf,
  yen,
  type DeductionsOutput,
  type EmploymentIncomeOutput,
  type Flow,
  type HousingLoanCreditOutput,
  type IncomeTaxOutput,
  type MonthCtx,
  type Ctx,
  type PensionOutput,
  type SalaryOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const ZERO = { flows: [], total: yen(0), taxable: yen(0), computedTax: yen(0), reconstructionSurtax: yen(0), defenseSurtax: yen(0) };
const NO_CREDIT: HousingLoanCreditOutput = { credit: yen(0), firstYear: false, residentRate: null, residentLimit: null };
const FILING = { revenue: "incomeTax.pensionFilingExemption.revenueLimit", other: "incomeTax.pensionFilingExemption.otherIncomeLimit" };

interface Tax {
  readonly taxable: Yen;
  readonly computedTax: Yen;
  readonly reconstructionSurtax: Yen;
  readonly defenseSurtax: Yen;
  readonly annual: Yen;
  /** 引いた税額控除 */
  readonly used: Yen;
}

/**
 * 合計所得金額と所得控除の合計から年税額（課税所得金額×税率−控除額＝算出税額から税額控除を引いた基準所得税額に、
 * 基準所得税額×率の付加税を足して100円未満を切り捨て）
 */
function taxOf(ctx: Ctx, at: MonthCtx, total: Yen, deductions: Yen, credit: Yen = yen(0)): Tax {
  const taxable = at.money.round(total > deductions ? subYen(total, deductions) : yen(0), "incomeTax.taxableIncome.rounding");
  const b = bracketFor(at.paramBrackets("incomeTax.taxRateTable") ?? [], taxable);
  const computed = b.rate === undefined ? yen(0) : subYen(ctx.money.mulRate(taxable, b.rate, "conv.tax.exact"), b.amount ?? yen(0));
  const gross = computed > 0 ? computed : yen(0);
  const used = credit < gross ? credit : gross;
  const base = yen(gross - used);
  const surtax = (id: string) => {
    const r = at.paramRate(id);
    return r === null ? yen(0) : at.money.mulRate(base, r, "incomeTax.surtax.rounding");
  };
  const reconstructionSurtax = surtax("incomeTax.reconstructionSurtax.rate");
  const defenseSurtax = surtax("incomeTax.defenseSurtax.rate");
  const annual = at.money.round(yen(base + reconstructionSurtax + defenseSurtax), "incomeTax.taxAmount.rounding");
  return { taxable, computedTax: gross, reconstructionSurtax, defenseSurtax, annual, used };
}

/** 合計を重みで支払いの月に分ける（端数は最後の月） */
function spread(ctx: Ctx, total: Yen, items: readonly { ym: string; weight: number }[], member: string, year: number, formula: string): Flow[] {
  if (total === 0 || items.length === 0) return [];
  const months = [...new Set(items.map((p) => p.ym))].sort();
  const weights = months.map((ym) => items.filter((p) => p.ym === ym).reduce((s, p) => s + p.weight, 0));
  if (weights.every((w) => w === 0)) return [];
  const parts = ctx.money.allocate(total, weights, "conv.tax.allocate", "last");
  return months.map((ym, i) => ({ row: "cf.taxSi.incomeTax", ym, amount: parts[i] as Yen, accrualYear: year, member, formula })).filter((f) => f.amount !== 0);
}

export default defineComponent<{ member: string; year: number }, IncomeTaxOutput>({
  id: "incomeTax.annual",
  title: "所得税",
  contract: "1.1",
  revision: 4,
  requires: {
    "tax.totalIncome": ">=1 <2",
    "tax.housingLoanCreditYears": ">=1 <2",
    "tax.housingLoanCredit": ">=1 <2",
    "tax.deductions": ">=1 <2",
    "tax.employmentIncome": ">=1 <2",
    "income.salary": ">=1 <2",
    "pension.oldAge": ">=1 <2",
    "socialInsurance.health": ">=1 <2",
    "socialInsurance.pension": ">=1 <2",
    "socialInsurance.employment": ">=1 <2",
  },
  params: [
    "incomeTax.taxRateTable",
    "incomeTax.taxableIncome.rounding",
    "incomeTax.reconstructionSurtax.rate",
    "incomeTax.defenseSurtax.rate",
    "incomeTax.surtax.rounding",
    "incomeTax.taxAmount.rounding",
    FILING.revenue,
    FILING.other,
  ],
  reads: [],
  input: "tax.memberYear.input",
  output: "incomeTax.annual.output",
  compute(input, ctx) {
    const { member, year } = input;
    const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", input);
    const total = inc.total;
    if (total <= 0) return ZERO;
    const ded = ctx.call<DeductionsOutput>("tax.deductions", { member, year, regime: "incomeTax" });
    const at = ctx.at(monthIndex(year, 1));
    // 税額控除（住宅借入金等特別控除）
    // （控除を受けうる年分の範囲だけ控除の部品を呼ぶ）
    const window = ctx.call<{ from: number | null; to: number | null }>("tax.housingLoanCreditYears", { member });
    const hc = window.from !== null && window.to !== null && year >= window.from && year <= window.to ? ctx.call<HousingLoanCreditOutput>("tax.housingLoanCredit", { member, year }) : NO_CREDIT;
    const credit = hc.credit;
    const t = taxOf(ctx, at, total, ded.total, credit);
    const annual = t.annual;
    const detail = {
      taxable: t.taxable,
      computedTax: t.computedTax,
      reconstructionSurtax: t.reconstructionSurtax,
      defenseSurtax: t.defenseSurtax,
      ...(credit > 0 ? { housingLoanCredit: t.used, creditRemainder: yen(credit - t.used) } : {}),
    };
    // その年の支払いだけを読む（ほかの年の給与・年金が変わっても、この年の税は計算し直さない）
    const jan = monthIndex(year, 1);
    const dec = monthIndex(year, 12);
    const salaryPays = ctx.callMonths<SalaryOutput["payments"][number]>("income.salary", { member }, "payments", jan, dec)
      .filter((p) => p.salary + p.bonus > 0)
      .map((p) => ({ ym: p.ym, weight: p.salary + p.bonus }));
    const pensionPays = ctx.callMonths<PensionOutput["payments"][number]>("pension.oldAge", { member }, "payments", jan, dec).map((p) => ({ ym: p.ym, weight: p.amount as number }));
    const yearEnd = salaryPays.some((p) => p.ym === formatYm(monthIndex(year, 12)));
    const pensionIncome = inc.publicPension ?? yen(0);
    const other = inc.other ?? yen(0);
    // 年末調整で受ける税額控除（入居の年は確定申告で受ける）
    const adjustedCredit = yearEnd && !hc.firstYear ? credit : yen(0);
    // 給与だけで年末調整を受け、税額控除も年末調整で受ける年（これまでどおり）
    if (yearEnd && pensionIncome === 0 && other === 0 && adjustedCredit === credit) {
      if (annual <= 0) return { ...ZERO, ...detail };
      return { flows: spread(ctx, annual, salaryPays, member, year, "incomeTax.annual.withholding"), total: annual, ...detail };
    }
    // 源泉徴収とみなす額
    let withheldSalary = yen(0);
    if (salaryPays.length > 0) {
      if (yearEnd) withheldSalary = taxOf(ctx, at, inc.employment, ded.total, adjustedCredit).annual;
      else {
        // 年の途中で辞めた年: その年の給与を12か月分に換算した収入の年税額×給与の月数/12（源泉徴収税額表の近似）
        const months = new Set(salaryPays.map((p) => p.ym)).size;
        const revenue = salaryPays.reduce((s, p) => s + p.weight, 0);
        const annualized = ctx.money.mulRatio(yen(revenue), 12, months, "conv.tax.exact");
        const e = ctx.call<EmploymentIncomeOutput>("tax.employmentIncome", { member, year, revenue: annualized });
        // 社会保険料は給与から控除された分（被用者保険）を12か月分に換算する
        let withheldSi = 0;
        for (const c of ["socialInsurance.health", "socialInsurance.pension", "socialInsurance.employment"]) {
          for (const f of ctx.call<{ flows: readonly Flow[] }>(c, { member, fromYear: year < yearOf(ctx.time.base) ? year : yearOf(ctx.time.base) }).flows) {
            if (f.ym.startsWith(`${year}-`) && f.member === member) withheldSi += f.amount;
          }
        }
        const si = ctx.money.mulRatio(yen(withheldSi), 12, months, "conv.tax.exact");
        const personal = yen(ded.basic + ded.spouse + ded.spouseSpecial + ded.dependents + ded.specifiedRelative);
        withheldSalary = ctx.money.mulRatio(taxOf(ctx, at, e.income, yen(personal + si)).annual, months, 12, "conv.tax.exact");
      }
    }
    const withheldPension = pensionPays.length > 0 ? taxOf(ctx, at, pensionIncome, ded.total).annual : yen(0);
    const flows: Flow[] = [
      ...spread(ctx, withheldSalary, salaryPays, member, year, "incomeTax.annual.withholding"),
      ...spread(ctx, withheldPension, pensionPays, member, year, "incomeTax.annual.pensionWithholding"),
    ];
    let settlement = yen(annual - withheldSalary - withheldPension);
    // 確定申告不要制度: 年金の収入が400万円以下で、その他の所得が20万円以下なら、追加の納付は申告しない（還付は申告する）
    const pensionRevenue = pensionPays.reduce((s, p) => s + p.weight, 0);
    const revenueLimit = at.paramYen(FILING.revenue);
    const otherLimit = at.paramYen(FILING.other);
    const exempt = pensionPays.length > 0 && revenueLimit !== null && otherLimit !== null && pensionRevenue <= revenueLimit && inc.employment + other <= otherLimit;
    if (exempt && settlement > 0) settlement = yen(0);
    if (settlement !== 0) {
      flows.push({ row: "cf.taxSi.incomeTax", ym: formatYm(monthIndex(year + 1, 3)), amount: settlement, accrualYear: year, member, formula: "incomeTax.annual.settlement" });
    }
    return { flows, total: exempt ? yen(withheldSalary + withheldPension + (settlement < 0 ? settlement : 0)) : annual, ...detail };
  },
});

// 住民税（所得割・均等割）と森林環境税。前年の所得に対して、6月から翌年5月に払う（0003 の2）
// 所得割は全国一律の標準税率（市町村民税・道府県民税）で計算し、調整控除を引いて、それぞれ100円未満を切り捨てる。
// 給与所得者（その年度の6月に給与を受ける人）は特別徴収（6月〜翌年5月の12回）。辞めた後の残りは最後の給与の月にまとめる。
// それ以外は普通徴収（6月・8月・10月・翌年1月の4回）。
// 非課税限度額（residentTax.exemption）以下なら均等割・所得割をかけない。指定都市の税率の配分・超過課税は扱わない（notices）。
// 年金からの特別徴収: 年度の初日に65歳以上で、年金が年18万円以上なら、公的年金等に係る所得割（所得割×公的年金等に係る雑所得÷合計所得金額）と
// （給与からの特別徴収が無ければ）均等割・森林環境税を年金から差し引く。前の年度に年金から差し引いていなければ、6月・8月に4分の1ずつ普通徴収し、
// 10月・12月・2月に6分の1ずつ。前の年度から続くときは、4月・6月・8月に前の年度の年金の分の6分の1ずつ（仮徴収）、10月・12月・2月に残りを3分の1ずつ
import {
  ageMonth,
  boxValue,
  pensionSpecial,
  PENSION_SPECIAL_MINIMUM,
  defineComponent,
  formatYm,
  monthIndex,
  subYen,
  yen,
  type Ctx,
  type DeductionsOutput,
  type ExemptionOutput,
  type Flow,
  type LevyPair,
  type ResidentTaxAssessmentInput,
  type ResidentTaxOutput,
  type SalaryOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const CALC = "residentTax.incomeLevy.calc.rounding";
const LEVY = "residentTax.incomeLevy.rounding";
const PENSION_AGE = "residentTax.pensionSpecialCollection.age";

type Levy = Omit<ResidentTaxOutput, "flows" | "assessed">;
const PAIR0: LevyPair = { municipal: yen(0), prefectural: yen(0) };

function levy(ctx: Ctx, fiscalYear: number, member: string, incomeYear: number, total: Yen): Levy {
  const ded = ctx.call<DeductionsOutput>("tax.deductions", { member, year: incomeYear, regime: "residentTax" });
  const at = ctx.at(monthIndex(fiscalYear, 6));
  const taxable = at.money.round(total > ded.total ? subYen(total, ded.total) : yen(0), "residentTax.taxableIncome.rounding");
  // 調整控除: 合計課税所得金額が200万円以下なら min(人的控除額の差の合計, 合計課税所得金額)、超えるなら
  // 差の合計−(合計課税所得金額−200万円)（5万円を下回るときは5万円）に、市町村民税3%・道府県民税2%を掛ける
  let creditBase = yen(0);
  const incomeLimit = at.paramYen("residentTax.adjustmentCredit.incomeLimit");
  if (taxable > 0 && (incomeLimit === null || total <= incomeLimit)) {
    const threshold = at.paramYen("residentTax.adjustmentCredit.threshold") ?? yen(0);
    const minimum = at.paramYen("residentTax.adjustmentCredit.minimumBase") ?? yen(0);
    const d = ded.personalDiff;
    if (taxable <= threshold) creditBase = d < taxable ? d : taxable;
    else {
      const v = d - (taxable - threshold);
      creditBase = yen(v > minimum ? v : minimum);
    }
  }
  const part = (rateId: string, creditId: string): [Yen, Yen, Yen] => {
    const r = at.paramRate(rateId);
    const cr = at.paramRate(creditId);
    const gross = r === null ? yen(0) : at.money.mulRate(taxable, r, CALC);
    const credit = cr === null ? yen(0) : at.money.mulRate(creditBase, cr, CALC);
    return [gross, credit, at.money.round(gross > credit ? subYen(gross, credit) : yen(0), LEVY)];
  };
  const [gm, cm, lm] = part("residentTax.incomeLevy.municipalRate", "residentTax.adjustmentCredit.municipalRate");
  const [gp, cp, lp] = part("residentTax.incomeLevy.prefecturalRate", "residentTax.adjustmentCredit.prefecturalRate");
  const perCapita = { municipal: at.paramYen("residentTax.perCapita.municipal") ?? yen(0), prefectural: at.paramYen("residentTax.perCapita.prefectural") ?? yen(0) };
  const forest = at.paramYen("forestEnvironmentTax.amount") ?? yen(0);
  return {
    total: yen(lm + lp + perCapita.municipal + perCapita.prefectural + forest),
    taxable,
    grossLevy: { municipal: gm, prefectural: gp },
    adjustmentCredit: { municipal: cm, prefectural: cp },
    incomeLevy: { municipal: lm, prefectural: lp },
    perCapita,
    forestEnvironmentTax: forest,
  };
}

const NONE: Levy = { total: yen(0), taxable: yen(0), grossLevy: PAIR0, adjustmentCredit: PAIR0, incomeLevy: PAIR0, perCapita: PAIR0, forestEnvironmentTax: yen(0) };

export default defineComponent<{ member: string; fiscalYear: number }, ResidentTaxOutput>({
  id: "residentTax.annual",
  title: "住民税・森林環境税",
  contract: "1.0",
  revision: 2,
  requires: {
    "tax.totalIncome": ">=1 <2",
    "tax.deductions": ">=1 <2",
    "income.salary": ">=1 <2",
    "residentTax.exemption": ">=1 <2",
    "pension.oldAge": ">=1 <2",
  },
  params: [
    "residentTax.taxableIncome.rounding",
    CALC,
    LEVY,
    "residentTax.incomeLevy.municipalRate",
    "residentTax.incomeLevy.prefecturalRate",
    "residentTax.adjustmentCredit.incomeLimit",
    "residentTax.adjustmentCredit.threshold",
    "residentTax.adjustmentCredit.minimumBase",
    "residentTax.adjustmentCredit.municipalRate",
    "residentTax.adjustmentCredit.prefecturalRate",
    "residentTax.perCapita.municipal",
    "residentTax.perCapita.prefectural",
    "forestEnvironmentTax.amount",
    PENSION_AGE,
    PENSION_SPECIAL_MINIMUM,
  ],
  reads: ["residentTaxAssessment.member", "residentTaxAssessment.fiscalYear", "residentTaxAssessment.amount", "residentTaxAssessment.collection"],
  input: "residentTax.annual.input",
  output: "residentTax.annual.output",
  compute(input, ctx) {
    const { member, fiscalYear } = input;
    const incomeYear = fiscalYear - 1;
    const given = ctx.list<ResidentTaxAssessmentInput>("residentTaxAssessment").find((a) => a.member === member && a.fiscalYear === fiscalYear);
    const paid = new Set(
      ctx
        .call<SalaryOutput>("income.salary", { member })
        .payments.filter((p) => p.salary > 0)
        .map((p) => p.ym),
    );
    const salarySpecial = (fy: number, g: ResidentTaxAssessmentInput | undefined) =>
      g?.collection !== undefined ? g.collection === "special" : paid.has(formatYm(monthIndex(fy, 6)));
    // 年度の税額と、そのうち年金から差し引く額
    const assess = (fy: number): { detail: Levy; assessed: boolean; pension: Yen } => {
      const g = ctx.list<ResidentTaxAssessmentInput>("residentTaxAssessment").find((a) => a.member === member && a.fiscalYear === fy);
      const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year: fy - 1 });
      let detail: Levy;
      if (g !== undefined) detail = { ...NONE, total: boxValue(g.amount) ?? yen(0) };
      else {
        if (inc.total <= 0) return { detail: NONE, assessed: false, pension: yen(0) };
        ctx.notice("N_NOT_SUPPORTED", ["residentTax.designatedCityAllocation", "residentTax.excessTaxation"]);
        const ex = ctx.call<ExemptionOutput>("residentTax.exemption", { member, fiscalYear: fy });
        if (ex.perCapitaExempt) return { detail: NONE, assessed: false, pension: yen(0) };
        detail = levy(ctx, fy, member, fy - 1, inc.total);
        if (ex.incomeLevyExempt) {
          const pc = detail.perCapita;
          detail = { ...NONE, perCapita: pc, forestEnvironmentTax: detail.forestEnvironmentTax, total: yen(pc.municipal + pc.prefectural + detail.forestEnvironmentTax) };
        }
      }
      // 年金からの特別徴収
      const start = monthIndex(fy, 4);
      const eligible = ageMonth(ctx, start, PENSION_AGE, member) <= start && pensionSpecial(ctx, member, fy);
      let pension = yen(0);
      if (eligible && detail.total > 0) {
        const share = inc.total > 0 ? ctx.money.mulRatio(yen(detail.incomeLevy.municipal + detail.incomeLevy.prefectural), inc.publicPension ?? 0, inc.total, "conv.residentTax.installment") : yen(0);
        const capita = salarySpecial(fy, g) ? yen(0) : yen(detail.perCapita.municipal + detail.perCapita.prefectural + detail.forestEnvironmentTax);
        pension = g !== undefined ? (salarySpecial(fy, g) ? yen(0) : detail.total) : yen(share + capita);
        if (pension > detail.total) pension = detail.total;
      }
      return { detail, assessed: g !== undefined, pension };
    };
    const now = assess(fiscalYear);
    const detail = now.detail;
    const total = detail.total;
    const assessed = now.assessed;
    if (total <= 0) return { flows: [], assessed, ...detail };
    const special = salarySpecial(fiscalYear, given);
    const flows: Flow[] = [];
    const push = (ym: string, amount: Yen, formula: string) => {
      if (amount > 0) flows.push({ row: "cf.taxSi.residentTax", ym, amount, accrualYear: incomeYear, member, formula });
    };
    // 年金からの特別徴収の分
    const pensionPart = now.pension;
    if (pensionPart > 0) {
      const prev = assess(fiscalYear - 1).pension;
      const m = (y: number, mo: number) => formatYm(monthIndex(y, mo));
      if (prev <= 0) {
        const parts = ctx.money.allocate(pensionPart, [3, 3, 2, 2, 2], "conv.residentTax.installment", "first");
        push(m(fiscalYear, 6), parts[0] as Yen, "residentTax.pension.ordinary");
        push(m(fiscalYear, 8), parts[1] as Yen, "residentTax.pension.ordinary");
        push(m(fiscalYear, 10), parts[2] as Yen, "residentTax.pension.special");
        push(m(fiscalYear, 12), parts[3] as Yen, "residentTax.pension.special");
        push(m(fiscalYear + 1, 2), parts[4] as Yen, "residentTax.pension.special");
      } else {
        const provisional = ctx.money.divInt(prev, 6, "conv.residentTax.installment");
        for (const mo of [4, 6, 8]) push(m(fiscalYear, mo), provisional, "residentTax.pension.provisional");
        const rest = pensionPart - provisional - provisional - provisional;
        if (rest > 0) {
          const parts = ctx.money.allocate(yen(rest), [1, 1, 1], "conv.residentTax.installment", "first");
          push(m(fiscalYear, 10), parts[0] as Yen, "residentTax.pension.special");
          push(m(fiscalYear, 12), parts[1] as Yen, "residentTax.pension.special");
          push(m(fiscalYear + 1, 2), parts[2] as Yen, "residentTax.pension.special");
        }
      }
    }
    const remaining = yen(total - pensionPart);
    if (remaining <= 0) return { flows, assessed, ...detail };
    const installments = Array.from({ length: 12 }, (_, i) => (i < 7 ? monthIndex(fiscalYear, 6 + i) : monthIndex(fiscalYear + 1, i - 6)));
    // 特別徴収の最初の月に給与が無ければ普通徴収にする。表の最後より後の月は、給与が続くものとみなす
    const firstUnpaid = special ? installments.findIndex((mm) => mm <= ctx.time.end && !paid.has(formatYm(mm))) : 0;
    if (firstUnpaid !== 0) {
      const parts = ctx.money.allocate(remaining, installments.map(() => 1), "conv.residentTax.installment", "first");
      const stop = firstUnpaid < 0 ? 12 : firstUnpaid;
      // 給与が無くなった後の残りは、最後の給与の月にまとめて徴収する（一括徴収）
      let rest = yen(0);
      for (let i = stop; i < 12; i++) rest = yen(rest + (parts[i] as Yen));
      for (let i = 0; i < stop; i++) {
        const ym = formatYm(installments[i] as never);
        push(ym, parts[i] as Yen, "residentTax.special.installment");
        if (i === stop - 1) push(ym, rest, "residentTax.special.lumpSum");
      }
    } else {
      const ms = [monthIndex(fiscalYear, 6), monthIndex(fiscalYear, 8), monthIndex(fiscalYear, 10), monthIndex(fiscalYear + 1, 1)];
      const parts = ctx.money.allocate(remaining, ms.map(() => 1), "conv.residentTax.installment", "first");
      ms.forEach((mm, i) => push(formatYm(mm), parts[i] as Yen, "residentTax.ordinary.installment"));
    }
    return { flows, assessed, ...detail };
  },
});

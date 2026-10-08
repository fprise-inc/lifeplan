// 住民税（所得割・均等割）と森林環境税。前年の所得に対して、6月から翌年5月に払う（0003 の2）
// 所得割は全国一律の標準税率（市町村民税・道府県民税）で計算し、調整控除を引いて、それぞれ100円未満を切り捨てる。
// 給与所得者（その年度の6月に給与を受ける人）は特別徴収（6月〜翌年5月の12回）。辞めた後の残りは最後の給与の月にまとめる。
// それ以外は普通徴収（6月・8月・10月・翌年1月の4回）。非課税限度額はまだ反映しない（見出しの notices に出す）
import {
  boxValue,
  defineComponent,
  formatYm,
  monthIndex,
  subYen,
  yen,
  type Ctx,
  type DeductionsOutput,
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
  revision: 1,
  requires: { "tax.totalIncome": ">=1 <2", "tax.deductions": ">=1 <2", "income.salary": ">=1 <2" },
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
  ],
  reads: ["residentTaxAssessment.member", "residentTaxAssessment.fiscalYear", "residentTaxAssessment.amount", "residentTaxAssessment.collection"],
  input: "residentTax.annual.input",
  output: "residentTax.annual.output",
  compute(input, ctx) {
    const { member, fiscalYear } = input;
    const incomeYear = fiscalYear - 1;
    // 置き換え口: 決定通知書の年税額
    const given = ctx.list<ResidentTaxAssessmentInput>("residentTaxAssessment").find((a) => a.member === member && a.fiscalYear === fiscalYear);
    let detail: Levy;
    if (given !== undefined) detail = { ...NONE, total: boxValue(given.amount) ?? yen(0) };
    else {
      const income = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year: incomeYear }).total;
      if (income <= 0) return { flows: [], assessed: false, ...NONE };
      ctx.notice("N_NOT_IMPLEMENTED", ["residentTax.exemptionThreshold"]);
      detail = levy(ctx, fiscalYear, member, incomeYear, income);
    }
    const total = detail.total;
    const assessed = given !== undefined;
    if (total <= 0) return { flows: [], assessed, ...detail };
    const paid = new Set(
      ctx
        .call<SalaryOutput>("income.salary", { member })
        .payments.filter((p) => p.salary > 0)
        .map((p) => p.ym),
    );
    const june = formatYm(monthIndex(fiscalYear, 6));
    const special = given?.collection !== undefined ? given.collection === "special" : paid.has(june);
    const flows: Flow[] = [];
    const push = (ym: string, amount: Yen, formula: string) => {
      if (amount > 0) flows.push({ row: "cf.taxSi.residentTax", ym, amount, accrualYear: incomeYear, member, formula });
    };
    const installments = Array.from({ length: 12 }, (_, i) => (i < 7 ? monthIndex(fiscalYear, 6 + i) : monthIndex(fiscalYear + 1, i - 6)));
    // 特別徴収の最初の月に給与が無ければ普通徴収にする。表の最後より後の月は、給与が続くものとみなす
    const firstUnpaid = special ? installments.findIndex((m) => m <= ctx.time.end && !paid.has(formatYm(m))) : 0;
    if (firstUnpaid !== 0) {
      const parts = ctx.money.allocate(total, installments.map(() => 1), "conv.residentTax.installment", "first");
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
      const parts = ctx.money.allocate(total, ms.map(() => 1), "conv.residentTax.installment", "first");
      ms.forEach((m, i) => push(formatYm(m), parts[i] as Yen, "residentTax.ordinary.installment"));
    }
    return { flows, assessed, ...detail };
  },
});

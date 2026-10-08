// 後期高齢者医療の保険料（年度。75歳の誕生日の月から）。所得割（総所得金額等−基礎控除）×所得割率＋均等割（軽減の後）を区分（医療・
// 子ども・子育て支援金）ごとに賦課限度額まで。市町村ごとの値を持たない方針（0007 の6）なので、全国平均の料率を既定にし、世帯の入力
// （決定通知書の年額 premiumAssessments、または料率 premiumRates）で上書きする。どの既定を使ったかは見出しの notices に出す。
// 年度の途中で75歳になる年は月数で按分する。年金が年18万円以上なら年金から差し引く（特別徴収）
import {
  ageMonth,
  addYen,
  boxValue,
  defineComponent,
  fiscalYearOf,
  fiscalYearStart,
  installmentFlows,
  pensionSpecial,
  PENSION_SPECIAL_MINIMUM,
  monthIndex,
  rate,
  rateOverride,
  reductionRatio,
  assessedPremium,
  RATE_ONE,
  subYen,
  yen,
  type Flow,
  type HealthStatusOutput,
  type MemberInput,
  type PremiumAssessmentInput,
  type PremiumPart,
  type PremiumRateInput,
  type PublicPensionIncomeOutput,
  type SalaryOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const PREFIX = "socialInsurance.lateElderly";
const PARTS: readonly { part: PremiumPart; row: string }[] = [
  { part: "medical", row: "cf.taxSi.health" },
  { part: "childSupport", row: "cf.taxSi.childSupport" },
];
const REDUCTION = ["base", "perEarner", "halfPerInsured", "twentyPerInsured", "ratioSeventy", "ratioHalf", "ratioTwenty", "elderlyPensionDeduction"].map((x) => `${PREFIX}.reduction.${x}`);
const ELDERLY_AGE = "incomeTax.publicPensionDeduction.elderlyAge";
const SPECIAL = PENSION_SPECIAL_MINIMUM;

export default defineComponent<{ member: string; fiscalYear: number }, { flows: Flow[] }>({
  id: "socialInsurance.lateElderly",
  title: "後期高齢者医療の保険料",
  contract: "1.0",
  revision: 2,
  requires: {
    "socialInsurance.healthStatus": ">=1 <2",
    "tax.totalIncome": ">=1 <2",
    "tax.publicPensionIncome": ">=1 <2",
    "income.salary": ">=1 <2",
    "pension.oldAge": ">=1 <2",
  },
  params: [
    ELDERLY_AGE,
    ...PARTS.flatMap((p) => ["incomeRate", "perCapita", "limit"].map((k) => `${PREFIX}.${p.part}.${k}`)),
    `${PREFIX}.incomeDeduction`,
    `${PREFIX}.childSupport.reductionRatioSeventy`,
    `${PREFIX}.rounding`,
    ...REDUCTION,
    SPECIAL,
  ],
  reads: ["member.kind", "premiumAssessment.member", "premiumAssessment.kind", "premiumAssessment.fiscalYear", "premiumAssessment.amount", "premiumRate.kind", "premiumRate.fromFiscalYear", "premiumRate.parts"],
  memberScope: ["premiumAssessment"],
  input: "residentTax.annual.input",
  output: "flows.output",
  compute(input, ctx) {
    const { member, fiscalYear: fy } = input;
    // 判定に使う所得の年度。計算基準月の年度より前の年度（前の年の社会保険料控除のためだけに計算する）は、計算基準月の年度の所得で判定する（PR の提案）
    const jy = Math.max(fy, fiscalYearOf(ctx.time.base));
    // その年度の月だけを読む（ほかの月の状態が変わっても計算し直さない）
    const statusIn = (id: string) => ctx.callMonths<HealthStatusOutput["months"][number]>("socialInsurance.healthStatus", { member: id }, "months", fiscalYearStart(fy), monthIndex(fy + 1, 3));
    const months = statusIn(member).filter((x) => x.kind === "lateElderly").length;
    if (months === 0) return { flows: [] };
    const special = pensionSpecial(ctx, member, fy);
    const given = assessedPremium(ctx.list<PremiumAssessmentInput>("premiumAssessment"), "lateElderly", member, fy);
    if (given !== undefined) {
      const amount = boxValue((given as PremiumAssessmentInput).amount) ?? yen(0);
      return { flows: installmentFlows(ctx, fy, special, member, [{ row: "cf.taxSi.health", amount, formula: "socialInsurance.lateElderly.assessed" }]) };
    }
    const at = ctx.at(fiscalYearStart(fy));
    const override = rateOverride(ctx.list<PremiumRateInput>("premiumRate"), "lateElderly", fy);
    if (override === undefined) ctx.notice("N_DEFAULT_USED", [`${PREFIX}.nationalAverage`]);
    const totalOf = (id: string) => ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year: jy - 1 }).total;
    const own = totalOf(member);
    const deduction = at.paramYen(`${PREFIX}.incomeDeduction`) ?? yen(0);
    const base = own > deduction ? subYen(own, deduction) : yen(0);
    // 軽減の判定: 世帯主（本人の構成員）と、その年度に後期高齢者医療に入る構成員の総所得金額等の合計
    const members = ctx.list<MemberInput>("member");
    const head = members.find((m) => m.kind === "self")?.id ?? member;
    const insured = members.filter(
      (m) =>
        m.id === member ||
        statusIn(m.id).some((x) => x.kind === "lateElderly"),
    );
    const judgedIds = new Set([head, ...insured.map((m) => m.id)]);
    // 軽減の判定: 65歳以上の公的年金の所得からは特別に引く（高齢者特別控除）
    const elderlyDeduction = at.paramYen(`${PREFIX}.reduction.elderlyPensionDeduction`) ?? yen(0);
    let judged = yen(0);
    let earners = 0;
    for (const id of judgedIds) {
      const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year: jy - 1 });
      const elderly = ageMonth(ctx, fiscalYearStart(fy), ELDERLY_AGE, id) <= monthIndex(jy - 1, 12);
      const special = elderly ? yen(Math.min(elderlyDeduction, inc.publicPension ?? 0)) : yen(0);
      judged = addYen(judged, yen(inc.total - special));
      const salary = ctx.callMonths<SalaryOutput["payments"][number]>("income.salary", { member: id }, "payments", monthIndex(jy - 1, 1), monthIndex(jy - 1, 12)).some((p) => p.salary > 0);
      const pension = ctx.call<PublicPensionIncomeOutput>("tax.publicPensionIncome", { member: id, year: jy - 1 }).revenue > 0;
      if (salary || pension) earners++;
    }
    const start0 = fiscalYearStart(fy);
    const reductionOf = (part: PremiumPart) =>
      reductionRatio(ctx, start0, PREFIX, judged, earners, insured.length, part === "childSupport" ? `${PREFIX}.childSupport.reductionRatioSeventy` : undefined);
    const parts: { row: string; amount: Yen; formula: string }[] = [];
    for (const { part, row } of PARTS) {
      const o = override?.parts?.[part];
      const ir = o?.incomeRate !== undefined ? boxValue(o.incomeRate) : null;
      const incomeRate = ir !== null ? rate(ir) : at.paramRate(`${PREFIX}.${part}.incomeRate`);
      const perCapita = (o?.perCapita !== undefined ? boxValue(o.perCapita) : null) ?? at.paramYen(`${PREFIX}.${part}.perCapita`);
      if (incomeRate === null && perCapita === null) continue;
      const income = incomeRate === null ? yen(0) : at.money.mulRate(base, incomeRate, "conv.premium.local");
      const capita = perCapita === null ? yen(0) : at.money.mulRate(perCapita, ctx.rate.sub(RATE_ONE, reductionOf(part)), "conv.premium.local");
      const limit = at.paramYen(`${PREFIX}.${part}.limit`);
      let annual = addYen(income, capita);
      if (limit !== null && annual > limit) annual = limit;
      // 区分ごとの年額を月数で按分し、端数処理（100円未満切り捨て）をする
      const prorated = at.money.mulRatio(annual, months, 12, "conv.premium.local");
      const amount = at.has(`${PREFIX}.rounding`) ? at.money.round(prorated, `${PREFIX}.rounding`) : prorated;
      parts.push({ row, amount, formula: `socialInsurance.lateElderly.${part}` });
    }
    return { flows: installmentFlows(ctx, fy, special, member, parts) };
  },
});

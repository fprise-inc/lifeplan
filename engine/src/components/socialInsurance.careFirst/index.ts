// 介護保険の第1号被保険者（65歳から）の保険料（年度）。基準額（月額）×12×所得の段階の割合。段階は、本人が住民税（均等割）課税なら
// 合計所得金額の段階、本人が非課税なら世帯に課税の人がいるかと「公的年金等の収入＋その他の合計所得金額」で決める（国の標準段階）。
// 市町村ごとの値を持たない方針（0007 の6）なので、基準額は全国平均を既定にし、世帯の入力（決定通知書の年額、または市町村の基準額）で上書きする
// 改訂4: 世帯の外の家族（0035 の4）の判定の世帯は、その人と世帯の外の配偶者
// 改訂5: 年金から差し引く（特別徴収）かの判定で、表の最後の年の年度の、表の外の翌年2月の年金の支払いを、表の最後の月の支払いと同じ額とみなす（0003 の追記）
import {
  ageMonth,
  assessedPremium,
  boxValue,
  bracketFor,
  defineComponent,
  fiscalYearEnd,
  fiscalYearOf,
  fiscalYearStart,
  installmentFlows,
  parseYm,
  PENSION_SPECIAL_MINIMUM,
  pensionSpecial,
  RATE_ONE,
  rateOverride,
  sameHousehold,
  yen,
  type ExemptionOutput,
  type Flow,
  type MemberInput,
  type PremiumAssessmentInput,
  type PremiumRateInput,
  type PublicPensionIncomeOutput,
  type RelationInput,
  type TotalIncomeOutput,
} from "../../sdk/index.ts";

const PREFIX = "socialInsurance.care.firstInsured";
const P = {
  base: `${PREFIX}.baseMonthly`,
  taxable: `${PREFIX}.ratio.taxable`,
  selfExempt: `${PREFIX}.ratio.selfExempt`,
  householdExempt: `${PREFIX}.ratio.householdExempt`,
  fromAge: "socialInsurance.care.secondaryInsuredUntilAge",
};

export default defineComponent<{ member: string; fiscalYear: number }, { flows: Flow[] }>({
  id: "socialInsurance.careFirst",
  title: "介護保険料（第1号被保険者）",
  contract: "1.0",
  revision: 5,
  requires: { "residentTax.exemption": ">=1 <2", "tax.totalIncome": ">=1 <2", "tax.publicPensionIncome": ">=1 <2", "pension.oldAge": ">=1 <2" },
  params: [...Object.values(P), PENSION_SPECIAL_MINIMUM],
  reads: [
    "member.outside", "relation.type", "relation.a", "relation.b", "relation.from", "relation.to",
    "member.birth",
    "member.joins",
    "member.leaves",
    "premiumAssessment.member",
    "premiumAssessment.kind",
    "premiumAssessment.fiscalYear",
    "premiumAssessment.amount",
    "premiumRate.kind",
    "premiumRate.fromFiscalYear",
    "premiumRate.baseMonthly",
  ],
  memberScope: ["premiumAssessment"],
  input: "residentTax.annual.input",
  output: "flows.output",
  compute(input, ctx) {
    const { member, fiscalYear: fy } = input;
    // 判定に使う所得と制度の値の年度。計算基準月の年度より前の年度（前の年の社会保険料控除のためだけに計算する）は、計算基準月の年度の所得と
    // 制度の値で計算する（PR の提案。制度の値は改訂3から: その年度の値は制度データに無いことがある）
    const jy = Math.max(fy, fiscalYearOf(ctx.time.base));
    const start = fiscalYearStart(fy);
    // 年齢の値は、計算基準月より前の年度では計算基準月の値を使う
    const from = ageMonth(ctx, start < ctx.time.base ? ctx.time.base : start, P.fromAge, member);
    const me = ctx.get<MemberInput>("member", member);
    const leaves = me.leaves === null ? null : ctx.time.resolve(me.leaves);
    let months = 0;
    for (let m = start; m <= fiscalYearEnd(fy); m = (m + 1) as typeof m) if (m >= from && (leaves === null || m < leaves)) months++;
    if (months === 0) return { flows: [] };
    const special = pensionSpecial(ctx, member, fy, jy);
    const given = assessedPremium(ctx.list<PremiumAssessmentInput>("premiumAssessment"), "careFirst", member, fy);
    if (given !== undefined) {
      const amount = boxValue((given as PremiumAssessmentInput).amount) ?? yen(0);
      return { flows: installmentFlows(ctx, fy, special, member, [{ row: "cf.taxSi.care", amount, formula: "socialInsurance.careFirst.assessed" }]) };
    }
    const at = ctx.at(fiscalYearStart(jy));
    const override = rateOverride(ctx.list<PremiumRateInput>("premiumRate"), "careFirst", fy);
    const base = (override?.baseMonthly !== undefined ? boxValue(override.baseMonthly) : null) ?? at.paramYen(P.base) ?? yen(0);
    if (override?.baseMonthly === undefined) ctx.notice("N_DEFAULT_USED", [`${PREFIX}.nationalAverage`]);
    const exempt = (id: string) => ctx.call<ExemptionOutput>("residentTax.exemption", { member: id, fiscalYear: jy }).perCapitaExempt;
    const total = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year: jy - 1 }).total;
    let ratio: typeof RATE_ONE;
    if (!exempt(member)) ratio = bracketFor(at.paramBrackets(P.taxable) ?? [], total).rate ?? RATE_ONE;
    else {
      const pension = ctx.call<PublicPensionIncomeOutput>("tax.publicPensionIncome", { member, year: jy - 1 });
      const measure = yen(pension.revenue + (total - pension.income));
      const dec = parseYm(`${jy - 1}-12`);
      // 判定の世帯: 世帯の外の家族はその人と世帯の外の配偶者（0035 の4。片方が亡くなった後は単身）
      const others = sameHousehold(ctx, ctx.list<MemberInput>("member"), ctx.list<RelationInput>("relation"), member)
        .filter((m) => m.id !== member && parseYm(m.birth.birthYearMonth) <= dec && (m.leaves === null || ctx.time.resolve(m.leaves) > dec));
      const householdTaxed = others.some((o) => !exempt(o.id));
      ratio = bracketFor(at.paramBrackets(householdTaxed ? P.selfExempt : P.householdExempt) ?? [], measure).rate ?? RATE_ONE;
    }
    const amount = at.money.mulRate(at.money.mulRatio(base, months, 1, "conv.exact"), ratio, "conv.premium.local");
    return { flows: installmentFlows(ctx, fy, special, member, [{ row: "cf.taxSi.care", amount, formula: "socialInsurance.careFirst.annual" }]) };
  },
});

// 後期高齢者医療の保険料（年度。75歳の誕生日の月から）。所得割（総所得金額等−基礎控除）×所得割率＋均等割（軽減の後）を区分（医療・
// 子ども・子育て支援金）ごとに賦課限度額まで。市町村ごとの値を持たない方針（0007 の6）なので、全国平均の料率を既定にし、世帯の入力
// （決定通知書の年額 premiumAssessments、または料率 premiumRates）で上書きする。どの既定を使ったかは見出しの notices に出す。
// 年度の途中で75歳になる年は月数で按分する。年金が年18万円以上なら年金から差し引く（特別徴収）
// 改訂4: 世帯の外の家族（0035 の4）の判定の世帯は、その人と世帯の外の配偶者
// 改訂6: 表の最後の年の年度の月数に、表の外の翌年1〜3月も数える（表の長さで、その年の保険料を変えない。0003 の追記）
// 改訂（0044）: 所得割と軽減の判定の所得に、分離課税の譲渡所得（tax.totalIncome の separate。入るお金の行）も足す
// 改訂7（0081）: 所得割と軽減の判定の総所得金額等から、青色申告の純損失の繰越控除（tax.lossCarryforward）を引く（国民健康保険と同じ。
//   土地建物等の譲渡所得は separate として入る）
// 改訂8（0165）: 軽減の判定の世帯主は、その年度の始まり（計算基準月より前の年度は計算基準月）に判定の世帯にいる人から決める（本人、いなければ
//   配偶者、いなければ年長の人。sdk の householdHeadAt）。前は本人の構成員の決め打ちで、本人が亡くなった後も亡くなった本人の前の年の所得が
//   遺族の軽減の判定に入った。亡くなった月より後に払う分（本人の分の残り）は、払う月の世帯主（遺族）の名にする（sdk の reassignAfterLeave）
import {
  addYen,
  ageMonth,
  assessedPremium,
  boxValue,
  defineComponent,
  fiscalYearOf,
  fiscalYearStart,
  healthStatusInFiscalYear,
  householdHeadAt,
  installmentFlows,
  LATE_ELDERLY_AGE,
  monthIndex,
  PENSION_SPECIAL_MINIMUM,
  pensionSpecial,
  rate,
  RATE_ONE,
  rateOverride,
  reassignAfterLeave,
  reductionRatio,
  sameHousehold,
  subYen,
  yen,
  type Flow,
  type MemberInput,
  type PremiumAssessmentInput,
  type PremiumPart,
  type PremiumRateInput,
  type PublicPensionIncomeOutput,
  type RelationInput,
  type SalaryOutput,
  type LossCarryforwardOutput,
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
  revision: 8,
  requires: {
    "socialInsurance.healthStatus": ">=1 <2",
    "tax.totalIncome": ">=1 <2",
    "tax.lossCarryforward": ">=1 <2",
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
    LATE_ELDERLY_AGE,
  ],
  reads: ["member.outside", "member.birth", "member.joins", "member.leaves", "relation.type", "relation.a", "relation.b", "relation.from", "relation.to", "member.kind", "premiumAssessment.member", "premiumAssessment.kind", "premiumAssessment.fiscalYear", "premiumAssessment.amount", "premiumRate.kind", "premiumRate.fromFiscalYear", "premiumRate.parts"],
  memberScope: ["premiumAssessment"],
  input: "residentTax.annual.input",
  output: "flows.output",
  compute(input, ctx) {
    const { member, fiscalYear: fy } = input;
    // 判定に使う所得と制度の値の年度。計算基準月の年度より前の年度（前の年の社会保険料控除のためだけに計算する）は、計算基準月の年度の所得と
    // 制度の値で計算する（PR の提案。制度の値は改訂3から: その年度の値は制度データに無いことがある）
    const jy = Math.max(fy, fiscalYearOf(ctx.time.base));
    // その年度の月だけを読む（ほかの月の状態が変わっても計算し直さない）。表の最後の年の年度は、表の外の翌年1〜3月も数える（改訂6）
    const statusIn = (id: string) => healthStatusInFiscalYear(ctx, id, fy);
    const months = statusIn(member).filter((x) => x.kind === "lateElderly").length;
    if (months === 0) return { flows: [] };
    const special = pensionSpecial(ctx, member, fy, jy);
    const given = assessedPremium(ctx.list<PremiumAssessmentInput>("premiumAssessment"), "lateElderly", member, fy);
    if (given !== undefined) {
      const amount = boxValue((given as PremiumAssessmentInput).amount) ?? yen(0);
      return { flows: reassignAfterLeave(ctx, sameHousehold(ctx, ctx.list<MemberInput>("member"), ctx.list<RelationInput>("relation"), member), installmentFlows(ctx, fy, special, member, [{ row: "cf.taxSi.health", amount, formula: "socialInsurance.lateElderly.assessed" }])) };
    }
    const at = ctx.at(fiscalYearStart(jy));
    const override = rateOverride(ctx.list<PremiumRateInput>("premiumRate"), "lateElderly", fy);
    if (override === undefined) ctx.notice("N_DEFAULT_USED", [`${PREFIX}.nationalAverage`]);
    // 純損失の繰越控除（青色申告。前の年の総所得金額から引く額）
    const carryOf = (id: string): number => ctx.call<LossCarryforwardOutput>("tax.lossCarryforward", { member: id }).byYear.find((x) => x.year === jy - 1)?.deducted ?? 0;
    const totalOf = (id: string) => {
      const t = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year: jy - 1 });
      return yen(t.total + (t.separate ?? 0) - carryOf(id));
    };
    const own = totalOf(member);
    const deduction = at.paramYen(`${PREFIX}.incomeDeduction`) ?? yen(0);
    const base = own > deduction ? subYen(own, deduction) : yen(0);
    // 軽減の判定: 世帯主（年度の始まりに世帯にいる本人・配偶者など。改訂8）と、その年度に後期高齢者医療に入る構成員の総所得金額等の合計
    // 判定の世帯: 世帯の中の人は世帯の中の人、世帯の外の家族はその人と世帯の外の配偶者（0035 の4）
    const members = sameHousehold(ctx, ctx.list<MemberInput>("member"), ctx.list<RelationInput>("relation"), member);
    const head = householdHeadAt(ctx, members, fiscalYearStart(fy) < ctx.time.base ? ctx.time.base : fiscalYearStart(fy))?.id ?? member;
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
      judged = addYen(judged, yen(inc.total + (inc.separate ?? 0) - carryOf(id) - special));
      const salary = ctx.callMonths<SalaryOutput["payments"][number]>("income.salary", { member: id }, "payments", monthIndex(jy - 1, 1), monthIndex(jy - 1, 12)).some((p) => p.salary > 0);
      const pension = ctx.call<PublicPensionIncomeOutput>("tax.publicPensionIncome", { member: id, year: jy - 1 }).revenue > 0;
      if (salary || pension) earners++;
    }
    const start0 = fiscalYearStart(jy);
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
    return { flows: reassignAfterLeave(ctx, members, installmentFlows(ctx, fy, special, member, parts)) };
  },
});

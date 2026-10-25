// 国民健康保険の保険料（年度。世帯主＝本人の構成員が納める）。区分（医療・後期高齢者支援金等・介護（40〜64歳）・子ども・子育て支援金）ごとに
// 所得割（総所得金額等−基礎控除）×率＋均等割×人数＋平等割（均等割・平等割は軽減の後）を、賦課限度額まで。加入の月数で按分する。
// 市町村ごとの値を持たない方針（0007 の6）。全国の標準的な料率は制度データに持つ（値が入るまでは、世帯の入力が無ければ計算せず
// 見出しの notices に N_INPUT_REQUIRED を出す）。世帯の入力（決定通知書の年額 premiumAssessments、または料率 premiumRates）で上書きする。
// 子ども・子育て支援金の区分は18歳未満の均等割をかけない。未就学児の均等割の軽減・産前産後の免除はまだ入れていない（notices）
import {
  addYen,
  ageMonth,
  assessedPremium,
  boxValue,
  defineComponent,
  fiscalYearEnd,
  fiscalYearOf,
  fiscalYearStart,
  installmentFlows,
  monthIndex,
  parseYm,
  rate,
  RATE_ONE,
  rateOverride,
  reductionRatio,
  subYen,
  yen,
  type Flow,
  type HealthStatusOutput,
  type MemberInput,
  type PremiumAssessmentInput,
  type PremiumPart,
  type PremiumRateInput,
  type PublicPensionIncomeOutput,
  type Rate,
  type SalaryOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const PREFIX = "socialInsurance.nationalHealth";
const PARTS: readonly { part: PremiumPart; row: string }[] = [
  { part: "medical", row: "cf.taxSi.health" },
  { part: "elderlySupport", row: "cf.taxSi.health" },
  { part: "care", row: "cf.taxSi.care" },
  { part: "childSupport", row: "cf.taxSi.childSupport" },
];
const KEYS = ["incomeRate", "perCapita", "perHousehold", "limit"] as const;
const REDUCTION = ["base", "perEarner", "halfPerInsured", "twentyPerInsured", "ratioSeventy", "ratioHalf", "ratioTwenty", "elderlyPensionDeduction"].map((x) => `${PREFIX}.reduction.${x}`);
const ELDERLY_AGE = "incomeTax.publicPensionDeduction.elderlyAge";
const AGE = {
  careFrom: "socialInsurance.care.secondaryInsuredFromAge",
  careUntil: "socialInsurance.care.secondaryInsuredUntilAge",
  childUntil: `${PREFIX}.childSupport.perCapitaFromAge`,
};

export default defineComponent<{ fiscalYear: number }, { flows: Flow[] }>({
  id: "socialInsurance.nationalHealth",
  title: "国民健康保険料",
  contract: "1.0",
  revision: 3,
  requires: {
    "socialInsurance.healthStatus": ">=1 <2",
    "tax.totalIncome": ">=1 <2",
    "tax.publicPensionIncome": ">=1 <2",
    "income.salary": ">=1 <2",
  },
  params: [
    ELDERLY_AGE,...PARTS.flatMap((p) => KEYS.map((k) => `${PREFIX}.${p.part}.${k}`)), `${PREFIX}.incomeDeduction`, ...REDUCTION, ...Object.values(AGE)],
  reads: [
    "member.kind",
    "premiumAssessment.member",
    "premiumAssessment.kind",
    "premiumAssessment.fiscalYear",
    "premiumAssessment.amount",
    "premiumRate.kind",
    "premiumRate.fromFiscalYear",
    "premiumRate.parts",
  ],
  input: "fiscalYear.input",
  output: "flows.output",
  compute(input, ctx) {
    const fy = input.fiscalYear;
    // 判定に使う所得と制度の値の年度。計算基準月の年度より前の年度（前の年の社会保険料控除のためだけに計算する）は、計算基準月の年度の所得と
    // 制度の値で計算する（PR の提案。制度の値は改訂3から: その年度の値は制度データに無いことがある）
    const jy = Math.max(fy, fiscalYearOf(ctx.time.base));
    const start = fiscalYearStart(fy);
    const valuesAt = fiscalYearStart(jy);
    const ageAt = start < ctx.time.base ? ctx.time.base : start;
    const members = ctx.list<MemberInput>("member");
    const head = members.find((m) => m.kind === "self")?.id ?? (members[0] as MemberInput).id;
    const insured = members
      .map((m) => ({
        id: m.id,
        months: ctx.callMonths<HealthStatusOutput["months"][number]>("socialInsurance.healthStatus", { member: m.id }, "months", start, fiscalYearEnd(fy))
          .filter((x) => x.kind === "national")
          .map((x) => parseYm(x.month)),
      }))
      .filter((x) => x.months.length > 0);
    if (insured.length === 0) return { flows: [] };
    const given = assessedPremium(ctx.list<PremiumAssessmentInput>("premiumAssessment"), "nationalHealth", head, fy);
    if (given !== undefined) {
      const amount = boxValue((given as PremiumAssessmentInput).amount) ?? yen(0);
      return { flows: installmentFlows(ctx, fy, false, head, [{ row: "cf.taxSi.health", amount, formula: "socialInsurance.nationalHealth.assessed" }]) };
    }
    const at = ctx.at(valuesAt);
    const override = rateOverride(ctx.list<PremiumRateInput>("premiumRate"), "nationalHealth", fy);
    const totalOf = (id: string) => ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year: jy - 1 }).total;
    const deduction = at.paramYen(`${PREFIX}.incomeDeduction`) ?? yen(0);
    const judgedIds = new Set([head, ...insured.map((x) => x.id)]);
    // 軽減の判定: 65歳以上の公的年金の所得からは特別に引く（高齢者特別控除）
    const elderlyDeduction = at.paramYen(`${PREFIX}.reduction.elderlyPensionDeduction`) ?? yen(0);
    let judged = yen(0);
    let earners = 0;
    for (const id of judgedIds) {
      const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year: jy - 1 });
      const elderly = ageMonth(ctx, start, ELDERLY_AGE, id) <= monthIndex(jy - 1, 12);
      const special = elderly ? yen(Math.min(elderlyDeduction, inc.publicPension ?? 0)) : yen(0);
      judged = addYen(judged, yen(inc.total - special));
      const salary = ctx.callMonths<SalaryOutput["payments"][number]>("income.salary", { member: id }, "payments", monthIndex(jy - 1, 1), monthIndex(jy - 1, 12)).some((p) => p.salary > 0);
      const pension = ctx.call<PublicPensionIncomeOutput>("tax.publicPensionIncome", { member: id, year: jy - 1 }).revenue > 0;
      if (salary || pension) earners++;
    }
    const keep = ctx.rate.sub(RATE_ONE, reductionRatio(ctx, valuesAt, PREFIX, judged, earners, insured.length));
    const parts: { row: string; amount: Yen; formula: string }[] = [];
    let missing = false;
    for (const { part, row } of PARTS) {
      const o = override?.parts?.[part];
      const pick = <T>(given: T | null, id: string, read: (id: string) => T | null): T | null => {
        if (given !== null) return given;
        return at.has(id) ? read(id) : null;
      };
      const ir = o?.incomeRate !== undefined ? boxValue(o.incomeRate) : null;
      const incomeRate = pick<Rate>(ir === null ? null : rate(ir), `${PREFIX}.${part}.incomeRate`, (id) => at.paramRate(id));
      const perCapita = pick<Yen>(o?.perCapita !== undefined ? boxValue(o.perCapita) : null, `${PREFIX}.${part}.perCapita`, (id) => at.paramYen(id));
      const perHousehold = pick<Yen>(o?.perHousehold !== undefined ? boxValue(o.perHousehold) : null, `${PREFIX}.${part}.perHousehold`, (id) => at.paramYen(id));
      if (incomeRate === null && perCapita === null && perHousehold === null) {
        // 子ども・子育て支援金の区分は令和8年度から（それより前は値が無い）
        if (part !== "childSupport" || override !== undefined) missing ||= part !== "childSupport";
        continue;
      }
      let total = yen(0);
      let partMonths = 0;
      for (const x of insured) {
        let ms = x.months;
        if (part === "care") {
          const f = ageMonth(ctx, ageAt, AGE.careFrom, x.id);
          const u = ageMonth(ctx, ageAt, AGE.careUntil, x.id);
          ms = ms.filter((m) => m >= f && m < u);
        }
        if (ms.length === 0) continue;
        partMonths = Math.max(partMonths, ms.length);
        const own = totalOf(x.id);
        const base = own > deduction ? subYen(own, deduction) : yen(0);
        let annual = incomeRate === null ? yen(0) : at.money.mulRate(base, incomeRate, "conv.premium.local");
        const childFree = part === "childSupport" ? ageMonth(ctx, ageAt, AGE.childUntil, x.id) : null;
        const capitaMonths = childFree === null ? ms.length : ms.filter((m) => m >= childFree).length;
        if (perCapita !== null) {
          annual = addYen(at.money.mulRatio(annual, ms.length, 12, "conv.premium.local"), at.money.mulRatio(at.money.mulRate(perCapita, keep, "conv.premium.local"), capitaMonths, 12, "conv.premium.local"));
        } else annual = at.money.mulRatio(annual, ms.length, 12, "conv.premium.local");
        total = addYen(total, annual);
      }
      if (partMonths === 0) continue;
      if (perHousehold !== null) total = addYen(total, at.money.mulRatio(at.money.mulRate(perHousehold, keep, "conv.premium.local"), partMonths, 12, "conv.premium.local"));
      const limit = at.has(`${PREFIX}.${part}.limit`) ? at.paramYen(`${PREFIX}.${part}.limit`) : null;
      if (limit !== null) {
        const cap = at.money.mulRatio(limit, partMonths, 12, "conv.premium.local");
        if (total > cap) total = cap;
      }
      parts.push({ row, amount: total, formula: `socialInsurance.nationalHealth.${part}` });
    }
    if (missing) ctx.notice("N_INPUT_REQUIRED", [`${PREFIX}.rates`]);
    else if (override === undefined) ctx.notice("N_DEFAULT_USED", [`${PREFIX}.nationalStandard`]);
    ctx.notice("N_NOT_SUPPORTED", [`${PREFIX}.preschoolReduction`, `${PREFIX}.maternityExemption`]);
    return { flows: installmentFlows(ctx, fy, false, head, parts) };
  },
});

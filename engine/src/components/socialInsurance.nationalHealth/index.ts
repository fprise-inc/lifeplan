// 国民健康保険の保険料（年度。世帯主が納める。世帯主は年度の始まりに世帯にいる本人、いなければ配偶者など。改訂11）。区分（医療・後期高齢者支援金等・介護（40〜64歳）・子ども・子育て支援金）ごとに
// 所得割（総所得金額等−基礎控除）×率＋均等割×人数＋平等割（均等割・平等割は軽減の後）を、賦課限度額まで。加入の月数で按分する。
// 市町村ごとの値を持たない方針（0007 の6）。全国の目安の料率（公式の統計の全国の平均。制度データ）を既定にし、使ったときは見出しの notices に
// N_DEFAULT_USED（nationalStandard）を出す。制度データに目安が無い区分があれば、世帯の入力が無いときは計算せず N_INPUT_REQUIRED を出す。
// 世帯の入力（決定通知書の年額 premiumAssessments、または料率 premiumRates）で上書きする。
// 子ども・子育て支援金の区分は18歳未満の均等割をかけない。未就学児の均等割の軽減・産前産後の免除はまだ入れていない（notices）
// 改訂5: 世帯の外の家族（0035 の4）は世帯の国民健康保険に入れない
// 改訂（0044）: 所得割と軽減の判定の所得に、分離課税の譲渡所得（tax.totalIncome の separate。入るお金の行）も足す
// 改訂7: 未就学児の均等割の軽減・産前産後の免除の知らせは、その年度に小学校に入る前の子が国民健康保険に入っている月があるときだけ出す
//   （生まれる子も未就学児なので、産前産後の免除が当てはまりうる年度も含む。保険料は変えない）
// 改訂8: 表の最後の年の年度の加入の月数に、表の外の翌年1〜3月も数える（表の長さで、その年の保険料を変えない。0003 の追記）
// 改訂9（0081）: 所得割と軽減の判定の総所得金額等から、青色申告の純損失の繰越控除（tax.lossCarryforward）を引く（国民健康保険法施行令29条の7第2項4号・5号:
//   地方税法314条の2第1項の総所得金額等。雑損失の繰越控除だけ除く）。土地建物等の譲渡所得は separate として入る（特別控除の後の額。特別控除は扱わない）
// 改訂10（0099）: 子ども・子育て支援金の区分は、その区分が始まった年度（令和8年度。18歳未満の均等割をかけない年齢の値の最初の行）より前の年度には
//   かけない。計算基準月が令和8年1〜3月の世帯は、令和7年度（前の年の社会保険料控除と、1〜3月の納期）も計算するが、料率の入力に支援金の欄があっても
//   その年度には当てない（前はその年齢の値が無く E_PARAM_NO_VALUE で止まった）
// 改訂11（0165）: 世帯主は、その年度の始まり（計算基準月より前の年度は計算基準月）に世帯にいる人から決める（本人、いなければ配偶者、
//   いなければ年長の人。sdk の householdHeadAt）。前は本人の構成員の決め打ちで、本人が亡くなった後の年度も、亡くなった本人の前の年の
//   所得が軽減の判定に入り、保険料が亡くなった本人の名で出て遺族の社会保険料控除から落ちた。軽減の判定は世帯主と被保険者の前の年の
//   所得（国民健康保険法施行令29条の7第5項）で、年度の途中で世帯主が亡くなっても判定は年度の始まりのまま。亡くなった月より後に払う分は、
//   払う月の世帯主（遺族）の名にする（sdk の reassignAfterLeave）
// 改訂12（0171）:
// - 軽減の判定の「給与所得者等の数」は、前の年の給与等の収入が55万円を超える人と、公的年金等の収入が60万円（その年の12月31日に65歳以上は
//   125万円）を超える人（施行令29条の7第6項1号・附則5条。sdk の isEarner）。前は給与・年金が少しでもある人を数えていた
// - 特定同一世帯所属者（国民健康保険から75歳で後期高齢者医療に移り、そのまま同じ世帯にいる人）を、軽減の判定の所得と人数（5割・2割の基準の
//   被保険者の数）に入れる（同6項）。平等割は、世帯の国民健康保険の人が1人で特定同一世帯所属者がいる月（特定世帯）は、移った月から5年は2分の1、
//   その後3年（特定継続世帯）は4分の3（同2項8号・3項7号。子ども・子育て支援金の区分も後期高齢者支援金等の区分と同じに当てる。介護の区分には無い）。
//   計算基準月より前に移った人は、移る前の月が表の前で分からないので、国民健康保険から移ったとみなす（勤め先の健康保険の期間がその月にあれば除く）
import {
  addYen,
  ageMonth,
  assessedPremium,
  boxValue,
  addMonths,
  defineComponent,
  EARNER_LIMIT_KEYS,
  EMPLOYEE_TYPES,
  EMPLOYER_HEALTH_KINDS,
  healthStatusInFiscalYear,
  insuranceEndMonth,
  isEarner,
  LATE_ELDERLY_AGE,
  fiscalYearOf,
  fiscalYearStart,
  householdHeadAt,
  householdMembers,
  installmentFlows,
  monthIndex,
  parseYm,
  rate,
  RATE_ONE,
  rateOverride,
  reassignAfterLeave,
  reductionRatio,
  subYen,
  yen,
  type EmploymentPeriodInput,
  type Flow,
  type HealthStatusMonth,
  type MemberInput,
  type PremiumAssessmentInput,
  type PremiumPart,
  type PremiumRateInput,
  type MonthIndex,
  type Rate,
  type LossCarryforwardOutput,
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
const REDUCTION = ["base", "perEarner", "halfPerInsured", "twentyPerInsured", "ratioSeventy", "ratioHalf", "ratioTwenty", "elderlyPensionDeduction", ...EARNER_LIMIT_KEYS].map((x) => `${PREFIX}.reduction.${x}`);
/** 特定世帯（移った月から5年）・特定継続世帯（その後3年）の月数と、平等割に掛ける割合（施行令29条の7第2項8号・3項7号） */
const SPECIFIC_MONTHS = 60;
const SPECIFIC_CONTINUED_MONTHS = 96;
/** 平等割に特定世帯の割合を掛ける区分（介護の区分には無い） */
const SPECIFIC_PARTS: ReadonlySet<PremiumPart> = new Set(["medical", "elderlySupport", "childSupport"]);
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
  revision: 12,
  requires: {
    "socialInsurance.healthStatus": ">=1 <2",
    "tax.totalIncome": ">=1 <2",
    "tax.lossCarryforward": ">=1 <2",
    "tax.publicPensionIncome": ">=1 <2",
    "income.salary": ">=1 <2",
    "contingency.event": ">=1 <2",
  },
  params: [
    ELDERLY_AGE,...PARTS.flatMap((p) => KEYS.map((k) => `${PREFIX}.${p.part}.${k}`)), `${PREFIX}.incomeDeduction`, ...REDUCTION, ...Object.values(AGE), LATE_ELDERLY_AGE],
  reads: [
    "member.outside",
    "member.kind",
    "member.birth",
    "member.joins",
    "member.leaves",
    "member.joins",
    "member.birth",
    "employment.member",
    "employment.from",
    "employment.to",
    "employment.type",
    "employment.healthInsurance.kind",
    "member.support",
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
    // 世帯の外の家族は別の世帯（0035 の4）
    const members = householdMembers(ctx.list<MemberInput>("member"));
    const insured = members
      .map((m) => ({
        id: m.id,
        // 表の最後の年の年度は、表の外の翌年1〜3月も数える（改訂8）
        months: healthStatusInFiscalYear(ctx, m.id, fy)
          .filter((x) => x.kind === "national")
          .map((x) => parseYm(x.month)),
      }))
      .filter((x) => x.months.length > 0);
    if (insured.length === 0) return { flows: [] };
    // 世帯主（改訂11）: 年度の始まり（計算基準月より前の年度は計算基準月）に世帯にいる人から。だれもいなければ最初に加入する月
    const firstInsured = Math.min(...insured.map((x) => Math.min(...x.months))) as typeof ageAt;
    const head = (householdHeadAt(ctx, members, ageAt) ?? householdHeadAt(ctx, members, firstInsured) ?? (members[0] as MemberInput)).id;
    const given = assessedPremium(ctx.list<PremiumAssessmentInput>("premiumAssessment"), "nationalHealth", head, fy);
    if (given !== undefined) {
      const amount = boxValue((given as PremiumAssessmentInput).amount) ?? yen(0);
      return { flows: reassignAfterLeave(ctx, members, installmentFlows(ctx, fy, false, head, [{ row: "cf.taxSi.health", amount, formula: "socialInsurance.nationalHealth.assessed" }])) };
    }
    const at = ctx.at(valuesAt);
    const override = rateOverride(ctx.list<PremiumRateInput>("premiumRate"), "nationalHealth", fy);
    // 純損失の繰越控除（青色申告。前の年の総所得金額から引く額）
    const carryOf = (id: string): number => ctx.call<LossCarryforwardOutput>("tax.lossCarryforward", { member: id }).byYear.find((x) => x.year === jy - 1)?.deducted ?? 0;
    const totalOf = (id: string) => {
      const t = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year: jy - 1 });
      return yen(t.total + (t.separate ?? 0) - carryOf(id));
    };
    const deduction = at.paramYen(`${PREFIX}.incomeDeduction`) ?? yen(0);
    // 特定同一世帯所属者（改訂12）: 国民健康保険から75歳で後期高齢者医療に移り、その年度に同じ世帯にいる人と、移った月。
    // 別居の親・祖父母（member.support.cohabiting が true でない）は同じ世帯でないとみなす
    const yearEnd = addMonths(start, 11);
    const employment = ctx.list<EmploymentPeriodInput>("employment");
    const fromNational = (id: string, moved: MonthIndex): boolean => {
      const prev = addMonths(moved, -1);
      const got = ctx.callMonths<HealthStatusMonth>("socialInsurance.healthStatus", { member: id }, "months", prev, prev);
      if (got.length > 0) return (got[0] as HealthStatusMonth).kind === "national";
      // 表の前の月: 勤め先の健康保険の期間（任意継続を含む）がその月に無ければ、国民健康保険だったとみなす
      return !employment.some(
        (p) =>
          p.member === id &&
          (EMPLOYEE_TYPES.has(p.type) || p.healthInsurance?.kind === "continuation" || EMPLOYER_HEALTH_KINDS.has(p.healthInsurance?.kind ?? "")) &&
          ctx.time.resolve(p.from) <= prev &&
          (p.to === null || ctx.time.resolve(p.to) >= prev),
      );
    };
    const specific = members.flatMap((m) => {
      if ((m.kind === "parent" || m.kind === "grandparent") && m.support?.cohabiting !== true) return [];
      const moved = ageMonth(ctx, ageAt, LATE_ELDERLY_AGE, m.id);
      if (moved > yearEnd) return [];
      const end = insuranceEndMonth(ctx, m);
      const from = m.joins === null ? null : ctx.time.resolve(m.joins);
      if ((end !== null && end <= start) || (from !== null && from > yearEnd)) return [];
      if (!fromNational(m.id, moved)) return [];
      return [{ id: m.id, moved, end }];
    });
    const judgedIds = new Set([head, ...insured.map((x) => x.id), ...specific.map((x) => x.id)]);
    const persons = new Set([...insured.map((x) => x.id), ...specific.map((x) => x.id)]).size;
    // 軽減の判定: 65歳以上の公的年金の所得からは特別に引く（高齢者特別控除）
    const elderlyDeduction = at.paramYen(`${PREFIX}.reduction.elderlyPensionDeduction`) ?? yen(0);
    let judged = yen(0);
    let earners = 0;
    for (const id of judgedIds) {
      const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year: jy - 1 });
      const elderly = ageMonth(ctx, start, ELDERLY_AGE, id) <= monthIndex(jy - 1, 12);
      const special = elderly ? yen(Math.min(elderlyDeduction, inc.publicPension ?? 0)) : yen(0);
      judged = addYen(judged, yen(inc.total + (inc.separate ?? 0) - carryOf(id) - special));
      // 給与所得者等（改訂12）
      if (isEarner(ctx, valuesAt, PREFIX, id, jy - 1, elderly)) earners++;
    }
    const keep = ctx.rate.sub(RATE_ONE, reductionRatio(ctx, valuesAt, PREFIX, judged, earners, persons));
    // 平等割に掛ける月ごとの割合の合計（12分の何か。特定世帯は2分の1、特定継続世帯は4分の3。改訂12）
    const householdShare = (months: readonly MonthIndex[], part: PremiumPart): { num: number; den: number } => {
      let num = 0;
      for (const m of months) {
        const count = insured.filter((x) => x.months.includes(m)).length;
        const since = specific
          .filter((x) => x.moved <= m && (x.end === null || m < x.end))
          .reduce<number | null>((best, x) => (best === null || m - x.moved < best ? m - x.moved : best), null);
        if (!SPECIFIC_PARTS.has(part) || count !== 1 || since === null || since >= SPECIFIC_CONTINUED_MONTHS) num += 4;
        else num += since < SPECIFIC_MONTHS ? 2 : 3;
      }
      return { num, den: 48 };
    };
    const parts: { row: string; amount: Yen; formula: string }[] = [];
    let missing = false;
    let childSupportMissing = false;
    // 料率の入力が無い区分・欄に全国の目安を使ったか
    let defaultUsed = false;
    for (const { part, row } of PARTS) {
      // 子ども・子育て支援金の区分が始まる前の年度（改訂10）
      if (part === "childSupport" && !at.has(AGE.childUntil)) continue;
      const o = override?.parts?.[part];
      // 料率の入力にその区分があれば入力の欄だけを使い（無い欄は0。平等割の無い市町村など）、区分が無ければ全国の目安を使う
      const pick = <T>(given: T | null, id: string, read: (id: string) => T | null): T | null => {
        if (o !== undefined) return given;
        if (!at.has(id)) return null;
        defaultUsed = true;
        return read(id);
      };
      const ir = o?.incomeRate !== undefined ? boxValue(o.incomeRate) : null;
      const incomeRate = pick<Rate>(ir === null ? null : rate(ir), `${PREFIX}.${part}.incomeRate`, (id) => at.paramRate(id));
      const perCapita = pick<Yen>(o?.perCapita !== undefined ? boxValue(o.perCapita) : null, `${PREFIX}.${part}.perCapita`, (id) => at.paramYen(id));
      const perHousehold = pick<Yen>(o?.perHousehold !== undefined ? boxValue(o.perHousehold) : null, `${PREFIX}.${part}.perHousehold`, (id) => at.paramYen(id));
      if (incomeRate === null && perCapita === null && perHousehold === null) {
        // 子ども・子育て支援金の区分は令和8年度から（それより前は値が無い）。令和8年度からの全国の目安はまだ制度データに無いので、
        // 入れずに計算し、目安が無いことを知らせる
        if (part !== "childSupport" || override !== undefined) missing ||= part !== "childSupport";
        else if (at.has(`${PREFIX}.childSupport.limit`) && at.paramYen(`${PREFIX}.childSupport.limit`) !== null) childSupportMissing = true;
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
      if (perHousehold !== null) {
        // 平等割は、その区分に入る人がいる月（世帯の月）ごとに特定世帯の割合を掛ける（改訂12）
        const ms = new Set<MonthIndex>();
        for (const x of insured) {
          for (const m of x.months) {
            if (part === "care" && (m < ageMonth(ctx, ageAt, AGE.careFrom, x.id) || m >= ageMonth(ctx, ageAt, AGE.careUntil, x.id))) continue;
            ms.add(m);
          }
        }
        const share = householdShare([...ms].sort((a, b) => a - b), part);
        total = addYen(total, at.money.mulRatio(at.money.mulRate(perHousehold, keep, "conv.premium.local"), share.num, share.den, "conv.premium.local"));
      }
      const limit = at.has(`${PREFIX}.${part}.limit`) ? at.paramYen(`${PREFIX}.${part}.limit`) : null;
      if (limit !== null) {
        const cap = at.money.mulRatio(limit, partMonths, 12, "conv.premium.local");
        if (total > cap) total = cap;
      }
      parts.push({ row, amount: total, formula: `socialInsurance.nationalHealth.${part}` });
    }
    if (missing) ctx.notice("N_INPUT_REQUIRED", [`${PREFIX}.rates`]);
    else if (defaultUsed) ctx.notice("N_DEFAULT_USED", [`${PREFIX}.nationalStandard`]);
    if (!missing && childSupportMissing) ctx.notice("N_PARAM_MISSING", [`${PREFIX}.childSupport.nationalStandard`]);
    // 小学校に入る（6歳の後の4月。学年の区切り）より前の月に国民健康保険に入っている子がいるか
    if (insured.some((x) => x.months.some((m) => m < ctx.time.ageSwitch(x.id, { years: 6 }, "schoolYear")))) {
      ctx.notice("N_NOT_SUPPORTED", [`${PREFIX}.preschoolReduction`, `${PREFIX}.maternityExemption`]);
    }
    return { flows: reassignAfterLeave(ctx, members, installmentFlows(ctx, fy, false, head, parts)) };
  },
});

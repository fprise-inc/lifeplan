// 教育の公的支援（0010 の5: 学費とは別の部品。学費データには支援を引く前の額だけを持つ）。子ごと。受け取るのは親（関係 parentOf の最初の親）。
// - 高等学校等就学支援金: 高校の在学の年度ごとに、上限（公立・私立。2026年度から所得の制限なし）と授業料（学校の費用）の小さい方を、
//   年度の12か月に分けて（学校が授業料から差し引く形を、収入 cf.income.benefit.education として載せる）
// - 高等教育の修学支援新制度（大学）: 支給額算定基準額＝Σ親（住民税の課税標準額×6%−市町村民税の調整控除の額）（100円未満切り捨て）で区分
//   （第I〜第IV区分。境目は制度データ）を決め、4〜9月は前年度、10〜3月はその年度の住民税で判定する。授業料・入学金の減免は
//   上限（国公立・私立）と実際の額の小さい方×区分の割合（第I区分は全額、II 2/3、III 1/3、IV 1/4）。多子世帯（扶養する子が3人以上。
//   22歳に達した後の最初の3月31日までの子の数で近似）は、2025年度から所得によらず上限まで全額。給付型奨学金（月額）は第I〜第III区分
//   （第IV区分は多子世帯だけ）に、国公立・私立×自宅・自宅外の額を毎月。資産の要件・理工農系の第IV区分・短大・専門学校は扱わない（知らせ）
// 支援の額は名目額で、教育費の上昇率を当てない（0010 の5）
import {
  addMonths,
  ageMonth,
  bracketFor,
  defineComponent,
  formatYm,
  monthIndex,
  RATE_ZERO,
  yearOf,
  yen,
  type Flow,
  type FlowsResult,
  type MemberInput,
  type MonthIndex,
  type RelationInput,
  type ResidentTaxOutput,
  type Yen,
  type EducationCostOutput,
} from "../../sdk/index.ts";

const H = "educationSupport.highSchool";
const U = "educationSupport.higher";
const P = {
  hsPublic: `${H}.publicAnnual`,
  hsPrivate: `${H}.privateAnnual`,
  calcRate: `${U}.calcRate`,
  calcRounding: `${U}.calcRounding`,
  categories: `${U}.categories`,
  waiverRatio: `${U}.waiverRatio`,
  multiChild: `${U}.multiChild.minChildren`,
  countAge: "childAllowance.countUntilAge",
  capNationalTuition: `${U}.waiver.national.tuition`,
  capNationalAdmission: `${U}.waiver.national.admission`,
  capPrivateTuition: `${U}.waiver.private.tuition`,
  capPrivateAdmission: `${U}.waiver.private.admission`,
  grantPublicHome: `${U}.grant.public.home`,
  grantPublicAway: `${U}.grant.public.away`,
  grantPrivateHome: `${U}.grant.private.home`,
  grantPrivateAway: `${U}.grant.private.away`,
};

export default defineComponent<{ member: string }, FlowsResult>({
  id: "education.support",
  title: "教育の公的支援（就学支援金・修学支援）",
  contract: "1.0",
  revision: 1,
  requires: { "education.cost": ">=1 <2", "residentTax.annual": ">=1 <2" },
  params: Object.values(P),
  reads: ["member.kind", "member.birth", "member.joins", "member.leaves", "relation.type", "relation.parent", "relation.child"],
  input: "member.input",
  output: "flows.output",
  compute(input, ctx) {
    const child = input.member;
    const enrollments = ctx.call<EducationCostOutput>("education.cost", { member: child }).enrollments;
    if (!enrollments.some((e) => e.stage === "highSchool" || e.stage === "university" || e.stage === "juniorCollege" || e.stage === "vocational")) return { flows: [] };
    const { base, end } = ctx.time;
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    const parents = relations.filter((r): r is Extract<RelationInput, { type: "parentOf" }> => r.type === "parentOf" && r.child === child).map((r) => r.parent);
    const earners = parents.length > 0 ? parents : members.filter((m) => m.kind === "self" || m.kind === "spouse").map((m) => m.id);
    const recipient = earners[0] ?? child;
    const flows: Flow[] = [];
    const push = (m: MonthIndex, amount: Yen, formula: string) => {
      if (amount > 0 && m >= base && m <= end) flows.push({ row: "cf.income.benefit.education", ym: formatYm(m), amount, accrualYear: yearOf(m), member: recipient, object: child, formula });
    };
    const monthly12 = (annual: Yen) => ctx.money.allocate(annual, Array.from({ length: 12 }, () => 1), "conv.expense.share", "first");
    // 支給額算定基準額の区分（その年度の住民税で）
    const categoryCache = new Map<number, number>();
    const categoryOf = (fy: number): number => {
      let c = categoryCache.get(fy);
      if (c !== undefined) return c;
      const at = ctx.at(monthIndex(fy, 4));
      const r = at.paramRate(P.calcRate) ?? RATE_ZERO;
      let sum = 0;
      for (const id of earners) {
        const rt = ctx.call<ResidentTaxOutput>("residentTax.annual", { member: id, fiscalYear: fy });
        if (rt.assessed) ctx.notice("N_APPROXIMATED", ["educationSupport.higher.assessedResidentTax"]);
        sum += ctx.money.mulRate(rt.taxable, r, "conv.tax.exact") - rt.adjustmentCredit.municipal;
      }
      const basis = at.money.round(yen(sum > 0 ? sum : 0), P.calcRounding);
      c = bracketFor(at.paramBrackets(P.categories) ?? [], basis).amount ?? 0;
      categoryCache.set(fy, c);
      return c;
    };
    // 多子世帯（22歳に達した後の最初の3月31日までの子の数）
    const childrenIn = (fy: number): number => {
      const start = monthIndex(fy, 4);
      let n = 0;
      for (const m of members) {
        if (m.kind !== "child") continue;
        if (ctx.time.resolve({ at: m.birth.birthYearMonth }) > start) continue;
        if (m.leaves !== null && ctx.time.resolve(m.leaves) <= start) continue;
        if (ageMonth(ctx, start, P.countAge, m.id) >= start) n++;
      }
      return n;
    };
    let unsupported = false;
    for (const e of enrollments) {
      const from = ctx.time.resolve({ at: e.from });
      if (e.stage === "highSchool") {
        for (const f of e.fees) {
          const at = ctx.at(monthIndex(f.fiscalYear, 4));
          const id = e.sector === "private" ? P.hsPrivate : P.hsPublic;
          if (!at.has(id)) {
            ctx.notice("N_PARAM_MISSING", [id, String(f.fiscalYear)]);
            continue;
          }
          const cap = at.paramYen(id) ?? yen(0);
          const parts = monthly12(f.tuition < cap ? f.tuition : cap);
          parts.forEach((v, i) => push(addMonths(monthIndex(f.fiscalYear, 4), i), v, "education.support.highSchool"));
        }
        continue;
      }
      if (e.stage !== "university") {
        if (e.stage === "juniorCollege" || e.stage === "vocational") unsupported = true;
        continue;
      }
      const publicSector = e.sector !== "private";
      for (const f of e.fees) {
        const at = ctx.at(monthIndex(f.fiscalYear, 4));
        if (!at.has(P.categories)) continue;
        const multiMin = at.has(P.multiChild) ? at.paramCount(P.multiChild) : null;
        const multi = multiMin !== null && childrenIn(f.fiscalYear) >= multiMin;
        const capT = at.paramYen(publicSector ? P.capNationalTuition : P.capPrivateTuition) ?? yen(0);
        const capA = at.paramYen(publicSector ? P.capNationalAdmission : P.capPrivateAdmission) ?? yen(0);
        const grantId = publicSector ? (e.living === "away" ? P.grantPublicAway : P.grantPublicHome) : e.living === "away" ? P.grantPrivateAway : P.grantPrivateHome;
        const tuitionHalves = ctx.money.allocate(f.tuition, [1, 1], "conv.expense.share", "first");
        const capHalves = ctx.money.allocate(capT, [1, 1], "conv.expense.share", "first");
        for (let h = 0; h < 2; h++) {
          const cat = categoryOf(h === 0 ? f.fiscalYear - 1 : f.fiscalYear);
          const eligible = cat >= 1 && cat <= 4;
          const ratio = multi ? ctx.rate.of("1") : eligible ? (bracketFor(at.paramBrackets(P.waiverRatio) ?? [], yen(cat)).rate ?? RATE_ZERO) : RATE_ZERO;
          const halfStart = monthIndex(f.fiscalYear, h === 0 ? 4 : 10);
          const t = tuitionHalves[h] as Yen;
          const c = capHalves[h] as Yen;
          push(halfStart, ctx.money.mulRate(t < c ? t : c, ratio, "conv.expense.share"), "education.support.tuitionWaiver");
          if (h === 0 && f.admission > 0) push(addMonths(from, publicSector ? -1 : -2), ctx.money.mulRate(f.admission < capA ? f.admission : capA, ratio, "conv.expense.share"), "education.support.admissionWaiver");
          // 給付型奨学金（第I〜第III区分。第IV区分は多子世帯だけ）
          if (eligible && (cat <= 3 || multi)) {
            const grant = bracketFor(at.paramBrackets(grantId) ?? [], yen(cat)).amount ?? yen(0);
            for (let i = 0; i < 6; i++) push(addMonths(halfStart, i), yen(grant), "education.support.grant");
          }
        }
      }
      ctx.notice("N_NOT_SUPPORTED", ["educationSupport.higher.assetTest", "educationSupport.higher.scienceAgriculture"]);
    }
    if (unsupported) ctx.notice("N_NOT_SUPPORTED", ["educationSupport.higher.juniorCollegeVocational"]);
    return { flows };
  },
});

// 教育の公的支援（0010 の5: 学費とは別の部品。学費データには支援を引く前の額だけを持つ）。子ごと。受け取るのは親（関係 parentOf の最初の親）。
// - 高等学校等就学支援金: 高校の在学の年度ごとに、上限（公立・私立。2026年度から所得の制限なし）と授業料（学校の費用）の小さい方を、
//   年度の12か月に分けて（学校が授業料から差し引く形を、収入 cf.income.benefit.education として載せる）
// - 高等教育の修学支援新制度（大学）: 支給額算定基準額＝Σ親（住民税の課税標準額×6%−市町村民税の調整控除の額）（100円未満切り捨て）で区分
//   （第I〜第IV区分。境目は制度データ）を決め、4〜9月は前年度、10〜3月はその年度の住民税で判定する。授業料・入学金の減免は
//   上限（国公立・私立）と実際の額の小さい方×区分の割合（第I区分は全額、II 2/3、III 1/3、IV 1/4）。多子世帯（扶養する子が3人以上。
//   22歳に達した後の最初の3月31日までの子の数で近似）は、2025年度から所得によらず上限まで全額。給付型奨学金（月額）は第I〜第III区分
//   （第IV区分は多子世帯だけ）に、国公立・私立×自宅・自宅外の額を毎月。資産の要件・短大・専門学校は扱わない（知らせ）
// 改訂2（PR #14 の「気づいたが直していない点」3〜5）: 第IV区分の減免（1/4）は、多子世帯でなければ理工農系（公示対象学部等。scienceAgriculture）の
//   学生だけ（施行規則10条2項4号）。減免の額は割合を掛けた額の100円未満を切り上げる（施行令2条1項2号。制度データの端数処理）。
//   高等学校等就学支援金は、教育の目標で対象外（highSchoolSupport: ineligible。令和8年4月からの国籍・在留資格の要件）とした子には出さない。
//   入れていない子は対象とみなし、令和8年度以後は知らせる（N_ASSUMED）
// 改訂3: 計算基準月より前に終わる年度・半期は判定しない（お金の動きが表に載らない。就学支援金も同じ）。判定に使う住民税の年度は、計算基準月に払っている
//   住民税の年度（residentTaxYearOf）より前にしない（それより前の年度は表に無く、その所得の年の制度の値は制度データに無いことがある。
//   計算基準月が6〜9月の年の4〜9月の分は、その年度の住民税で判定する）。住民税の決定額だけを入れた年度は、決定額の10分の6（市町村民税の
//   標準の割合）を、調整控除の後の市町村民税の所得割（課税標準額×6%−調整控除の額）とみなす（均等割の分だけ多め。保育料と同じ。0029 の3）
// 支援の額は名目額で、教育費の上昇率を当てない（0010 の5）
import {
  addMonths,
  ageMonth,
  bracketFor,
  defineComponent,
  formatYm,
  monthIndex,
  RATE_ZERO,
  residentTaxYearOf,
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
  waiverRounding: `${U}.waiver.rounding`,
};
/** 就学支援金の国籍・在留資格の要件（令和8年4月から） */
const HS_ELIGIBILITY_FROM = 2026;

export default defineComponent<{ member: string }, FlowsResult>({
  id: "education.support",
  title: "教育の公的支援（就学支援金・修学支援）",
  contract: "1.0",
  revision: 3,
  requires: { "education.cost": ">=1 <2", "residentTax.annual": ">=1 <2" },
  params: Object.values(P),
  reads: ["member.kind", "member.birth", "member.joins", "member.leaves", "relation.type", "relation.parent", "relation.child", "goal.kind", "goal.owner", "goal.education"],
  input: "member.input",
  output: "flows.output",
  compute(input, ctx) {
    const child = input.member;
    const enrollments = ctx.call<EducationCostOutput>("education.cost", { member: child }).enrollments;
    if (!enrollments.some((e) => e.stage === "highSchool" || e.stage === "university" || e.stage === "juniorCollege" || e.stage === "vocational")) return { flows: [] };
    const { base, end } = ctx.time;
    // 判定に使う住民税の最初の年度（計算基準月に払っている住民税の年度）
    const firstTaxYear = residentTaxYearOf(base);
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
        if (rt.assessed) {
          // 決定額だけが入っているとき: 課税標準額の内訳が無いので、決定額の10分の6（市町村民税の標準の割合）を課税標準額×6%−調整控除の額とみなす
          if (rt.total > 0) ctx.notice("N_APPROXIMATED", ["educationSupport.higher.assessedResidentTax"]);
          sum += ctx.money.mulRatio(rt.total, 6, 10, "conv.expense.share");
          continue;
        }
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
    const hsEligibility = ctx.list<{ kind: string; owner: string; education?: { highSchoolSupport?: string } }>("goal").find((g) => g.kind === "education" && g.owner === child)?.education?.highSchoolSupport;
    for (const e of enrollments) {
      const from = ctx.time.resolve({ at: e.from });
      if (e.stage === "highSchool") {
        for (const f of e.fees) {
          // 計算基準月より前に終わる年度は判定しない（お金の動きが表に載らず、制度データに無い年度を知らせない）
          if (monthIndex(f.fiscalYear + 1, 3) < base) continue;
          const at = ctx.at(monthIndex(f.fiscalYear, 4));
          const id = e.sector === "private" ? P.hsPrivate : P.hsPublic;
          if (!at.has(id)) {
            ctx.notice("N_PARAM_MISSING", [id, String(f.fiscalYear)]);
            continue;
          }
          if (f.fiscalYear >= HS_ELIGIBILITY_FROM) {
            if (hsEligibility === "ineligible") {
              ctx.notice("N_NOT_ELIGIBLE", ["educationSupport.highSchool.nationality", child]);
              continue;
            }
            if (hsEligibility === undefined) ctx.notice("N_ASSUMED", ["educationSupport.highSchool.nationality", child]);
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
        // 計算基準月より前に終わる年度は判定しない（お金の動きが表に載らない）
        if (monthIndex(f.fiscalYear + 1, 3) < base) continue;
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
          const halfStart = monthIndex(f.fiscalYear, h === 0 ? 4 : 10);
          // 計算基準月より前に終わる半期は判定しない
          if (addMonths(halfStart, 5) < base) continue;
          // 4〜9月は前年度、10〜3月はその年度の住民税で判定する（判定に使う住民税の最初の年度より前にしない）
          const cat = categoryOf(Math.max(h === 0 ? f.fiscalYear - 1 : f.fiscalYear, firstTaxYear));
          const eligible = cat >= 1 && cat <= 4;
          // 第IV区分の減免は、多子世帯でなければ理工農系の学生だけ
          const waived = eligible && (cat <= 3 || e.scienceAgriculture);
          const ratio = multi ? ctx.rate.of("1") : waived ? (bracketFor(at.paramBrackets(P.waiverRatio) ?? [], yen(cat)).rate ?? RATE_ZERO) : RATE_ZERO;
          // 減免の額の端数（100円未満を切り上げ。全額のときは端数が出ない）
          const waiverOf = (x: Yen): Yen => (at.has(P.waiverRounding) ? at.money.mulRate(x, ratio, P.waiverRounding) : ctx.money.mulRate(x, ratio, "conv.expense.share"));
          const t = tuitionHalves[h] as Yen;
          const c = capHalves[h] as Yen;
          push(halfStart, waiverOf(t < c ? t : c), "education.support.tuitionWaiver");
          if (h === 0 && f.admission > 0) push(addMonths(from, publicSector ? -1 : -2), waiverOf(f.admission < capA ? f.admission : capA), "education.support.admissionWaiver");
          // 給付型奨学金（第I〜第III区分。第IV区分は多子世帯だけ）
          if (eligible && (cat <= 3 || multi)) {
            const grant = bracketFor(at.paramBrackets(grantId) ?? [], yen(cat)).amount ?? yen(0);
            for (let i = 0; i < 6; i++) push(addMonths(halfStart, i), yen(grant), "education.support.grant");
          }
        }
      }
      ctx.notice("N_NOT_SUPPORTED", ["educationSupport.higher.assetTest", "educationSupport.higher.scienceAgricultureMinimum"]);
    }
    if (unsupported) ctx.notice("N_NOT_SUPPORTED", ["educationSupport.higher.juniorCollegeVocational"]);
    return { flows };
  },
});

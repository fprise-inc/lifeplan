// 教育の公的支援（0010 の5: 学費とは別の部品。学費データには支援を引く前の額だけを持つ）。子ごと。受け取るのは親（関係 parentOf の最初の親）。
// - 高等学校等就学支援金: 高校の在学の年度ごとに、上限（公立・私立。2026年度から所得の制限なし）と授業料（学校の費用）の小さい方を、
//   年度の12か月に分けて（学校が授業料から差し引く形を、収入 cf.income.benefit.education として載せる）
// - 高等教育の修学支援新制度（大学）: 支給額算定基準額＝Σ親（住民税の課税標準額×6%−市町村民税の調整控除の額）（100円未満切り捨て）で区分
//   （第I〜第IV区分。境目は制度データ）を決め、4〜9月は前年度、10〜3月はその年度の住民税で判定する。授業料・入学金の減免は
//   上限（国公立・私立）と実際の額の小さい方×区分の割合（第I区分は全額、II 2/3、III 1/3、IV 1/4）。多子世帯（扶養する子が3人以上）は、
//   2025年度から所得によらず上限まで全額。給付型奨学金（月額）は第I〜第III区分
//   （第IV区分は多子世帯だけ）に、国公立・私立×自宅・自宅外の額を毎月。資産の要件・短大・専門学校は扱わない（知らせ）
// 改訂2（PR #14 の「気づいたが直していない点」3〜5）: 第IV区分の減免（1/4）は、多子世帯でなければ理工農系（公示対象学部等。scienceAgriculture）の
//   学生だけ（施行規則10条2項4号）。減免の額は割合を掛けた額の100円未満を切り上げる（施行令2条1項2号。制度データの端数処理）。
//   高等学校等就学支援金は、教育の目標で対象外（highSchoolSupport: ineligible。令和8年4月からの国籍・在留資格の要件）とした子には出さない。
//   入れていない子は対象とみなし、令和8年度以後は知らせる（N_ASSUMED）
// 改訂3: 計算基準月より前に終わる年度・半期は判定しない（お金の動きが表に載らない。就学支援金も同じ）。判定に使う住民税の年度は、計算基準月に払っている
//   住民税の年度（residentTaxYearOf）より前にしない（それより前の年度は表に無く、その所得の年の制度の値は制度データに無いことがある。
//   計算基準月が6〜9月の年の4〜9月の分は、その年度の住民税で判定する）。住民税の決定額だけを入れた年度は、決定額の10分の6（市町村民税の
//   標準の割合）を、調整控除の後の市町村民税の所得割（課税標準額×6%−調整控除の額）とみなす（均等割の分だけ多め。保育料と同じ。0029 の3）
// 改訂4: 多子世帯の数え方を、年齢での近似（22歳に達した後の最初の3月31日までの子）から、住民税の扶養で数える形にした。
//   区分と同じ住民税の情報で判定する（4〜9月は前年度の住民税＝前々年の12月31日、10〜3月はその年度の住民税＝前年の12月31日の扶養。
//   判定に使う住民税の年度を改訂3で繰り上げたときは、その年度の前年の12月31日）。
//   数えるのは、その12月31日に世帯にいる子のうち、その年の合計所得金額が住民税の扶養親族の上限（residentTax.dependentIncomeLimit）以下の子
//   （年齢によらない。浪人・大学院・無職の子も数え、就職して上限を超えた子は数えない）と、令和8年度住民税を用いる判定からは、特定親族特別控除の
//   年齢（19歳以上23歳未満）で合計所得金額が95万円以下の子（日本学生支援機構の運用）。学生本人が扶養の子でなければ多子世帯にしない。
//   扶養の上限の値が無い年（制度データより前の年）は、前の近似で数える。18歳の早生まれの特例・新たに生まれた子の申告による加算は扱わない
// 支援の額は名目額で、教育費の上昇率を当てない（0010 の5）
// 改訂（0090）: 高専（kosen）の1〜3年に就学支援金（国公立は高専の額、私立は私立の額）。4・5年の修学支援はまだ計算しない
// 改訂（0089）: 高校の段がインターナショナルスクール（sector international）なら就学支援金を計算しない
// 改訂7（0165）: 受け取る親は、受け取る月に世帯にいる最初の親（関係 parentOf の並び。無ければ本人・配偶者）。受け取る親が亡くなった後は、
//   残った親が受け取る（前は亡くなった親の名で出続けた。額・判定は変わらない）
// 改訂8（0173。修学支援の家計急変）: 生計維持者（親）が万一の想定で亡くなったら、亡くなった月の翌月から、家計急変の決まりで判定し直す
//   （亡くなった人を除き、残った生計維持者の住民税で区分を決める。生計維持者がだれもいなければ第I区分）。給付型奨学金は亡くなった月の翌月の分から、
//   授業料の減免はその月より後に始まる半期から、入学金の減免はその月より後に払う物から。定期の判定（4〜9月は前年度・10〜3月はその年度の住民税）で
//   亡くなった人の住民税が残る年度も、亡くなった人を除く（亡くなる年によらず、亡くなった後の判定が同じになる）。急変の後の見込みの所得ではなく、
//   残った生計維持者の判定の年度の住民税で判定する近似。死亡のほかの家計急変（失職・病気など）は扱わない
import {
  addMonths,
  deathMonthOf,
  firstPresent,
  ageMonth,
  bracketFor,
  parseYm,
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
  type TotalIncomeOutput,
  type Yen,
  type EducationCostOutput,
} from "../../sdk/index.ts";

const H = "educationSupport.highSchool";
const U = "educationSupport.higher";
const P = {
  hsPublic: `${H}.publicAnnual`,
  hsPrivate: `${H}.privateAnnual`,
  /** 国公立の高専（1〜3年）の就学支援金の年額（0090） */
  hsKosenPublic: `${H}.kosenPublicAnnual`,
  calcRate: `${U}.calcRate`,
  calcRounding: `${U}.calcRounding`,
  categories: `${U}.categories`,
  waiverRatio: `${U}.waiverRatio`,
  multiChild: `${U}.multiChild.minChildren`,
  countAge: "childAllowance.countUntilAge",
  multiChildSpecifiedLimit: `${U}.multiChild.specifiedRelativeIncomeLimit`,
  dependentLimit: "residentTax.dependentIncomeLimit",
  specifiedFrom: "incomeTax.dependentDeduction.specifiedFromAge",
  specifiedUntil: "incomeTax.dependentDeduction.specifiedUntilAge",
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
  revision: 8,
  requires: { "education.cost": ">=1 <2", "residentTax.annual": ">=1 <2", "tax.totalIncome": ">=1 <2", "contingency.event": ">=1 <2" },
  params: Object.values(P),
  reads: ["member.kind", "member.birth", "member.joins", "member.leaves", "relation.type", "relation.parent", "relation.child", "goal.kind", "goal.owner", "goal.education"],
  input: "member.input",
  output: "flows.output",
  compute(input, ctx) {
    const child = input.member;
    const enrollments = ctx.call<EducationCostOutput>("education.cost", { member: child }).enrollments;
    if (!enrollments.some((e) => e.stage === "highSchool" || e.stage === "kosen" || e.stage === "university" || e.stage === "juniorCollege" || e.stage === "vocational")) return { flows: [] };
    const { base, end } = ctx.time;
    // 判定に使う住民税の最初の年度（計算基準月に払っている住民税の年度）
    const firstTaxYear = residentTaxYearOf(base);
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    const parents = relations.filter((r): r is Extract<RelationInput, { type: "parentOf" }> => r.type === "parentOf" && r.child === child).map((r) => r.parent);
    const earners = parents.length > 0 ? parents : members.filter((m) => m.kind === "self" || m.kind === "spouse").map((m) => m.id);
    // 受け取る親（改訂の 0165）: 受け取る月に世帯にいる最初の親（亡くなった親の名で受け取らない）
    const recipientAt = (m: MonthIndex): string => firstPresent(ctx, members, earners, m) ?? child;
    const flows: Flow[] = [];
    const push = (m: MonthIndex, amount: Yen, formula: string) => {
      if (amount > 0 && m >= base && m <= end) flows.push({ row: "cf.income.benefit.education", ym: formatYm(m), amount, accrualYear: yearOf(m), member: recipientAt(m), object: child, formula });
    };
    const monthly12 = (annual: Yen) => ctx.money.allocate(annual, Array.from({ length: 12 }, () => 1), "conv.expense.share", "first");
    // 生計維持者が亡くなる月（家計急変。改訂8）
    const deaths = new Map(earners.map((id) => [id, deathMonthOf(ctx, id)]));
    /** 月 m の判定で数える生計維持者（亡くなった月の翌月からは除く） */
    const earnersAt = (m: MonthIndex): string[] => earners.filter((id) => {
      const d = deaths.get(id) ?? null;
      return d === null || m <= d;
    });
    // 支給額算定基準額の区分（その年度の住民税で。m の月の生計維持者）
    const categoryCache = new Map<string, number>();
    const categoryOf = (fy: number, m: MonthIndex): number => {
      const ids = earnersAt(m);
      const key = `${fy}|${ids.join(",")}`;
      let c = categoryCache.get(key);
      if (c !== undefined) return c;
      const at = ctx.at(monthIndex(fy, 4));
      const r = at.paramRate(P.calcRate) ?? RATE_ZERO;
      let sum = 0;
      for (const id of ids) {
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
      categoryCache.set(key, c);
      return c;
    };
    // 多子世帯の子の数（扶養の上限の値が無い年の近似: 22歳に達した後の最初の3月31日までの子の数）
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
    // 多子世帯の子の数: year の12月31日に扶養している子（住民税の扶養。その年の所得に対する住民税の年度の値で判定）。
    // 学生本人が扶養の子でなければ 0。扶養の上限の値が無い年は null
    const dependentCache = new Map<number, number | null>();
    const dependentChildren = (year: number): number | null => {
      if (dependentCache.has(year)) return dependentCache.get(year) as number | null;
      const dec = monthIndex(year, 12);
      const at = ctx.at(monthIndex(year + 1, 6));
      let n: number | null = null;
      if (at.has(P.dependentLimit)) {
        const limit = at.paramYen(P.dependentLimit) ?? yen(0);
        const specifiedLimit = at.has(P.multiChildSpecifiedLimit) ? at.paramYen(P.multiChildSpecifiedLimit) : null;
        const ageStart = monthIndex(year, 1);
        let count = 0;
        let self = false;
        for (const m of members) {
          if (m.kind !== "child" || parseYm(m.birth.birthYearMonth) > dec) continue;
          if (m.joins !== null && ctx.time.resolve(m.joins) > dec) continue;
          if (m.leaves !== null && ctx.time.resolve(m.leaves) <= dec) continue;
          const total = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: m.id, year }).total;
          let counted = total <= limit;
          // 特定親族特別控除の年齢（12月31日に19歳以上23歳未満）で、合計所得金額が上限以下の子も数える
          if (!counted && specifiedLimit !== null && total <= specifiedLimit) {
            counted = ageMonth(ctx, ageStart, P.specifiedFrom, m.id) <= dec && ageMonth(ctx, ageStart, P.specifiedUntil, m.id) > dec;
          }
          if (!counted) continue;
          count++;
          if (m.id === child) self = true;
        }
        n = self ? count : 0;
      }
      dependentCache.set(year, n);
      return n;
    };
    // 判定に使う住民税の年度（taxYear）の扶養（その前年の12月31日）で数える。値が無ければ在学の年度（fy）の4月の近似
    const multiChildCount = (taxYear: number, fy: number): number => dependentChildren(taxYear - 1) ?? childrenIn(fy);
    let unsupported = false;
    let kosenUpper = false;
    const hsEligibility = ctx.list<{ kind: string; owner: string; education?: { highSchoolSupport?: string } }>("goal").find((g) => g.kind === "education" && g.owner === child)?.education?.highSchoolSupport;
    for (const e of enrollments) {
      const from = ctx.time.resolve({ at: e.from });
      if (e.stage === "highSchool" || e.stage === "kosen") {
        // インターナショナルスクール（各種学校などの外国人学校）は就学支援金の対象外（令和8年4月から。0089）。学校教育法第1条の学校なら私立で入れる
        if (e.sector === "international") continue;
        // 高専は1〜3年だけが就学支援金の対象（4・5年は高等教育の修学支援の対象で、まだ計算しない。0090）
        const fees = e.stage === "kosen" ? e.fees.slice(0, 3) : e.fees;
        if (e.stage === "kosen" && e.fees.length > 3) kosenUpper = true;
        for (const f of fees) {
          // 計算基準月より前に終わる年度は判定しない（お金の動きが表に載らず、制度データに無い年度を知らせない）
          if (monthIndex(f.fiscalYear + 1, 3) < base) continue;
          const at = ctx.at(monthIndex(f.fiscalYear, 4));
          const id = e.sector === "private" ? P.hsPrivate : e.stage === "kosen" ? P.hsKosenPublic : P.hsPublic;
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
          const taxYear = Math.max(h === 0 ? f.fiscalYear - 1 : f.fiscalYear, firstTaxYear);
          // 多子世帯も、判定に使う住民税の扶養（その年度の前年の12月31日）で数える
          const multi = multiMin !== null && multiChildCount(taxYear, f.fiscalYear) >= multiMin;
          // 月 m の判定（生計維持者が亡くなった月の翌月からは、家計急変で亡くなった人を除いて判定し直す。改訂8）
          const ruleAt = (m: MonthIndex) => {
            const cat = categoryOf(taxYear, m);
            const eligible = cat >= 1 && cat <= 4;
            // 第IV区分の減免は、多子世帯でなければ理工農系の学生だけ
            const waived = eligible && (cat <= 3 || e.scienceAgriculture);
            const ratio = multi ? ctx.rate.of("1") : waived ? (bracketFor(at.paramBrackets(P.waiverRatio) ?? [], yen(cat)).rate ?? RATE_ZERO) : RATE_ZERO;
            // 減免の額の端数（100円未満を切り上げ。全額のときは端数が出ない）
            const waiverOf = (x: Yen): Yen => (at.has(P.waiverRounding) ? at.money.mulRate(x, ratio, P.waiverRounding) : ctx.money.mulRate(x, ratio, "conv.expense.share"));
            return { cat, eligible, waiverOf };
          };
          const t = tuitionHalves[h] as Yen;
          const c = capHalves[h] as Yen;
          push(halfStart, ruleAt(halfStart).waiverOf(t < c ? t : c), "education.support.tuitionWaiver");
          if (h === 0 && f.admission > 0) {
            const am = addMonths(from, publicSector ? -1 : -2);
            push(am, ruleAt(am).waiverOf(f.admission < capA ? f.admission : capA), "education.support.admissionWaiver");
          }
          // 給付型奨学金（第I〜第III区分。第IV区分は多子世帯だけ）。月ごとに判定する
          for (let i = 0; i < 6; i++) {
            const gm = addMonths(halfStart, i);
            const g = ruleAt(gm);
            if (!g.eligible || !(g.cat <= 3 || multi)) continue;
            const grant = bracketFor(at.paramBrackets(grantId) ?? [], yen(g.cat)).amount ?? yen(0);
            push(gm, yen(grant), "education.support.grant");
          }
        }
      }
      ctx.notice("N_NOT_SUPPORTED", ["educationSupport.higher.assetTest", "educationSupport.higher.scienceAgricultureMinimum"]);
    }
    if (unsupported) ctx.notice("N_NOT_SUPPORTED", ["educationSupport.higher.juniorCollegeVocational"]);
    if (kosenUpper) ctx.notice("N_NOT_SUPPORTED", ["educationSupport.higher.kosenUpper"]);
    return { flows };
  },
});

// 教育費（13章・0010）。子ごと（教育の目標 goal の owner）に、進路パターン（学校の種類×公立・私立×系統×自宅・自宅外）を主な入力にし、
// 学校が決まっていれば学費データ（0010 の3）から写した行（stage.school.rows）で上書きする。公的支援は education.support（0010 の5）。
// - 学年は4月2日区切り（0003 の schoolYear）: 幼稚園は3歳、小学校は6歳、中学校は12歳、高校は15歳、大学・短大・専門学校は18歳（＋delayYears）の
//   学年の始まり（4月）から、在学年数（省略は 幼3・小6・中3・高3・大4（医歯系6）・短大2・専門2）
// - 学校の費用: 学費データの行があれば、入学年度×年次×費目×支払月（年次の始まりの月からのずれ）のとおりに払う（入学年度の行が無ければ、
//   最も近い入学年度の行に教育費の上昇率を当てて推計。知らせ N_ESTIMATED）。行が無ければ統計の平均（制度データ master.education.statistics。
//   計算基準年の値を教育費の上昇率で伸ばす）: 幼〜高は学校の費用（学習費総額−学校外活動費。学校外活動費の値が無い区分は学習費総額を学校の費用にし、
//   学校外活動費を足さない）を年度の12か月に分けて毎月、大学・短大は授業料＋施設設備費を4月と10月に半分ずつ、入学金を入学の前の2月
//   （国公立は3月）に払う。annualOverride・entranceOverride で直接入れられる
// - 保育料（nursery）: 部品 education.nurseryFee が計算する（月額の入力と、収入からの自動の計算。0029）。この部品は数えない
// - 学校給食費（改訂3。0029）: 公立小学校は、学校給食費の負担軽減（令和8年度から。制度データ educationSupport.schoolLunch.*）の年度に、
//   統計の学校給食費（education.statistics.<段>.public.schoolLunch を教育費の上昇率で伸ばした額）と基準額×月数（名目額）の小さい方を
//   学校の費用から引く（基準額を超える分は保護者の負担として残す）。教育の目標の schoolLunch が free（自治体が無償化）なら公立の小学校・中学校の
//   全年度で統計の学校給食費の全額を引き、paid なら引かない。学校の年額を直接入れた段・学費データの行の段は引かない
// - 受験・併願の費用（exam）: 受験料を入学の前の1月、入学しなかった学校への納付金を2月に
// - 学校外活動費（outOfSchool）: 統計の平均（幼〜高）か月額か無し。塾・習い事（lessons）は月額を足す
// - 改訂4（0062）: 学校外の費用の入れ方（outOfSchoolMode）。statistics は段の学校外活動費だけを数え、塾・習い事の行は数えない（行は残す）。
//   rows は塾・習い事の行だけを数え、段の学校外活動費（統計の平均・月額）は数えない（統計の平均は塾・習い事を含むので、行と二重にしない）。
//   省略は前の形（段の学校外活動費に行を足す）
// - 改訂5（0062 の追記 2026-10-30）: 段ごとの給食費の選び方（段の schoolLunch。省略は教育の目標の schoolLunch）。
//   部活動などの費用（段の clubAnnual。幼〜高）: 統計の平均で計算する段は、学校の費用から統計の教科外活動費（education.statistics.<段>.<公私>.extracurricular。
//   クラブ活動・部活動・学芸会・運動会など）を引いて入れた額を足す（部活動の費用は学校教育費の教科外活動費に含まれるので、二重にしない）。
//   学校の年額を直接入れた段は、その年額に足す
// - 自宅外の生活費（boarding）: 仕送り（月額。省略は統計の年額÷12）を在学中毎月、初期費用（省略は統計）を入学の前の3月に
// - 貸与の奨学金（scholarships）: 在学中に受け取り（cf.income.other.scholarship）、返済は debt.schedule（返す人は既定で子。返済の始まりの
//   既定は受け取りの終わりの7か月後）。教育ローン（loans）は借りる月に受け取り、翌月から返す
// - 子への援助（gifts。結婚・住宅資金）: 額の入力まで（cf.expense.lumpSum.wedding・gift。贈与の税は贈与の作業で扱う）
// - 改訂6（0088）: 留学（abroad。1回ずつ）。在学中の学校の段の、その学年の始まり（短期はその年の8月）に1回の額（計算基準年の価格。教育費の上昇率で
//   伸ばす）を表の行「教育費」に。休学して1年（leave）は、その段の在学が1年延び、その年は学費・学校の費用・学校外活動費・仕送りがかからない（後の学年と
//   後の段が1年ずつうしろにずれる）。万一のときの扱いが stop なら、世帯の万一の想定（contingency.event）の月の翌月より後の留学は払わない
// - 改訂7（0089）: 大学院（graduateMaster 修士・博士前期 2年、graduateDoctor 博士・博士後期 3年）。前の段（大学など・修士）を出た翌月の4月から
//   （前の段が無ければ22歳・24歳の学年。浪人の年数はその後に足す）。学費は国立の標準額・公立の平均・私立の課程ごとの平均（授業料＋施設設備費）と入学料。
//   インターナショナルスクール（幼〜高の sector international）は統計の目安が無いので、学校の年額を入れるまで0円（知らせ N_INPUT_REQUIRED）。
//   学校外活動費は私立の統計の平均
// 教育費の上昇率は学校の費用・学校外活動費・仕送り・留学に当て、公的支援には当てない（0010 の5）
import {
  addMonths,
  defineComponent,
  formatYm,
  grownByYear,
  monthIndex,
  yearOf,
  yen,
  type ContingencyEvent,
  type ContingencyEventOutput,
  type DebtScheduleOutput,
  type EducationCostOutput,
  type EducationGoalInput,
  type Enrollment,
  type Flow,
  type GoalInput,
  type MonthIndex,
  type SchoolStage,
  type Yen,
} from "../../sdk/index.ts";

const S = "education.statistics";
const K12: ReadonlySet<SchoolStage> = new Set(["kindergarten", "elementary", "juniorHigh", "highSchool"]);
const START_AGE: Readonly<Record<SchoolStage, number>> = { nursery: 1, kindergarten: 3, elementary: 6, juniorHigh: 12, highSchool: 15, university: 18, juniorCollege: 18, vocational: 18, graduateMaster: 22, graduateDoctor: 24 };
const YEARS: Readonly<Record<SchoolStage, number>> = { nursery: 2, kindergarten: 3, elementary: 6, juniorHigh: 3, highSchool: 3, university: 4, juniorCollege: 2, vocational: 2, graduateMaster: 2, graduateDoctor: 3 };
/** 大学院の段（改訂7。0089）: 前の段（大学・短大・専門学校・修士）を出た翌月の4月から（浪人の年数はその後に足す） */
const GRADUATE: ReadonlySet<SchoolStage> = new Set(["graduateMaster", "graduateDoctor"]);
const AFTER_HIGH: ReadonlySet<SchoolStage> = new Set(["university", "juniorCollege", "vocational", "graduateMaster", "graduateDoctor"]);
const K12_SECTORS = ["public", "private"] as const;
const FIELDS = ["all", "humanities", "science", "medical"] as const;
/** 学校給食費の負担軽減（制度）と統計の学校給食費（公立の小学校・中学校） */
const LUNCH_MONTHLY = "educationSupport.schoolLunch.elementary.public.monthly";
const LUNCH_MONTHS = "educationSupport.schoolLunch.months";
const LUNCH_STAGES: ReadonlySet<SchoolStage> = new Set(["elementary", "juniorHigh"]);
const PARAMS = [
  ...[...K12].flatMap((s) => K12_SECTORS.flatMap((x) => [`${S}.${s}.${x}.total`, `${S}.${s}.${x}.outOfSchool`])),
  ...[...LUNCH_STAGES].map((s) => `${S}.${s}.public.schoolLunch`),
  ...[...K12].flatMap((s) => K12_SECTORS.map((x) => `${S}.${s}.${x}.extracurricular`)),
  LUNCH_MONTHLY,
  LUNCH_MONTHS,
  ...FIELDS.flatMap((f) => ["tuition", "admission", "facility"].map((i) => `${S}.university.private.${f}.${i}`)),
  ...["national", "public"].flatMap((x) => ["tuition", "admission"].map((i) => `${S}.university.${x}.${i}`)),
  ...["tuition", "admission", "facility"].map((i) => `${S}.juniorCollege.private.${i}`),
  ...["national", "public"].flatMap((x) => ["tuition", "admission"].map((i) => `${S}.graduate.${x}.${i}`)),
  ...["master", "doctor"].flatMap((c) => ["tuition", "admission", "facility"].map((i) => `${S}.graduate.private.${c}.${i}`)),
  `${S}.boarding.annual`,
  `${S}.boarding.initial`,
];


export default defineComponent<{ member: string }, EducationCostOutput>({
  id: "education.cost",
  title: "教育費",
  contract: "1.0",
  revision: 7,
  requires: { "debt.schedule": ">=1 <2", "contingency.event": ">=1 <2" },
  params: PARAMS,
  reads: ["goal.kind", "goal.owner", "goal.education", "member.kind", "relation.type", "relation.parent", "relation.child", "assumptions.inflation", "assumptions.educationInflation"],
  memberScope: ["goal"],
  input: "member.input",
  output: "education.cost.output",
  compute(input, ctx) {
    const child = input.member;
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const flows: Flow[] = [];
    const loans: EducationCostOutput["loans"][number][] = [];
    const enrollments: Enrollment[] = [];
    // 子の親（関係 parentOf の最初の親。関係が無ければ本人）。奨学金を親が返す・援助を払う人の既定
    const rel = ctx.list<{ type: string; parent?: string; child?: string }>("relation").find((r) => r.type === "parentOf" && r.child === child);
    const parent: string = rel?.parent ?? ctx.list<{ id: string; kind: string }>("member").find((m) => m.kind === "self")?.id ?? child;
    const at0 = ctx.at(base);
    const stat = (id: string): Yen | null => (at0.has(id) ? at0.paramYen(id) : null);
    const missing = new Set<string>();
    const statOr0 = (id: string): Yen => {
      const v = stat(id);
      if (v === null) missing.add(id);
      return v ?? yen(0);
    };
    const series = new Map<number, Map<number, Yen>>();
    /** 計算基準年の額を教育費の上昇率で伸ばした、その年の額 */
    const grown = (amount: Yen, y: number): Yen => {
      if (amount === 0) return amount;
      let s = series.get(amount);
      if (s === undefined) {
        s = grownByYear(ctx, amount, { kind: "inflation" }, baseYear, Math.max(endYear, baseYear), "educationInflation");
        series.set(amount, s);
      }
      return s.get(y < baseYear ? baseYear : y > endYear ? endYear : y) ?? amount;
    };
    /** anchor の年の額を、その後の年の教育費の上昇率で伸ばした額 */
    const grownFrom = (amount: Yen, anchor: number, y: number): Yen => {
      if (y <= anchor) return amount;
      return grownByYear(ctx, amount, { kind: "inflation" }, anchor, y, "educationInflation").get(y) ?? amount;
    };
    // 世帯の万一の想定（留学の「やめる」に使う。いちばん初めに見つかった構成員の万一）
    let household: ContingencyEvent | null | undefined;
    const householdEvent = (): ContingencyEvent | null => {
      if (household === undefined) {
        household = null;
        for (const m of ctx.list<{ id: string }>("member")) {
          const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: m.id }).event;
          if (ev !== null) {
            household = ev;
            break;
          }
        }
      }
      return household;
    };
    for (const g of ctx.list<GoalInput>("goal")) {
      if (g.kind !== "education" || g.education === undefined || g.owner !== child) continue;
      const e: EducationGoalInput = g.education;
      // 留学の休学の年（段ごとの学年。小さい順）と、前の段の休学で後の段がずれる年数（改訂6）
      const abroad = e.abroad ?? [];
      const leavesOf = (stage: SchoolStage): number[] => abroad.filter((a) => a.kind === "leave" && a.stage === stage).map((a) => a.grade).sort((a, b) => a - b);
      const shiftOf = new Map<SchoolStage, number>();
      {
        let acc = 0;
        for (const st of [...e.stages].sort((a, b) => START_AGE[a.stage] - START_AGE[b.stage])) {
          shiftOf.set(st.stage, acc);
          acc += leavesOf(st.stage).length;
        }
      }
      /** 段の学年 grade の年が在学の何年目（0から）か（その学年より前の休学の年を足す） */
      const yearIndex = (stage: SchoolStage, grade: number, self: boolean): number => {
        const ls = leavesOf(stage);
        return grade - 1 + ls.filter((x) => (self ? x < grade : x <= grade)).length + (self ? ls.filter((x) => x === grade).length - 1 : 0);
      };
      const leaveYears = (stage: SchoolStage): Set<number> => new Set(leavesOf(stage).map((gr, j) => gr - 1 + j));
      const yearsOf = (st: (typeof e.stages)[number]): number => (st.years ?? (st.stage === "university" && st.field === "medical" ? 6 : YEARS[st.stage])) + leaveYears(st.stage).size;
      // 段の在学の始まり（年齢の学年の始まり＋浪人＋前の段の休学。大学院は前の段を出た翌月の4月＋浪人。改訂7）
      const startOf = new Map<SchoolStage, MonthIndex>();
      {
        let prevEnd: MonthIndex | null = null;
        for (const st of [...e.stages].sort((a, b) => START_AGE[a.stage] - START_AGE[b.stage])) {
          const byAge = addMonths(ctx.time.ageSwitch(child, { years: START_AGE[st.stage] }, "schoolYear"), 12 * ((st.delayYears ?? 0) + (shiftOf.get(st.stage) ?? 0)));
          const s0 = GRADUATE.has(st.stage) && prevEnd !== null ? addMonths(prevEnd, 12 * (st.delayYears ?? 0)) : byAge;
          startOf.set(st.stage, s0);
          if (AFTER_HIGH.has(st.stage)) prevEnd = addMonths(s0, 12 * yearsOf(st));
        }
      }
      const mode = e.outOfSchoolMode;
      const push = (m: MonthIndex, row: string, amount: Yen, formula: string, member: string = child) => {
        if (amount > 0 && m >= base && m <= end) flows.push({ row, ym: formatYm(m), amount, accrualYear: yearOf(m), member, object: g.id, formula });
      };
      for (const st of e.stages) {
        const sector = st.sector ?? "public";
        const lunchChoice = st.schoolLunch ?? e.schoolLunch;
        const living = st.living ?? "home";
        // 保育所は education.nurseryFee（0029）
        if (st.stage === "nursery") continue;
        const start = startOf.get(st.stage) ?? addMonths(ctx.time.ageSwitch(child, { years: START_AGE[st.stage] }, "schoolYear"), 12 * (st.delayYears ?? 0));
        const leave = leaveYears(st.stage);
        const years = yearsOf(st);
        const fees: { fiscalYear: number; tuition: Yen; admission: Yen }[] = [];
        const fy0 = yearOf(start);
        // 学費データの行（学校が決まっているとき）
        if (st.school !== undefined && st.school.rows.length > 0) {
          const rows = st.school.rows;
          const entryYears = [...new Set(rows.map((r) => r.entryYear))].sort((a, b) => a - b);
          const exact = entryYears.includes(fy0);
          const ref = exact ? fy0 : (entryYears.filter((y) => y <= fy0).at(-1) ?? (entryYears[0] as number));
          if (!exact) ctx.notice("N_ESTIMATED", [g.id, st.school.unit]);
          const termStart = st.school.termStartMonth ?? 4;
          for (const r of rows) {
            if (r.entryYear !== ref || r.grade > years) continue;
            const lag = leavesOf(st.stage).filter((x) => x <= r.grade).length;
            const m = addMonths(monthIndex(fy0 + r.grade - 1 + lag, termStart), r.monthOffset);
            // 推計: 最も近い入学年度の額に、その入学年度からの教育費の上昇率を当てる（計算基準年より前の年の分は計算基準年の額から）
            const amount = exact ? r.amount : grownFrom(r.amount, Math.max(ref, baseYear), yearOf(m));
            const admission = r.item === "tuition.admission";
            push(m, admission ? "cf.expense.education.entrance" : "cf.expense.education.school", amount, "education.cost.schoolTuition");
            const fy = fy0 + r.grade - 1 + lag;
            let f = fees.find((x) => x.fiscalYear === fy);
            if (f === undefined) {
              f = { fiscalYear: fy, tuition: yen(0), admission: yen(0) };
              fees.push(f);
            }
            if (admission) f.admission = yen(f.admission + amount);
            else if (r.item === "tuition.annual") f.tuition = yen(f.tuition + amount);
          }
          if (st.school.source.fictional === true) ctx.notice("N_FICTIONAL_DATA", [st.school.source.pack]);
        } else if (K12.has(st.stage)) {
          const intl = sector === "international";
          const sec = sector === "private" || intl ? "private" : "public";
          // インターナショナルスクールは統計の目安が無い（学校の年額を入れるまで0円。学校外活動費は私立の統計の平均。改訂7）
          if (intl && st.annualOverride === undefined) ctx.notice("N_INPUT_REQUIRED", [g.id, "goal.education.stages.annualOverride"]);
          const total = intl ? yen(0) : statOr0(`${S}.${st.stage}.${sec}.total`);
          const outStat = stat(`${S}.${st.stage}.${sec}.outOfSchool`);
          // 部活動などの費用（改訂5）: 統計の平均の段は統計の教科外活動費と入れ替え、年額を入れた段はその年額に足す
          const extra = st.clubAnnual === undefined || st.annualOverride !== undefined ? null : (stat(`${S}.${st.stage}.${sec}.extracurricular`) ?? yen(0));
          const base0 = st.annualOverride ?? (intl ? yen(0) : outStat === null ? total : yen(total - outStat));
          const schoolCost = st.clubAnnual === undefined ? base0 : yen(Math.max(0, base0 - (extra ?? 0)) + st.clubAnnual);
          // 学校給食費の負担軽減（公立の小学校・中学校。学校の年額を直接入れた段は引かない）
          const lunchStat = sector === "public" && LUNCH_STAGES.has(st.stage) && st.annualOverride === undefined ? stat(`${S}.${st.stage}.public.schoolLunch`) : null;
          const lunchOff = (fy: number): Yen => {
            if (lunchStat === null || lunchChoice === "paid") return yen(0);
            const lunch = grown(lunchStat, fy);
            if (lunchChoice === "free") return lunch;
            if (st.stage !== "elementary") return yen(0);
            const at = ctx.at(monthIndex(fy, 4));
            if (!at.has(LUNCH_MONTHLY)) return yen(0);
            const cap = ctx.money.mulRatio(at.paramYen(LUNCH_MONTHLY) ?? yen(0), at.paramCount(LUNCH_MONTHS) ?? 0, 1, "conv.exact");
            return lunch < cap ? lunch : cap;
          };
          for (let k = 0; k < years; k++) {
            if (leave.has(k)) continue;
            const fy = fy0 + k;
            const off = lunchOff(fy);
            const cost = yen(grown(schoolCost, fy) - off);
            const parts = ctx.money.allocate(cost, Array.from({ length: 12 }, () => 1), "conv.expense.share", "first");
            for (let i = 0; i < 12; i++) push(addMonths(start, 12 * k + i), "cf.expense.education.school", parts[i] as Yen, off > 0 ? "education.cost.schoolLunchRelief" : "education.cost.school");
            fees.push({ fiscalYear: fy, tuition: cost, admission: yen(0) });
          }
          if (st.entranceOverride !== undefined) push(addMonths(start, -2), "cf.expense.education.entrance", grown(st.entranceOverride, fy0), "education.cost.entrance");
          // 学校外活動費（統計の値が無い区分は学習費総額に含めて数えたので足さない）
          // 行で入れるときは、段の学校外活動費を数えない（0062）
          const out = mode === "rows" ? "none" : (st.outOfSchool ?? "statistics");
          const outMonthly: Yen | null = out === "none" ? null : out === "statistics" ? (outStat === null ? null : outStat) : ctx.money.mulRatio(out.monthly, 12, 1, "conv.exact");
          if (outMonthly !== null) {
            for (let k = 0; k < years; k++) {
              if (leave.has(k)) continue;
              const parts = ctx.money.allocate(grown(outMonthly, fy0 + k), Array.from({ length: 12 }, () => 1), "conv.expense.share", "first");
              for (let i = 0; i < 12; i++) push(addMonths(start, 12 * k + i), "cf.expense.education.outOfSchool", parts[i] as Yen, "education.cost.outOfSchool");
            }
          }
        } else {
          // 大学・短大・専門学校
          let tuition: Yen;
          let admission: Yen;
          if (st.stage === "vocational") {
            tuition = yen(0);
            admission = yen(0);
            if (st.annualOverride === undefined) ctx.notice("N_INPUT_REQUIRED", [g.id, "goal.education.stages.annualOverride"]);
          } else if (GRADUATE.has(st.stage)) {
            const course = st.stage === "graduateMaster" ? "master" : "doctor";
            if (sector === "private") {
              tuition = yen(statOr0(`${S}.graduate.private.${course}.tuition`) + statOr0(`${S}.graduate.private.${course}.facility`));
              admission = statOr0(`${S}.graduate.private.${course}.admission`);
            } else {
              const x = sector === "national" ? "national" : "public";
              tuition = statOr0(`${S}.graduate.${x}.tuition`);
              admission = statOr0(`${S}.graduate.${x}.admission`);
            }
          } else if (st.stage === "juniorCollege") {
            tuition = yen(statOr0(`${S}.juniorCollege.private.tuition`) + statOr0(`${S}.juniorCollege.private.facility`));
            admission = statOr0(`${S}.juniorCollege.private.admission`);
            if (sector !== "private") ctx.notice("N_INPUT_REQUIRED", [g.id, "goal.education.stages.annualOverride"]);
          } else if (sector === "private") {
            const f = st.field === undefined || st.field === "other" ? "all" : st.field;
            tuition = yen(statOr0(`${S}.university.private.${f}.tuition`) + statOr0(`${S}.university.private.${f}.facility`));
            admission = statOr0(`${S}.university.private.${f}.admission`);
          } else {
            tuition = statOr0(`${S}.university.${sector}.tuition`);
            admission = statOr0(`${S}.university.${sector}.admission`);
          }
          if (st.annualOverride !== undefined) tuition = st.annualOverride;
          if (st.entranceOverride !== undefined) admission = st.entranceOverride;
          const admissionMonth = addMonths(start, sector === "private" ? -2 : -1);
          push(admissionMonth, "cf.expense.education.entrance", grown(admission, fy0), "education.cost.entrance");
          for (let k = 0; k < years; k++) {
            if (leave.has(k)) continue;
            const fy = fy0 + k;
            const annual = grown(tuition, fy);
            const halves = ctx.money.allocate(annual, [1, 1], "conv.expense.share", "first");
            push(addMonths(start, 12 * k), "cf.expense.education.school", halves[0] as Yen, "education.cost.tuition");
            push(addMonths(start, 12 * k + 6), "cf.expense.education.school", halves[1] as Yen, "education.cost.tuition");
            fees.push({ fiscalYear: fy, tuition: annual, admission: k === 0 ? grown(admission, fy0) : yen(0) });
          }
        }
        // 受験・併願
        if (st.exam !== undefined) {
          push(addMonths(start, -3), "cf.expense.education.exam", grown(yen(st.exam.amount ?? 0), fy0), "education.cost.exam");
          push(addMonths(start, -2), "cf.expense.education.exam", grown(yen(st.exam.deposits ?? 0), fy0), "education.cost.examDeposit");
        }
        // 自宅外の生活費
        if (living === "away") {
          const annual = st.boarding?.monthly !== undefined ? ctx.money.mulRatio(st.boarding.monthly, 12, 1, "conv.exact") : statOr0(`${S}.boarding.annual`);
          const initial = st.boarding?.initial ?? statOr0(`${S}.boarding.initial`);
          push(addMonths(start, -1), "cf.expense.education.boarding", grown(initial, fy0), "education.cost.boardingInitial");
          for (let k = 0; k < years; k++) {
            if (leave.has(k)) continue;
            const parts = ctx.money.allocate(grown(annual, fy0 + k), Array.from({ length: 12 }, () => 1), "conv.expense.share", "first");
            for (let i = 0; i < 12; i++) push(addMonths(start, 12 * k + i), "cf.expense.education.boarding", parts[i] as Yen, "education.cost.boarding");
          }
        }
        enrollments.push({ stage: st.stage, sector, living, from: formatYm(start), years, scienceAgriculture: st.scienceAgriculture === true, fees });
      }
      // 留学（改訂6。0088）: 在学中の段の、その学年の始まり（短期は8月）に1回の額
      for (const a of abroad) {
        const st = e.stages.find((x) => x.stage === a.stage);
        if (st === undefined || a.amount <= 0) continue;
        const start = startOf.get(st.stage) ?? addMonths(ctx.time.ageSwitch(child, { years: START_AGE[st.stage] }, "schoolYear"), 12 * (st.delayYears ?? 0));
        const m = addMonths(start, 12 * yearIndex(st.stage, a.grade, a.kind === "leave") + (a.kind === "short" ? 4 : 0));
        if (a.onContingency?.mode === "stop") {
          const ev = householdEvent();
          if (ev !== null && ev.kind === "death" && m > monthIndex(Number(ev.month.slice(0, 4)), Number(ev.month.slice(5, 7)))) continue;
        }
        push(m, "cf.expense.education", grown(a.amount, yearOf(m)), "education.cost.abroad");
      }
      // 塾・習い事（統計の平均で入れるときは数えない。0062）
      for (const l of mode === "statistics" ? [] : (e.lessons ?? [])) {
        const from = ctx.time.resolve(l.from);
        const to = ctx.time.resolve(l.to);
        for (let m = from; m <= to; m = addMonths(m, 1)) push(m, "cf.expense.education.outOfSchool", grown(l.monthly, yearOf(m)), "education.cost.lessons");
      }
      // 貸与の奨学金
      for (const s of e.scholarships ?? []) {
        const from = ctx.time.resolve(s.from);
        const to = ctx.time.resolve(s.to);
        const debtor = s.debtor === "parent" ? null : child;
        let principal = 0;
        for (let m = from; m <= to; m = addMonths(m, 1)) {
          principal += s.monthly;
          push(m, "cf.income.other.scholarship", s.monthly, "education.cost.scholarship");
        }
        const repay = s.repaymentStart !== undefined ? ctx.time.resolve(s.repaymentStart) : addMonths(to, 7);
        const who = debtor ?? parent;
        const out = ctx.call<DebtScheduleOutput>("debt.schedule", {
          loan: {
            id: g.id,
            kind: "scholarship",
            debtors: [{ member: who, role: "primary" }],
            principal: yen(principal),
            start: { at: formatYm(addMonths(repay, -1)) },
            rateSchedule: [{ from: { at: formatYm(addMonths(repay, -1)) }, type: "fixed", rate: s.rate }],
            repayment: { method: "equalPayment", termMonths: s.termMonths },
          },
        });
        for (const f of out.flows) flows.push(f);
        loans.push({ object: g.id, member: who, yearEnd: out.yearEnd });
      }
      // 教育ローン
      for (const l of e.loans ?? []) {
        const m = ctx.time.resolve(l.at);
        push(m, "cf.income.other.scholarship", l.amount, "education.cost.educationLoan", l.borrower);
        const out = ctx.call<DebtScheduleOutput>("debt.schedule", {
          loan: {
            id: g.id,
            kind: "other",
            debtors: [{ member: l.borrower, role: "primary" }],
            principal: l.amount,
            start: { at: formatYm(m) },
            rateSchedule: [{ from: { at: formatYm(m) }, type: "fixed", rate: l.rate }],
            repayment: { method: "equalPayment", termMonths: l.termMonths },
          },
        });
        for (const f of out.flows) flows.push(f);
        loans.push({ object: g.id, member: l.borrower, yearEnd: out.yearEnd });
      }
      // 子への援助
      for (const gf of e.gifts ?? []) {
        // 世帯の外の贈与者（donors）が出す援助は世帯から出さない（贈与税は gift.tax）
        if (gf.donor !== undefined) continue;
        push(ctx.time.resolve(gf.at), gf.purpose === "wedding" ? "cf.expense.lumpSum.wedding" : "cf.expense.lumpSum.gift", gf.amount, `education.cost.gift.${gf.purpose}`, gf.payer ?? parent);
      }
      if ((e.gifts ?? []).length > 0) ctx.notice("N_NOT_SUPPORTED", ["giftTax"]);
    }
    if (missing.size > 0) ctx.notice("N_PARAM_MISSING", [...missing].sort());
    return { flows, loans, enrollments };
  },
});

// 教育費（13章・0010）。子ごと（教育の目標 goal の owner）に、進路パターン（学校の種類×公立・私立×系統×自宅・自宅外）を主な入力にし、
// 学校が決まっていれば学費データ（0010 の3）から写した行（stage.school.rows）で上書きする。公的支援は education.support（0010 の5）。
// - 学年は4月2日区切り（0003 の schoolYear）: 幼稚園は3歳、小学校は6歳、中学校は12歳、高校は15歳、大学・短大・専門学校は18歳（＋delayYears）の
//   学年の始まり（4月）から、在学年数（省略は 幼3・小6・中3・高3・大4（医歯系6）・短大2・専門2）
// - 学校の費用: 学費データの行があれば、入学年度×年次×費目×支払月（年次の始まりの月からのずれ）のとおりに払う（入学年度の行が無ければ、
//   最も近い入学年度の行に教育費の上昇率を当てて推計。知らせ N_ESTIMATED）。行が無ければ統計の平均（制度データ master.education.statistics。
//   計算基準年の値を教育費の上昇率で伸ばす）: 幼〜高は学校の費用（学習費総額−学校外活動費。学校外活動費の値が無い区分は学習費総額を学校の費用にし、
//   学校外活動費を足さない）を年度の12か月に分けて毎月、大学・短大は授業料＋施設設備費を4月と10月に半分ずつ、入学金を入学の前の2月
//   （国公立は3月）に払う。annualOverride・entranceOverride で直接入れられる
// - 保育料（nursery）: from（省略は1歳の学年の4月）から、3歳になった後の最初の4月の前の月まで月額（3歳からは幼児教育・保育の無償化で0）
// - 受験・併願の費用（exam）: 受験料を入学の前の1月、入学しなかった学校への納付金を2月に
// - 学校外活動費（outOfSchool）: 統計の平均（幼〜高）か月額か無し。塾・習い事（lessons）は月額を足す
// - 自宅外の生活費（boarding）: 仕送り（月額。省略は統計の年額÷12）を在学中毎月、初期費用（省略は統計）を入学の前の3月に
// - 貸与の奨学金（scholarships）: 在学中に受け取り（cf.income.other.scholarship）、返済は debt.schedule（返す人は既定で子。返済の始まりの
//   既定は受け取りの終わりの7か月後）。教育ローン（loans）は借りる月に受け取り、翌月から返す
// - 子への援助（gifts。結婚・住宅資金）: 額の入力まで（cf.expense.lumpSum.wedding・gift。贈与の税は贈与の作業で扱う）
// 教育費の上昇率は学校の費用・学校外活動費・仕送りに当て、公的支援には当てない（0010 の5）
import {
  addMonths,
  defineComponent,
  formatYm,
  grownByYear,
  monthIndex,
  yearOf,
  yen,
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
const START_AGE: Readonly<Record<SchoolStage, number>> = { nursery: 1, kindergarten: 3, elementary: 6, juniorHigh: 12, highSchool: 15, university: 18, juniorCollege: 18, vocational: 18 };
const YEARS: Readonly<Record<SchoolStage, number>> = { nursery: 2, kindergarten: 3, elementary: 6, juniorHigh: 3, highSchool: 3, university: 4, juniorCollege: 2, vocational: 2 };
const K12_SECTORS = ["public", "private"] as const;
const FIELDS = ["all", "humanities", "science", "medical"] as const;
const PARAMS = [
  ...[...K12].flatMap((s) => K12_SECTORS.flatMap((x) => [`${S}.${s}.${x}.total`, `${S}.${s}.${x}.outOfSchool`])),
  ...FIELDS.flatMap((f) => ["tuition", "admission", "facility"].map((i) => `${S}.university.private.${f}.${i}`)),
  ...["national", "public"].flatMap((x) => ["tuition", "admission"].map((i) => `${S}.university.${x}.${i}`)),
  ...["tuition", "admission", "facility"].map((i) => `${S}.juniorCollege.private.${i}`),
  `${S}.boarding.annual`,
  `${S}.boarding.initial`,
];


export default defineComponent<{ member: string }, EducationCostOutput>({
  id: "education.cost",
  title: "教育費",
  contract: "1.0",
  revision: 1,
  requires: { "debt.schedule": ">=1 <2" },
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
    for (const g of ctx.list<GoalInput>("goal")) {
      if (g.kind !== "education" || g.education === undefined || g.owner !== child) continue;
      const e: EducationGoalInput = g.education;
      const push = (m: MonthIndex, row: string, amount: Yen, formula: string, member: string = child) => {
        if (amount > 0 && m >= base && m <= end) flows.push({ row, ym: formatYm(m), amount, accrualYear: yearOf(m), member, object: g.id, formula });
      };
      for (const st of e.stages) {
        const sector = st.sector ?? "public";
        const living = st.living ?? "home";
        // 保育所
        if (st.stage === "nursery") {
          const free = ctx.time.ageSwitch(child, { years: 3 }, "schoolYear");
          const from = st.from !== undefined ? ctx.time.resolve(st.from) : ctx.time.ageSwitch(child, { years: 1 }, "schoolYear");
          for (let m = from; m < free; m = addMonths(m, 1)) push(m, "cf.expense.education.nursery", grown(yen(st.monthly ?? 0), yearOf(m)), "education.cost.nursery");
          continue;
        }
        const start = addMonths(ctx.time.ageSwitch(child, { years: START_AGE[st.stage] }, "schoolYear"), 12 * (st.delayYears ?? 0));
        const years = st.years ?? (st.stage === "university" && st.field === "medical" ? 6 : YEARS[st.stage]);
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
            const m = addMonths(monthIndex(fy0 + r.grade - 1, termStart), r.monthOffset);
            // 推計: 最も近い入学年度の額に、その入学年度からの教育費の上昇率を当てる（計算基準年より前の年の分は計算基準年の額から）
            const amount = exact ? r.amount : grownFrom(r.amount, Math.max(ref, baseYear), yearOf(m));
            const admission = r.item === "tuition.admission";
            push(m, admission ? "cf.expense.education.entrance" : "cf.expense.education.school", amount, "education.cost.schoolTuition");
            const fy = fy0 + r.grade - 1;
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
          const sec = sector === "private" ? "private" : "public";
          const total = statOr0(`${S}.${st.stage}.${sec}.total`);
          const outStat = stat(`${S}.${st.stage}.${sec}.outOfSchool`);
          const schoolCost = st.annualOverride ?? (outStat === null ? total : yen(total - outStat));
          for (let k = 0; k < years; k++) {
            const fy = fy0 + k;
            const parts = ctx.money.allocate(grown(schoolCost, fy), Array.from({ length: 12 }, () => 1), "conv.expense.share", "first");
            for (let i = 0; i < 12; i++) push(addMonths(start, 12 * k + i), "cf.expense.education.school", parts[i] as Yen, "education.cost.school");
            fees.push({ fiscalYear: fy, tuition: grown(schoolCost, fy), admission: yen(0) });
          }
          if (st.entranceOverride !== undefined) push(addMonths(start, -2), "cf.expense.education.entrance", grown(st.entranceOverride, fy0), "education.cost.entrance");
          // 学校外活動費（統計の値が無い区分は学習費総額に含めて数えたので足さない）
          const out = st.outOfSchool ?? "statistics";
          const outMonthly: Yen | null = out === "none" ? null : out === "statistics" ? (outStat === null ? null : outStat) : ctx.money.mulRatio(out.monthly, 12, 1, "conv.exact");
          if (outMonthly !== null) {
            for (let k = 0; k < years; k++) {
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
            const parts = ctx.money.allocate(grown(annual, fy0 + k), Array.from({ length: 12 }, () => 1), "conv.expense.share", "first");
            for (let i = 0; i < 12; i++) push(addMonths(start, 12 * k + i), "cf.expense.education.boarding", parts[i] as Yen, "education.cost.boarding");
          }
        }
        enrollments.push({ stage: st.stage, sector, living, from: formatYm(start), years, scienceAgriculture: st.scienceAgriculture === true, fees });
      }
      // 塾・習い事
      for (const l of e.lessons ?? []) {
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
        push(ctx.time.resolve(gf.at), gf.purpose === "wedding" ? "cf.expense.lumpSum.wedding" : "cf.expense.lumpSum.gift", gf.amount, `education.cost.gift.${gf.purpose}`, gf.payer ?? parent);
      }
      if ((e.gifts ?? []).length > 0) ctx.notice("N_NOT_SUPPORTED", ["giftTax"]);
    }
    if (missing.size > 0) ctx.notice("N_PARAM_MISSING", [...missing].sort());
    return { flows, loans, enrollments };
  },
});

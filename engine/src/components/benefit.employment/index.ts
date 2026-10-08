// 雇用保険の育児の給付（非課税）。
// - 育児休業給付金: 休業開始時賃金日額（休業の前6か月の給与（賞与を除く）÷180。上限・下限）×30日×率（最初の6か月は67%、その後50%）。
//   産前産後休業に続く母の育児休業は、産前産後休業の前6か月で計算する
// - 出生後休業支援給付: 子の出生から2か月以内に始まる育児休業で、配偶者も同じく育児休業をとるか雇用保険に入っていないとき、
//   最初の月に賃金日額×28日×13%
// - 育児時短就業給付: 2歳未満の子のための短時間勤務の期間に、時短の前より下がった給与の月、その月の給与×10%（支給限度額まで）
// 日数は月単位の近似で1か月を30日とみなす（PR の提案）。給付金は2か月分ずつ、その2か月の次の月に払う。時短の給付は翌月
import {
  addMonths,
  addYen,
  ageMonth,
  boxValue,
  defineComponent,
  EMPLOYEE_TYPES,
  formatYm,
  parseYm,
  RATE_ZERO,
  yearOf,
  yen,
  type EmployeeStatusOutput,
  type EmploymentPeriodInput,
  type Flow,
  type MemberInput,
  type MonthIndex,
  type RelationInput,
  type SalaryOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  max: "employmentInsurance.childcareBenefit.dailyWageMax",
  min: "employmentInsurance.childcareBenefit.dailyWageMin",
  initial: "employmentInsurance.childcareBenefit.rateInitial",
  later: "employmentInsurance.childcareBenefit.rateLater",
  initialMonths: "employmentInsurance.childcareBenefit.initialMonths",
  postRate: "employmentInsurance.postBirthBenefit.rate",
  postDays: "employmentInsurance.postBirthBenefit.days",
  postWithin: "employmentInsurance.postBirthBenefit.withinMonths",
  shortRate: "employmentInsurance.shortHoursBenefit.rate",
  shortLimit: "employmentInsurance.shortHoursBenefit.monthlyLimit",
  shortUntil: "employmentInsurance.shortHoursBenefit.childUntilAge",
};
const DAYS_PER_MONTH = 30;

export default defineComponent<{ member: string }, { flows: Flow[] }>({
  id: "benefit.employment",
  title: "雇用保険の育児の給付",
  contract: "1.0",
  revision: 1,
  requires: { "socialInsurance.employeeStatus": ">=1 <2", "income.salary": ">=1 <2" },
  params: Object.values(P),
  reads: [
    "member.kind",
    "member.birth",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.parent",
    "relation.child",
    "employment.member",
    "employment.from",
    "employment.to",
    "employment.type",
    "employment.leaveKind",
    "employment.leaveChild",
    "employment.childcareShortHours",
    "employment.salary.annual",
  ],
  input: "member.input",
  output: "flows.output",
  compute(input, ctx) {
    const member = input.member;
    const flows: Flow[] = [];
    const status = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member }).months;
    const insured = new Set(status.filter((s) => s.employment).map((s) => s.month));
    const periods = ctx
      .list<EmploymentPeriodInput>("employment")
      .filter((p) => p.member === member)
      .map((p) => ({ p, from: ctx.time.resolve(p.from), to: p.to === null ? ctx.time.end : ctx.time.resolve(p.to) }))
      .sort((a, b) => a.from - b.from);
    const salary = new Map<string, Yen>();
    for (const x of ctx.call<SalaryOutput>("income.salary", { member }).payments) salary.set(x.ym, addYen(salary.get(x.ym) ?? yen(0), x.salary));
    const members = ctx.list<MemberInput>("member");
    const children = members.filter((c) => c.kind === "child");
    const relations = ctx.list<RelationInput>("relation");
    const spouses = relations.flatMap((r) => (r.type === "spouse" && (r.a === member || r.b === member) ? [r.a === member ? r.b : r.a] : []));
    const childOf = (p: EmploymentPeriodInput, from: MonthIndex): MemberInput | undefined => {
      if (p.leaveChild !== undefined) return children.find((c) => c.id === p.leaveChild);
      // 休業の始まりに出生の月が最も近い子（出生の月から前後）
      let best: MemberInput | undefined;
      for (const c of children) {
        const b = parseYm(c.birth.birthYearMonth);
        if (best === undefined || Math.abs(b - from) < Math.abs(parseYm(best.birth.birthYearMonth) - from)) best = c;
      }
      return best;
    };
    const spouseCondition = (child: MemberInput, within: number): boolean => {
      const birth = parseYm(child.birth.birthYearMonth);
      return spouses.some((sp) => {
        const st = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member: sp }).months;
        const insuredAtBirth = st.some((s) => s.month === child.birth.birthYearMonth && s.employment);
        if (!insuredAtBirth) return true;
        return st.some((s) => s.leave === "childcare" && parseYm(s.month) >= birth && parseYm(s.month) < addMonths(birth, within));
      });
    };
    const pays: { m: MonthIndex; amount: Yen; formula: string; object: string }[] = [];
    for (let i = 0; i < periods.length; i++) {
      const { p, from, to } = periods[i] as (typeof periods)[number];
      if (p.type !== "leave" || p.leaveKind !== "childcare" || !insured.has(formatYm(from))) continue;
      // 賃金日額: 休業（産前産後休業から続くときはその前）の前6か月の給与÷180
      let wageStart = from;
      const prev = periods[i - 1];
      if (prev !== undefined && prev.p.type === "leave" && prev.p.leaveKind === "maternity" && prev.to >= addMonths(from, -1)) wageStart = prev.from;
      let sum = 0;
      for (let k = 1; k <= 6; k++) sum += salary.get(formatYm(addMonths(wageStart, -k))) ?? 0;
      const at = ctx.at(from);
      let daily = ctx.money.mulRatio(yen(sum), 1, 180, "conv.benefit.daily");
      const max = at.paramYen(P.max);
      const min = at.paramYen(P.min);
      if (max !== null && daily > max) daily = max;
      if (min !== null && daily < min) daily = min;
      const initialMonths = at.paramCount(P.initialMonths) ?? 6;
      for (let m = from, k = 0; m <= to; m = addMonths(m, 1), k++) {
        const r = (k < initialMonths ? ctx.at(m).paramRate(P.initial) : ctx.at(m).paramRate(P.later)) ?? RATE_ZERO;
        pays.push({ m, amount: ctx.money.mulRate(ctx.money.mulRatio(daily, DAYS_PER_MONTH, 1, "conv.exact"), r, "conv.benefit.daily"), formula: "benefit.employment.childcareLeave", object: p.id });
      }
      // 出生後休業支援給付
      const child = childOf(p, from);
      const within = at.paramCount(P.postWithin);
      const postRate = at.paramRate(P.postRate);
      if (child !== undefined && within !== null && postRate !== null) {
        const birth = parseYm(child.birth.birthYearMonth);
        if (from >= birth && from < addMonths(birth, within) && spouseCondition(child, within)) {
          const days = at.paramCount(P.postDays) ?? 0;
          pays.push({ m: from, amount: ctx.money.mulRate(ctx.money.mulRatio(daily, days, 1, "conv.exact"), postRate, "conv.benefit.daily"), formula: "benefit.employment.postBirth", object: p.id });
        }
      }
      // 2か月分ずつ、その次の月に払う
      const own = pays.filter((x) => x.object === p.id);
      for (const x of own) {
        const k = x.m - from;
        const paid = addMonths(from, k - (k % 2) + 2);
        if (x.amount > 0) flows.push({ row: "cf.income.benefit", ym: formatYm(paid), amount: x.amount, accrualYear: yearOf(x.m), member, object: p.id, formula: x.formula });
      }
    }
    // 育児時短就業給付
    for (let i = 0; i < periods.length; i++) {
      const { p, from, to } = periods[i] as (typeof periods)[number];
      const sh = p.childcareShortHours;
      if (sh === undefined || !EMPLOYEE_TYPES.has(p.type)) continue;
      const child = children.find((c) => c.id === sh.child);
      if (child === undefined) continue;
      const until = ageMonth(ctx, from, P.shortUntil, child.id);
      const prevPeriod = [...periods.slice(0, i)].reverse().find((x) => EMPLOYEE_TYPES.has(x.p.type));
      const before = boxValue(sh.wageBefore) ?? (prevPeriod === undefined ? null : ctx.money.divInt(boxValue(prevPeriod.p.salary?.annual) ?? yen(0), 12, "conv.salary.monthly"));
      for (let m = from; m <= to && m <= until; m = addMonths(m, 1)) {
        const w = salary.get(formatYm(m)) ?? yen(0);
        if (!insured.has(formatYm(m)) || w <= 0 || before === null || w >= before) continue;
        const at = ctx.at(m);
        const rateShort = at.paramRate(P.shortRate) ?? RATE_ZERO;
        let amount = at.money.mulRate(w, rateShort, "conv.benefit.daily");
        const limit = at.paramYen(P.shortLimit);
        if (limit !== null && w + amount > limit) amount = yen(Math.max(0, limit - w));
        if (amount > 0) flows.push({ row: "cf.income.benefit", ym: formatYm(addMonths(m, 1)), amount, accrualYear: yearOf(m), member, object: p.id, formula: "benefit.employment.shortHours" });
      }
    }
    return { flows };
  },
});

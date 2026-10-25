// 雇用保険の育児の給付（非課税）。
// - 育児休業給付金: 休業開始時賃金日額（休業の前6か月の給与（賞与を除く）÷180。上限・下限）×30日×率（最初の6か月は67%、その後50%）。
//   産前産後休業に続く母の育児休業は、産前産後休業の前6か月で計算する
// - 出生後休業支援給付: 子の出生から2か月以内に始まる育児休業で、配偶者も同じく育児休業をとるか、雇用保険に入っていないか、産後休業中のとき、
//   最初の月に賃金日額×28日×13%
// - 育児時短就業給付: 2歳未満の子のための短時間勤務の期間に、時短の前より下がった給与の月、その月の給与×10%（支給限度額まで）
// - 介護休業給付金（改訂3。6.10）: 介護休業（leaveKind: care）の期間に、休業開始時賃金日額（休業の前6か月の給与÷180。上限は介護休業の値）×
//   休業の日数（月×30日。対象の家族1人につき通算93日・3回まで）×率（67%）を、休業の終わりの翌月に払う
//   （30日あたりの支給の上限額（制度データ）を日数で按分した額まで）。対象の家族は、休業の始まりに続いている介護の費用（care）の
//   介護を受ける人（本人を除く。始まりが最も近いもの）。重なる介護が無い休業は、対象の家族が分からないので1人の家族として通算する
//   雇用保険に入っていない月（役員・公務員）の休業は出ない
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
  type CareExpenseInput,
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
  careRate: "employmentInsurance.careLeaveBenefit.rate",
  careDays: "employmentInsurance.careLeaveBenefit.maxDays",
  careMax: "employmentInsurance.careLeaveBenefit.monthlyLimit",
  careTimes: "employmentInsurance.careLeaveBenefit.maxTimes",
};
const DAYS_PER_MONTH = 30;

export default defineComponent<{ member: string }, { flows: Flow[] }>({
  id: "benefit.employment",
  title: "雇用保険の育児・介護の給付",
  contract: "1.0",
  revision: 4,
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
    "care.member",
    "care.from",
    "care.months",
  ],
  memberScope: ["employment"],
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
      // 配偶者がいない（ひとり親）ときは、配偶者の育児休業を要件としない
      if (spouses.length === 0) return true;
      return spouses.some((sp) => {
        const st = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member: sp }).months;
        const insuredAtBirth = st.some((s) => s.month === child.birth.birthYearMonth && s.employment);
        if (!insuredAtBirth) return true;
        // 配偶者が産後休業中（出生の月に産前産後休業）なら、配偶者の育児休業を要件としない
        if (st.some((s) => s.month === child.birth.birthYearMonth && s.leave === "maternity")) return true;
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
    // 介護休業給付金（対象の家族1人につき通算93日・3回まで）
    const cares = ctx
      .list<CareExpenseInput>("care")
      .filter((c) => c.member !== member)
      .map((c) => {
        const f = ctx.time.resolve(c.from);
        return { member: c.member, from: f, last: c.months === undefined ? null : addMonths(f, c.months - 1) };
      });
    const careTarget = (from: MonthIndex, to: MonthIndex): string => {
      const overlapping = cares.filter((c) => c.from <= to && (c.last === null || c.last >= from));
      // 休業の始まりまでに始まった介護のうち最も近いもの、無ければ休業の間に始まる最初のもの
      const started = overlapping.filter((c) => c.from <= from).sort((a, b) => b.from - a.from)[0];
      const later = overlapping.filter((c) => c.from > from).sort((a, b) => a.from - b.from)[0];
      return (started ?? later)?.member ?? "";
    };
    const careUsed = new Map<string, { days: number; times: number }>();
    for (const { p, from, to } of periods) {
      if (p.type !== "leave" || p.leaveKind !== "care" || !insured.has(formatYm(from))) continue;
      const at = ctx.at(from);
      const maxDays = at.paramCount(P.careDays);
      const r = at.paramRate(P.careRate);
      if (maxDays === null || r === null) continue;
      const target = careTarget(from, to);
      const used = careUsed.get(target) ?? { days: 0, times: 0 };
      const maxTimes = at.paramCount(P.careTimes);
      if (maxTimes !== null && used.times >= maxTimes) continue;
      let sum = 0;
      for (let k = 1; k <= 6; k++) sum += salary.get(formatYm(addMonths(from, -k))) ?? 0;
      const daily = ctx.money.mulRatio(yen(sum), 1, 180, "conv.benefit.daily");
      const days = Math.min((to - from + 1) * DAYS_PER_MONTH, Math.max(0, maxDays - used.days));
      careUsed.set(target, { days: used.days + days, times: used.times + 1 });
      let amount = ctx.money.mulRate(ctx.money.mulRatio(daily, days, 1, "conv.exact"), r, "conv.benefit.daily");
      const limit = at.paramYen(P.careMax);
      if (limit !== null) {
        const cap = ctx.money.mulRatio(limit, days, DAYS_PER_MONTH, "conv.benefit.daily");
        if (amount > cap) amount = cap;
      }
      if (amount > 0) flows.push({ row: "cf.income.benefit", ym: formatYm(addMonths(to, 1)), amount, accrualYear: yearOf(to), member, object: p.id, formula: "benefit.employment.careLeave" });
    }
    // 育児時短就業給付
    for (let i = 0; i < periods.length; i++) {
      const { p, from, to } = periods[i] as (typeof periods)[number];
      const sh = p.childcareShortHours;
      if (sh === undefined || !EMPLOYEE_TYPES.has(p.type)) continue;
      const child = children.find((c) => c.id === sh.child);
      if (child === undefined) continue;
      const until = ageMonth(ctx, from < ctx.time.base ? ctx.time.base : from, P.shortUntil, child.id);
      const prevPeriod = [...periods.slice(0, i)].reverse().find((x) => EMPLOYEE_TYPES.has(x.p.type));
      const before = boxValue(sh.wageBefore) ?? (prevPeriod === undefined ? null : ctx.money.divInt(boxValue(prevPeriod.p.salary?.annual) ?? yen(0), 12, "conv.salary.monthly"));
      for (let m = from < ctx.time.base ? ctx.time.base : from; m <= to && m <= until; m = addMonths(m, 1)) {
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

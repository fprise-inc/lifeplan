// 月ごとの健康保険の種類（0008 の4: 導く）。75歳（誕生日の月）からは後期高齢者医療。勤め先の健康保険に入る月はその保険。
// そうでない月は、世帯の本人・配偶者のうち勤め先の健康保険に入る人がいて、その月からの1年の収入の見込み（給与・事業・公的年金）が
// 被扶養者の基準（60歳以上・19〜22歳は別の基準）の未満なら家族の扶養、それ以外は国民健康保険。
// 自営・無職・休業の期間に healthInsurance.kind を書いたときは、それを使う（FP の上書き。任意継続もこれで表す）
import {
  addMonths,
  addYen,
  ageMonth,
  defineComponent,
  EMPLOYER_HEALTH_KINDS,
  formatYm,
  monthOf,
  parseYm,
  yearOf,
  yen,
  type BusinessOutput,
  type EmployeeStatusOutput,
  type EmploymentPeriodInput,
  type HealthStatusMonth,
  type MemberInput,
  type MonthIndex,
  type PensionOutput,
  type SalaryOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  lateElderly: "socialInsurance.health.lateElderlyAge",
  limit: "socialInsurance.dependent.incomeLimit",
  limitElderly: "socialInsurance.dependent.incomeLimitElderly",
  elderlyAge: "socialInsurance.dependent.elderlyAge",
  limitYoung: "socialInsurance.dependent.incomeLimitYoung",
  youngFrom: "socialInsurance.dependent.youngFromAge",
  youngUntil: "socialInsurance.dependent.youngUntilAge",
};

export default defineComponent<{ member: string }, { months: HealthStatusMonth[] }>({
  id: "socialInsurance.healthStatus",
  title: "健康保険の種類（導く）",
  contract: "1.0",
  revision: 1,
  requires: {
    "socialInsurance.employeeStatus": ">=1 <2",
    "income.salary": ">=1 <2",
    "income.business": ">=1 <2",
    "pension.oldAge": ">=1 <2",
  },
  params: Object.values(P),
  reads: ["member.kind", "member.birth", "member.joins", "member.leaves", "employment.healthInsurance.kind", "employment.type"],
  input: "member.input",
  output: "socialInsurance.healthStatus.output",
  compute(input, ctx) {
    const member = input.member;
    const { base } = ctx.time;
    const own = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member }).months;
    if (own.length === 0) return { months: [] };
    const first = parseYm((own[0] as { month: string }).month);
    const at0 = first < base ? base : first;
    const late = ageMonth(ctx, at0, P.lateElderly, member);
    const elderly = ageMonth(ctx, at0, P.elderlyAge, member);
    const youngFrom = ageMonth(ctx, at0, P.youngFrom, member);
    const youngUntil = ageMonth(ctx, at0, P.youngUntil, member);
    const periods = ctx.list<EmploymentPeriodInput>("employment");
    // 生まれる前・世帯にいない月は、どの保険にも入らない（none）
    const me = ctx.get<MemberInput>("member", member);
    const born = parseYm(me.birth.birthYearMonth);
    const joins = me.joins === null ? null : ctx.time.resolve(me.joins);
    const leaves = me.leaves === null ? null : ctx.time.resolve(me.leaves);
    const absent = (m: MonthIndex) => m < born || (joins !== null && m < joins) || (leaves !== null && m >= leaves);
    const supporters = ctx
      .list<MemberInput>("member")
      .filter((m) => m.id !== member && (m.kind === "self" || m.kind === "spouse"))
      .map((m) => {
        const lateS = ageMonth(ctx, at0, P.lateElderly, m.id);
        const st = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member: m.id }).months;
        return { id: m.id, insured: new Set(st.filter((x) => x.health && parseYm(x.month) < lateS).map((x) => x.month)) };
      });
    // 収入の見込み（その月から12か月）: 給与（賞与・通勤手当を含む）・事業所得（年額の12分の1ずつ）・公的年金の支払い
    const cash = new Map<string, Yen>();
    const put = (ym: string, a: Yen) => cash.set(ym, addYen(cash.get(ym) ?? yen(0), a));
    for (const p of ctx.call<SalaryOutput>("income.salary", { member }).payments) put(p.ym, addYen(addYen(p.salary, p.bonus), p.commuting));
    for (const p of ctx.call<PensionOutput>("pension.oldAge", { member }).payments) put(p.ym, p.amount);
    const business = new Map(ctx.call<BusinessOutput>("income.business", { member }).byYear.map((b) => [b.year, b.income]));
    const prospective = (m: MonthIndex): Yen => {
      let s = yen(0);
      for (let k = 0; k < 12; k++) s = addYen(s, cash.get(formatYm(addMonths(m, k))) ?? yen(0));
      const k0 = 13 - monthOf(m);
      s = addYen(s, ctx.money.mulRatio(business.get(yearOf(m)) ?? yen(0), k0, 12, "conv.salary.monthly"));
      return addYen(s, ctx.money.mulRatio(business.get(yearOf(m) + 1) ?? yen(0), 12 - k0, 12, "conv.salary.monthly"));
    };
    const months: HealthStatusMonth[] = [];
    for (const s of own) {
      const m = parseYm(s.month);
      if (absent(m)) {
        months.push({ month: s.month, kind: "none" });
        continue;
      }
      if (m >= late) {
        months.push({ month: s.month, kind: "lateElderly" });
        continue;
      }
      if (s.health) {
        const emp = periods.find((p) => p.id === s.employer);
        months.push({ month: s.month, kind: (emp?.healthInsurance?.kind ?? "kyokaikenpo") as HealthStatusMonth["kind"] });
        continue;
      }
      // 期間に書いた勤め先以外の健康保険は、FP の上書き
      const explicit = periods.find((p) => p.id === s.period)?.healthInsurance?.kind;
      if (explicit !== undefined && !EMPLOYER_HEALTH_KINDS.has(explicit)) {
        months.push({ month: s.month, kind: explicit as HealthStatusMonth["kind"] });
        continue;
      }
      const supporter = supporters.find((x) => x.insured.has(s.month));
      if (supporter !== undefined) {
        const at = ctx.at(m < base ? base : m);
        const young = m >= youngFrom && m < youngUntil ? at.paramYen(P.limitYoung) : null;
        const limit = m >= elderly ? at.paramYen(P.limitElderly) : (young ?? at.paramYen(P.limit));
        if (limit === null || prospective(m) < limit) {
          months.push({ month: s.month, kind: "dependent", supporter: supporter.id });
          continue;
        }
      }
      months.push({ month: s.month, kind: "national" });
    }
    return { months };
  },
});

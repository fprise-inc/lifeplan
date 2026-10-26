// 月ごとの健康保険の種類（0008 の4: 導く）。75歳（誕生日の月）からは後期高齢者医療。勤め先の健康保険に入る月はその保険。
// そうでない月は、世帯の構成員のうち勤め先の健康保険に入る人（本人・配偶者を先に）がいて、次を満たせば家族の扶養、それ以外は国民健康保険
// （収入がある者についての被扶養者の認定。昭和52年4月6日 保発第9号・庁保発第9号）:
// - その月からの1年の収入の見込み（給与・事業・公的年金。遺族年金・障害年金を含む）が被扶養者の基準の未満（60歳以上と、障害年金を受ける人は
//   別の基準。19〜22歳は別の基準だが、扶養する人の配偶者には使わない）
// - 同居なら、扶養する人の収入の見込みの2分の1の未満。別居（親・祖父母で member.support.cohabiting が false）なら、仕送りの年額
//   （support.allowance の12か月分。入力が無いときは確かめない）の未満
// - 親・祖父母は、扶養していること（member.support.dependent）を入れたときだけ
// - 雇用保険の基本手当を受ける月（日の分を受ける月。待期・給付制限の月を除く）は、基本手当日額×360 が被扶養者の基準以上なら扶養にしない
//   （改訂4。0037。日額 3,612円以上（60歳以上は 5,000円以上）で扶養から外れる扱い）
// 自営・無職・休業の期間に healthInsurance.kind を書いたときは、それを使う（FP の上書き。任意継続もこれで表す。任意継続は始まりの月から
// 2年（socialInsurance.health.continuation.maxMonths）までで、その後は上の決まりで導く。健康保険法38条1号）
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
  type DisabilityPensionOutput,
  type EmployeeStatusOutput,
  type EmploymentPeriodInput,
  type HealthStatusMonth,
  type MemberInput,
  type MonthIndex,
  type PensionOutput,
  type SalaryOutput,
  type SurvivorPensionOutput,
  type UnemploymentOutput,
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
  continuationMonths: "socialInsurance.health.continuation.maxMonths",
};

/** 雇用保険の給付の日額を年額に直す日数（被扶養者の認定で日額×360 と基準を比べる） */
const DAYS_PER_YEAR = 360;

export default defineComponent<{ member: string }, { months: HealthStatusMonth[] }>({
  id: "socialInsurance.healthStatus",
  title: "健康保険の種類（導く）",
  contract: "1.0",
  revision: 4,
  requires: {
    "socialInsurance.employeeStatus": ">=1 <2",
    "income.salary": ">=1 <2",
    "income.business": ">=1 <2",
    "pension.oldAge": ">=1 <2",
    "pension.survivor": ">=1 <2",
    "pension.disability": ">=1 <2",
    "benefit.unemployment": ">=1 <2",
  },
  params: Object.values(P),
  reads: ["member.kind", "member.birth", "member.joins", "member.leaves", "member.support", "employment.healthInsurance.kind", "employment.type"],
  memberScope: ["employment"],
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
    const isCouple = (k: MemberInput["kind"]) => k === "self" || k === "spouse";
    // 親・祖父母は、扶養していると入れたときだけ扶養の候補にする（生計維持の関係は入力でしか分からない）
    const elder = me.kind === "parent" || me.kind === "grandparent";
    const canBeDependent = !elder || me.support?.dependent === true;
    const cohabiting = !elder || me.support?.cohabiting !== false;
    const allowance = elder && !cohabiting && me.support?.allowance !== undefined ? ctx.money.mulRatio(me.support.allowance, 12, 1, "conv.exact") : null;
    const supporters = ctx
      .list<MemberInput>("member")
      .filter((m) => m.id !== member)
      .sort((a, b) => Number(isCouple(b.kind)) - Number(isCouple(a.kind)))
      .map((m) => {
        const lateS = ageMonth(ctx, at0, P.lateElderly, m.id);
        const st = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member: m.id }).months;
        return { id: m.id, spouse: isCouple(m.kind) && isCouple(me.kind), insured: new Set(st.filter((x) => x.health && parseYm(x.month) < lateS).map((x) => x.month)) };
      });
    // 収入の見込み（その月から12か月）: 給与（賞与・通勤手当を含む）・事業所得（年額の12分の1ずつ）・公的年金（遺族年金・障害年金を含む）の支払い
    const incomes = new Map<string, { prospective: (m: MonthIndex) => Yen; disabled: (m: MonthIndex) => boolean }>();
    const incomeOf = (id: string) => {
      const hit = incomes.get(id);
      if (hit !== undefined) return hit;
      const cash = new Map<string, Yen>();
      const put = (ym: string, a: Yen) => cash.set(ym, addYen(cash.get(ym) ?? yen(0), a));
      for (const p of ctx.call<SalaryOutput>("income.salary", { member: id }).payments) put(p.ym, addYen(addYen(p.salary, p.bonus), p.commuting));
      for (const p of ctx.call<PensionOutput>("pension.oldAge", { member: id }).payments) put(p.ym, p.amount);
      for (const f of ctx.call<SurvivorPensionOutput>("pension.survivor", { member: id }).flows) if (f.row === "cf.income.pension.survivor") put(f.ym, f.amount);
      const disability = new Set<string>();
      for (const f of ctx.call<DisabilityPensionOutput>("pension.disability", { member: id }).flows) {
        put(f.ym, f.amount);
        if (f.amount > 0) disability.add(f.ym);
      }
      const business = new Map(ctx.call<BusinessOutput>("income.business", { member: id }).byYear.map((b) => [b.year, b.income]));
      const window = (m: MonthIndex) => Array.from({ length: 12 }, (_, k) => formatYm(addMonths(m, k)));
      const out = {
        prospective: (m: MonthIndex): Yen => {
          let s = yen(0);
          for (const ym of window(m)) s = addYen(s, cash.get(ym) ?? yen(0));
          const k0 = 13 - monthOf(m);
          s = addYen(s, ctx.money.mulRatio(business.get(yearOf(m)) ?? yen(0), k0, 12, "conv.salary.monthly"));
          return addYen(s, ctx.money.mulRatio(business.get(yearOf(m) + 1) ?? yen(0), 12 - k0, 12, "conv.salary.monthly"));
        },
        // 障害年金を受ける（障害厚生年金を受けられる程度の障害がある）とみなす月: その月からの1年に障害年金の支払いがある
        disabled: (m: MonthIndex): boolean => window(m).some((ym) => disability.has(ym)),
      };
      incomes.set(id, out);
      return out;
    };
    const mine = incomeOf(member);
    // 基本手当を受ける月の日額
    const allowanceDaily = new Map(ctx.call<UnemploymentOutput>("benefit.unemployment", { member }).receipts.map((x) => [x.month, x.daily]));
    const months: HealthStatusMonth[] = [];
    // 任意継続を入れた月の続きの始まりの月と、最後に任意継続を入れた月
    let continuationFrom: MonthIndex | null = null;
    let continuationLast: MonthIndex | null = null;
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
      if (explicit === "continuation") {
        if (continuationFrom === null || continuationLast === null || addMonths(continuationLast, 1) !== m) continuationFrom = m;
        continuationLast = m;
        const at = ctx.at(m);
        const max = at.has(P.continuationMonths) ? at.paramCount(P.continuationMonths) : null;
        // 2年を過ぎた月は任意継続でなくなり、下の決まりで導く
        if (max === null || m - continuationFrom < max) {
          months.push({ month: s.month, kind: "continuation" });
          continue;
        }
      } else if (explicit !== undefined && !EMPLOYER_HEALTH_KINDS.has(explicit)) {
        months.push({ month: s.month, kind: explicit as HealthStatusMonth["kind"] });
        continue;
      }
      const supporter = canBeDependent
        ? supporters.find((x) => {
            if (!x.insured.has(s.month)) return false;
            const at = ctx.at(m < base ? base : m);
            const income = mine.prospective(m);
            const young = !x.spouse && m >= youngFrom && m < youngUntil ? at.paramYen(P.limitYoung) : null;
            const limit = m >= elderly || mine.disabled(m) ? at.paramYen(P.limitElderly) : (young ?? at.paramYen(P.limit));
            if (limit !== null && income >= limit) return false;
            const daily = allowanceDaily.get(s.month);
            if (daily !== undefined && limit !== null && ctx.money.mulRatio(daily, DAYS_PER_YEAR, 1, "conv.exact") >= limit) return false;
            // 同居なら扶養する人の収入の2分の1の未満、別居なら仕送りの額の未満
            if (cohabiting) return ctx.money.mulRatio(income, 2, 1, "conv.exact") < incomeOf(x.id).prospective(m);
            return allowance === null || income < allowance;
          })
        : undefined;
      if (supporter !== undefined) {
        months.push({ month: s.month, kind: "dependent", supporter: supporter.id });
        continue;
      }
      months.push({ month: s.month, kind: "national" });
    }
    return { months };
  },
});

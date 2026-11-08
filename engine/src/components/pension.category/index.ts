// 月ごとの国民年金の被保険者の種別（0008 の4: 入力させず、エンジンが導く）
// 第2号: 厚生年金に入る月（65歳に達した後は老齢年金の受給権があるとみなして第2号にしない）。
// 第3号: 20〜59歳で、配偶者（事実婚を含む）が第2号、本人のその月からの1年の収入の見込み（給与・事業）が被扶養者の基準の未満。
//   雇用保険の基本手当を受ける月は、基本手当日額×360 が基準以上なら第3号にしない（改訂3。0037）
// 第1号: それ以外の20〜59歳。保険料は納めたとみなす（免除・未納は加入の記録で入れる）。第1号の母は、出産の月の前の月から
// 4か月の保険料が免除され、納めた月として数える（産前産後期間の免除）。
// 世帯から離れた月（leaves。万一の重ねで亡くなった月の翌月から）は、どの種別でもない（改訂2）
// 改訂4: 収入の見込みの1年のうち表の外の月は1年前の月とみなす（表の長さで第3号の判定を変えない。0003 の追記）
// 改訂5（0171）: 万一の想定で亡くなる月から、どの種別でもない（死亡の翌日に資格を失い、保険料はその前の月まで。国民年金法9条1号・11条。
//   sdk の insuranceEndMonth）。第2号の配偶者が亡くなる月は、配偶者が第2号でない（socialInsurance.employeeStatus）ので、その月から第1号
import {
  addMonths,
  addYen,
  ageMonth,
  defineComponent,
  formatYm,
  insuranceEndMonth,
  prospectiveMonths,
  prospectiveYear,
  monthOf,
  parseYm,
  yearOf,
  yen,
  type BusinessOutput,
  type CategoryMonth,
  type EmployeeStatusOutput,
  type MemberInput,
  type MonthIndex,
  type RelationInput,
  type SalaryOutput,
  type UnemploymentOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  from: "socialInsurance.nationalPension.fromAge",
  until: "socialInsurance.nationalPension.untilAge",
  category2Until: "socialInsurance.nationalPension.category2UntilAge",
  limit: "socialInsurance.dependent.incomeLimit",
  exemptBefore: "socialInsurance.nationalPension.maternityExemption.monthsBefore",
  exemptMonths: "socialInsurance.nationalPension.maternityExemption.months",
};

/** 雇用保険の給付の日額を年額に直す日数（被扶養者の認定と同じく日額×360 と基準を比べる） */
const DAYS_PER_YEAR = 360;

export default defineComponent<{ member: string }, { months: CategoryMonth[] }>({
  id: "pension.category",
  title: "国民年金の被保険者の種別",
  contract: "1.0",
  revision: 5,
  requires: { "contingency.event": ">=1 <2", "socialInsurance.employeeStatus": ">=1 <2", "income.salary": ">=1 <2", "income.business": ">=1 <2", "benefit.unemployment": ">=1 <2" },
  params: Object.values(P),
  reads: [
    "member.kind",
    "member.birth",
    "member.sex",
    "member.leaves",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
  ],
  input: "member.input",
  output: "pension.category.output",
  compute(input, ctx) {
    const member = input.member;
    const { base, end } = ctx.time;
    const own = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member }).months;
    if (own.length === 0) return { months: [] };
    const first = parseYm((own[0] as { month: string }).month);
    const at0 = first < base ? base : first;
    const from20 = ageMonth(ctx, at0, P.from, member);
    const until60 = ageMonth(ctx, at0, P.until, member);
    const until65 = ageMonth(ctx, at0, P.category2Until, member);
    const members = ctx.list<MemberInput>("member");
    const me = members.find((m) => m.id === member) as MemberInput;
    const leaves = insuranceEndMonth(ctx, me);
    const relations = ctx.list<RelationInput>("relation");
    const spouseAt = (m: MonthIndex): string[] =>
      relations.flatMap((r) => {
        if (r.type !== "spouse" || (r.a !== member && r.b !== member)) return [];
        if ((r.from !== null && ctx.time.resolve(r.from) > m) || (r.to !== null && ctx.time.resolve(r.to) < m)) return [];
        return [r.a === member ? r.b : r.a];
      });
    const spouseSecond = new Map<string, Map<string, boolean>>();
    const isSecond = (id: string, ym: string): boolean => {
      let map = spouseSecond.get(id);
      if (map === undefined) {
        const lim = ageMonth(ctx, at0, P.category2Until, id);
        map = new Map(ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member: id }).months.map((x) => [x.month, x.pension && parseYm(x.month) < lim]));
        spouseSecond.set(id, map);
      }
      return map.get(ym) ?? false;
    };
    // 収入の見込み: その月から12か月の給与（賞与・通勤手当を含む）と事業所得
    const salaryByMonth = new Map<string, Yen>();
    for (const p of ctx.call<SalaryOutput>("income.salary", { member }).payments) {
      salaryByMonth.set(p.ym, addYen(salaryByMonth.get(p.ym) ?? yen(0), addYen(addYen(p.salary, p.bonus), p.commuting)));
    }
    const business = new Map(ctx.call<BusinessOutput>("income.business", { member }).byYear.map((b) => [b.year, b.income]));
    const prospective = (m: MonthIndex): Yen => {
      let s = yen(0);
      // 表の外の月は1年前の月、表の外の年の事業所得は表の最後の年の額とみなす（改訂4。0003 の追記）
      for (const ym of prospectiveMonths(m, end)) s = addYen(s, salaryByMonth.get(ym) ?? yen(0));
      // 事業所得は年額の12分の1ずつ（その月からの12か月の分）
      const y0 = yearOf(m);
      const k0 = 13 - monthOf(m);
      const b0 = business.get(y0) ?? yen(0);
      const b1 = business.get(prospectiveYear(y0 + 1, end)) ?? yen(0);
      return addYen(addYen(s, ctx.money.mulRatio(b0, k0, 12, "conv.salary.monthly")), ctx.money.mulRatio(b1, 12 - k0, 12, "conv.salary.monthly"));
    };
    // 基本手当を受ける月の日額
    const allowanceDaily = new Map(ctx.call<UnemploymentOutput>("benefit.unemployment", { member }).receipts.map((x) => [x.month, x.daily]));
    // 第1号の母の産前産後の免除: 子の出生の月の前の月から
    const exemptMonths = new Set<string>();
    if (me.sex === "female") {
      const parentsGiven = relations.some((r) => r.type === "parentOf");
      for (const c of members) {
        if (c.kind !== "child") continue;
        const mine = parentsGiven
          ? relations.some((r) => r.type === "parentOf" && r.parent === member && r.child === c.id)
          : me.kind === "self" || me.kind === "spouse";
        if (!mine) continue;
        const birth = parseYm(c.birth.birthYearMonth);
        const at = ctx.at(birth < base ? base : birth);
        const before = at.paramCount(P.exemptBefore) ?? 0;
        const n = at.paramCount(P.exemptMonths) ?? 0;
        for (let k = 0; k < n; k++) exemptMonths.add(formatYm(addMonths(birth, k - before)));
      }
    }
    const months: CategoryMonth[] = [];
    for (const s of own) {
      const m = parseYm(s.month);
      if (leaves !== null && m >= leaves) {
        months.push({ month: s.month, category: "none", basic: false, premiumExempt: false });
        continue;
      }
      const npAge = m >= from20 && m < until60;
      let category: CategoryMonth["category"] = "none";
      if (s.pension && m < until65) category = "2";
      else if (npAge) {
        const limit = ctx.at(m < base ? base : m).paramYen(P.limit);
        const daily = allowanceDaily.get(s.month);
        const byAllowance = daily !== undefined && limit !== null && ctx.money.mulRatio(daily, DAYS_PER_YEAR, 1, "conv.exact") >= limit;
        const third = spouseAt(m).some((sp) => isSecond(sp, s.month)) && (limit === null || prospective(m) < limit) && !byAllowance;
        category = third ? "3" : "1";
      }
      const exempt = category === "1" && exemptMonths.has(s.month);
      months.push({ month: s.month, category, basic: npAge && category !== "none", premiumExempt: exempt });
    }
    return { months };
  },
});

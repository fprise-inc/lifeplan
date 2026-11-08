// 月ごとの国民年金の被保険者の種別（0008 の4: 入力させず、エンジンが導く）
// 第2号: 厚生年金に入る月（65歳に達した後は老齢年金の受給権があるとみなして第2号にしない）。
// 第3号: 20〜59歳で、配偶者（事実婚を含む）が第2号、その月の健康保険の種類がその配偶者の扶養（改訂6）。
//   雇用保険の基本手当を受ける月は、基本手当日額×360 が基準以上なら第3号にしない（改訂3。0037）
// 第1号: それ以外の20〜59歳。保険料は納めたとみなす（免除・未納は加入の記録で入れる）。第1号の母は、出産の月の前の月から
// 4か月の保険料が免除され、納めた月として数える（産前産後期間の免除）。
// 世帯から離れた月（leaves。万一の重ねで亡くなった月の翌月から）は、どの種別でもない（改訂2）
// 改訂4: 収入の見込みの1年のうち表の外の月は1年前の月とみなす（表の長さで第3号の判定を変えない。0003 の追記）
// 改訂5（0171）: 万一の想定で亡くなる月から、どの種別でもない（死亡の翌日に資格を失い、保険料はその前の月まで。国民年金法9条1号・11条。
//   sdk の insuranceEndMonth）。第2号の配偶者が亡くなる月は、配偶者が第2号でない（socialInsurance.employeeStatus）ので、その月から第1号
// 改訂6（0174）: 第3号は、その月の健康保険の種類が第2号の配偶者の扶養（dependent）の月だけにした（socialInsurance.healthStatus と同じ決まりを
//   sdk の deriveHealthStatus で導く。国民健康保険・任意継続と書いた期間や、扶養の判定に通らない月は第1号。扶養と書いた期間は、配偶者が第2号なら第3号）。収入の見込みは、その月の収入の状況が
//   続くとしたらの年額（健康保険と同じ。働き始めた月から第1号、辞めた翌月から第3号）。ただし公的年金（遺族年金・障害年金）は見込みに入れず、
//   障害年金を受ける人の基準も使わない（年金の額は加入の記録から出し、加入の記録はこの部品から出すので、年金の部品を呼べない）。
//   扶養する配偶者の見込みにも年金を入れない（60〜64歳の特別支給・繰上げの老齢年金を受ける第2号の配偶者）。この2つでは健康保険の種類と食い違うことがある
import {
  addMonths,
  ageMonth,
  defineComponent,
  deriveHealthStatus,
  formatYm,
  HEALTH_STATUS_PARAMS,
  HEALTH_STATUS_READS,
  insuranceEndMonth,
  parseYm,
  type CategoryMonth,
  type EmployeeStatusOutput,
  type HealthStatusMonth,
  type MemberInput,
  type MonthIndex,
  type RelationInput,
} from "../../sdk/index.ts";

const P = {
  from: "socialInsurance.nationalPension.fromAge",
  until: "socialInsurance.nationalPension.untilAge",
  category2Until: "socialInsurance.nationalPension.category2UntilAge",
  exemptBefore: "socialInsurance.nationalPension.maternityExemption.monthsBefore",
  exemptMonths: "socialInsurance.nationalPension.maternityExemption.months",
};

export default defineComponent<{ member: string }, { months: CategoryMonth[] }>({
  id: "pension.category",
  title: "国民年金の被保険者の種別",
  contract: "1.0",
  revision: 6,
  requires: { "contingency.event": ">=1 <2", "socialInsurance.employeeStatus": ">=1 <2", "income.salary": ">=1 <2", "income.business": ">=1 <2", "benefit.unemployment": ">=1 <2" },
  params: [...Object.values(P), ...Object.values(HEALTH_STATUS_PARAMS)],
  reads: [
    ...HEALTH_STATUS_READS,
    "member.sex",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
  ],
  memberScope: ["employment"],
  input: "member.input",
  output: "pension.category.output",
  compute(input, ctx) {
    const member = input.member;
    const { base } = ctx.time;
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
    // 健康保険の種類（socialInsurance.healthStatus と同じ決まり。年金の収入は入れない。改訂6）
    let health: Map<string, HealthStatusMonth> | null = null;
    const healthAt = (ym: string) => (health ??= new Map(deriveHealthStatus(ctx, member, false).map((x) => [x.month, x]))).get(ym);
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
        // 第2号の配偶者の扶養の月だけ第3号（改訂6）。期間に扶養（dependent）と書いた月（FP の上書き。扶養する人は書かない）は、配偶者が第2号なら第3号
        const h = healthAt(s.month);
        const third =
          h?.kind === "dependent" &&
          (h.supporter === undefined ? spouseAt(m).some((sp) => isSecond(sp, s.month)) : spouseAt(m).includes(h.supporter) && isSecond(h.supporter, s.month));
        category = third ? "3" : "1";
      }
      const exempt = category === "1" && exemptMonths.has(s.month);
      months.push({ month: s.month, category, basic: npAge && category !== "none", premiumExempt: exempt });
    }
    return { months };
  },
});

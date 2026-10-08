// 健康保険の給付（非課税）: 出産育児一時金（子の出生の月。母が健康保険・国民健康保険などに入っていれば）、出産手当金（産前産後休業。
// 勤め先の健康保険）、傷病手当金（病気の休業。勤め先の健康保険）。手当金の日額は、休業の前12か月の標準報酬月額の平均÷30（10円単位）×2/3。
// 日数は月単位の近似で1か月を30日とみなす（0003 の未確定。PR の提案）。出産手当金は98日を休業の終わりの翌月に、
// 傷病手当金は休業の月ごとに（最初の月は待期の3日を除く）翌月に払う。通算の上限の日数まで
import {
  addMonths,
  addYen,
  defineComponent,
  formatYm,
  monthIndex,
  parseYm,
  yearOf,
  yen,
  type CoverageOutput,
  type EmployeeStatusOutput,
  type EmploymentPeriodInput,
  type Flow,
  type HealthStatusOutput,
  type MemberInput,
  type MonthIndex,
  type RelationInput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  lumpSum: "socialInsurance.childbirthLumpSum",
  dailyRounding: "socialInsurance.dailyAllowance.dailyRounding",
  numerator: "socialInsurance.dailyAllowance.numerator",
  denominator: "socialInsurance.dailyAllowance.denominator",
  allowanceRounding: "socialInsurance.dailyAllowance.rounding",
  maternityDays: "socialInsurance.maternityAllowance.days",
  waiting: "socialInsurance.sicknessAllowance.waitingDays",
  sickMax: "socialInsurance.sicknessAllowance.maxDays",
};
const DAYS_PER_MONTH = 30;

export default defineComponent<{ member: string }, { flows: Flow[] }>({
  id: "benefit.health",
  title: "健康保険の給付（出産育児一時金・出産手当金・傷病手当金）",
  contract: "1.0",
  revision: 1,
  requires: { "socialInsurance.employeeStatus": ">=1 <2", "socialInsurance.coverage": ">=1 <2", "socialInsurance.healthStatus": ">=1 <2" },
  params: Object.values(P),
  reads: ["member.kind", "member.sex", "member.birth", "relation.type", "relation.parent", "relation.child", "employment.member", "employment.from", "employment.to", "employment.type", "employment.leaveKind"],
  input: "member.input",
  output: "flows.output",
  compute(input, ctx) {
    const member = input.member;
    const { base } = ctx.time;
    const calcStart = monthIndex(yearOf(base) - 2, 1);
    const flows: Flow[] = [];
    const health = new Map(ctx.call<HealthStatusOutput>("socialInsurance.healthStatus", { member }).months.map((x) => [x.month, x.kind]));
    // 出産育児一時金
    const members = ctx.list<MemberInput>("member");
    const me = members.find((m) => m.id === member) as MemberInput;
    const relations = ctx.list<RelationInput>("relation");
    const parentsGiven = relations.some((r) => r.type === "parentOf");
    if (me.sex === "female") {
      for (const c of members) {
        if (c.kind !== "child") continue;
        const mine = parentsGiven ? relations.some((r) => r.type === "parentOf" && r.parent === member && r.child === c.id) : me.kind === "self" || me.kind === "spouse";
        const birth = parseYm(c.birth.birthYearMonth);
        const kind = health.get(c.birth.birthYearMonth);
        if (!mine || birth < calcStart || kind === undefined || kind === "none") continue;
        const amount = ctx.at(birth).paramYen(P.lumpSum);
        if (amount !== null && amount > 0) flows.push({ row: "cf.income.benefit", ym: c.birth.birthYearMonth, amount, accrualYear: yearOf(birth), member, formula: "benefit.health.childbirthLumpSum" });
      }
    }
    // 手当金（勤め先の健康保険の休業）
    const status = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member }).months;
    const leaves = ctx.list<EmploymentPeriodInput>("employment").filter((p) => p.member === member && p.type === "leave" && (p.leaveKind === "maternity" || p.leaveKind === "sick"));
    if (leaves.length === 0) return { flows };
    const cov = ctx.call<CoverageOutput>("socialInsurance.coverage", { member, fromYear: yearOf(base) });
    const stdOf = new Map(cov.months.filter((c) => c.healthStd !== null).map((c) => [c.month, c.healthStd as Yen]));
    const daily = (start: MonthIndex): Yen | null => {
      // 休業の前12か月の標準報酬月額の平均÷30（10円単位）×2/3
      let sum = yen(0);
      let n = 0;
      for (let k = 1; k <= 12; k++) {
        const v = stdOf.get(formatYm(addMonths(start, -k)));
        if (v !== undefined) {
          sum = addYen(sum, v);
          n++;
        }
      }
      if (n === 0) return null;
      const at = ctx.at(start);
      const day = at.money.mulRatio(sum, 1, n * DAYS_PER_MONTH, P.dailyRounding);
      return at.money.mulRatio(day, at.paramCount(P.numerator) ?? 2, at.paramCount(P.denominator) ?? 3, P.allowanceRounding);
    };
    let sickUsed = 0;
    for (const p of leaves.sort((a, b) => ctx.time.resolve(a.from) - ctx.time.resolve(b.from))) {
      const from = ctx.time.resolve(p.from);
      const to = p.to === null ? ctx.time.end : ctx.time.resolve(p.to);
      const covered = status.some((s) => s.period === p.id && s.health);
      if (!covered) continue;
      const d = daily(from);
      if (d === null) continue;
      const at = ctx.at(from);
      if (p.leaveKind === "maternity") {
        const days = at.paramCount(P.maternityDays) ?? 0;
        const amount = at.money.mulRatio(d, days, 1, "conv.exact");
        const paid = addMonths(to, 1);
        flows.push({ row: "cf.income.benefit", ym: formatYm(paid), amount, accrualYear: yearOf(to), member, object: p.id, formula: "benefit.health.maternityAllowance" });
      } else {
        const max = at.paramCount(P.sickMax) ?? 0;
        const waiting = at.paramCount(P.waiting) ?? 0;
        for (let m = from; m <= to && sickUsed < max; m = addMonths(m, 1)) {
          const days = Math.min(m === from ? DAYS_PER_MONTH - waiting : DAYS_PER_MONTH, max - sickUsed);
          sickUsed += days;
          const amount = ctx.at(m).money.mulRatio(d, days, 1, "conv.exact");
          flows.push({ row: "cf.income.benefit", ym: formatYm(addMonths(m, 1)), amount, accrualYear: yearOf(m), member, object: p.id, formula: "benefit.health.sicknessAllowance" });
        }
      }
    }
    return { flows };
  },
});

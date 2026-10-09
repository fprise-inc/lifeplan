// 児童手当（2024年10月分からの制度。値は制度データ regulation.educationSupport）。世帯の子（構成員の種類 child）ごとに、出生の翌月分から
// 18歳に達した後の最初の3月31日の月分まで、3歳未満（3歳に達した月の翌月の前まで）は月額 under3、それ以後は general、第3子以降は thirdChild。
// 第3子の数え方は、22歳に達した後の最初の3月31日までの子（世帯にいる子）を生まれの順に数える（親が経済的な負担をしているとみなす近似）。
// 支払いは偶数月に前の2か月分（2月に12月・1月分）。受け取るのは子の最初の親（関係 parentOf。無ければ本人）。
// 教育の目標の education.childAllowance が false の子は計算しない。所得の制限は無い
import {
  addMonths,
  ageMonth,
  defineComponent,
  formatYm,
  monthOf,
  parseYm,
  yearOf,
  type Flow,
  type FlowsResult,
  type GoalInput,
  type MemberInput,
  type MonthIndex,
  type RelationInput,
} from "../../sdk/index.ts";

const P = {
  under3: "childAllowance.monthly.under3",
  general: "childAllowance.monthly.general",
  third: "childAllowance.monthly.thirdChild",
  lower: "childAllowance.lowerAge",
  until: "childAllowance.untilAge",
  count: "childAllowance.countUntilAge",
};

export default defineComponent<Record<string, never>, FlowsResult>({
  id: "benefit.childAllowance",
  title: "児童手当",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: Object.values(P),
  reads: ["member.kind", "member.birth", "member.joins", "member.leaves", "relation.type", "relation.parent", "relation.child", "goal.kind", "goal.owner", "goal.education"],
  input: "empty.input",
  output: "flows.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const members = ctx.list<MemberInput>("member");
    const children = members.filter((m) => m.kind === "child").sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? -1 : a.birth.birthYearMonth > b.birth.birthYearMonth ? 1 : 0));
    if (children.length === 0) return { flows: [] };
    const optOut = new Set(ctx.list<GoalInput>("goal").filter((g) => g.kind === "education" && g.education?.childAllowance === false).map((g) => g.owner));
    const relations = ctx.list<RelationInput>("relation");
    const self = members.find((m) => m.kind === "self")?.id;
    const parentOf = (c: string) => relations.find((r): r is Extract<RelationInput, { type: "parentOf" }> => r.type === "parentOf" && r.child === c)?.parent ?? self ?? c;
    // 計算の始まり: 計算基準月の分から（偶数月に払う前の月の分を含めるため、計算基準月の前の月から）
    const first = addMonths(base, -1);
    const info = children.map((c) => ({
      c,
      born: parseYm(c.birth.birthYearMonth),
      joins: c.joins === null ? null : ctx.time.resolve(c.joins),
      leaves: c.leaves === null ? null : ctx.time.resolve(c.leaves),
      lower: ageMonth(ctx, base, P.lower, c.id),
      until: ageMonth(ctx, base, P.until, c.id),
      count: ageMonth(ctx, base, P.count, c.id),
      parent: parentOf(c.id),
    }));
    const flows: Flow[] = [];
    let missing = false;
    for (let m: MonthIndex = first; m <= end; m = addMonths(m, 1)) {
      const at = ctx.at(m < base ? base : m);
      if (!at.has(P.general)) {
        missing = true;
        continue;
      }
      const present = (x: (typeof info)[number]) => x.born <= m && (x.joins === null || x.joins <= m) && (x.leaves === null || x.leaves > m);
      let rank = 0;
      for (const x of info) {
        if (!present(x) || m > x.count) continue;
        rank++;
        if (optOut.has(x.c.id) || m <= x.born || m > x.until) continue;
        const id = rank >= 3 ? P.third : m < x.lower ? P.under3 : P.general;
        const amount = at.paramYen(id);
        if (amount === null || amount <= 0) continue;
        const pay = monthOf(m) % 2 === 1 ? addMonths(m, 1) : addMonths(m, 2);
        if (pay < base || pay > end) continue;
        flows.push({ row: "cf.income.benefit.childAllowance", ym: formatYm(pay), amount, accrualYear: yearOf(m), member: x.parent, object: x.c.id, formula: "benefit.childAllowance.monthly" });
      }
    }
    if (missing) ctx.notice("N_PARAM_MISSING", [P.general]);
    flows.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
    return { flows };
  },
});

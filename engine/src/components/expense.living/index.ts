// 生活費（0008 の追記: 総額で入れる方式と、費目別（家計調査の区分）で入れる方式）。
// - 額は計算基準年の価格の月額。年ごとに伸び方（省略は前提の物価上昇率。年ごとの列）で伸ばし（1年ごとに円未満切り捨て）、年額を12か月に分けて毎月払う
// - 段階（子の独立・退職後・70代・80代など）: その月から、最初の額に対する割合（ratio）か、月額（計算基準年の価格）に変える。
//   費目別の入れ方で月額の段階を書いたときは、各費目を最初の費目の割合で分ける。段階は月の順に当て、後の段階が前の段階に勝つ
// - 万一のとき（改訂2。0008 の追記 2026-10-09 の決定2・3）: 生活費の段階を先に掛け、その後に万一の割合を掛ける（万一の月の翌月から）。
//   onContingency を書いた生活費は、その扱い（続く・止まる・割合。割合は万一の後の全期間で1つ）。書いていない生活費は、死亡のときだけ
//   遺族の生活費の割合（万一の想定の survivor.livingRatio。省略は末子の独立まで0.7、独立の後0.5。子のいない世帯は noChildren で省略は0.7）を総額に掛ける（費目別の生活費も同じ割合）。
//   末子の独立は、子の leaves があればその月、無ければ独立とみなす年齢（survivor.independenceAge。省略は22）に達した後の最初の3月31日の翌月
// 改訂3: 世帯の外の家族（0035 の4）の子は遺族の生活費の子に数えない
// 改訂4（0100）: 内訳に通信費・交通費（車を除く）・こづかいと交際費・その他を足した（計算は内訳の合計のまま。前の分け方の交通・通信とその他の消費支出も同じ）
import {
  addMonths,
  boxValue,
  contingencyRatio,
  defineComponent,
  formatYm,
  grownByYear,
  isOutside,
  monthIndex,
  parseYm,
  yearOf,
  yen,
  type ContingencyEvent,
  type ContingencyEventOutput,
  type Flow,
  type FlowsResult,
  type LivingCategory,
  type LivingExpenseInput,
  type MemberInput,
  type MonthIndex,
  type Rate,
  type Yen,
} from "../../sdk/index.ts";

const ROW: Readonly<Record<LivingCategory, string>> = {
  food: "cf.expense.living.food",
  utilities: "cf.expense.living.utilities",
  communication: "cf.expense.living.communication",
  transit: "cf.expense.living.transit",
  furniture: "cf.expense.living.furniture",
  clothing: "cf.expense.living.clothing",
  health: "cf.expense.living.health",
  recreation: "cf.expense.living.recreation",
  pocketAndSocial: "cf.expense.living.pocketAndSocial",
  other: "cf.expense.living.other",
  allowance: "cf.expense.living.allowance",
  // 前の分け方（0.42 までの世帯の内訳。0100）
  transport: "cf.expense.living.transport",
  otherConsumption: "cf.expense.living.otherConsumption",
};

export default defineComponent<Record<string, never>, FlowsResult>({
  id: "expense.living",
  title: "生活費",
  contract: "1.0",
  revision: 4,
  requires: { "contingency.event": ">=1 <2" },
  params: [],
  reads: [
    "member.outside",
    "member.kind",
    "member.birth",
    "member.leaves",
    "livingExpense.onContingency",
    "livingExpense.mode",
    "livingExpense.from",
    "livingExpense.to",
    "livingExpense.monthly",
    "livingExpense.categories",
    "livingExpense.growth",
    "livingExpense.stages",
    "assumptions.inflation",
  ],
  replaceable: true,
  input: "empty.input",
  output: "flows.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const flows: Flow[] = [];
    // 万一の想定（世帯のだれか。要求1つに1件まで）と、遺族の生活費の割合の切り替わり（末子の独立）
    const members = ctx.list<MemberInput>("member");
    let ev: ContingencyEvent | null = null;
    for (const m of members) {
      ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: m.id }).event;
      if (ev !== null) break;
    }
    let survivorRatio: ((m: MonthIndex) => Rate) | null = null;
    if (ev !== null && ev.kind === "death") {
      const D = parseYm(ev.month);
      // 空欄は目安（sdk/estimates.ts。事務所の推定の値があればその値）
      const before = ctx.rate.of(ev.survivor?.livingRatio?.beforeIndependence ?? String(ctx.estimate("preset.survivor.livingRatio.beforeIndependence")));
      const after = ctx.rate.of(ev.survivor?.livingRatio?.afterIndependence ?? String(ctx.estimate("preset.survivor.livingRatio.afterIndependence")));
      const noChildren = ctx.rate.of(ev.survivor?.livingRatio?.noChildren ?? String(ctx.estimate("preset.survivor.livingRatio.noChildren")));
      const age = ev.survivor?.independenceAge ?? 22;
      let independence: MonthIndex = D;
      let hasChild = false;
      for (const c of members) {
        // 世帯の外の子は遺族の生活費の子に数えない（0035 の4）
        if (c.kind !== "child" || isOutside(c) || parseYm(c.birth.birthYearMonth) > addMonths(D, 10)) continue;
        hasChild = true;
        const own = c.leaves === null ? addMonths(ctx.time.ageSwitch(c.id, { years: age }, "firstMarch31AfterReach"), 1) : ctx.time.resolve(c.leaves);
        if (own > independence) independence = own;
      }
      survivorRatio = hasChild ? (m) => (m < independence ? before : after) : () => noChildren;
    }
    for (const e of ctx.list<LivingExpenseInput>("livingExpense")) {
      const from = e.from === undefined ? base : ctx.time.resolve(e.from);
      const to = e.to === undefined || e.to === null ? end : ctx.time.resolve(e.to);
      if (to < base || from > end) continue;
      // 費目（総額の入れ方は1つの行）と、計算基準年の価格の最初の月額
      const items: { row: string; monthly: Yen }[] =
        e.mode === "byCategory"
          ? (e.categories ?? []).map((c) => ({ row: ROW[c.category], monthly: boxValue(c.monthly) ?? yen(0) }))
          : [{ row: "cf.expense.living", monthly: boxValue(e.monthly) ?? yen(0) }];
      const total0 = items.reduce((s, x) => s + x.monthly, 0);
      // 段階（月の順）: 各段階の、費目ごとの計算基準年の価格の月額
      const stages = (e.stages ?? [])
        .map((s) => ({ m: ctx.time.resolve(s.at), s }))
        .sort((a, b) => a.m - b.m)
        .map(({ m, s }) => {
          const monthly = boxValue(s.monthly);
          let amounts: Yen[];
          if (monthly !== null && monthly !== undefined) {
            amounts = total0 > 0 ? ctx.money.allocate(monthly, items.map((x) => x.monthly as number), "conv.expense.share", "first") : items.map((_, i) => (i === 0 ? monthly : yen(0)));
          } else {
            const r = ctx.rate.of(s.ratio ?? "1");
            amounts = items.map((x) => ctx.money.mulRate(x.monthly, r, "conv.expense.share"));
          }
          return { m, amounts };
        });
      // 費目×段階ごとの、年ごとの額（年額。計算基準年の価格を伸ばしたもの）
      const series = new Map<string, Map<number, Yen>>();
      const yearly = (k: number, i: number, monthly: Yen): Map<number, Yen> => {
        const key = `${k}|${i}`;
        let s = series.get(key);
        if (s === undefined) {
          s = grownByYear(ctx, ctx.money.mulRatio(monthly, 12, 1, "conv.exact"), e.growth, baseYear, endYear);
          series.set(key, s);
        }
        return s;
      };
      const first = from < base ? base : from;
      const last = to > end ? end : to;
      // 年ごと・費目ごとに、その年の段階の年額を12か月に分けた月の額
      let year = -1;
      let parts: Yen[][] = [];
      let stageIndex = -1;
      for (let m: MonthIndex = first; m <= last; m = addMonths(m, 1)) {
        let k = -1;
        for (let j = 0; j < stages.length; j++) if ((stages[j] as { m: MonthIndex }).m <= m) k = j;
        if (yearOf(m) !== year || k !== stageIndex) {
          year = yearOf(m);
          stageIndex = k;
          parts = items.map((x, i) => {
            const monthly = k < 0 ? x.monthly : ((stages[k] as { amounts: Yen[] }).amounts[i] as Yen);
            const annual = yearly(k, i, monthly).get(year) ?? yen(0);
            return ctx.money.allocate(annual, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.expense.share", "first");
          });
        }
        const mo = m - monthIndex(year, 1);
        // 万一の割合（段階の後に掛ける）
        const explicit = contingencyRatio(ctx, e.onContingency, ev, m);
        const r = e.onContingency !== undefined ? explicit : survivorRatio !== null && m > parseYm((ev as ContingencyEvent).month) ? survivorRatio(m) : null;
        items.forEach((x, i) => {
          const full = (parts[i] as Yen[])[mo] as Yen;
          const amount = r === null ? full : ctx.money.mulRate(full, r, "conv.expense.share");
          if (amount > 0) flows.push({ row: x.row, ym: formatYm(m), amount, accrualYear: year, object: e.id, formula: r !== null ? "expense.living.contingency" : k < 0 ? "expense.living.monthly" : "expense.living.stage" });
        });
      }
    }
    return { flows };
  },
});

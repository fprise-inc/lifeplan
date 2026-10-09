// 生活費（0008 の追記: 総額で入れる方式と、費目別（家計調査の区分）で入れる方式）。
// - 額は計算基準年の価格の月額。年ごとに伸び方（省略は前提の物価上昇率。年ごとの列）で伸ばし（1年ごとに円未満切り捨て）、年額を12か月に分けて毎月払う
// - 段階（子の独立・退職後・70代・80代など）: その月から、最初の額に対する割合（ratio）か、月額（計算基準年の価格）に変える。
//   費目別の入れ方で月額の段階を書いたときは、各費目を最初の費目の割合で分ける。段階は月の順に当て、後の段階が前の段階に勝つ
// - 万一のときの扱い（onContingency）は入力として持つだけ（万一の部品で使う）
import {
  addMonths,
  boxValue,
  defineComponent,
  formatYm,
  grownByYear,
  monthIndex,
  yearOf,
  yen,
  type Flow,
  type FlowsResult,
  type LivingCategory,
  type LivingExpenseInput,
  type MonthIndex,
  type Yen,
} from "../../sdk/index.ts";

const ROW: Readonly<Record<LivingCategory, string>> = {
  food: "cf.expense.living.food",
  utilities: "cf.expense.living.utilities",
  furniture: "cf.expense.living.furniture",
  clothing: "cf.expense.living.clothing",
  health: "cf.expense.living.health",
  transport: "cf.expense.living.transport",
  recreation: "cf.expense.living.recreation",
  otherConsumption: "cf.expense.living.otherConsumption",
  allowance: "cf.expense.living.allowance",
};

export default defineComponent<Record<string, never>, FlowsResult>({
  id: "expense.living",
  title: "生活費",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: [],
  reads: [
    "livingExpense.mode",
    "livingExpense.from",
    "livingExpense.to",
    "livingExpense.monthly",
    "livingExpense.categories",
    "livingExpense.growth",
    "livingExpense.stages",
    "assumptions.inflation",
  ],
  input: "empty.input",
  output: "flows.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const flows: Flow[] = [];
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
        items.forEach((x, i) => {
          const amount = (parts[i] as Yen[])[mo] as Yen;
          if (amount > 0) flows.push({ row: x.row, ym: formatYm(m), amount, accrualYear: year, object: e.id, formula: k < 0 ? "expense.living.monthly" : "expense.living.stage" });
        });
      }
    }
    return { flows };
  },
});

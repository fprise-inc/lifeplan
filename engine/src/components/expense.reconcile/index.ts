// 現状の検算（0008 の追記）: 実際の年間の貯蓄額（FP が入れた額）と、計算上の貯蓄額（その年の年間収支 cf.net。器の間の移動は貯蓄に含む）の差を、
// 使途不明金として出す。比べるのは12か月そろった年（検算する年が計算基準年の途中から始まるときは、その翌年。賞与の月などで偏らないように）。
// 差は、検算する年（計算基準年なら計算基準月）から終わりの月まで、前提の物価上昇率で伸ばして毎月載せる。扱いは「生活費に足す」（cf.expense.living）か
// 「使途不明金として残す」（cf.expense.other.unexplained）。差が0以下（計算より多く貯まっている）なら載せず、知らせ N_RECONCILE_SURPLUS を出す。
// 年間収支を作る部品（plan.flows）の結果を読むので、plan.cashflow が呼ぶ（plan.flows からは呼ばない）
import {
  addMonths,
  boxValue,
  defineComponent,
  formatYm,
  grownByYear,
  monthIndex,
  monthOf,
  monthlyParts,
  yearOf,
  yen,
  type Flow,
  type MonthIndex,
  type ReconcileOutput,
  type SavingsCheckInput,
  type Yen,
} from "../../sdk/index.ts";


export default defineComponent<Record<string, never>, ReconcileOutput>({
  id: "expense.reconcile",
  title: "現状の検算（使途不明金）",
  contract: "1.0",
  revision: 1,
  requires: { "plan.flows": ">=1 <2" },
  params: [],
  reads: ["savingsCheck.year", "savingsCheck.actualSavings", "savingsCheck.treatment", "savingsCheck.until", "assumptions.inflation"],
  input: "empty.input",
  output: "expense.reconcile.output",
  compute(_input, ctx) {
    const checks = ctx.list<SavingsCheckInput>("savingsCheck");
    if (checks.length === 0) return { flows: [], checks: [] };
    const { base, end } = ctx.time;
    const net = ctx.call<{ net: readonly { year: number; amount: Yen }[] }>("plan.flows", {}).net;
    const flows: Flow[] = [];
    const out: ReconcileOutput["checks"][number][] = [];
    for (const c of checks) {
      if (c.year < yearOf(base) || c.year > yearOf(end)) continue;
      const first: MonthIndex = c.year === yearOf(base) ? base : monthIndex(c.year, 1);
      const compared = monthOf(first) === 1 ? c.year : c.year + 1;
      if (compared > yearOf(end)) continue;
      const computed = net.find((x) => x.year === compared)?.amount ?? yen(0);
      const actual = boxValue(c.actualSavings) ?? yen(0);
      const gap = yen(computed - actual);
      const unexplainedAnnual = gap > 0 ? gap : yen(0);
      out.push({ object: c.id, year: compared, computed, actual, unexplainedAnnual });
      if (gap <= 0) {
        ctx.notice("N_RECONCILE_SURPLUS", [c.id]);
        continue;
      }
      const until = c.until === undefined || c.until === null ? end : ctx.time.resolve(c.until);
      // 比べた年の額を基準に、前の年は割り戻さず同じ額、後の年は物価上昇率で伸ばす
      const grown = grownByYear(ctx, unexplainedAnnual, { kind: "inflation" }, compared, yearOf(end));
      const row = c.treatment === "addToLiving" ? "cf.expense.living" : "cf.expense.other.unexplained";
      let year = -1;
      let parts: Yen[] = [];
      for (let m = first; m <= until && m <= end; m = addMonths(m, 1)) {
        if (yearOf(m) !== year) {
          year = yearOf(m);
          parts = monthlyParts(ctx, year < compared ? unexplainedAnnual : (grown.get(year) ?? unexplainedAnnual));
        }
        const amount = parts[monthOf(m) - 1] as Yen;
        if (amount > 0) flows.push({ row, ym: formatYm(m), amount, accrualYear: year, object: c.id, formula: `expense.reconcile.${c.treatment}` });
      }
    }
    return { flows, checks: out };
  },
});

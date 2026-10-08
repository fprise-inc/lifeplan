// 自営の事業所得（働き方の期間の business）。年額を12か月に分けて載せる（0003 の2）。入力の額は期間の最初の年
// （計算基準年より前なら計算基準年）の額で、その後の年は賃金上昇率で伸ばす（給与と同じ扱い）
import {
  boxValue,
  defineComponent,
  formatYm,
  monthIndex,
  rate,
  RATE_ONE,
  yearOf,
  yen,
  type EmploymentPeriodInput,
  type Flow,
  type Yen,
} from "../../sdk/index.ts";

export default defineComponent<{ member: string }, { flows: Flow[]; byYear: { year: number; income: Yen }[] }>({
  id: "income.business",
  title: "事業所得",
  contract: "1.0",
  revision: 2,
  requires: {},
  params: [],
  reads: ["employment.member", "employment.from", "employment.to", "employment.type", "employment.business.income", "assumptions.wageGrowth"],
  memberScope: ["employment"],
  input: "member.input",
  output: "income.business.output",
  compute(input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const calcStart = monthIndex(baseYear - 2, 1);
    const flows: Flow[] = [];
    const totals = new Map<number, Yen>();
    for (const p of ctx.list<EmploymentPeriodInput>("employment")) {
      if (p.member !== input.member || p.type !== "selfEmployed") continue;
      const from = ctx.time.resolve(p.from);
      const to = p.to === null ? end : ctx.time.resolve(p.to);
      const start = from < calcStart ? calcStart : from;
      const stop = to > end ? end : to;
      if (start > stop) continue;
      const refYear = Math.max(yearOf(from), baseYear);
      let annual = boxValue(p.business?.income) ?? yen(0);
      for (let y = yearOf(start); y <= yearOf(stop); y++) {
        if (y > refYear) annual = ctx.money.mulRate(annual, ctx.rate.add(RATE_ONE, ctx.assumption("wageGrowth", y, rate("0"))), "conv.salary.growth");
        const monthly = ctx.money.allocate(annual, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.salary.monthly", "last");
        for (let mo = 1; mo <= 12; mo++) {
          const m = monthIndex(y, mo);
          if (m < start || m > stop) continue;
          const amount = monthly[mo - 1] as Yen;
          totals.set(y, yen((totals.get(y) ?? 0) + amount));
          if (amount !== 0) flows.push({ row: "cf.income.business", ym: formatYm(m), amount, accrualYear: y, member: input.member, object: p.id, formula: "income.business.monthly" });
        }
      }
    }
    const byYear = [...totals.entries()].sort((a, b) => a[0] - b[0]).map(([year, income]) => ({ year, income }));
    return { flows, byYear };
  },
});

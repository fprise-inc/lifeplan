// 給与・賞与の支払い（0008 の4 の働き方の期間から）。お金の動きは支払月（0003 の2）
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
  type SalaryPayment,
  type Yen,
} from "../../sdk/index.ts";

const PAID: ReadonlySet<string> = new Set(["regular", "contract", "partTime", "civilServant"]);
const DEFAULT_BONUS_MONTHS = [6, 12];

export default defineComponent<{ member: string }, { flows: Flow[]; payments: SalaryPayment[] }>({
  id: "income.salary",
  title: "給与・賞与",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: [],
  reads: [
    "employment.member",
    "employment.from",
    "employment.to",
    "employment.type",
    "employment.salary.annual",
    "employment.salary.bonus",
    "employment.salary.bonusMonths",
    "employment.salary.commutingMonthly",
    "assumptions.wageGrowth",
  ],
  input: "income.salary.input",
  output: "income.salary.output",
  compute(input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    // 前年・前々年の所得に対する住民税のため、計算基準月の2年前の1月から計算する（表に載るのは基準月以後だけ）
    const calcStart = monthIndex(baseYear - 2, 1);
    const periods = ctx
      .list<EmploymentPeriodInput>("employment")
      .filter((p) => p.member === input.member && PAID.has(p.type));
    const flows: Flow[] = [];
    const payments: SalaryPayment[] = [];
    for (const p of periods) {
      const from = ctx.time.resolve(p.from);
      const to = p.to === null ? end : ctx.time.resolve(p.to);
      const start = from < calcStart ? calcStart : from;
      const stop = to > end ? end : to;
      if (start > stop) continue;
      const annual0 = boxValue(p.salary.annual) ?? yen(0);
      const bonus0 = boxValue(p.salary.bonus) ?? yen(0);
      const commuting = boxValue(p.salary.commutingMonthly) ?? yen(0);
      const bonusMonths = [...(p.salary.bonusMonths ?? DEFAULT_BONUS_MONTHS)].sort((a, b) => a - b);
      // 入力の額は「期間の最初の年（計算基準年より前なら計算基準年）」の額。その後の年は賃金上昇率で伸ばす
      const refYear = Math.max(yearOf(from), baseYear);
      let annual = annual0;
      let bonus = bonus0;
      const grown = new Map<number, [Yen, Yen]>();
      for (let y = yearOf(start); y <= yearOf(stop); y++) {
        if (y > refYear) {
          const g = ctx.rate.add(RATE_ONE, ctx.assumption("wageGrowth", y, rate("0")));
          annual = ctx.money.mulRate(annual, g, "conv.salary.growth");
          bonus = ctx.money.mulRate(bonus, g, "conv.salary.growth");
        }
        grown.set(y, [annual, bonus]);
      }
      for (let y = yearOf(start); y <= yearOf(stop); y++) {
        const [a, b] = grown.get(y) as [Yen, Yen];
        // 年額を12か月に分ける（端数は12月）。賞与は支給月で等分（端数は最後の支給月）
        const monthly = ctx.money.allocate(a, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.salary.monthly", "last");
        const bonusParts = b > 0 ? ctx.money.allocate(b, bonusMonths.map(() => 1), "conv.salary.monthly", "last") : [];
        for (let m = 1; m <= 12; m++) {
          const month = monthIndex(y, m);
          if (month < start || month > stop) continue;
          const bi = bonusMonths.indexOf(m);
          const bonusAmount = bi >= 0 && b > 0 ? (bonusParts[bi] as Yen) : yen(0);
          const salary = monthly[m - 1] as Yen;
          const ym = formatYm(month);
          payments.push({ ym, period: p.id, salary, bonus: bonusAmount, commuting });
          if (salary > 0) {
            flows.push({ row: "cf.income.salary", ym, amount: salary, accrualYear: y, member: input.member, object: p.id, formula: "income.salary.monthly" });
          }
          if (bonusAmount > 0) {
            flows.push({ row: "cf.income.salary", ym, amount: bonusAmount, accrualYear: y, member: input.member, object: p.id, formula: "income.salary.bonus" });
          }
        }
      }
    }
    payments.sort((x, y) => (x.ym < y.ym ? -1 : x.ym > y.ym ? 1 : 0));
    return { flows, payments };
  },
});

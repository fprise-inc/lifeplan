// 厚生年金保険料の被保険者負担分: 標準報酬月額（賞与は標準賞与額）×保険料率÷2 を丸める。
// 区間ごとの計算（0006 の追記）: 料率と端数処理の行が変わらない区間ごとに、同じ標準報酬の額は1回だけ計算する
import {
  defineComponent,
  paidByYear,
  parseYm,
  rate,
  segmentIndex,
  yearOf,
  type CoverageOutput,
  type Flow,
  type MonthIndex,
  type PremiumOutput,
  type Segment,
  type Yen,
} from "../../sdk/index.ts";

const ROUNDING = "socialInsurance.employeeShare.rounding";
const RATE = "socialInsurance.pension.rate";

export default defineComponent<{ member: string; fromYear: number }, PremiumOutput>({
  id: "socialInsurance.pension",
  title: "厚生年金保険料",
  contract: "1.1",
  revision: 4,
  requires: { "socialInsurance.coverage": ">=1 <2" },
  params: [RATE, ROUNDING],
  reads: [],
  replaceable: true,
  input: "socialInsurance.premium.input",
  output: "socialInsurance.premium.output",
  compute(input, ctx) {
    const cov = ctx.call<CoverageOutput>("socialInsurance.coverage", input);
    const flows: Flow[] = [];
    const items = [
      ...cov.months.filter((c) => c.pensionStd !== null && c.exempt !== true).map((c) => ({ m: parseYm(c.month), ym: c.paidIn, base: c.pensionStd as Yen, period: c.period, formula: "socialInsurance.pension.monthly" })),
      ...cov.bonuses.filter((b) => b.pensionStdBonus !== null && b.exempt !== true).map((b) => ({ m: parseYm(b.month), ym: b.month, base: b.pensionStdBonus as Yen, period: b.period, formula: "socialInsurance.pension.bonus" })),
    ];
    if (items.length === 0) return { flows, paidByYear: paidByYear(flows) };
    let from = (items[0] as { m: MonthIndex }).m;
    let to = from;
    for (const it of items) {
      if (it.m < from) from = it.m;
      if (it.m > to) to = it.m;
    }
    const segs = ctx.segments(from, to, { params: [RATE, ROUNDING] });
    const memo = new Map<string, Yen | null>();
    for (const it of items) {
      const k = segmentIndex(segs, it.m);
      const key = `${k}|${it.base}`;
      let amount = memo.get(key);
      if (amount === undefined) {
        const at = (segs[k] as Segment).at;
        const r = at.paramRate(RATE);
        amount = r === null ? null : at.money.mulRate(it.base, ctx.rate.div(r, rate("2")), ROUNDING);
        memo.set(key, amount);
      }
      if (amount !== null && amount > 0) flows.push({ row: "cf.taxSi.pension", ym: it.ym, amount, accrualYear: yearOf(it.m), member: input.member, object: it.period, formula: it.formula });
    }
    return { flows, paidByYear: paidByYear(flows) };
  },
});

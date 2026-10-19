// 車の年末の評価額（バランスシートのその他の資産）。お金の動き（expense.car）とは別の部品にし、車の入力から読める範囲だけで出す。
// - 買い替えのたびに、その車は買った月の車両の価格（expense.car と同じ伸び方の額）から、次の買い替えの月の下取りの額（入力が無ければ0）まで、
//   月ごとに定額で下がるとみなす。年末（12月）の評価額＝価格−（価格−下取り）×買ってからの月数÷買い替えの周期の月数（周期を過ぎたら下取りの額）
// - 今の車（owned）: 最初の買い替えの月の買い替えの周期の前に、計算基準年の価格で買ったとみなし、最初の買い替えの月に下取りの額になるように下げる
// - 手放す月（until）の後の年末には持っていない。万一のときの扱い（onContingency）は評価額には当てない
import { addMonths, defineComponent, grownByYear, monthIndex, yearOf, yen, type CarInput, type CarValuationOutput, type MonthIndex, type Yen } from "../../sdk/index.ts";

export default defineComponent<Record<string, never>, CarValuationOutput>({
  id: "asset.car",
  title: "車の評価額",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: [],
  reads: ["car.owner", "car.purchase", "car.until", "car.growth", "assumptions.inflation"],
  input: "empty.input",
  output: "asset.car.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const cars: CarValuationOutput["cars"][number][] = [];
    for (const c of ctx.list<CarInput>("car")) {
      const first = ctx.time.resolve(c.purchase.first);
      const until: MonthIndex = c.until === undefined || c.until === null ? end : ctx.time.resolve(c.until);
      const span = 12 * c.purchase.everyYears;
      if (span <= 0) continue;
      const price = grownByYear(ctx, c.purchase.price, c.growth, baseYear, endYear);
      const tradeIn = grownByYear(ctx, yen(c.purchase.tradeIn ?? 0), c.growth, baseYear, endYear);
      const at = (map: Map<number, Yen>, m: MonthIndex): Yen => map.get(Math.min(endYear, Math.max(baseYear, yearOf(m)))) ?? yen(0);
      // 買った月（今の車は最初の買い替えの周期の前）
      const bought: MonthIndex[] = [];
      if (c.purchase.owned === true) bought.push(addMonths(first, -span));
      for (let m: MonthIndex = first; m <= until && m <= end; m = addMonths(m, span)) bought.push(m);
      const years: { year: number; value: Yen }[] = [];
      for (let y = baseYear; y <= endYear; y++) {
        const dec = monthIndex(y, 12);
        if (dec > until) break;
        let k = -1;
        for (let i = 0; i < bought.length; i++) if ((bought[i] as MonthIndex) <= dec) k = i;
        if (k < 0) continue;
        const p = bought[k] as MonthIndex;
        const p0 = c.purchase.owned === true && k === 0 ? at(price, base) : at(price, p);
        const residual = yen(Math.min(p0, c.purchase.tradeIn === undefined ? 0 : at(tradeIn, addMonths(p, span))));
        const months = Math.min(span, dec - p);
        const value = yen(p0 - ctx.money.mulRatio(yen(p0 - residual), months, span, "conv.asset.valuation"));
        if (value > 0) years.push({ year: y, value });
      }
      cars.push({ object: c.id, owner: c.owner, years });
    }
    return { cars };
  },
});

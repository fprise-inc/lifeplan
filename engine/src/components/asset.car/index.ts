// 車の年末の評価額（バランスシートのその他の資産）。お金の動き（expense.car）とは別の部品にし、車の入力から読める範囲だけで出す。
// - 買い替えのたびに、その車は買った月の車両の価格（expense.car と同じ伸び方の額）から、次の買い替えの月の下取りの額（入力が無ければ0）まで、
//   月ごとに定額で下がるとみなす。年末（12月）の評価額＝価格−（価格−下取り）×買ってからの月数÷買い替えの周期の月数（周期を過ぎたら下取りの額）
// - 今の車（owned）: 最初の買い替えの月の買い替えの周期の前に、計算基準年の価格で買ったとみなし、最初の買い替えの月に下取りの額になるように下げる
// - 手放す月（until）の後の年末には持っていない。万一のときの扱い（onContingency）は評価額には当てない
// 改訂2: 次の買い替えの月が表の外でも、その月の下取りの額（表の外の年まで伸ばした額）まで下げる（表の長さで評価額を変えない。0003 の追記）
// 改訂3（0101）: 買った月は SDK の carPurchaseMonths（手放す月には買わない・買い替えの決まり）。買い替えない車（none）と「○歳まで買い替える」車
//   （until）の最後に買った車は、手放す月に0になるように買った月から定額で下げる（手放す時期が無ければ前のとおり周期で下取りの額まで）。
//   手放すときの売却額はまだ計算に入れていない。リース・長期レンタルの車（purchase が無い）は評価額を持たない
import { addMonths, carKeptToRelease, carPurchaseMonths, defineComponent, grownByYear, monthIndex, yearOf, yen, type CarInput, type CarValuationOutput, type MonthIndex, type Yen } from "../../sdk/index.ts";

export default defineComponent<Record<string, never>, CarValuationOutput>({
  id: "asset.car",
  title: "車の評価額",
  contract: "1.0",
  revision: 3,
  requires: {},
  params: [],
  // 買い替え（car.replace）は買い替え（car.purchase）の中の欄なので、car.purchase を読めば入る（物の中の欄の入力項目ID。0101）
  reads: ["car.owner", "car.purchase", "car.until", "car.growth", "assumptions.inflation"],
  replaceable: true,
  input: "empty.input",
  output: "asset.car.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const cars: CarValuationOutput["cars"][number][] = [];
    for (const c of ctx.list<CarInput>("car")) {
      const pu = c.purchase;
      if (pu === undefined) continue;
      const first = ctx.time.resolve(pu.first);
      const release: MonthIndex | null = c.until === undefined || c.until === null ? null : ctx.time.resolve(c.until);
      const until: MonthIndex = release ?? end;
      const span = 12 * pu.everyYears;
      if (span <= 0) continue;
      // 下取りの額は次の買い替えの月（表の外のこともある）の額。表の外の年まで伸ばして読む（表の長さで評価額を変えない。改訂2、0003 の追記）
      const lastYear = endYear + pu.everyYears;
      const price = grownByYear(ctx, pu.price, c.growth, baseYear, lastYear);
      const tradeIn = grownByYear(ctx, yen(pu.tradeIn ?? 0), c.growth, baseYear, lastYear);
      const at = (map: Map<number, Yen>, m: MonthIndex): Yen => map.get(Math.min(lastYear, Math.max(baseYear, yearOf(m)))) ?? yen(0);
      const r = pu.replace;
      const replace = r === undefined || r.kind === "repeat" ? "repeat" : r.kind === "none" ? "none" : { lastAt: ctx.time.resolve(r.until) };
      // 最後に買った車を手放す月まで乗る（none・until で手放す時期がある）なら、その車は手放す月に0まで下げる。最後かどうかは表の外まで見る
      const kept = carKeptToRelease(replace) && release !== null;
      const purchases = carPurchaseMonths({ first, everyYears: pu.everyYears, owned: pu.owned === true, release, end: kept ? (Math.max(end, release) as MonthIndex) : end, replace });
      // 買った月（今の車は最初の買い替えの周期の前）
      const bought: MonthIndex[] = [];
      if (pu.owned === true) bought.push(addMonths(first, -span));
      for (const m of purchases) if (m <= end) bought.push(m);
      const lastBought = kept ? (purchases.length > 0 ? (purchases.at(-1) as MonthIndex) : pu.owned === true ? addMonths(first, -span) : null) : null;
      const years: { year: number; value: Yen }[] = [];
      for (let y = baseYear; y <= endYear; y++) {
        const dec = monthIndex(y, 12);
        if (dec > until) break;
        let k = -1;
        for (let i = 0; i < bought.length; i++) if ((bought[i] as MonthIndex) <= dec) k = i;
        if (k < 0) continue;
        const p = bought[k] as MonthIndex;
        const p0 = pu.owned === true && k === 0 ? at(price, base) : at(price, p);
        let value: Yen;
        if (kept && p === lastBought && release !== null) {
          // 手放す月に0になるように定額で下げる（0101）
          const life = release - p;
          value = life <= 0 ? yen(0) : yen(p0 - ctx.money.mulRatio(p0, Math.min(life, dec - p), life, "conv.asset.valuation"));
        } else {
          const residual = yen(Math.min(p0, pu.tradeIn === undefined ? 0 : at(tradeIn, addMonths(p, span))));
          const months = Math.min(span, dec - p);
          value = yen(p0 - ctx.money.mulRatio(yen(p0 - residual), months, span, "conv.asset.valuation"));
        }
        if (value > 0) years.push({ year: y, value });
      }
      cars.push({ object: c.id, owner: c.owner, years });
    }
    return { cars };
  },
});

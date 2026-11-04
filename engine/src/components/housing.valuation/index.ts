// 持ち家の評価額（バランスシートの不動産）と売却。住まい（residence）の持ち家ごとに、年末の評価額を土地と建物に分けて出す。
// - 評価の基にする額: valuation.value（asOf の時点。省略は計算基準月、購入があれば購入の月）か、購入の価格（購入の月）。どちらも無い持ち家は評価しない
//   （知らせ N_INPUT_REQUIRED）
// - 土地と建物に分ける: 土地＝基にする額×土地の割合（物件の valuation.landShare → 前提 realEstateValuation.landShare → 目安 0.3。目安を使ったら
//   知らせ N_DEFAULT_USED）、建物＝残り
// - 土地: 基にする年の翌年から、毎年の上昇率（前提 realEstateValuation.landGrowth。省略は物価上昇率）を当てる（1年ごとに円未満切り捨て）
// - 建物: 構造の耐用年数（前提 realEstateValuation.usefulLife → 目安 木造22・軽量鉄骨19・重量鉄骨34・鉄筋コンクリート47年）で定額で減らし、
//   残りの価値の下限（前提 residualFloor → 目安 0.2）より下げない。築年数 a の年末の残りの割合 f(a)＝max(下限, 1−a÷耐用年数)、
//   a＝その年−建った年（valuation.builtYear。省略は基にする年＝新築）。中古で買ったときも、基にする年の f に対する比で減らす
//   （建物＝基にする建物の額×f(その年の築年数)÷f(基にする年の築年数)）
// - 売却（sale。住み終わり to があるときだけ）: 住み終わりの月に、売却価格（省略はその年の評価額）から売却の費用（売却価格×費用の割合。
//   sale.costRate → 前提 saleCostRate → 目安 0.04）を引いた手取りを、名義の人の一時金の収入にする（cf.income.lumpSum.realEstateSale）。
//   売った年の年末には持っていない。住宅ローンの残りは返済の予定のまま（売るときに返すなら、住宅ローンの繰上返済で入れる）
// - 譲渡所得の税（改訂2。0053）: 税は計算しない。入れた額（sale.tax。所得税・住民税の合計）があれば、売った月に名義の人の出るお金にする
//   （売った年の年分の税として数える）。表の行は所得税・住民税の明細（cf.taxSi.incomeTax.realEstateSale・cf.taxSi.residentTax.realEstateSale）に、
//   長期譲渡の税率の比（15.315対5）で分ける（合計は入れた額のまま）。額の無い売却は税0円のまま知らせ N_NOT_SUPPORTED residence.saleTax を出す
//   （「わからない」の代わりの値も額として使い、該当なしは0円で知らせを出さない）
// - 売却の無い住み終わりは、住み終わりの年まで評価に載せ、その後は消える（知らせ N_NOT_SUPPORTED residence.sale。前からの扱い）
// - 注文住宅（改訂3。0115）: 購入に土地（purchase.land）があれば、土地の決済の月から持ち、引き渡し（購入の月）の年より前の年末は土地だけを出す。
//   評価の基にする額が購入の価格なら、土地は土地の代金（割合で分けない。土地の割合の知らせも出さない）、建物は残り
// 目安の根拠は設計記録 0025 に書く。土地と建物に分ける計算は、住まい以外の不動産（asset.realEstate）と共通の sdk の landBuildingValuer
import {
  addYen,
  boxValue,
  defineComponent,
  formatYm,
  landBuildingValuer,
  LAND_SHARE,
  RATE_ZERO,
  SALE_COST_RATE,
  yearOf,
  yen,
  type Flow,
  type HousingValuationOutput,
  type MonthIndex,
  type Rate,
  type RealEstateValuationSetting,
  type ResidenceInput,
  type Yen,
} from "../../sdk/index.ts";

const R = "conv.asset.valuation";

export default defineComponent<Record<string, never>, HousingValuationOutput>({
  id: "housing.valuation",
  title: "持ち家の評価額と売却",
  contract: "1.1",
  revision: 3,
  requires: {},
  params: [],
  reads: [
    "residence.kind",
    "residence.from",
    "residence.to",
    "residence.purchase",
    "residence.ownership",
    "residence.valuation",
    "residence.sale",
    "assumptions.inflation",
    "assumptions.realEstateValuation",
  ],
  replaceable: true,
  input: "empty.input",
  output: "housing.valuation.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const setting = ctx.setting<RealEstateValuationSetting>("realEstateValuation");
    const flows: Flow[] = [];
    const properties: HousingValuationOutput["properties"][number][] = [];
    const growthOf = (y: number): Rate => ctx.assumptionIn("realEstateValuation", "landGrowth", y) ?? ctx.assumption("inflation", y, RATE_ZERO);
    for (const h of ctx.list<ResidenceInput>("residence")) {
      if (h.kind !== "own") continue;
      const owner = h.ownership?.[0]?.member ?? null;
      const v = h.valuation;
      const given = v?.value === undefined ? null : boxValue(v.value);
      const purchaseAt: MonthIndex | null = h.purchase === undefined ? null : ctx.time.resolve(h.purchase.at ?? h.from);
      const basis: Yen | null = given ?? h.purchase?.price ?? null;
      if (basis === null) {
        ctx.notice("N_INPUT_REQUIRED", [h.id, "residence.valuation"]);
        continue;
      }
      const asOf: MonthIndex = v?.asOf !== undefined ? ctx.time.resolve({ at: v.asOf }) : (purchaseAt ?? base);
      // 注文住宅の土地（改訂3。0115）: 評価の基にする額が購入の価格なら、土地は土地の代金のまま（割合で分けない）。土地の決済の月から持つ
      const land = h.purchase?.land;
      const landAt: MonthIndex | null = land === undefined ? null : ctx.time.resolve(land.at);
      const byLand = land !== undefined && given === null;
      // 持っている期間: 購入の月（購入が無ければ住み始め。注文住宅は土地の決済の月が早ければその月）から住み終わりの月まで
      const bought: MonthIndex = purchaseAt ?? ctx.time.resolve(h.from);
      const from: MonthIndex = landAt !== null && landAt < bought ? landAt : bought;
      const to: MonthIndex | null = h.to === null ? null : ctx.time.resolve(h.to);
      const y0 = yearOf(asOf);
      const share = v?.landShare ?? setting?.landShare;
      if (share === undefined && !byLand) ctx.notice("N_DEFAULT_USED", [h.id, "residence.valuation.landShare"]);
      const valuer = landBuildingValuer(ctx, {
        basis,
        y0,
        share: share ?? String(ctx.estimate(LAND_SHARE)),
        structure: v?.structure ?? "wood",
        builtYear: v?.builtYear ?? y0,
        setting,
        growthOf,
        ...(byLand && land !== undefined ? { landAmount: land.price } : {}),
      });
      // 建物が建つ（引き渡しの）年より前の年末は、土地だけ持つ（注文住宅の土地の決済から引き渡しまで）
      const builtFrom = yearOf(bought);
      // 評価する年: 持ち始めの年（計算基準年より前なら計算基準年）から、住み終わりの年（売るならその前の年）か表の最後の年まで
      const sold = h.sale !== undefined && to !== null && to <= end;
      const lastHeld = to === null || to > end ? endYear : yearOf(to);
      const firstYear = Math.max(baseYear, yearOf(from));
      const years: { year: number; land: Yen; building: Yen; value: Yen }[] = [];
      for (let y = firstYear; y <= lastHeld; y++) {
        if (sold && y === lastHeld) break;
        const lb = valuer.at(y);
        const building = y < builtFrom ? yen(0) : lb.building;
        years.push({ year: y, land: lb.land, building, value: addYen(lb.land, building) });
      }
      let sale: HousingValuationOutput["properties"][number]["sale"] = null;
      if (sold && to !== null && to >= base && yearOf(to) >= yearOf(from)) {
        const y = yearOf(to);
        const lb = valuer.at(y);
        const value = addYen(lb.land, lb.building);
        const price = h.sale?.price ?? value;
        const costs = ctx.money.mulRate(price, ctx.rate.of(h.sale?.costRate ?? setting?.saleCostRate ?? String(ctx.estimate(SALE_COST_RATE))), R);
        const proceeds = yen(Math.max(0, price - costs));
        const taxBox = h.sale?.tax;
        const tax = taxBox === undefined ? yen(0) : (boxValue(taxBox) ?? yen(0));
        sale = { ym: formatYm(to), value, price, costs, proceeds, tax };
        if (proceeds > 0) flows.push({ row: "cf.income.lumpSum.realEstateSale", ym: formatYm(to), amount: proceeds, accrualYear: y, ...(owner === null ? {} : { member: owner }), object: h.id, formula: "housing.valuation.sale" });
        if (tax > 0) {
          // 所得税と住民税の行に、長期譲渡の税率の比（所得税15.315%・住民税5%）で分ける（表の行のため。合計は入れた額のまま）
          const [incomePart, residentPart] = ctx.money.allocate(tax, [15315, 5000], "conv.tax.allocate", "first") as [Yen, Yen];
          const at = { ym: formatYm(to), accrualYear: y, ...(owner === null ? {} : { member: owner }), object: h.id, formula: "housing.valuation.saleTax" };
          flows.push({ row: "cf.taxSi.incomeTax.realEstateSale", amount: incomePart, ...at }, { row: "cf.taxSi.residentTax.realEstateSale", amount: residentPart, ...at });
        }
        if (taxBox === undefined) ctx.notice("N_NOT_SUPPORTED", ["residence.saleTax"]);
      } else if (to !== null && to < end && h.sale === undefined) ctx.notice("N_NOT_SUPPORTED", ["residence.sale"]);
      properties.push({ object: h.id, owner, years, sale });
    }
    return { flows, properties };
  },
});

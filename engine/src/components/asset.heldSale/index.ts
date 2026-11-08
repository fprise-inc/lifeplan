// 貸していない不動産（不動産の器のうち中身 property の無いもの）・その他の資産（otherAsset）の売る予定（accounts[].sale。0123）。
// - 売る月に、売却価格（省略はその年の年末の評価額）から売却の費用（割合 sale.costRate。省略は、不動産は前提 realEstateValuation.saleCostRate
//   か目安 0.04、その他の資産は0）を引いた手取りを、名義の人の一時金の収入にする（不動産は cf.income.lumpSum.realEstateSale、その他の資産は
//   cf.income.lumpSum.other）。売った年の年末からは持っていない（plan.cashflow が評価額の行を出さない。バランスシートで二重に数えない）
// - 年末の評価額は plan.cashflow と同じ決まり: 器の時価に、その年の利回り（評価額の増減率 valueGrowth。無ければ、不動産は資産クラスの利回り、
//   その他の資産は資産の配分が無ければ0）を、計算基準年は残りの月数で掛けて足していく（annualReturn。年の途中の出入りは無い）。前提の
//   時価の下落（marketShocks）で種類を書いて不動産・その他の資産を下げる年は、同じく年末に下げる
// - 売ったときの税（どれも売る予定を入れた器だけ）:
//   - 不動産は土地建物等の譲渡所得（分離課税。tax.realEstateSale が収益不動産と合わせて名義の人×年で足す）。取得費＝取得価額（costBasis）。
//     概算取得費（売却価格×incomeTax.landBuilding.estimatedCostRate）のほうが大きければそれ。取得価額が無ければ概算取得費（知らせ N_ASSUMED
//     heldAsset.saleEstimatedCost）。所有期間は、取得の年（acquiredAt）が売った年の（holdingYears＋1）年前以前なら長期。取得の年月が無ければ
//     長期とみなす（知らせ N_ASSUMED heldAsset.saleHoldingLong）。建物のある不動産（細目が土地・山林や農地でないもの）で取得価額を使ったときは、
//     建物の価値の減り（非業務用の減価）を取得費から引いていない（知らせ N_NOT_SUPPORTED heldAsset.saleBuildingDepreciation）
//   - その他の資産は税の扱い（sale.taxation。省略は中身から: 敷金・保証金は非課税、ほかは総合課税の譲渡所得）:
//     - 総合課税の譲渡所得（transfer）: 譲渡益＝売却価格−（取得費＋売却の費用）。取得費は不動産と同じ形（概算取得費は
//       incomeTax.transferIncome.estimatedCostRate。所得税基本通達38-16）。所有期間は、取得の月から売る月までが（holdingYears×12）か月を
//       超えれば長期（所得税法33条3項。日は分からないので、ちょうどの月は短期とみなす）。tax.totalIncome が名義の人×年で短期・長期に分け、
//       特別控除（50万円）を引き、長期は2分の1を総所得金額に入れる
//     - 雑所得（miscellaneous）: 売却価格−（取得価額＋売却の費用）を tax.totalIncome が公的年金等以外の雑所得に足す。取得価額が無ければ0とみなす
//       （知らせ N_ASSUMED heldAsset.saleCostMissing）
//     - 非課税（nonTaxable）: 税をかけない（生活に通常必要な動産〔1個・1組30万円以下の貴金属・美術品など。所得税法9条1項9号・施行令25条〕、
//       敷金・保証金が返ってくる分など）
// - 売る月が計算基準月より前なら、もう売ったとみなして手取りも税も出さない（評価額は計算基準年から出さない）。表の最後の月より後は売らない
// - 改訂2（0123 の追記 2026-11-05）: 持ち始める時点（accounts[].holdFrom）より前の月に売る予定は、売らない（まだ持っていない。評価額も plan.cashflow が
//   持ち始めた年の年末から載せる）。持ち始める時点の無い世帯の結果は同じ
// - 改訂3（0137）: 預金の利回り（assumptions.depositReturn）を読む。預金・外貨預金の資産クラス（cash.deposit・cash.foreign）が前提の資産クラスごとの利回りに無いときの利回り（省略は運用利回りで、前の要求は今までどおり。0137）
import {
  accountMixAt,
  accountReturnRate,
  annualReturn,
  boxValue,
  defineComponent,
  formatYm,
  monthIndex,
  monthOf,
  RATE_ZERO,
  SALE_COST_RATE,
  shockShare,
  yearOf,
  yen,
  type AccountInput,
  type Flow,
  type HeldSaleOutput,
  type MarketShock,
  type Rate,
  type RealEstateValuationSetting,
} from "../../sdk/index.ts";

const P = {
  landHolding: "incomeTax.landBuilding.longTerm.holdingYears",
  landEstimated: "incomeTax.landBuilding.estimatedCostRate",
  holding: "incomeTax.transferIncome.longTerm.holdingYears",
  estimated: "incomeTax.transferIncome.estimatedCostRate",
};
const VAL = "conv.asset.valuation";
/** 建物の無い貸していない不動産の細目（非業務用の減価の知らせを出さない） */
const NO_BUILDING: ReadonlySet<string> = new Set(["vacantLand", "forestFarm"]);
/** その他の資産の中身ごとの、売ったときの税の扱いの既定（書いていない中身は総合課税の譲渡所得） */
const TAXATION_OF: Readonly<Record<string, "nonTaxable">> = { securityDeposit: "nonTaxable" };

/** 売る予定を読む器か（貸していない不動産・その他の資産） */
export const isHeldAsset = (a: Pick<AccountInput, "kind" | "property">): boolean => (a.kind === "realEstate" && a.property === undefined) || a.kind === "otherAsset";

/** その他の資産の売ったときの税の扱い（sale.taxation。省略は中身から） */
export function heldSaleTaxation(a: Pick<AccountInput, "subtype" | "sale">): "transfer" | "nonTaxable" | "miscellaneous" {
  return a.sale?.taxation ?? (a.subtype !== undefined ? TAXATION_OF[a.subtype] : undefined) ?? "transfer";
}

export default defineComponent<Record<string, never>, HeldSaleOutput>({
  id: "asset.heldSale",
  title: "貸していない不動産・その他の資産の売却",
  contract: "1.0",
  revision: 4,
  requires: {},
  params: Object.values(P),
  reads: [
    "account.kind",
    "account.subtype",
    "account.owner",
    "account.marketValue",
    "account.costBasis",
    "account.assetMix",
    "account.valueGrowth",
    "account.expectedReturn",
    "account.returnStages",
    "account.returnExceptions",
    "account.fee",
    "account.property",
    "account.acquiredAt",
    "account.sale",
    "account.holdFrom",
    "assumptions.investmentReturn",
    "assumptions.assetReturns",
    "assumptions.depositReturn",
    "assumptions.marketShocks",
    "assumptions.investment",
    "assumptions.returnShifts",
    "assumptions.realEstateValuation",
  ],
  input: "empty.input",
  output: "asset.heldSale.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const flows: Flow[] = [];
    const sales: HeldSaleOutput["sales"][number][] = [];
    const setting = ctx.setting<RealEstateValuationSetting>("realEstateValuation");
    const shocks = ctx.setting<readonly MarketShock[]>("marketShocks") ?? [];
    for (const a of ctx.list<AccountInput>("account")) {
      if (!isHeldAsset(a) || a.sale === undefined) continue;
      const saleAt = ctx.time.resolve(a.sale.at);
      if (saleAt < base || saleAt > end) continue;
      if (a.holdFrom !== undefined && saleAt < ctx.time.resolve(a.holdFrom)) continue;
      const y = yearOf(saleAt);
      const estate = a.kind === "realEstate";
      // その年の年末の評価額（plan.cashflow の年末の残高と同じ決まり）
      const rateOf = (yy: number): Rate => {
        if (a.valueGrowth !== undefined) return ctx.rate.of(a.valueGrowth);
        if (!estate && a.assetMix === undefined) return RATE_ZERO;
        return accountReturnRate(ctx, a, yy);
      };
      let value = boxValue(a.marketValue) ?? yen(0);
      for (let yy = baseYear; yy <= y; yy++) {
        const months = yy === baseYear ? 13 - monthOf(base) : 12;
        value = yen(value + annualReturn(ctx, value, yen(0), rateOf(yy), months));
        for (const sh of shocks) {
          if (sh.year !== yy || sh.kinds === undefined || !sh.kinds.includes(a.kind) || value <= 0) continue;
          const mix = accountMixAt(ctx, a, yy);
          const share = shockShare(ctx, { kind: a.kind, ...(mix !== undefined ? { assetMix: mix } : {}) }, sh.assetClasses);
          if (share === null) continue;
          value = yen(value - ctx.money.mulRate(value, ctx.rate.mul(ctx.rate.of(sh.drop), share), "conv.investment.return"));
        }
      }
      const price = a.sale.price ?? value;
      const costRate = a.sale.costRate ?? (estate ? (setting?.saleCostRate ?? String(ctx.estimate(SALE_COST_RATE))) : "0");
      const costs = ctx.money.mulRate(price, ctx.rate.of(costRate), VAL);
      const proceeds = yen(Math.max(0, price - costs));
      if (proceeds > 0) flows.push({ row: estate ? "cf.income.lumpSum.realEstateSale" : "cf.income.lumpSum.other", ym: formatYm(saleAt), amount: proceeds, accrualYear: y, member: a.owner, object: a.id, formula: "asset.heldSale.sale" });
      const taxation: HeldSaleOutput["sales"][number]["taxation"] = estate ? "landBuilding" : heldSaleTaxation(a);
      const entry = { object: a.id, owner: a.owner, kind: a.kind as "realEstate" | "otherAsset", ym: formatYm(saleAt), value, price, costs, proceeds, taxation };
      if (taxation === "nonTaxable") {
        sales.push(entry);
        continue;
      }
      const at0 = ctx.at(monthIndex(y, 1));
      const basis = a.costBasis === undefined ? null : boxValue(a.costBasis);
      const acquired = a.acquiredAt === undefined ? null : ctx.time.resolve({ at: a.acquiredAt });
      if (taxation === "miscellaneous") {
        if (basis === null) ctx.notice("N_ASSUMED", [a.id, "heldAsset.saleCostMissing"]);
        const acquisitionCost = basis ?? yen(0);
        sales.push({ ...entry, acquisitionCost, estimated: false, gain: yen(price - acquisitionCost - costs) });
        continue;
      }
      // 譲渡所得（不動産は分離課税、その他の資産は総合課税）の取得費と所有期間
      const estRate = at0.paramRate(estate ? P.landEstimated : P.estimated);
      if (estRate === null) ctx.notice("N_PARAM_MISSING", [estate ? P.landEstimated : P.estimated]);
      const estimatedCost = estRate === null ? yen(0) : ctx.money.mulRate(price, estRate, VAL);
      let acquisitionCost = estimatedCost;
      let estimated = true;
      if (basis !== null && basis >= estimatedCost) {
        acquisitionCost = basis;
        estimated = false;
      }
      if (basis === null) ctx.notice("N_ASSUMED", [a.id, "heldAsset.saleEstimatedCost"]);
      if (estate && !estimated && (a.subtype === undefined || !NO_BUILDING.has(a.subtype))) ctx.notice("N_NOT_SUPPORTED", [a.id, "heldAsset.saleBuildingDepreciation"]);
      let term: "long" | "short" = "long";
      if (acquired === null) ctx.notice("N_ASSUMED", [a.id, "heldAsset.saleHoldingLong"]);
      else {
        const years = at0.paramCount(estate ? P.landHolding : P.holding);
        if (years === null) ctx.notice("N_PARAM_MISSING", [estate ? P.landHolding : P.holding]);
        const n = years ?? 5;
        // 不動産は売った年の1月1日で数える（措置法31条）。その他の資産は売る日まで（所得税法33条3項。月で数え、ちょうどの月は短期）
        term = estate ? (yearOf(acquired) <= y - n - 1 ? "long" : "short") : saleAt - acquired > n * 12 ? "long" : "short";
      }
      sales.push({ ...entry, acquisitionCost, estimated, gain: yen(price - acquisitionCost - costs), term });
    }
    return { flows, sales };
  },
});

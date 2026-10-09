// 住まい（賃貸・持ち家）のお金の動き。住まいの期間（from〜to）の月だけ。
// - 家賃: 毎月。更新の月（住み始めから renewalEveryMonths ごと。既定24か月）に更新料（家賃×renewalFee か月分）を払い、家賃に上昇率を当てる
// - 購入: 購入の月（省略は住み始め）に頭金と諸費用を払う。親・祖父母からの資金援助は受け取る構成員の一時金の収入にする
//   （贈与税・住宅取得等資金の非課税は贈与の作業で扱う。ここは額の入力まで）
// - 固定資産税・都市計画税: 年額（上昇率は計算基準年からの年ごと）を、その年の4月・7月・12月と翌年2月の4回に分ける（端数は最初の回）。
//   持ち家の期間の年だけ。地域ごとの値は持たない（入力の額）
// - 修繕費・管理費: 月額（上昇率は計算基準年からの年ごと）
// 持ち家の価額（不動産の残高）は plan.cashflow が購入の額から出す（properties）
import {
  addMonths,
  boxValue,
  defineComponent,
  formatYm,
  monthIndex,
  yearOf,
  yen,
  type Ctx,
  type Flow,
  type MonthIndex,
  type Rate,
  type ResidenceInput,
  type ResidenceOutput,
  type Yen,
} from "../../sdk/index.ts";

/** 額に（1＋率）を k 回当てた額（1回ごとに円未満切り捨て） */
function grown(ctx: Ctx, amount: Yen, r: Rate | null, k: number): Yen {
  let v = amount;
  if (r === null) return v;
  for (let i = 0; i < k; i++) v = yen(v + ctx.money.mulRate(v, r, "conv.housing.growth"));
  return v;
}

export default defineComponent<Record<string, never>, ResidenceOutput>({
  id: "housing.residence",
  title: "住まい（家賃・購入・固定資産税・修繕費）",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: [],
  reads: [
    "residence.kind",
    "residence.from",
    "residence.to",
    "residence.rent",
    "residence.purchase",
    "residence.propertyTax",
    "residence.maintenance",
    "residence.ownership",
  ],
  input: "empty.input",
  output: "housing.residence.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const flows: Flow[] = [];
    const properties: ResidenceOutput["properties"][number][] = [];
    for (const h of ctx.list<ResidenceInput>("residence")) {
      const from = ctx.time.resolve(h.from);
      const to: MonthIndex = h.to === null ? end : ctx.time.resolve(h.to);
      const owner = h.ownership?.[0]?.member ?? null;
      const push = (m: MonthIndex, row: string, amount: Yen, formula: string, member: string | null = owner, accrualYear = yearOf(m)) => {
        if (amount <= 0 || m < base || m > end) return;
        flows.push({ row, ym: formatYm(m), amount, accrualYear, ...(member === null ? {} : { member }), object: h.id, formula });
      };
      const growth = (g: string | undefined) => (g === undefined ? null : ctx.rate.of(g));
      if (h.kind === "rent" && h.rent !== undefined) {
        const monthly0 = boxValue(h.rent.monthly) ?? yen(0);
        const every = h.rent.renewalEveryMonths ?? 24;
        const g = growth(h.rent.growth);
        const fee = h.rent.renewalFee === undefined ? null : ctx.rate.of(h.rent.renewalFee);
        let rent = monthly0;
        for (let m = from, k = 0; m <= to && m <= end; m = addMonths(m, 1), k++) {
          if (k > 0 && k % every === 0) {
            if (fee !== null) push(m, "cf.expense.housing.rent.renewal", ctx.money.mulRate(rent, fee, "conv.housing.growth"), "housing.residence.renewalFee");
            rent = grown(ctx, rent, g, 1);
          }
          push(m, "cf.expense.housing.rent", rent, "housing.residence.rent");
        }
      }
      if (h.kind !== "own") continue;
      if (h.purchase !== undefined) {
        const at = h.purchase.at === undefined ? from : ctx.time.resolve(h.purchase.at);
        push(at, "cf.expense.housing.purchase.downPayment", h.purchase.downPayment, "housing.residence.downPayment");
        push(at, "cf.expense.housing.purchase.costs", h.purchase.costs, "housing.residence.purchaseCosts");
        const gifts = h.purchase.gifts ?? [];
        for (const gf of gifts) push(at, "cf.income.lumpSum.gift", gf.amount, "housing.residence.gift", gf.recipient);
        if (gifts.some((gf) => gf.amount > 0)) ctx.notice("N_NOT_SUPPORTED", ["giftTax"]);
        properties.push({ object: h.id, owner, from: formatYm(at), to: h.to === null ? null : formatYm(to), price: h.purchase.price });
      }
      // 固定資産税（持ち家の期間の年。年額を4回に分ける）
      if (h.propertyTax !== undefined) {
        const annual0 = boxValue(h.propertyTax.annual) ?? yen(0);
        const g = growth(h.propertyTax.growth);
        let amount = annual0;
        for (let y = baseYear; y <= yearOf(to); y++) {
          if (y > baseYear) amount = grown(ctx, amount, g, 1);
          if (y < yearOf(from)) continue;
          const months = [monthIndex(y, 4), monthIndex(y, 7), monthIndex(y, 12), monthIndex(y + 1, 2)];
          const parts = ctx.money.allocate(amount, [1, 1, 1, 1], "conv.premium.installment", "first");
          months.forEach((m, i) => push(m, "cf.expense.housing.propertyTax", parts[i] as Yen, "housing.residence.propertyTax", owner, y));
        }
      }
      // 修繕費・管理費
      if (h.maintenance !== undefined) {
        const g = growth(h.maintenance.growth);
        let monthly = boxValue(h.maintenance.monthly) ?? yen(0);
        let year = baseYear;
        for (let m = from > base ? from : base; m <= to && m <= end; m = addMonths(m, 1)) {
          while (year < yearOf(m)) {
            monthly = grown(ctx, monthly, g, 1);
            year++;
          }
          push(m, "cf.expense.housing.maintenance", monthly, "housing.residence.maintenance");
        }
      }
    }
    return { flows, properties };
  },
});

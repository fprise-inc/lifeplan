// 住まい（賃貸・持ち家）のお金の動き。住まいの期間（from〜to）の月だけ。
// - 家賃: 毎月。更新の月（住み始めから renewalEveryMonths ごと。既定24か月）に更新料（家賃×renewalFee か月分）を払う。上昇率は年率で、
//   更新の月に、住み始めからの経った年数（1年未満は切り捨て）のうち前の更新から増えた年数の分だけ、1年ずつ重ねる（改訂3。前は更新1回に1年分だけ当てていた）。
//   計算基準月より前に住み始めた賃貸は、入れた家賃を計算基準月の今の家賃とみなし、計算基準月より後の更新からだけ上げ下げする
//   （改訂4。住み始めから計算基準月までの更新〔計算基準月ちょうどの更新を含む〕は入れた額に織り込み済みで重ねない。計算基準月の後の最初の更新は、
//   今の家賃が前の更新〔計算基準月より前のこともある〕で決まった額なので、その更新の間の年数分をそのまま当てる。前は住み始めの家賃とみなして過去の更新の分も重ねていた）
// - 購入: 購入の月（省略は住み始め）に頭金と諸費用を払う。親・祖父母からの資金援助は受け取る構成員の一時金の収入にする
//   （贈与税・住宅取得等資金の非課税は贈与の作業で扱う。ここは額の入力まで）
// - 固定資産税・都市計画税: 年額（上昇率は計算基準年からの年ごと）を、その年の4月・7月・12月と翌年2月の4回に分ける（端数は最初の回）。
//   持ち家の期間の年だけ。地域ごとの値は持たない（入力の額）
// - 修繕費・管理費: 月額（上昇率は計算基準年からの年ごと）
// 持ち家の価額（不動産の残高）は plan.cashflow が購入の額から出す（properties）
// 段階と例外の年（改訂2。0040）: 家賃・修繕費は月ごと、固定資産税は年ごとに、元の額の代わりに段の額（割合の段は元の額×割合）を使い、
// 同じ上昇率をそのまま重ねる（家賃は住み始め〔計算基準月より前に住み始めた賃貸は計算基準月までの最後の更新〕から直近の更新までの経った年数、修繕費・固定資産税は計算基準年からの年数）。例外の年は、その年だけ例外の額
// （元の額と同じ基準。上昇率は重ねる。0円はその年に払わない）。更新料は更新の前の月の家賃（例外の年は当てない）×月数
import {
  addMonths,
  boxValue,
  defineComponent,
  stagedYen,
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

/** 元の基準の額ごとに、上昇率を k 回当てた額を覚えておく（段階の額ごとに1から数え直さない） */
function grower(ctx: Ctx, r: Rate | null): (amount: Yen, k: number) => Yen {
  const memo = new Map<number, Yen[]>();
  return (amount, k) => {
    let xs = memo.get(amount);
    if (xs === undefined) {
      xs = [amount];
      memo.set(amount, xs);
    }
    while (xs.length <= k) xs.push(grown(ctx, xs[xs.length - 1] as Yen, r, 1));
    return xs[k] as Yen;
  };
}

export default defineComponent<Record<string, never>, ResidenceOutput>({
  id: "housing.residence",
  title: "住まい（家賃・購入・固定資産税・修繕費）",
  contract: "1.0",
  revision: 4,
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
        const staged = stagedYen(ctx, monthly0, h.rent, "conv.housing.growth");
        // 更新 r 回目までに当てる年数（住み始めから r 回目の更新までの経った年数。1年未満は切り捨て）
        const yearsAt = (renewals: number): number => Math.floor((renewals * every) / 12);
        // 計算基準月までに済んだ更新の回数（改訂4）。入れた家賃は計算基準月の今の家賃で、これらの更新の分は織り込み済み（重ねない）。
        // 計算基準月の後に住み始める賃貸は0回（住み始めの家賃として、更新のたびに上げ下げする。前と同じ）
        const done = from < base ? Math.floor((base - from) / every) : 0;
        // 更新 r 回目までに、入れた家賃に当てる年数（計算基準月までの最後の更新〔無ければ住み始め〕から数える）
        const yearsFrom = (renewals: number): number => Math.max(0, yearsAt(renewals) - yearsAt(done));
        if (staged.plain) {
          let rent = monthly0;
          for (let m = from, k = 0; m <= to && m <= end; m = addMonths(m, 1), k++) {
            if (k > 0 && k % every === 0) {
              // 更新料は更新の前の月の家賃×月数（計算基準月ちょうどの更新は入れた家賃×月数。計算基準月より前の更新は払い済みで出さない）
              if (fee !== null) push(m, "cf.expense.housing.rent.renewal", ctx.money.mulRate(rent, fee, "conv.housing.growth"), "housing.residence.renewalFee");
              const r = k / every;
              if (r > done) rent = grown(ctx, rent, g, yearsAt(r) - yearsAt(r - 1));
            }
            push(m, "cf.expense.housing.rent", rent, "housing.residence.rent");
          }
        } else {
          // 段の額（例外の年はその額）に、計算基準月までの最後の更新（無ければ住み始め）から直近の更新までの経った年数だけ上昇率を当てる
          const up = grower(ctx, g);
          for (let m = from < base ? base : from, k = m - from; m <= to && m <= end; m = addMonths(m, 1), k++) {
            const renewals = Math.floor(k / every);
            if (k > 0 && k % every === 0 && fee !== null) push(m, "cf.expense.housing.rent.renewal", ctx.money.mulRate(up(staged.stageAt(addMonths(m, -1)), yearsFrom(renewals - 1)), fee, "conv.housing.growth"), "housing.residence.renewalFee");
            push(m, "cf.expense.housing.rent", up(staged.at(m), yearsFrom(renewals)), "housing.residence.rent");
          }
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
        const staged = stagedYen(ctx, annual0, h.propertyTax, "conv.housing.growth");
        const up = grower(ctx, g);
        let amount = annual0;
        for (let y = baseYear; y <= yearOf(to); y++) {
          if (y > baseYear) amount = grown(ctx, amount, g, 1);
          if (y < yearOf(from)) continue;
          // 段階: その年の段の額（例外の年はその額）に、計算基準年からの年数だけ上昇率を当てる
          if (!staged.plain) amount = up(staged.inYear(y), y - baseYear);
          const months = [monthIndex(y, 4), monthIndex(y, 7), monthIndex(y, 12), monthIndex(y + 1, 2)];
          const parts = ctx.money.allocate(amount, [1, 1, 1, 1], "conv.premium.installment", "first");
          months.forEach((m, i) => push(m, "cf.expense.housing.propertyTax", parts[i] as Yen, "housing.residence.propertyTax", owner, y));
        }
      }
      // 修繕費・管理費
      if (h.maintenance !== undefined) {
        const g = growth(h.maintenance.growth);
        const monthly0 = boxValue(h.maintenance.monthly) ?? yen(0);
        const staged = stagedYen(ctx, monthly0, h.maintenance, "conv.housing.growth");
        const up = grower(ctx, g);
        let monthly = monthly0;
        let year = baseYear;
        for (let m = from > base ? from : base; m <= to && m <= end; m = addMonths(m, 1)) {
          while (year < yearOf(m)) {
            monthly = grown(ctx, monthly, g, 1);
            year++;
          }
          // 段階: その月の段の額（例外の年はその額）に、計算基準年からの年数だけ上昇率を当てる
          push(m, "cf.expense.housing.maintenance", staged.plain ? monthly : up(staged.at(m), yearOf(m) - baseYear), "housing.residence.maintenance");
        }
      }
    }
    return { flows, properties };
  },
});

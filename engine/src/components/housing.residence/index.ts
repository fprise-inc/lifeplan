// 住まい（賃貸・持ち家）のお金の動き。住まいの期間（from〜to）の月だけ。
// - 家賃: 毎月。更新の月（住み始めから renewalEveryMonths ごと。既定24か月）に更新料（家賃×renewalFee か月分）を払う。上昇率は年率で、
//   更新の月に、住み始めからの経った年数（1年未満は切り捨て）のうち前の更新から増えた年数の分だけ、1年ずつ重ねる（改訂3。前は更新1回に1年分だけ当てていた）。
//   計算基準月より前に住み始めた賃貸は、入れた家賃を計算基準月の今の家賃とみなし、計算基準月より後の更新からだけ上げ下げする
//   （改訂4。住み始めから計算基準月までの更新〔計算基準月ちょうどの更新を含む〕は入れた額に織り込み済みで重ねない。計算基準月の後の最初の更新は、
//   今の家賃が前の更新〔計算基準月より前のこともある〕で決まった額なので、その更新の間の年数分をそのまま当てる。前は住み始めの家賃とみなして過去の更新の分も重ねていた）
// - 購入: 購入の月（省略は住み始め）に頭金と諸費用を払う。注文住宅（改訂5。0115）は、頭金・諸費用の内数の土地の決済の分（purchase.land）と
//   引き渡しの前の建物の代金の支払い（purchase.payments。頭金の内数）をそれぞれの月に払い、残りを購入の月（引き渡し）に払う。親・祖父母からの資金援助は受け取る構成員の一時金の収入にする
//   （贈与税・住宅取得等資金の非課税は gift.received・gift.tax が計算する。ここは額の入力まで。改訂6: 前は「贈与税は計算していない」と誤って知らせていた）
// - 固定資産税・都市計画税: 年額（上昇率は計算基準年からの年ごと）を、その年度の4月・7月・12月と翌年2月の4回に分ける（端数は最初の回。
//   地方税法362条の納期。条例で違う市町村〔東京23区は6月・9月・12月・2月など〕は見分けない）。地域ごとの値は持たない（入力の額）。
//   改訂8（0112 の追記 2026-11-14）: 年度の税は、その年の1月1日（賦課期日。地方税法359条）に持っている人が払う（343条）。買う家（purchase の
//   ある家）は、手に入れた月（purchase.at、無ければ住み始め）の年の年度を、その月に、その月から12月までの月割り（年額×(13−月)÷12）で売主との
//   精算として払い、翌年の年度から4回に分けて払う（前は買った年の4月・7月など、買う前の月にも4回分を付けていた）。購入の無い今の持ち家
//   （住み始めが計算基準月以前）は、前から持っているとみなす。購入の無いこれからの家（相続など）は、住み始めの年の年度の住み始め以後の納期から
//   （相続した人は納税の義務を引き継ぐ。地方税法9条）。手放す年（住み終わりの年）の年度は全部払う。計算基準月が1〜2月なら、前の年度の
//   4回目（2月）も払う（前は落ちていた）
// - 修繕費・管理費: 月額（上昇率は計算基準年からの年ごと）
// 持ち家の価額（不動産の残高）は plan.cashflow が購入の額から出す（properties）
// 段階と例外の年（改訂2。0040）: 家賃・修繕費は月ごと、固定資産税は年ごとに、元の額の代わりに段の額（割合の段は元の額×割合）を使い、
// 同じ上昇率をそのまま重ねる（家賃は住み始め〔計算基準月より前に住み始めた賃貸は計算基準月までの最後の更新〕から直近の更新までの経った年数、修繕費・固定資産税は計算基準年からの年数）。例外の年は、その年だけ例外の額
// （元の額と同じ基準。上昇率は重ねる。0円はその年に払わない）。更新料は更新の前の月の家賃（例外の年は当てない）×月数
// 改訂7（0173）: 固定資産税・維持費・購入の費用などのお金の動きは、名義の人（持分の最初の人）が万一の想定で亡くなった月の翌月から、相続する人（死亡の当時の配偶者。いなければ子を等分）の名にする（sdk の inheritFlows）
// 改訂9（0224）: 住宅購入の予定の火災保険・地震保険（purchase.homeInsurance）。購入の月（注文住宅は引き渡しの月）に years 年分の保険料を払い、
//   その後は years 年ごとに払う（住み終わりの月より前の更新まで。住み終わりの月の更新は払わない）。計算の最後の年をまたぐ更新も years 年分を払い、
//   売るときの解約の返れい金は入れない。保険料は伸ばさない（入れた額のまま）。countedInInsurance（本当の契約を保険の入力項目で入れた）なら払わない。
//   地震保険の分は、払った人・月・額・年数を earthquakePremiums に出す（tax.deductions が地震保険料控除に、年数で割った額を毎年入れる。
//   計算基準月より前に払った分も、その後の年の控除のために出す）。購入の予定に homeInsurance が無い世帯の結果は同じ
import {
  inheritFlows,
  addMonths,
  boxValue,
  defineComponent,
  stagedYen,
  formatYm,
  monthIndex,
  monthOf,
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
  title: "住まい（家賃・購入・固定資産税・修繕費・火災保険）",
  contract: "1.1",
  revision: 9,
  requires: { "contingency.event": ">=1 <2" },
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
    // 地震保険料（控除のため。計算基準月より前の支払いも。払った人は inheritFlows で万一の後の相続人に）
    const quakes: Flow[] = [];
    const quakeYears = new Map<string, number>();
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
        // 注文住宅（改訂5。0115）: 頭金と諸費用の内数を、土地の決済の月と、引き渡しの前の建物の代金の支払いの月に払い、残りを購入の月（引き渡し）に払う。
        // 内数の合計が頭金・諸費用を超える分は、早い支払いから順に合計で止める（知らせ N_LIMIT_APPLIED residence.purchase.split）
        let down = h.purchase.downPayment;
        let costs = h.purchase.costs;
        let limited = false;
        const take = (want: Yen | undefined, left: Yen): Yen => {
          const w = want ?? yen(0);
          if (w > left) limited = true;
          return w > left ? left : w;
        };
        const land = h.purchase.land;
        if (land !== undefined) {
          const landAt = ctx.time.resolve(land.at);
          const d = take(land.downPayment, down);
          down = yen(down - d);
          push(landAt, "cf.expense.housing.purchase.downPayment", d, "housing.residence.landDownPayment");
          const c = take(land.costs, costs);
          costs = yen(costs - c);
          push(landAt, "cf.expense.housing.purchase.costs", c, "housing.residence.landCosts");
        }
        const pays = (h.purchase.payments ?? []).map((p, i) => ({ m: ctx.time.resolve(p.at), amount: p.amount, i })).sort((a, b) => a.m - b.m || a.i - b.i);
        for (const p of pays) {
          const d = take(p.amount, down);
          down = yen(down - d);
          push(p.m, "cf.expense.housing.purchase.downPayment", d, "housing.residence.buildingPayment");
        }
        if (limited) ctx.notice("N_LIMIT_APPLIED", ["residence.purchase.split"]);
        push(at, "cf.expense.housing.purchase.downPayment", down, "housing.residence.downPayment");
        push(at, "cf.expense.housing.purchase.costs", costs, "housing.residence.purchaseCosts");
        const gifts = h.purchase.gifts ?? [];
        for (const gf of gifts) push(at, "cf.income.lumpSum.gift", gf.amount, "housing.residence.gift", gf.recipient);
        // 火災保険・地震保険（改訂9。0224）: 購入の月から years 年ごと。住み終わりの月より前の更新まで（住み終わりの無い家は計算の最後まで）
        const ins = h.purchase.homeInsurance;
        if (ins !== undefined && ins.countedInInsurance !== true && ins.years >= 1) {
          const fire = boxValue(ins.fire) ?? yen(0);
          const quake = boxValue(ins.earthquake) ?? yen(0);
          quakeYears.set(h.id, ins.years);
          for (let m = at, k = 0; m <= end && (k === 0 || h.to === null || m < to); m = addMonths(m, ins.years * 12), k++) {
            push(m, "cf.expense.housing.insurance", fire, "housing.residence.fireInsurance");
            push(m, "cf.expense.housing.insurance", quake, "housing.residence.earthquakeInsurance");
            if (quake > 0) quakes.push({ row: "cf.expense.housing.insurance", ym: formatYm(m), amount: quake, accrualYear: yearOf(m), ...(owner === null ? {} : { member: owner }), object: h.id, formula: "housing.residence.earthquakeInsurance" });
          }
        }
        properties.push({ object: h.id, owner, from: formatYm(at), to: h.to === null ? null : formatYm(to), price: h.purchase.price });
      }
      // 固定資産税（持ち家の期間の年。年額を4回に分ける）
      if (h.propertyTax !== undefined) {
        const annual0 = boxValue(h.propertyTax.annual) ?? yen(0);
        const g = growth(h.propertyTax.growth);
        const staged = stagedYen(ctx, annual0, h.propertyTax, "conv.housing.growth");
        const up = grower(ctx, g);
        // 最初の年度（改訂8）: 買う家は、手に入れた年の年度は1月1日の持ち主（売主）の税で、引き渡しの月に、その月から12月までの月割りを売主との
        // 精算として払い（0112 の2。設計の記録の「購入の年の額は引き渡しの精算の目安」）、翌年の年度から4回に分けて払う。購入の無い今の持ち家は前から
        // 持っているとみなす。購入の無いこれからの家（相続など）は、住み始めの年の年度の、住み始め以後の納期から（相続した人は納税の義務を引き継ぐ。地方税法9条）
        const acquired = h.purchase === undefined ? null : h.purchase.at === undefined ? from : ctx.time.resolve(h.purchase.at);
        const firstYear = acquired !== null ? yearOf(acquired) : from <= base ? baseYear - 1 : yearOf(from);
        const firstMonth = acquired === null && from > base ? from : base;
        // 計算基準年より前の年度（1〜2月の分だけ表に入る）は計算基準年の額
        for (let y = Math.max(baseYear - 1, firstYear); y <= yearOf(to); y++) {
          const k = Math.max(0, y - baseYear);
          // 段階: その年の段の額（例外の年はその額）に、計算基準年からの年数だけ上昇率を当てる
          const amount = staged.plain ? up(annual0, k) : up(staged.inYear(baseYear + k), k);
          if (acquired !== null && y === yearOf(acquired)) {
            const settle = ctx.money.mulRatio(amount, 13 - monthOf(acquired), 12, "conv.expense.share");
            push(acquired, "cf.expense.housing.propertyTax", settle, "housing.residence.propertyTaxSettlement", owner, y);
            continue;
          }
          const months = [monthIndex(y, 4), monthIndex(y, 7), monthIndex(y, 12), monthIndex(y + 1, 2)];
          const parts = ctx.money.allocate(amount, [1, 1, 1, 1], "conv.premium.installment", "first");
          months.forEach((m, i) => {
            if (m >= firstMonth) push(m, "cf.expense.housing.propertyTax", parts[i] as Yen, "housing.residence.propertyTax", owner, y);
          });
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
    const earthquakePremiums = inheritFlows(ctx, quakes).flatMap((f) => (f.member === undefined ? [] : [{ member: f.member, ym: f.ym, amount: f.amount, years: quakeYears.get(f.object ?? "") ?? 1 }]));
    return { flows: inheritFlows(ctx, flows), properties, ...(earthquakePremiums.length > 0 ? { earthquakePremiums } : {}) };
  },
});

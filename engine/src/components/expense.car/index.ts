// 車のひな形（0008 の追記）: 構成員ごとの車の買い替え・ローン・車検・保険・自動車税。
// - 買い替え: 最初の購入の月から n年ごと（手放す月まで）。車両の価格（計算基準年の価格。伸び方で伸ばす）から、2回目からの購入（owned なら1回目から）は
//   下取りの額を引く。そのうちローンで借りる分（share。省略は全部）を除いた額を購入の月に払う（cf.expense.lumpSum.car）
// - 自動車ローン: 購入のたびに debt.schedule（約束の版 1.1 の loan）で返済を計算する（固定金利・購入の月の翌月から）
// - 車検: 購入から firstAfterYears 年後（省略は3年）、その後 everyYears 年ごと（省略は2年）。次の買い替え・手放す月の前まで（cf.expense.living.car）
// - 自動車保険: 年額を、持っている間の毎年の購入の月に（cf.expense.insurance.nonLife）。自動車税: 年額を、持っている間の毎年5月に（cf.expense.living.car）
// - 維持費の合計（upkeep）・駐車場代（parking）・燃料代（fuel）・内訳の名前つきの行（upkeepOther。改訂3）: 年額の12分の1を、持っている間の毎月
//   （cf.expense.living.car。改訂2）
// - 維持費の入れ方（upkeepMode。改訂3・0069）: total は合計（upkeep）だけを数え、内訳（車検・保険・税・駐車場代・燃料代・名前つきの行）は数えない。
//   detail は内訳だけを数え、合計は数えない（入れ方を切り替えても、もう片方の値は世帯に残る）。省略は前の形（入っている物を全部数える）
// - 万一のときの扱い（onContingency。改訂2）: 世帯の万一の想定（contingency.event）の月の翌月から、購入（下取りを引いた額）と維持費（車検・保険・税・
//   維持費の合計・駐車場代・燃料代）に割合を当てる（止まるは0）。それまでに組んだ自動車ローンの返済は続ける。止まるとき・割合が0のときは、その後の購入でローンを組まない
// - 買い替え（purchase.replace。改訂4・0101）: 購入の月は SDK の carPurchaseMonths（手放す月には買わない。repeat は周期ごと、none は買い替えない
//   〔これから買う車は1回だけ、今の車は乗り続ける〕、until は「○歳まで」の月まで買い替えて、その後は手放す月まで乗る）。改訂3までは手放す月にも買っていた
// - リース・長期レンタル（lease。改訂4・0101）: 月額を、始まり（from。省略は計算基準月から＝もう借りている）から手放す月まで毎月、表の行「車の維持費」に
//   （cf.expense.living.car。式 expense.car.lease）。契約の年数は表示だけ（終わっても同じ月額で続け、精算しない。月額は伸ばさない）。購入・ローン・下取りは無い。
//   月額に含む物（税・自賠責→自動車税、車検・メンテ→車検、保険→自動車保険。省略は種類の既定）は内訳から数えない（値は世帯に残る）
// 車を持っている期間は、最初の購入の月（owned なら計算基準月。リースは始まり）から手放す月まで
import {
  addMonths,
  carLeaseIncludes,
  carPurchaseMonths,
  contingencyRatio,
  defineComponent,
  formatYm,
  grownByYear,
  monthIndex,
  monthOf,
  yearOf,
  monthlyParts,
  yen,
  type CarInput,
  type CarOutput,
  type ContingencyEvent,
  type ContingencyEventOutput,
  type DebtScheduleOutput,
  type Flow,
  type MonthIndex,
  type Yen,
} from "../../sdk/index.ts";


export default defineComponent<{ member: string }, CarOutput>({
  id: "expense.car",
  title: "車（買い替え・ローン・車検・保険・自動車税）",
  contract: "1.0",
  revision: 4,
  requires: { "debt.schedule": ">=1 <2", "contingency.event": ">=1 <2" },
  params: [],
  // 買い替え（car.replace）は買い替え（car.purchase）の中の欄なので、car.purchase を読めば入る（物の中の欄の入力項目ID。0101）
  reads: ["member.kind", "car.owner", "car.purchase", "car.lease", "car.until", "car.loan", "car.inspection", "car.insurance", "car.tax", "car.upkeep", "car.parking", "car.fuel", "car.upkeepOther", "car.upkeepMode", "car.growth", "car.onContingency", "assumptions.inflation"],
  memberScope: ["car"],
  input: "member.input",
  output: "expense.car.output",
  compute(input, ctx) {
    const { base, end } = ctx.time;
    const member = input.member;
    const flows: Flow[] = [];
    const loans: { object: string; yearEnd: DebtScheduleOutput["yearEnd"] }[] = [];
    const cars = ctx.list<CarInput>("car");
    let ev: ContingencyEvent | null = null;
    if (cars.some((c) => c.onContingency !== undefined)) {
      for (const m of ctx.list<{ id: string }>("member")) {
        ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: m.id }).event;
        if (ev !== null) break;
      }
    }
    for (const c of cars) {
      const p = c.purchase;
      const lease = c.lease;
      if (p === undefined && lease === undefined) continue;
      const until: MonthIndex | null = c.until === undefined || c.until === null ? null : ctx.time.resolve(c.until);
      const last: MonthIndex = until ?? end;
      // 持ち始め: 買う車は最初の購入の月（今の車は計算基準月）、リースは始まり（省略は計算基準月）
      const first = p !== undefined ? ctx.time.resolve(p.first) : lease?.from !== undefined ? ctx.time.resolve(lease.from) : base;
      const ownedFrom = p !== undefined ? (p.owned === true ? base : first) : first < base ? base : first;
      if (last < base || ownedFrom > end) continue;
      const g = (amount: Yen) => grownByYear(ctx, amount, c.growth, yearOf(base), yearOf(end));
      // リースの月額に含む物は内訳から数えない
      const inc = p === undefined && lease !== undefined ? carLeaseIncludes(lease) : null;
      // 維持費の入れ方: 合計だけ（total）・内訳だけ（detail）・省略は入っている物を全部
      const total = c.upkeepMode !== "detail";
      const detail = c.upkeepMode !== "total";
      const inspection = c.inspection === undefined || !detail || inc?.inspectionMaintenance === true ? null : g(c.inspection.amount);
      const insurance = c.insurance === undefined || !detail || inc?.insurance === true ? null : g(c.insurance.annual);
      const tax = c.tax === undefined || !detail || inc?.taxAndCompulsory === true ? null : g(c.tax.annual);
      const monthly = [
        ...(total && c.upkeep !== undefined ? [{ formula: "expense.car.upkeep", key: "upkeep", byYear: g(c.upkeep.annual) }] : []),
        ...(detail && c.parking !== undefined ? [{ formula: "expense.car.parking", key: "parking", byYear: g(c.parking.annual) }] : []),
        ...(detail && c.fuel !== undefined ? [{ formula: "expense.car.fuel", key: "fuel", byYear: g(c.fuel.annual) }] : []),
        ...(detail ? (c.upkeepOther ?? []).map((o) => ({ formula: "expense.car.other", key: `other:${o.id}`, byYear: g(o.annual) })) : []),
      ];
      // 万一の後の割合（null はそのまま）
      const ratioAt = (m: MonthIndex) => contingencyRatio(ctx, c.onContingency, ev, m);
      const push = (m: MonthIndex, row: string, amount0: Yen, formula: string) => {
        const r = ratioAt(m);
        const amount = r === null ? amount0 : ctx.money.mulRate(amount0, r, "conv.expense.share");
        if (amount > 0 && m >= base && m <= end) flows.push({ row, ym: formatYm(m), amount, accrualYear: yearOf(m), member, object: c.id, formula });
      };
      const at = (map: Map<number, Yen> | null, m: MonthIndex) => (map === null ? yen(0) : (map.get(yearOf(m)) ?? map.get(yearOf(base)) ?? yen(0)));
      // 購入の月（手放す月には買わない。買い替えの決まりは SDK の carPurchaseMonths。0101）
      const purchases: MonthIndex[] = [];
      if (p !== undefined) {
        const price = g(p.price);
        const tradeIn = g(yen(p.tradeIn ?? 0));
        const r = p.replace;
        const replace = r === undefined || r.kind === "repeat" ? "repeat" : r.kind === "none" ? "none" : { lastAt: ctx.time.resolve(r.until) };
        purchases.push(...carPurchaseMonths({ first, everyYears: p.everyYears, owned: p.owned === true, release: until, end, replace }));
        purchases.forEach((m, k) => {
          if (m < base) return;
          const net0 = yen(Math.max(0, at(price, m) - (k > 0 || p.owned === true ? at(tradeIn, m) : 0)));
          // 万一の後の購入は割合を当てた額（止まるは0）。push でもう一度当てないよう、ここで当てた額を ratio 1 として扱う
          const rr = ratioAt(m);
          const net = rr === null ? net0 : ctx.money.mulRate(net0, rr, "conv.expense.share");
          let borrowed = yen(0);
          if (c.loan !== undefined && net > 0) {
            borrowed = c.loan.share === undefined ? net : ctx.money.mulRate(net, ctx.rate.of(c.loan.share), "conv.expense.share");
            const out = ctx.call<DebtScheduleOutput>("debt.schedule", {
              loan: {
                id: c.id,
                kind: "car",
                debtors: [{ member, role: "primary" }],
                principal: borrowed,
                start: { at: formatYm(m) },
                rateSchedule: [{ from: { at: formatYm(m) }, type: "fixed", rate: c.loan.rate }],
                repayment: { method: c.loan.method ?? "equalPayment", termMonths: c.loan.termMonths },
              },
            });
            for (const f of out.flows) flows.push(f);
            loans.push({ object: c.id, yearEnd: out.yearEnd });
          }
          const cash = yen(net - borrowed);
          if (cash > 0 && m >= base && m <= end) flows.push({ row: "cf.expense.lumpSum.car", ym: formatYm(m), amount: cash, accrualYear: yearOf(m), member, object: c.id, formula: "expense.car.purchase" });
        });
      } else if (lease !== undefined) {
        // リース・長期レンタルの月額（始まりから手放す月まで毎月。月額は伸ばさない）
        for (let m: MonthIndex = ownedFrom; m <= last && m <= end; m = addMonths(m, 1)) push(m, "cf.expense.living.car", lease.monthly, "expense.car.lease");
      }
      // 車検（購入ごとに数え直す。今の車は、次の買い替えの周期の前に買ったとみなす。リースは始まりから）
      if (inspection !== null) {
        const firstAfter = c.inspection?.firstAfterYears ?? 3;
        const every = c.inspection?.everyYears ?? 2;
        const starts: MonthIndex[] =
          p === undefined ? [first] : p.owned === true && !(purchases[0] === first && first <= base) ? [addMonths(first, -12 * p.everyYears), ...purchases] : purchases;
        starts.forEach((s0, k) => {
          const next = k + 1 < starts.length ? (starts[k + 1] as MonthIndex) : addMonths(last, 1);
          for (let m = addMonths(s0, 12 * firstAfter); m < next && m <= last; m = addMonths(m, 12 * every)) push(m, "cf.expense.living.car", at(inspection, m), "expense.car.inspection");
        });
      }
      // 保険（持っている間の毎年の購入の月）・自動車税（毎年5月）
      const anniversary = monthOf(first);
      for (let y = yearOf(ownedFrom); y <= yearOf(last); y++) {
        const im = monthIndex(y, anniversary);
        if (insurance !== null && im >= ownedFrom && im <= last) push(im, "cf.expense.insurance.nonLife", at(insurance, im), "expense.car.insurance");
        const tm = monthIndex(y, 5);
        if (tax !== null && tm >= ownedFrom && tm <= last) push(tm, "cf.expense.living.car", at(tax, tm), "expense.car.tax");
      }
      // 維持費の合計・駐車場代・燃料代（年額の12分の1を毎月。1円未満の端数は年の初めの月から1円ずつ）
      if (monthly.length > 0) {
        const parts = new Map<string, Yen[]>();
        for (let m: MonthIndex = ownedFrom < base ? base : ownedFrom; m <= last && m <= end; m = addMonths(m, 1)) {
          for (const x of monthly) {
            const key = `${x.key}|${yearOf(m)}`;
            let ps = parts.get(key);
            if (ps === undefined) {
              ps = monthlyParts(ctx, at(x.byYear, m));
              parts.set(key, ps);
            }
            push(m, "cf.expense.living.car", ps[monthOf(m) - 1] ?? yen(0), x.formula);
          }
        }
      }
    }
    return { flows, loans };
  },
});

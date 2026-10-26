// 世帯の外の家族のお金（簡易の家計。0042）: 世帯の外の家族（0035 の4）のうち、お金（member.wallet）を入れた人ごとに、計算基準月から月ごとに
//   残高 ＝ 預金（今の残高）＋その人のお金の動き（年金・給付などの収入−その人の税・社会保険料。plan.memberFlows）＋一時の入金
//          −その人の生活費−その人が介護を受ける費用（care.expense）
// を積む。介護の費用はまずこのお金から払い、払いきれない分（尽きた後）は世帯が払う（plan.flows が covered を世帯の支出から引く）。
// - 計算するのは預金（balance）を入れた人だけ（sdk の hasWallet）。預金の欄が空なら、その人のお金は見ず、介護の費用は今までどおり世帯が払う
// - 介護の費用の払う人（care.payer）は、払いきれない分を世帯のどの人の行に載せるか（と万一のときの扱い）として今のまま読む
// - 年金: 入れた額（wallet.pension。年額・額面）があれば、エンジンの推計の公的年金（cf.income.pension の下の行）の代わりに計算基準月から
//   毎月12分の1を入れる（計算基準年の額のまま）。税・社会保険料はエンジンが構成員ごとに出した額のまま（推計の年金から計算した目安）
// - 生活費: 月額（計算基準年の価格）を物価上昇率で伸ばす
// - 家計を1つにする期間（outside.periods）との関係（0035 の4 の決まりのまま、同じお金を両方の家計に入れない）:
//   収入を世帯に入れる月（income）は、その人のお金の動きは世帯に入る（plan.flows）ので、このお金に入れない。その月の介護の費用も世帯が払う
//   （家計が1つなので、今の決まりどおり）。生活費の人数に入れる月（living）は、生活費が世帯の生活費に入るので、このお金から引かない。
//   一時の入金はいつもこのお金に入る。期間の間も残高はそのまま持ち越す
// - 尽きる月: その月の入るお金を足した残高で、生活費・税・社会保険料・介護の費用を払いきれない最初の月。払いきれない介護の費用は世帯が払い、
//   残高は0円にする（生活費の足りない分は数えない）。その後も入るお金が出るお金より多い月は、また積む
// - 計算する期間: 計算基準月から、表の最後の月・亡くなる見込み（leaves）の前の月・万一の想定で亡くなる月のいちばん早い月まで
// - 改訂2（0044）: 1本のお金の行を両側で読む。世帯の出るお金の行のうち相手がこの人の行（仕送りなど。expense.periodic の支払い）は
//   このお金に入れ、世帯の入るお金の行のうち相手がこの人の行（援助など。income.flows の受け取り）はこのお金から引く（世帯の側は行のまま）。
//   収入を世帯に入れる月（家計が1つの月）は世帯の中のお金の移し替えなので読まない。このお金が尽きても、世帯が受け取る援助は行のとおり入る
import {
  addMonths,
  boxValue,
  defineComponent,
  formatYm,
  grownByYear,
  hasWallet,
  isUnder,
  monthOf,
  outsidePeriodAt,
  parseYm,
  yearOf,
  yen,
  type CareExpenseInput,
  type ContingencyEventOutput,
  type Flow,
  type FlowsResult,
  type MemberInput,
  type MonthIndex,
  type Yen,
} from "../../sdk/index.ts";

type Collected = { flows: Flow[]; net: { year: number; amount: Yen }[]; parts: (readonly Flow[])[] };

export interface OutsideWalletOutput {
  depleted: string | null;
  covered: Flow[];
}

const TWELVE = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

export default defineComponent<{ member: string }, OutsideWalletOutput>({
  id: "outside.wallet",
  title: "世帯の外の家族のお金（簡易の家計）",
  contract: "1.0",
  revision: 2,
  requires: {
    "plan.memberFlows": ">=1 <2",
    "expense.periodic": ">=1 <2",
    "income.flows": ">=1 <2",
    "care.expense": ">=1 <2",
    "contingency.event": ">=1 <2",
  },
  params: [],
  reads: ["member.wallet", "member.outside", "member.leaves", "care.member", "periodicExpense.counterparty", "incomeFlow.counterparty", "assumptions.inflation"],
  input: "member.input",
  output: "outside.wallet.output",
  compute(input, ctx) {
    const { base, end } = ctx.time;
    const m = ctx.list<MemberInput>("member").find((x) => x.id === input.member);
    const w = m?.wallet;
    if (m === undefined || w === undefined || !hasWallet(m)) return { depleted: null, covered: [] };
    // 計算する最後の月（亡くなる見込みの月の前の月・万一の想定で亡くなる月まで）
    let last = end;
    if (m.leaves !== null) {
      const lv = addMonths(ctx.time.resolve(m.leaves), -1);
      if (lv < last) last = lv;
    }
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: m.id }).event;
    if (ev !== null && ev.kind === "death" && parseYm(ev.month) < last) last = parseYm(ev.month);
    if (last < base) return { depleted: null, covered: [] };
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const add = (map: Map<MonthIndex, number>, k: MonthIndex, v: number) => map.set(k, (map.get(k) ?? 0) + v);
    // その人のお金の動き（収入は足し、税・社会保険料・支出は引く。器の間の移動は数えない）
    const own = new Map<MonthIndex, number>();
    const pension = boxValue(w.pension);
    for (const f of ctx.call<Collected>("plan.memberFlows", { member: m.id }).flows) {
      if (pension !== null && isUnder(f.row, "cf.income.pension")) continue;
      const k = parseYm(f.ym);
      if (isUnder(f.row, "cf.income")) add(own, k, f.amount);
      else if (isUnder(f.row, "cf.taxSi") || isUnder(f.row, "cf.expense")) add(own, k, -f.amount);
    }
    const pensionMonthly = pension === null ? null : ctx.money.allocate(pension, TWELVE, "conv.flow.allocate", "first");
    // 生活費（月額を物価上昇率で伸ばす）
    const livingBox = boxValue(w.living);
    const living = livingBox === null || livingBox <= 0 ? null : grownByYear(ctx, ctx.money.mulRatio(livingBox, 12, 1, "conv.exact"), undefined, baseYear, endYear);
    const livingAt = (k: MonthIndex): number => {
      if (living === null) return 0;
      const annual = living.get(yearOf(k)) ?? yen(0);
      return ctx.money.allocate(annual, TWELVE, "conv.expense.share", "first")[monthOf(k) - 1] ?? 0;
    };
    // 一時の入金
    const lump = new Map<MonthIndex, number>();
    for (const l of w.lumpSums ?? []) {
      const v = boxValue(l.amount);
      if (v !== null && v > 0) add(lump, ctx.time.resolve(l.at), v);
    }
    // 1本のお金の行を両側で読む（0044）: 世帯からこの人へ（仕送りなど）は入り、この人から世帯へ（援助など）は出る
    const rows = new Map<MonthIndex, number>();
    const toThem = new Set(ctx.list<{ id: string; counterparty?: string }>("periodicExpense").filter((e) => e.counterparty === m.id).map((e) => e.id));
    if (toThem.size > 0) for (const f of ctx.call<FlowsResult>("expense.periodic", {}).flows) if (f.object !== undefined && toThem.has(f.object)) add(rows, parseYm(f.ym), f.amount);
    const fromThem = new Set(ctx.list<{ id: string; counterparty?: string }>("incomeFlow").filter((x) => x.counterparty === m.id).map((x) => x.id));
    if (fromThem.size > 0) for (const f of ctx.call<FlowsResult>("income.flows", {}).flows) if (f.object !== undefined && fromThem.has(f.object) && !isUnder(f.row, "cf.taxSi")) add(rows, parseYm(f.ym), -f.amount);
    // この人が介護を受ける費用（月ごと。払う人の行のまま）
    const mine = new Set(ctx.list<CareExpenseInput>("care").filter((c) => c.member === m.id).map((c) => c.id));
    const care = new Map<MonthIndex, Flow[]>();
    if (mine.size > 0) {
      for (const f of ctx.call<FlowsResult>("care.expense", {}).flows) {
        if (f.object === undefined || !mine.has(f.object)) continue;
        const k = parseYm(f.ym);
        const list = care.get(k);
        if (list === undefined) care.set(k, [f]);
        else list.push(f);
      }
    }
    let balance = boxValue(w.balance) ?? 0;
    let depleted: string | null = null;
    const covered: Flow[] = [];
    for (let k = base; k <= last; k = addMonths(k, 1)) {
      const shared = outsidePeriodAt(ctx, m, k);
      const incomeShared = shared?.income === true;
      let avail = balance + (lump.get(k) ?? 0);
      if (!incomeShared) avail += (own.get(k) ?? 0) + (pensionMonthly === null ? 0 : (pensionMonthly[monthOf(k) - 1] ?? 0)) + (rows.get(k) ?? 0);
      if (shared?.living !== true) avail -= livingAt(k);
      // 収入を世帯に入れる月は、介護の費用も世帯が払う（今の決まりどおり）
      const due = incomeShared ? [] : (care.get(k) ?? []);
      const dueTotal = due.reduce((s, f) => s + f.amount, 0);
      if (avail >= dueTotal) {
        for (const f of due) covered.push(f);
        balance = avail - dueTotal;
        continue;
      }
      if (depleted === null) depleted = formatYm(k);
      let left = Math.max(avail, 0);
      for (const f of due) {
        if (left <= 0) break;
        const paid = Math.min(f.amount, left);
        covered.push({ ...f, amount: yen(paid) });
        left -= paid;
      }
      balance = 0;
    }
    return { depleted, covered };
  },
});

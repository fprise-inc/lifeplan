// 器への積立（器の間の移動）は、NISA の枠で止めた後の額で plan.cashflow が出す。
// 構成員ごとのお金の動き（plan.memberFlows）と、世帯の国民健康保険料・保険料・負債の返済（debt.schedule。1本ずつ）・
// 住まい（housing.residence）・生活費（expense.living）・周期的な支出（expense.periodic）・FP顧問料（expense.advisoryFee）・
// 教育の目標（education.cost・education.support。子ごと）・児童手当（benefit.childAllowance）・差し込み口の支出を集め、
// 年間収支（収入−税・社会保険料−支出。器の間の移動は含めない）を年ごとに出す。
// 改訂6: 持ち家の売却の手取り（housing.valuation）も集める。
// 改訂8: 保育料（education.nurseryFee。子ごと。0029）も集める。
// 改訂7: 住まい以外の不動産の家賃収入・経費・売却の手取り（asset.realEstate。0028）も集める。
// 改訂10: 世帯の外の家族（0035 の4）の構成員ごとのお金の動きは、家計を1つにする期間のうち収入を世帯に入れる期間の月の分だけ集める。
// 改訂11: 世帯の外の家族のお金（member.wallet。0042）を入れた人が介護を受ける費用は、その人のお金から払った分（outside.wallet の covered）を
//   介護の費用（care.expense）から引き、残り（尽きた後）だけを世帯の支出にする。お金を入れていない人の介護の費用は今までどおり世帯が払う。
// 改訂12（0044）: 入るお金の行（income.flows。受け取りと、譲渡所得の税）も集める。
// 改訂13（0035 の4 の追記）: 世帯の外の家族の家計を1つにする期間は、亡くなる見込み（leaves）の月で切る。期間の終わりが無くても、亡くなる
//   見込みの月からはその人のお金の動き（年金・給与・給付と、その人の税・社会保険料）を世帯に入れない（今までは表の最後まで入っていた）。
// 改訂14（0081）: 住まい以外の不動産を売ったときの譲渡所得の税（tax.realEstateSale。翌年3月の所得税・翌年度の住民税）も集める。
// 改訂5: 保険の受け取り（insurance.policy。契約ごと）・介護の費用（care.expense）・万一のときの一時のお金（contingency.lumpSum）も集める。
// 運用益・金融資産の残高（plan.cashflow）と分けるのは、運用利回りのように案の前提だけが変わったとき、集め直さずに済むようにするため（0005 の追記）。
// 構成員ごとに分けるのは、1人の入力を変えたとき、ほかの構成員の分を集め直さないため（0005・0006 の追記）。
// parts は、お金の動きを出した部品の出力の配列のまま（つなげると flows。エンジンが表の集計を部品ごとに使い回す）
import {
  addYen,
  defineComponent,
  formatYm,
  hasWallet,
  isOutside,
  monthOf,
  netByYear,
  outsideIncomeEver,
  outsidePeriodAt,
  parseYm,
  yearOf,
  yen,
  type Flow,
  type FlowsResult,
  type MemberInput,
  type PaymentsOutput,
  type Yen,
} from "../../sdk/index.ts";

type Collected = { flows: Flow[]; net: { year: number; amount: Yen }[]; parts: (readonly Flow[])[] };

export default defineComponent<Record<string, never>, Collected>({
  id: "plan.flows",
  title: "お金の動き（集める）",
  contract: "1.1",
  revision: 14,
  requires: {
    "insurance.policy": ">=1 <2",
    "care.expense": ">=1 <2",
    "outside.wallet": ">=1 <2",
    "contingency.lumpSum": ">=1 <2",
    "plan.memberFlows": ">=1 <2",
    "expense.living": ">=1 <2",
    "expense.periodic": ">=1 <2",
    "income.flows": ">=1 <2",
    "expense.advisoryFee": ">=1 <2",
    "education.cost": ">=1 <2",
    "education.support": ">=1 <2",
    "education.nurseryFee": ">=1 <2",
    "benefit.childAllowance": ">=1 <2",
    "debt.schedule": ">=1 <2",
    "housing.residence": ">=1 <2",
    "housing.valuation": ">=1 <2",
    "asset.realEstate": ">=1 <2",
    "tax.realEstateSale": ">=1 <2",
    "socialInsurance.nationalHealth": ">=1 <2",
    "socialInsurance.continuation": ">=1 <2",
    "insurance.premiumPayment": ">=1 <2",
  },
  params: [],
  reads: ["member.kind", "member.outside", "member.leaves", "member.wallet", "debt.kind", "goal.kind", "goal.owner", "insurance.policyholder"],
  slots: ["slot.expense.flow"],
  input: "empty.input",
  output: "plan.flows.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const parts: (readonly Flow[])[] = [];
    const net = new Map<number, Yen>();
    const addNet = (rows: readonly { year: number; amount: Yen }[]) => {
      for (const r of rows) net.set(r.year, addYen(net.get(r.year) ?? yen(0), r.amount));
    };
    for (const m of ctx.list<MemberInput>("member")) {
      // 世帯の外の家族（0035 の4）: 年金・給与・給付と、その人の税・社会保険料は世帯に入れない。家計を1つにする期間のうち、収入を世帯に
      // 入れる期間（income）の月の分だけ入れる
      if (isOutside(m)) {
        if (!outsideIncomeEver(m)) continue;
        const mf = ctx.call<Collected>("plan.memberFlows", { member: m.id });
        const kept = mf.parts.map((p) => p.filter((f) => outsidePeriodAt(ctx, m, parseYm(f.ym))?.income === true)).filter((p) => p.length > 0);
        for (const p of kept) parts.push(p);
        addNet([...netByYear(kept.flat(), ctx.conventions.aggregation, base, end).entries()].map(([year, amount]) => ({ year, amount })));
        continue;
      }
      const mf = ctx.call<Collected>("plan.memberFlows", { member: m.id });
      for (const p of mf.parts) parts.push(p);
      addNet(mf.net);
    }
    const household: (readonly Flow[])[] = [];
    for (let fy = monthOf(base) <= 3 ? baseYear - 1 : baseYear; fy <= endYear; fy++) {
      household.push(ctx.call<FlowsResult>("socialInsurance.nationalHealth", { fiscalYear: fy }).flows);
      household.push(ctx.call<FlowsResult>("socialInsurance.continuation", { fiscalYear: fy }).flows);
    }
    household.push(ctx.call<PaymentsOutput>("insurance.premiumPayment", {}).flows);
    for (const c of ctx.list<{ id: string }>("insurance")) household.push(ctx.call<FlowsResult>("insurance.policy", { object: c.id }).flows);
    household.push(householdCare(ctx.call<FlowsResult>("care.expense", {}).flows, ctx.list<MemberInput>("member").filter(hasWallet).flatMap((m) => ctx.call<{ covered: readonly Flow[] }>("outside.wallet", { member: m.id }).covered)));
    household.push(ctx.call<FlowsResult>("contingency.lumpSum", {}).flows);
    for (const d of ctx.list<{ id: string }>("debt")) household.push(ctx.call<FlowsResult>("debt.schedule", { object: d.id }).flows);
    household.push(ctx.call<FlowsResult>("housing.residence", {}).flows);
    household.push(ctx.call<FlowsResult>("housing.valuation", {}).flows);
    household.push(ctx.call<FlowsResult>("asset.realEstate", {}).flows);
    household.push(ctx.call<FlowsResult>("tax.realEstateSale", {}).flows);
    household.push(ctx.call<FlowsResult>("expense.living", {}).flows);
    household.push(ctx.call<FlowsResult>("expense.periodic", {}).flows);
    household.push(ctx.call<FlowsResult>("income.flows", {}).flows);
    household.push(ctx.call<FlowsResult>("expense.advisoryFee", {}).flows);
    // 教育の目標（子ごと）と、公的支援（学費とは別の部品。0010 の5）
    for (const g of ctx.list<{ kind: string; owner: string }>("goal")) {
      if (g.kind !== "education") continue;
      household.push(ctx.call<FlowsResult>("education.cost", { member: g.owner }).flows);
      household.push(ctx.call<FlowsResult>("education.support", { member: g.owner }).flows);
      household.push(ctx.call<FlowsResult>("education.nurseryFee", { member: g.owner }).flows);
    }
    household.push(ctx.call<FlowsResult>("benefit.childAllowance", {}).flows);
    for (const out of ctx.slot("slot.expense.flow", { fromMonth: formatYm(base), toMonth: formatYm(end) })) household.push(out.flows);
    const own: Flow[] = [];
    for (const p of household) {
      if (p.length === 0) continue;
      parts.push(p);
      for (const f of p) own.push(f);
    }
    addNet([...netByYear(own, ctx.conventions.aggregation, base, end).entries()].map(([year, amount]) => ({ year, amount })));
    const flows: Flow[] = [];
    for (const p of parts) for (const f of p) flows.push(f);
    return { flows, net: [...net.entries()].sort((a, b) => a[0] - b[0]).map(([year, amount]) => ({ year, amount })), parts };
  },
});

/** 介護の費用のうち世帯が払う分: 世帯の外の家族のお金から払った分（covered。行・月・物・式・払う人が同じお金の動き）を引く */
function householdCare(care: readonly Flow[], covered: readonly Flow[]): readonly Flow[] {
  if (covered.length === 0) return care;
  const key = (f: Flow) => `${f.row}|${f.ym}|${f.object ?? ""}|${f.formula}|${f.member ?? ""}`;
  const paid = new Map<string, number>();
  for (const f of covered) paid.set(key(f), (paid.get(key(f)) ?? 0) + f.amount);
  const out: Flow[] = [];
  for (const f of care) {
    const k = key(f);
    const p = Math.min(paid.get(k) ?? 0, f.amount);
    if (p > 0) paid.set(k, (paid.get(k) ?? 0) - p);
    const rest = f.amount - p;
    if (rest > 0) out.push(p > 0 ? { ...f, amount: yen(rest) } : f);
  }
  return out;
}

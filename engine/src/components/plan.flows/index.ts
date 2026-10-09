// 器への積立（器の間の移動）は、NISA の枠で止めた後の額で plan.cashflow が出す。
// 構成員ごとのお金の動き（plan.memberFlows）と、世帯の国民健康保険料・保険料・負債の返済（debt.schedule。1本ずつ）・
// 住まい（housing.residence）・生活費（expense.living）・周期的な支出（expense.periodic）・FP顧問料（expense.advisoryFee）・
// 教育の目標（education.cost・education.support。子ごと）・児童手当（benefit.childAllowance）・差し込み口の支出を集め、
// 年間収支（収入−税・社会保険料−支出。器の間の移動は含めない）を年ごとに出す。
// 改訂5: 保険の受け取り（insurance.policy。契約ごと）・介護の費用（care.expense）・万一のときの一時のお金（contingency.lumpSum）も集める。
// 運用益・金融資産の残高（plan.cashflow）と分けるのは、運用利回りのように案の前提だけが変わったとき、集め直さずに済むようにするため（0005 の追記）。
// 構成員ごとに分けるのは、1人の入力を変えたとき、ほかの構成員の分を集め直さないため（0005・0006 の追記）。
// parts は、お金の動きを出した部品の出力の配列のまま（つなげると flows。エンジンが表の集計を部品ごとに使い回す）
import {
  addYen,
  defineComponent,
  formatYm,
  monthOf,
  netByYear,
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
  revision: 5,
  requires: {
    "insurance.policy": ">=1 <2",
    "care.expense": ">=1 <2",
    "contingency.lumpSum": ">=1 <2",
    "plan.memberFlows": ">=1 <2",
    "expense.living": ">=1 <2",
    "expense.periodic": ">=1 <2",
    "expense.advisoryFee": ">=1 <2",
    "education.cost": ">=1 <2",
    "education.support": ">=1 <2",
    "benefit.childAllowance": ">=1 <2",
    "debt.schedule": ">=1 <2",
    "housing.residence": ">=1 <2",
    "socialInsurance.nationalHealth": ">=1 <2",
    "insurance.premiumPayment": ">=1 <2",
  },
  params: [],
  reads: ["member.kind", "debt.kind", "goal.kind", "goal.owner", "insurance.policyholder"],
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
      const mf = ctx.call<Collected>("plan.memberFlows", { member: m.id });
      for (const p of mf.parts) parts.push(p);
      addNet(mf.net);
    }
    const household: (readonly Flow[])[] = [];
    for (let fy = monthOf(base) <= 3 ? baseYear - 1 : baseYear; fy <= endYear; fy++) {
      household.push(ctx.call<FlowsResult>("socialInsurance.nationalHealth", { fiscalYear: fy }).flows);
    }
    household.push(ctx.call<PaymentsOutput>("insurance.premiumPayment", {}).flows);
    for (const c of ctx.list<{ id: string }>("insurance")) household.push(ctx.call<FlowsResult>("insurance.policy", { object: c.id }).flows);
    household.push(ctx.call<FlowsResult>("care.expense", {}).flows);
    household.push(ctx.call<FlowsResult>("contingency.lumpSum", {}).flows);
    for (const d of ctx.list<{ id: string }>("debt")) household.push(ctx.call<FlowsResult>("debt.schedule", { object: d.id }).flows);
    household.push(ctx.call<FlowsResult>("housing.residence", {}).flows);
    household.push(ctx.call<FlowsResult>("expense.living", {}).flows);
    household.push(ctx.call<FlowsResult>("expense.periodic", {}).flows);
    household.push(ctx.call<FlowsResult>("expense.advisoryFee", {}).flows);
    // 教育の目標（子ごと）と、公的支援（学費とは別の部品。0010 の5）
    for (const g of ctx.list<{ kind: string; owner: string }>("goal")) {
      if (g.kind !== "education") continue;
      household.push(ctx.call<FlowsResult>("education.cost", { member: g.owner }).flows);
      household.push(ctx.call<FlowsResult>("education.support", { member: g.owner }).flows);
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

// 構成員ごとに給与・事業所得・公的年金・給付・社会保険料（被用者保険・国民年金・後期高齢者医療・介護保険の第1号）・所得税・住民税を、
// 世帯で国民健康保険料・保険料・積立・差し込み口の支出を集め、年間収支（収入−税・社会保険料−支出。器の間の移動は含めない）を年ごとに出す。
// 運用益・金融資産の残高（plan.cashflow）と分けるのは、運用利回りのように案の前提だけが変わったとき、集め直さずに済むようにするため（0005 の追記）
import {
  defineComponent,
  formatYm,
  monthOf,
  netByYear,
  yearOf,
  type Flow,
  type FlowsResult,
  type MemberInput,
  type PaymentsOutput,
  type SalaryOutput,
  type TaxOutput,
  type Yen,
} from "../../sdk/index.ts";

export default defineComponent<Record<string, never>, { flows: Flow[]; net: { year: number; amount: Yen }[] }>({
  id: "plan.flows",
  title: "お金の動き（集める）",
  contract: "1.0",
  revision: 1,
  requires: {
    "income.salary": ">=1 <2",
    "income.business": ">=1 <2",
    "pension.oldAge": ">=1 <2",
    "pension.supplementaryBenefit": ">=1 <2",
    "benefit.health": ">=1 <2",
    "benefit.employment": ">=1 <2",
    "socialInsurance.nationalPension": ">=1 <2",
    "socialInsurance.nationalHealth": ">=1 <2",
    "socialInsurance.lateElderly": ">=1 <2",
    "socialInsurance.careFirst": ">=1 <2",
    "socialInsurance.health": ">=1 <2",
    "socialInsurance.pension": ">=1 <2",
    "socialInsurance.employment": ">=1 <2",
    "incomeTax.annual": ">=1 <2",
    "residentTax.annual": ">=1 <2",
    "insurance.premiumPayment": ">=1 <2",
    "account.contribution": ">=1 <2",
  },
  params: [],
  reads: ["member.kind"],
  slots: ["slot.expense.flow"],
  input: "empty.input",
  output: "plan.flows.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const flows: Flow[] = [];
    for (const m of ctx.list<MemberInput>("member")) {
      const member = m.id;
      flows.push(...ctx.call<SalaryOutput>("income.salary", { member }).flows);
      for (const c of ["income.business", "pension.oldAge", "pension.supplementaryBenefit", "benefit.health", "benefit.employment"]) {
        flows.push(...ctx.call<FlowsResult>(c, { member }).flows);
      }
      for (const c of ["socialInsurance.health", "socialInsurance.pension", "socialInsurance.employment", "socialInsurance.nationalPension"]) {
        flows.push(...ctx.call<FlowsResult>(c, { member, fromYear: baseYear }).flows);
      }
      for (let y = baseYear; y <= endYear; y++) flows.push(...ctx.call<TaxOutput>("incomeTax.annual", { member, year: y }).flows);
      // 前年度の分（計算基準年の1〜5月に払う分）から
      for (let fy = monthOf(base) <= 5 ? baseYear - 1 : baseYear; fy <= endYear; fy++) {
        flows.push(...ctx.call<TaxOutput>("residentTax.annual", { member, fiscalYear: fy }).flows);
      }
      // 年度の保険料（計算基準月の年度から。4〜5月の分は前の年度）
      for (let fy = monthOf(base) <= 3 ? baseYear - 1 : baseYear; fy <= endYear; fy++) {
        for (const c of ["socialInsurance.lateElderly", "socialInsurance.careFirst"]) flows.push(...ctx.call<FlowsResult>(c, { member, fiscalYear: fy }).flows);
      }
    }
    for (let fy = monthOf(base) <= 3 ? baseYear - 1 : baseYear; fy <= endYear; fy++) {
      flows.push(...ctx.call<FlowsResult>("socialInsurance.nationalHealth", { fiscalYear: fy }).flows);
    }
    flows.push(...ctx.call<PaymentsOutput>("insurance.premiumPayment", {}).flows);
    flows.push(...ctx.call<PaymentsOutput>("account.contribution", {}).flows);
    for (const out of ctx.slot("slot.expense.flow", { fromMonth: formatYm(base), toMonth: formatYm(end) })) flows.push(...out.flows);
    const net = [...netByYear(flows, ctx.conventions.aggregation, base, end).entries()].sort((a, b) => a[0] - b[0]).map(([year, amount]) => ({ year, amount }));
    return { flows, net };
  },
});

// 構成員1人のお金の動き（給与・事業所得・公的年金・給付・社会保険料・所得税・住民税・後期高齢者医療・介護保険の第1号・
// iDeCo・企業型DC の掛金（器の間の移動）と受け取り）を集め、
// 年間収支（収入−税・社会保険料）を年ごとに出す。plan.flows が構成員ごとに呼ぶ（0005・0006 の追記: 構成員ごとに分けておくと、
// 配偶者の入力を変えたとき、本人の分は集め直さない）。parts は集めた部品の出力の配列のまま（エンジンが表の集計を部品ごとに使い回す）
import {
  ageMonth,
  defineComponent,
  fiscalYearEnd,
  fiscalYearStart,
  monthOf,
  netByYear,
  yearOf,
  type Flow,
  type FlowsResult,
  type SalaryOutput,
  type TaxOutput,
  type Yen,
} from "../../sdk/index.ts";

/** 後期高齢者医療（socialInsurance.healthStatus と同じく計算基準月の値）・介護保険の第1号（socialInsurance.careFirst と同じく年度の初めの値）の年齢 */
const AGE = { late: "socialInsurance.health.lateElderlyAge", care: "socialInsurance.care.secondaryInsuredUntilAge" };

export default defineComponent<{ member: string }, { flows: Flow[]; net: { year: number; amount: Yen }[]; parts: (readonly Flow[])[] }>({
  id: "plan.memberFlows",
  title: "お金の動き（構成員ごとに集める）",
  contract: "1.0",
  revision: 3,
  requires: {
    "ideco.contribution": ">=1 <2",
    "account.ideco": ">=1 <2",
    "income.salary": ">=1 <2",
    "income.business": ">=1 <2",
    "pension.oldAge": ">=1 <2",
    "pension.supplementaryBenefit": ">=1 <2",
    "benefit.health": ">=1 <2",
    "benefit.employment": ">=1 <2",
    "socialInsurance.nationalPension": ">=1 <2",
    "socialInsurance.lateElderly": ">=1 <2",
    "socialInsurance.careFirst": ">=1 <2",
    "socialInsurance.health": ">=1 <2",
    "socialInsurance.pension": ">=1 <2",
    "socialInsurance.employment": ">=1 <2",
    "incomeTax.annual": ">=1 <2",
    "residentTax.annual": ">=1 <2",
  },
  params: Object.values(AGE),
  reads: [],
  input: "member.input",
  output: "plan.flows.output",
  compute(input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const member = input.member;
    const parts: (readonly Flow[])[] = [];
    parts.push(ctx.call<SalaryOutput>("income.salary", { member }).flows);
    for (const c of ["income.business", "pension.oldAge", "pension.supplementaryBenefit", "benefit.health", "benefit.employment", "ideco.contribution", "account.ideco"]) {
      parts.push(ctx.call<FlowsResult>(c, { member }).flows);
    }
    for (const c of ["socialInsurance.health", "socialInsurance.pension", "socialInsurance.employment", "socialInsurance.nationalPension"]) {
      parts.push(ctx.call<FlowsResult>(c, { member, fromYear: baseYear }).flows);
    }
    for (let y = baseYear; y <= endYear; y++) parts.push(ctx.call<TaxOutput>("incomeTax.annual", { member, year: y }).flows);
    // 前年度の分（計算基準年の1〜5月に払う分）から
    for (let fy = monthOf(base) <= 5 ? baseYear - 1 : baseYear; fy <= endYear; fy++) {
      parts.push(ctx.call<TaxOutput>("residentTax.annual", { member, fiscalYear: fy }).flows);
    }
    // 年度の保険料（計算基準月の年度から。4〜5月の分は前の年度）。後期高齢者医療は75歳の誕生日の月、介護保険の第1号は65歳に達する月を
    // 含む年度からだけ呼ぶ（その前の年度は、部品が何も残さずに空を返すので呼ばない。0005 の追記（3回目の見直し）: 呼び出しの数を減らす）
    for (let fy = monthOf(base) <= 3 ? baseYear - 1 : baseYear; fy <= endYear; fy++) {
      const start = fiscalYearStart(fy);
      const at = start < base ? base : start;
      const last = fiscalYearEnd(fy);
      if (ageMonth(ctx, base, AGE.late, member) <= last) parts.push(ctx.call<FlowsResult>("socialInsurance.lateElderly", { member, fiscalYear: fy }).flows);
      if (ageMonth(ctx, at, AGE.care, member) <= last) parts.push(ctx.call<FlowsResult>("socialInsurance.careFirst", { member, fiscalYear: fy }).flows);
    }
    const kept = parts.filter((p) => p.length > 0);
    const flows: Flow[] = [];
    for (const p of kept) for (const f of p) flows.push(f);
    const net = [...netByYear(flows, ctx.conventions.aggregation, base, end).entries()].sort((a, b) => a[0] - b[0]).map(([year, amount]) => ({ year, amount }));
    return { flows, net, parts: kept };
  },
});

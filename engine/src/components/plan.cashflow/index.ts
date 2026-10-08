// 計算のはじめに呼ぶ部品: 構成員ごとに給与・社会保険料・所得税・住民税を、世帯で保険料・積立・差し込み口の支出を集め、
// 年間収支（収入−税・社会保険料−支出。器の間の移動は含めない）・運用益・金融資産の残高を出す
import {
  addYen,
  boxValue,
  defineComponent,
  formatYm,
  monthOf,
  netByYear,
  yearOf,
  yen,
  type AccountInput,
  type AnnualRow,
  type Flow,
  type FlowsResult,
  type MemberInput,
  type PaymentsOutput,
  type SalaryOutput,
  type TaxOutput,
  type Yen,
} from "../../sdk/index.ts";

/** 残高に入れない器（不動産・保険の積立部分は別の部品で扱う） */
const NOT_FINANCIAL: ReadonlySet<string> = new Set(["realEstate", "insurance"]);

export default defineComponent<Record<string, never>, { flows: Flow[]; annual: AnnualRow[] }>({
  id: "plan.cashflow",
  title: "キャッシュフロー表",
  contract: "1.0",
  revision: 1,
  requires: {
    "income.salary": ">=1 <2",
    "socialInsurance.health": ">=1 <2",
    "socialInsurance.pension": ">=1 <2",
    "socialInsurance.employment": ">=1 <2",
    "incomeTax.annual": ">=1 <2",
    "residentTax.annual": ">=1 <2",
    "insurance.premiumPayment": ">=1 <2",
    "account.contribution": ">=1 <2",
  },
  params: [],
  reads: ["member.kind", "account.kind", "account.marketValue", "assumptions.investmentReturn"],
  slots: ["slot.expense.flow"],
  input: "empty.input",
  output: "plan.cashflow.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const flows: Flow[] = [];
    for (const m of ctx.list<MemberInput>("member")) {
      const member = m.id;
      flows.push(...ctx.call<SalaryOutput>("income.salary", { member }).flows);
      for (const c of ["socialInsurance.health", "socialInsurance.pension", "socialInsurance.employment"]) {
        flows.push(...ctx.call<FlowsResult>(c, { member, fromYear: baseYear }).flows);
      }
      for (let y = baseYear; y <= endYear; y++) flows.push(...ctx.call<TaxOutput>("incomeTax.annual", { member, year: y }).flows);
      // 前年度の分（計算基準年の1〜5月に払う分）から
      for (let fy = monthOf(base) <= 5 ? baseYear - 1 : baseYear; fy <= endYear; fy++) {
        flows.push(...ctx.call<TaxOutput>("residentTax.annual", { member, fiscalYear: fy }).flows);
      }
    }
    flows.push(...ctx.call<PaymentsOutput>("insurance.premiumPayment", {}).flows);
    flows.push(...ctx.call<PaymentsOutput>("account.contribution", {}).flows);
    for (const out of ctx.slot("slot.expense.flow", { fromMonth: formatYm(base), toMonth: formatYm(end) })) flows.push(...out.flows);

    // 0003 の3・5: 運用益＝(期首残高×2＋その年の収支)×年利×月数/12÷2（midYear）を1回で丸める。初年度は残りの月数で按分
    const { aggregation, investmentTiming } = ctx.conventions;
    const net = netByYear(flows, aggregation, base, end);
    let balance: Yen = yen(0);
    for (const a of ctx.list<AccountInput>("account")) {
      if (!NOT_FINANCIAL.has(a.kind)) balance = addYen(balance, boxValue(a.marketValue) ?? yen(0));
    }
    const annual: AnnualRow[] = [];
    for (let y = baseYear; y <= endYear; y++) {
      const n = net.get(y) ?? yen(0);
      const months = y === baseYear ? 13 - monthOf(base) : 12;
      const r = ctx.rate.fraction(ctx.assumption("investmentReturn", y));
      const [amount, half] =
        investmentTiming === "midYear" ? [addYen(addYen(balance, balance), n), 2n] : investmentTiming === "beginning" ? [addYen(balance, n), 1n] : [balance, 1n];
      const ret = ctx.money.mulRatio(amount, r.num * BigInt(months), r.den * 12n * half, "conv.investment.return");
      balance = addYen(addYen(balance, n), ret);
      annual.push(
        { row: "cf.net", year: y, amount: n, formula: "plan.cashflow.net" },
        { row: "cf.balance.return", year: y, amount: ret, formula: "plan.cashflow.return" },
        { row: "cf.balance.financial", year: y, amount: balance, formula: "plan.cashflow.closing" },
      );
    }
    return { flows, annual };
  },
});

// 構成員×年の保険の所得（tax.totalIncome が読む）: 一時所得（満期金・祝金・解約返戻金・契約者が受け取る死亡保険金）は
// （収入−必要経費）の合計から特別控除（50万円まで）を引いた額で、総所得金額にはその2分の1を入れる。雑所得（個人年金・収入保障の月額）は
// 収入−必要経費（公的年金等以外の雑所得）。受け取りと税の区分・必要経費は insurance.policy が出す
import { defineComponent, monthIndex, yen, type InsuranceIncomeOutput, type InsuranceReceipt, type Yen } from "../../sdk/index.ts";

const P = { special: "incomeTax.temporaryIncome.specialDeduction", ratio: "incomeTax.temporaryIncome.taxableRatio" };

export default defineComponent<{ member: string; year: number }, InsuranceIncomeOutput>({
  id: "insurance.income",
  title: "保険の一時所得・雑所得",
  contract: "1.0",
  revision: 1,
  requires: { "insurance.policy": ">=1 <2" },
  params: Object.values(P),
  reads: ["insurance.policyholder"],
  input: "tax.memberYear.input",
  output: "insurance.income.output",
  compute(input, ctx) {
    const zero: InsuranceIncomeOutput = { temporary: yen(0), temporaryIncluded: yen(0), miscellaneous: yen(0) };
    const contracts = ctx.list<{ id: string }>("insurance");
    if (contracts.length === 0) return zero;
    const prefix = `${input.year}-`;
    let temp = 0;
    let misc = 0;
    for (const c of contracts) {
      const rs = ctx.callMonths<InsuranceReceipt>("insurance.policy", { object: c.id }, "receipts", monthIndex(input.year, 1), monthIndex(input.year, 12));
      for (const r of rs) {
        if (r.member !== input.member || !r.ym.startsWith(prefix)) continue;
        if (r.taxClass === "temporary") temp += r.amount - r.cost;
        else if (r.taxClass === "miscellaneous") misc += r.amount - r.cost;
      }
    }
    if (temp <= 0 && misc <= 0) return zero;
    const at = ctx.at(monthIndex(input.year, 1));
    let temporary: Yen = yen(0);
    let included: Yen = yen(0);
    if (temp > 0) {
      const special = at.paramYen(P.special) ?? yen(0);
      temporary = yen(temp > special ? temp - special : 0);
      included = at.money.mulRate(temporary, at.paramRate(P.ratio) ?? ctx.rate.of("1"), "conv.tax.exact");
    }
    return { temporary, temporaryIncluded: included, miscellaneous: yen(misc > 0 ? misc : 0) };
  },
});

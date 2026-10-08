// 厚生年金保険料の被保険者負担分: 標準報酬月額（賞与は標準賞与額）×保険料率÷2 を丸める
import { defineComponent, parseYm, rate, yearOf, type CoverageOutput, type Flow, type Yen } from "../../sdk/index.ts";

const ROUNDING = "socialInsurance.employeeShare.rounding";

export default defineComponent<{ member: string; fromYear: number }, { flows: Flow[] }>({
  id: "socialInsurance.pension",
  title: "厚生年金保険料",
  contract: "1.0",
  revision: 1,
  requires: { "socialInsurance.coverage": ">=1 <2" },
  params: ["socialInsurance.pension.rate", ROUNDING],
  reads: [],
  replaceable: true,
  input: "socialInsurance.premium.input",
  output: "flows.output",
  compute(input, ctx) {
    const cov = ctx.call<CoverageOutput>("socialInsurance.coverage", input);
    const flows: Flow[] = [];
    const one = (month: string, ym: string, base: Yen, period: string, formula: string) => {
      const m = parseYm(month);
      const at = ctx.at(m);
      const r = at.paramRate("socialInsurance.pension.rate");
      if (r === null) return;
      const amount = at.money.mulRate(base, ctx.rate.div(r, rate("2")), ROUNDING);
      if (amount > 0) flows.push({ row: "cf.taxSi.pension", ym, amount, accrualYear: yearOf(m), member: input.member, object: period, formula });
    };
    for (const c of cov.months) if (c.pensionStd !== null) one(c.month, c.paidIn, c.pensionStd, c.period, "socialInsurance.pension.monthly");
    for (const b of cov.bonuses) if (b.pensionStdBonus !== null) one(b.month, b.month, b.pensionStdBonus, b.period, "socialInsurance.pension.bonus");
    return { flows };
  },
});

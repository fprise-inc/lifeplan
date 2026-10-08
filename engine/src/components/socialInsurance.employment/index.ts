// 雇用保険料の被保険者負担分: 支払う賃金（給与・通勤手当・賞与）×被保険者負担の率を、支払いごとに丸める
import { defineComponent, paidByYear, parseYm, yearOf, type CoverageOutput, type EmploymentPeriodInput, type Flow, type PremiumOutput } from "../../sdk/index.ts";

const ROUNDING = "employmentInsurance.employeeShare.rounding";
const RATE_IDS = {
  general: "employmentInsurance.employeeRate.general",
  agricultureEtc: "employmentInsurance.employeeRate.agricultureEtc",
  construction: "employmentInsurance.employeeRate.construction",
} as const;

export default defineComponent<{ member: string; fromYear: number }, PremiumOutput>({
  id: "socialInsurance.employment",
  title: "雇用保険料",
  contract: "1.1",
  revision: 2,
  requires: { "socialInsurance.coverage": ">=1 <2" },
  params: [RATE_IDS.general, RATE_IDS.agricultureEtc, RATE_IDS.construction, ROUNDING],
  reads: ["employment.employer.industry"],
  replaceable: true,
  input: "socialInsurance.premium.input",
  output: "socialInsurance.premium.output",
  compute(input, ctx) {
    const cov = ctx.call<CoverageOutput>("socialInsurance.coverage", input);
    const flows: Flow[] = [];
    for (const w of cov.wages) {
      const m = parseYm(w.month);
      const p = ctx.get<EmploymentPeriodInput>("employment", w.period);
      const at = ctx.at(m);
      const r = at.paramRate(RATE_IDS[p.employer?.industry ?? "general"]);
      if (r === null) continue;
      const amount = at.money.mulRate(w.wage, r, ROUNDING);
      if (amount > 0) {
        flows.push({
          row: "cf.taxSi.employment",
          ym: w.month,
          amount,
          accrualYear: yearOf(m),
          member: input.member,
          object: w.period,
          formula: w.kind === "bonus" ? "socialInsurance.employment.bonus" : "socialInsurance.employment.monthly",
        });
      }
    }
    return { flows, paidByYear: paidByYear(flows) };
  },
});

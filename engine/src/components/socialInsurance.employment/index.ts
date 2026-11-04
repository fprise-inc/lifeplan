// 雇用保険料の被保険者負担分: 支払う賃金（給与・通勤手当・賞与）×被保険者負担の率を、支払いごとに丸める。
// 区間ごとの計算（0006 の追記）: 料率と端数処理の行が変わらない区間ごとに、同じ賃金・同じ事業の種類の額は1回だけ計算する
import {
  defineComponent,
  paidByYear,
  parseYm,
  segmentIndex,
  yearOf,
  type CoverageOutput,
  type EmploymentPeriodInput,
  type Flow,
  type PremiumOutput,
  type Segment,
  type Yen,
} from "../../sdk/index.ts";

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
  revision: 3,
  requires: { "socialInsurance.coverage": ">=1 <2" },
  params: [RATE_IDS.general, RATE_IDS.agricultureEtc, RATE_IDS.construction, ROUNDING],
  reads: ["employment.employer.industry"],
  input: "socialInsurance.premium.input",
  output: "socialInsurance.premium.output",
  compute(input, ctx) {
    const cov = ctx.call<CoverageOutput>("socialInsurance.coverage", input);
    const flows: Flow[] = [];
    if (cov.wages.length === 0) return { flows, paidByYear: paidByYear(flows) };
    let from = parseYm((cov.wages[0] as { month: string }).month);
    let to = from;
    for (const w of cov.wages) {
      const m = parseYm(w.month);
      if (m < from) from = m;
      if (m > to) to = m;
    }
    const segs = ctx.segments(from, to, { params: [...Object.values(RATE_IDS), ROUNDING] });
    const memo = new Map<string, Yen | null>();
    for (const w of cov.wages) {
      const m = parseYm(w.month);
      const p = ctx.get<EmploymentPeriodInput>("employment", w.period);
      const rateId = RATE_IDS[p.employer?.industry ?? "general"];
      const k = segmentIndex(segs, m);
      const key = `${k}|${rateId}|${w.wage}`;
      let amount = memo.get(key);
      if (amount === undefined) {
        const at = (segs[k] as Segment).at;
        const r = at.paramRate(rateId);
        amount = r === null ? null : at.money.mulRate(w.wage, r, ROUNDING);
        memo.set(key, amount);
      }
      if (amount === null) continue;
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

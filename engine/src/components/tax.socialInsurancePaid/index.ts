// 社会保険料控除の基にする、その年に本人が払った社会保険料（給与から控除された被用者保険・国民年金・後期高齢者医療・介護保険（第1号）、
// 世帯主として払う国民健康保険）。所得控除（tax.deductions）が所得税・住民税の両方で使うので、構成員×年で1回だけ集める
import {
  ageMonth,
  amountInYear,
  fiscalYearEnd,
  fiscalYearStart,
  defineComponent,
  yearOf,
  yen,
  type FlowsResult,
  type PremiumOutput,
  type Yen,
} from "../../sdk/index.ts";

const AGE = { late: "socialInsurance.health.lateElderlyAge", care: "socialInsurance.care.secondaryInsuredUntilAge" };
const SI_COMPONENTS = ["socialInsurance.health", "socialInsurance.pension", "socialInsurance.employment"] as const;

export default defineComponent<{ member: string; year: number }, { amount: Yen }>({
  id: "tax.socialInsurancePaid",
  title: "その年に払った社会保険料",
  contract: "1.0",
  revision: 2,
  requires: {
    "socialInsurance.health": ">=1 <2",
    "socialInsurance.pension": ">=1 <2",
    "socialInsurance.employment": ">=1 <2",
    "socialInsurance.nationalPension": ">=1 <2",
    "socialInsurance.nationalHealth": ">=1 <2",
    "socialInsurance.lateElderly": ">=1 <2",
    "socialInsurance.careFirst": ">=1 <2",
  },
  params: Object.values(AGE),
  reads: [],
  input: "tax.memberYear.input",
  output: "tax.socialInsurancePaid.output",
  compute(input, ctx) {
    const { member, year } = input;
    const baseYear = yearOf(ctx.time.base);
    const fromYear = year < baseYear ? year : baseYear;
    let amount = yen(0);
    const yearPrefix = `${year}-`;
    const addPaid = (flows: readonly { ym: string; amount: number; member?: string }[]) => {
      for (const f of flows) if (f.ym.startsWith(yearPrefix) && (f.member === undefined || f.member === member)) amount = yen(amount + f.amount);
    };
    // 被用者保険・国民年金は、部品が添える暦年ごとの合計を引く（無い古い約束の版の差し替えなら flows から数える）
    const addPremium = (out: PremiumOutput) => {
      if (out.paidByYear === undefined) addPaid(out.flows);
      else amount = yen(amount + amountInYear(out.paidByYear, year));
    };
    for (const c of SI_COMPONENTS) addPremium(ctx.call<PremiumOutput>(c, { member, fromYear }));
    addPremium(ctx.call<PremiumOutput>("socialInsurance.nationalPension", { member, fromYear }));
    const base = ctx.time.base;
    for (const fy of [year - 1, year]) {
      // 後期高齢者医療・介護保険の第1号は、その年齢を含む年度からだけ呼ぶ（その前は空。plan.memberFlows と同じ判定）
      const start = fiscalYearStart(fy);
      const last = fiscalYearEnd(fy);
      if (ageMonth(ctx, base, AGE.late, member) <= last) addPaid(ctx.call<FlowsResult>("socialInsurance.lateElderly", { member, fiscalYear: fy }).flows);
      if (ageMonth(ctx, start < base ? base : start, AGE.care, member) <= last) addPaid(ctx.call<FlowsResult>("socialInsurance.careFirst", { member, fiscalYear: fy }).flows);
      addPaid(ctx.call<FlowsResult>("socialInsurance.nationalHealth", { fiscalYear: fy }).flows);
    }
    return { amount };
  },
});

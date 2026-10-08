// 公式部品の一覧。部品の中身の指紋はビルドの時にソースから作る（src/generated/build-info.json）
import buildInfo from "../generated/build-info.json" with { type: "json" };
import { EngineError } from "../errors.ts";
import type { ComponentDefinition } from "../registry/define.ts";
import type { OfficialComponent } from "../registry/assemble.ts";
import accountContribution from "./account.contribution/index.ts";
import incomeSalary from "./income.salary/index.ts";
import incomeTaxAnnual from "./incomeTax.annual/index.ts";
import insurancePremium from "./insurance.premiumPayment/index.ts";
import planCashflow from "./plan.cashflow/index.ts";
import planFlows from "./plan.flows/index.ts";
import planMemberFlows from "./plan.memberFlows/index.ts";
import residentTaxAnnual from "./residentTax.annual/index.ts";
import socialInsuranceCoverage from "./socialInsurance.coverage/index.ts";
import socialInsuranceEmployment from "./socialInsurance.employment/index.ts";
import socialInsuranceHealth from "./socialInsurance.health/index.ts";
import socialInsurancePension from "./socialInsurance.pension/index.ts";
import taxDeductions from "./tax.deductions/index.ts";
import taxIncomeOrder from "./tax.incomeOrder/index.ts";
import taxIncomeWithin from "./tax.incomeWithin/index.ts";
import taxDependentDeduction from "./tax.dependentDeduction/index.ts";
import taxSocialInsurancePaid from "./tax.socialInsurancePaid/index.ts";
import taxSpouseDeduction from "./tax.spouseDeduction/index.ts";
import taxEmploymentIncome from "./tax.employmentIncome/index.ts";
import taxTotalIncome from "./tax.totalIncome/index.ts";
import benefitEmployment from "./benefit.employment/index.ts";
import benefitHealth from "./benefit.health/index.ts";
import incomeBusiness from "./income.business/index.ts";
import pensionCategory from "./pension.category/index.ts";
import pensionEmployeeMonths from "./pension.employeeMonths/index.ts";
import pensionOldAge from "./pension.oldAge/index.ts";
import pensionRecord from "./pension.record/index.ts";
import pensionRevision from "./pension.revision/index.ts";
import pensionSupplementaryBenefit from "./pension.supplementaryBenefit/index.ts";
import residentTaxExemption from "./residentTax.exemption/index.ts";
import socialInsuranceCareFirst from "./socialInsurance.careFirst/index.ts";
import socialInsuranceEmployeeStatus from "./socialInsurance.employeeStatus/index.ts";
import socialInsuranceHealthStatus from "./socialInsurance.healthStatus/index.ts";
import socialInsuranceLateElderly from "./socialInsurance.lateElderly/index.ts";
import socialInsuranceNationalHealth from "./socialInsurance.nationalHealth/index.ts";
import socialInsuranceNationalPension from "./socialInsurance.nationalPension/index.ts";
import taxPublicPensionIncome from "./tax.publicPensionIncome/index.ts";

const HASHES = buildInfo.components as Readonly<Record<string, string>>;

function official(def: ComponentDefinition<never, unknown>): OfficialComponent {
  const hash = HASHES[def.id];
  if (hash === undefined) throw new EngineError("E_COMPONENT_DEFINITION", [def.id, "hash"]);
  return { def: def as ComponentDefinition, hash };
}

export const OFFICIAL_DEFINITIONS: readonly ComponentDefinition<never, unknown>[] = [
  accountContribution,
  incomeSalary,
  incomeTaxAnnual,
  insurancePremium,
  planCashflow,
  planFlows,
  planMemberFlows,
  residentTaxAnnual,
  socialInsuranceCoverage,
  socialInsuranceEmployment,
  socialInsuranceHealth,
  socialInsurancePension,
  taxDeductions,
  taxIncomeOrder,
  taxIncomeWithin,
  taxDependentDeduction,
  taxSocialInsurancePaid,
  taxSpouseDeduction,
  taxEmploymentIncome,
  taxTotalIncome,
  benefitEmployment,
  benefitHealth,
  incomeBusiness,
  pensionCategory,
  pensionEmployeeMonths,
  pensionOldAge,
  pensionRecord,
  pensionRevision,
  pensionSupplementaryBenefit,
  residentTaxExemption,
  socialInsuranceCareFirst,
  socialInsuranceEmployeeStatus,
  socialInsuranceHealthStatus,
  socialInsuranceLateElderly,
  socialInsuranceNationalHealth,
  socialInsuranceNationalPension,
  taxPublicPensionIncome,
] as never;

export const OFFICIAL_COMPONENTS: readonly OfficialComponent[] = OFFICIAL_DEFINITIONS.map(official);

/** 計算のはじめに呼ぶ部品 */
export const ROOT_COMPONENT = "plan.cashflow";

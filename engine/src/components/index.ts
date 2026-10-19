// 公式部品の一覧。部品の中身の指紋はビルドの時にソースから作る（src/generated/build-info.json）
import buildInfo from "../generated/build-info.json" with { type: "json" };
import { EngineError } from "../errors.ts";
import type { ComponentDefinition } from "../registry/define.ts";
import type { OfficialComponent } from "../registry/assemble.ts";
import accountContribution from "./account.contribution/index.ts";
import accountDcList from "./account.dcList/index.ts";
import accountIdeco from "./account.ideco/index.ts";
import accountIdecoPayout from "./account.idecoPayout/index.ts";
import debtSchedule from "./debt.schedule/index.ts";
import housingResidence from "./housing.residence/index.ts";
import housingValuation from "./housing.valuation/index.ts";
import assetCar from "./asset.car/index.ts";
import idecoContribution from "./ideco.contribution/index.ts";
import taxHousingLoanCredit from "./tax.housingLoanCredit/index.ts";
import taxHousingLoanCreditYears from "./tax.housingLoanCreditYears/index.ts";
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
import pensionOldAgeBase from "./pension.oldAgeBase/index.ts";
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
import accountMutualAid from "./account.mutualAid/index.ts";
import benefitChildAllowance from "./benefit.childAllowance/index.ts";
import educationCost from "./education.cost/index.ts";
import educationSupport from "./education.support/index.ts";
import expenseAdvisoryFee from "./expense.advisoryFee/index.ts";
import expenseCar from "./expense.car/index.ts";
import expenseLiving from "./expense.living/index.ts";
import expensePeriodic from "./expense.periodic/index.ts";
import expenseReconcile from "./expense.reconcile/index.ts";
import retirementBenefit from "./retirement.benefit/index.ts";
import retirementReceipts from "./retirement.receipts/index.ts";
import taxRetirementIncome from "./tax.retirementIncome/index.ts";
import careExpense from "./care.expense/index.ts";
import contingencyEvent from "./contingency.event/index.ts";
import contingencyLumpSum from "./contingency.lumpSum/index.ts";
import debtCreditLife from "./debt.creditLifeEvents/index.ts";
import giftReceived from "./gift.received/index.ts";
import giftTax from "./gift.tax/index.ts";
import insuranceIncome from "./insurance.income/index.ts";
import insurancePolicy from "./insurance.policy/index.ts";
import insuranceTerm from "./insurance.term/index.ts";
import medicalHighCost from "./medical.highCost/index.ts";
import pensionDisability from "./pension.disability/index.ts";
import pensionSurvivor from "./pension.survivor/index.ts";
import protectionNeed from "./protection.need/index.ts";
import taxSurvivorStatus from "./tax.survivorStatus/index.ts";

const HASHES = buildInfo.components as Readonly<Record<string, string>>;

function official(def: ComponentDefinition<never, unknown>): OfficialComponent {
  const hash = HASHES[def.id];
  if (hash === undefined) throw new EngineError("E_COMPONENT_DEFINITION", [def.id, "hash"]);
  return { def: def as ComponentDefinition, hash };
}

export const OFFICIAL_DEFINITIONS: readonly ComponentDefinition<never, unknown>[] = [
  accountContribution,
  accountDcList,
  accountIdeco,
  accountIdecoPayout,
  debtSchedule,
  housingResidence,
  housingValuation,
  assetCar,
  idecoContribution,
  taxHousingLoanCredit,
  taxHousingLoanCreditYears,
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
  pensionOldAgeBase,
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
  accountMutualAid,
  benefitChildAllowance,
  educationCost,
  educationSupport,
  expenseAdvisoryFee,
  expenseCar,
  expenseLiving,
  expensePeriodic,
  expenseReconcile,
  retirementBenefit,
  retirementReceipts,
  taxRetirementIncome,
  careExpense,
  contingencyEvent,
  contingencyLumpSum,
  debtCreditLife,
  giftReceived,
  giftTax,
  insuranceIncome,
  insurancePolicy,
  insuranceTerm,
  medicalHighCost,
  pensionDisability,
  pensionSurvivor,
  protectionNeed,
  taxSurvivorStatus,
] as never;

export const OFFICIAL_COMPONENTS: readonly OfficialComponent[] = OFFICIAL_DEFINITIONS.map(official);

/** 計算のはじめに呼ぶ部品 */
export const ROOT_COMPONENT = "plan.cashflow";

/** 必要保障額の推移（input.protection を指定したときに、根の部品の後に呼ぶ部品） */
export const PROTECTION_COMPONENT = "protection.need";

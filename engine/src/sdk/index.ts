// 計算部品が import してよい公式SDK（0006 の2）。丸め関数はここに置かず ctx.money だけで使う（0002・0006 の7）
export { COMPONENT_API_VERSION, defineComponent, type ComponentDefinition } from "../registry/define.ts";
export type { Ctx, MonthCtx, MoneyApi, RateApi, TimeApi, ParamOptions } from "../registry/ctx.ts";
export type { Segment, SegmentOptions } from "../registry/segments.ts";
export { segmentIndex } from "../registry/segments.ts";
export type {
  AccountInput,
  AccountKind,
  AmountStageInput,
  AmountExceptionInput,
  StagedInput,
  ReturnStageInput,
  DebtInput,
  RateStep,
  ResidenceInput,
  ResidenceValuationInput,
  RealEstatePropertyInput,
  RealEstateValuationSetting,
  BuildingStructure,
  VariableRules,
  AnnualRow,
  CalcConventions,
  EmploymentPeriodInput,
  HealthKind,
  PensionRecordInput,
  PremiumAssessmentInput,
  PremiumKind,
  PremiumPart,
  PremiumRateInput,
  Flow,
  FlowsOutput,
  HouseholdInput,
  InsuranceContractInput,
  MemberInput,
  OutsideWalletInput,
  RelationInput,
  ResidentTaxAssessmentInput,
  ValueBox,
  GrowthInput,
  OnContingencyInput,
  CareExpenseInput,
  DonorInput,
  ContingencyInput,
  ContingencyKind,
  CoverageInput,
  CoverageBenefit,
  ScheduleRowInput,
  MarketShock,
  InvestmentSetting,
  SurplusSavingSetting,
  ReturnShift,
  IncomeShock,
  ProtectionRequest,
  LivingCategory,
  LivingExpenseInput,
  PeriodicExpenseInput,
  IncomeFlowInput,
  IncomeFlowKind,
  IncomeTaxTreatment,
  MoneyOutKind,
  OutgoingGiftInput,
  TransferInput,
  CarInput,
  AdvisoryFeeInput,
  AdvisoryFeeTerms,
  SavingsCheckInput,
  RetirementBenefitInput,
  RetirementBenefitKind,
  SchoolStage,
  TuitionRow,
  EducationStageInput,
  EducationGoalInput,
  GoalInput,
} from "../engine/types.ts";
export { yen, addYen, subYen, negYen, sumYen, YEN_ZERO, type Yen, type Money } from "../money/yen.ts";
export { rate, RATE_ZERO, RATE_ONE, type Rate } from "../money/rate.ts";
export { addMonths, formatYm, monthIndex, monthOf, parseYm, yearOf, type MonthIndex } from "../time/month.ts";
export type { Timepoint } from "../time/timepoint.ts";
export type { Birth } from "../time/ageSwitch.ts";
export { bracketFor, gradeFor, periodRateFor, type Bracket, type Grade, type PeriodRate } from "../regulation/reader.ts";
export { isUnder } from "../ids/cfTree.ts";
export { netByYear, tableYear } from "../engine/aggregate.ts";
export { boxValue } from "./box.ts";
export { stagedYen, stageSteps, stageAt, type StagedYen, type StageStep } from "./stages.ts";
export { INCOME_KIND_DEFAULTS, incomeTreatment, incomeRow, isOnceRow, moneyRowPayments, counterpartyStop, COUNTERPARTY_DEATH_TOPIC, type MoneyRowPayment, type MoneyRowInput } from "./moneyRows.ts";
export type * from "./contracts.ts";
export { fail } from "./fail.ts";
export { ageMonth, estimateUnemploymentClaim, UNEMPLOYMENT_ESTIMATE_MIN_IDLE_MONTHS, annualReturn, accountReturnRate, accountMixAt, shockShare, INVEST_KINDS, monthsIn, paymentsIn, paymentsInYear, paidByYear, amountInYear, fiscalYearOf, residentTaxYearOf, fiscalYearStart, fiscalYearEnd, installmentMonths, installmentFlows, reductionRatio, assessedPremium, rateOverride, pensionSpecial, PENSION_SPECIAL_MINIMUM, healthStatusInFiscalYear, LATE_ELDERLY_AGE, prospectiveMonths, prospectiveYear, EMPLOYEE_TYPES, EMPLOYER_HEALTH_KINDS, EMPLOYEE_PENSION_KINDS, grownByYear, monthlyParts, evenMonthPayments, spousesAt, childrenOf, deathMonthIn, isOutside, hasWallet, outsidePeriodAt, outsideIncomeEver, householdMembers, sameHousehold, contingencyRatio, exemptionMonths, EXEMPTION_WEIGHT_IDS, EXEMPTION_WEIGHT_DENOMINATOR, landBuildingValuer, USEFUL_LIFE, LAND_SHARE, RESIDUAL_FLOOR, SALE_COST_RATE } from "./helpers.ts";
export type { ExemptionCounts } from "./helpers.ts";
export {
  legalExemptionWindow,
  oldAgeClaimMonths,
  claimInput,
  recordEmployeeMonths,
  specialOldAgeStart,
  survivorBasis,
  survivorDeath,
  SPECIAL_OLD_AGE_PARAMS,
  SURVIVOR_BASIS_PARAMS,
  type SurvivorBasis,
} from "./pension.ts";

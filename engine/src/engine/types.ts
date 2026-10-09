// エンジンの入出力の型（正は schemas/ の JSON Schema。ここは TypeScript から使うための写し）
import type { Yen } from "../money/yen.ts";
import type { Birth } from "../time/ageSwitch.ts";
import type { Timepoint } from "../time/timepoint.ts";

export type Aggregation = "cash" | "accrual";
export type InvestmentTiming = "midYear" | "beginning" | "end";

export interface CalcConventions {
  readonly aggregation: Aggregation;
  readonly investmentTiming: InvestmentTiming;
  readonly compatibility: null;
}

export interface YearSeries {
  readonly default: string;
  readonly byYear?: Readonly<Record<string, string>>;
}

/** 0008 の2: 値の箱 */
export interface ValueBox<T> {
  readonly value?: T;
  readonly state: "confirmed" | "unknown" | "notApplicable" | "estimated";
  readonly origin: { readonly kind: string; readonly ref?: string; readonly connector?: string };
  readonly approval?: { readonly by: "fp"; readonly at: string; readonly candidate?: string };
  readonly estimate?: { readonly method: string; readonly basis: string };
  readonly substitute?: ValueBox<T>;
}

export interface MemberInput {
  readonly id: string;
  readonly kind: "self" | "spouse" | "child" | "parent" | "grandparent" | "other";
  readonly birth: Birth;
  readonly sex: "female" | "male";
  readonly joins: Timepoint | null;
  readonly leaves: Timepoint | null;
  readonly expected: boolean;
  readonly support?: { readonly dependent: boolean; readonly cohabiting: boolean; readonly allowance?: Yen };
}

export type RelationInput =
  | {
      readonly type: "spouse";
      readonly a: string;
      readonly b: string;
      readonly marriage: "legal" | "deFacto";
      readonly from: Timepoint | null;
      readonly to: Timepoint | null;
    }
  | { readonly type: "parentOf"; readonly parent: string; readonly child: string };

export interface EventInput {
  readonly id: string;
  readonly kind: string;
  readonly member?: string;
  readonly at: Timepoint;
}

export type HealthKind = "kyokaikenpo" | "union" | "mutualAid" | "national" | "dependent" | "continuation" | "lateElderly";

export interface EmploymentPeriodInput {
  readonly id: string;
  readonly member: string;
  readonly from: Timepoint;
  readonly to: Timepoint | null;
  readonly type: "regular" | "contract" | "partTime" | "selfEmployed" | "civilServant" | "executive" | "leave" | "unemployed";
  readonly leaveKind?: "maternity" | "childcare" | "sick" | "care" | "other";
  readonly leaveChild?: string;
  readonly healthInsurance?: {
    readonly kind: HealthKind;
    readonly insurer?: string;
    readonly employeeRate?: ValueBox<string>;
    readonly careEmployeeRate?: ValueBox<string>;
    readonly childSupportEmployeeRate?: ValueBox<string>;
  };
  readonly pensionCategory?: "employee1" | "employee2" | "employee3" | "employee4" | "none";
  readonly employer?: {
    readonly size: number;
    readonly weeklyHours: string;
    readonly fullTimeWeeklyHours?: string;
    readonly industry?: "general" | "agricultureEtc" | "construction";
  };
  readonly student?: boolean;
  readonly employeeInsurance?: ValueBox<boolean>;
  readonly employmentInsuranceCovered?: boolean;
  readonly salary?: {
    readonly annual: ValueBox<Yen>;
    readonly bonus: ValueBox<Yen>;
    readonly bonusMonths?: readonly number[];
    readonly commutingMonthly?: ValueBox<Yen>;
    readonly contractualMonthly?: ValueBox<Yen>;
    readonly growth?: { readonly curve: string };
  };
  readonly business?: { readonly income: ValueBox<Yen> };
  readonly childcareShortHours?: { readonly child: string; readonly wageBefore?: ValueBox<Yen> };
  readonly standardMonthlyRemuneration?: { readonly health: ValueBox<Yen>; readonly pension: ValueBox<Yen> };
  readonly endsOnMonthEnd?: boolean;
  readonly retirementBenefit?: string;
  readonly corporatePension?: { readonly db?: boolean; readonly dbEquivalentMonthly?: Yen };
  readonly endsWith?: string;
}

export interface PensionRecordInput {
  readonly id: string;
  readonly member: string;
  readonly kind: "statementUnder50" | "statementOver50" | "receiving" | "history" | "projection";
  readonly asOf: string;
  readonly months?: { readonly basic: number; readonly employee: number; readonly employee2059?: number; readonly qualifying?: number };
  readonly amounts?: {
    readonly basic?: ValueBox<Yen>;
    readonly employee?: ValueBox<Yen>;
    readonly transitional?: ValueBox<Yen>;
    readonly special?: ValueBox<Yen>;
  };
  readonly history?: readonly {
    readonly from: string;
    readonly to: string;
    readonly category: "national1" | "national1Unpaid" | "national3" | "employee";
    readonly averageRemuneration?: Yen;
    /** 当時の平均標準報酬（月）額。再評価率（pension.revaluationRate）でいまの水準に直す。averageRemuneration と一緒には書かない */
    readonly averageRemunerationAtTime?: Yen;
  }[];
  readonly claim?: { readonly basic?: Timepoint; readonly employee?: Timepoint };
}

export type PremiumKind = "nationalHealth" | "lateElderly" | "careFirst";
export type PremiumPart = "medical" | "elderlySupport" | "care" | "childSupport";

export interface PremiumAssessmentInput {
  readonly id: string;
  readonly member: string;
  readonly kind: PremiumKind;
  readonly fiscalYear: number;
  readonly amount: ValueBox<Yen>;
}

export interface PremiumRateInput {
  readonly id: string;
  readonly kind: PremiumKind;
  readonly fromFiscalYear?: number;
  readonly parts?: Partial<
    Record<PremiumPart, { readonly incomeRate?: ValueBox<string>; readonly perCapita?: ValueBox<Yen>; readonly perHousehold?: ValueBox<Yen> }>
  >;
  readonly baseMonthly?: ValueBox<Yen>;
}

export type AccountKind =
  | "deposit"
  | "taxable"
  | "nisa"
  | "juniorNisa"
  | "childNisa"
  | "legacyNisa"
  | "ideco"
  | "corporateDc"
  | "zaikei"
  | "esop"
  | "fxDeposit"
  | "insurance"
  | "realEstate"
  | "smallBusinessMutualAid";

export interface AccountInput {
  readonly id: string;
  readonly kind: AccountKind;
  readonly owner: string;
  readonly marketValue: ValueBox<Yen>;
  readonly costBasis?: ValueBox<Yen>;
  readonly asOf: string;
  readonly assetMix?: readonly { readonly assetClass: string; readonly share: string }[];
  readonly settlement?: boolean;
  readonly withdrawalLockedUntil?: Timepoint | null;
  readonly contributions: readonly {
    readonly from: Timepoint;
    readonly to: Timepoint | null;
    readonly monthly: Yen;
    readonly tranche?: string;
    readonly payer?: "self" | "employer";
  }[];
  readonly frame?: { readonly lifetimeUsedCost: Yen; readonly growthUsedCost?: Yen; readonly asOfYear: number };
  readonly lots?: readonly { readonly vintageYear: number; readonly regime: "general" | "tsumitate" | "junior"; readonly costBasis: Yen; readonly marketValue: Yen }[];
  readonly enrolledSince?: string;
  readonly payout?: { readonly start: Timepoint; readonly method: "lumpSum" | "annuity" | "mixed"; readonly annuityYears?: number; readonly lumpShare?: string };
}

export interface RateStep {
  readonly from: Timepoint;
  readonly type: "fixed" | "variable" | "fixedPeriod";
  readonly rate: string;
}

export interface VariableRules {
  readonly fiveYear?: boolean;
  readonly cap125?: boolean;
}

export interface DebtInput {
  readonly id: string;
  readonly kind: "mortgage" | "car" | "scholarship" | "other";
  readonly product?: "bank" | "flat35";
  readonly debtors: readonly { readonly member: string; readonly role: "primary" | "joint" | "guarantor"; readonly share?: string }[];
  readonly pairWith?: string;
  readonly principal: Yen;
  readonly start: Timepoint;
  readonly balance?: ValueBox<Yen>;
  readonly balanceAsOf?: string;
  readonly rateSchedule: readonly RateStep[];
  readonly repayment: {
    readonly method: "equalPayment" | "equalPrincipal";
    readonly termMonths: number;
    readonly bonusShare?: string;
    readonly bonusMonths?: readonly number[];
    readonly variableRules?: VariableRules;
  };
  readonly prepayments?: readonly { readonly at: Timepoint; readonly amount: Yen; readonly mode: "shortenTerm" | "reducePayment"; readonly fee?: Yen }[];
  readonly refinance?: readonly {
    readonly at: Timepoint;
    readonly rateSchedule: readonly RateStep[];
    readonly termMonths: number;
    readonly method?: "equalPayment" | "equalPrincipal";
    readonly costs?: Yen;
    readonly costsFinanced?: boolean;
    readonly variableRules?: VariableRules;
  }[];
  readonly creditLife?: {
    readonly covered: readonly string[];
    readonly ratio?: string;
    readonly events?: readonly ("death" | "highDisability" | "cancer" | "threeMajor" | "eightMajor" | "incapacity")[];
    readonly spouseJoint?: boolean;
    readonly incapacityMonths?: number;
  };
  readonly housing?: {
    readonly residence?: string;
    readonly moveIn: string;
    readonly propertyType: "certified" | "zeh" | "energySaving" | "other";
    readonly newBuild: boolean;
    readonly acquisitionCost?: Yen;
    readonly ownership?: readonly { readonly member: string; readonly share: string }[];
    readonly childRearing?: boolean;
    readonly creditDisabled?: boolean;
  };
}

export interface ResidenceInput {
  readonly id: string;
  readonly kind: "rent" | "own";
  readonly from: Timepoint;
  readonly to: Timepoint | null;
  readonly rent?: { readonly monthly: ValueBox<Yen>; readonly growth?: string; readonly renewalFee?: string; readonly renewalEveryMonths?: number };
  readonly purchase?: {
    readonly at?: Timepoint;
    readonly price: Yen;
    readonly downPayment: Yen;
    readonly costs: Yen;
    readonly gifts?: readonly {
      readonly recipient: string;
      readonly giver?: "parent" | "grandparent" | "other";
      readonly amount: Yen;
      readonly taxMethod?: "calendar" | "settlement";
      readonly housingExemption?: "energySaving" | "other" | "none";
    }[];
  };
  readonly propertyTax?: { readonly annual: ValueBox<Yen>; readonly growth?: string };
  readonly maintenance?: { readonly monthly: ValueBox<Yen>; readonly growth?: string };
  readonly ownership?: readonly { readonly member: string; readonly share: string }[];
}

export type CoverageBenefit =
  | "death"
  | "incomeProtection"
  | "incapacity"
  | "highDisability"
  | "maturity"
  | "annuity"
  | "survival"
  | "hospitalDaily"
  | "surgery"
  | "cancerLump"
  | "other";

export interface CoverageInput {
  readonly id: string;
  readonly role: "main" | "rider";
  readonly benefit: CoverageBenefit;
  readonly amount: Yen;
  readonly from?: Timepoint;
  readonly to?: Timepoint | null;
  readonly minimumMonths?: number;
  readonly waitingMonths?: number;
  readonly years?: number;
  readonly everyYears?: number;
}

export interface ScheduleRowInput {
  readonly coverage?: string;
  readonly policyYear: number;
  readonly premium?: Yen;
  readonly deathBenefit?: Yen;
  readonly surrenderValue?: Yen;
  readonly annuity?: Yen;
  readonly survivalBenefit?: Yen;
}

export interface InsuranceContractInput {
  readonly id: string;
  readonly template: string;
  readonly policyholder: string;
  readonly insured: string;
  readonly contractDate: string;
  readonly currency: "JPY";
  readonly premium: { readonly amount: Yen; readonly frequency: "monthly" | "annual" | "single"; readonly payUntil: Timepoint | null };
  readonly deductionCategory: {
    readonly type: "general" | "careMedical" | "pension" | "earthquake" | "longTermNonLife" | "none";
    readonly regime?: "new" | "old";
  };
  readonly beneficiaries?: readonly { readonly member?: string; readonly external?: "child" | "parent" | "sibling" | "other"; readonly share: string }[];
  readonly annuitant?: string;
  readonly waiver?: boolean;
  readonly renewals?: readonly { readonly at: Timepoint; readonly premium: Yen }[];
  readonly coverages?: readonly CoverageInput[];
  readonly schedule?: { readonly source?: { readonly productRef: string; readonly digest: string }; readonly rows: readonly ScheduleRowInput[] };
  readonly simple?: { readonly returnRate?: string; readonly assetClass?: string; readonly loadRate?: string };
  readonly surrender?: Timepoint;
}

export interface ResidentTaxAssessmentInput {
  readonly id: string;
  readonly member: string;
  readonly fiscalYear: number;
  readonly amount: ValueBox<Yen>;
  readonly collection?: "special" | "ordinary";
}

export interface HouseholdInput {
  readonly members: readonly MemberInput[];
  readonly relations: readonly RelationInput[];
  readonly events: readonly EventInput[];
  readonly employmentPeriods: readonly EmploymentPeriodInput[];
  readonly accounts: readonly AccountInput[];
  readonly insuranceContracts: readonly InsuranceContractInput[];
  readonly residentTaxAssessments?: readonly ResidentTaxAssessmentInput[];
  readonly pensionRecords?: readonly PensionRecordInput[];
  readonly premiumAssessments?: readonly PremiumAssessmentInput[];
  readonly premiumRates?: readonly PremiumRateInput[];
  readonly debts?: readonly DebtInput[];
  readonly residences?: readonly ResidenceInput[];
  readonly livingExpenses?: readonly LivingExpenseInput[];
  readonly periodicExpenses?: readonly PeriodicExpenseInput[];
  readonly cars?: readonly CarInput[];
  readonly advisoryFees?: readonly AdvisoryFeeInput[];
  readonly savingsChecks?: readonly SavingsCheckInput[];
  readonly retirementBenefits?: readonly RetirementBenefitInput[];
  readonly goals?: readonly GoalInput[];
  readonly careExpenses?: readonly CareExpenseInput[];
}

/** 6.10: 介護の費用 */
export interface CareExpenseInput {
  readonly id: string;
  readonly member: string;
  readonly payer?: string;
  readonly from: Timepoint;
  readonly months?: number;
  readonly place?: "home" | "facility";
  readonly serviceMonthly?: ValueBox<Yen>;
  readonly otherMonthly?: ValueBox<Yen>;
  readonly initial?: ValueBox<Yen>;
  readonly growth?: GrowthInput;
  readonly onContingency?: OnContingencyInput;
}

export type ContingencyKind = "death" | "disability" | "incapacity";

/** 0008 の5: 万一の想定（要求1つに1件まで） */
export interface ContingencyInput {
  readonly id: string;
  readonly kind: ContingencyKind;
  readonly member: string;
  readonly occurs: Timepoint;
  readonly grade?: 1 | 2 | 3;
  readonly recovery?: Timepoint;
  readonly survivor?: {
    readonly livingRatio?: { readonly beforeIndependence?: string; readonly afterIndependence?: string };
    readonly independenceAge?: number;
    readonly funeral?: Yen;
    readonly reserveMonths?: number;
    readonly deathBenefits?: { readonly retirementAllowance?: Yen; readonly condolence?: Yen; readonly workRelated?: boolean };
    readonly spouseWork?: readonly EmploymentPeriodInput[];
  };
  readonly medical?: { readonly monthly: Yen; readonly months: number; readonly from?: Timepoint };
}

export type StressTemplate = "marketDropAtRetirement" | "inflationSpike" | "rateRise" | "incomeDrop";

export interface StressTestInput {
  readonly template: StressTemplate;
  readonly params?: {
    readonly member?: string;
    readonly year?: number;
    readonly from?: string;
    readonly years?: number;
    readonly drop?: string;
    readonly rate?: string;
    readonly add?: string;
    readonly ratio?: string;
    readonly alsoWages?: boolean;
    readonly kinds?: readonly AccountKind[];
  };
}

export interface ProtectionRequest {
  readonly members?: readonly string[];
  readonly method?: "accumulation" | "reverse";
  readonly horizon?: { readonly kind: "lifeExpectancy" | "age" | "youngestIndependence"; readonly age?: number };
  readonly reverseUntilAge?: number;
  readonly fromYear?: number;
  readonly toYear?: number;
  readonly survivor?: Omit<NonNullable<ContingencyInput["survivor"]>, "spouseWork">;
}

/** 額の伸び方（計算基準年の価格で入れた額を年ごとに伸ばす） */
export interface GrowthInput {
  readonly kind: "inflation" | "rate" | "none";
  readonly rate?: string;
}

/** 万一のときの扱い（万一の部品で使う） */
export interface OnContingencyInput {
  readonly mode: "continue" | "stop" | "ratio";
  readonly ratio?: string;
  /** どの万一で当てるか（省略は死亡だけ） */
  readonly kinds?: readonly ("death" | "disability" | "incapacity")[];
}

export type LivingCategory = "food" | "utilities" | "furniture" | "clothing" | "health" | "transport" | "recreation" | "otherConsumption" | "allowance";

export interface LivingExpenseInput {
  readonly id: string;
  readonly mode: "total" | "byCategory";
  readonly from?: Timepoint;
  readonly to?: Timepoint | null;
  readonly monthly?: ValueBox<Yen>;
  readonly categories?: readonly { readonly category: LivingCategory; readonly monthly: ValueBox<Yen> }[];
  readonly growth?: GrowthInput;
  readonly stages?: readonly { readonly at: Timepoint; readonly label?: string; readonly ratio?: string; readonly monthly?: ValueBox<Yen> }[];
  readonly onContingency?: OnContingencyInput;
}

export interface PeriodicExpenseInput {
  readonly id: string;
  readonly label?: string;
  readonly row: string;
  readonly from: Timepoint;
  readonly to?: Timepoint | null;
  readonly everyYears: number;
  readonly amount: ValueBox<Yen>;
  readonly growth?: GrowthInput;
  readonly onContingency?: OnContingencyInput;
}

export interface CarInput {
  readonly id: string;
  readonly owner: string;
  readonly purchase: { readonly first: Timepoint; readonly everyYears: number; readonly price: Yen; readonly tradeIn?: Yen; readonly owned?: boolean };
  readonly until?: Timepoint | null;
  readonly loan?: { readonly share?: string; readonly rate: string; readonly termMonths: number; readonly method?: "equalPayment" | "equalPrincipal" };
  readonly inspection?: { readonly amount: Yen; readonly firstAfterYears?: number; readonly everyYears?: number };
  readonly insurance?: { readonly annual: Yen };
  readonly tax?: { readonly annual: Yen };
  readonly growth?: GrowthInput;
}

export interface AdvisoryFeeTerms {
  readonly oneTime?: readonly { readonly at: Timepoint; readonly amount: Yen }[];
  readonly recurring?: {
    readonly from: Timepoint;
    readonly to?: Timepoint | null;
    readonly annual?: Yen;
    readonly monthly?: Yen;
    readonly revision?: { readonly rate?: string; readonly steps?: readonly { readonly at: Timepoint; readonly annual?: Yen; readonly monthly?: Yen }[] };
    readonly onContingency?: OnContingencyInput;
  };
}

export interface AdvisoryFeeInput {
  readonly id: string;
  readonly payer: string;
  readonly enabled?: boolean;
  readonly menu?: { readonly id: string; readonly label?: string; readonly copiedFrom?: { readonly officeDefaultsDigest: string; readonly at: string } };
  readonly terms?: AdvisoryFeeTerms;
}

export interface SavingsCheckInput {
  readonly id: string;
  readonly year: number;
  readonly actualSavings: ValueBox<Yen>;
  readonly treatment: "addToLiving" | "keepUnexplained";
  readonly until?: Timepoint | null;
}

export type RetirementBenefitKind = "lumpSum" | "db" | "civilServantAllowance" | "civilServantPension" | "nationalPensionFund" | "officerAllowance";

export interface RetirementBenefitInput {
  readonly id: string;
  readonly member: string;
  readonly kind: RetirementBenefitKind;
  readonly employment?: string;
  readonly service?: { readonly from: Timepoint; readonly to: Timepoint };
  readonly officerService?: { readonly from: Timepoint; readonly to: Timepoint };
  readonly paidAt?: Timepoint;
  readonly amount?: ValueBox<Yen>;
  readonly estimate?: { readonly finalMonthly?: Yen; readonly reason?: "retirementAge" | "voluntary"; readonly multiplier?: string };
  readonly receipt?: {
    readonly method?: "lumpSum" | "annuity" | "mixed";
    readonly lumpShare?: string;
    readonly start?: Timepoint;
    readonly years?: number | null;
    readonly guaranteeYears?: number;
    readonly perYear?: 1 | 2 | 4 | 6 | 12;
    readonly annualAmount?: Yen;
    readonly conversionRate?: string;
  };
  readonly contributions?: { readonly monthly: Yen; readonly from: Timepoint; readonly to?: Timepoint | null };
  readonly disability?: boolean;
}

export type SchoolStage = "nursery" | "kindergarten" | "elementary" | "juniorHigh" | "highSchool" | "university" | "juniorCollege" | "vocational";

export interface TuitionRow {
  readonly entryYear: number;
  readonly grade: number;
  readonly item: "tuition.admission" | "tuition.annual" | "tuition.facility" | "tuition.lab" | "tuition.other";
  readonly monthOffset: number;
  readonly amount: Yen;
}

export interface EducationStageInput {
  readonly stage: SchoolStage;
  readonly sector?: "public" | "national" | "private";
  readonly field?: "humanities" | "science" | "medical" | "other";
  readonly living?: "home" | "away";
  readonly years?: number;
  readonly delayYears?: number;
  readonly from?: Timepoint;
  readonly monthly?: Yen;
  readonly school?: {
    readonly school: string;
    readonly unit: string;
    readonly track?: string | null;
    readonly termStartMonth?: number;
    readonly rows: readonly TuitionRow[];
    readonly source: { readonly pack: string; readonly version: string; readonly fictional?: boolean };
  };
  readonly annualOverride?: Yen;
  readonly entranceOverride?: Yen;
  readonly exam?: { readonly amount?: Yen; readonly deposits?: Yen };
  readonly outOfSchool?: "statistics" | "none" | { readonly monthly: Yen };
  readonly boarding?: { readonly monthly?: Yen; readonly initial?: Yen };
  readonly scienceAgriculture?: boolean;
}

export interface EducationGoalInput {
  readonly stages: readonly EducationStageInput[];
  readonly lessons?: readonly { readonly from: Timepoint; readonly to: Timepoint; readonly monthly: Yen; readonly label?: string }[];
  readonly scholarships?: readonly {
    readonly monthly: Yen;
    readonly from: Timepoint;
    readonly to: Timepoint;
    readonly rate: string;
    readonly termMonths: number;
    readonly repaymentStart?: Timepoint;
    readonly debtor?: "child" | "parent";
  }[];
  readonly loans?: readonly { readonly at: Timepoint; readonly amount: Yen; readonly rate: string; readonly termMonths: number; readonly borrower: string }[];
  readonly gifts?: readonly {
    readonly at: Timepoint;
    readonly amount: Yen;
    readonly purpose: "wedding" | "housing" | "other";
    readonly payer?: string;
    readonly taxMethod?: "calendar" | "settlement";
    readonly housingExemption?: "energySaving" | "other" | "none";
  }[];
  readonly childAllowance?: boolean;
  readonly highSchoolSupport?: "eligible" | "ineligible";
}

export interface GoalInput {
  readonly id: string;
  readonly kind: "education" | "housing" | "retirement" | "other";
  readonly owner: string;
  readonly education?: EducationGoalInput;
}

export interface EngineInput {
  readonly baseMonth: string;
  readonly endYear: number;
  readonly calcConventions: CalcConventions;
  readonly dataSet?: Readonly<Record<string, string>>;
  readonly household: HouseholdInput;
  readonly assumptions: {
    readonly investmentReturn: YearSeries;
    readonly wageGrowth?: YearSeries;
    readonly inflation?: YearSeries;
    readonly educationInflation?: YearSeries;
    readonly pensionMacroSlide?: YearSeries;
    readonly pensionMacroSlideEmployee?: YearSeries;
    readonly assetReturns?: Readonly<Record<string, YearSeries>>;
    readonly withdrawal?: { readonly order?: readonly ({ readonly kind: AccountKind } | { readonly object: string })[]; readonly minimumDeposit?: Yen };
    readonly marketShocks?: readonly MarketShock[];
    readonly loanRateShifts?: readonly { readonly from: string; readonly add: string }[];
    readonly incomeShocks?: readonly IncomeShock[];
  };
  readonly contingencies?: readonly ContingencyInput[];
  readonly stressTest?: StressTestInput;
  readonly protection?: ProtectionRequest;
}

export interface MarketShock {
  readonly year: number;
  readonly drop: string;
  readonly kinds?: readonly AccountKind[];
}

export interface IncomeShock {
  readonly member: string;
  readonly from: string;
  readonly to: string;
  readonly ratio: string;
}

export interface EngineRequest {
  readonly trace: "none" | "summary" | "full";
  readonly input: EngineInput;
}

/** 0003 の2: 支払月ごとのお金の動き1件 */
export interface Flow {
  readonly row: string;
  readonly ym: string;
  readonly amount: Yen;
  readonly accrualYear: number;
  readonly member?: string;
  readonly object?: string;
  readonly formula: string;
}

/** 年に1回決まる行（残高・運用益など） */
export interface AnnualRow {
  readonly row: string;
  readonly year: number;
  readonly amount: Yen;
  readonly member?: string;
  readonly object?: string;
  readonly formula: string;
}

export interface FlowsOutput {
  readonly flows: readonly Flow[];
}

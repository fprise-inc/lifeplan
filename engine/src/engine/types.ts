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

/** 第1号の期間の内訳の月数 */
export interface Category1Months {
  readonly paid: number;
  readonly exemptQuarter?: number;
  readonly exemptHalf?: number;
  readonly exemptThreeQuarters?: number;
  readonly exemptFull?: number;
  /** 学生納付特例・納付猶予 */
  readonly deferred?: number;
}

export interface PensionRecordInput {
  readonly id: string;
  readonly member: string;
  readonly kind: "statementUnder50" | "statementOver50" | "receiving" | "history" | "projection";
  readonly asOf: string;
  readonly months?: {
    readonly basic: number;
    readonly employee: number;
    readonly employee2059?: number;
    readonly qualifying?: number;
    /** 第1号の期間の内訳（納付済・免除の種類・学生納付特例と納付猶予）。2026-10-10 に足した任意の欄 */
    readonly category1?: Category1Months;
  };
  readonly amounts?: {
    readonly basic?: ValueBox<Yen>;
    readonly employee?: ValueBox<Yen>;
    readonly transitional?: ValueBox<Yen>;
    readonly special?: ValueBox<Yen>;
  };
  readonly history?: readonly {
    readonly from: string;
    readonly to: string;
    readonly category:
      | "national1"
      | "national1Unpaid"
      | "national1ExemptQuarter"
      | "national1ExemptHalf"
      | "national1ExemptThreeQuarters"
      | "national1ExemptFull"
      | "national1Deferred"
      | "national3"
      | "employee";
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
  | "smallBusinessMutualAid"
  | "otherAsset"
  | "pooled";

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
  readonly payout?: {
    /** 受け取りの始まり（省略は退職の年。60〜65歳の範囲に収める。0026） */
    readonly start?: Timepoint;
    readonly method: "lumpSum" | "annuity" | "mixed";
    readonly annuityYears?: number;
    readonly lumpShare?: string;
    /** 受け取ったお金の行き先（deposit は預金。invest は NISA に入れ、枠を超えた分は課税口座。省略は deposit。0026） */
    readonly destination?: "deposit" | "invest";
  };
  /** 評価額の増減率（年率。不動産・その他の資産だけで使う。入れたときは資産の配分の利回りの代わり） */
  readonly valueGrowth?: string;
  /** FP が入れた器の利回り（年率。入れたときは資産の配分の利回りの代わり。0026） */
  readonly expectedReturn?: string;
  /** 運用の費用（信託報酬など。年率。器の利回りから引く。0026） */
  readonly fee?: string;
  /** 運用しない分（金額。まとめた金融資産の器 pooled だけで使う。この額までは預金の利回りで、残りに器の利回りをかける。0031） */
  readonly uninvested?: Yen;
  /** 不動産の中身（不動産の器だけ。土地と建物に分けて評価し、貸しているなら家賃収入・経費・不動産所得を出す。asset.realEstate。0028） */
  readonly property?: RealEstatePropertyInput;
}

/** 住まい以外の不動産の中身（0028）。入れた器は、評価額を土地と建物に分け、家賃収入・経費・売却を計算する */
export interface RealEstatePropertyInput {
  /** 建物の構造（省略は木造） */
  readonly structure?: BuildingStructure;
  /** 建物が建った年（省略は取得の年。取得も無ければ時価の時点の年＝新築とみなす） */
  readonly builtYear?: number;
  /** 土地の割合（評価額と取得価額を土地と建物に分ける。省略は前提の realEstateValuation.landShare か目安） */
  readonly landShare?: string;
  /** 取得（減価償却の基。price は土地と建物の合計の取得価額、at は取得の年月） */
  readonly acquisition?: { readonly price: Yen; readonly at: string };
  /** 貸している（家賃収入） */
  readonly rental?: {
    /** 月額の家賃（空室を見込む前） */
    readonly monthly: ValueBox<Yen>;
    /** 空室を見込む割合（省略は0） */
    readonly vacancyRate?: string;
    /** 家賃の変化率（年率。マイナスも書ける。省略は0） */
    readonly growth?: string;
    /** 貸し始め（省略は取得の月。取得も無ければ前から貸している） */
    readonly from?: Timepoint;
    /** 貸し終わり（その月まで。省略は売却の前の月か表の最後） */
    readonly to?: Timepoint | null;
  };
  /** 経費（管理費・修繕積立金・固定資産税・管理委託料など）。年額（持っている間）と、受け取る家賃に対する割合の合計 */
  readonly expenses?: { readonly annual?: ValueBox<Yen>; readonly rate?: string; readonly growth?: string };
  /** 売却の予定（その月に売り、手取りを現金にする） */
  readonly sale?: { readonly at: Timepoint; readonly price?: Yen; readonly costRate?: string };
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
  /** この借入で取得した住まい以外の不動産（不動産の器の ID。利息を不動産所得の必要経費にする。0028） */
  readonly property?: string;
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
      /** 贈与者（世帯の外の親族。donors の ID）。同じ贈与者からの贈与を合わせて数える */
      readonly donor?: string;
      readonly amount: Yen;
      readonly taxMethod?: "calendar" | "settlement";
      readonly housingExemption?: "energySaving" | "other" | "none";
    }[];
  };
  readonly propertyTax?: { readonly annual: ValueBox<Yen>; readonly growth?: string };
  readonly maintenance?: { readonly monthly: ValueBox<Yen>; readonly growth?: string };
  readonly ownership?: readonly { readonly member: string; readonly share: string }[];
  /** 持ち家の評価（土地と建物に分け、土地は上昇率、建物は耐用年数で減らす。housing.valuation） */
  readonly valuation?: ResidenceValuationInput;
  /** 売却（住み終わりの月に売り、手取りを現金にする） */
  readonly sale?: { readonly price?: Yen; readonly costRate?: string };
}

/** 建物の構造（耐用年数の目安を選ぶ） */
export type BuildingStructure = "wood" | "lightSteel" | "steel" | "rc";

export interface ResidenceValuationInput {
  /** 評価の基にする額（asOf の時点の土地と建物の合計。省略は購入の価格） */
  readonly value?: ValueBox<Yen>;
  /** value の時点（省略は購入の月。購入が無ければ計算基準月） */
  readonly asOf?: string;
  readonly structure?: BuildingStructure;
  /** 建物が建った年（省略は asOf の年。新築とみなす） */
  readonly builtYear?: number;
  /** 土地の割合（省略は前提の realEstateValuation.landShare か目安） */
  readonly landShare?: string;
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
  readonly donors?: readonly DonorInput[];
}

/** 贈与者（世帯の外の親族。0008 の追記 2026-10-10 の決定1） */
export interface DonorInput {
  readonly id: string;
  readonly kind: "parent" | "grandparent" | "other";
  /** 誰の親・祖父母か（構成員の ID）。省略は受け取る人の親・祖父母とみなす */
  readonly of?: string;
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

/** 障害年金の65歳からの組み合わせ: 障害基礎＋障害厚生・老齢基礎＋老齢厚生・障害基礎＋老齢厚生 */
export type OldAgeChoice = "disability" | "oldAge" | "disabilityBasicOldAgeEmployee";

/** 0008 の5: 万一の想定（要求1つに1件まで） */
export interface ContingencyInput {
  readonly id: string;
  readonly kind: ContingencyKind;
  readonly member: string;
  readonly occurs: Timepoint;
  readonly grade?: 1 | 2 | 3;
  readonly recovery?: Timepoint;
  /** 障害年金の65歳からの組み合わせ（FP が選び直したとき。省略は自動） */
  readonly oldAgeChoice?: OldAgeChoice;
  readonly survivor?: {
    readonly livingRatio?: { readonly beforeIndependence?: string; readonly afterIndependence?: string; readonly noChildren?: string };
    readonly independenceAge?: number;
    readonly funeral?: Yen;
    readonly reserveMonths?: number;
    readonly deathBenefits?: { readonly retirementAllowance?: Yen; readonly condolence?: Yen; readonly workRelated?: boolean };
    readonly spouseWork?: readonly EmploymentPeriodInput[];
  };
  readonly medical?: { readonly monthly: Yen; readonly months: number; readonly from?: Timepoint };
}

export type StressTemplate = "marketDropAtRetirement" | "inflationSpike" | "rateRise" | "incomeDrop" | "lowReturnPeriod" | "returnShortfall";

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
    /** 下げる資産クラス（marketDropAtRetirement。0026） */
    readonly assetClasses?: readonly string[];
    /** 利回りの上限（lowReturnPeriod。0026） */
    readonly cap?: string;
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
  /** 維持費の合計の年額（まとめて入れるとき。毎月12分の1） */
  readonly upkeep?: { readonly annual: Yen };
  readonly parking?: { readonly annual: Yen };
  readonly fuel?: { readonly annual: Yen };
  readonly growth?: GrowthInput;
  readonly onContingency?: OnContingencyInput;
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
  /** 保育所の保育の時間（保育標準時間・保育短時間。省略は standard） */
  readonly hours?: "standard" | "short";
  /** 保育料の自動の計算で、国の基準に掛ける自治体の水準の割合（省略は目安の 0.8。0029） */
  readonly feeRatio?: string;
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
    /** 世帯の外の贈与者（donors の ID）が出すとき。世帯からは出さない */
    readonly donor?: string;
    readonly taxMethod?: "calendar" | "settlement";
    readonly housingExemption?: "energySaving" | "other" | "none";
  }[];
  readonly childAllowance?: boolean;
  readonly highSchoolSupport?: "eligible" | "ineligible";
  /** 公立の小学校・中学校の学校給食費（free は自治体が無償化、paid は全額を払う。省略は制度データどおり。0029） */
  readonly schoolLunch?: "free" | "paid";
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
    readonly realEstateValuation?: RealEstateValuationSetting;
    readonly investment?: InvestmentSetting;
    /** 資産クラスごとの値動きの大きさ（年率の標準偏差。計算には使わない。結果の幅の計算の材料。0026） */
    readonly assetVolatility?: Readonly<Record<string, string>>;
    readonly returnShifts?: readonly ReturnShift[];
    /** 黒字のうち貯まる割合・上限（黒字の年だけ、貯まらない分を「ゆとりの支出」として支出に足す。0031） */
    readonly surplusSaving?: SurplusSavingSetting;
    /** 生活防衛資金（取り崩さないお金。運用せず、取り崩しは最後。「金融資産は○歳まで持つ」の判定から除く。0031） */
    readonly emergencyReserve?: EmergencyReserveSetting;
  };
  readonly contingencies?: readonly ContingencyInput[];
  readonly stressTest?: StressTestInput;
  readonly protection?: ProtectionRequest;
}

/** 持ち家の評価の前提（世帯ごと・事務所の標準で変えられる。省略した項目は housing.valuation の目安） */
export interface RealEstateValuationSetting {
  /** 土地の上昇率（年ごとの列。省略は物価上昇率） */
  readonly landGrowth?: YearSeries;
  /** 土地の割合（物件ごとの入力が無いとき） */
  readonly landShare?: string;
  /** 建物の耐用年数（構造ごと。年） */
  readonly usefulLife?: Partial<Readonly<Record<BuildingStructure, number>>>;
  /** 建物の残りの価値の下限（建てた時の価値に対する割合） */
  readonly residualFloor?: string;
  /** 売却の費用（売却価格に対する割合。仲介手数料・印紙税など） */
  readonly saleCostRate?: string;
}

export interface MarketShock {
  readonly year: number;
  readonly drop: string;
  readonly kinds?: readonly AccountKind[];
  /** 下げる資産クラス（書いたときは、器の資産の配分のうちその資産クラスの割合だけ下げる。0026） */
  readonly assetClasses?: readonly string[];
}

/** 資産運用の入れ方と、運用・取り崩しの前提（0026） */
export interface InvestmentSetting {
  /** 入れ方: total は合計（まとめた金融資産の器だけ）、accounts は口座ごと、allocation は口座ごと＋資産配分。省略は accounts */
  readonly method?: "total" | "accounts" | "allocation";
  /** 資産配分（allocation のときに、運用する器に共通で使う） */
  readonly allocation?: {
    readonly mix: readonly { readonly assetClass: string; readonly share: string }[];
    /** 信託報酬など（年率。利回りから引く） */
    readonly fee?: string;
    /** 年に1回、元の割合に戻す（省略は true） */
    readonly rebalance?: boolean;
  };
  /** NISA の枠を超えた積立の扱い: deposit は預金に残す、taxable は課税口座で続ける。省略は deposit */
  readonly nisaOverflow?: "deposit" | "taxable";
  /** 課税口座の税: onSale は売るときに利益に、annual は毎年の運用益に。省略は onSale */
  readonly taxableTax?: "onSale" | "annual";
  /** 取り崩しの計画（start の月から、毎月の額か、毎年の初めの残高の率を金融資産から使う） */
  readonly drawdown?: { readonly start: Timepoint; readonly method: "fixed" | "rate"; readonly monthly?: Yen; readonly rate?: string };
}

/** 黒字のうち貯まる割合・上限の1組（0031）。ratio は 0〜1（省略は 1）、cap は貯まる額の年の上限（省略は上限なし） */
export interface SurplusSavingRule {
  readonly ratio?: string;
  readonly cap?: Yen;
}

/** 黒字のうち貯まる割合（0031）。changes は from の年から書いた組に置き換える（書いていない ratio は 1、cap は上限なし） */
export interface SurplusSavingSetting extends SurplusSavingRule {
  readonly changes?: readonly (SurplusSavingRule & { readonly from: Timepoint })[];
}

/** 生活防衛資金（0031）。amount があれば金額、無ければその年の基本生活費の months か月分 */
export interface EmergencyReserveSetting {
  readonly months?: number;
  readonly amount?: Yen;
  /** 「金融資産は○歳まで持つ」の判定に生活防衛資金を含める（省略は false＝除いた残高で判定する） */
  readonly countInLasting?: boolean;
}

/** 運用の利回りの書き換え（運用する器だけ。from〜to の年。add を足し、cap より高ければ cap にする。0026） */
export interface ReturnShift {
  readonly from: number;
  readonly to?: number;
  readonly add?: string;
  readonly cap?: string;
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

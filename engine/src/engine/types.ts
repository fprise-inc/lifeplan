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

export interface EmploymentPeriodInput {
  readonly id: string;
  readonly member: string;
  readonly from: Timepoint;
  readonly to: Timepoint | null;
  readonly type: "regular" | "contract" | "partTime" | "selfEmployed" | "civilServant" | "leave" | "unemployed";
  readonly leaveKind?: "maternity" | "childcare" | "sick" | "other";
  readonly healthInsurance: {
    readonly kind: "kyokaikenpo" | "union" | "mutualAid" | "national" | "dependent" | "continuation" | "lateElderly";
    readonly insurer?: string;
    readonly employeeRate?: ValueBox<string>;
    readonly careEmployeeRate?: ValueBox<string>;
    readonly childSupportEmployeeRate?: ValueBox<string>;
  };
  readonly pensionCategory: "employee1" | "employee2" | "employee3" | "employee4" | "none";
  readonly employer: { readonly size: number; readonly weeklyHours: string; readonly industry?: "general" | "agricultureEtc" | "construction" };
  readonly employmentInsuranceCovered?: boolean;
  readonly salary: {
    readonly annual: ValueBox<Yen>;
    readonly bonus: ValueBox<Yen>;
    readonly bonusMonths?: readonly number[];
    readonly commutingMonthly?: ValueBox<Yen>;
  };
  readonly standardMonthlyRemuneration?: { readonly health: ValueBox<Yen>; readonly pension: ValueBox<Yen> };
  readonly endsOnMonthEnd?: boolean;
  readonly retirementBenefit?: string;
  readonly endsWith?: string;
}

export interface AccountInput {
  readonly id: string;
  readonly kind: string;
  readonly owner: string;
  readonly marketValue: ValueBox<Yen>;
  readonly costBasis?: ValueBox<Yen>;
  readonly asOf: string;
  readonly contributions: readonly { readonly from: Timepoint; readonly to: Timepoint | null; readonly monthly: Yen; readonly tranche?: string }[];
}

export interface InsuranceContractInput {
  readonly id: string;
  readonly template: string;
  readonly policyholder: string;
  readonly insured: string;
  readonly contractDate: string;
  readonly currency: "JPY";
  readonly premium: { readonly amount: Yen; readonly frequency: "monthly" | "annual"; readonly payUntil: Timepoint | null };
  readonly deductionCategory: {
    readonly type: "general" | "careMedical" | "pension" | "earthquake" | "longTermNonLife" | "none";
    readonly regime?: "new" | "old";
  };
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
}

export interface EngineInput {
  readonly baseMonth: string;
  readonly endYear: number;
  readonly calcConventions: CalcConventions;
  readonly dataSet?: Readonly<Record<string, string>>;
  readonly household: HouseholdInput;
  readonly assumptions: { readonly investmentReturn: YearSeries; readonly wageGrowth?: YearSeries };
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

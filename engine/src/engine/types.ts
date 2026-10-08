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

export interface MemberInput {
  readonly id: string;
  readonly kind: string;
  readonly birth: Birth;
}

export interface EventInput {
  readonly id: string;
  readonly kind: string;
  readonly member?: string;
  readonly at: Timepoint;
}

export interface FlowInput {
  readonly id: string;
  readonly row: string;
  readonly amount: Yen;
  readonly from: Timepoint;
  readonly to: Timepoint | null;
  readonly member?: string;
}

export interface AnnualLumpSumInput {
  readonly id: string;
  readonly amount: Yen;
  readonly month: number;
  readonly from: Timepoint;
  readonly to: Timepoint | null;
  readonly paidNextYear: boolean;
  readonly member?: string;
}

export interface EngineInput {
  readonly baseMonth: string;
  readonly endYear: number;
  readonly calcConventions: CalcConventions;
  readonly dataSet?: Readonly<Record<string, string>>;
  readonly members: readonly MemberInput[];
  readonly events: readonly EventInput[];
  readonly assumptions: { readonly investmentReturn: YearSeries };
  readonly flows: readonly FlowInput[];
  readonly annualLumpSums: readonly AnnualLumpSumInput[];
  readonly openingBalance: Yen;
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

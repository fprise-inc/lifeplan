// 世帯データ（0008）のうち、ヒアリングシートが読み書きする部分の型。正は engine/schemas/engine.input.json（JSON Schema）。
// engine/src/engine/types.ts は金額を印つきの型（Yen）にしているので、組み立てやすい素の数の写しをここに持つ（app/src/engine/types.ts と同じ考え方）。
// 取り込んだ世帯が正の形かは、テストで計算エンジンに通して確かめる

export interface ValueBox<T> {
  value?: T;
  state: "confirmed" | "unknown" | "notApplicable" | "estimated";
  origin: { kind: string; ref?: string; connector?: string };
  approval?: { by: "fp"; at: string; candidate?: string };
  estimate?: { method: string; basis: string };
  substitute?: ValueBox<T>;
}

export type Timepoint = { at: string } | { memberAge: { member: string; years: number; months?: number } } | { event: string; offset?: { years?: number; months?: number } };

export interface Member {
  id: string;
  kind: "self" | "spouse" | "child" | "parent" | "grandparent" | "other";
  birth: { birthYearMonth: string; bornOnFirst: boolean };
  sex: "female" | "male";
  joins: Timepoint | null;
  leaves: Timepoint | null;
  expected: boolean;
}

export type Relation =
  | { type: "spouse"; a: string; b: string; marriage: "legal" | "deFacto"; from: Timepoint | null; to: Timepoint | null }
  | { type: "parentOf"; parent: string; child: string };

export interface EmploymentPeriod {
  id: string;
  member: string;
  from: Timepoint;
  to: Timepoint | null;
  type: "regular" | "contract" | "partTime" | "selfEmployed" | "civilServant" | "executive" | "leave" | "unemployed";
  leaveKind?: "maternity" | "childcare" | "sick" | "care" | "other";
  healthInsurance?: { kind: string; insurer?: string; employeeRate?: ValueBox<string> };
  pensionCategory?: "employee1" | "employee2" | "employee3" | "employee4" | "none";
  employer?: { size: number; weeklyHours: string; fullTimeWeeklyHours?: string; industry?: string };
  salary?: { annual: ValueBox<number>; bonus: ValueBox<number> };
  business?: { income: ValueBox<number> };
  standardMonthlyRemuneration?: { health: ValueBox<number>; pension: ValueBox<number> };
}

export interface PensionRecord {
  id: string;
  member: string;
  kind: "statementUnder50" | "statementOver50" | "receiving" | "history" | "projection";
  asOf: string;
  months?: { basic: number; employee: number };
  amounts?: { basic?: ValueBox<number>; employee?: ValueBox<number> };
}

export interface ResidentTaxAssessment {
  id: string;
  member: string;
  fiscalYear: number;
  amount: ValueBox<number>;
}

export interface Account {
  id: string;
  kind: string;
  owner: string;
  marketValue: ValueBox<number>;
  asOf: string;
  contributions: { from: Timepoint; to: Timepoint | null; monthly: number }[];
}

export interface RateStep {
  from: Timepoint;
  type: "fixed" | "variable" | "fixedPeriod";
  rate: string;
}

export interface Debt {
  id: string;
  kind: "mortgage" | "car" | "scholarship" | "other";
  debtors: { member: string; role: "primary" | "joint" | "guarantor"; share?: string }[];
  principal: number;
  start: Timepoint;
  balance?: ValueBox<number>;
  balanceAsOf?: string;
  rateSchedule: RateStep[];
  repayment: { method: "equalPayment" | "equalPrincipal"; termMonths: number };
  creditLife?: { covered: string[] };
}

export interface Residence {
  id: string;
  kind: "rent" | "own";
  from: Timepoint;
  to: Timepoint | null;
  rent?: { monthly: ValueBox<number> };
  propertyTax?: { annual: ValueBox<number> };
  maintenance?: { monthly: ValueBox<number> };
}

export interface Coverage {
  id: string;
  role: "main" | "rider";
  benefit: string;
  amount: number;
}

export interface InsuranceContract {
  id: string;
  template: string;
  policyholder: string;
  insured: string;
  contractDate: string;
  currency: "JPY";
  premium: { amount: number; frequency: "monthly" | "annual" | "single"; payUntil: Timepoint | null };
  deductionCategory: { type: string; regime?: "new" | "old" };
  coverages?: Coverage[];
}

export interface LivingExpense {
  id: string;
  mode: "total" | "byCategory";
  from?: Timepoint;
  to?: Timepoint | null;
  monthly?: ValueBox<number>;
  categories?: { category: string; monthly: ValueBox<number> }[];
}

export interface SavingsCheck {
  id: string;
  year: number;
  actualSavings: ValueBox<number>;
  treatment: "addToLiving" | "keepUnexplained";
}

export interface RetirementBenefit {
  id: string;
  member: string;
  kind: string;
  employment?: string;
  amount?: ValueBox<number>;
}

export interface EducationStage {
  stage: string;
  sector?: "public" | "national" | "private";
  field?: "humanities" | "science" | "medical" | "other";
  living?: "home" | "away";
}

export interface Goal {
  id: string;
  kind: "education" | "housing" | "retirement" | "other";
  owner: string;
  education?: { stages: EducationStage[] };
}

export interface Household {
  members: Member[];
  relations: Relation[];
  events: { id: string; kind: string; member?: string; at: Timepoint }[];
  employmentPeriods: EmploymentPeriod[];
  accounts: Account[];
  insuranceContracts: InsuranceContract[];
  residentTaxAssessments?: ResidentTaxAssessment[];
  pensionRecords?: PensionRecord[];
  debts?: Debt[];
  residences?: Residence[];
  livingExpenses?: LivingExpense[];
  savingsChecks?: SavingsCheck[];
  retirementBenefits?: RetirementBenefit[];
  goals?: Goal[];
}

export interface EngineRequest {
  trace: "none" | "summary" | "full";
  input: {
    baseMonth: string;
    endYear: number;
    calcConventions: { aggregation: "cash" | "accrual"; investmentTiming: "midYear" | "beginning" | "end"; compatibility: null };
    household: Household;
    assumptions: Record<string, unknown>;
    [k: string]: unknown;
  };
}

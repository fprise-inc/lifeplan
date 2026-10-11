// 計算エンジンの入出力のうち、画面が使う部分の型（正は engine/schemas/ の JSON Schema。0006 の5）

/** 値の箱（0008 の2） */
export interface Box<T> {
  value: T | null;
  state: string;
  origin: { kind: string };
}

export interface Timepoint {
  at?: string;
  event?: string;
  memberAge?: { member: string; years: number; months: number };
}

export interface Member {
  id: string;
  kind: "self" | "spouse" | "child" | "parent" | "grandparent" | "other" | string;
  birth: { birthYearMonth: string; bornOnFirst: boolean };
  sex: "male" | "female" | string;
  joins?: Timepoint | null;
  leaves?: Timepoint | null;
  expected?: boolean;
  support?: { dependent?: boolean; cohabiting?: boolean; allowance?: number };
}

export type Relation = { type: "spouse"; a: string; b: string; marriage: "legal" | "deFacto"; from: Timepoint | null; to: Timepoint | null } | { type: "parentOf"; parent: string; child: string };

export interface HouseholdEvent {
  id: string;
  kind: string;
  member?: string;
  at: Timepoint;
}

export interface EmploymentPeriod {
  id: string;
  member: string;
  from: Timepoint;
  to: Timepoint | null;
  type: string;
  leaveKind?: string;
  healthInsurance?: { kind: string; insurer?: string; [key: string]: unknown };
  pensionCategory?: string;
  employer?: { size?: number; weeklyHours?: string; [key: string]: unknown };
  salary?: { annual: Box<number>; bonus?: Box<number>; [key: string]: unknown };
  business?: { income: Box<number> };
  standardMonthlyRemuneration?: { health: Box<number>; pension: Box<number> };
  [key: string]: unknown;
}

export interface Account {
  id: string;
  kind: string;
  owner: string;
  marketValue?: Box<number>;
  costBasis?: Box<number>;
  asOf?: string;
  assetMix?: { assetClass: string; share: string }[];
  contributions?: { from: Timepoint; to: Timepoint | null; monthly: number; [key: string]: unknown }[];
  [key: string]: unknown;
}

export interface LivingExpense {
  id: string;
  mode: string;
  monthly?: Box<number>;
  categories?: { category: string; monthly: Box<number> }[];
  growth?: { kind: string; rate?: string };
  stages?: { at: Timepoint; label: string; ratio?: string; monthly?: Box<number> }[];
  [key: string]: unknown;
}

export interface PensionRecord {
  id: string;
  member: string;
  kind: string;
  asOf?: string;
  months?: { basic?: number; employee?: number; employee2059?: number; qualifying?: number; category1?: Record<string, number> };
  amounts?: { basic?: Box<number>; employee?: Box<number>; transitional?: Box<number>; special?: Box<number> };
  history?: { from: string; to: string; category: string; averageRemuneration?: number; averageRemunerationAtTime?: number }[];
  claim?: { basic?: Timepoint; employee?: Timepoint };
  [key: string]: unknown;
}

export interface EducationStage {
  stage: string;
  sector?: string;
  field?: string;
  living?: string;
  years?: number;
  delayYears?: number;
  monthly?: number;
  exam?: { amount?: number; deposits?: number };
  [key: string]: unknown;
}

export interface EducationGift {
  at: Timepoint;
  amount: number;
  purpose: string;
  payer?: string;
  donor?: string;
  [key: string]: unknown;
}

export interface Goal {
  id: string;
  kind: string;
  owner?: string;
  priority?: "need" | "want" | "wish";
  education?: { stages: EducationStage[]; lessons?: { from: Timepoint; to: Timepoint; monthly: number; label?: string }[]; gifts?: EducationGift[]; childAllowance?: boolean; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PeriodicExpense {
  id: string;
  row: string;
  label?: string;
  from: Timepoint;
  to?: Timepoint | null;
  everyYears: number;
  amount: Box<number>;
  [key: string]: unknown;
}

export interface Debt {
  id: string;
  kind: string;
  debtors: { member: string; role: string; share?: string }[];
  principal: number;
  start: Timepoint;
  balance?: Box<number>;
  balanceAsOf?: string;
  rateSchedule: { from: Timepoint; type: string; rate: string }[];
  repayment: { method: string; termMonths: number; bonusShare?: string; variableRules?: { fiveYear?: boolean; cap125?: boolean }; [key: string]: unknown };
  prepayments?: { at: Timepoint; amount: number; mode: string; fee?: number }[];
  creditLife?: { covered: string[]; ratio?: string; events?: string[]; [key: string]: unknown };
  pairWith?: string;
  [key: string]: unknown;
}

export interface Gift {
  recipient: string;
  giver: string;
  donor?: string;
  amount: number;
  [key: string]: unknown;
}

export interface Residence {
  id: string;
  kind: "rent" | "own" | string;
  from: Timepoint;
  to: Timepoint | null;
  rent?: { monthly: Box<number>; [key: string]: unknown };
  purchase?: { at: Timepoint; price: number; downPayment?: number; costs?: number; gifts?: Gift[] };
  propertyTax?: { annual: Box<number>; growth?: string };
  maintenance?: { monthly: Box<number>; growth?: string };
  ownership?: { member: string; share: string }[];
  [key: string]: unknown;
}

export interface Coverage {
  id: string;
  role: string;
  benefit: string;
  amount: number;
  from: Timepoint;
  to: Timepoint | null;
  [key: string]: unknown;
}

export interface InsuranceContract {
  id: string;
  template: string;
  policyholder: string;
  insured: string;
  contractDate: string;
  currency: string;
  premium: { amount: number; frequency: string; payUntil: Timepoint | null };
  beneficiaries?: unknown[];
  coverages?: Coverage[];
  deductionCategory: { type: string; regime: string };
  [key: string]: unknown;
}

export interface Donor {
  id: string;
  kind: "parent" | "grandparent" | "other" | string;
  of?: string;
}

export interface CareExpense {
  id: string;
  member: string;
  payer?: string;
  from: Timepoint;
  months?: number;
  place?: string;
  serviceMonthly?: Box<number>;
  otherMonthly?: Box<number>;
  initial?: Box<number>;
  [key: string]: unknown;
}

export interface RetirementBenefit {
  id: string;
  member: string;
  kind: string;
  employment?: string;
  amount?: Box<number>;
  paidAt?: Timepoint;
  [key: string]: unknown;
}

export interface YearSeries {
  default: string;
  byYear?: Record<string, string>;
}

export interface Household {
  members: Member[];
  relations?: Relation[];
  events?: HouseholdEvent[];
  employmentPeriods?: EmploymentPeriod[];
  accounts?: Account[];
  insuranceContracts?: InsuranceContract[];
  livingExpenses?: LivingExpense[];
  pensionRecords?: PensionRecord[];
  goals?: Goal[];
  periodicExpenses?: PeriodicExpense[];
  debts?: Debt[];
  residences?: Residence[];
  donors?: Donor[];
  careExpenses?: CareExpense[];
  retirementBenefits?: RetirementBenefit[];
  [key: string]: unknown;
}

export interface EngineRequest {
  trace: "none" | "summary" | "full";
  input: {
    baseMonth: string;
    endYear: number;
    household: Household;
    assumptions?: { investmentReturn: YearSeries; wageGrowth?: YearSeries; inflation?: YearSeries; educationInflation?: YearSeries; pensionMacroSlide?: YearSeries; assetReturns?: Record<string, YearSeries>; [key: string]: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** 表の1マス（行×年。0004・0006 の追記） */
export interface TableCell {
  row: string;
  year: number;
  amount: number;
  member?: string;
  object?: string;
}

export interface EngineHeader {
  engine: { version: string; sourceDigest: string };
  baseMonth: string;
  endYear: number;
  calcConventions?: { aggregation?: string };
  notices?: { code: string; ids: string[] }[];
  [key: string]: unknown;
}

/** 表示の形（先出し・engine.preview）: 見出し・表・要約 */
export interface PreviewResult {
  header: EngineHeader;
  table: TableCell[];
  summary: unknown;
}

export interface Flow {
  row: string;
  ym: string;
  amount: number;
  accrualYear: number;
  member?: string;
  object?: string;
  formula: string;
}

export interface AnnualRow {
  row: string;
  year: number;
  amount: number;
  member?: string;
  object?: string;
  formula: string;
}

export interface TraceSource {
  locator?: string;
  url?: string;
  type?: string;
  retrievedAt?: string;
}

export type TraceNode =
  | { type: "call"; component: string; uses: number[] }
  | { type: "param"; id: string; ref: string; value: unknown; packVersion: string; appliesFrom: string | null; appliesTo: string | null; sources: TraceSource[] }
  | { type: "input"; collection: string; object?: string; value: unknown }
  | { type: "rounding"; rule: string; op: string; input: string; result: number }
  | { type: "timepoint"; ym: string; [key: string]: unknown };

/** 出力全体（根拠の記録「全部」つき。0006 の7） */
export interface FullResult extends PreviewResult {
  flows: Flow[];
  annual: AnnualRow[];
  trace: { mode: string; nodes: TraceNode[]; flows: number[]; annual: number[] };
}

/** エンジン・ホストのエラー（値を含まない。0005 の8） */
export interface EngineError {
  error: { code: string; ids: string[] };
}

export function isEngineError(x: unknown): x is EngineError {
  return typeof x === "object" && x !== null && "error" in x;
}

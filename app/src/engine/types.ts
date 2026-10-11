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
  kind: "self" | "spouse" | "child" | "parent" | "other" | string;
  birth: { birthYearMonth: string; bornOnFirst: boolean };
  sex: "male" | "female" | string;
  leaves?: Timepoint | null;
}

export interface EmploymentPeriod {
  id: string;
  member: string;
  from: Timepoint;
  to: Timepoint | null;
  type: string;
  salary?: { annual: Box<number>; bonus?: Box<number> };
  [key: string]: unknown;
}

export interface Account {
  id: string;
  kind: string;
  owner: string;
  contributions?: { from: Timepoint; to: Timepoint; monthly: number }[];
  [key: string]: unknown;
}

export interface LivingExpense {
  id: string;
  mode: string;
  monthly?: Box<number>;
  stages?: { at: Timepoint; label: string; ratio: string }[];
  [key: string]: unknown;
}

export interface PensionRecord {
  id: string;
  member: string;
  kind: string;
  claim?: { basic?: Timepoint; employee?: Timepoint };
  [key: string]: unknown;
}

export interface EducationStage {
  stage: string;
  sector?: string;
  field?: string;
  living?: string;
}

export interface Goal {
  id: string;
  kind: string;
  owner?: string;
  priority?: "need" | "want" | "wish";
  education?: { stages: EducationStage[] };
  [key: string]: unknown;
}

export interface PeriodicExpense {
  id: string;
  row: string;
  everyYears: number;
  amount: Box<number>;
  [key: string]: unknown;
}

export interface Household {
  members: Member[];
  employmentPeriods?: EmploymentPeriod[];
  accounts?: Account[];
  livingExpenses?: LivingExpense[];
  pensionRecords?: PensionRecord[];
  goals?: Goal[];
  periodicExpenses?: PeriodicExpense[];
  debts?: { id: string; kind: string }[];
  [key: string]: unknown;
}

export interface EngineRequest {
  trace: "none" | "summary" | "full";
  input: {
    baseMonth: string;
    endYear: number;
    household: Household;
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

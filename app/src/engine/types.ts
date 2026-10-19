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
  contributions?: { from: Timepoint; to: Timepoint | null; monthly: number; tranche?: string; payer?: "self" | "employer"; [key: string]: unknown }[];
  /** 評価額の増減率（年率。不動産・その他の資産だけ） */
  valueGrowth?: string;
  /** FP が入れた器の利回り（年率。0026） */
  expectedReturn?: string;
  /** 運用の費用（信託報酬など。年率。0026） */
  fee?: string;
  /** iDeCo・企業型DC の受け取り（始まりが空なら退職の年。0026） */
  payout?: { start?: Timepoint; method: "lumpSum" | "annuity" | "mixed"; annuityYears?: number; lumpShare?: string; destination?: "deposit" | "invest" };
  [key: string]: unknown;
}

/** 資産運用の入れ方と、運用・取り崩しの前提（0026。エンジンの assumptions.investment） */
export interface InvestmentSetting {
  method?: "total" | "accounts" | "allocation";
  allocation?: { mix: { assetClass: string; share: string }[]; fee?: string; rebalance?: boolean };
  nisaOverflow?: "deposit" | "taxable";
  taxableTax?: "onSale" | "annual";
  drawdown?: { start: Timepoint; method: "fixed" | "rate"; monthly?: number; rate?: string };
}

/** 運用の利回りの書き換え（0026） */
export interface ReturnShift {
  from: number;
  to?: number;
  add?: string;
  cap?: string;
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
  /** 持ち家の評価（housing.valuation） */
  valuation?: { value?: Box<number>; asOf?: string; structure?: string; builtYear?: number; landShare?: string };
  /** 住み終わりの月に売る */
  sale?: { price?: number; costRate?: string };
  [key: string]: unknown;
}

/** 持ち家の評価の前提 */
export interface RealEstateValuationSetting {
  landGrowth?: YearSeries;
  landShare?: string;
  usefulLife?: { wood?: number; lightSteel?: number; steel?: number; rc?: number };
  residualFloor?: string;
  saleCostRate?: string;
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

/** 万一のときの扱い（万一の想定の層で使う） */
export interface OnContingency {
  mode: "continue" | "stop" | "ratio";
  ratio?: string;
  kinds?: ("death" | "disability" | "incapacity")[];
}

export interface Car {
  id: string;
  owner: string;
  purchase: { first: Timepoint; everyYears: number; price: number; tradeIn?: number; owned?: boolean };
  until?: Timepoint | null;
  loan?: { share?: string; rate: string; termMonths: number; method?: string };
  inspection?: { amount: number; firstAfterYears?: number; everyYears?: number };
  insurance?: { annual: number };
  tax?: { annual: number };
  upkeep?: { annual: number };
  parking?: { annual: number };
  fuel?: { annual: number };
  growth?: { kind: string; rate?: string };
  onContingency?: OnContingency;
  [key: string]: unknown;
}

export interface AdvisoryFee {
  id: string;
  payer: string;
  enabled?: boolean;
  menu?: { id: string; label?: string; [key: string]: unknown };
  terms?: {
    oneTime?: { at: Timepoint; amount: number }[];
    recurring?: {
      from: Timepoint;
      to?: Timepoint | null;
      annual?: number;
      monthly?: number;
      revision?: { rate?: string; steps?: { at: Timepoint; annual?: number; monthly?: number }[] };
      onContingency?: OnContingency;
    };
  };
  [key: string]: unknown;
}

export type OldAgeChoice = "disability" | "oldAge" | "disabilityBasicOldAgeEmployee";

export interface SurvivorAssumptions {
  livingRatio?: { beforeIndependence?: string; afterIndependence?: string; noChildren?: string };
  independenceAge?: number;
  funeral?: number;
  reserveMonths?: number;
  deathBenefits?: { retirementAllowance?: number; condolence?: number; workRelated?: boolean };
}

/** 万一の想定（0008 の5。要求1つに1件まで） */
export interface Contingency {
  id: string;
  kind: "death" | "disability" | "incapacity";
  member: string;
  occurs: Timepoint;
  grade?: 1 | 2 | 3;
  recovery?: Timepoint;
  oldAgeChoice?: OldAgeChoice;
  survivor?: SurvivorAssumptions & { spouseWork?: EmploymentPeriod[] };
  medical?: { monthly: number; months: number; from?: Timepoint };
}

/** 必要保障額の推移の要求（6.3） */
export interface ProtectionRequest {
  members?: string[];
  method?: "accumulation" | "reverse";
  horizon?: { kind: "lifeExpectancy" | "age" | "youngestIndependence"; age?: number };
  fromYear?: number;
  toYear?: number;
  survivor?: SurvivorAssumptions;
}

export interface ProtectionYear {
  year: number;
  death: string;
  horizon: number;
  need: number;
  needWithAssets: number;
  coverage: number;
  expenses: number;
  resources: number;
  lumpSum: number;
  assets: number;
}

export interface ProtectionOutput {
  method: "accumulation" | "reverse";
  members: { member: string; survivor?: string; years: ProtectionYear[] }[];
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
  cars?: Car[];
  advisoryFees?: AdvisoryFee[];
  [key: string]: unknown;
}

export interface EngineRequest {
  trace: "none" | "summary" | "full";
  input: {
    baseMonth: string;
    endYear: number;
    household: Household;
    assumptions?: { investmentReturn: YearSeries; wageGrowth?: YearSeries; inflation?: YearSeries; educationInflation?: YearSeries; pensionMacroSlide?: YearSeries; assetReturns?: Record<string, YearSeries>; realEstateValuation?: RealEstateValuationSetting; investment?: InvestmentSetting; assetVolatility?: Record<string, string>; returnShifts?: ReturnShift[]; withdrawal?: { order?: ({ kind: string } | { object: string })[]; minimumDeposit?: number }; marketShocks?: { year: number; drop: string; kinds?: string[]; assetClasses?: string[] }[]; [key: string]: unknown };
    contingencies?: Contingency[];
    protection?: ProtectionRequest;
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
  /** 必要保障額の推移（要求に protection を入れたときだけ） */
  protection?: ProtectionOutput;
}

/** 要約のうち FP顧問料（0008 の追記。顧問料の行があるときだけ） */
export interface AdvisoryFeeSummary {
  total: number;
  byYear: { year: number; amount: number; cumulative: number }[];
}

export function advisoryFeeSummary(r: PreviewResult): AdvisoryFeeSummary | null {
  const s = (r.summary as { advisoryFee?: AdvisoryFeeSummary } | null)?.advisoryFee;
  return s === undefined ? null : s;
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

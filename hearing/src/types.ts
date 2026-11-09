// 世帯データ（0008）のうち、ヒアリングシートが読み書きする部分の型。正は engine/schemas/engine.input.json（JSON Schema）。
// engine/src/engine/types.ts は金額を印つきの型（Yen）にしているので、組み立てやすい素の数の写しをここに持つ（app/src/engine/types.ts と同じ考え方）。
// 取り込んだ世帯が正の形かは、テストで計算エンジンに通して確かめる

export interface ValueBox<T> {
  value?: T;
  state: "confirmed" | "unknown" | "notApplicable" | "estimated";
  origin: { kind: string; ref?: string; connector?: string };
  approval?: { by: "fp"; at: string; candidate?: string };
  /** 推定の出し方と根拠。source は事務所の推定の値から作った推定の印（0111 の追記 2026-11-03。無ければ公式の目安から作った推定） */
  estimate?: { method: string; basis: string; source?: { kind: "office"; values: Record<string, string> } };
  /** 値の確かさ（document 書類で確認・declared 本人の申告・rough 概算）。計算には使わない */
  certainty?: "document" | "declared" | "rough";
  substitute?: ValueBox<T>;
}

export type Timepoint = { at: string } | { memberAge: { member: string; years: number; months?: number } } | { event: string; offset?: { years?: number; months?: number } };

export interface Member {
  id: string;
  kind: "self" | "spouse" | "child" | "parent" | "grandparent" | "sibling" | "grandchild" | "other";
  birth: { birthYearMonth: string; bornOnFirst: boolean };
  sex: "female" | "male";
  joins: Timepoint | null;
  leaves: Timepoint | null;
  expected: boolean;
  /** 世帯の外の家族（親・祖父母など。家計を世帯と別にする家族） */
  outside?: { of?: string; periods: { id: string; from: Timepoint | null; to: Timepoint | null; living?: boolean; income?: boolean }[] };
  /** 親・祖父母の扶養と同居 */
  support?: { dependent: boolean; cohabiting: boolean; allowance?: number };
  /** 会社の借入の連帯保証の額（会社役員の方。負債には入れない。計算には使わない。0105） */
  companyGuarantee?: ValueBox<number>;
  /** 所得税の申告の仕方と青色申告特別控除の区分（自営業の方。0081・0155） */
  taxReturn?: { method: "blue" | "white"; blueDeduction?: "electronic" | "doubleEntry" | "simple" };
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
  /** その他の資産の細目（自社株〔出資額〕・会社への貸付金。種類 otherAsset だけ。0105） */
  subtype?: "ownCompanyShares" | "loanToCompany";
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
  /** ローンの種類の細目（表示と推定の元だけ。companyLoan は会社からの借入金。0105） */
  subtype?: "cardLoan" | "scholarship" | "renovation" | "policyLoan" | "personal" | "other" | "companyLoan";
  debtors: { member: string; role: "primary" | "joint" | "guarantor"; share?: string }[];
  principal: number;
  start: Timepoint;
  balance?: ValueBox<number>;
  balanceAsOf?: string;
  rateSchedule: RateStep[];
  repayment: { method: "equalPayment" | "equalPrincipal"; termMonths: number };
  creditLife?: { covered: string[] };
  /** 住宅ローン控除に使う住宅の情報（入居は名前つきイベント kind moveIn） */
  housing?: { residence?: string; moveIn: string; propertyType: "certified" | "zeh" | "energySaving" | "other"; newBuild: boolean };
}

export interface Residence {
  id: string;
  kind: "rent" | "own";
  from: Timepoint;
  to: Timepoint | null;
  rent?: { monthly: ValueBox<number> };
  propertyTax?: { annual: ValueBox<number> };
  maintenance?: { monthly: ValueBox<number> };
  /**
   * 持ち家の評価（housing.valuation。0176）。今住んでいる持ち家を買った値段から推計するときは、買った値段（合計）を value、買った年月（住み始め）を
   * asOf、土地÷合計を landShare（土地の値段が空欄なら書かない＝前提条件の土地の割合）に書く。取り込みの部品は basis を書かない（アプリが承認のときに書く）
   */
  valuation?: { value?: ValueBox<number>; asOf?: string; landShare?: string; basis?: "market" | "purchase" };
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
  careExpenses?: CareExpense[];
  incomeFlows?: IncomeFlow[];
  periodicExpenses?: PeriodicExpense[];
}

/** 介護の費用（詳細版のご両親の「介護が始まっているか」から。0059） */
export interface CareExpense {
  id: string;
  member: string;
  from: Timepoint;
  months?: number;
  place: "home" | "facility";
  otherMonthly?: ValueBox<number>;
}

/** 入るお金の行（ご両親からの援助・受け取る予定の相続。0044） */
export interface IncomeFlow {
  id: string;
  label: string;
  kind: "support" | "inheritance";
  from: Timepoint;
  to: Timepoint | null;
  everyYears: number;
  monthly?: boolean;
  amount: ValueBox<number>;
  counterparty?: string;
  likelihood?: "certain" | "uncertain";
}

/** 出るお金の行（ご両親への仕送り。0044） */
export interface PeriodicExpense {
  id: string;
  label: string;
  kind: "allowance";
  row: string;
  from: Timepoint;
  to: Timepoint | null;
  everyYears: number;
  monthly?: boolean;
  amount: ValueBox<number>;
  counterparty?: string;
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

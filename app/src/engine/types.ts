// 計算エンジンの入出力のうち、画面が使う部分の型（正は engine/schemas/ の JSON Schema。0006 の5）

/** 値の箱（0008 の2） */
export interface Box<T> {
  value: T | null;
  state: string;
  origin: { kind: string };
}

/** 時点（0003 の6）: 絶対の年月・構成員の年齢・名前つきイベントから。3つの形のどれか1つだけを持つ */
export interface Timepoint {
  at?: string;
  event?: string;
  /** 出来事からのずらし（負も可） */
  offset?: { years?: number; months?: number };
  /** 年齢: months は 0〜11（省略は0）。ageSwitch の省略は reachMonth（年齢に達する月） */
  memberAge?: { member: string; years: number; months?: number; ageSwitch?: string };
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
  /** 世帯の外の家族（0035 の4。家計を世帯と別にする家族）。期間は家計を1つにする期間（living は生活費の人数、income は収入を世帯に入れる） */
  outside?: OutsideFamily;
  /** 世帯の外の家族のお金（0042。簡易の家計）。預金を入れたときだけ計算する。その人が介護を受ける費用は、まずこのお金から払い、尽きた月から世帯が払う */
  wallet?: OutsideWallet;
}

export interface OutsideWallet {
  /** 預金など（今の残高） */
  balance?: Box<number>;
  /** 生活費（月額） */
  living?: Box<number>;
  /** 公的年金（年額）。空はエンジンの推計 */
  pension?: Box<number>;
  /** 一時の入金 */
  lumpSums?: { id: string; at: Timepoint; amount: Box<number> }[];
}

export interface OutsideFamily {
  of?: string;
  periods: { id?: string; from: Timepoint | null; to: Timepoint | null; living?: boolean; income?: boolean }[];
  employeeInsurance?: boolean;
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
  salary?: { annual: Box<number>; bonus?: Box<number>; growth?: SalaryGrowth; [key: string]: unknown };
  /** 事業所得。growth.rate はこの期間の伸び（年率。省略は前提の賃金上昇率。0040） */
  business?: { income: Box<number>; growth?: { rate: string } };
  standardMonthlyRemuneration?: { health: Box<number>; pension: Box<number> };
  [key: string]: unknown;
}

/** 給与の昇給の仕方（どちらか1つ。0040）: curve は昇給カーブの値ID、rate はこの期間の伸び（年率。前提の賃金上昇率の代わり） */
export type SalaryGrowth = { curve: string; rate?: undefined } | { rate: string; curve?: undefined };

/** 額の段階の1段（0040）。at の時点から、元の額の代わりに amount（元の欄と同じ基準）か元の額×ratio。rampYears はここから次の段まで何年かけて移すか */
export interface AmountStage {
  id: string;
  at: Timepoint;
  amount?: Box<number>;
  ratio?: string;
  rampYears?: number;
}

/** 例外の年（0040）。その年だけ amount（元の欄と同じ基準。0円はその年に動かない） */
export interface AmountException {
  id: string;
  year: number;
  amount: Box<number>;
}

/** 段階と例外の年を持てる額の欄（0040） */
export interface Staged {
  stages?: AmountStage[];
  exceptions?: AmountException[];
}

/** 器の利回りの段階の1段（0040）。その時点の属する年から、器の利回りか資産の配分のどちらか一方 */
export interface ReturnStage {
  id: string;
  at: Timepoint;
  expectedReturn?: string;
  assetMix?: { assetClass: string; share: string }[];
  rampYears?: number;
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
  /** 利回りの段階・例外の年（0040） */
  returnStages?: ReturnStage[];
  returnExceptions?: { id: string; year: number; expectedReturn: string }[];
  /** 運用の費用（信託報酬など。年率。0026） */
  fee?: string;
  /** 運用しない分（金額。まとめた金融資産の器だけ。この額までは預金の利回り。0031） */
  uninvested?: number;
  /** iDeCo・企業型DC の受け取り（始まりが空なら退職の年。0026） */
  payout?: { start?: Timepoint; method: "lumpSum" | "annuity" | "mixed"; annuityYears?: number; lumpShare?: string; destination?: "deposit" | "invest" };
  /** 住まい以外の不動産の中身（土地と建物・家賃収入・経費・売却。0028） */
  property?: RealEstateProperty;
  [key: string]: unknown;
}

/** 住まい以外の不動産の中身（エンジンの accounts[].property。0028） */
export interface RealEstateProperty {
  /** 持ち始める時点（相続・贈与で受け取る不動産。0039） */
  holdFrom?: Timepoint;
  structure?: string;
  builtYear?: number;
  landShare?: string;
  acquisition?: { price: number; at: string };
  rental?: { monthly: Box<number>; vacancyRate?: string; growth?: string; from?: Timepoint; to?: Timepoint | null } & Staged;
  expenses?: { annual?: Box<number>; rate?: string; growth?: string } & Staged;
  sale?: { at: Timepoint; price?: number; costRate?: string };
}

/** 資産運用の入れ方と、運用・取り崩しの前提（0026。エンジンの assumptions.investment） */
export interface InvestmentSetting {
  method?: "total" | "accounts" | "allocation";
  allocation?: { mix: { assetClass: string; share: string }[]; fee?: string; rebalance?: boolean; stages?: { id: string; at: Timepoint; mix: { assetClass: string; share: string }[]; rampYears?: number }[] };
  nisaOverflow?: "deposit" | "taxable";
  taxableTax?: "onSale" | "annual";
  drawdown?: { start: Timepoint; method: "fixed" | "rate"; monthly?: number; rate?: string };
}

/** 黒字のうち貯まる割合・上限の1組（0031。エンジンの assumptions.surplusSaving） */
export interface SurplusSavingRule {
  ratio?: string;
  cap?: number;
}

/** 黒字のうち貯まる割合（0031）。changes は from の年から書いた組に置き換える */
export interface SurplusSavingSetting extends SurplusSavingRule {
  changes?: (SurplusSavingRule & { from: Timepoint })[];
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
  categories?: { id?: string; category: string; monthly: Box<number> }[];
  growth?: { kind: string; rate?: string };
  stages?: { id?: string; at: Timepoint; label: string; ratio?: string; monthly?: Box<number> }[];
  from?: Timepoint;
  to?: Timepoint | null;
  onContingency?: OnContingency;
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
  from?: Timepoint;
  monthly?: number;
  hours?: "standard" | "short";
  feeRatio?: string;
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
  education?: { stages: EducationStage[]; lessons?: { from: Timepoint; to: Timepoint; monthly: number; label?: string }[]; gifts?: EducationGift[]; childAllowance?: boolean; schoolLunch?: "free" | "paid"; [key: string]: unknown };
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
  /** 1回の額の段階・例外の年（0040） */
  stages?: AmountStage[];
  exceptions?: AmountException[];
  growth?: { kind: "inflation" | "rate" | "none"; rate?: string };
  onContingency?: OnContingency;
  /** お金の行（0044）: 額は月額（最初の月から終わりの月まで毎月。何年ごとは1だけ） */
  monthly?: boolean;
  /** お金の行（0044）: 出るお金の種類・相手・払う人・優先度・あげる贈与 */
  kind?: MoneyOutKind;
  counterparty?: string;
  payer?: string;
  priority?: Priority;
  gift?: { method?: "calendar" | "settlement"; purpose?: "general" | "housing" | "asNeeded" };
  [key: string]: unknown;
}

/** お金の行（0044）の見込み・優先度 */
export type Likelihood = "certain" | "likely" | "uncertain";
export type Priority = "need" | "want" | "wish";

/** 出るお金の種類（0044。エンジンの moneyOutKind） */
export type MoneyOutKind = "general" | "allowance" | "childSupport" | "gift" | "education" | "repair" | "realEstateCost" | "livingAnnual" | "car" | "other";

/** 入るお金の種類（0044。エンジンの incomeFlow.kind） */
export type IncomeFlowKind =
  | "inheritance"
  | "giftReceived"
  | "support"
  | "educationSupport"
  | "childSupport"
  | "propertyDivision"
  | "householdContribution"
  | "benefit"
  | "unemployment"
  | "survivorPension"
  | "foreignPension"
  | "scholarshipGrant"
  | "childPays"
  | "sideJob"
  | "otherWork"
  | "saleBusiness"
  | "saleGoods"
  | "temporary"
  | "celebration"
  | "subsidy"
  | "powerSale"
  | "insuranceBenefit"
  | "other";

/** 入るお金の課税の扱い（0044） */
export type IncomeTaxTreatment = "nonTaxable" | "temporary" | "miscBusiness" | "miscOther" | "salary" | "business" | "capitalGains" | "inheritance" | "gift";

/** 入るお金の行（0044。出るお金の行と同じ形の土台） */
export interface IncomeFlow {
  id: string;
  label?: string;
  kind: IncomeFlowKind;
  taxTreatment?: IncomeTaxTreatment;
  row?: string;
  from: Timepoint;
  to?: Timepoint | null;
  everyYears: number;
  monthly?: boolean;
  amount: Box<number>;
  cost?: Box<number>;
  growth?: { kind: "inflation" | "rate" | "none"; rate?: string };
  stages?: AmountStage[];
  exceptions?: AmountException[];
  onContingency?: OnContingency;
  recipient?: string;
  counterparty?: string;
  likelihood?: Likelihood;
  includeInBase?: boolean;
  giftMethod?: "calendar" | "settlement";
  [key: string]: unknown;
}

/** 口座の間の移し替え（0044。入れ物だけ。画面には出さない） */
export interface Transfer {
  id: string;
  label?: string;
  at: Timepoint;
  from: string;
  to: string;
  how: { kind: "amount"; amount: Box<number> } | { kind: "ratio"; ratio: string } | { kind: "all" } | { kind: "over"; threshold: Box<number> };
  linked?: string;
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
  /** この借入で取得した住まい以外の不動産（不動産の器の ID。0028） */
  property?: string;
  /** 0044: 相続で受け継ぐ借金の元の借り手・見込み・基本の計算に入れるか（計算には使わない。不確かなら要求から外す） */
  inheritedFrom?: string;
  likelihood?: Likelihood;
  includeInBase?: boolean;
  /** 住宅ローン控除に使う住宅の情報（tax.housingLoanCredit。入居は名前つきイベント kind moveIn） */
  housing?: DebtHousing;
  [key: string]: unknown;
}

export interface DebtHousing {
  residence?: string;
  moveIn: string;
  propertyType: "certified" | "zeh" | "energySaving" | "other";
  newBuild: boolean;
  acquisitionCost?: number;
  ownership?: { member: string; share: string }[];
  childRearing?: boolean;
  creditDisabled?: boolean;
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
  rent?: { monthly: Box<number>; stages?: AmountStage[]; exceptions?: AmountException[]; [key: string]: unknown };
  purchase?: { at: Timepoint; price: number; downPayment?: number; costs?: number; gifts?: Gift[] };
  propertyTax?: { annual: Box<number>; growth?: string } & Staged;
  maintenance?: { monthly: Box<number>; growth?: string } & Staged;
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

/** 相続税の目安の要求（0039。指定したときだけ計算し、出力の inheritanceTax に出す。お金の流れには入れない） */
export interface InheritanceTaxRequest {
  points?: ("now" | "bothAfter" | "contingency")[];
  members?: string[];
  lastSurvivor?: string;
  realEstateRatio?: string;
  unassignedShare?: string;
  funeral?: number;
  adopted?: string[];
  heirCounts?: { decedent: string; count: number }[];
  retirementAllowances?: { decedent: string; amount: number }[];
  overrides?: { point: "now" | "bothAfter" | "contingency"; decedent?: string; amount: number }[];
}

/** 相続税の目安の1時点（0039。engine/schemas/engine.output.json の inheritanceTax のうち画面が使う部分） */
export interface InheritancePoint {
  point: "now" | "bothAfter" | "contingency";
  decedent: string;
  month: string;
  valuationYear: number;
  status: "ok" | "noHeirs" | "noData";
  assets: { taxablePrice: number; [key: string]: number };
  heirCount: number;
  basicDeduction: number;
  totalTax: number;
  payable: number;
  payableHousehold: number;
  payableOutside: number;
  noTax: boolean;
  margin: number;
  amount: number;
  state: "estimated" | "confirmed";
  cautions: string[];
}

export interface InheritanceOutput {
  points: InheritancePoint[];
  notIncluded: string[];
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
  /** 入るお金の行（0044） */
  incomeFlows?: IncomeFlow[];
  /** 口座の間の移し替え（0044。入れ物だけ） */
  transfers?: Transfer[];
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
    assumptions?: { investmentReturn: YearSeries; wageGrowth?: YearSeries; inflation?: YearSeries; educationInflation?: YearSeries; pensionMacroSlide?: YearSeries; assetReturns?: Record<string, YearSeries>; realEstateValuation?: RealEstateValuationSetting; investment?: InvestmentSetting; assetVolatility?: Record<string, string>; returnShifts?: ReturnShift[]; surplusSaving?: SurplusSavingSetting; withdrawal?: { order?: ({ kind: string } | { object: string })[]; minimumDeposit?: number }; marketShocks?: { year: number; drop: string; kinds?: string[]; assetClasses?: string[] }[]; [key: string]: unknown };
    contingencies?: Contingency[];
    protection?: ProtectionRequest;
    inheritanceTax?: InheritanceTaxRequest;
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
  /** 相続税の目安（要求に inheritanceTax を入れたときだけ。0039） */
  inheritanceTax?: InheritanceOutput;
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

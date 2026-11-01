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
  /** 0078: 老齢年金の受給を始める月（年金の記録が無い人＝推計の区分。記録があれば記録の claim を使う。省略は65歳に達した月の翌月） */
  pensionClaim?: { basic?: Timepoint; employee?: Timepoint };
  /** 0081: 所得税の申告の仕方（青色・白色）と青色申告特別控除の区分（65万円 electronic・55万円 doubleEntry・10万円 simple。省略は simple）。省略は白色 */
  taxReturn?: { method: "blue" | "white"; blueDeduction?: "electronic" | "doubleEntry" | "simple" };
  support?: { dependent?: boolean; cohabiting?: boolean; allowance?: number };
  /** 0105: 会社の借入の連帯保証の額（役員として働く人の今の額。負債には入れず、資産と負債のタブで図の外に見せる。計算には使わない） */
  companyGuarantee?: Box<number>;
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

/** 関係（0008 の3 の辺）。id は並びの要素の ID（0035 の5。同じ2人の配偶者の関係を期間で分けて複数持てる） */
export type Relation = { id?: string; type: "spouse"; a: string; b: string; marriage: "legal" | "deFacto"; from: Timepoint | null; to: Timepoint | null } | { id?: string; type: "parentOf"; parent: string; child: string };

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
  /** 期間の終わり方（0037）: retirement・voluntary・involuntary・contractEnd・sickLeave。省略はエンジンが決める */
  endsWith?: string;
  /** 辞めた後に失業の給付を受け取るか（0037。省略は受け取らない） */
  unemploymentClaim?: boolean;
  /** 60〜64歳の月に高年齢雇用継続給付を受け取るか（0037。省略は受け取らない） */
  elderlyContinuationClaim?: boolean;
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
  /** 0105: その他の資産の細目（自社株〔出資額〕・会社への貸付金。種類 otherAsset だけ。表示だけで、計算には使わない） */
  subtype?: "ownCompanyShares" | "loanToCompany";
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

/** 収益不動産の物件の種類（区分マンション・一棟アパート・一棟マンション・戸建て・店舗/事務所・駐車場・貸している土地・民泊・宿。0079） */
export type RentalPropertyKind = "condo" | "apartment" | "mansion" | "house" | "commercial" | "parking" | "land" | "lodging";

/** 住まい以外の不動産の中身（エンジンの accounts[].property。0028） */
export interface RealEstateProperty {
  /** 物件を見分ける欄（表示用。計算には使わない。0079）: 物件名・種類・所在地（都道府県・市区町村まで）・持分・権利・戸数・面積（㎡）・メモ */
  name?: string;
  kind?: RentalPropertyKind;
  location?: string;
  share?: string;
  tenure?: "ownership" | "leasehold";
  units?: number;
  area?: { land?: string; floor?: string };
  memo?: string;
  /** 持ち始める時点（相続・贈与で受け取る不動産。0039） */
  holdFrom?: Timepoint;
  structure?: string;
  builtYear?: number;
  landShare?: string;
  /** 取得。内訳（土地・建物・建物附属設備）・建物附属設備の耐用年数・取得時の諸費用・自己資金は 0080 */
  acquisition?: { price: number; at: string; parts?: { land?: number; building?: number; equipment?: number }; equipmentLife?: number; costs?: number; equity?: number };
  /** 家賃以外の月の収入（共益費・駐車場・その他）と礼金・更新料の年あたりの見込みは 0080 */
  rental?: { monthly: Box<number>; vacancyRate?: string; growth?: string; from?: Timepoint; to?: Timepoint | null; commonFee?: number; parking?: number; otherMonthly?: number; keyMoney?: number } & Staged;
  /** 経費の費目（年額。1つでも入れたら年額はその合計）は 0080 */
  expenses?: { annual?: Box<number>; rate?: string; growth?: string; items?: Partial<Record<RealEstateExpenseItem, number>> } & Staged;
  /** 大きな修繕の予定（0080） */
  repairs?: { id: string; at: Timepoint; amount: number; label?: string }[];
  /** 民泊・宿の営業の形と売上の入れ方（0080） */
  /** incomeKind: 所得の区分（省略は営業の形から: 旅館業は事業所得、ほかは雑所得。0081） */
  lodging?: { business?: "privateLodging" | "inn" | "specialZone"; salesBy?: "night" | "month"; nightly?: number; occupancy?: string; days?: number; platformRate?: string; incomeKind?: "miscellaneous" | "business" | "realEstate" };
  /** repayLoan: 売ったときにこの物件のローンを返す（省略は返す。0081） */
  sale?: { at: Timepoint; price?: number; costRate?: string; repayLoan?: boolean };
}

/** 不動産の経費の費目（0080） */
export type RealEstateExpenseItem = "management" | "propertyTax" | "insurance" | "groundRent" | "facility" | "leasing" | "cleaning" | "supplies" | "utilities" | "other";

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
  annualOverride?: number;
  entranceOverride?: number;
  boarding?: { monthly?: number; initial?: number };
  scienceAgriculture?: boolean;
  outOfSchool?: "statistics" | "none" | { monthly: number };
  /** 段ごとの給食費の選び方（公立の小学校・中学校。省略は目標の schoolLunch） */
  schoolLunch?: "free" | "paid";
  /** 部活動などの費用の年額（統計の教科外活動費と入れ替える） */
  clubAnnual?: number;
  /** 保育所の段の、保育料とは別にかかるお金の年額（省略は統計の目安） */
  extraAnnual?: number;
  [key: string]: unknown;
}

/** 学校外の費用の行（塾・習い事など。0062） */
export interface EducationLesson {
  id?: string;
  from: Timepoint;
  to: Timepoint;
  monthly: number;
  label?: string;
  kind?: "cram" | "lesson" | "other";
}

/** 貸与の奨学金（0062。エンジンの scholarships） */
export interface EducationScholarship {
  id?: string;
  monthly: number;
  from: Timepoint;
  to: Timepoint;
  rate: string;
  termMonths: number;
  repaymentStart?: Timepoint;
  /** 世帯で返すときの名義（parent は親、省略・child は子）。子が返すときは使わない */
  debtor?: "child" | "parent";
  /** 返すのは誰か（0104）: child は子が返す（返済を世帯の収支に入れない）、household は世帯で返す。省略は子 */
  repaidBy?: "child" | "household";
  /** 種類（0104 の追記）: first は第一種（無利子）、second は第二種（有利子）。省略は第二種。表示と利率の目安の元だけで、計算は rate */
  type?: "first" | "second";
}

/** 教育ローン（0062。エンジンの loans） */
export interface EducationLoan {
  id?: string;
  at: Timepoint;
  amount: number;
  rate: string;
  termMonths: number;
  borrower: string;
}

export interface EducationGift {
  at: Timepoint;
  amount: number;
  purpose: string;
  payer?: string;
  donor?: string;
  /** 優先度（必ず need・できれば want。省略は必ず。計算には使わない。「確実な分だけ」の見方で「できれば」を外す。0103） */
  priority?: "need" | "want";
  [key: string]: unknown;
}

/** 留学1回（0088）。leave は休学して1年（在学が1年延びる）、credit は単位が認められる1年（延びない）、short は短期 */
export interface EducationAbroad {
  id?: string;
  stage: string;
  grade: number;
  kind: "leave" | "credit" | "short";
  amount: number;
  onContingency?: { mode: "continue" | "stop" };
}

export interface Goal {
  id: string;
  kind: string;
  owner?: string;
  priority?: "need" | "want" | "wish";
  education?: {
    stages: EducationStage[];
    /** 学校外の費用の入れ方（0062。省略は前の形: 統計の平均に行を足す） */
    outOfSchoolMode?: "statistics" | "rows";
    lessons?: EducationLesson[];
    scholarships?: EducationScholarship[];
    loans?: EducationLoan[];
    gifts?: EducationGift[];
    childAllowance?: boolean;
    highSchoolSupport?: "eligible" | "ineligible";
    schoolLunch?: "free" | "paid";
    abroad?: EducationAbroad[];
    [key: string]: unknown;
  };
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
  /** 夢プラン（種類 dream の行だけ。0103）: 順位・計算に入れるか（省略は入れる）・ひとことメモ。計算には使わない（入れない夢は要求を作るときに外す） */
  dream?: DreamInfo;
  [key: string]: unknown;
}

/** 夢プランの1件の、行の外の値（0103） */
export interface DreamInfo {
  /** 順位（1が最初。同じ順位・省略は並びの順） */
  rank?: number;
  /** 計算に入れるか（省略は入れる） */
  include?: boolean;
  /** ひとことメモ（なぜかなえたいか） */
  note?: string;
}

/** お金の行（0044）の見込み・優先度 */
export type Likelihood = "certain" | "likely" | "uncertain";
export type Priority = "need" | "want" | "wish";

/** 出るお金の種類（0044。エンジンの moneyOutKind） */
export type MoneyOutKind = "general" | "allowance" | "childSupport" | "gift" | "education" | "repair" | "realEstateCost" | "livingAnnual" | "car" | "other" | "dream";

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
  /** 0066: 受給中の遺族年金・障害年金の種類（表示と終わりの推定だけ。計算には使わない） */
  pensionType?: ReceivingPensionType;
  [key: string]: unknown;
}

/** 受給中の遺族年金・障害年金の種類（0066） */
export type ReceivingPensionType = "survivorBasic" | "survivorEmployee" | "widow" | "disabilityBasic" | "disabilityEmployee";

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
  rateSchedule: { id?: string; from: Timepoint; type: string; rate: string }[];
  repayment: { method: string; termMonths: number; bonusShare?: string; variableRules?: { fiveYear?: boolean; cap125?: boolean }; [key: string]: unknown };
  prepayments?: { at: Timepoint; amount: number; mode: string; fee?: number }[];
  /** 借り換え（その月に残高を新しいローンで返す） */
  refinance?: { at: Timepoint; rateSchedule: { id?: string; from: Timepoint; type: string; rate: string }[]; termMonths: number; method?: string; costs?: number; costsFinanced?: boolean }[];
  creditLife?: { covered: string[]; ratio?: string; events?: string[]; [key: string]: unknown };
  pairWith?: string;
  /** 0052: 名前と種類の細目（表示と推定の元だけ。計算には使わない） */
  label?: string;
  /** companyLoan は役員の会社からの借入金（0105） */
  subtype?: "cardLoan" | "scholarship" | "scholarshipFree" | "renovation" | "policyLoan" | "personal" | "other" | "companyLoan";
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
  /** 0052: 建て方（持ち家。表示と推定の元だけ） */
  style?: "house" | "condo";
  rent?: { monthly: Box<number>; stages?: AmountStage[]; exceptions?: AmountException[]; [key: string]: unknown };
  purchase?: { at: Timepoint; price: number; downPayment?: number; costs?: number; gifts?: Gift[] };
  propertyTax?: { annual: Box<number>; growth?: string } & Staged;
  maintenance?: { monthly: Box<number>; growth?: string } & Staged;
  ownership?: { member: string; share: string }[];
  /** 持ち家の評価（housing.valuation） */
  valuation?: { value?: Box<number>; asOf?: string; structure?: string; builtYear?: number; landShare?: string };
  /** 住み終わりの月に売る。tax は譲渡所得の税の額（0053。入れた額を売った月に払う） */
  sale?: { price?: number; costRate?: string; tax?: Box<number> };
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
  /** この保障の被保険者（家族特約。省略は契約の被保険者。0054） */
  insured?: string;
  /** 入院の1回の限度日数（省略は60日。0054） */
  maxDays?: number;
  minimumMonths?: number;
  waitingMonths?: number;
  years?: number;
  everyYears?: number;
  [key: string]: unknown;
}

/** 数表の1行（保険年度ごと。coverage のある行はその保障だけ。0054） */
export interface ScheduleRow {
  coverage?: string;
  policyYear: number;
  premium?: number;
  deathBenefit?: number;
  surrenderValue?: number;
  annuity?: number;
  survivalBenefit?: number;
}

export interface InsuranceContract {
  id: string;
  template: string;
  policyholder: string;
  insured: string;
  contractDate: string;
  currency: string;
  premium: { amount: number; frequency: string; payUntil: Timepoint | null };
  beneficiaries?: { member?: string; external?: "child" | "parent" | "sibling" | "other"; share: string }[];
  coverages?: Coverage[];
  deductionCategory: { type: string; regime?: string };
  /** 0054: 種類の細目（画面のひな形。表示と推定の元だけ） */
  subtype?: string;
  /** 0054: 名前（表示用） */
  label?: string;
  annuitant?: string;
  waiver?: boolean;
  renewals?: { id?: string; at: Timepoint; premium: number }[];
  schedule?: { rows: ScheduleRow[]; source?: { productRef: string; digest: string } };
  /** estimate（0054）: 変額・外貨建の円の目安の形 */
  simple?: { returnRate?: string; assetClass?: string; loadRate?: string; estimate?: boolean };
  surrender?: Timepoint;
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
  /** 伸び方（省略は物価上昇率） */
  growth?: { kind: string; rate?: string };
  /** 万一のときの扱い（払う人の万一） */
  onContingency?: OnContingency;
  [key: string]: unknown;
}

export interface RetirementBenefit {
  id: string;
  member: string;
  kind: string;
  /** 0057: 名前と学歴（表示と退職一時金の目安の元だけ。計算には使わない） */
  label?: string;
  education?: "university" | "highSchoolOffice" | "highSchoolManual";
  employment?: string;
  service?: { from: Timepoint; to: Timepoint };
  officerService?: { from: Timepoint; to: Timepoint };
  amount?: Box<number>;
  paidAt?: Timepoint;
  estimate?: { finalMonthly?: number; reason?: "retirementAge" | "voluntary"; multiplier?: string };
  receipt?: { method?: "lumpSum" | "annuity" | "mixed"; lumpShare?: string; start?: Timepoint; years?: number | null; guaranteeYears?: number; perYear?: 1 | 2 | 4 | 6 | 12; annualAmount?: number; conversionRate?: string };
  contributions?: { monthly: number; from: Timepoint; to?: Timepoint | null };
  disability?: boolean;
  valueStates?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 万一のときの扱い（万一の想定の層で使う） */
export interface OnContingency {
  mode: "continue" | "stop" | "ratio";
  ratio?: string;
  kinds?: ("death" | "disability" | "incapacity")[];
}

/** 車の買い替え（0101）: 買い替え続ける（省略と同じ）・この1台だけ・○歳まで（その年齢になる前の月まで買い替える） */
export type CarReplace = { kind: "repeat" } | { kind: "none" } | { kind: "until"; until: Timepoint };

/** 車のリース・長期レンタル（0101） */
export interface CarLease {
  type: "carLease" | "longRental";
  monthly: number;
  from?: Timepoint;
  termYears?: number;
  includes?: { taxAndCompulsory?: boolean; inspectionMaintenance?: boolean; insurance?: boolean };
}

export interface Car {
  id: string;
  owner: string;
  /** 買い替え（買って持つ車。リースの車は持たない。0101） */
  purchase?: { first: Timepoint; everyYears: number; price: number; tradeIn?: number; owned?: boolean; replace?: CarReplace };
  /** リース・長期レンタル（月額。0101） */
  lease?: CarLease;
  until?: Timepoint | null;
  loan?: { share?: string; rate: string; termMonths: number; method?: string };
  inspection?: { amount: number; firstAfterYears?: number; everyYears?: number };
  insurance?: { annual: number };
  tax?: { annual: number };
  upkeep?: { annual: number };
  parking?: { annual: number };
  fuel?: { annual: number };
  /** 維持費の内訳の名前つきの行（0069） */
  upkeepOther?: { id: string; label?: string; annual: number }[];
  /** 維持費の入れ方（0069。合計だけ／内訳だけを数える。省略は入っている物を全部） */
  upkeepMode?: "total" | "detail";
  growth?: { kind: string; rate?: string };
  onContingency?: OnContingency;
  valueStates?: Record<string, unknown>;
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
      revision?: { rate?: string; steps?: { id?: string; at: Timepoint; annual?: number; monthly?: number }[] };
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
  /** 病気の想定（医療・がんの給付に使う。0054） */
  illness?: Illness;
}

/** 病気の想定（0054） */
export interface Illness {
  disease: "cancer" | "heartStroke" | "other";
  hospitalDays?: number;
  surgeries?: number;
}

/** 必要保障額の内訳（0054） */
export interface ProtectionBreakdown {
  expenses: { living: number; housing: number; education: number; premiums: number; care: number; taxSi: number; other: number };
  lump: { funeral: number; reserve: number };
  resources: { survivorPension: number; survivorIncome: number; publicSupport: number };
  lumpResources: { retirementAllowance: number; dcLump: number; condolence: number };
  creditLife: number;
}

/** 必要保障額の推移の要求（6.3） */
export interface ProtectionRequest {
  members?: string[];
  method?: "accumulation" | "reverse";
  horizon?: { kind: "lifeExpectancy" | "age" | "youngestIndependence"; age?: number };
  reverseUntilAge?: number;
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
  /** 内訳（0054） */
  breakdown?: ProtectionBreakdown;
  /** 加入中の死亡保険金の契約ごとの内訳（0054） */
  coverageBy?: { object: string; amount: number }[];
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
    assumptions?: { investmentReturn: YearSeries; wageGrowth?: YearSeries; inflation?: YearSeries; educationInflation?: YearSeries; pensionMacroSlide?: YearSeries; assetReturns?: Record<string, YearSeries>; realEstateValuation?: RealEstateValuationSetting; investment?: InvestmentSetting; assetVolatility?: Record<string, string>; returnShifts?: ReturnShift[]; surplusSaving?: SurplusSavingSetting; withdrawal?: { order?: ({ kind: string } | { object: string })[]; minimumDeposit?: number }; marketShocks?: { year: number; drop: string; kinds?: string[]; assetClasses?: string[] }[]; pensionMacroSlideEmployee?: YearSeries; incomeShocks?: { id?: string; member: string; from: string; to: string; ratio: string }[]; [key: string]: unknown };
    contingencies?: Contingency[];
    /** 働き方の置き換え（0085。万一の重ねの後に、期間の始まりからその人の働き方の期間を置き換える） */
    workChanges?: EmploymentPeriod[];
    protection?: ProtectionRequest;
    inheritanceTax?: InheritanceTaxRequest;
    /** 遺したい額（0060。表示だけ。計算には使わない） */
    legacy?: { amount?: Box<number> };
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

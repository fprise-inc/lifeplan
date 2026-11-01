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
  readonly kind: "self" | "spouse" | "child" | "parent" | "grandparent" | "sibling" | "grandchild" | "other";
  /** 世帯の外の家族（outside）だけ省ける。省いた人は計算の構成員にしない（readOutsideFamily） */
  readonly birth: Birth;
  readonly sex: "female" | "male";
  readonly joins: Timepoint | null;
  readonly leaves: Timepoint | null;
  readonly expected: boolean;
  /** 0078: 老齢年金の受給を始める月（年金の記録が無い人。推計のときの繰上げ・繰下げ。記録があれば記録の claim を使う。省略は65歳に達した月の翌月） */
  readonly pensionClaim?: { readonly basic?: Timepoint; readonly employee?: Timepoint };
  readonly support?: { readonly dependent: boolean; readonly cohabiting: boolean; readonly allowance?: Yen };
  /** 0081: 所得税の申告の仕方（青色・白色）と青色申告特別控除の区分（65万円 electronic・55万円 doubleEntry・10万円 simple。省略は simple）。省略は白色 */
  readonly taxReturn?: { readonly method: "blue" | "white"; readonly blueDeduction?: "electronic" | "doubleEntry" | "simple" };
  /** 0035 の4: 世帯の外の家族（家計を世帯と別にする家族）。お金の動きは家計を1つにする期間のうち収入を世帯に入れる期間だけ世帯に入れ、世帯の判定の顔ぶれに入れない（sdk の isOutside・sameHousehold） */
  readonly outside?: OutsideFamilyInput;
  /** 世帯の外の家族のお金（簡易の家計。outside.wallet の部品が月ごとに積む。生年月のある世帯の外の家族だけ） */
  readonly wallet?: OutsideWalletInput;
}

/** 世帯の外の家族のお金（簡易の家計）。預金＋その人の年金（推計か入れた額）＋一時の入金−その人の生活費−その人の税・社会保険料−その人が介護を受ける費用 */
export interface OutsideWalletInput {
  /** 預金など（計算基準月の初めの残高）。省略すると、この人のお金は計算しない（hasWallet） */
  readonly balance?: ValueBox<Yen>;
  /** 生活費（月額。計算基準年の価格。物価上昇率で伸ばす。省略は0円） */
  readonly living?: ValueBox<Yen>;
  /** 公的年金（年額・額面）。入れるとエンジンの推計の公的年金の代わりにする。省略はエンジンの推計 */
  readonly pension?: ValueBox<Yen>;
  /** 一時の入金 */
  readonly lumpSums?: readonly { readonly id: string; readonly at: Timepoint; readonly amount: ValueBox<Yen> }[];
}

/** 0035 の4: 世帯の外の家族の印 */
export interface OutsideFamilyInput {
  readonly of?: string;
  readonly periods: readonly { readonly id: string; readonly from: Timepoint | null; readonly to: Timepoint | null; readonly living?: boolean; readonly income?: boolean }[];
  readonly employeeInsurance?: boolean;
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
    /** 昇給の仕方（どちらか1つ）: curve は昇給カーブの値ID（賃金上昇率に掛ける）、rate はこの期間の伸び（年率。賃金上昇率の代わり。0040） */
    readonly growth?: { readonly curve: string; readonly rate?: undefined } | { readonly rate: string; readonly curve?: undefined };
  };
  /** 事業所得。growth.rate はこの期間の伸び（年率。省略は賃金上昇率。0040） */
  readonly business?: { readonly income: ValueBox<Yen>; readonly growth?: { readonly rate: string } };
  readonly childcareShortHours?: { readonly child: string; readonly wageBefore?: ValueBox<Yen> };
  readonly standardMonthlyRemuneration?: { readonly health: ValueBox<Yen>; readonly pension: ValueBox<Yen> };
  readonly endsOnMonthEnd?: boolean;
  readonly retirementBenefit?: string;
  readonly corporatePension?: { readonly db?: boolean; readonly dbEquivalentMonthly?: Yen };
  readonly endsWith?: string;
  /** 辞めた後に雇用保険の失業の給付を受け取るか（省略は受け取らない。benefit.unemployment） */
  readonly unemploymentClaim?: boolean;
  /** この期間の60〜64歳の月に高年齢雇用継続給付を受け取るか（省略は受け取らない。benefit.unemployment） */
  readonly elderlyContinuationClaim?: boolean;
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
  /** 利回りの段階（その時点の属する年から、器の利回りか資産の配分に置き換える。0040） */
  readonly returnStages?: readonly ReturnStageInput[];
  /** 利回りの例外の年（その年だけ別の利回り。運用の費用・利回りの書き換えは重ねる。0040） */
  readonly returnExceptions?: readonly { readonly id: string; readonly year: number; readonly expectedReturn: string }[];
  /** 運用の費用（信託報酬など。年率。器の利回りから引く。0026） */
  readonly fee?: string;
  /** 運用しない分（金額。まとめた金融資産の器 pooled だけで使う。この額までは預金の利回りで、残りに器の利回りをかける。0031） */
  readonly uninvested?: Yen;
  /** 不動産の中身（不動産の器だけ。土地と建物に分けて評価し、貸しているなら家賃収入・経費・不動産所得を出す。asset.realEstate。0028） */
  readonly property?: RealEstatePropertyInput;
}

/** 不動産の経費の費目（0080）: 建物管理費・修繕積立金／固定資産税・都市計画税／損害保険／地代／共用部の光熱費・清掃・設備点検／入居者募集の費用・
 * 原状回復／清掃・リネン（民泊・宿）／消耗品（民泊・宿）／光熱費・通信（民泊・宿）／税理士の報酬・その他 */
export type RealEstateExpenseItem = "management" | "propertyTax" | "insurance" | "groundRent" | "facility" | "leasing" | "cleaning" | "supplies" | "utilities" | "other";

/** 住まい以外の不動産の中身（0028）。入れた器は、評価額を土地と建物に分け、家賃収入・経費・売却を計算する */
export interface RealEstatePropertyInput {
  /** 物件の種類と戸数（0079。見分けるための欄。計算は事業的規模の目安〔5棟10室〕を数えるときだけ読む。0081） */
  readonly kind?: "condo" | "apartment" | "mansion" | "house" | "commercial" | "parking" | "land" | "lodging";
  readonly units?: number;
  /** 建物の構造（省略は木造） */
  readonly structure?: BuildingStructure;
  /** 建物が建った年（省略は取得の年。取得も無ければ時価の時点の年＝新築とみなす） */
  readonly builtYear?: number;
  /** 土地の割合（評価額と取得価額を土地と建物に分ける。省略は前提の realEstateValuation.landShare か目安） */
  readonly landShare?: string;
  /** 持ち始める時点（相続・贈与で受け取る不動産。その月から評価額・家賃収入・経費に入れ、受け取るときの支払いは無い。省略は前から持っている。0039） */
  readonly holdFrom?: Timepoint;
  /** 取得（減価償却の基。price は土地と建物の合計の取得価額、at は取得の年月） */
  readonly acquisition?: {
    readonly price: Yen;
    readonly at: string;
    /** 取得価額の内訳（土地・建物・建物附属設備。入れたら土地の割合より優先して取得価額を分ける。0080） */
    readonly parts?: { readonly land?: Yen; readonly building?: Yen; readonly equipment?: Yen };
    /** 建物附属設備の耐用年数（省略は法定15年。中古は簡便法。0080） */
    readonly equipmentLife?: number;
    /** 取得時の諸費用の合計（仲介手数料・登記・不動産取得税など。建物と建物附属設備の分を償却の基に足す。0080） */
    readonly costs?: Yen;
    /** 自己資金（計算には使わない。分析の数字のため。0080） */
    readonly equity?: Yen;
  };
  /** 貸している（家賃収入） */
  readonly rental?: {
    /** 満室時の家賃の合計（月額。物件全体の分。空室率を引く前） */
    readonly monthly: ValueBox<Yen>;
    /** 空室率（1年を通して部屋が空いている割合の見込み。省略は0） */
    readonly vacancyRate?: string;
    /** 家賃の変化率（年率。マイナスも書ける。省略は0） */
    readonly growth?: string;
    /** 貸し始め（省略は取得の月。取得も無ければ前から貸している） */
    readonly from?: Timepoint;
    /** 貸し終わり（その月まで。省略は売却の前の月か表の最後） */
    readonly to?: Timepoint | null;
    /** 家賃の段階・例外の年（0040） */
    readonly stages?: readonly AmountStageInput[];
    readonly exceptions?: readonly AmountExceptionInput[];
    /** 家賃以外の月の収入（共益費・駐車場・その他。空室の割合と変化率は家賃と同じ。0080） */
    readonly commonFee?: Yen;
    readonly parking?: Yen;
    readonly otherMonthly?: Yen;
    /** 礼金・更新料の年あたりの見込み（12か月に分けて貸している月に受け取る。0080） */
    readonly keyMoney?: Yen;
  };
  /** 経費（管理費・修繕積立金・固定資産税・管理委託料など）。年額（持っている間）と、受け取る家賃に対する割合の合計 */
  readonly expenses?: {
    readonly annual?: ValueBox<Yen>;
    readonly rate?: string;
    readonly growth?: string;
    readonly stages?: readonly AmountStageInput[];
    readonly exceptions?: readonly AmountExceptionInput[];
    /** 経費の費目（年額。1つでも入れたら annual の代わりにその合計。0080） */
    readonly items?: Readonly<Partial<Record<RealEstateExpenseItem, Yen>>>;
  };
  /** 大きな修繕の予定（その月の一時の支出。貸している月なら全額をその年の経費にする。0080） */
  readonly repairs?: readonly { readonly id: string; readonly at: Timepoint; readonly amount: Yen; readonly label?: string }[];
  /** 民泊・宿の営業の形と売上の入れ方（入れたら空室の割合・家賃以外の月の収入・礼金は使わない。0080） */
  readonly lodging?: {
    readonly business?: "privateLodging" | "inn" | "specialZone";
    /** 売上の入れ方（night: 1泊の単価×稼働率×営業日数、省略は月の売上の見込み〔rental.monthly〕） */
    readonly salesBy?: "night" | "month";
    readonly nightly?: Yen;
    readonly occupancy?: string;
    readonly days?: number;
    /** 仲介サイトの手数料（売上に対する割合） */
    readonly platformRate?: string;
    /** 所得の区分（省略は営業の形から: 旅館業は事業所得、ほかは雑所得。0081） */
    readonly incomeKind?: "miscellaneous" | "business" | "realEstate";
  };
  /** 売却の予定（その月に売り、手取りを現金にする）。repayLoan: 売ったときにこの物件のローンを返す（省略は返す。0081） */
  readonly sale?: { readonly at: Timepoint; readonly price?: Yen; readonly costRate?: string; readonly repayLoan?: boolean };
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
  /** 0052: 名前と種類の細目（表示と推定の元だけ。計算には使わない） */
  readonly label?: string;
  readonly subtype?: "cardLoan" | "scholarship" | "renovation" | "policyLoan" | "personal" | "other";
  /** 0044: 相続で受け継ぐ借金の元の借り手・見込み・基本の計算に入れるか（計算には使わない。アプリが要求から外す） */
  readonly inheritedFrom?: string;
  readonly likelihood?: "certain" | "likely" | "uncertain";
  readonly includeInBase?: boolean;
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

/**
 * 額の段階の1段（0040）。その時点（年ごとの額はその時点の属する年）から、元の額の代わりに amount（元の額の欄と同じ基準の額。
 * 元の欄の伸び方をそのまま重ねる）か、元の額×ratio を使う。rampYears は、ここから何年かけて次の段の値へ毎年同じ幅で移すか
 */
export interface AmountStageInput {
  readonly id: string;
  readonly at: Timepoint;
  readonly amount?: ValueBox<Yen>;
  readonly ratio?: string;
  readonly rampYears?: number;
}

/** 例外の年（0040）。その年だけ、段階の額の代わりに amount（元の額の欄と同じ基準の額。伸び方は重ねる）。0円はその年に動かない */
export interface AmountExceptionInput {
  readonly id: string;
  readonly year: number;
  readonly amount: ValueBox<Yen>;
}

/** 段階と例外の年を持てる額の欄（0040） */
export interface StagedInput {
  readonly stages?: readonly AmountStageInput[];
  readonly exceptions?: readonly AmountExceptionInput[];
}

/** 器の利回りの段階の1段（0040）。その時点の属する年から、器の利回りか資産の配分のどちらかに置き換える */
export interface ReturnStageInput {
  readonly id: string;
  readonly at: Timepoint;
  readonly expectedReturn?: string;
  readonly assetMix?: readonly { readonly assetClass: string; readonly share: string }[];
  readonly rampYears?: number;
}

export interface ResidenceInput {
  readonly id: string;
  readonly kind: "rent" | "own";
  readonly from: Timepoint;
  readonly to: Timepoint | null;
  /** 0052: 建て方（表示と推定の元だけ。計算には使わない） */
  readonly style?: "house" | "condo";
  readonly rent?: { readonly monthly: ValueBox<Yen>; readonly growth?: string; readonly renewalFee?: string; readonly renewalEveryMonths?: number } & StagedInput;
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
  readonly propertyTax?: { readonly annual: ValueBox<Yen>; readonly growth?: string } & StagedInput;
  readonly maintenance?: { readonly monthly: ValueBox<Yen>; readonly growth?: string } & StagedInput;
  readonly ownership?: readonly { readonly member: string; readonly share: string }[];
  /** 持ち家の評価（土地と建物に分け、土地は上昇率、建物は耐用年数で減らす。housing.valuation） */
  readonly valuation?: ResidenceValuationInput;
  /** 売却（住み終わりの月に売り、手取りを現金にする） */
  readonly sale?: { readonly price?: Yen; readonly costRate?: string; /** 0053: 譲渡所得の税の額（入れた額を売った月に払う） */ readonly tax?: ValueBox<Yen> };
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
  /** 三大疾病一時金（がん・心疾患・脳卒中。0054） */
  | "threeMajorLump"
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
  /** この保障の被保険者（家族型の医療保険・家族特約。省略は契約の被保険者。0054） */
  readonly insured?: string;
  /** 入院の1回の限度日数（入院日額。省略は60日。0054） */
  readonly maxDays?: number;
}

/** 保険の種類の細目（画面のひな形。表示と推定の元だけ。0054） */
export type InsuranceSubtype =
  | "term"
  | "decreasingTerm"
  | "incomeProtection"
  | "wholeLife"
  | "endowment"
  | "medical"
  | "cancer"
  | "incapacity"
  | "education"
  | "privateAnnuity"
  | "mutualAid"
  | "groupTerm"
  | "care"
  | "foreignCurrency"
  | "variable"
  | "nonLife";

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
  /** 0054: 種類の細目（表示と推定の元だけ。計算には使わない） */
  readonly subtype?: InsuranceSubtype;
  /** 0054: 名前（表示用。計算には使わない） */
  readonly label?: string;
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
  /** estimate（0054）: 変額・外貨建の円の目安の形（積立金を伸ばさず、入れた円の目安の額だけで計算する） */
  readonly simple?: { readonly returnRate?: string; readonly assetClass?: string; readonly loadRate?: string; readonly estimate?: boolean };
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
  /** 入るお金の行（0044） */
  readonly incomeFlows?: readonly IncomeFlowInput[];
  /** 口座の間の移し替え（0044。入れ物だけ） */
  readonly transfers?: readonly TransferInput[];
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
  /** 0039: 家族の種類（世帯の外の家族から作った贈与者に、構成員の kind を写す。相続人の数え方に使う） */
  readonly relative?: "parent" | "grandparent" | "sibling" | "child" | "grandchild" | "other";
  /** 0039: 亡くなる見込み（世帯の外の家族から作った贈与者に、構成員の leaves を写す） */
  readonly leaves?: Timepoint | null;
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
  /** 病気の想定（医療・がんの給付の受け取りに使う。0054） */
  readonly illness?: IllnessInput;
}

/** 病気の想定（0054）: 病気の種類・入院の日数・手術の回数 */
export interface IllnessInput {
  readonly disease: "cancer" | "heartStroke" | "other";
  readonly hospitalDays?: number;
  readonly surgeries?: number;
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

/**
 * 基本生活費の内訳（0100）: 食費・水道光熱費・通信費・交通費（車を除く）・日用品・被服と美容・医療費・趣味と娯楽・こづかいと交際費・その他・仕送り。
 * transport（交通・通信）と otherConsumption（その他の消費支出）は前の分け方（0.42 までの世帯の内訳。計算はほかの内訳と同じ）
 */
export type LivingCategory =
  | "food"
  | "utilities"
  | "communication"
  | "transit"
  | "furniture"
  | "clothing"
  | "health"
  | "recreation"
  | "pocketAndSocial"
  | "other"
  | "allowance"
  | "transport"
  | "otherConsumption";

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
  /** 1回の額の段階・例外の年（0040） */
  readonly stages?: readonly AmountStageInput[];
  readonly exceptions?: readonly AmountExceptionInput[];
  readonly onContingency?: OnContingencyInput;
  /** お金の行（0044）: 額は月額で、最初の月から終わりの月まで毎月（everyYears は 1 だけ） */
  readonly monthly?: boolean;
  /** お金の行（0044）: 出るお金の種類（表示と、表の行の既定。計算はあげる贈与 gift と、世帯の外の子への養育費・仕送りの行がある間の扶養の判定が変える） */
  readonly kind?: MoneyOutKind;
  /** お金の行（0044）: 相手（誰へ。構成員。多くは世帯の外の家族） */
  readonly counterparty?: string;
  /** お金の行（0044）: 払う人（世帯の中の構成員。万一のときの扱いは、この人の万一だけに当てる。省略は世帯） */
  readonly payer?: string;
  /** お金の行（0044）: 優先度（必要・希望・夢。計算には使わない。確実な分だけで見るときに、希望・夢を外す） */
  readonly priority?: "need" | "want" | "wish";
  /** お金の行（0044）: あげる贈与（相手は世帯の外の家族。贈与税は受け取る人が払うので世帯から出さず、要約に出す） */
  readonly gift?: OutgoingGiftInput;
}

/** 出るお金の種類（0044） */
export type MoneyOutKind = "general" | "allowance" | "childSupport" | "gift" | "education" | "repair" | "realEstateCost" | "livingAnnual" | "car" | "other";

/** あげる贈与（0044） */
export interface OutgoingGiftInput {
  /** 課税の方法（暦年課税・相続時精算課税。省略は暦年課税） */
  readonly method?: "calendar" | "settlement";
  /** 使い道（general: 暦年・精算課税で見る／housing: 住宅取得等資金の非課税を使う／asNeeded: 生活費・教育費をその都度払う＝非課税。省略は general） */
  readonly purpose?: "general" | "housing" | "asNeeded";
}

/** 入るお金の種類（0044） */
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

/** 入るお金の行（0044。出るお金の行 periodicExpenses と同じ形の土台） */
export interface IncomeFlowInput {
  readonly id: string;
  readonly label?: string;
  readonly kind: IncomeFlowKind;
  /** 課税の扱い（省略は種類の既定） */
  readonly taxTreatment?: IncomeTaxTreatment;
  /** 載せる行（省略は種類の既定） */
  readonly row?: string;
  readonly from: Timepoint;
  readonly to?: Timepoint | null;
  readonly everyYears: number;
  readonly monthly?: boolean;
  readonly amount: ValueBox<Yen>;
  /** 必要経費・取得費（1回の額と同じ基準。一時所得・雑所得・事業・譲渡所得で引く） */
  readonly cost?: ValueBox<Yen>;
  readonly growth?: GrowthInput;
  readonly stages?: readonly AmountStageInput[];
  readonly exceptions?: readonly AmountExceptionInput[];
  readonly onContingency?: OnContingencyInput;
  /** 受け取る人（世帯の中の構成員。省略は世帯。課税の扱いのある行の税は、省略なら本人） */
  readonly recipient?: string;
  /** 相手（誰から。構成員。多くは世帯の外の家族） */
  readonly counterparty?: string;
  /** 見込み（計算には使わない。アプリが、不確かな受け取る相続・贈与を要求から外す。0035 の7・0036 の6） */
  readonly likelihood?: "certain" | "likely" | "uncertain";
  /** 基本の計算に入れる（true で、不確かでも入れる。省略は見込みで決める。計算には使わない） */
  readonly includeInBase?: boolean;
  /** 贈与税で見るときの課税の方法（省略は暦年課税） */
  readonly giftMethod?: "calendar" | "settlement";
  /** 0066: 受給中の遺族年金・障害年金の種類（表示と終わりの推定だけ。計算には使わない） */
  readonly pensionType?: "survivorBasic" | "survivorEmployee" | "widow" | "disabilityBasic" | "disabilityEmployee";
}

/** 口座の間の移し替え（0044。入れ物だけ。計算に入れるまで、あればエンジンは知らせを出して計算に入れない） */
export interface TransferInput {
  readonly id: string;
  readonly label?: string;
  readonly at: Timepoint;
  readonly from: string;
  readonly to: string;
  readonly how: { readonly kind: "amount"; readonly amount: ValueBox<Yen> } | { readonly kind: "ratio"; readonly ratio: string } | { readonly kind: "all" } | { readonly kind: "over"; readonly threshold: ValueBox<Yen> };
  readonly linked?: string;
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
  /** 維持費の内訳の名前つきの行（タイヤ・防錆・その他など。年額の12分の1を毎月。0069） */
  readonly upkeepOther?: readonly { readonly id: string; readonly label?: string; readonly annual: Yen }[];
  /**
   * 維持費の入れ方（0069）: total は合計（upkeep）だけ、detail は内訳（自動車税・保険・車検・駐車場・燃料・名前つきの行）だけを数える。
   * 省略は前の形（入っている物を全部数える）
   */
  readonly upkeepMode?: "total" | "detail";
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
  /** 0057: 名前と学歴（表示と退職一時金の目安の元だけ。計算には使わない） */
  readonly label?: string;
  readonly education?: "university" | "highSchoolOffice" | "highSchoolManual";
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

export type SchoolStage = "nursery" | "kindergarten" | "elementary" | "juniorHigh" | "highSchool" | "university" | "juniorCollege" | "vocational" | "graduateMaster" | "graduateDoctor" | "graduateProfessional" | "kosen";

export interface TuitionRow {
  readonly entryYear: number;
  readonly grade: number;
  readonly item: "tuition.admission" | "tuition.annual" | "tuition.facility" | "tuition.lab" | "tuition.other";
  readonly monthOffset: number;
  readonly amount: Yen;
}

export interface EducationStageInput {
  readonly stage: SchoolStage;
  /** 公立・国立・私立・インターナショナルスクール（幼〜高。0089） */
  readonly sector?: "public" | "national" | "private" | "international";
  readonly field?: "humanities" | "science" | "medical" | "other" | "law";
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
  /** 段ごとの給食費の選び方（公立の小学校・中学校。省略は教育の目標の schoolLunch。0062 の追記 2026-10-30） */
  readonly schoolLunch?: "free" | "paid";
  /** 部活動などの費用の年額（幼〜高。統計の平均の教科外活動費と入れ替える。0062 の追記 2026-10-30） */
  readonly clubAnnual?: Yen;
  /** 保育所の段の、保育料とは別にかかるお金の年額（省略は統計の目安。0029 の追記 2026-10-30） */
  readonly extraAnnual?: Yen;
}

/** 学校外の費用の行の種類（塾・習い事・その他。表示と既定の名前だけ。0062） */
export type LessonKind = "cram" | "lesson" | "other";

export interface EducationGoalInput {
  readonly stages: readonly EducationStageInput[];
  /**
   * 学校外の費用の入れ方（0062）: statistics は幼稚園〜高校の統計の平均の学校外活動費だけ（塾・習い事の行は使わない）、rows は塾・習い事の行
   * だけ（統計の平均は足さない）。省略は前の形（統計の平均に行を足す）
   */
  readonly outOfSchoolMode?: "statistics" | "rows";
  readonly lessons?: readonly { readonly from: Timepoint; readonly to: Timepoint; readonly monthly: Yen; readonly label?: string; readonly kind?: LessonKind }[];
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
  /** 留学（1回ずつ。0088）。leave は休学して1年（在学が1年延び、その年の学費・仕送りはかからない）、credit は単位が認められる1年（延びない）、short は短期 */
  readonly abroad?: readonly EducationAbroadInput[];
}

/** 留学1回（0088） */
export interface EducationAbroadInput {
  readonly id?: string;
  /** 在学中の学校の段（高校・大学・短大・専門学校） */
  readonly stage: SchoolStage;
  /** 何年生のとき（1〜） */
  readonly grade: number;
  readonly kind: "leave" | "credit" | "short";
  /** 1回の額（計算基準年の価格。教育費の上昇率で伸ばす） */
  readonly amount: Yen;
  /** 万一のときの扱い（stop は世帯の万一の想定の月の翌月より後なら払わない。省略は続ける） */
  readonly onContingency?: { readonly mode: "continue" | "stop" };
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
  };
  readonly contingencies?: readonly ContingencyInput[];
  /** 働き方の置き換え（0085。万一の想定の有無によらず、期間の始まりからその人の働き方の期間を置き換える。万一の重ねの後） */
  readonly workChanges?: readonly EmploymentPeriodInput[];
  readonly stressTest?: StressTestInput;
  readonly protection?: ProtectionRequest;
  /** 相続税の目安（0039。指定したときだけ計算し、出力の inheritanceTax に出す。お金の流れには入れない） */
  readonly inheritanceTax?: InheritanceTaxRequest;
}

export type InheritancePoint = "now" | "bothAfter" | "contingency";

/** 相続税の目安の要求（0039） */
export interface InheritanceTaxRequest {
  readonly points?: readonly InheritancePoint[];
  readonly members?: readonly string[];
  readonly lastSurvivor?: string;
  readonly realEstateRatio?: string;
  readonly unassignedShare?: string;
  readonly funeral?: Yen;
  readonly adopted?: readonly string[];
  readonly heirCounts?: readonly { readonly decedent: string; readonly count: number }[];
  readonly retirementAllowances?: readonly { readonly decedent: string; readonly amount: Yen }[];
  readonly overrides?: readonly { readonly point: InheritancePoint; readonly decedent?: string; readonly amount: Yen }[];
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
    /** 資産配分の段階（その時点の属する年から、共通の配分を変える。0040） */
    readonly stages?: readonly { readonly id: string; readonly at: Timepoint; readonly mix: readonly { readonly assetClass: string; readonly share: string }[]; readonly rampYears?: number }[];
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

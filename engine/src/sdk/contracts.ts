// 公式部品の出力の型（部品どうしは ctx.call で呼び、型だけをここから共有する。正は schemas/components/ の JSON Schema）
import type { Flow } from "../engine/types.ts";
import type { Yen } from "../money/yen.ts";

/** income.salary: 1か月の支払い。salary は賞与を除く給与、commuting は非課税の通勤手当（税の収入に入れない） */
export interface SalaryPayment {
  readonly ym: string;
  readonly period: string;
  readonly salary: Yen;
  readonly bonus: Yen;
  readonly commuting: Yen;
}

export interface SalaryOutput {
  readonly flows: readonly Flow[];
  readonly payments: readonly SalaryPayment[];
}

/** socialInsurance.coverage: 保険料がかかる月（「○月分」）と標準報酬月額 */
export interface CoverageMonth {
  readonly month: string;
  /** 給与から控除する月（翌月徴収。期間の最後の給与の月を超えない） */
  readonly paidIn: string;
  readonly period: string;
  readonly healthStd: Yen | null;
  readonly pensionStd: Yen | null;
  readonly care: boolean;
  /** 産前産後休業・育児休業で保険料が免除される月（年金の記録には数える） */
  readonly exempt?: boolean;
}

export interface CoverageBonus {
  readonly month: string;
  readonly period: string;
  readonly healthStdBonus: Yen | null;
  readonly pensionStdBonus: Yen | null;
  readonly care: boolean;
  readonly exempt?: boolean;
}

/** 雇用保険の保険料の基にする賃金（支払いごと） */
export interface CoverageWage {
  readonly month: string;
  readonly period: string;
  readonly kind: "salary" | "bonus";
  readonly wage: Yen;
}

export interface CoverageOutput {
  readonly months: readonly CoverageMonth[];
  readonly bonuses: readonly CoverageBonus[];
  readonly wages: readonly CoverageWage[];
}

export interface FlowsResult {
  readonly flows: readonly Flow[];
}

/** socialInsurance.health・pension・employment・nationalPension: 保険料の支払いと、支払月の暦年ごとの合計（約束の版 1.1 で足した任意の欄） */
export interface PremiumOutput {
  readonly flows: readonly Flow[];
  readonly paidByYear?: readonly { readonly year: number; readonly amount: Yen }[];
}

/** tax.employmentIncome: 給与収入・給与所得控除額・給与所得 */
export interface EmploymentIncomeOutput {
  readonly revenue: Yen;
  readonly deduction: Yen;
  readonly income: Yen;
}

/** tax.totalIncome: 合計所得金額と所得の区分（給与・公的年金等・その他。0008 の追記）。employment は所得金額調整控除の後 */
export interface TotalIncomeOutput {
  readonly total: Yen;
  readonly employment: Yen;
  readonly publicPension?: Yen;
  readonly other?: Yen;
  readonly adjustment?: Yen;
}

/** tax.deductions: 所得控除（所得税か住民税か） */
export interface DeductionsOutput {
  readonly basic: Yen;
  readonly spouse: Yen;
  readonly spouseSpecial: Yen;
  readonly dependents: Yen;
  readonly specifiedRelative: Yen;
  readonly socialInsurance: Yen;
  readonly lifeInsurance: Yen;
  readonly earthquake: Yen;
  readonly smallBusiness: Yen;
  readonly total: Yen;
  /** 住民税の調整控除に使う人的控除額の差の合計（所得税のときは 0） */
  readonly personalDiff: Yen;
}

/** tax.spouseDeduction: 配偶者控除・配偶者特別控除。personalDiff は住民税の調整控除の人的控除額の差（所得税では 0） */
export interface SpouseDeductionOutput {
  readonly spouse: Yen;
  readonly spouseSpecial: Yen;
  readonly personalDiff: Yen;
}

/** tax.dependentDeduction: 扶養控除・特定親族特別控除と、23歳未満の扶養親族がいるか */
export interface DependentDeductionOutput {
  readonly dependents: Yen;
  readonly specifiedRelative: Yen;
  readonly youngDependent: boolean;
  readonly personalDiff: Yen;
}

/** insurance.premium・account.contribution: 支払い1件 */
export interface PremiumPayment {
  readonly ym: string;
  readonly object: string;
  readonly member: string;
  readonly amount: Yen;
}

export interface PaymentsOutput {
  readonly flows: readonly Flow[];
  readonly payments: readonly PremiumPayment[];
}

/** incomeTax.annual・residentTax.annual */
export interface TaxOutput {
  readonly flows: readonly Flow[];
  readonly total: Yen;
}

/** incomeTax.annual: 年税額と途中の値（根拠の表示と答え合わせのため） */
export interface IncomeTaxOutput extends TaxOutput {
  readonly taxable: Yen;
  readonly computedTax: Yen;
  readonly reconstructionSurtax: Yen;
  readonly defenseSurtax: Yen;
}

export interface LevyPair {
  readonly municipal: Yen;
  readonly prefectural: Yen;
}

/** residentTax.annual: 年税額と途中の値。決定通知書の額を使った年度は assessed が真で、途中の値は 0 */
export interface ResidentTaxOutput extends TaxOutput {
  readonly assessed: boolean;
  readonly taxable: Yen;
  readonly grossLevy: LevyPair;
  readonly adjustmentCredit: LevyPair;
  readonly incomeLevy: LevyPair;
  readonly perCapita: LevyPair;
  readonly forestEnvironmentTax: Yen;
}

/** socialInsurance.employeeStatus: 月ごとの働き方と、勤め先の保険（健康保険・厚生年金・雇用保険）に入るか */
export interface EmployeeStatusMonth {
  readonly month: string;
  /** その月の働き方の期間（無ければ null） */
  readonly period: string | null;
  /** 保険の基にする勤め先の期間（休業の月は直前の勤め先の期間） */
  readonly employer: string | null;
  /** 働き方（期間が無い月は none） */
  readonly type: string;
  readonly leave?: "maternity" | "childcare" | "sick" | "other";
  /** 勤め先の健康保険に入る */
  readonly health: boolean;
  /** 厚生年金に入る（70歳の上限は socialInsurance.coverage で見る） */
  readonly pension: boolean;
  /** 雇用保険の被保険者 */
  readonly employment: boolean;
}

export interface EmployeeStatusOutput {
  readonly months: readonly EmployeeStatusMonth[];
}

/** pension.category: 月ごとの国民年金の被保険者の種別（1・2・3号）。basic は老齢基礎年金の額に反映する月（20〜59歳の納付済） */
export interface CategoryMonth {
  readonly month: string;
  readonly category: "1" | "2" | "3" | "none";
  readonly basic: boolean;
  /** 第1号の保険料が免除される月（産前産後） */
  readonly premiumExempt: boolean;
}

export interface CategoryOutput {
  readonly months: readonly CategoryMonth[];
}

/** socialInsurance.healthStatus: 月ごとの健康保険の種類 */
export interface HealthStatusMonth {
  readonly month: string;
  readonly kind: "kyokaikenpo" | "union" | "mutualAid" | "national" | "dependent" | "continuation" | "lateElderly" | "none";
  /** 被扶養者のとき、扶養している構成員 */
  readonly supporter?: string;
}

export interface HealthStatusOutput {
  readonly months: readonly HealthStatusMonth[];
}

/** income.business: 事業所得 */
export interface BusinessOutput {
  readonly flows: readonly Flow[];
  readonly byYear: readonly { readonly year: number; readonly income: Yen }[];
}

/** pension.oldAge: 老齢年金の支払い（偶数月に前2か月分）。part は basic（老齢基礎年金・振替加算）・employee（老齢厚生年金・経過的加算・加給年金）・special（特別支給の老齢厚生年金） */
export interface PensionPayment {
  readonly ym: string;
  readonly part: "basic" | "employee" | "special";
  readonly amount: Yen;
  /** 支給の対象の月の年（帰属の年） */
  readonly accrualYear: number;
}

/** 月ごとの年金額（年額。その月に支給される額の12倍） */
export interface PensionMonth {
  readonly month: string;
  readonly basic: Yen;
  readonly employee: Yen;
  readonly special: Yen;
  /** 在職老齢年金で止めた額（年額） */
  readonly suspended: Yen;
}

export interface PensionOutput {
  readonly flows: readonly Flow[];
  readonly payments: readonly PensionPayment[];
  readonly months: readonly PensionMonth[];
}

/** pension.revision: 構成員の年金額の改定率（年度ごと。projected は前提で延ばした年度） */
export interface RevisionOutput {
  /**
   * rate は基礎年金の改定率（受給者本人の率。68歳に達した年度からは既裁定者の率）、employee は報酬比例（厚生年金）の改定の系列、
   * newAward は新規裁定者の改定率（加給年金額・配偶者の特別加算に掛ける。約束の版 1.1 で足した任意の欄）
   */
  readonly byFiscalYear: readonly {
    readonly fiscalYear: number;
    readonly rate: string;
    readonly employee: string;
    readonly newAward?: string;
    readonly projected: boolean;
  }[];
}

/** pension.record: 加入の記録（入力の型ごとの初めの値と、記録の後に働き方の期間から足す月） */
export interface RecordMonth {
  readonly month: string;
  /** 老齢基礎年金の額に反映する月 */
  readonly basic: boolean;
  /** 厚生年金の月（報酬比例・経過的加算・加給年金の240月） */
  readonly employee: boolean;
  /** 20〜59歳・1961年4月以後の厚生年金の月（経過的加算から引く基礎年金の相当額） */
  readonly employee2059: boolean;
  /** 報酬比例に入る報酬（標準報酬月額＋その月の標準賞与額。2003年3月以前は標準報酬月額だけ）。名目の額 */
  readonly remuneration: Yen;
  /** 報酬比例の額に足すか（50歳以上の定期便は60歳までの見込みが入っているので60歳から） */
  readonly accrues: boolean;
}

export interface RecordOutput {
  readonly kind: "statementUnder50" | "statementOver50" | "receiving" | "history" | "projection" | "estimated";
  /** 初めの値の年度（記録の時点の年度。推計は計算基準月の年度） */
  readonly fiscalYear: number;
  readonly asOf: string | null;
  readonly basicMonths: number;
  readonly employeeMonths: number;
  readonly employee2059Months: number;
  readonly qualifyingMonths: number;
  /** 記録の年金額（記録の年度の額）。null は月数から計算する */
  readonly amounts: {
    readonly basic: Yen | null;
    readonly employee: Yen | null;
    readonly transitional: Yen | null;
    readonly special: Yen | null;
  };
  readonly months: readonly RecordMonth[];
}

/** residentTax.exemption: 住民税の非課税（均等割・所得割）の判定。前年の所得による */
export interface ExemptionOutput {
  readonly perCapitaExempt: boolean;
  readonly incomeLevyExempt: boolean;
  /** 非課税限度額の人数（本人・同一生計配偶者・扶養親族） */
  readonly persons: number;
}

/** tax.publicPensionIncome: 公的年金等の収入・公的年金等控除額・雑所得 */
export interface PublicPensionIncomeOutput {
  readonly revenue: Yen;
  readonly deduction: Yen;
  readonly income: Yen;
}

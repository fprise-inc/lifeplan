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
  /** 70歳以上で適用事業所に使用される月の、標準報酬月額に相当する額（在職老齢年金の基。約束の版 1.2 の任意の欄） */
  readonly workingStd?: Yen;
}

export interface CoverageBonus {
  readonly month: string;
  readonly period: string;
  readonly healthStdBonus: Yen | null;
  readonly pensionStdBonus: Yen | null;
  readonly care: boolean;
  readonly exempt?: boolean;
  /** 70歳以上で適用事業所に使用される月の、標準賞与額に相当する額（約束の版 1.2 の任意の欄） */
  readonly workingStdBonus?: Yen;
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
  /** 分離課税の退職所得の金額（約束の版 1.2 の任意の欄。total には入らない。所得税の合計所得金額の判定で足す） */
  readonly retirement?: Yen;
  /** 保険の一時所得のうち総所得金額に入れた額（特別控除の後の2分の1。約束の版 1.3 の任意の欄。total に入る） */
  readonly temporary?: Yen;
  /** 公的年金等以外の雑所得（約束の版 1.3 の任意の欄。total に入る。1.7 から入るお金の行・保険・民泊・宿の雑所得を1つの区分として差し引いた後の額。0085） */
  readonly miscellaneous?: Yen;
  /** 不動産所得（住まい以外の不動産。損失は土地の取得のための借入の利息の分を除いて、ほかの所得から引く。約束の版 1.4 の任意の欄。total に入る。0028） */
  readonly realEstate?: Yen;
  /** 分離課税の譲渡所得（入るお金の行の譲渡所得。約束の版 1.5 の任意の欄。total には入らない。合計所得金額の判定で足す。0044）。1.6 から土地建物等の譲渡所得も足す */
  readonly separate?: Yen;
  /** 土地建物等の譲渡所得（住まい以外の不動産を売った年。短期と長期を差し引いた後・特別控除の前。separate に入っている。約束の版 1.6 の任意の欄。0081） */
  readonly landBuilding?: { readonly short: Yen; readonly long: Yen };
  /** 青色申告特別控除の額（不動産所得・事業所得から引いた額。約束の版 1.6 の任意の欄。0081） */
  readonly blueDeduction?: Yen;
  /** 純損失の金額（損益通算をしても引ききれない損失。total は0。青色なら tax.lossCarryforward が3年繰り越す。約束の版 1.6 の任意の欄。0081） */
  readonly netLoss?: Yen;
  /** 民泊・宿の雑所得・事業所得（total・miscellaneous・other に入っている。マイナスは損失。約束の版 1.6 の任意の欄。0081） */
  readonly lodging?: { readonly miscellaneous: Yen; readonly business: Yen };
  /**
   * 公的年金等以外の雑所得の赤字のうち、公的年金等の雑所得からも引ききれなかった額（ほかの所得と通算せず、0円として捨てた額。
   * 約束の版 1.7 の任意の欄。0085）
   */
  readonly miscellaneousLoss?: Yen;
}

/** tax.lossCarryforward: 青色申告の人の純損失の繰越控除（総所得金額から引く額。合計所得金額〔tax.totalIncome の total〕は控除の前。0081） */
export interface LossCarryforwardOutput {
  /** 年の昇順。繰り越す損失か引く額のある年だけ。deducted はその年の総所得金額から引く額、remaining は年末に繰り越す残り（翌年以後に引ける分） */
  readonly byYear: readonly { readonly year: number; readonly netLoss: Yen; readonly deducted: Yen; readonly remaining: Yen }[];
}

/** tax.realEstateSale: 住まい以外の不動産を売ったときの譲渡所得（分離課税）と税（名義の人×売った年。0081） */
export interface RealEstateSaleTaxOutput {
  /** 所得税（翌年3月。cf.taxSi.incomeTax.realEstateSale）と住民税（翌年度の普通徴収。cf.taxSi.residentTax.realEstateSale） */
  readonly flows: readonly Flow[];
  /** short・long は短期と長期を差し引いた後の譲渡所得（0より下げない）。incomeTax は復興特別所得税・防衛特別所得税を含む */
  readonly byMember: readonly { readonly member: string; readonly year: number; readonly short: Yen; readonly long: Yen; readonly incomeTax: Yen; readonly residentTax: Yen }[];
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
  /** 寡婦控除・ひとり親控除（約束の版 1.1 の任意の欄） */
  readonly widow?: Yen;
  readonly singleParent?: Yen;
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
  /** 算出税額（税額控除の前） */
  readonly computedTax: Yen;
  readonly reconstructionSurtax: Yen;
  readonly defenseSurtax: Yen;
  /** 引いた住宅借入金等特別控除（約束の版 1.1 で足した任意の欄。控除が無い年は無い） */
  readonly housingLoanCredit?: Yen;
  /** 所得税から引ききれなかった住宅借入金等特別控除（翌年度の住民税から上限まで引く。1.1） */
  readonly creditRemainder?: Yen;
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
  /** 住宅借入金等特別税額控除（約束の版 1.1 で足した任意の欄。控除が無い年度は無い） */
  readonly housingLoanCredit?: LevyPair;
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
  readonly leave?: "maternity" | "childcare" | "sick" | "care" | "other";
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
  /** employee に含む配偶者の加給年金額（特別加算を含む。年額）。pension.oldAgeBase の約束の版 1.1 で足した任意の欄 */
  readonly spouseSupplement?: Yen;
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
  /** 約束の版 1.1: 記録の第1号の期間の内訳（20〜59歳。記録の時点まで）。known は入力に内訳があったか。pre2009 は2009年3月以前の免除の月数（加入歴だけ） */
  readonly category1?: {
    readonly known: boolean;
    readonly paid: number;
    readonly exemptQuarter: number;
    readonly exemptHalf: number;
    readonly exemptThreeQuarters: number;
    readonly exemptFull: number;
    readonly deferred: number;
    /** うち2009年3月以前の免除の月（老齢基礎年金の割合が違う。加入歴だけ） */
    readonly pre2009: { readonly exemptQuarter: number; readonly exemptHalf: number; readonly exemptThreeQuarters: number; readonly exemptFull: number };
  };
  /** 約束の版 1.1: 加入歴（history）の厚生年金の月のうち40歳（女子35歳）以後の月数（中高齢者の期間短縮の特例）。記録の時点まで */
  readonly employeeFromMiddleAge?: number;
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

/** ideco.contribution: 拠出限度額で止めた後の iDeCo・企業型DC の掛金（月の昇順） */
export interface IdecoPayment {
  readonly ym: string;
  readonly object: string;
  readonly amount: Yen;
  readonly kind: "ideco" | "corporateDc";
  /** self は本人が払う（iDeCo・加入者掛金。小規模企業共済等掛金控除の対象）、employer は事業主掛金 */
  readonly payer: "self" | "employer";
}

export interface IdecoContributionOutput {
  readonly flows: readonly Flow[];
  readonly payments: readonly IdecoPayment[];
}

/** account.ideco: iDeCo・企業型DC の器ごとの年末残高と受け取り */
export interface IdecoAccountYear {
  readonly year: number;
  /** その年の掛金（事業主掛金を含む） */
  readonly contributions: Yen;
  readonly payout: Yen;
  readonly returns: Yen;
  readonly closing: Yen;
}

export interface IdecoReceipt {
  readonly object: string;
  readonly kind: "lumpSum" | "annuity";
  readonly ym: string;
  readonly amount: Yen;
  /** 通算加入者等期間の月数（退職所得の勤続年数の代わり。退職給付の作業で使う） */
  readonly enrolledMonths: number;
}

export interface IdecoAccountOutput {
  readonly flows: readonly Flow[];
  readonly accounts: readonly { readonly object: string; readonly kind: "ideco" | "corporateDc"; readonly years: readonly IdecoAccountYear[] }[];
  /** 受け取り（月の昇順）。年金で受け取る分は公的年金等の収入（tax.publicPensionIncome）、一時金は退職所得（退職給付の作業）と重複排除期間の判定に使う */
  readonly payments: readonly IdecoReceipt[];
}

/** debt.schedule: 負債1本の返済のお金の動きと年末残高 */
export interface DebtScheduleOutput {
  readonly flows: readonly Flow[];
  /** 年末（12月の返済の後）の残高と未払利息。返し終えた年まで（年の昇順） */
  readonly yearEnd: readonly { readonly year: number; readonly balance: Yen; readonly unpaidInterest: Yen }[];
  readonly firstPayment: string;
  /** 返し終えた月（表の最後の月までに返し終えなければ null） */
  readonly payoff: string | null;
  /** 年ごとの利息（計算基準月から。ボーナス返済の分を含む。利息の付いた年だけ・年の昇順。約束の版 1.2 の任意の欄。0028） */
  readonly interest?: readonly { readonly year: number; readonly amount: Yen }[];
}

/** housing.residence: 住まいのお金の動きと、購入した持ち家（不動産の残高の計算に使う） */
export interface ResidenceOutput {
  readonly flows: readonly Flow[];
  readonly properties: readonly { readonly object: string; readonly owner: string | null; readonly from: string; readonly to: string | null; readonly price: Yen }[];
}

/** housing.valuation: 持ち家の年末の評価額（土地・建物）と売却 */
export interface HousingValuationOutput {
  /** 売却の手取り（cf.income.lumpSum.realEstateSale） */
  readonly flows: readonly Flow[];
  readonly properties: readonly {
    readonly object: string;
    readonly owner: string | null;
    /** 持っている年の年末の評価額（売った年は含めない。年の昇順） */
    readonly years: readonly { readonly year: number; readonly land: Yen; readonly building: Yen; readonly value: Yen }[];
    /** tax: 入れた譲渡所得の税の額（入れていなければ0。0053） */
    readonly sale: { readonly ym: string; readonly value: Yen; readonly price: Yen; readonly costs: Yen; readonly proceeds: Yen; readonly tax: Yen } | null;
  }[];
}

/** asset.car: 車の年末の評価額 */
/** asset.realEstate: 住まい以外の不動産（中身を入れた不動産の器）の年末の評価額（土地・建物）・家賃収入・経費・不動産所得・売却（0028） */
export interface RealEstateOutput {
  /** 家賃収入（cf.income.other.rental）・経費（cf.expense.other.realEstate）・売却の手取り（cf.income.lumpSum.realEstateSale） */
  readonly flows: readonly Flow[];
  readonly properties: readonly {
    readonly object: string;
    readonly owner: string;
    /** 持っている年の年末の評価額（売った年は含めない。年の昇順） */
    readonly years: readonly { readonly year: number; readonly land: Yen; readonly building: Yen; readonly value: Yen }[];
    /** 貸している年の不動産所得の内訳（計算基準年の2年前から。年の昇順）。income＝rent−expenses−depreciation−interest（マイナスは損失） */
    readonly income: readonly {
      readonly year: number;
      readonly rent: Yen;
      readonly expenses: Yen;
      readonly depreciation: Yen;
      readonly interest: Yen;
      /** 利息のうち土地の取得のための借入の分（損失のときにほかの所得から引けない分） */
      readonly landInterest: Yen;
      readonly income: Yen;
    }[];
    /**
     * 約束の版 1.1（0081）: 譲渡所得の内訳（任意の欄）。acquisitionCost は取得費（取得価額＋取得時の諸費用−建物と建物附属設備の償却の累計。
     * 概算取得費〔売却価格の5%〕のほうが大きければそれ）、estimated は概算取得費を使ったか、gain は売却価格−（取得費＋売却の費用）、term は長期・短期
     */
    readonly sale:
      | {
          readonly ym: string;
          readonly value: Yen;
          readonly price: Yen;
          readonly costs: Yen;
          readonly proceeds: Yen;
          readonly acquisitionCost?: Yen;
          readonly estimated?: boolean;
          readonly gain?: Yen;
          readonly term?: "long" | "short";
        }
      | null;
    /** 約束の版 1.1（0081）: 所得の区分（民泊・宿の雑所得・事業所得。無ければ不動産所得） */
    readonly incomeKind?: "miscellaneous" | "business";
    /** 約束の版 1.1（0081）: 事業的規模の目安に数える室数・棟数（不動産所得の物件。種類と戸数から） */
    readonly units?: { readonly rooms: number; readonly houses: number };
    /**
     * 約束の版 1.2（分析の数字の材料）: 計算基準年から、持っている月が表にある年ごと（年の昇順）。どれも表に載る月（計算基準月から）の分。
     * months は貸している月数、gross は満室のときの収入（家賃と家賃以外の月の収入の空室を見込む前の額。礼金・更新料は入れない。民泊・宿は
     * 「1泊の単価×営業日数」で売上を入れたときの稼働率100%の売上で、月の売上の見込みで入れたときは null）、rent は受け取った収入（家賃収入の行の
     * この物件の分）、expenses は経費（大きな修繕を除く。貸していない月の分も含む）、repairs は大きな修繕
     */
    readonly cash?: readonly { readonly year: number; readonly months: number; readonly gross: Yen | null; readonly rent: Yen; readonly expenses: Yen; readonly repairs: Yen }[];
    /**
     * 約束の版 1.2: 物件の事実。acquisition は取得価額の合計（内訳があれば内訳の合計）・取得時の諸費用・自己資金（入れたときだけ）、builtYear は
     * 建った年（省略は取得の年など。0028）、legalLife は建物の構造の法定耐用年数、depreciationEnd は建物・建物附属設備の減価償却が終わる年（帳簿の残りが
     * 1円になる年。表の最後まで貸していれば表の期間の後の年も数える。償却が無い・途中で売る・貸し終わるときは null）、lodging は民泊・宿の
     * 「1泊の単価×営業日数」の入れ方の値（営業日数は上限を当てた後）
     */
    readonly facts?: {
      readonly acquisition: { readonly total: Yen; readonly costs: Yen; readonly equity?: Yen } | null;
      readonly builtYear: number;
      readonly legalLife: number;
      readonly depreciationEnd: { readonly building: number | null; readonly equipment: number | null };
      readonly lodging?: { readonly nightly: Yen; readonly occupancy: string; readonly days: number };
    };
  }[];
}

/**
 * asset.realEstateAnalysis: 収益不動産の分析の数字（物件ごと・年ごとと全物件の合計。0082）。金額は表に載る月（計算基準月から）の分。
 * 率は10進の文字列（分母が0・無いときは null）。年は計算基準年から、持っている月が表にある年（売った年まで）
 */
export interface RealEstateAnalysisOutput {
  readonly properties: readonly {
    readonly object: string;
    readonly owner: string;
    /** 取得価額の合計・取得時の諸費用・自己資金（入れたときだけ） */
    readonly acquisition: { readonly total: Yen; readonly costs: Yen; readonly equity?: Yen } | null;
    readonly builtYear: number | null;
    /** 建物の構造の法定耐用年数 */
    readonly legalLife: number | null;
    /** 建物・建物附属設備の減価償却が終わる年（無い・途中で売るなら null。表の期間の後の年もある） */
    readonly depreciationEnd: { readonly building: number | null; readonly equipment: number | null };
    /** 元金の返済が減価償却費を上回る最初の年（表の期間に無ければ null） */
    readonly deadCross: number | null;
    /** 民泊・宿（表面利回りを出さない） */
    readonly lodging: boolean;
    readonly years: readonly RealEstateAnalysisYear[];
    /** 今の予定の売却（売らなければ null）。net＝proceeds−loanPayoff−tax */
    readonly exit: { readonly ym: string; readonly price: Yen; readonly costs: Yen; readonly proceeds: Yen; readonly loanPayoff: Yen; readonly tax: Yen; readonly net: Yen } | null;
  }[];
  /** 全物件の合計（年の昇順） */
  readonly total: readonly RealEstateAnalysisTotal[];
}

/** 分析の数字の金額の欄（物件と合計で同じ） */
export interface RealEstateAnalysisAmounts {
  readonly year: number;
  /** 満室のときの収入（民泊・宿は稼働率100%の売上。無ければ null） */
  readonly gross: Yen | null;
  readonly rent: Yen;
  readonly expenses: Yen;
  readonly repairs: Yen;
  readonly depreciation: Yen | null;
  readonly interest: Yen | null;
  /** 不動産所得（民泊・宿は雑所得・事業所得。貸していない年は null） */
  readonly income: Yen | null;
  readonly repayment: Yen;
  readonly debtService: Yen;
  readonly principal: Yen;
  readonly cashBeforeTax: Yen;
  readonly tax: Yen;
  readonly cashAfterTax: Yen;
  readonly loanBalance: Yen;
  readonly value: Yen | null;
  readonly equity: Yen | null;
  readonly grossYield: string | null;
  readonly netYield: string | null;
  readonly breakEven: string | null;
  readonly repaymentRatio: string | null;
  readonly dscr: string | null;
  readonly ltv: string | null;
  readonly ccr: string | null;
}

export interface RealEstateAnalysisYear extends RealEstateAnalysisAmounts {
  /** 年末に持っている */
  readonly held: boolean;
  /** 表に載る月のうち貸している月数 */
  readonly months: number;
  readonly age: number | null;
  readonly remainingLife: number | null;
  /** 民泊・宿の「1泊の単価×営業日数」の入れ方の値と、年の売上（年換算） */
  readonly lodging?: { readonly occupancy: string; readonly nightly: Yen; readonly days: number; readonly sales: Yen };
}

export interface RealEstateAnalysisTotal extends RealEstateAnalysisAmounts {
  readonly gross: Yen;
  readonly depreciation: Yen;
  readonly interest: Yen;
  readonly income: Yen;
  readonly value: Yen;
  readonly equity: Yen;
}

export interface CarValuationOutput {
  readonly cars: readonly { readonly object: string; readonly owner: string; readonly years: readonly { readonly year: number; readonly value: Yen }[] }[];
}

/** tax.housingLoanCredit: 構成員のその年分の住宅借入金等特別控除の額（所得税から引く上限）と、住民税の控除の上限の決まり */
export interface HousingLoanCreditOutput {
  readonly credit: Yen;
  /** 入居の年（確定申告で受け、還付は翌年3月） */
  readonly firstYear: boolean;
  /** 住民税の控除の上限（所得税の課税総所得金額等に掛ける率と上限額） */
  readonly residentRate: string | null;
  readonly residentLimit: Yen | null;
  /**
   * 住民税の控除の上限の基礎に足す額の差し引き（居住年が平成28年〜令和7年のとき48万円。約束の版 1.1 の任意の欄）。
   * 上限の基礎＝所得税の課税総所得金額等＋（所得税の基礎控除の額−この額。0未満は0）
   */
  readonly residentBasicOffset?: Yen;
}

/** account.idecoPayout: iDeCo・企業型DC の受け取りの始まりと方法（運用利回りに依らない） */
export interface IdecoPayoutPlanOutput {
  readonly accounts: readonly {
    readonly object: string;
    readonly kind: "ideco" | "corporateDc";
    readonly start: string;
    readonly method: "lumpSum" | "annuity" | "mixed";
    readonly annuityYears: number;
    readonly lumpShare: string | null;
    readonly enrolledMonths: number;
  }[];
}

/** 退職所得になる一時金1件（retirement.receipts・retirement.benefit・account.mutualAid）。勤続期間は年月（両端を含む） */
export interface RetirementReceipt {
  readonly ym: string;
  readonly amount: Yen;
  readonly object: string;
  /** retirement は退職手当等（退職一時金・DB・公務員の退職手当・役員退職慰労金）、dc は確定拠出年金の老齢給付金の一時金、mutualAid は小規模企業共済の共済金 */
  readonly source: "retirement" | "dc" | "mutualAid";
  readonly serviceFrom: string;
  readonly serviceTo: string;
  /** 役員等の勤続期間（特定役員退職手当等の判定） */
  readonly officerFrom?: string;
  readonly officerTo?: string;
  /** 障害者になったことによる退職 */
  readonly disability?: boolean;
}

/** 公的年金等の雑所得になる年金の支払い1件（DB・年金払い退職給付・国民年金基金・小規模企業共済の分割） */
export interface AnnuityPayment {
  readonly ym: string;
  readonly amount: Yen;
  readonly object: string;
}

/** retirement.benefit: 退職給付のお金の動きと、退職所得の一時金・年金の支払い・国民年金基金の掛金（どれも月の昇順） */
export interface RetirementBenefitOutput {
  readonly flows: readonly Flow[];
  readonly receipts: readonly RetirementReceipt[];
  readonly annuities: readonly AnnuityPayment[];
  /** 国民年金基金の掛金（社会保険料控除） */
  readonly fundPaid: readonly AnnuityPayment[];
}

/** account.mutualAid: 小規模企業共済の器ごとの年末残高と受け取り */
export interface MutualAidOutput {
  readonly flows: readonly Flow[];
  readonly accounts: readonly { readonly object: string; readonly years: readonly IdecoAccountYear[] }[];
  readonly receipts: readonly RetirementReceipt[];
  readonly annuities: readonly AnnuityPayment[];
  /** その年に払った掛金（小規模企業共済等掛金控除。月の昇順） */
  readonly paid: readonly AnnuityPayment[];
}

/** tax.retirementIncome: その年の退職所得の分離課税（所得税・住民税。支払いのたびに源泉徴収・特別徴収） */
export interface RetirementIncomeOutput {
  readonly flows: readonly Flow[];
  /** 所得税と住民税の合計 */
  readonly total: Yen;
  readonly revenue: Yen;
  readonly deduction: Yen;
  /** 退職所得の金額（2分の1の後。合計所得金額に入る） */
  readonly income: Yen;
  /** 課税退職所得金額（1,000円未満切り捨て） */
  readonly taxable: Yen;
  readonly years: number;
  readonly overlapYears: number;
  readonly incomeTax: Yen;
  readonly residentTax: Yen;
}

/** 在学の期間（学年の始まりの月・年数）と、その学校の年ごとの授業料（公的支援の部品が読む） */
export interface Enrollment {
  readonly stage: "nursery" | "kindergarten" | "elementary" | "juniorHigh" | "highSchool" | "university" | "juniorCollege" | "vocational";
  readonly sector: "public" | "national" | "private";
  readonly living: "home" | "away";
  readonly from: string;
  readonly years: number;
  readonly scienceAgriculture: boolean;
  /** 年度ごとの授業料（学納金。入学金を除く）と入学金（その年度の入学の分） */
  readonly fees: readonly { readonly fiscalYear: number; readonly tuition: Yen; readonly admission: Yen }[];
}

export interface EducationCostOutput {
  readonly flows: readonly Flow[];
  readonly loans: readonly { readonly object: string; readonly member: string; readonly yearEnd: DebtScheduleOutput["yearEnd"] }[];
  readonly enrollments: readonly Enrollment[];
}

/** expense.car: 車のお金の動きと、自動車ローンの年末残高 */
export interface CarOutput {
  readonly flows: readonly Flow[];
  readonly loans: readonly { readonly object: string; readonly yearEnd: DebtScheduleOutput["yearEnd"] }[];
}

/** expense.reconcile: 現状の検算 */
export interface ReconcileOutput {
  readonly flows: readonly Flow[];
  /** 検算の結果（年額。計算上の貯蓄額・実際の貯蓄額（表に載る月数で按分）・差） */
  readonly checks: readonly { readonly object: string; readonly year: number; readonly computed: Yen; readonly actual: Yen; readonly unexplainedAnnual: Yen }[];
}

/** contingency.event: 構成員の万一（判定だけ）。万一の無い構成員は null */
export interface ContingencyEvent {
  readonly id: string;
  readonly kind: "death" | "disability" | "incapacity";
  /** 起きる月 */
  readonly month: string;
  readonly grade?: 1 | 2 | 3;
  readonly recovery?: string;
  /** 障害認定日の月（初診日から1年6か月） */
  readonly recognition?: string;
  /** 障害年金の65歳からの組み合わせ（FP が選び直したとき。省略は自動） */
  readonly oldAgeChoice?: "disability" | "oldAge" | "disabilityBasicOldAgeEmployee";
  readonly survivor?: {
    readonly livingRatio?: { readonly beforeIndependence?: string; readonly afterIndependence?: string; readonly noChildren?: string };
    readonly independenceAge?: number;
    readonly funeral?: Yen;
    readonly reserveMonths?: number;
    readonly deathBenefits?: { readonly retirementAllowance?: Yen; readonly condolence?: Yen; readonly workRelated?: boolean };
  };
  readonly medical?: { readonly monthly: Yen; readonly months: number; readonly from?: unknown };
  /** 病気の想定（0054） */
  readonly illness?: { readonly disease: "cancer" | "heartStroke" | "other"; readonly hospitalDays?: number; readonly surgeries?: number };
}

export interface ContingencyEventOutput {
  readonly event: ContingencyEvent | null;
}

/** 遺族年金・障害年金の月ごとの額（年額。その月に支給される額の12倍） */
export interface SurvivorPensionMonth {
  readonly month: string;
  /** 遺族基礎年金（子の加算を含む） */
  readonly basic: Yen;
  /** 遺族厚生年金（65歳以降は自分の老齢厚生年金との調整の後） */
  readonly employee: Yen;
  /** 中高齢寡婦加算 */
  readonly widowAddition: Yen;
  /** 寡婦年金 */
  readonly widowPension: Yen;
}

/** pension.survivor: 遺族年金（受け取る構成員ごと） */
export interface SurvivorPensionOutput {
  readonly flows: readonly Flow[];
  readonly months: readonly SurvivorPensionMonth[];
  /** 亡くなった構成員と死亡の月（遺族年金の基。無ければ null） */
  readonly deceased: string | null;
  readonly death: string | null;
  /** 死亡一時金（受け取るときだけ） */
  readonly lumpSum: Yen;
}

/** pension.survivorRight: 遺族年金の受給権（受け取る構成員ごと）。from は受給権を得た月（死亡の月）、to は終わる月（無ければ null） */
export interface SurvivorRightOutput {
  readonly rights: readonly { readonly kind: "basic" | "employee"; readonly from: string; readonly to: string | null }[];
}

export interface DisabilityPensionMonth {
  readonly month: string;
  readonly basic: Yen;
  readonly employee: Yen;
}

/** pension.disability: 障害年金（本人） */
export interface DisabilityPensionOutput {
  readonly flows: readonly Flow[];
  readonly months: readonly DisabilityPensionMonth[];
  /**
   * 約束の版 1.1: 65歳からの組み合わせ（月の範囲。両端を含む）。disability は障害基礎年金＋障害厚生年金、oldAge は老齢基礎年金＋老齢厚生年金、
   * disabilityBasicOldAgeEmployee は障害基礎年金＋老齢厚生年金
   */
  readonly choices?: readonly { readonly from: string; readonly to: string; readonly combination: "disability" | "oldAge" | "disabilityBasicOldAgeEmployee" }[];
}

/** debt.creditLifeEvents: 団信で残高が消える月と割合（保障割合・事由・夫婦連生から） */
export interface CreditLifeOutput {
  readonly events: readonly { readonly month: string; readonly ratio: string; readonly cause: "death" | "highDisability" | "incapacity"; readonly member: string }[];
}

/** 保険の受け取り（税の区分つき） */
export interface InsuranceReceipt {
  readonly ym: string;
  readonly object: string;
  readonly coverage: string | null;
  /** 受け取る構成員（構成員でない受取人は null） */
  readonly member: string | null;
  /** medical: 医療・がんの給付（入院日額・手術・がん一時金・三大疾病一時金。0054） */
  readonly kind: "death" | "incomeProtection" | "incapacity" | "highDisability" | "maturity" | "surrender" | "annuity" | "survival" | "medical";
  readonly amount: Yen;
  /** 課税の区分: inheritance 相続税の対象（みなし相続財産）・temporary 一時所得・miscellaneous 雑所得（年金）・gift 贈与税・none 非課税 */
  readonly taxClass: "inheritance" | "temporary" | "miscellaneous" | "gift" | "none";
  /** 一時所得・雑所得の必要経費（払込保険料のうちこの受け取りに当たる額） */
  readonly cost: Yen;
  /** 贈与税のとき: 贈与者（契約者）の構成員 */
  readonly giver?: string;
}

export interface InsurancePolicyYear {
  readonly year: number;
  readonly premium: Yen;
  readonly deathBenefit: Yen;
  readonly surrenderValue: Yen;
  readonly paid: Yen;
  readonly others?: readonly { readonly member: string; readonly deathBenefit: Yen }[];
}

/** insurance.policy: 保険契約1件の受け取り・保険年度ごとの値（数表か型から） */
export interface InsurancePolicyOutput {
  readonly flows: readonly Flow[];
  /** 受け取り（支払月の昇順） */
  readonly receipts: readonly InsuranceReceipt[];
  /**
   * 年末の値（解約返戻金・死亡保障額）と、その年の払込保険料。約束の版 1.1（0054）: paid は年末までの払込保険料の累計（契約の月から）、
   * deathBenefit は契約の被保険者の分だけで、ほかの人が被保険者の保障（家族特約）の死亡保障額は others に人ごと
   */
  readonly years: readonly InsurancePolicyYear[];
  /** 保障と払込が終わる月（解約・満期・被保険者の死亡。無ければ null） */
  readonly endsAt: string | null;
}

/** insurance.income: 構成員×年の保険の一時所得・雑所得（tax.totalIncome が読む） */
export interface InsuranceIncomeOutput {
  /** 一時所得の金額（特別控除の後。総所得金額に入れるのはこの2分の1） */
  readonly temporary: Yen;
  /** 総所得金額に入れる額（一時所得の2分の1） */
  readonly temporaryIncluded: Yen;
  /** 公的年金等以外の雑所得（個人年金）。0円より下げない */
  readonly miscellaneous: Yen;
  /** 約束の版 1.1（0044）: 一時所得の総収入−支出（特別控除の前）。入るお金の行の一時所得と合わせて特別控除を引くため */
  readonly temporaryGross?: Yen;
  /** 約束の版 1.2（0085）: 雑所得が赤字の年（必要経費が年金額を超える。元本割れの個人年金など）の収入−必要経費（マイナス）。ほかの雑所得と差し引くため */
  readonly miscellaneousNet?: Yen;
}

/** income.flows の税を受ける人×年の所得（0044。課税の扱いのある入るお金の行だけ） */
export interface IncomeFlowsTaxRow {
  readonly member: string;
  readonly year: number;
  /** 一時所得の総収入−支出（特別控除の前） */
  readonly temporary: Yen;
  /** 雑所得（業務）の収入−必要経費 */
  readonly miscBusiness: Yen;
  /** 雑所得（その他）の収入−必要経費 */
  readonly miscOther: Yen;
  /** 給与の収入（給与所得控除の前。社会保険料はかけない） */
  readonly salary: Yen;
  /** 事業所得の収入−必要経費 */
  readonly business: Yen;
  /** 分離課税の譲渡所得（収入−取得費） */
  readonly capitalGains: Yen;
  /** 約束の版 1.1（0085）: 公的年金等以外の雑所得（業務・その他を合わせた収入−必要経費。赤字はマイナス）。雑所得の行がある年だけ */
  readonly miscellaneousNet?: Yen;
  /** 約束の版 1.1（0085）: 事業所得の収入−必要経費（赤字はマイナス）。事業所得の行がある年だけ */
  readonly businessNet?: Yen;
}

/** income.flows: 入るお金の行のお金の動きと、税を受ける人×年の所得（0044） */
export interface IncomeFlowsOutput {
  readonly flows: readonly Flow[];
  readonly byMember: readonly IncomeFlowsTaxRow[];
}

/** gift.received: 構成員が受け取る贈与（受け取る月の昇順） */
export interface GiftReceived {
  readonly ym: string;
  readonly source: "housingPurchase" | "education" | "insurance" | "incomeFlow" | "periodicExpense";
  readonly object: string;
  readonly amount: Yen;
  /** 贈与者の区分（特例税率は直系尊属から） */
  readonly giver: "parent" | "grandparent" | "household" | "other";
  readonly giverMember: string | null;
  /** 約束の版 1.1: 世帯の外の贈与者（donors の ID）。同じ贈与者からの贈与を合わせて数える */
  readonly donor?: string;
  readonly method: "calendar" | "settlement";
  readonly housing: "energySaving" | "other" | null;
  /** 世帯の外から受け取る贈与か（その贈与税をキャッシュフロー表に載せる） */
  readonly inflow: boolean;
}

export interface GiftReceivedOutput {
  readonly gifts: readonly GiftReceived[];
}

/** gift.tax: 受け取る構成員×年の贈与税 */
export interface GiftTaxOutput {
  readonly flows: readonly Flow[];
  readonly amount: Yen;
  readonly exempt: Yen;
  readonly calendarTaxable: Yen;
  readonly settlementTaxable: Yen;
  readonly tax: Yen;
  /** 相続時精算課税の特別控除の残り（年末。贈与者ごと） */
  readonly settlementRemaining: readonly { readonly giver: string; readonly remaining: Yen }[];
  readonly inCashflow: boolean;
  /**
   * 約束の版 1.1（0039）: その年の相続時精算課税の贈与の、贈与者ごとの額（住宅取得等資金の非課税と基礎控除の後。贈与者が亡くなったときに
   * 相続税の課税価格に足す額）と贈与税。member は世帯の贈与者（払う人。省略は世帯の外か払う人の指定なし）、objects は贈与の物。精算課税の贈与のある年だけ
   */
  readonly settlementByGiver?: readonly { readonly giver: string; readonly member?: string; readonly objects: readonly string[]; readonly amount: Yen; readonly tax: Yen }[];
}

/** plan.cashflow の details（約束の版 1.2 の任意の欄。エンジンが出力の summary に写す。1.6 で realEstate を足した） */
export interface CashflowDetails {
  insurance?: {
    readonly contracts: readonly {
      readonly object: string;
      readonly template: string;
      readonly policyholder: string;
      readonly insured: string;
      readonly coverages: readonly { readonly id: string; readonly role: string; readonly benefit: string; readonly amount: Yen; readonly from?: string; readonly to?: string; readonly insured?: string }[];
    }[];
    readonly byYear: readonly { readonly year: number; readonly object: string; readonly premium: Yen; readonly deathBenefit: Yen; readonly surrenderValue: Yen; readonly paid?: Yen; readonly others?: readonly { readonly member: string; readonly deathBenefit: Yen }[] }[];
  };
  gifts?: readonly {
    readonly year: number;
    readonly recipient: string;
    readonly amount: Yen;
    readonly exempt: Yen;
    readonly calendarTaxable: Yen;
    readonly settlementTaxable: Yen;
    readonly tax: Yen;
    readonly inCashflow: boolean;
  }[];
  /** 世帯の外の家族のお金（0042）: お金を入れた人ごとの、尽きる見込みの月（尽きなければ null） */
  outsideWallets?: readonly { readonly member: string; readonly depleted: string | null }[];
  /** 住まい以外の不動産の物件ごとの年末の評価額・不動産所得の内訳・売却（asset.realEstate の出力の properties のまま。約束の版 1.6。0009 の追記） */
  realEstate?: RealEstateOutput["properties"];
  /** 収益不動産の分析の数字（asset.realEstateAnalysis の出力のまま。約束の版 1.7。0082） */
  realEstateAnalysis?: RealEstateAnalysisOutput;
}

/** benefit.unemployment: 雇用保険の基本手当・高年齢求職者給付金を受ける日のある月（日数は30日を1か月とみなす近似。日額は基本手当日額） */
export interface UnemploymentReceipt {
  readonly month: string;
  readonly days: number;
  readonly daily: Yen;
}

/**
 * benefit.unemployment: 65歳前の老齢厚生年金（特別支給・繰上げ）を止める月。basicAllowance は基本手当との調整（全額を止める）、
 * continuation は高年齢雇用継続給付との調整（amount は止める額の月額。在職老齢年金の停止に加えて止める）
 */
export interface UnemploymentPensionStop {
  readonly month: string;
  readonly kind: "basicAllowance" | "continuation";
  readonly amount?: Yen;
}

export interface UnemploymentOutput {
  readonly flows: readonly Flow[];
  readonly receipts: readonly UnemploymentReceipt[];
  readonly pensionStops: readonly UnemploymentPensionStop[];
}

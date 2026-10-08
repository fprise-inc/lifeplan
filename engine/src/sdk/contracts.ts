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
}

export interface CoverageBonus {
  readonly month: string;
  readonly period: string;
  readonly healthStdBonus: Yen | null;
  readonly pensionStdBonus: Yen | null;
  readonly care: boolean;
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

/** tax.employmentIncome: 給与収入・給与所得控除額・給与所得 */
export interface EmploymentIncomeOutput {
  readonly revenue: Yen;
  readonly deduction: Yen;
  readonly income: Yen;
}

/** tax.totalIncome: 合計所得金額（いまは給与所得だけ） */
export interface TotalIncomeOutput {
  readonly total: Yen;
  readonly employment: Yen;
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

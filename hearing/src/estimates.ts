// 空欄・「わからない」を補う目安の値（0008 の2 の「推定」）。入力の画面（app/src/workspace/input/estimates.ts）とヒアリングシートの取り込みは、
// どちらもこのファイルの純粋な計算を使う（推定の目安の数と根拠の文を1か所に置く。0008 の追記 2026-10-26）。
// - 統計の数は正本の YAML（data/master の master.wageStats・master.retirementBenefit。0007）の写し statistics.generated.ts から読む
// - 式に使う制度の値（給与所得控除・住民税の基礎控除と均等割・標準報酬月額の等級表）も正本の制度データ（data/regulation）の写しから読む
// - 出典の統計表をまだ原本で確かめていない値は、根拠の文に「原本での確かめ前」と書く。出典の無い仮の値は、このファイルの中に「仮の値」と書いて置く
import { bracketStep, gradeAmount, masterAmount, masterValue, regulationValue, type BracketStep, type GradeRow } from "./statistics.ts";
import type { ValueBox } from "./types.ts";

export interface Estimate {
  readonly value: number;
  readonly basis: string;
}

const PENDING = "（原本での確かめ前）";
const pendingOf = (id: string): string => (masterValue(id)?.reviewed === true ? "" : PENDING);
const titleOf = (id: string): string => masterValue(id)?.title ?? id;

// ---- 基本生活費 ----

/** 基本生活費の目安（月額・円）。住居費・教育費・保険料・車両費を除く。世帯の人数ごと（仮の値。家計調査の世帯人員別の表で確かめる前） */
const LIVING_BY_SIZE: readonly number[] = [0, 140000, 250000, 280000, 300000];
const LIVING_BASIS = "家計調査（総務省）2024年の消費支出から住居・教育を除いた目安（仮の値。原本での確かめ前）";

export function livingEstimate(size: number): Estimate {
  const n = Math.max(1, size);
  const value = LIVING_BY_SIZE[Math.min(n, LIVING_BY_SIZE.length - 1)] as number;
  return { value, basis: `${LIVING_BASIS}・${n >= 4 ? "4人以上" : `${n}人`}の世帯` };
}

// ---- 給与・賞与 ----

/** 賃金構造基本統計調査の雇用形態（正社員・正職員／正社員・正職員以外）。働き方の種類から */
const WAGE_EMPLOYMENT: Readonly<Record<string, "regular" | "nonRegular">> = { regular: "regular", contract: "nonRegular" };

/** 統計の表が無い働き方・賞与の目安（年額。給与は賞与を除く）。仮の値（出典の統計表で確かめる前） */
const PROVISIONAL: Readonly<Record<string, { male: readonly [number, number]; female: readonly [number, number] }>> = {
  regular: { male: [4300000, 1000000], female: [3300000, 700000] },
  civilServant: { male: [4500000, 1600000], female: [4000000, 1400000] },
  contract: { male: [3200000, 300000], female: [2600000, 200000] },
  partTime: { male: [1500000, 0], female: [1000000, 0] },
  executive: { male: [6000000, 0], female: [4800000, 0] },
};
const PROVISIONAL_BASIS = "の目安（仮の値。出典の統計表で確かめる前）";
const BONUS_BASIS = "賞与の目安（仮の値。賃金構造基本統計調査の年間賞与その他特別給与額の表で確かめる前）";

export type WageSize = "all" | "large" | "medium" | "small";

/** 勤め先の規模（常用労働者数）→ 賃金構造基本統計調査の企業規模の区分（1,000人以上・100〜999人・10〜99人） */
export function wageSizeClass(size: number | undefined): WageSize {
  if (size === undefined) return "all";
  return size >= 1000 ? "large" : size >= 100 ? "medium" : "small";
}

const SEX_LABEL = { male: "男性", female: "女性" } as const;

export interface SalaryOptions {
  /** 年齢（その期間の始まりか計算基準月の遅いほうの年齢）。年齢階級の表があれば使う */
  readonly age?: number;
  /** 勤め先の規模（常用労働者数）。規模別の表があれば使う（詳細で入れたときだけ） */
  readonly size?: number;
}

type WageMeasure = "contractualMonthly" | "annualBonus";

/** 年齢階級の表（段階表。upTo が年齢階級の上限の年齢）。値ID は wageStats.byAge.<measure>.<雇用形態>.<性別>.<規模> */
export function wageAgeTable(measure: WageMeasure, employment: "regular" | "nonRegular", sex: "male" | "female", size: WageSize): { id: string; table: readonly BracketStep[] } | null {
  const id = `wageStats.byAge.${measure}.${employment}.${sex}.${size}`;
  const v = masterValue(id)?.value;
  return Array.isArray(v) ? { id, table: v as readonly BracketStep[] } : null;
}

/** 年齢階級の表から、その年齢の額（規模別の表に値が無ければ企業規模計。段に値が無ければ null） */
function ageAmount(measure: WageMeasure, employment: "regular" | "nonRegular", sex: "male" | "female", options: SalaryOptions): { id: string; amount: number } | null {
  if (options.age === undefined) return null;
  const want = wageSizeClass(options.size);
  const sizes: readonly WageSize[] = want === "all" ? ["all"] : [want, "all"];
  for (const size of sizes) {
    const t = wageAgeTable(measure, employment, sex, size);
    const amount = t === null ? undefined : bracketStep(t.table, options.age)?.amount;
    if (t !== null && amount !== undefined) return { id: t.id, amount };
  }
  return null;
}

/**
 * 給与（賞与を除く年額）と賞与の目安。性別・働き方の種類ごと。年齢・勤め先の規模を渡すと、年齢階級（・規模）の表があればそれを使う。
 * 正社員・契約社員などの給与は賃金構造基本統計調査（年齢階級の表が無い間は年齢計の所定内給与額×12）。公務員・パート・役員と賞与は仮の値
 */
export function salaryEstimate(type: string, sex: string, options: SalaryOptions = {}): { annual: Estimate; bonus: Estimate } | null {
  const row = PROVISIONAL[type];
  if (row === undefined) return null;
  const s = sex === "female" ? "female" : "male";
  const [provAnnual, provBonus] = row[s];
  const label = SEX_LABEL[s];
  let annual: Estimate = { value: provAnnual, basis: `${label}の給与${PROVISIONAL_BASIS}` };
  let bonus: Estimate = { value: provBonus, basis: provBonus === 0 ? `${label}・賞与なしとみなした目安（仮の値）` : `${label}の${BONUS_BASIS}` };
  const emp = WAGE_EMPLOYMENT[type];
  if (emp !== undefined) {
    const byAge = ageAmount("contractualMonthly", emp, s, options);
    if (byAge !== null) {
      annual = { value: byAge.amount * 12, basis: `${titleOf(byAge.id)}の${String(options.age)}歳の階級×12${pendingOf(byAge.id)}` };
    } else {
      const id = `wageStats.scheduledMonthly.${emp}.${s}`;
      const monthly = masterAmount(id);
      if (monthly !== null) annual = { value: monthly * 12, basis: `${titleOf(id)}×12（残業代などの所定外の給与は含まない）${pendingOf(id)}` };
    }
    const bonusByAge = ageAmount("annualBonus", emp, s, options);
    if (bonusByAge !== null) bonus = { value: bonusByAge.amount, basis: `${titleOf(bonusByAge.id)}の${String(options.age)}歳の階級${pendingOf(bonusByAge.id)}` };
  }
  return { annual, bonus };
}

/**
 * 年齢の賃金カーブ（昇給カーブ）の係数の表: 年齢階級の表（きまって支給する現金給与額）の各段を、最初の段（〜19歳）を1とした比にしたもの。
 * 計算エンジンの昇給カーブ（salary.growth.curve の段階表。upTo が年齢、rate が係数）と同じ形。表が無い・値の無い段があれば null。
 * 既定では使わない（将来の昇給の既定は前提の賃金上昇率だけ）。詳細で選んだときだけ使う
 */
export function wageCurve(type: string, sex: string, size?: number): readonly { upTo: number | null; rate: string }[] | null {
  const emp = WAGE_EMPLOYMENT[type];
  if (emp === undefined) return null;
  const s = sex === "female" ? "female" : "male";
  const want = wageSizeClass(size);
  const t = wageAgeTable("contractualMonthly", emp, s, want) ?? (want === "all" ? null : wageAgeTable("contractualMonthly", emp, s, "all"));
  if (t === null || t.table.some((x) => x.amount === undefined)) return null;
  const base = t.table[0]?.amount ?? 0;
  if (base <= 0) return null;
  // 係数は小数4桁の10進の文字列（0007 の2: 率は文字列）。整数で割って四捨五入する
  return t.table.map((x) => {
    const r = Math.round(((x.amount as number) * 10000) / base);
    return { upTo: x.upTo, rate: `${Math.floor(r / 10000)}.${String(r % 10000).padStart(4, "0")}` };
  });
}

/**
 * 年収（賞与を含む）だけが分かるときの賞与の目安: 上の目安の賞与の割合を当てる（ヒアリングシートだけの補い方。
 * 源泉徴収票の支払金額は賞与を含むので、賞与が分からないと月々の給与に分けられない）
 */
export function bonusShareEstimate(type: string, sex: string, total: number, options: SalaryOptions = {}): Estimate | null {
  const e = salaryEstimate(type, sex, options);
  if (e === null) return null;
  const sum = e.annual.value + e.bonus.value;
  const value = sum === 0 ? 0 : Math.round((total * e.bonus.value) / sum / 1000) * 1000;
  return { value, basis: "年収に、給与と賞与の目安（賃金構造基本統計調査と賞与の仮の値）の賞与の割合を当てた目安" };
}

// ---- 事業所得 ----

const BUSINESS_ID = "wageStats.business.operatingProfit";

/** 自営業の事業所得の目安（個人企業の1企業当たりの年間営業利益） */
export function businessEstimate(): Estimate {
  const v = masterAmount(BUSINESS_ID);
  if (v === null) return { value: 3000000, basis: "個人企業の営業利益の目安（仮の値）" };
  return { value: v, basis: `${titleOf(BUSINESS_ID)}${pendingOf(BUSINESS_ID)}` };
}

// ---- 標準報酬月額 ----

const SMR_BASIS = "年収（賞与を除く）÷12 を標準報酬月額の等級表に当てた目安";

/**
 * 標準報酬月額の目安（健康保険・厚生年金）: 年収（賞与を除く）÷12 を、その月（YYYY-MM）の等級表（制度データ）に当てた額。
 * 計算エンジンは入力の標準報酬月額をそのまま使うので、等級表の下限・上限（厚生年金は 88,000円〜）に合わせる
 */
export function smrEstimate(annual: number, month: string): { health: ValueBox<number>; pension: ValueBox<number> } {
  const r = Math.round(annual / 12);
  const date = `${month}-01`;
  const of = (kind: "health" | "pension"): number => {
    const rows = regulationValue(`socialInsurance.${kind}.standardMonthlyRemuneration`, date) as readonly GradeRow[] | null;
    return (rows === null ? null : gradeAmount(rows, r)) ?? Math.max(58000, Math.round(r / 1000) * 1000);
  };
  const box = (v: number): ValueBox<number> => ({ value: v, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: SMR_BASIS } });
  return { health: box(of("health")), pension: box(of("pension")) };
}

// ---- 働き始め ----

/** 今の年齢から見た、ふつうの働き始め（22歳の4月）。過去の期間の始まりの目安（標準の値） */
export function careerStartMonth(birthYearMonth: string): string {
  return `${Number(birthYearMonth.slice(0, 4)) + 22}-04`;
}

// ---- 住民税（今年度の決定額の概算）----

/** 計算基準月が入る住民税の年度（6月から翌年5月） */
export function residentTaxYear(baseMonth: string): number {
  const [y, m] = baseMonth.split("-").map(Number) as [number, number];
  return m >= 6 ? y : y - 1;
}

const RESIDENT_BASIS = "前の年の給与・事業の所得からの概算（住民税の決定通知書の年税額を入れると置き換わります）";

/** 給与所得控除（その年分の制度データの段階表。額は 収入×rate＋amount、rate の無い段は amount） */
function employmentDeduction(salary: number, incomeYear: number): number {
  const table = regulationValue("incomeTax.employmentIncomeDeduction", `${incomeYear}-01-01`) as readonly BracketStep[] | null;
  const step = table === null ? null : bracketStep(table, salary);
  if (step === null) return 650000;
  const amount = step.amount ?? 0;
  return step.rate === undefined ? amount : Math.floor(salary * Number(step.rate)) + amount;
}

/**
 * 給与（賞与込み）または事業所得からの住民税の概算。incomeYear は所得の年（住民税の年度の前の年）。
 * 給与所得控除・住民税の基礎控除・均等割（市町村・道府県・森林環境税）は制度データの値。所得割10%。社会保険料は収入の15%とみなす（調整控除などは見ない）
 */
export function residentTaxEstimate(salary: number, business: number, incomeYear: number): Estimate {
  const s = salary;
  const ded = Math.min(s, employmentDeduction(s, incomeYear));
  const fiscal = `${incomeYear + 1}-06-01`;
  const income = Math.max(0, s - ded) + business;
  const basic = regulationValue("residentTax.basicDeduction", fiscal) as readonly BracketStep[] | null;
  const basicAmount = (basic === null ? null : bracketStep(basic, income)?.amount) ?? 430000;
  const perCapita = ["residentTax.perCapita.municipal", "residentTax.perCapita.prefectural", "forestEnvironmentTax.amount"].reduce((sum, id) => sum + ((regulationValue(id, fiscal) as number | null) ?? 0), 0);
  const taxable = income - basicAmount - (s + business) * 0.15;
  const value = taxable <= 0 ? 0 : Math.round((taxable * 0.1 + perCapita) / 100) * 100;
  return { value, basis: RESIDENT_BASIS };
}

// ---- 健康保険組合・共済組合の料率 ----

/** 健康保険組合・共済組合の保険料率（被保険者の負担分）の目安。料率は組合ごとに違うので、給与明細で確かめるまでの仮の値 */
export function healthRateEstimate(kind: "union" | "mutualAid"): { value: string; basis: string } {
  return kind === "union"
    ? { value: "0.0466", basis: "健康保険組合の平均の保険料率（9.32%）の半分の目安（仮の値。原本での確かめ前。給与明細の健康保険料で確かめてください）" }
    : { value: "0.0490", basis: "共済組合の保険料率の目安（仮の値。原本での確かめ前。給与明細の短期掛金で確かめてください）" };
}

// ---- 車 ----

/** 車の目安（1台。計算基準年の価格）。買い替えの周期・車両の価格（下取りを引く前）・維持費の年額。自動車税のほかは仮の値 */
const CAR_BASIS = "自動車の保有・維持費の目安（仮の値。原本での確かめ前）";
export const CAR_ESTIMATE = {
  everyYears: { value: 8, basis: `${CAR_BASIS}・乗り換えの間隔` },
  price: { value: 2500000, basis: `${CAR_BASIS}・新車の価格` },
  tradeIn: { value: 500000, basis: `${CAR_BASIS}・下取り` },
  /** 維持費の合計（自動車税・保険・車検・駐車場・燃料） */
  upkeep: { value: 360000, basis: `${CAR_BASIS}・維持費の合計（自動車税・保険・車検・駐車場・燃料）` },
  tax: { value: 36000, basis: "自動車税（種別割）の標準税率（自家用の乗用車・1.5リットル超2リットル以下・2019年10月以後の新規登録）" },
  insurance: { value: 70000, basis: `${CAR_BASIS}・任意保険` },
  inspection: { value: 100000, basis: `${CAR_BASIS}・車検1回（法定費用と整備）` },
  parking: { value: 0, basis: `${CAR_BASIS}・駐車場（自宅に置く）` },
  fuel: { value: 100000, basis: `${CAR_BASIS}・燃料` },
} as const satisfies Record<string, Estimate>;

// ---- 退職給付（会社員） ----

const PREVALENCE_ID = "retirementBenefit.prevalence";

/** 退職給付（一時金・年金）制度がある企業の割合の目安（千分率の整数。74.9% → 749）。勤め先の規模を渡すと規模別（値の無い規模は企業規模計） */
export function retirementPrevalence(size?: number): Estimate | null {
  const all = masterValue(PREVALENCE_ID)?.value;
  const bySize = masterValue(`${PREVALENCE_ID}.bySize`)?.value;
  const step = size !== undefined && Array.isArray(bySize) ? bracketStep(bySize as readonly BracketStep[], size) : null;
  const id = step?.rate !== undefined ? `${PREVALENCE_ID}.bySize` : PREVALENCE_ID;
  const rate = step?.rate ?? (typeof all === "string" ? all : null);
  if (rate === null) return null;
  return { value: Math.round(Number(rate) * 1000), basis: `${titleOf(id)}${pendingOf(id)}` };
}

export type RetirementEducation = "university" | "highSchoolOffice" | "highSchoolManual";

/**
 * 会社員の退職一時金（退職給付）の目安。統計を入れてあるのは「勤続20年以上かつ45歳以上の定年退職」の学歴・職種別の平均だけなので、
 * それ以外（勤続20年未満・自己都合・会社都合など）は null（目安なし）。学歴が分からないときは大学・大学院卒の値
 */
export function retirementLumpSumEstimate(o: { reason: "mandatory" | "company" | "voluntary"; yearsOfService: number; ageAtRetirement: number; education?: RetirementEducation }): Estimate | null {
  if (o.reason !== "mandatory" || o.yearsOfService < 20 || o.ageAtRetirement < 45) return null;
  const id = `retirementBenefit.mandatory.${o.education ?? "university"}`;
  const v = masterAmount(id);
  return v === null ? null : { value: v, basis: `${titleOf(id)}${pendingOf(id)}` };
}

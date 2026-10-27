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
/** 値の題名（画面の根拠の文に出すので、データの読み方の注記〔upTo の説明など〕は外す） */
const titleOf = (id: string): string =>
  (masterValue(id)?.title ?? id).replace(/。upTo は[^）]*/g, "").replace(/（upTo は[^）]*）/g, "").replace(/。各段は[^）]*/g, "").replace(/。1人の段は[^）]*/g, "");

// ---- 基本生活費 ----

const LIVING_ID = "living.statistics.basicMonthly";
/** 1人の世帯の基本生活費の目安（月額）。統計の表（二人以上の世帯の世帯人員別）に単身世帯が無いので仮の値 */
const LIVING_SINGLE = 140000;

/**
 * 基本生活費の目安（月額・円）。住居費・教育費・保険料・車両費を除く。世帯の人数ごと。
 * 2人以上は家計調査（二人以上の世帯の世帯人員別）の消費支出から住居・教育・自動車等関係費を除いた額。1人は仮の値
 */
export function livingEstimate(size: number): Estimate {
  const n = Math.max(1, size);
  const table = masterValue(LIVING_ID)?.value;
  const amount = Array.isArray(table) ? bracketStep(table as readonly BracketStep[], n)?.amount : undefined;
  if (amount === undefined) return { value: LIVING_SINGLE, basis: `${n}人の世帯の基本生活費の目安（仮の値。家計調査の単身世帯の表で確かめる前）` };
  return { value: amount, basis: `${titleOf(LIVING_ID)}・${n >= 6 ? "6人以上" : `${n}人`}の世帯${pendingOf(LIVING_ID)}` };
}

/** 総額を費目に分けるときの費目（家計調査の区分。仕送りは教育・介護・親のカードで入れるので0円にし、端は「その他の消費」） */
export const LIVING_SPLIT_CATEGORIES = ["food", "utilities", "furniture", "clothing", "health", "transport", "recreation", "otherConsumption"] as const;
export type LivingSplitCategory = (typeof LIVING_SPLIT_CATEGORIES)[number];
const livingCategoryId = (c: LivingSplitCategory) => `living.statistics.categoryMonthly.${c}`;

/**
 * 基本生活費の費目の目安（月額・円）。家計調査の同じ世帯人員の世帯の費目の額（交通・通信は自動車等関係費を除く。その他の消費は仕送り金を含む）。
 * 1人の世帯は表に無いので2人の世帯の額を使う。値が無ければ null
 */
export function livingCategoryAverages(size: number): { amounts: Readonly<Record<LivingSplitCategory, number>>; basis: string } | null {
  const n = Math.max(2, size);
  const out: Partial<Record<LivingSplitCategory, number>> = {};
  for (const c of LIVING_SPLIT_CATEGORIES) {
    const table = masterValue(livingCategoryId(c))?.value;
    const amount = Array.isArray(table) ? bracketStep(table as readonly BracketStep[], n)?.amount : undefined;
    if (amount === undefined) return null;
    out[c] = amount;
  }
  const label = n >= 6 ? "6人以上" : `${n}人`;
  const pending = LIVING_SPLIT_CATEGORIES.some((c) => pendingOf(livingCategoryId(c)) !== "") ? PENDING : "";
  return {
    amounts: out as Record<LivingSplitCategory, number>,
    basis: `家計調査（総務省）2025年・${label}の世帯の内訳の割合${size < 2 ? "（1人の世帯は表に無いので2人の世帯）" : ""}${pending}`,
  };
}

/** 総額（月額）を費目に分ける（家計調査の同じ人数の世帯の割合。円未満は切り捨て、端は「その他の消費」）。割合の表が無ければ null */
export function splitLiving(total: number, size: number): { parts: Readonly<Record<LivingSplitCategory, number>>; basis: string } | null {
  const avg = livingCategoryAverages(size);
  if (avg === null) return null;
  const sum = LIVING_SPLIT_CATEGORIES.reduce((s, c) => s + avg.amounts[c], 0);
  const parts: Partial<Record<LivingSplitCategory, number>> = {};
  let used = 0;
  for (const c of LIVING_SPLIT_CATEGORIES) {
    if (c === "otherConsumption") continue;
    const v = sum > 0 ? Math.floor((total * avg.amounts[c]) / sum) : 0;
    parts[c] = v;
    used += v;
  }
  parts.otherConsumption = total - used;
  return { parts: parts as Record<LivingSplitCategory, number>, basis: avg.basis };
}

// ---- 給与・賞与 ----

/** 賃金構造基本統計調査の雇用形態（正社員・正職員／正社員・正職員以外）。働き方の種類から */
const WAGE_EMPLOYMENT: Readonly<Record<string, "regular" | "nonRegular">> = { regular: "regular", contract: "nonRegular" };

/** 統計の表が無い働き方・賞与の目安（年額。給与は賞与を除く）。仮の値（統計の値が無いときの代わりも兼ねる） */
const PROVISIONAL: Readonly<Record<string, { male: readonly [number, number]; female: readonly [number, number] }>> = {
  regular: { male: [4300000, 1000000], female: [3300000, 700000] },
  civilServant: { male: [4500000, 1600000], female: [4000000, 1400000] },
  contract: { male: [3200000, 300000], female: [2600000, 200000] },
  partTime: { male: [1500000, 0], female: [1000000, 0] },
  executive: { male: [6000000, 0], female: [4800000, 0] },
};
const PROVISIONAL_BASIS = "の目安（仮の値。出典の統計の値が無い）";

/** パートの年収の推定の働く時間（週15時間×52週。本人の決まり） */
export const PART_TIME_HOURS = { weekly: 15, weeks: 52 } as const;

export type WageSize = "all" | "large" | "medium" | "small";

/** 勤め先の規模（常用労働者数）→ 賃金構造基本統計調査の企業規模の区分（1,000人以上・100〜999人・10〜99人） */
export function wageSizeClass(size: number | undefined): WageSize {
  if (size === undefined) return "all";
  return size >= 1000 ? "large" : size >= 100 ? "medium" : "small";
}

const SEX_LABEL = { male: "男性", female: "女性" } as const;

export interface SalaryOptions {
  /** 年齢（その期間の始まりか計算基準月の遅いほうの年齢）。年齢階級の表を使う */
  readonly age?: number;
  /** 勤め先の規模（常用労働者数）。規模別の表を使う（詳細で入れたときだけ渡す決まり） */
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

/** 年齢階級の表か年齢計の値（表の無い・段に値の無いときは年齢計） */
function wageAmount(measure: WageMeasure, employment: "regular" | "nonRegular", sex: "male" | "female", options: SalaryOptions): { id: string; amount: number; byAge: boolean } | null {
  const a = ageAmount(measure, employment, sex, options);
  if (a !== null) return { ...a, byAge: true };
  const id = `wageStats.${measure}.${employment}.${sex}`;
  const v = masterAmount(id);
  return v === null ? null : { id, amount: v, byAge: false };
}

/**
 * 給与（賞与を除く年額）と賞与の目安。性別・働き方の種類・年齢（・勤め先の規模）ごと。
 * - 正社員・契約社員など: 賃金構造基本統計調査の年齢階級別の「きまって支給する現金給与額」×12（残業代などの所定外の給与・通勤手当を含む）と年間賞与その他特別給与額
 * - 公務員: 国家公務員給与等実態調査の行政職俸給表（一）の年齢階層別の平均給与月額×12（賞与は仮の値）
 * - パート: 短時間労働者の1時間当たり所定内給与額×週15時間×52週（賞与なし）
 * - 役員: 仮の値
 */
export function salaryEstimate(type: string, sex: string, options: SalaryOptions = {}): { annual: Estimate; bonus: Estimate } | null {
  const row = PROVISIONAL[type];
  if (row === undefined) return null;
  const s = sex === "female" ? "female" : "male";
  const [provAnnual, provBonus] = row[s];
  const label = SEX_LABEL[s];
  const age = options.age === undefined ? "" : `の${String(options.age)}歳の階級`;
  let annual: Estimate = { value: provAnnual, basis: `${label}の給与${PROVISIONAL_BASIS}` };
  let bonus: Estimate = { value: provBonus, basis: provBonus === 0 ? `${label}・賞与なしとみなした目安（仮の値）` : `${label}の賞与${PROVISIONAL_BASIS}` };
  const emp = WAGE_EMPLOYMENT[type];
  if (emp !== undefined) {
    const m = wageAmount("contractualMonthly", emp, s, options);
    if (m !== null) annual = { value: m.amount * 12, basis: `${titleOf(m.id)}${m.byAge ? age : ""}×12（残業代などの所定外の給与・通勤手当などを含む）${pendingOf(m.id)}` };
    const b = wageAmount("annualBonus", emp, s, options);
    if (b !== null) bonus = { value: b.amount, basis: `${titleOf(b.id)}${b.byAge ? age : ""}${pendingOf(b.id)}` };
  } else if (type === "civilServant") {
    const tableId = "wageStats.civilServant.monthlyByAge";
    const table = masterValue(tableId)?.value;
    const byAge = options.age !== undefined && Array.isArray(table) ? bracketStep(table as readonly BracketStep[], options.age)?.amount : undefined;
    const totalId = "wageStats.civilServant.monthly";
    const id = byAge !== undefined ? tableId : totalId;
    const monthly = byAge ?? masterAmount(totalId);
    if (monthly !== null) annual = { value: monthly * 12, basis: `${titleOf(id)}${byAge !== undefined ? age : ""}×12（俸給と諸手当。超過勤務手当・通勤手当は含まない。男女の区別なし）${pendingOf(id)}` };
  } else if (type === "partTime") {
    const id = `wageStats.partTimeHourly.${s}`;
    const hourly = masterAmount(id);
    if (hourly !== null) annual = { value: hourly * PART_TIME_HOURS.weekly * PART_TIME_HOURS.weeks, basis: `${titleOf(id)}×週${PART_TIME_HOURS.weekly}時間×${PART_TIME_HOURS.weeks}週${pendingOf(id)}` };
  }
  return { annual, bonus };
}

/**
 * 年齢の賃金カーブ（昇給カーブ）の係数の表: 年齢階級の表の年収（きまって支給する現金給与額×12＋年間賞与）の各段を、最初の段（〜19歳）を1とした比にしたもの。
 * 計算エンジンの既定のカーブ wageStats.default（正社員・正職員 男女計）と同じ作り方で、雇用形態・性別・規模ごと。
 * 計算エンジンの昇給カーブ（salary.growth.curve の段階表。upTo が年齢、rate が係数）と同じ形。表が無い・値の無い段があれば null。
 * 既定では使わない（将来の昇給の既定は前提の賃金上昇率だけ）。詳細で選んだときだけ使う
 */
export function wageCurve(type: string, sex: string, size?: number): readonly { upTo: number | null; rate: string }[] | null {
  const emp = WAGE_EMPLOYMENT[type];
  if (emp === undefined) return null;
  const s = sex === "female" ? "female" : "male";
  const want = wageSizeClass(size);
  const pick = (m: WageMeasure) => wageAgeTable(m, emp, s, want) ?? (want === "all" ? null : wageAgeTable(m, emp, s, "all"));
  const monthly = pick("contractualMonthly");
  const bonus = pick("annualBonus");
  if (monthly === null || bonus === null || monthly.table.length !== bonus.table.length) return null;
  const annual = monthly.table.map((x, i) => (x.amount === undefined || bonus.table[i]?.amount === undefined ? null : x.amount * 12 + (bonus.table[i]?.amount as number)));
  const base = annual[0];
  if (annual.some((x) => x === null) || base === null || base === undefined || base <= 0) return null;
  // 係数は小数4桁の10進の文字列（0007 の2: 率は文字列）。整数で割って四捨五入する
  return monthly.table.map((x, i) => {
    const r = Math.round(((annual[i] as number) * 10000) / base);
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
  return { value, basis: `年収に、給与と賞与の目安の賞与の割合を当てた目安（${e.bonus.basis}）` };
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

/** 10進の文字列の率の半分（桁を1つ足して割り切る。浮動小数点を使わない） */
function halfRate(rate: string): string {
  const [i, f = ""] = rate.split(".");
  const digits = BigInt(`${i}${f}`);
  const scale = f.length + 1;
  const half = (digits * 10n) / 2n;
  const t = half.toString().padStart(scale + 1, "0");
  return `${t.slice(0, -scale)}.${t.slice(-scale)}`.replace(/0+$/, "").replace(/\.$/, ".0");
}

/**
 * 健康保険組合・共済組合の保険料率（被保険者の負担分）の目安。料率は組合ごとに違うので、給与明細で確かめるまでの仮の値。
 * 健康保険組合は、協会けんぽの料率（制度データ。支部は省略で東京）の半分を仮に入れる。共済組合は仮の値
 */
export function healthRateEstimate(kind: "union" | "mutualAid", options: { month?: string; branch?: string } = {}): { value: string; basis: string } {
  if (kind === "mutualAid") return { value: "0.0490", basis: "共済組合の保険料率の目安（仮の値。給与明細の短期掛金で確かめてください）" };
  const branch = options.branch ?? "kyokaikenpo.13";
  const rate = regulationValue("socialInsurance.health.kyokaikenpo.rate", options.month === undefined ? null : `${options.month}-01`, branch);
  const note = "健康保険組合の料率を入れてください（給与明細の健康保険料÷標準報酬月額で逆算できます）";
  if (typeof rate !== "string") return { value: "0.0490", basis: `健康保険組合の保険料率の目安（仮の値）。${note}` };
  return { value: halfRate(rate), basis: `協会けんぽ（${branch === "kyokaikenpo.13" ? "東京支部" : "勤め先の都道府県の支部"}）の健康保険料率 ${rate} の半分を仮に入れています。${note}` };
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
export type RetirementReason = "mandatory" | "company" | "voluntary" | "earlyIncentive";

/**
 * 会社員の退職一時金（退職給付）の目安。学歴が分からないときは大学・大学院卒の値。
 * - 勤続20年以上かつ45歳以上: 就労条件総合調査（定年は勤続年数階級別、会社都合・自己都合・早期優遇は退職事由別の平均。常用労働者30人以上の企業）
 * - それより短い・若い: 東京都の中小企業（10〜299人）のモデル退職金の勤続年数別の額（自己都合はその表、ほかは会社都合の表）
 * 退職給付の制度が無い勤め先（およそ4分の1）もあるので、推定として出し、確かめの一覧に載せる前提
 */
export function retirementLumpSumEstimate(o: { reason: RetirementReason; yearsOfService: number; ageAtRetirement: number; education?: RetirementEducation }): Estimate | null {
  const edu = o.education ?? "university";
  if (o.yearsOfService >= 20 && o.ageAtRetirement >= 45) {
    const tableId = `retirementBenefit.mandatory.${edu}.byService`;
    const table = masterValue(tableId)?.value;
    const byService = o.reason === "mandatory" && Array.isArray(table) ? bracketStep(table as readonly BracketStep[], o.yearsOfService)?.amount : undefined;
    if (byService !== undefined) return { value: byService, basis: `${titleOf(tableId)}・勤続${String(o.yearsOfService)}年の階級${pendingOf(tableId)}` };
    const id = `retirementBenefit.${o.reason}.${edu}`;
    const v = masterAmount(id);
    if (v !== null) return { value: v, basis: `${titleOf(id)}${pendingOf(id)}` };
  }
  const tokyoEdu = edu === "university" ? "university" : "highSchool";
  const id = `retirementBenefit.smallFirm.${o.reason === "voluntary" ? "voluntary" : "company"}.${tokyoEdu}`;
  const table = masterValue(id)?.value;
  const v = Array.isArray(table) ? bracketStep(table as readonly BracketStep[], o.yearsOfService)?.amount : undefined;
  return v === undefined ? null : { value: v, basis: `${titleOf(id)}・勤続${String(o.yearsOfService)}年${pendingOf(id)}` };
}

// ---- 介護・親 ----

const LIFE_ID = (sex: "male" | "female") => `lifeTable.lifeExpectancy.${sex}`;

/**
 * 平均余命（年。小数）。簡易生命表の主な年齢の平均余命を、段の年齢の間は直線で補う（計算エンジンの必要保障額と同じ読み方）。
 * 性別が分からないときは男女の平均。値が無ければ null
 */
export function lifeExpectancy(age: number, sex: string | undefined): Estimate | null {
  const one = (s: "male" | "female"): number | null => {
    const table = masterValue(LIFE_ID(s))?.value;
    if (!Array.isArray(table)) return null;
    const steps = (table as readonly BracketStep[]).filter((x): x is BracketStep & { upTo: number; rate: string } => x.upTo !== null && x.rate !== undefined);
    const first = steps[0];
    const last = steps.at(-1);
    if (first === undefined || last === undefined) return null;
    if (age <= first.upTo) return Number(first.rate);
    if (age >= last.upTo) return Number(last.rate);
    for (let i = 1; i < steps.length; i++) {
      const a = steps[i - 1] as (typeof steps)[number];
      const b = steps[i] as (typeof steps)[number];
      if (age <= b.upTo) return Number(a.rate) + ((Number(b.rate) - Number(a.rate)) * (age - a.upTo)) / (b.upTo - a.upTo);
    }
    return null;
  };
  const sexes: ("male" | "female")[] = sex === "male" || sex === "female" ? [sex] : ["male", "female"];
  const vals = sexes.map(one);
  if (vals.some((v) => v === null)) return null;
  const value = (vals as number[]).reduce((s, v) => s + v, 0) / vals.length;
  const id = LIFE_ID(sexes[0] as "male" | "female");
  return { value, basis: `厚生労働省「簡易生命表」の${String(age)}歳の平均余命${sexes.length === 2 ? "（男女の平均）" : sex === "female" ? "（女）" : "（男）"}${pendingOf(id)}` };
}

/** 介護の費用の統計の目安（期間・月額・一時費用）。生命保険文化センター「生命保険に関する全国実態調査」 */
export function careEstimate(place: "home" | "facility"): { months: number; monthly: number; initial: number; basis: string } | null {
  const months = masterAmount("care.statistics.months");
  const monthly = masterAmount(place === "facility" ? "care.statistics.monthlyFacility" : "care.statistics.monthlyHome");
  const initial = masterAmount("care.statistics.initial");
  if (months === null || monthly === null || initial === null) return null;
  const ids = ["care.statistics.months", place === "facility" ? "care.statistics.monthlyFacility" : "care.statistics.monthlyHome", "care.statistics.initial"];
  const pending = ids.some((id) => pendingOf(id) !== "") ? PENDING : "";
  return { months, monthly, initial, basis: `生命保険文化センター「生命保険に関する全国実態調査」2024年度の平均（${place === "facility" ? "施設" : "在宅"}）${pending}` };
}

/** 親の扶養の境目（目安）。age はその年の年齢、date はその日（制度の値を選ぶ） */
export interface DependentLimits {
  /** 税の扶養（扶養控除）: 合計所得金額の上限（以下） */
  taxIncome: number;
  /** 税の扶養: 公的年金だけの人の年金の年額の上限（以下。公的年金等控除の最低額を足した額） */
  taxPension: number;
  /** 健康保険の扶養: 年収の基準（未満）。後期高齢者医療の年齢からは入れない（null） */
  health: number | null;
  /** 健康保険の扶養に入れなくなる年齢（後期高齢者医療） */
  lateElderlyAge: number;
}

export function dependentLimits(age: number, date: string): DependentLimits | null {
  const num = (id: string): number | null => {
    const v = regulationValue(id, date);
    return typeof v === "number" ? v : null;
  };
  const taxIncome = num("incomeTax.dependentIncomeLimit");
  const elderAge = num("incomeTax.publicPensionDeduction.elderlyAge");
  const lateAge = num("socialInsurance.health.lateElderlyAge");
  const healthAge = num("socialInsurance.dependent.elderlyAge");
  const limit = num("socialInsurance.dependent.incomeLimit");
  const limitElder = num("socialInsurance.dependent.incomeLimitElderly");
  if (taxIncome === null || elderAge === null || lateAge === null || healthAge === null || limit === null || limitElder === null) return null;
  const table = regulationValue(age >= elderAge ? "incomeTax.publicPensionDeduction.over65.tier1" : "incomeTax.publicPensionDeduction.under65.tier1", date);
  const minDeduction = Array.isArray(table) ? (table as readonly BracketStep[])[0]?.amount : undefined;
  if (minDeduction === undefined) return null;
  return { taxIncome, taxPension: taxIncome + minDeduction, health: age >= lateAge ? null : age >= healthAge ? limitElder : limit, lateElderlyAge: lateAge };
}

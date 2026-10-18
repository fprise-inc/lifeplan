// 空欄・「わからない」を補う目安の値（0008 の2 の「推定」）。入力の画面の「推定あり」（0008 の 2026-10-11 の追記の2）と同じ考え方・同じ値・同じ根拠の文にする。
// 値と文は app/src/workspace/input/estimates.ts の写し（どちらも原本での確かめの前の仮の値。制度データ・マスタデータ〔0007〕に移すときに一本にする）
import type { ValueBox } from "./types.ts";

export interface Estimate {
  readonly value: number;
  readonly basis: string;
}

/** 基本生活費の目安（月額・円）。住居費・教育費・保険料・車両費を除く。世帯の人数ごと */
const LIVING_BY_SIZE: readonly number[] = [0, 140000, 250000, 280000, 300000];
const LIVING_BASIS = "家計調査（総務省）2024年の消費支出から住居・教育を除いた目安（仮の値。原本での確かめ前）";

export function livingEstimate(size: number): Estimate {
  const n = Math.max(1, size);
  const value = LIVING_BY_SIZE[Math.min(n, LIVING_BY_SIZE.length - 1)] as number;
  return { value, basis: `${LIVING_BASIS}・${n >= 4 ? "4人以上" : `${n}人`}の世帯` };
}

/** 給与（賞与を除く年額）と賞与の目安。性別・雇用の形ごと */
const SALARY: Readonly<Record<string, { male: readonly [number, number]; female: readonly [number, number] }>> = {
  regular: { male: [4300000, 1000000], female: [3300000, 700000] },
  civilServant: { male: [4500000, 1600000], female: [4000000, 1400000] },
  contract: { male: [3200000, 300000], female: [2600000, 200000] },
  partTime: { male: [1500000, 0], female: [1000000, 0] },
  executive: { male: [6000000, 0], female: [4800000, 0] },
};
const SALARY_BASIS = "賃金構造基本統計調査（厚生労働省）2024年の平均の目安（仮の値。原本での確かめ前）";

export function salaryEstimate(type: string, sex: string): { annual: Estimate; bonus: Estimate } | null {
  const row = SALARY[type];
  if (row === undefined) return null;
  const [annual, bonus] = sex === "female" ? row.female : row.male;
  const label = `${SALARY_BASIS}・${sex === "female" ? "女性" : "男性"}`;
  return { annual: { value: annual, basis: label }, bonus: { value: bonus, basis: label } };
}

/**
 * 年収（賞与を含む）だけが分かるときの賞与の目安: 上の統計の賞与の割合を当てる（ヒアリングシートだけの補い方。
 * 源泉徴収票の支払金額は賞与を含むので、賞与が分からないと月々の給与に分けられない）
 */
export function bonusShareEstimate(type: string, sex: string, total: number): Estimate | null {
  const e = salaryEstimate(type, sex);
  if (e === null) return null;
  const sum = e.annual.value + e.bonus.value;
  const value = sum === 0 ? 0 : Math.round((total * e.bonus.value) / sum / 1000) * 1000;
  return { value, basis: `年収に、${SALARY_BASIS}の賞与の割合を当てた目安` };
}

/** 自営業の事業所得の目安 */
export function businessEstimate(): Estimate {
  return { value: 3000000, basis: "個人企業経済調査（総務省）の営業利益の目安（仮の値。原本での確かめ前）" };
}

const SMR_BASIS = "年収（賞与を除く）÷12 からの目安";

/** 標準報酬月額の目安（入力の画面と同じ近似） */
export function smrEstimate(annual: number): { health: ValueBox<number>; pension: ValueBox<number> } {
  const v = Math.max(58000, Math.round(annual / 12 / 1000) * 1000);
  const box = (): ValueBox<number> => ({ value: v, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: SMR_BASIS } });
  return { health: box(), pension: box() };
}

/** 今の年齢から見た、ふつうの働き始め（22歳の4月） */
export function careerStartMonth(birthYearMonth: string): string {
  return `${Number(birthYearMonth.slice(0, 4)) + 22}-04`;
}

/** 計算基準月が入る住民税の年度（6月から翌年5月） */
export function residentTaxYear(baseMonth: string): number {
  const [y, m] = baseMonth.split("-").map(Number) as [number, number];
  return m >= 6 ? y : y - 1;
}

const RESIDENT_BASIS = "前の年の給与・事業の所得からの概算（住民税の決定通知書の年税額を入れると置き換わります）";

/** 給与（賞与込み）または事業所得からの住民税の概算（入力の画面と同じ式。所得割10%＋均等割。社会保険料は収入の15%とみなす） */
export function residentTaxEstimate(salary: number, business: number): Estimate {
  const s = salary;
  const ded = s <= 1625000 ? 550000 : s <= 1800000 ? s * 0.4 - 100000 : s <= 3600000 ? s * 0.3 + 80000 : s <= 6600000 ? s * 0.2 + 440000 : s <= 8500000 ? s * 0.1 + 1100000 : 1950000;
  const income = Math.max(0, s - ded) + business;
  const taxable = income - 430000 - (s + business) * 0.15;
  const value = taxable <= 0 ? 0 : Math.round((taxable * 0.1 + 5000) / 100) * 100;
  return { value, basis: RESIDENT_BASIS };
}

/** 健康保険組合・共済組合の保険料率（被保険者の負担分）の目安。料率は組合ごとに違うので、給与明細で確かめるまでの仮の値 */
export function healthRateEstimate(kind: "union" | "mutualAid"): { value: string; basis: string } {
  return kind === "union"
    ? { value: "0.0466", basis: "健康保険組合の平均の保険料率（9.32%）の半分の目安（仮の値。原本での確かめ前。給与明細の健康保険料で確かめてください）" }
    : { value: "0.0490", basis: "共済組合の保険料率の目安（仮の値。原本での確かめ前。給与明細の短期掛金で確かめてください）" };
}

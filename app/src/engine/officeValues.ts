// 事務所の推定の値（0111）のうち、計算の要求に足す分（計算の要求の estimateValues。マスタデータの値ID → 事務所の値）。
// アプリが開いている間だけ持つ（事務所の既定値を読み込んだとき・保存したときに office/estimates.ts が入れる）。
// 計算の要求はエンジンへ渡すとき（moneyRows.ts の forEngine）に、ここの値を足す。画面の速い計算と本体の計算は同じ要求の文字列を使うので、
// 両方で同じ値になる（0005）。世帯ファイルには入れない。ほかの所に頼らないよう、何も読み込まない
import type { EstimateValue } from "./types.ts";

let values: Readonly<Record<string, EstimateValue>> | null = null;

/** 事務所の推定の値を入れる（空なら外す） */
export function setOfficeEstimateValues(v: Readonly<Record<string, EstimateValue>>): void {
  values = Object.keys(v).length === 0 ? null : v;
}

/** 今の事務所の推定の値（無ければ null） */
export const officeEstimateValues = (): Readonly<Record<string, EstimateValue>> | null => values;

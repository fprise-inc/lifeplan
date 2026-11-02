// 事務所の推定の値（0111）のうち、計算の要求に足す分（計算の要求の estimateValues。マスタデータの値ID・エンジンが引く目安の値ID → 事務所の値）と、
// 推定で埋めない、エンジンが引く統計の目安（estimateNoFill。介護・学校の段の費用・平均余命。0111 の2回目）。
// アプリが開いている間だけ持つ（事務所の既定値を読み込んだとき・保存したときに office/estimates.ts が入れる）。
// 計算の要求はエンジンへ渡すとき（moneyRows.ts の forEngine）に、ここの値を足す。画面の速い計算と本体の計算は同じ要求の文字列を使うので、
// 両方で同じ値になる（0005）。世帯ファイルには入れない。ほかの所に頼らないよう、何も読み込まない
import type { EngineNoFill, EstimateValue } from "./types.ts";

let values: Readonly<Record<string, EstimateValue>> | null = null;
let noFill: readonly EngineNoFill[] | null = null;

/** 事務所の推定の値と推定で埋めない目安を入れる（空なら外す） */
export function setOfficeEstimateValues(v: Readonly<Record<string, EstimateValue>>, skip: readonly EngineNoFill[] = []): void {
  values = Object.keys(v).length === 0 ? null : v;
  noFill = skip.length === 0 ? null : [...skip].sort();
}

/** 今の事務所の推定の値（無ければ null） */
export const officeEstimateValues = (): Readonly<Record<string, EstimateValue>> | null => values;

/** 今の推定で埋めない、エンジンが引く統計の目安（無ければ null） */
export const officeEstimateNoFill = (): readonly EngineNoFill[] | null => noFill;

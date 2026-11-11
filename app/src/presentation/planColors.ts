// プランごとの線の色（提示層の部品。planLines.tsx の全部のプランを重ねる表示と、AI接続口のグラフ〔connector/chart.ts。0202〕で同じ色を使う）。
// 画面の部品（preact）を読まない所からも使えるように、色の表だけをここに置く。暗い画面の色は app.css の「グラフの複数のプランの色」と同じ
// （app/test/chart-colors.test.ts で確かめる）
export interface PlanStyle {
  /** 線の色 */
  color: string;
  /** 読み上げ・説明用の色の名前 */
  colorName: string;
}

/**
 * 色の番号ごとの線の色（0: 現状、1〜5: 帯に並べるプラン）。実線だけで6本を見分けられるように選んだ:
 * - 白地とのコントラスト比はすべて 3:1 以上
 * - 色の見分け方の違い（1型・2型・3型）を模した見え方でも、どの2色も近づきすぎない（色差 ΔE2000 でおよそ 10 以上）
 * - 現状は落ち着いた濃い青灰（ほかの5色より彩度を落として、現状だと分かるように）
 */
export const PLAN_COLOR_STYLES: readonly PlanStyle[] = [
  { color: "#4c5563", colorName: "青灰" },
  { color: "#0072c6", colorName: "青" },
  { color: "#d95f02", colorName: "橙" },
  { color: "#009a5b", colorName: "緑" },
  { color: "#c2309a", colorName: "赤紫" },
  { color: "#2f2380", colorName: "藍" },
];

/** 帯に並べるプランの色の数（現状のほか） */
export const PLAN_COLORS = PLAN_COLOR_STYLES.length - 1;

/** 色の番号の見た目（範囲の外は 1〜5 に折り返す） */
export function colorStyle(index: number): PlanStyle {
  if (index <= 0) return PLAN_COLOR_STYLES[0] as PlanStyle;
  return PLAN_COLOR_STYLES[((index - 1) % PLAN_COLORS) + 1] as PlanStyle;
}

/** 暗い画面の線の色（色相は同じまま、暗い地で読める明るさ。app.css の html.dark [stroke="…"] の上書きと同じ） */
export const PLAN_COLOR_DARK: Readonly<Record<string, string>> = {
  "#4c5563": "#a3adbb",
  "#0072c6": "#4aa3ec",
  "#d95f02": "#f08a3e",
  "#009a5b": "#2fc684",
  "#c2309a": "#e46cc0",
  "#2f2380": "#9d92e8",
};

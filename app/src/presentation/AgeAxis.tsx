// 年の目盛りと、その下の年齢の段（提示層の共通の部品）: 主画面のグラフ（MainChart.tsx）と万一のときのグラフ（ContingencyView.tsx）で同じ形にする。
// - 夫婦の世帯は年の下に「本人の年齢」「配偶者の年齢」の2段、単身の世帯は本人の1段（表示の切り替えは無い）
// - 各段の頭（グラフの面の左の余白。縦の目盛りの数字の下）に、だれの年齢かの呼び方を小さく書く
// - いない年（亡くなったあと・まだ生まれていない年）は、その人の段を空ける
// - 目盛りを出す年（狭い幅での間引き）は使う側が決める
import type { AgeAxisRow } from "./model.ts";

/** 年の数字から1段目の年齢までの間（16px のとき。1段だけのときの今までの形と同じ） */
export const AGE_FIRST = 16;
/** 2段目からの年齢の段の間（16px のとき） */
export const AGE_ROW = 14;
/** 年齢の段が増えた分の高さ（16px のとき。1段なら 0）。グラフの下の余白をこの分だけ広げる */
export const ageExtra = (rows: number): number => Math.max(0, rows - 1) * AGE_ROW;

/** 札の見出し（例: 「2045年 ご主人64歳・奥様62歳・長女35歳」。年のあとは全角の空白。家族の文字が無ければ年だけ） */
export const yearHead = (year: number, family: string | undefined): string => (family !== undefined && family !== "" ? `${year}年\u3000${family}` : `${year}年`);

/**
 * 年の目盛りと年齢の段（SVG）。yearY: 年の数字の y、left: グラフの面の左の端（段の頭の呼び方はその左に右寄せで書く）、
 * show: 目盛りを出す年か、x: 年の番号の x
 */
export function AgeAxisSvg({ years, axis, x, show, yearY, left, fs }: { years: readonly number[]; axis: readonly AgeAxisRow[]; x: (i: number) => number; show: (year: number, i: number) => boolean; yearY: number; left: number; fs: number }) {
  const rowY = (r: number) => yearY + (AGE_FIRST + r * AGE_ROW) * fs;
  return (
    <g class="age-axis" data-age-rows={axis.length}>
      {years.map((y, i) =>
        show(y, i) ? (
          <g key={y}>
            <text x={x(i)} y={yearY} class="axis-label" text-anchor="middle">
              {y}
            </text>
            {axis.map((row, r) => {
              const a = row.ages[i];
              return a != null ? (
                <text key={r} x={x(i)} y={rowY(r)} class="axis-label sub" text-anchor="middle" data-age-row={r}>
                  {a}歳
                </text>
              ) : null;
            })}
          </g>
        ) : null,
      )}
      {axis.map((row, r) => (
        <text key={`who${r}`} x={left - 14 * fs} y={rowY(r)} class="axis-who" text-anchor="end" data-age-who={r}>
          {row.label}
        </text>
      ))}
    </g>
  );
}

// グラフで年を選ぶ決まり（描くのは MainChart.tsx）: カーソルを合わせた年に線の上の○と小さな表示を出し、クリックで固定する。
// 固定中はカーソルを動かしても動かない。同じ年をもう一度クリックするか Esc で外し、別の年をクリックすると移る。
// ← → は固定した年を1年ずつ動かす（固定していなければ、合わせている年か既定の年から固定する）
import type { Frame } from "./chart.ts";

/** クリックしたときの固定の年: 同じ年なら外す（null）、違う年なら移る */
export function togglePin(pinned: number | null, year: number): number | null {
  return pinned === year ? null : year;
}

/** ○と表示を出す年: 固定していればその年、なければカーソルを合わせた年 */
export function shownYear(pinned: number | null, hover: number | null): number | null {
  return pinned ?? hover;
}

/** ← →（dir = 1 か −1）で動かした先の年。端より先は undefined */
export function stepYear(years: readonly number[], pinned: number | null, hover: number | null, fallback: number, dir: 1 | -1): number | undefined {
  const from = pinned ?? hover;
  if (from === null) return years.includes(fallback) ? fallback : years[0];
  const i = years.indexOf(from);
  if (i < 0) return years[0];
  return years[i + dir];
}

/** グラフの x（SVG の座標）から、その年の位置（何番目か）。描く範囲の外は null */
export function indexAt(x: number, frame: Frame, n: number): number | null {
  if (n <= 0) return null;
  const plotW = frame.width - frame.left - frame.right;
  if (x < frame.left || x > frame.left + plotW) return null;
  const band = plotW / n;
  return Math.max(0, Math.min(n - 1, Math.floor((x - frame.left) / band)));
}

/** 表示の幅の見積もり（文字の数から。実際の幅が測れたらそちらを使う）: 半角は約0.6字、全角は1字 */
export function estimateWidth(lines: readonly string[], fontPx: number): number {
  let w = 0;
  for (const s of lines) {
    let u = 0;
    for (const ch of s) u += /[\x20-\x7e]/.test(ch) ? 0.6 : 1;
    w = Math.max(w, u);
  }
  return Math.ceil(w * fontPx) + 20;
}

export interface TipBox {
  left: number;
  top: number;
  /** ○の右に出すか（右の端に近いと左に出す） */
  side: "right" | "left";
}

/**
 * 表示の置き場所: ○の右上（右の端に近ければ左上）。グラフの枠からはみ出さない（見切れない）。
 * x: ○の x、yTop: ○のうち上のものの y、yBottom: 下のものの y、w・h: 表示の幅と高さ、width・height: グラフの枠
 */
export function placeTip(x: number, yTop: number, yBottom: number, w: number, h: number, width: number, height: number, gap = 12): TipBox {
  const pad = 4;
  let side: TipBox["side"] = "right";
  let left = x + gap;
  if (left + w > width - pad) {
    side = "left";
    left = x - gap - w;
  }
  left = Math.max(pad, Math.min(width - pad - w, left));
  let top = yTop - gap - h;
  if (top < pad) top = yBottom + gap;
  top = Math.max(pad, Math.min(height - pad - h, top));
  return { left, top, side };
}

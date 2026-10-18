// グラフの座標の計算（描くのは MainChart.tsx・ContingencyView.tsx）。グラフのライブラリは使わず SVG で描く（0016 の追記）
import type { Yen } from "./model.ts";

export interface Frame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const FRAME: Frame = { width: 760, height: 300, left: 70, right: 16, top: 26, bottom: 50 };

/** 目盛りの間隔（1・2・5 の10のべき）。万円の単位で */
export function niceStep(range: number, count = 5): number {
  if (!(range > 0)) return 1;
  const raw = range / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

export interface Scale {
  /** 万円の目盛り */
  ticks: number[];
  min: number;
  max: number;
  x: (i: number) => number;
  y: (yen: Yen) => number;
  band: number;
}

/** 系列（円）から、0 を必ず含む縦の目盛りと、年の位置を決める */
export function scale(series: Yen[][], n: number, frame: Frame = FRAME): Scale {
  let lo = 0;
  let hi = 0;
  for (const s of series) for (const v of s) {
    const m = v / 10000;
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  if (hi === lo) hi = lo + 100;
  const step = niceStep(hi - lo);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.round(t));
  const plotW = frame.width - frame.left - frame.right;
  const plotH = frame.height - frame.top - frame.bottom;
  const band = n > 0 ? plotW / n : plotW;
  return {
    ticks,
    min,
    max,
    band,
    x: (i) => frame.left + band * (i + 0.5),
    y: (v) => frame.top + plotH * (1 - (v / 10000 - min) / (max - min)),
  };
}

/** 折れ線の点の列 */
export function linePath(values: Yen[], s: Scale): string {
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${s.x(i).toFixed(1)} ${s.y(v).toFixed(1)}`).join(" ");
}

/** 0 より上の面（提案の面） */
export function areaAbove(values: Yen[], s: Scale): string {
  if (values.length === 0) return "";
  const pts = values.map((v, i) => `${s.x(i).toFixed(1)} ${s.y(Math.max(v, 0)).toFixed(1)}`);
  return `M${s.x(0).toFixed(1)} ${s.y(0).toFixed(1)} L${pts.join(" L")} L${s.x(values.length - 1).toFixed(1)} ${s.y(0).toFixed(1)} Z`;
}

/** 0 より下の面（不足。赤の斜線で塗る）。0 を横切るところは直線で補う */
export function areaBelow(values: Yen[], s: Scale): string {
  const parts: string[] = [];
  let run: string[] = [];
  const close = () => {
    if (run.length > 0) parts.push(`M${run.join(" L")} Z`);
    run = [];
  };
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    const prev = i > 0 ? (values[i - 1] as number) : null;
    if (v < 0) {
      if (run.length === 0) {
        // 0 を横切る点から始める
        const x0 = prev !== null && prev >= 0 ? s.x(i - 1) + (s.x(i) - s.x(i - 1)) * (prev / (prev - v)) : s.x(i);
        run.push(`${x0.toFixed(1)} ${s.y(0).toFixed(1)}`);
      }
      run.push(`${s.x(i).toFixed(1)} ${s.y(v).toFixed(1)}`);
      const next = i + 1 < values.length ? (values[i + 1] as number) : null;
      if (next === null || next >= 0) {
        const x1 = next !== null ? s.x(i) + (s.x(i + 1) - s.x(i)) * (v / (v - next)) : s.x(i);
        run.push(`${x1.toFixed(1)} ${s.y(0).toFixed(1)}`);
        close();
      }
    }
  }
  close();
  return parts.join(" ");
}

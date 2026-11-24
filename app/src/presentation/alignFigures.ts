// 横に並べたバランスシートの図（時点を並べる・プランを比較・前回と比較・カスタマイズの見るもの）の上端をそろえる（提示層）。
// 図の上の物（時点の見出しが折り返す・「2026年末の見込み（入力した値から）」の帯がある・名前の下の説明が2行になる など）の高さが
// 図ごとに違っても、同じ行に並ぶ図の 0 の線（data-bs-baseline）を、いちばん下がっている図にそろえる（図の上に余白を足す）。
// 時点を並べる・プランを比較は図の高さと縮尺が同じなので、0 の線がそろえば目盛り（10,000・20,000）の高さもそろう。
// 合算BS の3枚のように柱の幅が違う図（右の合算の1枚だけ広い）は、図の縮み方が違うので、0 の線をそろえる
// 狭い画面で1列に並ぶときは、行が別になるのでそろえない（余白を足さない）
import { useEffect, useLayoutEffect, useRef, type MutableRef } from "preact/hooks";

/** 図の 0 の線の高さ（その図の上に足す前の位置）から、図ごとに足す余白（px）を決める。rows は同じ行の図の番号の組 */
export function alignOffsets(tops: readonly number[], rows: readonly (readonly number[])[]): number[] {
  const out = tops.map(() => 0);
  for (const r of rows) {
    const max = Math.max(...r.map((i) => tops[i] as number));
    for (const i of r) out[i] = Math.round((max - (tops[i] as number)) * 100) / 100;
  }
  return out;
}

/**
 * 同じ行の図を分ける: 上下の範囲が重なる図を同じ行とみなす（上から順に、前の行のどれかと重なれば同じ行）
 */
export function rowsOf(boxes: readonly { top: number; bottom: number }[]): number[][] {
  const order = boxes.map((b, i) => ({ ...b, i })).sort((a, b) => a.top - b.top);
  const rows: { bottom: number; items: number[] }[] = [];
  for (const b of order) {
    const last = rows.at(-1);
    if (last !== undefined && b.top < last.bottom) {
      last.items.push(b.i);
      last.bottom = Math.max(last.bottom, b.bottom);
    } else rows.push({ bottom: b.bottom, items: [b.i] });
  }
  return rows.map((r) => r.items);
}

/** 枠の中の図（.bsf）の 0 の線の高さをそろえる（足した余白をいったん外して測り直す。0 の線が無ければ図の上端） */
export function alignFigureTops(root: HTMLElement): void {
  const figs = [...root.querySelectorAll<HTMLElement>(".bsf")];
  for (const f of figs) f.style.marginTop = "";
  if (figs.length < 2) return;
  const rects = figs.map((f) => f.getBoundingClientRect());
  const base = figs.map((f, i) => f.querySelector("[data-bs-baseline]")?.getBoundingClientRect().top ?? (rects[i] as DOMRect).top);
  const off = alignOffsets(
    base,
    rowsOf(rects.map((r) => ({ top: r.top, bottom: r.bottom }))),
  );
  figs.forEach((f, i) => {
    if ((off[i] as number) > 0.5) f.style.marginTop = `${off[i]}px`;
  });
}

/** 描くたび・枠の幅や文字の大きさが変わったとき・字の形を読み終えたときに、図の 0 の線の高さをそろえ直す（枠が後から出ても見張る） */
export function useAlignFigures(ref: MutableRef<HTMLElement | null>): void {
  const watch = useRef<{ el: HTMLElement; ro: ResizeObserver | null } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    alignFigureTops(el);
    if (watch.current?.el === el) return;
    watch.current?.ro?.disconnect();
    // 図の上の物（見出し・帯）の折り返しが変わると枠の高さが変わるので、枠の大きさの変化を見る
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => requestAnimationFrame(() => ref.current !== null && alignFigureTops(ref.current))) : null;
    ro?.observe(el);
    watch.current = { el, ro };
    void (typeof document !== "undefined" ? document.fonts : undefined)?.ready.then(() => ref.current !== null && alignFigureTops(ref.current));
  });
  useEffect(() => () => watch.current?.ro?.disconnect(), []);
}

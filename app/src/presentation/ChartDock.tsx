// 操作中はグラフを上に表示（提示層の共通の部品。見通しと万一のときで同じ部品・同じ動き）:
// 操作の欄（見通しの「対策」・万一のときの「想定の前提」）までスクロールして、元のグラフが画面の上に隠れたら、
// グラフを縮めた形で画面の上部に付いてこさせる（線・塗り・凡例・補間の動きは元のグラフと同じ部品で描く）。上に戻ると消える。
// - 置き方: 縦の並び（.main-stack）の先頭に高さ0の sticky の箱を置き、その中に描く。元の並びの高さは変わらない（ずれない）。
//   ヘッダー（上の帯）は固定しないので、付いてくるのは画面の一番上
// - 窓の高さが低くて操作の欄を隠しすぎるとき（付いてくる部分が窓の高さの45%を超えるとき）は出さない
// - 小さなボタン（×）で外せる（表示の設定の「操作中はグラフを上に表示」が切り替わる。既定はオン）
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";
import { chartHeight } from "./MainChart.tsx";

/** 付いてくる部分（グラフの上下の帯・凡例など。グラフの外の分）が窓の高さに占めてよい割合 */
export const DOCK_MAX_SHARE = 0.45;
/** 縮めたグラフの高さの、元のグラフに対する割合 */
export const DOCK_RATIO = 0.43;

/**
 * 縮めたグラフの高さ（px）。元のグラフの約43%。ただし付いてくる部分全体（extra はグラフの外の分の高さ）が窓の高さの45%に収まるよう、さらに縮める。
 * それでも最小（140px × 文字の大きさ）に足りない低い窓では出さない（null）
 */
export function dockChartHeight(innerHeight: number, fontPx: number, extra: number): number | null {
  const fs = fontPx / 16;
  const want = Math.round(chartHeight(innerHeight, fontPx) * DOCK_RATIO);
  const budget = Math.floor(innerHeight * DOCK_MAX_SHARE - extra);
  const h = Math.min(want, budget);
  return h < 140 * fs ? null : h;
}

/** 付いてくるか（スクロールの位置から）。hysteresis で境目のちらつきを抑える */
export function shouldDock(p: { anchorBottom: number; controlsTop: number; controlsBottom: number; innerHeight: number; dockTotal: number; docked: boolean }): boolean {
  const k = p.docked ? 1.1 : 0.9;
  const hidden = p.anchorBottom < p.dockTotal * k;
  const controlsInView = p.controlsTop < p.innerHeight - 40 && p.controlsBottom > p.dockTotal + 40;
  return hidden && controlsInView;
}

/**
 * スクロールに合わせて付いてくるかを決める。anchor: 元のグラフ（の枠）、controls: 操作の欄、extra: 付いてくる部分のうちグラフの外の高さ（文字の大きさ 16px のとき）
 */
export function useChartDock(anchor: RefObject<HTMLElement>, controls: RefObject<HTMLElement>, enabled: boolean, extra: number): { docked: boolean; height: number } {
  const [state, setState] = useState<{ docked: boolean; height: number }>({ docked: false, height: 0 });
  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setState((s) => (s.docked ? { docked: false, height: 0 } : s));
      return;
    }
    let raf = 0;
    const check = () => {
      raf = 0;
      const a = anchor.current;
      const c = controls.current;
      const px = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const ex = extra * (px / 16);
      const h = dockChartHeight(window.innerHeight, px, ex);
      if (a === null || c === null || h === null) {
        setState((s) => (s.docked ? { docked: false, height: 0 } : s));
        return;
      }
      const ar = a.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      setState((s) => {
        const docked = shouldDock({ anchorBottom: ar.bottom, controlsTop: cr.top, controlsBottom: cr.bottom, innerHeight: window.innerHeight, dockTotal: h + ex, docked: s.docked });
        return s.docked === docked && s.height === h ? s : { docked, height: h };
      });
    };
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onScroll) : null;
    ro?.observe(document.documentElement);
    if (controls.current !== null) ro?.observe(controls.current);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      ro?.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [enabled, anchor, controls, extra]);
  return state;
}

/** 付いてくるグラフの箱（.main-stack の先頭に置く。docked でなければ中身を描かない） */
export function ChartDock({ docked, head, onClose, children }: { docked: boolean; head?: ComponentChildren; onClose: () => void; children?: ComponentChildren }) {
  return (
    <div class={`chart-dock${docked ? " on" : ""}`} data-chart-dock={docked ? "on" : "off"}>
      {docked ? (
        <section class="dock-in card" aria-label="操作中のグラフ（縮めた表示）">
          <div class="dock-head">
            <div class="dock-t">{head}</div>
            <button type="button" class="dock-x" onClick={onClose} aria-label="グラフを上に表示しない（表示の設定で戻せます）" title="グラフを上に表示しない（表示の設定で戻せます）" data-dock-close>
              ×
            </button>
          </div>
          {children}
        </section>
      ) : null}
    </div>
  );
}

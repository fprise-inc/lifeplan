// 操作中はグラフを上に表示（提示層の共通の部品。見通しと万一のときで同じ部品・同じ動き）:
// 操作の欄（見通しの「対策」・万一のときの「想定の前提」）までスクロールして、元のグラフが画面の上に隠れたら、
// グラフを画面の上部に付いてこさせる（線・塗り・凡例・補間の動きは元のグラフと同じ部品で描く）。上に戻ると消える。
// - 置き方: 縦の並び（.main-stack）の先頭に高さ0の sticky の箱を置き、その中に描く。元の並びの高さは変わらない（ずれない）。
//   ヘッダー（上の帯）は固定しないので、付いてくるのは画面の一番上
// - 大きさは表示の設定で選ぶ（出さない／小さく／大きく）:
//   - 小さく: 元のグラフの約43%。付いてくる部分が窓の高さの45%を超える低い窓では出さない
//   - 大きく（既定）: 窓の高さから、操作の欄の1行分（実際の要素の高さ。文字の大きさで変わる）と余白を引いた高さ。
//     元のグラフの高さを上限、小さくの最小の高さを下限にする（下限に届かない低い窓では小さくの形にする）。
//     隠れた行のつまみを触る・キーボードで動かすと、その行が付いてくるグラフの下に見えるところまで少しスクロールする
// - 小さなボタン（×）で外せる（表示の設定の「操作中はグラフを上に表示」が「出さない」になる）
// - 「浮かせる」で、アプリの窓の中に浮いた小さな枠にできる（どこまでスクロールしても出ている）。上の帯（取っ手の印つき）をドラッグで移動、
//   左右の端で横・下の端で縦・下の角で縦横に大きさを変える。帯にフォーカスして矢印キーで移動、Shift＋矢印で大きさ。初めて浮かせたときだけ短い案内を出す。
//   「戻す」で付いてくる形に戻る。位置と大きさはアプリを開いている間覚える（画面には保存しない。世帯のファイルにも書かない）。別の窓（OS の窓）にはしない
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { chartHeight } from "./MainChart.tsx";

/** 操作中はグラフを上に表示の大きさ: 出さない／小さく（元のグラフの約43%）／大きく（操作の欄は1行分を残す） */
export type DockMode = "off" | "small" | "large";

/** 付いてくる部分（グラフの上下の帯・凡例など。グラフの外の分）が窓の高さに占めてよい割合（小さく） */
export const DOCK_MAX_SHARE = 0.45;
/** 縮めたグラフの高さの、元のグラフに対する割合（小さく） */
export const DOCK_RATIO = 0.43;
/** 付いてくるグラフの最小の高さ（文字の大きさ 16px のとき） */
export const DOCK_MIN = 140;
/** 大きく: 付いてくるグラフの下に残す、操作の欄の1行分の上下の余白（文字の大きさ 16px のとき） */
export const DOCK_ROW_MARGIN = 24;

/**
 * 小さく: 縮めたグラフの高さ（px）。元のグラフの約43%。ただし付いてくる部分全体（extra はグラフの外の分の高さ）が窓の高さの45%に収まるよう、さらに縮める。
 * それでも最小（140px × 文字の大きさ）に足りない低い窓では出さない（null）
 */
export function dockChartHeight(innerHeight: number, fontPx: number, extra: number): number | null {
  const fs = fontPx / 16;
  const want = Math.round(chartHeight(innerHeight, fontPx) * DOCK_RATIO);
  const budget = Math.floor(innerHeight * DOCK_MAX_SHARE - extra);
  const h = Math.min(want, budget);
  return h < DOCK_MIN * fs ? null : h;
}

/**
 * 大きく: 付いてくるグラフの高さ（px）。付いてくる部分全体 ＝ 窓の高さ −（操作の欄の1行分 row ＋ 余白）。
 * 元のグラフの高さを上限にする。最小（140px × 文字の大きさ）に届かない低い窓では、小さくの形（dockChartHeight）にする
 */
export function dockChartHeightLarge(innerHeight: number, fontPx: number, extra: number, row: number): number | null {
  const fs = fontPx / 16;
  const want = Math.floor(innerHeight - row - DOCK_ROW_MARGIN * fs - extra);
  if (want < DOCK_MIN * fs) return dockChartHeight(innerHeight, fontPx, extra);
  return Math.min(want, chartHeight(innerHeight, fontPx));
}

/** 付いてくるか（スクロールの位置から）。hysteresis で境目のちらつきを抑える */
export function shouldDock(p: { anchorBottom: number; controlsTop: number; controlsBottom: number; innerHeight: number; dockTotal: number; docked: boolean }): boolean {
  const k = p.docked ? 1.1 : 0.9;
  const hidden = p.anchorBottom < p.dockTotal * k;
  const controlsInView = p.controlsTop < p.innerHeight - 40 && p.controlsBottom > p.dockTotal + 40;
  return hidden && controlsInView;
}

/**
 * 大きく: 操作している行を見せるために縦にスクロールする量（px。負は上へ戻す）。
 * 付いてくるグラフ（下端 dockBottom）の下に隠れていれば、その行の上端がグラフのすぐ下に来るまで。窓の下にはみ出していれば、上が隠れない範囲で上げる。
 * 見えていれば動かさない（0）
 */
export function revealDelta(p: { rowTop: number; rowBottom: number; dockBottom: number; innerHeight: number; gap: number }): number {
  const top = p.dockBottom + p.gap;
  if (p.rowTop < top) return Math.round(p.rowTop - top);
  const over = p.rowBottom - (p.innerHeight - p.gap);
  if (over > 0) return Math.round(Math.min(over, p.rowTop - top));
  return 0;
}

/** 操作の欄の1行分の高さ（px）: 最初のつまみの並び（.lv-grid）の、1行目の欄（.lever）の高さ。見つからなければ null */
export function measureRow(controls: HTMLElement): number | null {
  const grid = controls.querySelector(".lv-grid");
  if (grid === null) return null;
  let top: number | null = null;
  let bottom = 0;
  for (const el of Array.from(grid.children)) {
    if (!el.classList.contains("lever")) continue;
    const r = el.getBoundingClientRect();
    if (r.height === 0) continue;
    if (top === null) top = r.top;
    else if (r.top > top + 2) break;
    bottom = Math.max(bottom, r.bottom);
  }
  return top === null ? null : bottom - top;
}

// ---- 浮かせた枠の位置と大きさ（アプリを開いている間、画面の中で覚える。画面には保存しない・世帯のファイルにも書かない） ----

export interface FloatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface FloatState {
  on: boolean;
  rect: FloatRect | null;
}
let floatState: FloatState = { on: false, rect: null };
const floatSubs = new Set<(s: FloatState) => void>();

const currentFloat = (): FloatState => floatState;

/** 浮かせる・戻す・位置と大きさを変える（見通しと万一のときで同じ枠） */
export function setFloat(next: FloatState): void {
  floatState = next;
  for (const f of floatSubs) f(next);
}

/** 浮かせているか（変わったら描き直す） */
function useFloatOn(): boolean {
  const [on, setOn] = useState(() => currentFloat().on);
  useEffect(() => {
    const f = (s: FloatState) => setOn(s.on);
    floatSubs.add(f);
    setOn(currentFloat().on);
    return () => {
      floatSubs.delete(f);
    };
  }, []);
  return on;
}

/** 浮かせた枠の最小の大きさ（文字の大きさ 16px のとき） */
export const FLOAT_MIN = { w: 380, h: 240 };

/** 初めて浮かせるときの位置と大きさ: 窓の右上。幅は窓の45%（420〜820px）、高さは窓の55%（520px まで） */
export function defaultFloatRect(vw: number, vh: number): FloatRect {
  const w = Math.round(Math.min(820, Math.max(420, vw * 0.45)));
  const h = Math.round(Math.min(520, vh * 0.55));
  return { x: Math.max(8, vw - w - 20), y: 12, w, h };
}

/** 浮かせた枠を窓の中に収める（大きさは最小と窓の大きさの間。枠が窓の外に出ないよう、位置も寄せる） */
export function clampFloatRect(r: FloatRect, vw: number, vh: number, fs = 1): FloatRect {
  const w = Math.round(Math.max(Math.min(FLOAT_MIN.w * fs, vw - 16), Math.min(r.w, vw - 16)));
  const h = Math.round(Math.max(Math.min(FLOAT_MIN.h * fs, vh - 16), Math.min(r.h, vh - 16)));
  const x = Math.round(Math.max(0, Math.min(r.x, vw - w)));
  const y = Math.round(Math.max(0, Math.min(r.y, vh - h)));
  return { x, y, w, h };
}

/** 浮かせた枠の、大きさを変える端: 左右の端（横）・下の端（縦）・下の二つの角（両方）。上の端は移動の帯なので伸縮しない */
export type FloatEdge = "w" | "e" | "s" | "sw" | "se";

/**
 * 端をつかんで大きさを変えたあとの位置と大きさ（r0 はつかんだときの枠、dx・dy は動かした量）。
 * つかんだ端だけが動き、反対側の端は動かない（左の端なら右の端を固定）。最小の大きさと窓の内側（端から出ない・幅は窓 − 16px まで）を守る
 */
export function resizeFloatRect(r0: FloatRect, edge: FloatEdge, dx: number, dy: number, vw: number, vh: number, fs = 1): FloatRect {
  const minW = Math.min(FLOAT_MIN.w * fs, vw - 16);
  const minH = Math.min(FLOAT_MIN.h * fs, vh - 16);
  const maxW = vw - 16;
  const maxH = vh - 16;
  const y = r0.y;
  let { x, w, h } = r0;
  if (edge === "e" || edge === "se") {
    const right = Math.max(x + minW, Math.min(r0.x + r0.w + dx, vw, x + maxW));
    w = right - x;
  }
  if (edge === "w" || edge === "sw") {
    const right = r0.x + r0.w;
    const left = Math.max(0, right - maxW, Math.min(r0.x + dx, right - minW));
    x = left;
    w = right - left;
  }
  if (edge === "s" || edge === "sw" || edge === "se") {
    const bottom = Math.max(y + minH, Math.min(r0.y + r0.h + dy, vh, y + maxH));
    h = bottom - y;
  }
  return clampFloatRect({ x, y, w, h }, vw, vh, fs);
}

/** キーボードで動かす・大きさを変える1回の量（px。文字の大きさ 16px のとき） */
export const FLOAT_KEY_STEP = 16;

/**
 * 移動の帯にフォーカスしてキーを押したときの位置と大きさ: 矢印キーで移動、Shift＋矢印で大きさ（右・下で大きく、左・上で小さく）。
 * 扱わないキーは null
 */
export function keyFloatRect(r: FloatRect, key: string, shift: boolean, vw: number, vh: number, fs = 1): FloatRect | null {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (d === undefined) return null;
  const step = Math.round(FLOAT_KEY_STEP * fs);
  const [kx, ky] = d as [number, number];
  if (shift) return resizeFloatRect(r, kx !== 0 ? "e" : "s", kx * step, ky * step, vw, vh, fs);
  return clampFloatRect({ ...r, x: r.x + kx * step, y: r.y + ky * step }, vw, vh, fs);
}

/** 浮かせた枠の中のグラフの高さ（px）: 枠の高さから、グラフの外の分（extra）を引く。最小 100px × 文字の大きさ */
export function floatChartHeight(panelHeight: number, fontPx: number, extra: number): number {
  return Math.max(Math.round(100 * (fontPx / 16)), Math.floor(panelHeight - extra));
}

const rootFontPx = () => (typeof window === "undefined" ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);

// ---- 付いてくる条件 ----

export interface DockState {
  /** 付いてきているか（浮かせているときは false） */
  docked: boolean;
  /** 付いてくるグラフの高さ（px） */
  height: number;
  mode: DockMode;
  /** 浮かせているか（表示の設定で出さないにしているときは false） */
  floating: boolean;
  /** 付いてくる部分のうちグラフの外の高さ（文字の大きさ 16px のとき） */
  extra: number;
}

/**
 * スクロールに合わせて付いてくるかを決める。anchor: 元のグラフ（の枠）、controls: 操作の欄、extra: 付いてくる部分のうちグラフの外の高さ（文字の大きさ 16px のとき）
 */
export function useChartDock(anchor: RefObject<HTMLElement>, controls: RefObject<HTMLElement>, mode: DockMode, extra: number): DockState {
  const floatOn = useFloatOn();
  const floating = floatOn && mode !== "off";
  const [state, setState] = useState<{ docked: boolean; height: number }>({ docked: false, height: 0 });
  const live = useRef({ docked: false, total: 0 });
  useEffect(() => {
    live.current = { docked: false, total: 0 };
    if (mode === "off" || floating || typeof window === "undefined") {
      setState((s) => (s.docked ? { docked: false, height: 0 } : s));
      return;
    }
    let raf = 0;
    const check = () => {
      raf = 0;
      const a = anchor.current;
      const c = controls.current;
      const px = rootFontPx();
      const ex = extra * (px / 16);
      const row = mode === "large" && c !== null ? (measureRow(c) ?? 120 * (px / 16)) : 0;
      const h = mode === "large" ? dockChartHeightLarge(window.innerHeight, px, ex, row) : dockChartHeight(window.innerHeight, px, ex);
      if (a === null || c === null || h === null) {
        live.current = { docked: false, total: 0 };
        setState((s) => (s.docked ? { docked: false, height: 0 } : s));
        return;
      }
      const ar = a.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      const docked = shouldDock({ anchorBottom: ar.bottom, controlsTop: cr.top, controlsBottom: cr.bottom, innerHeight: window.innerHeight, dockTotal: h + ex, docked: live.current.docked });
      live.current = { docked, total: h + ex };
      setState((s) => (s.docked === docked && s.height === h ? s : { docked, height: h }));
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
  }, [mode, floating, anchor, controls, extra]);

  // 大きく: 付いてくるグラフの下に隠れた行のつまみを触った・キーボードで動かしたら、その行が見えるところまで少しスクロールする
  useEffect(() => {
    const c = controls.current;
    if (mode !== "large" || floating || c === null || typeof window === "undefined") return;
    const reveal = (e: Event) => {
      if (!live.current.docked) return;
      if (e instanceof KeyboardEvent && !/^(Arrow|Page|Home|End|Tab)/.test(e.key)) return;
      const t = e.target instanceof Element ? e.target : null;
      const row = t?.closest(".lever");
      if (row == null || !c.contains(row)) return;
      const dock = document.querySelector('[data-chart-dock="on"] .dock-in');
      const dockBottom = dock?.getBoundingClientRect().bottom ?? live.current.total;
      const r = row.getBoundingClientRect();
      const d = revealDelta({ rowTop: r.top, rowBottom: r.bottom, dockBottom, innerHeight: window.innerHeight, gap: 8 * (rootFontPx() / 16) });
      if (d !== 0) window.scrollBy({ top: d, behavior: "auto" });
    };
    c.addEventListener("focusin", reveal);
    c.addEventListener("pointerdown", reveal);
    c.addEventListener("keydown", reveal);
    return () => {
      c.removeEventListener("focusin", reveal);
      c.removeEventListener("pointerdown", reveal);
      c.removeEventListener("keydown", reveal);
    };
  }, [mode, floating, controls]);

  return { docked: state.docked && !floating, height: state.height, mode, floating, extra };
}

// ---- 部品 ----

/** 付いてくるグラフの箱（.main-stack の先頭に置く。付いてきていなければ中身を描かない。浮かせているときは浮いた枠を描く） */
export function ChartDock({ dock, head, onClose, children }: { dock: DockState; head?: ComponentChildren; onClose: () => void; children: (height: number) => ComponentChildren }) {
  if (dock.floating)
    return (
      <div class="chart-dock" data-chart-dock="float">
        <FloatPanel head={head} onClose={onClose} extra={dock.extra}>
          {children}
        </FloatPanel>
      </div>
    );
  const on = dock.docked;
  return (
    <div class={`chart-dock${on ? " on" : ""}${dock.mode === "large" ? " large" : ""}`} data-chart-dock={on ? "on" : "off"}>
      {on ? (
        <section class="dock-in card" aria-label="操作中のグラフ（上に付いてくる表示）">
          <div class="dock-head">
            <div class="dock-t">{head}</div>
            <button type="button" class="dock-btn" onClick={() => setFloat({ on: true, rect: currentFloat().rect })} title="グラフを動かせる小さな枠にして、どこまでスクロールしても出しておく" data-dock-float>
              浮かせる
            </button>
            <button type="button" class="dock-x" onClick={onClose} aria-label="グラフを上に表示しない（表示の設定で戻せます）" title="グラフを上に表示しない（表示の設定で戻せます）" data-dock-close>
              ×
            </button>
          </div>
          {children(dock.height)}
        </section>
      ) : null}
    </div>
  );
}

const EDGE_LABEL: Record<FloatEdge, string> = { w: "左の端（横に伸縮）", e: "右の端（横に伸縮）", s: "下の端（縦に伸縮）", sw: "左下の角（縦横に伸縮）", se: "右下の角（縦横に伸縮）" };

/**
 * 浮かせた枠: アプリの窓の中に固定して置く。上の帯（取っ手の印つき）をドラッグで移動、左右の端で横・下の端で縦・下の角で縦横に大きさを変える。
 * 帯にフォーカスして矢印キーで移動、Shift＋矢印で大きさを変えられる
 */
function FloatPanel({ head, onClose, extra, children }: { head?: ComponentChildren; onClose: () => void; extra: number; children: (height: number) => ComponentChildren }) {
  const fs = rootFontPx() / 16;
  const [rect, setRect] = useState<FloatRect>(() => clampFloatRect(currentFloat().rect ?? defaultFloatRect(window.innerWidth, window.innerHeight), window.innerWidth, window.innerHeight, fs));
  const [active, setActive] = useState<"move" | FloatEdge | null>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  useEffect(() => {
    const onResize = () => setRect((r) => clampFloatRect(r, window.innerWidth, window.innerHeight, rootFontPx() / 16));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const drag = (kind: "move" | FloatEdge) => (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (kind === "move" && e.target instanceof Element && e.target.closest("button, a, input, select") !== null) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setActive(kind);
    const sx = e.clientX;
    const sy = e.clientY;
    const r0 = rectRef.current;
    let last = r0;
    const k = rootFontPx() / 16;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      last = kind === "move" ? clampFloatRect({ ...r0, x: r0.x + dx, y: r0.y + dy }, window.innerWidth, window.innerHeight, k) : resizeFloatRect(r0, kind, dx, dy, window.innerWidth, window.innerHeight, k);
      setRect(last);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setActive(null);
      setFloat({ on: true, rect: last });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const next = keyFloatRect(rectRef.current, e.key, e.shiftKey, window.innerWidth, window.innerHeight, rootFontPx() / 16);
    if (next === null) return;
    e.preventDefault();
    setRect(next);
    setFloat({ on: true, rect: next });
  };
  return (
    <section
      class={`dock-float card${active === "move" ? " is-moving" : ""}${active !== null && active !== "move" ? " is-sizing" : ""}`}
      style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` }}
      aria-label="浮かせたグラフ（上の帯をドラッグで移動、端をドラッグで大きさを変えられます）"
      data-dock-float-panel
    >
      <div
        class="dock-head dock-grip"
        onPointerDown={drag("move")}
        onKeyDown={onKey}
        tabIndex={0}
        aria-label="グラフの枠を動かす帯（ドラッグで移動。矢印キーで移動、Shift＋矢印キーで大きさを変える）"
        data-dock-grip
      >
        <span class="dock-handle" aria-hidden="true">
          <span class="dock-handle-i">⠿</span>
          <span class="dock-handle-t">移動</span>
        </span>
        <div class="dock-t">{head}</div>
        <button type="button" class="dock-btn" onClick={() => setFloat({ on: false, rect: rectRef.current })} title="浮かせるのをやめて、上に付いてくる形に戻す" data-dock-unfloat>
          戻す
        </button>
        <button
          type="button"
          class="dock-x"
          onClick={() => {
            setFloat({ on: false, rect: rectRef.current });
            onClose();
          }}
          aria-label="グラフを上に表示しない（表示の設定で戻せます）"
          title="グラフを上に表示しない（表示の設定で戻せます）"
          data-dock-close
        >
          ×
        </button>
      </div>
      {children(floatChartHeight(rect.h, fs * 16, extra * fs))}
      {(["w", "e", "s", "sw", "se"] as const).map((edge) => (
        <span key={edge} class={`dock-edge dock-edge-${edge}${active === edge ? " on" : ""}`} onPointerDown={drag(edge)} title={`ドラッグで大きさを変えられます（${EDGE_LABEL[edge]}）`} aria-hidden="true" data-dock-edge={edge} />
      ))}
    </section>
  );
}

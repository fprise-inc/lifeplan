// グラフを小窓で表示（提示層の共通の部品。結果と万一のときで同じ部品・同じ動き）:
// グラフの見出しの右上の「小窓」ボタンで、グラフをアプリの窓の中に浮いた小さな枠（小窓）に出す。どこまでスクロールしても出ているので、
// 操作の欄（結果の「対策」・万一のときの「想定の前提」）を動かしながらグラフを見られる（線・塗り・凡例・補間の動きは元のグラフと同じ部品で描く）。
// - ボタンはアイコンだけ（文字は出さない。説明はカーソルを乗せたときの小さな札と読み上げ）。開くときは小窓が開く共通の印（icons.tsx の PopIcon）。
//   小窓を出している間は、元のグラフの見出しのボタンが「小窓を閉じる」（元に戻す印。PipBackIcon）に変わる。小窓の上の帯の「元に戻す」でも閉じる
// - 上の帯（取っ手の印つき）をドラッグで移動、左右の端で横・下の端で縦・下の角で縦横に大きさを変える。帯にフォーカスして矢印キーで移動、
//   Shift＋矢印で大きさ
// - 位置と大きさはアプリを開いている間覚える（画面には保存しない。世帯のファイルにも書かない）。別の窓（OS の窓）にはしない
// - 小窓はタブごとのもの: 別のタブに移ると閉じる（各タブで出し直す。作業の層がタブの切り替えで closePip を呼ぶ）
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { PopIcon } from "./icons.tsx";

// ---- 小窓の位置と大きさ（純粋な計算） ----

export interface PipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 小窓の最小の大きさ（文字の大きさ 16px のとき） */
export const PIP_MIN = { w: 380, h: 240 };

/** 小窓を初めて出すときの、窓の右と下の端からの余白（px） */
export const PIP_MARGIN = 20;

/**
 * 初めて小窓を出すときの位置と大きさ: 窓の右下（右と下の端から少し余白）。グラフの見出しの右上のボタンに重ならず、
 * グラフの下の操作の欄（対策・想定の前提）にも近い。幅は窓の45%（420〜820px）、高さは窓の55%（520px まで）。
 * 一度動かした・大きさを変えた位置は、アプリを開いている間はそちらを使う
 */
export function defaultPipRect(vw: number, vh: number): PipRect {
  const w = Math.round(Math.min(820, Math.max(420, vw * 0.45)));
  const h = Math.round(Math.min(520, vh * 0.55));
  return { x: Math.max(8, vw - w - PIP_MARGIN), y: Math.max(8, vh - h - PIP_MARGIN), w, h };
}

/** 小窓を窓の中に収める（大きさは最小と窓の大きさの間。枠が窓の外に出ないよう、位置も寄せる） */
export function clampPipRect(r: PipRect, vw: number, vh: number, fs = 1): PipRect {
  const w = Math.round(Math.max(Math.min(PIP_MIN.w * fs, vw - 16), Math.min(r.w, vw - 16)));
  const h = Math.round(Math.max(Math.min(PIP_MIN.h * fs, vh - 16), Math.min(r.h, vh - 16)));
  const x = Math.round(Math.max(0, Math.min(r.x, vw - w)));
  const y = Math.round(Math.max(0, Math.min(r.y, vh - h)));
  return { x, y, w, h };
}

/** 小窓の、大きさを変える端: 左右の端（横）・下の端（縦）・下の二つの角（両方）。上の端は移動の帯なので伸縮しない */
export type PipEdge = "w" | "e" | "s" | "sw" | "se";

/**
 * 端をつかんで大きさを変えたあとの位置と大きさ（r0 はつかんだときの枠、dx・dy は動かした量）。
 * つかんだ端だけが動き、反対側の端は動かない（左の端なら右の端を固定）。最小の大きさと窓の内側（端から出ない・幅は窓 − 16px まで）を守る
 */
export function resizePipRect(r0: PipRect, edge: PipEdge, dx: number, dy: number, vw: number, vh: number, fs = 1): PipRect {
  const minW = Math.min(PIP_MIN.w * fs, vw - 16);
  const minH = Math.min(PIP_MIN.h * fs, vh - 16);
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
  return clampPipRect({ x, y, w, h }, vw, vh, fs);
}

/** キーボードで動かす・大きさを変える1回の量（px。文字の大きさ 16px のとき） */
export const PIP_KEY_STEP = 16;

/**
 * 移動の帯にフォーカスしてキーを押したときの位置と大きさ: 矢印キーで移動、Shift＋矢印で大きさ（右・下で大きく、左・上で小さく）。
 * 扱わないキーは null
 */
export function keyPipRect(r: PipRect, key: string, shift: boolean, vw: number, vh: number, fs = 1): PipRect | null {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (d === undefined) return null;
  const step = Math.round(PIP_KEY_STEP * fs);
  const [kx, ky] = d as [number, number];
  if (shift) return resizePipRect(r, kx !== 0 ? "e" : "s", kx * step, ky * step, vw, vh, fs);
  return clampPipRect({ ...r, x: r.x + kx * step, y: r.y + ky * step }, vw, vh, fs);
}

/** 小窓の中のグラフの高さ（px）: 枠の高さから、グラフの外の分（extra）を引く。最小 100px × 文字の大きさ */
export function pipChartHeight(panelHeight: number, fontPx: number, extra: number): number {
  return Math.max(Math.round(100 * (fontPx / 16)), Math.floor(panelHeight - extra));
}

const rootFontPx = () => (typeof window === "undefined" ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);

// ---- 出しているか・位置と大きさ（アプリを開いている間、画面の中で覚える。画面には保存しない・世帯のファイルにも書かない） ----

interface PipState {
  on: boolean;
  rect: PipRect | null;
}
let pipState: PipState = { on: false, rect: null };
const pipSubs = new Set<(s: PipState) => void>();

function setPip(next: PipState): void {
  pipState = next;
  for (const f of pipSubs) f(next);
}

/** 小窓を出す（前に出したときの位置と大きさで） */
export function openPip(): void {
  if (!pipState.on) setPip({ on: true, rect: pipState.rect });
}

/** 小窓を閉じる（位置と大きさは覚えておく） */
export function closePip(): void {
  if (pipState.on) setPip({ on: false, rect: pipState.rect });
}

/** 小窓を出しているか（変わったら描き直す） */
export function usePipOn(): boolean {
  const [on, setOn] = useState(() => pipState.on);
  useEffect(() => {
    const f = (s: PipState) => setOn(s.on);
    pipSubs.add(f);
    setOn(pipState.on);
    return () => {
      pipSubs.delete(f);
    };
  }, []);
  return on;
}

// ---- 部品 ----

/**
 * 小窓を閉じて元に戻す印（大きな四角の左上に小さな四角が重なった形）。開くときの印（icons.tsx の PopIcon）と見分けがつく形のまま残す。
 * 文字の色で描く。読み上げない（ボタンの名前で伝える）
 */
export function PipBackIcon() {
  return (
    <svg class="pip-i" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" data-pip-icon="back">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2" />
      <rect x="5.5" y="7.5" width="8.5" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}

/** 小窓のボタンの説明（カーソルを乗せたとき・フォーカスしたときの小さな札と、読み上げ） */
export const PIP_LABEL = { open: "グラフを小窓で表示", close: "小窓を閉じる", back: "元に戻す（小窓を閉じる）" } as const;

/**
 * グラフの見出しの右上に置く小窓のボタン（アイコンだけ。文字は出さない。小窓が開く共通の印）。小窓を出している間は「小窓を閉じる」（元に戻す印）。
 * 説明は小さな札（data-tip。CSS で年の表示と同じ見た目に出す）と aria-label。OS の title の吹き出しとは二重にしない
 */
export function PipButton() {
  const on = usePipOn();
  const label = on ? PIP_LABEL.close : PIP_LABEL.open;
  return (
    <button type="button" class="pip-btn tip-btn" aria-pressed={on} onClick={() => (on ? closePip() : openPip())} aria-label={label} data-tip={label} data-pip-toggle={on ? "close" : "open"}>
      {on ? <PipBackIcon /> : <PopIcon />}
    </button>
  );
}

const EDGE_LABEL: Record<PipEdge, string> = { w: "左の端（横に伸縮）", e: "右の端（横に伸縮）", s: "下の端（縦に伸縮）", sw: "左下の角（縦横に伸縮）", se: "右下の角（縦横に伸縮）" };

/**
 * 小窓（出していなければ何も描かない）: アプリの窓の中に固定して置く。head は上の帯に出す見出し（結論の1文）、
 * extra はグラフの外の高さ（文字の大きさ 16px のとき。帯・凡例など）、children は決めた高さでグラフを描く
 */
export function ChartPip({ head, extra, children }: { head?: ComponentChildren; extra: number; children: (height: number) => ComponentChildren }) {
  const on = usePipOn();
  if (!on || typeof window === "undefined") return null;
  return (
    <PipPanel head={head} extra={extra}>
      {children}
    </PipPanel>
  );
}

function PipPanel({ head, extra, children }: { head?: ComponentChildren; extra: number; children: (height: number) => ComponentChildren }) {
  const fs = rootFontPx() / 16;
  const [rect, setRect] = useState<PipRect>(() => clampPipRect(pipState.rect ?? defaultPipRect(window.innerWidth, window.innerHeight), window.innerWidth, window.innerHeight, fs));
  const [active, setActive] = useState<"move" | PipEdge | null>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  useEffect(() => {
    const onResize = () => setRect((r) => clampPipRect(r, window.innerWidth, window.innerHeight, rootFontPx() / 16));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // 位置と大きさを覚える（閉じても、次に出すときに同じところへ）
  const remember = (r: PipRect) => {
    pipState = { ...pipState, rect: r };
  };
  const drag = (kind: "move" | PipEdge) => (e: PointerEvent) => {
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
      last = kind === "move" ? clampPipRect({ ...r0, x: r0.x + dx, y: r0.y + dy }, window.innerWidth, window.innerHeight, k) : resizePipRect(r0, kind, dx, dy, window.innerWidth, window.innerHeight, k);
      setRect(last);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setActive(null);
      remember(last);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const next = keyPipRect(rectRef.current, e.key, e.shiftKey, window.innerWidth, window.innerHeight, rootFontPx() / 16);
    if (next === null) return;
    e.preventDefault();
    setRect(next);
    remember(next);
  };
  return (
    <section
      class={`pip card${active === "move" ? " is-moving" : ""}${active !== null && active !== "move" ? " is-sizing" : ""}`}
      style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` }}
      aria-label="小窓のグラフ（上の帯をドラッグで移動、端をドラッグで大きさを変えられます）"
      data-pip-panel
    >
      <div class="pip-head pip-grip" onPointerDown={drag("move")} onKeyDown={onKey} tabIndex={0} aria-label="小窓を動かす帯（ドラッグで移動。矢印キーで移動、Shift＋矢印キーで大きさを変える）" data-pip-grip>
        <span class="pip-handle" aria-hidden="true">
          <span class="pip-handle-i">⠿</span>
          <span class="pip-handle-t">移動</span>
        </span>
        <div class="pip-title">{head}</div>
        <button type="button" class="pip-btn tip-btn" onClick={closePip} aria-label={PIP_LABEL.back} data-tip={PIP_LABEL.back} data-pip-close>
          <PipBackIcon />
        </button>
      </div>
      {children(pipChartHeight(rect.h, fs * 16, extra * fs))}
      {(["w", "e", "s", "sw", "se"] as const).map((edge) => (
        <span key={edge} class={`pip-edge pip-edge-${edge}${active === edge ? " on" : ""}`} onPointerDown={drag(edge)} title={`ドラッグで大きさを変えられます（${EDGE_LABEL[edge]}）`} aria-hidden="true" data-pip-edge={edge} />
      ))}
    </section>
  );
}

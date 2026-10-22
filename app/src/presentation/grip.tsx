// つかんで動かす帯（提示層の共通の部品）: グラフの小窓（ChartPip.tsx）と、貯めるお金の内訳の小窓（MoneyThree.tsx）で同じ操作感・同じ見た目の手がかりにする。
// - 帯（小窓の見出しの行）をドラッグで移動する（マウス・タッチ・ペン。Pointer Events）。帯の中のボタン・入力欄からはつかまない（押せるまま）
// - 帯にフォーカスして矢印キーで移動する（1回 16px × 文字の大きさ）
// - 見た目の手がかり: 帯の左の取っ手の印（⠿ 移動）・薄い色の帯・つかめる形のカーソル（app.css の .grip・.grip-mark）
// - 窓の外に出ないよう、端で止める
import { useState } from "preact/hooks";

/** キーボードで動かす1回の量（px。文字の大きさ 16px のとき） */
export const GRIP_KEY_STEP = 16;

/** 帯の読み上げの名前（resize: Shift＋矢印キーで大きさも変えられる小窓） */
export function gripLabel(resize = false): string {
  return `小窓を動かす帯（ドラッグで移動。矢印キーで移動${resize ? "、Shift＋矢印キーで大きさを変える" : ""}）`;
}

/** 矢印キーの向き（扱わないキーは null） */
export function arrowDelta(key: string): readonly [number, number] | null {
  const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, readonly [number, number]>)[key];
  return d ?? null;
}

/** 文字の大きさの倍率（html の文字の大きさ ÷ 16px） */
export const rootFontScale = (): number => (typeof window === "undefined" ? 1 : (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16);

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 枠（今の見た目の位置）を dx・dy だけ動かすとき、窓（幅 vw・高さ vh）の外に出ない量に縮める。
 * すでに窓の外にはみ出している向きへは、それ以上動かさない（戻す向きへは動かせる）
 */
export function clampShift(r: Box, dx: number, dy: number, vw: number, vh: number): [number, number] {
  const cx = Math.max(Math.min(0, -r.left), Math.min(dx, Math.max(0, vw - (r.left + r.width))));
  const cy = Math.max(Math.min(0, -r.top), Math.min(dy, Math.max(0, vh - (r.top + r.height))));
  return [Math.round(cx), Math.round(cy)];
}

/** ドラッグの間にすること（dx・dy はつかんだ所からの量） */
export interface DragMoves {
  move: (dx: number, dy: number) => void;
  end?: () => void;
}

/** 帯の中で押してもつかまない物（押せるまま） */
const CONTROLS = "button, a, input, select, textarea";

/**
 * ドラッグで動かす（つかむ所が複数あるときは kind で分ける）。start(kind, begin) が onPointerDown に渡す関数を返す。
 * begin はつかんだときに呼ぶ（そのときの位置を覚えて、動かす関数を返す）。fromControls が false なら、帯の中のボタンなどからはつかまない
 */
export function useDrag<K extends string>(): { active: K | null; start: (kind: K, begin: () => DragMoves, fromControls?: boolean) => (e: PointerEvent) => void } {
  const [active, setActive] = useState<K | null>(null);
  const start = (kind: K, begin: () => DragMoves, fromControls = false) => (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (!fromControls && e.target instanceof Element && e.target.closest(CONTROLS) !== null) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    setActive(kind);
    const sx = e.clientX;
    const sy = e.clientY;
    const m = begin();
    const move = (ev: PointerEvent) => m.move(ev.clientX - sx, ev.clientY - sy);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setActive(null);
      m.end?.();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  return { active, start };
}

/** 帯の左の取っ手の印（⠿ 移動）。読み上げない（帯の名前で伝える） */
export function GripMark() {
  return (
    <span class="grip-mark" aria-hidden="true">
      <span class="grip-mark-i">⠿</span>
      <span class="grip-mark-t">移動</span>
    </span>
  );
}

// 世帯の選択の出方（上の帯の世帯の箱から、下へ伸びて出る一覧）。中身（開いている世帯の状態・世帯の一覧）は App.tsx が渡す。
// - 箱のすぐ下に出す（上端の小さな三角が箱を指す。左の端は箱の左にそろえ、窓の外には出さない）。高さが窓に収まらないときは一覧の中だけ縦に送る
// - 後ろの画面は消さずに薄く暗くして残す（今の画面の上に重なっていると分かるように）。箱だけは暗くしない
// - 出るとき・閉じるときは短い動き（上から下へ伸びて薄く現れる。OS の「視差効果を減らす」のときは動きなし。header.css）
// - 閉じる: 暗い所を押す・Esc（世帯の一覧が受ける）・箱をもう一度押す・一覧の頭の ×
// - フォーカスは開いたら一覧へ移し、閉じたら箱へ戻す
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

/** 閉じるときの動きの長さ（ミリ秒。header.css の hh-drop-out と同じ） */
export const DROP_OUT_MS = 150;

export interface DropPlace {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  /** 三角の位置（一覧の左の端から。箱のまん中を指す） */
  arrow: number;
}

/** 一覧のいちばん広い幅（px。文字の大きさ 16px のとき） */
export const DROP_MAX_W = 1080;

/**
 * 箱（上の帯の世帯の箱の位置）から、一覧を出す位置と大きさを決める。左の端は箱の左にそろえ、窓の端から gutter（狭い窓は 8px、ほかは 16px）は空ける。
 * 上は箱の下から三角の分（12px）だけ下。高さは窓の下の端の手前まで（一覧の中で縦に送る）
 */
export function dropPlace(btn: { left: number; bottom: number; width: number }, vw: number, vh: number, fs = 1): DropPlace {
  const gutter = vw < 600 ? 8 : 16;
  const width = Math.round(Math.max(0, Math.min(DROP_MAX_W * fs, vw - gutter * 2)));
  const left = Math.round(Math.max(gutter, Math.min(btn.left, vw - gutter - width)));
  const top = Math.round(Math.max(8, btn.bottom) + 12);
  const maxHeight = Math.round(Math.max(160, vh - top - 12));
  const arrow = Math.round(Math.max(18, Math.min(width - 18, btn.left + btn.width / 2 - left)));
  return { top, left, width, maxHeight, arrow };
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const hhButton = () => (typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-household-button]"));

export function HouseholdDrop({ open, onClose, children }: { open: boolean; onClose: () => void; children?: ComponentChildren }) {
  // 閉じる動きの間も描いておく（閉じた描画で消してしまわないよう、開いていたかを描くときに比較する）
  const [prevOpen, setPrevOpen] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const closingNow = prevOpen && !open && !reduceMotion();
  if (prevOpen !== open) {
    setPrevOpen(open);
    setLeaving(closingNow);
  }
  const [place, setPlace] = useState<DropPlace | null>(null);
  const was = useRef(open);
  const panel = useRef<HTMLDivElement>(null);
  const shown = open || leaving || closingNow;

  // 箱の位置から、出す位置を測る（窓の大きさが変わったとき・スクロールしたときも測り直す）
  useLayoutEffect(() => {
    if (!shown) return;
    const measure = () => {
      const b = hhButton()?.getBoundingClientRect();
      if (b === undefined) return;
      const fs = (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
      setPlace(dropPlace({ left: b.left, bottom: b.bottom, width: b.width }, window.innerWidth, window.innerHeight, fs));
    };
    // 箱が見えない所までスクロールしていたら、箱が見える所（いちばん上）へ戻す
    if (open && (hhButton()?.getBoundingClientRect().bottom ?? 0) < 0) window.scrollTo({ top: 0 });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [shown]);

  // 開いたら一覧へフォーカス。閉じたら箱へ戻す
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    if (open) {
      panel.current?.focus({ preventScroll: true });
      return;
    }
    const a = document.activeElement;
    if (a === null || a === document.body || (panel.current?.contains(a) ?? false)) hhButton()?.focus({ preventScroll: true });
  }, [open]);
  // 閉じる短い動きのあとで消す
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(false), DROP_OUT_MS + 10);
    return () => clearTimeout(t);
  }, [leaving]);
  // 初めから開いているとき（描いた直後）も一覧へフォーカス
  useEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true });
  }, []);

  if (!shown) return null;
  const out = !open;
  // 後ろの画面をホイール・指でスクロールさせない（一覧が箱から離れないように）
  const hold = (e: Event) => e.preventDefault();
  return (
    <>
      <div class={`hh-scrim${out ? " is-out" : ""}`} aria-hidden="true" onClick={out ? undefined : onClose} onWheel={hold} onTouchMove={hold} data-household-scrim />
      <div
        ref={panel}
        class={`hh-drop${out ? " is-out" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hh-title"
        tabIndex={-1}
        style={place !== null ? { top: `${place.top}px`, left: `${place.left}px`, width: `${place.width}px`, "--arrow-x": `${place.arrow}px` } : undefined}
        data-household-drop={out ? "closing" : "open"}
      >
        <div class="hh-drop-in" style={place !== null ? { maxHeight: `${place.maxHeight}px` } : undefined}>
          {children}
        </div>
      </div>
    </>
  );
}

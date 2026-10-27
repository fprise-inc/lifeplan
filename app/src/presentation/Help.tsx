// 説明の「?」（丸に ?）の共通の部品（0077）。画面に常に出すのは欄の名前・値・状態の印・操作の名前までにし、
// 使い方の説明・注意・制度の説明・推定の根拠はこの部品の中に入れる。
// 開き方: カーソルを合わせる・キーボードでフォーカスする・押す（タッチ）のどれでも開く。押すと開いたままになり、もう一度押す・Esc・外を押すと閉じる。
// 説明の文は閉じている間も DOM に置き（hidden）、ボタンの aria-describedby で読み上げに渡す。
// 引き金は既定で「?」。mark を渡すと、その印（例: 欄の「推定」の札）を押して開く形になる
import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";

/** 開いているかの元（どれか1つでも真なら開く） */
export interface HelpState {
  /** カーソルが乗っている */
  hover: boolean;
  /** キーボードのフォーカスがある */
  focus: boolean;
  /** 押して開いたまま */
  pinned: boolean;
}

export type HelpEvent = "enter" | "leave" | "focus" | "blur" | "press" | "escape" | "outside";

export const HELP_CLOSED: HelpState = { hover: false, focus: false, pinned: false };

export const helpOpen = (s: HelpState): boolean => s.hover || s.focus || s.pinned;

/** 出来事ごとの次の状態（画面の外でも確かめられるように、純粋な関数にしておく） */
export function helpNext(s: HelpState, e: HelpEvent): HelpState {
  switch (e) {
    case "enter":
      return { ...s, hover: true };
    case "leave":
      return { ...s, hover: false };
    case "focus":
      return { ...s, focus: true };
    case "blur":
      // フォーカスが外へ出たら、押して開いたままの物も閉じる
      return HELP_CLOSED;
    case "press":
      // 押して開いたままなら閉じる。それ以外（閉じている・カーソルやフォーカスで開いている）なら開いたままにする
      return s.pinned ? HELP_CLOSED : { ...s, pinned: true };
    case "escape":
    case "outside":
      return HELP_CLOSED;
  }
}

interface HelpProps {
  /** 説明の中身（文か、段落の並び） */
  children?: ComponentChildren;
  /** 何の説明か（ボタンの読み上げの名前「〇〇の説明」に使う） */
  label: string;
  /** 「?」の代わりに押す印（例: 「推定」の札）。渡すと札そのものが開くボタンになる */
  mark?: ComponentChildren;
  /** 引き金のボタンに足す class（印の色など） */
  markClass?: string;
  /** 確かめ用の印（data-help の値） */
  id?: string;
}

/**
 * 開いた説明の置き場所（画面の端からはみ出さないように、ボタンの位置から決める）。
 * 入力のパネルのように transform のかかった枠の中では position: fixed の基準がその枠になるため、今の置き場所と実際の位置の差から基準を求めて引く
 */
function place(btn: HTMLElement, pop: HTMLElement): { top: number; left: number } {
  const r = btn.getBoundingClientRect();
  const now = pop.getBoundingClientRect();
  const ox = now.left - (Number.parseFloat(pop.style.left) || 0);
  const oy = now.top - (Number.parseFloat(pop.style.top) || 0);
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const left = Math.max(8, Math.min(r.left, vw - w - 8));
  const below = r.bottom + 6;
  const top = below + h > vh - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below;
  return { top: top - oy, left: left - ox };
}

export function Help({ children, label, mark, markClass, id }: HelpProps) {
  const [st, setSt] = useState<HelpState>(HELP_CLOSED);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const popId = `help-${useId()}`;
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const open = helpOpen(st);
  const ev = (e: HelpEvent) => setSt((s) => helpNext(s, e));

  // 開いている間: Esc で閉じる（入力のパネルの Esc で閉じるより先に受け、パネルは閉じない）・外を押すと閉じる・動いたら置き直す
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      ev("escape");
    };
    const onDown = (e: PointerEvent) => {
      if (wrap.current !== null && e.target instanceof Node && wrap.current.contains(e.target)) return;
      ev("outside");
    };
    const re = () => {
      if (btn.current !== null && pop.current !== null) setPos(place(btn.current, pop.current));
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", re, true);
    window.addEventListener("resize", re);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", re, true);
      window.removeEventListener("resize", re);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (open && btn.current !== null && pop.current !== null) setPos(place(btn.current, pop.current));
    if (!open) setPos(null);
  }, [open]);

  return (
    <span class="help" ref={wrap} onMouseEnter={() => ev("enter")} onMouseLeave={() => ev("leave")} {...(id !== undefined ? { "data-help": id } : {})}>
      <button
        ref={btn}
        type="button"
        class={`help-btn${mark !== undefined ? " help-mark" : ""}${markClass !== undefined ? ` ${markClass}` : ""}`}
        aria-label={mark !== undefined ? undefined : `${label}の説明`}
        aria-expanded={open}
        aria-controls={popId}
        aria-describedby={popId}
        onFocus={() => ev("focus")}
        onBlur={(e) => {
          const to = e.relatedTarget;
          if (wrap.current !== null && to instanceof Node && wrap.current.contains(to)) return;
          ev("blur");
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          ev("press");
        }}
        data-help-btn
      >
        {mark !== undefined ? mark : <span aria-hidden="true">?</span>}
      </button>
      <span
        ref={pop}
        id={popId}
        role="tooltip"
        class="help-pop"
        hidden={!open}
        style={open ? (pos !== null ? { top: `${pos.top}px`, left: `${pos.left}px` } : { visibility: "hidden" }) : undefined}
        // 説明の中を押してもボタンのフォーカスを外さない（文を選ぶ・読むときに閉じない）
        onMouseDown={(e) => e.preventDefault()}
        data-help-pop
      >
        {children}
      </span>
    </span>
  );
}

// 説明の「?」（丸に ?）の共通の部品（0077）。画面に常に出すのは欄の名前・値・状態の印・操作の名前までにし、
// 使い方の説明・注意・制度の説明・推定の根拠はこの部品の中に入れる。
// 開き方: カーソルを合わせる・キーボードでフォーカスする・押す（タッチ）のどれでも開く。押すと開いたままになり、もう一度押す・Esc・外を押すと閉じる。
// 説明の文は閉じている間も DOM に置き（hidden）、ボタンの aria-describedby で読み上げに渡す。
// 引き金は既定で「?」。mark を渡すと、その印（例: 欄の「推定」の札）を押して開く形になる。
// 「?」は字ではなく SVG の線で描く（字の上下の余白はフォントで違い、丸の中央からずれるため）。
// 開いた説明の文は選んでコピーできる。カーソルを「?」から説明の箱へ動かす途中で閉じないよう、外れてから閉じるまで少し待ち、すき間も埋める
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

/** 「?」の形（SVG）。丸の中の字の大きさと中央は、この寸法だけで決まる（フォントに頼らない） */
export const HELP_GLYPH = {
  /** 描く範囲（0〜20 の正方形。丸の内側いっぱいに広げる） */
  view: 20,
  /** 曲がりの線: 中心 (10, 7.6)・半径 2.4 の円の左端から右下までの弧と、中央 (10, 11.6) へ下りる軸 */
  path: "M7.6 7.6a2.4 2.4 0 1 1 3.6 2.08c-.8.48-1.2 1-1.2 1.92",
  /** 線の太さ（端は丸める） */
  stroke: 1.6,
  /** 点: 中心 (10, 14.6)・半径 1 */
  dot: { cx: 10, cy: 14.6, r: 1 },
  /** 字の外形（線の太さを含む）。上: 弧の上端 5.2 − 線の半分 0.8、下: 点の下端 15.6。左右: 弧の左右の端 7.6／12.4 ± 線の半分 */
  ink: { top: 4.4, bottom: 15.6, left: 6.8, right: 13.2 },
} as const;

/** カーソルが外れてから閉じるまでの間（ms）。「?」から説明の箱へ動かす途中で閉じないように */
export const HELP_LEAVE_MS = 300;

/**
 * カーソルの出入りで開閉する決まり（タイマーを渡して画面の外でも確かめられるようにする）。
 * 外れたら HELP_LEAVE_MS 待ってから閉じ、その間に戻れば閉じない。箱の中で押したまま（文を選ぶドラッグ）の間は、外へ出ても閉じない
 */
export function helpHoverGate(on: (e: "enter" | "leave") => void, timer: { set: (f: () => void, ms: number) => unknown; clear: (h: unknown) => void } = { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }) {
  let wait: unknown = null;
  let over = false;
  let dragging = false;
  const cancel = () => {
    if (wait !== null) timer.clear(wait);
    wait = null;
  };
  const later = () => {
    cancel();
    wait = timer.set(() => {
      wait = null;
      on("leave");
    }, HELP_LEAVE_MS);
  };
  return {
    enter() {
      over = true;
      cancel();
      on("enter");
    },
    leave() {
      over = false;
      if (!dragging) later();
    },
    /** 説明の箱の中で押した（文を選び始めた） */
    dragStart() {
      dragging = true;
    },
    /** 押したのを離した（箱の外で離したときは、そこから待って閉じる） */
    dragEnd() {
      if (!dragging) return;
      dragging = false;
      if (!over) later();
    },
    dispose: cancel,
  };
}

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
  /** 引き金のボタンに足す data- の属性（例: 状態の印の data-state） */
  data?: Readonly<Record<string, string>>;
}

/**
 * 開いた説明の置き場所（画面の端からはみ出さないように、ボタンの位置から決める）。
 * 入力のパネルのように transform のかかった枠の中では position: fixed の基準がその枠になるため、今の置き場所と実際の位置の差から基準を求めて引く
 */
export type HelpSide = "below" | "above";

function place(btn: HTMLElement, pop: HTMLElement): { top: number; left: number; side: HelpSide } {
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
  const up = below + h > vh - 8 && r.top - h - 6 > 8;
  const top = up ? r.top - h - 6 : below;
  return { top: top - oy, left: left - ox, side: up ? "above" : "below" };
}

export function Help({ children, label, mark, markClass, id, data }: HelpProps) {
  const [st, setSt] = useState<HelpState>(HELP_CLOSED);
  const [pos, setPos] = useState<{ top: number; left: number; side: HelpSide } | null>(null);
  const popId = `help-${useId()}`;
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const open = helpOpen(st);
  const ev = (e: HelpEvent) => setSt((s) => helpNext(s, e));
  const gate = useRef<ReturnType<typeof helpHoverGate> | null>(null);
  gate.current ??= helpHoverGate(ev);
  const hover = gate.current;
  useEffect(() => hover.dispose, []);
  // 箱の中で押してドラッグし、外で離したとき（離した所が箱の外なら、そこから待って閉じる）
  useEffect(() => {
    const up = () => hover.dragEnd();
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    return () => {
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
    };
  }, []);

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
    <span
      class="help"
      ref={wrap}
      onMouseEnter={() => hover.enter()}
      onMouseLeave={() => hover.leave()}
      // フォーカスが「?」と説明の箱の外へ出たら閉じる（箱の中を押して文を選ぶ間は、フォーカスが箱へ移るだけで閉じない）
      onFocusOut={(e) => {
        const to = e.relatedTarget;
        if (wrap.current !== null && to instanceof Node && wrap.current.contains(to)) return;
        ev("blur");
      }}
      {...(id !== undefined ? { "data-help": id } : {})}
    >
      <button
        ref={btn}
        type="button"
        class={`help-btn${mark !== undefined ? " help-mark" : ""}${markClass !== undefined ? ` ${markClass}` : ""}`}
        aria-label={mark !== undefined ? undefined : `${label}の説明`}
        aria-expanded={open}
        aria-controls={popId}
        aria-describedby={popId}
        onFocus={() => ev("focus")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          ev("press");
        }}
        data-help-btn
        {...(data ?? {})}
      >
        {mark !== undefined ? mark : <HelpGlyph />}
      </button>
      <span
        ref={pop}
        id={popId}
        role="tooltip"
        class="help-pop"
        hidden={!open}
        // 押すとフォーカスが箱へ移る（「?」の外へ出たと見なさない。文はマウスで選べる）
        tabIndex={-1}
        style={open ? (pos !== null ? { top: `${pos.top}px`, left: `${pos.left}px` } : { visibility: "hidden" }) : undefined}
        // 箱の中を押す・ドラッグするのは、下の欄・パネル・つかむ帯へ伝えない（外を押したと見なす処理は、包みの中なので閉じない）
        onPointerDown={(e) => {
          e.stopPropagation();
          hover.dragStart();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          // 欄の名前（label）の中に置いたときに、押すと欄へフォーカスが移って閉じないように
          if (wrap.current?.closest("label") != null) e.preventDefault();
        }}
        data-side={pos?.side}
        data-help-pop
      >
        {children}
      </span>
    </span>
  );
}

/** 「?」の字（SVG。丸の内側いっぱいの正方形に描き、字の外形の中心が正方形の中心に来る） */
function HelpGlyph() {
  const g = HELP_GLYPH;
  return (
    <svg class="help-q" viewBox={`0 0 ${g.view} ${g.view}`} aria-hidden="true" focusable="false">
      <path d={g.path} fill="none" stroke="currentColor" stroke-width={g.stroke} stroke-linecap="round" stroke-linejoin="round" />
      <circle cx={g.dot.cx} cy={g.dot.cy} r={g.dot.r} fill="currentColor" />
    </svg>
  );
}

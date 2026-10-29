// 説明の「?」（丸に ?）の共通の部品（0077）。画面に常に出すのは欄の名前・値・状態の印・操作の名前までにし、
// 使い方の説明・注意・制度の説明・推定の根拠はこの部品の中に入れる。
// 開き方: カーソルを合わせる・キーボードでフォーカスする・押す（タッチ）のどれでも開く。
// フォーカスで開くのはキーボードで移ったとき（:focus-visible）だけ。パネルを開いた直後のフォーカスや、押したときのフォーカスでは開かない（0077 の追記）。押すと開いたままになり、もう一度押す・Esc・外を押すと閉じる。
// 説明の文は閉じている間も DOM に置き（hidden）、ボタンの aria-describedby で読み上げに渡す。
// 引き金は既定で「?」。mark を渡すと、その印（例: 欄の「推定」の札）を押して開く形になる。
// 「?」は字ではなく SVG の線で描く（字の上下の余白はフォントで違い、丸の中央からずれるため）。
// 開いた説明の文は選んでコピーできる。カーソルを「?」から説明の箱へ動かす途中で閉じないよう、外れてから閉じるまで少し待ち、すき間も埋める
// 開いた説明の箱は body の直下に出す（入力のパネル・一覧・タブの枠の overflow や transform に切られない。0077 の追記）
import { render, type ComponentChildren } from "preact";
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

/**
 * フォーカスで開くか: キーボードで移ったとき（:focus-visible）だけ。
 * 入力のパネルを開いた直後にフォーカスが「?」へ移っても、カーソルを合わせる前に説明が出ないように。:focus-visible を読めない画面では開く（キーボードで使えなくならないように）
 */
export function focusOpensHelp(el: { matches: (selector: string) => boolean }): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

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

function place(btn: HTMLElement, pop: HTMLElement): { top: number; left: number; side: HelpSide; tall: boolean } {
  const r = btn.getBoundingClientRect();
  const now = pop.getBoundingClientRect();
  const ox = now.left - (Number.parseFloat(pop.style.left) || 0);
  const oy = now.top - (Number.parseFloat(pop.style.top) || 0);
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  // 画面の高さに収まらない箱は、画面の高さで止めて中を動かせるようにする（data-tall。app.css）
  return { ...helpPlace({ left: r.left, top: r.top, bottom: r.bottom }, { w, h }, { w: vw, h: vh }, { x: ox, y: oy }), tall: h > vh - 16 };
}

/**
 * 開いた説明の箱の置き場所（純粋な関数。画面の外でも確かめられるように）。
 * 左右: 引き金の左端にそろえ、画面の右端からはみ出すなら左へずらす（画面の左右に 8px 残す）。
 * 上下: 引き金の下に出し、下に収まらず上に収まるなら上へ。どちらにも収まらなければ、広い方に出して画面の端で止める（箱は CSS で画面の高さに収め、中を動かせる）
 */
export function helpPlace(btn: { left: number; top: number; bottom: number }, box: { w: number; h: number }, view: { w: number; h: number }, origin: { x: number; y: number } = { x: 0, y: 0 }): { top: number; left: number; side: HelpSide } {
  const m = 8;
  const gap = 6;
  const left = Math.max(m, Math.min(btn.left, view.w - box.w - m));
  const roomBelow = view.h - m - (btn.bottom + gap);
  const roomAbove = btn.top - gap - m;
  const up = box.h > roomBelow && (box.h <= roomAbove || roomAbove > roomBelow);
  const top = up ? Math.max(m, btn.top - gap - box.h) : Math.max(m, Math.min(btn.bottom + gap, view.h - m - box.h));
  return { top: top - origin.y, left: left - origin.x, side: up ? "above" : "below" };
}

export function Help({ children, label, mark, markClass, id, data }: HelpProps) {
  const [st, setSt] = useState<HelpState>(HELP_CLOSED);
  const [pos, setPos] = useState<{ top: number; left: number; side: HelpSide; tall: boolean } | null>(null);
  const popId = `help-${useId()}`;
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const open = helpOpen(st);
  const ev = (e: HelpEvent) => setSt((s) => helpNext(s, e));
  const gate = useRef<ReturnType<typeof helpHoverGate> | null>(null);
  gate.current ??= helpHoverGate(ev);
  const hover = gate.current;
  /** 「?」の包みか説明の箱の中か（箱は body の直下にあるので、包みの中とは限らない） */
  const inside = (t: EventTarget | null): boolean => t instanceof Node && ((wrap.current?.contains(t) ?? false) || (pop.current?.contains(t) ?? false));
  // 箱を body の直下に出すか（開いている間だけ。閉じている間は包みの中に隠して置き、読み上げの説明に使う。画面の外〔文字列に描く〕では包みの中）
  const portal = open && typeof document !== "undefined";
  /** body の直下の置き場（開いている間だけ body に付ける） */
  const host = useRef<HTMLDivElement | null>(null);
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
      if (inside(e.target)) return;
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
  // 開いている間は、箱を body の直下の置き場に描く（描くたびに描き直す。置き場所の計算より先）。閉じたら置き場を外す
  useLayoutEffect(() => {
    if (!portal) return;
    host.current ??= document.createElement("div");
    host.current.setAttribute("data-help-host", "");
    if (!host.current.isConnected) document.body.appendChild(host.current);
    render(box, host.current);
  });
  useLayoutEffect(() => {
    if (open || host.current === null) return;
    render(null, host.current);
    host.current.remove();
  }, [open]);
  useEffect(
    () => () => {
      if (host.current === null) return;
      render(null, host.current);
      host.current.remove();
    },
    [],
  );
  useLayoutEffect(() => {
    if (open && btn.current !== null && pop.current !== null) setPos(place(btn.current, pop.current));
    if (!open) setPos(null);
  }, [open]);

  const box = (
    <span
      ref={pop}
      id={popId}
      role="tooltip"
      class="help-pop"
      hidden={!open}
      // 押すとフォーカスが箱へ移る（「?」の外へ出たと見なさない。文はマウスで選べる）
      tabIndex={-1}
      style={open ? (pos !== null ? { top: `${pos.top}px`, left: `${pos.left}px` } : { visibility: "hidden" }) : undefined}
      // 箱の中を押す・ドラッグするのは、下の欄・パネル・つかむ帯へ伝えない（外を押したと見なす処理は、箱の中なら閉じない）
      onPointerDown={(e) => {
        e.stopPropagation();
        hover.dragStart();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      // 箱は包みの外（body の直下）にあるので、箱の出入りとフォーカスも包みと同じに扱う
      onMouseEnter={() => hover.enter()}
      onMouseLeave={() => hover.leave()}
      onFocusOut={(e) => {
        if (inside(e.relatedTarget)) return;
        ev("blur");
      }}
      data-side={pos?.side}
      {...(pos?.tall === true ? { "data-tall": "" } : {})}
      data-help-pop
    >
      {children}
    </span>
  );
  return (
    <span
      class="help"
      ref={wrap}
      onMouseEnter={() => hover.enter()}
      onMouseLeave={() => hover.leave()}
      // フォーカスが「?」と説明の箱の外へ出たら閉じる（箱の中を押して文を選ぶ間は、フォーカスが箱へ移るだけで閉じない）
      onFocusOut={(e) => {
        if (inside(e.relatedTarget)) return;
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
        onFocus={(e) => {
          if (focusOpensHelp(e.currentTarget)) ev("focus");
        }}
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
      {portal ? null : box}
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

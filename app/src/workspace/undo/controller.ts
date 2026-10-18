// アプリ全体の元に戻す・やり直す（作業の層）。キー操作（⌘Z／Ctrl+Z など）・メニュー・ボタンを、ここの run の1か所で受ける。
// - 文字の欄の中に戻せる入力があれば、ブラウザ標準の文字の元に戻す（document.execCommand）。なければアプリの履歴
// - 履歴の持ち主（スコープ）は重ねられる: 画面の大枠（世帯・案・表示の設定）の上に、開いている入力のパネル（下書き）が乗る。
//   いちばん上のスコープだけを戻す（パネルを開いている間に、その裏の世帯を戻さない）
// - 本体のメニュー（macOS の「編集」）からは、ウィンドウの "financia:menu" のイベント（detail が undo か redo）で届く
import { useEffect, useRef } from "preact/hooks";
import type { RecordResult, UndoHistory } from "./history.ts";
import { Grouper, keyAction, kindOf, noticeText, routeFor, type ControlKind, type Cue } from "./input.ts";

/** 履歴の持ち主。level の大きいものが上（同じなら後から足したもの） */
export interface UndoScope {
  level: number;
  /** 戻した1件の名前。戻すものがなければ null */
  undo(): string | null;
  redo(): string | null;
  canUndo(): boolean;
  canRedo(): boolean;
  nextUndo?(): string | null;
  nextRedo?(): string | null;
}

/** 知らせの名前を作るための手がかり（いま操作した部品の名前と、それを含むダイアログの見出し） */
export interface Hint {
  control: string | null;
  dialog: string | null;
}

/** フォーカスのある文字の欄 */
export interface TextField {
  el: object;
  value: string;
}

/** 画面（DOM）とのつなぎ。テストでは差し替える */
export interface UndoEnv {
  activeText(): TextField | null;
  /** ブラウザ標準の文字の元に戻す・やり直す */
  native(kind: "undo" | "redo"): void;
  /** 欄からいったん出る（打ちかけの値を確定させる）。戻したあとに欄へ戻る関数を返す */
  release(el: object): () => void;
  hint(target: object | null): Hint;
  now(): number;
}

export class UndoController {
  readonly grouper = new Grouper();
  private scopes: UndoScope[] = [];
  private session: { el: object; initial: string; nativeUndos: number } | null = null;
  private readonly listeners = new Set<() => void>();
  notify: (msg: string) => void = () => {};
  private readonly env: UndoEnv;

  constructor(env: UndoEnv) {
    this.env = env;
  }

  /** スコープを足す。外す関数を返す */
  push(scope: UndoScope): () => void {
    this.scopes.push(scope);
    this.changed();
    return () => {
      this.scopes = this.scopes.filter((s) => s !== scope);
      this.changed();
    };
  }
  get top(): UndoScope | null {
    let best: UndoScope | null = null;
    for (const s of this.scopes) if (best === null || s.level >= best.level) best = s;
    return best;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  changed(): void {
    for (const fn of [...this.listeners]) fn();
  }

  /** 部品に入った。文字の欄なら、入ったときの中身を覚える（欄の中に戻せる入力があるかの目安） */
  focus(el: object, kind: ControlKind, value: string): void {
    this.session = kind === "text" ? { el, initial: value, nativeUndos: 0 } : null;
    this.grouper.focus(el, kind);
  }
  /** 欄で文字を打った（inputType が history で始まらないもの）: 文字のやり直しはもうできない */
  typed(el: object, inputType: string): void {
    if (this.session !== null && this.session.el === el && !inputType.startsWith("history")) this.session.nativeUndos = 0;
  }

  /** 変更を履歴に積む（いまの操作から、まとめる単位と名前を決める） */
  record<S>(history: UndoHistory<S>, before: S, after: S, describe: (hint: Hint) => string): RecordResult {
    const g = this.grouper.groupFor();
    const cue = this.grouper.current;
    const r = history.record(before, after, {
      label: describe(this.env.hint(cue?.target ?? null)),
      group: g.group,
      at: this.env.now(),
      ...(g.windowMs !== undefined ? { windowMs: g.windowMs } : {}),
    });
    if (r !== "same") this.changed();
    return r;
  }

  /** 元に戻す・やり直す（キー・メニュー・ボタンの共通の入口）。どちらで戻したかを返す */
  run(kind: "undo" | "redo"): "native" | "app" {
    const f = this.env.activeText();
    const s = f !== null && this.session !== null && this.session.el === f.el ? this.session : null;
    const state = s !== null && f !== null ? { changed: f.value !== s.initial, nativeUndos: s.nativeUndos } : null;
    if (routeFor(kind, state) === "native" && s !== null) {
      this.env.native(kind);
      s.nativeUndos = Math.max(0, s.nativeUndos + (kind === "undo" ? 1 : -1));
      return "native";
    }
    const scope = this.top;
    const can = scope !== null && (kind === "undo" ? scope.canUndo() : scope.canRedo());
    if (!can || scope === null) {
      this.notify(noticeText(kind, null));
      return "app";
    }
    // 欄にいるときは、いったん出て打ちかけの値を確定させてから戻し、戻したあとに欄へ戻る（欄が古い値を持ち続けない）
    const back = f !== null ? this.env.release(f.el) : null;
    const label = kind === "undo" ? scope.undo() : scope.redo();
    this.notify(noticeText(kind, label));
    this.changed();
    back?.();
    return "app";
  }
}

// ---- 画面（DOM）とのつなぎ ----

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const short = (s: string) => (s.length > 24 ? `${s.slice(0, 24)}…` : s);
/** 部品・補足（small）を除いた文字 */
function plainText(n: Node): string {
  if (n.nodeType === 3) return n.textContent ?? "";
  if (!(n instanceof Element) || /^(SELECT|OPTION|INPUT|TEXTAREA|BUTTON|SMALL)$/.test(n.tagName)) return "";
  return Array.from(n.childNodes).map(plainText).join("");
}
/** 見出し・ラベルの最初の文字（後ろに付いた印「推定」・中の部品・補足を除く） */
function leadText(el: Element | null | undefined): string {
  if (el == null) return "";
  for (const n of Array.from(el.childNodes)) {
    const t = clean(plainText(n));
    if (t !== "") return t;
  }
  return "";
}
/** 説明の括弧（例: 年収（万円で入れる。1万円単位））を外す */
const dropNote = (s: string) => s.replace(/[（(][^）)]*[）)]$/, "").trim();

/** 部品の名前（ラベル・aria-label・ボタンの文字） */
export function controlLabel(el: Element | null): string | null {
  if (el === null) return null;
  const kind = kindOf(el as HTMLInputElement);
  if (kind === "button") return short(clean(el.getAttribute("aria-label")) || leadText(el)) || null;
  if (kind === "other") return null;
  const labels = (el as HTMLInputElement).labels;
  const fromLabel = labels !== null && labels !== undefined && labels.length > 0 ? leadText(labels[0]) : "";
  const by = el.getAttribute("aria-labelledby");
  const fromBy = by !== null ? leadText(document.getElementById(by.split(/\s+/)[0] ?? "")) : "";
  const text = fromLabel || dropNote(clean(el.getAttribute("aria-label"))) || fromBy;
  return text !== "" ? short(text) : null;
}

/** 部品を含むダイアログ（入力のパネルなど）の見出し */
function dialogTitle(el: Element | null): string | null {
  const d = el?.closest("[role='dialog']");
  if (d == null) return null;
  const by = d.getAttribute("aria-labelledby");
  const t = by !== null ? leadText(document.getElementById(by)) : clean(d.getAttribute("aria-label"));
  return t !== "" ? short(t) : null;
}

const domEnv: UndoEnv = {
  activeText() {
    const a = typeof document === "undefined" ? null : document.activeElement;
    if (a === null || kindOf(a as HTMLInputElement) !== "text") return null;
    const v = (a as HTMLInputElement).value;
    return { el: a, value: typeof v === "string" ? v : (a.textContent ?? "") };
  },
  native(kind) {
    // 文字の欄の元に戻す・やり直す。macOS・Windows の WebView とも、フォーカスのある欄の標準の動きと同じ
    document.execCommand(kind);
  },
  release(el) {
    const h = el as HTMLElement;
    h.blur();
    return () =>
      setTimeout(() => {
        const a = document.activeElement;
        if (h.isConnected && (a === null || a === document.body)) h.focus({ preventScroll: true });
      }, 0);
  },
  hint(target) {
    const el = target instanceof Element ? target : null;
    return { control: controlLabel(el), dialog: dialogTitle(el) };
  },
  now: () => Date.now(),
};

/** アプリでただ1つの元に戻すの受け口 */
export const undoController = new UndoController(domEnv);

const CUE_EVENTS = ["input", "change", "click", "keydown", "focusout", "submit"] as const;

/** キー操作・メニュー・操作の区切りを見張る。外す関数を返す */
export function installUndo(c: UndoController = undoController): () => void {
  const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  let lastKeyAt = -Infinity;
  const cues = new WeakMap<Event, Cue>();
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    const k = keyAction(e, mac);
    if (k === null) return;
    // 標準の動き（とメニューのショートカット）は止め、ここで決める（欄の中なら文字の元に戻す）
    e.preventDefault();
    lastKeyAt = performance.now();
    c.run(k);
  };
  const onMenu = (e: Event) => {
    const d = (e as CustomEvent<unknown>).detail;
    if (d !== "undo" && d !== "redo") return;
    // キー操作で処理した直後にメニューからも届いたときは、二重に戻さない
    if (performance.now() - lastKeyAt < 300) return;
    c.run(d);
  };
  const cueStart = (e: Event) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const cue: Cue = { type: e.type, target: t, kind: kindOf(t as HTMLInputElement) };
    c.grouper.begin(cue);
    cues.set(e, cue);
    // 止めたイベント（伝わりを止めたもの）でも、このタスクの後には外す
    setTimeout(() => c.grouper.end(cue), 0);
    if (e.type === "input" && cue.kind === "text") c.typed(t, (e as InputEvent).inputType ?? "");
  };
  const cueEnd = (e: Event) => {
    const cue = cues.get(e);
    if (cue !== undefined) c.grouper.end(cue);
  };
  const onFocus = (e: FocusEvent) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const kind = kindOf(t as HTMLInputElement);
    c.focus(t, kind, kind === "text" ? String((t as HTMLInputElement).value ?? t.textContent ?? "") : "");
  };
  const down = () => c.grouper.pointerDown();
  const up = () => c.grouper.pointerUp();
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("financia:menu", onMenu);
  window.addEventListener("focusin", onFocus, true);
  window.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", up, true);
  window.addEventListener("blur", up);
  for (const t of CUE_EVENTS) {
    window.addEventListener(t, cueStart, true);
    window.addEventListener(t, cueEnd);
  }
  return () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("financia:menu", onMenu);
    window.removeEventListener("focusin", onFocus, true);
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    window.removeEventListener("blur", up);
    for (const t of CUE_EVENTS) {
      window.removeEventListener(t, cueStart, true);
      window.removeEventListener(t, cueEnd);
    }
  };
}

/** 履歴1つをスコープにする（戻した状態は apply で画面に入れる） */
export function historyScope<S>(level: number, get: () => UndoHistory<S> | null, apply: (s: S) => void): UndoScope {
  const step = (kind: "undo" | "redo") => {
    const h = get();
    const r = h === null ? null : kind === "undo" ? h.undo() : h.redo();
    if (r === null) return null;
    apply(r.state);
    return r.label;
  };
  return {
    level,
    undo: () => step("undo"),
    redo: () => step("redo"),
    canUndo: () => get()?.canUndo ?? false,
    canRedo: () => get()?.canRedo ?? false,
    nextUndo: () => get()?.nextUndo ?? null,
    nextRedo: () => get()?.nextRedo ?? null,
  };
}

/** 部品が開いている間だけスコープを足す（最新の中身を使う） */
export function useUndoScope(scope: UndoScope, c: UndoController = undoController): void {
  const ref = useRef(scope);
  ref.current = scope;
  useEffect(
    () =>
      c.push({
        level: scope.level,
        undo: () => ref.current.undo(),
        redo: () => ref.current.redo(),
        canUndo: () => ref.current.canUndo(),
        canRedo: () => ref.current.canRedo(),
        nextUndo: () => ref.current.nextUndo?.() ?? null,
        nextRedo: () => ref.current.nextRedo?.() ?? null,
      }),
    [],
  );
}

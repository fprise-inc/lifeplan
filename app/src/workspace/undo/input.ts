// 元に戻すの「どれを1件にまとめるか」と「文字の欄の元に戻すとアプリの履歴のどちらを使うか」（DOM を直接は見ない部品。テストできるように分ける）

export type ControlKind = "text" | "range" | "choice" | "button" | "other";

/** 文字を打つ input の type（それ以外の input は、つまみ・選ぶもの・ボタン） */
const TEXT_TYPES = new Set(["", "text", "search", "number", "email", "tel", "url", "password"]);

/** 部品の種類（tagName・type・contenteditable だけを見る） */
export function kindOf(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): ControlKind {
  if (el == null || typeof el.tagName !== "string") return "other";
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA") return "text";
  if (tag === "SELECT") return "choice";
  if (tag === "BUTTON") return "button";
  if (tag === "INPUT") {
    const t = (el.type ?? "").toLowerCase();
    if (TEXT_TYPES.has(t)) return "text";
    if (t === "range") return "range";
    if (t === "checkbox" || t === "radio") return "choice";
    if (t === "button" || t === "submit" || t === "reset") return "button";
    return "other";
  }
  return el.isContentEditable === true ? "text" : "other";
}

/** いま処理している操作（画面のイベント1つ） */
export interface Cue {
  type: string;
  target: object;
  kind: ControlKind;
}

/** つまみをキーで動かしたとき、この間（ミリ秒）より短い続けての変更は1件にまとめる */
export const KEY_WINDOW_MS = 1000;

/**
 * どの変更を1件にまとめるか:
 * - ポインタを押している間（つまみのドラッグ）: 押してから離すまでを1件
 * - 文字の欄（数字の欄を含む）: 欄に入ってから出るまでを1件（欄の中の細かい元に戻すは、ブラウザ標準の文字の元に戻すが受け持つ）
 * - つまみをキーで動かしたとき: 同じつまみで短い間の続けての変更を1件
 * - そのほか（ボタン・選ぶもの・取り込みの承認など）: 1回ずつ
 */
export class Grouper {
  private gesture = 0;
  private dragging = false;
  private nextId = 0;
  private readonly ids = new WeakMap<object, number>();
  private nextSession = 0;
  private readonly sessions = new WeakMap<object, number>();
  private cues: Cue[] = [];

  pointerDown(): void {
    this.gesture += 1;
    this.dragging = true;
  }
  pointerUp(): void {
    this.dragging = false;
  }
  /** 部品に入った（文字の欄なら、新しいまとまりを始める） */
  focus(target: object, kind: ControlKind): void {
    if (kind === "text") this.sessions.set(target, ++this.nextSession);
  }
  /** イベントの処理が始まった・終わった（イベントの中で別のイベントが起きることがあるので、重ねて持つ） */
  begin(cue: Cue): void {
    this.cues.push(cue);
  }
  end(cue?: Cue): void {
    if (cue === undefined) this.cues = [];
    else this.cues = this.cues.filter((c) => c !== cue);
  }
  get current(): Cue | null {
    return this.cues.at(-1) ?? null;
  }

  groupFor(): { group: string | null; windowMs?: number } {
    if (this.dragging) return { group: `drag:${this.gesture}` };
    const c = this.current;
    if (c === null) return { group: null };
    if (c.kind === "text") {
      const s = this.sessions.get(c.target);
      return { group: s === undefined ? null : `field:${s}` };
    }
    if (c.kind === "range") return { group: `key:${this.idOf(c.target)}`, windowMs: KEY_WINDOW_MS };
    return { group: null };
  }

  private idOf(o: object): number {
    let id = this.ids.get(o);
    if (id === undefined) {
      id = ++this.nextId;
      this.ids.set(o, id);
    }
    return id;
  }
}

/** フォーカスのある文字の欄の様子: 入ってから中身が変わったか・文字の元に戻すを何回したか（やり直せる回数） */
export interface FieldState {
  changed: boolean;
  nativeUndos: number;
}

/**
 * どちらで戻すか。文字の欄の中に戻せる入力があれば、ブラウザ標準の文字の元に戻す（native）。
 * 欄の外、または欄に入ってから何も変えていなければ、アプリの履歴（app）。片方だけを使うので二重には戻らない
 */
export function routeFor(kind: "undo" | "redo", field: FieldState | null): "native" | "app" {
  if (field === null) return "app";
  if (kind === "undo") return field.changed ? "native" : "app";
  return field.nativeUndos > 0 ? "native" : "app";
}

export interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** キー操作 → 元に戻す・やり直す。macOS は ⌘Z・⌘⇧Z、ほかは Ctrl+Z・Ctrl+Y・Ctrl+Shift+Z */
export function keyAction(e: KeyLike, mac: boolean): "undo" | "redo" | null {
  if (e.altKey) return null;
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return null;
  const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code === "KeyZ" ? "z" : e.code === "KeyY" ? "y" : "";
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (k === "y" && !mac && !e.shiftKey) return "redo";
  return null;
}

/** 知らせの文 */
export function noticeText(kind: "undo" | "redo", label: string | null): string {
  if (label === null) return kind === "undo" ? "元に戻せる操作はありません" : "やり直せる操作はありません";
  return `${kind === "undo" ? "元に戻しました" : "やり直しました"}: ${label}`;
}

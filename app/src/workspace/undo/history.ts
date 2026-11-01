// 元に戻す・やり直すの履歴（作業の層。DOM を見ない部品）。
// 1件は「変える前」と「変えた後」の状態の組。同じまとまり（group）の続けての変更は1件にまとめ、
// まとめた結果が変える前と同じになったら、その1件を消す（文字の欄で打ってから消したときなど）。
// 新しい変更を積むと、やり直しの側は捨てる。上限を超えたら古いものから捨てる

export interface Entry<S> {
  before: S;
  after: S;
  /** 知らせに出す短い名前（例: 対策（退職の年齢）） */
  label: string;
  /** まとめる単位（つまみを動かしている間・文字の欄にいる間など）。null はまとめない */
  group: string | null;
  /** 最後に変えた時刻（ミリ秒） */
  at: number;
  /** 閉じた（もうまとめない） */
  sealed: boolean;
}

export interface RecordInfo {
  label: string;
  group?: string | null;
  /** 時刻（ミリ秒）。既定は Date.now() */
  at?: number;
  /** この時間（ミリ秒）より間が空いたらまとめない。省くと、まとまりが同じ間はずっとまとめる */
  windowMs?: number;
}

export type RecordResult = "same" | "push" | "merge" | "drop";

export const DEFAULT_LIMIT = 200;

export class UndoHistory<S> {
  private done: Entry<S>[] = [];
  private undone: Entry<S>[] = [];
  private readonly limit: number;
  private readonly same: (a: S, b: S) => boolean;

  constructor(opts: { same: (a: S, b: S) => boolean; limit?: number }) {
    this.same = opts.same;
    this.limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }
  /** 元に戻せる件数 */
  get size(): number {
    return this.done.length;
  }
  /** 次に元に戻す1件の名前 */
  get nextUndo(): string | null {
    return this.done.at(-1)?.label ?? null;
  }
  get nextRedo(): string | null {
    return this.undone.at(-1)?.label ?? null;
  }

  /** 変更を1つ積む。中身が変わっていなければ何もしない */
  record(before: S, after: S, info: RecordInfo): RecordResult {
    if (this.same(before, after)) return "same";
    const at = info.at ?? Date.now();
    const group = info.group ?? null;
    this.undone = [];
    const top = this.done.at(-1);
    if (top !== undefined && !top.sealed && group !== null && top.group === group && (info.windowMs === undefined || at - top.at <= info.windowMs)) {
      if (this.same(top.before, after)) {
        this.done.pop();
        return "drop";
      }
      top.after = after;
      top.at = at;
      return "merge";
    }
    this.done.push({ before, after, label: info.label, group, at, sealed: false });
    if (this.done.length > this.limit) this.done.splice(0, this.done.length - this.limit);
    return "push";
  }

  /** いまの1件を閉じる（次の変更は、同じまとまりでも別の1件にする） */
  seal(): void {
    const top = this.done.at(-1);
    if (top !== undefined) top.sealed = true;
  }

  /** 元に戻す: 戻す先の状態（その1件を変える前）と名前 */
  undo(): { state: S; label: string } | null {
    const e = this.done.pop();
    if (e === undefined) return null;
    e.sealed = true;
    this.seal();
    this.undone.push(e);
    return { state: e.before, label: e.label };
  }

  /** やり直す: 進める先の状態（その1件を変えた後）と名前 */
  redo(): { state: S; label: string } | null {
    const e = this.undone.pop();
    if (e === undefined) return null;
    e.sealed = true;
    this.done.push(e);
    return { state: e.after, label: e.label };
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }
}

/** 世帯ごとの履歴。世帯を切り替えても、ほかの世帯の操作は戻さない */
export class HistoryBook<S> {
  private readonly books = new Map<string, UndoHistory<S>>();
  private currentId: string | null = null;
  private readonly make: () => UndoHistory<S>;

  constructor(make: () => UndoHistory<S>) {
    this.make = make;
  }

  /** いま開いている世帯の履歴（世帯を開く前は null） */
  get current(): UndoHistory<S> | null {
    return this.currentId === null ? null : (this.books.get(this.currentId) ?? null);
  }
  get id(): string | null {
    return this.currentId;
  }

  /** 世帯を切り替える。その世帯の履歴が残っていれば続きから使う */
  select(id: string): UndoHistory<S> {
    this.currentId = id;
    let h = this.books.get(id);
    if (h === undefined) {
      h = this.make();
      this.books.set(id, h);
    }
    return h;
  }

  /** その世帯に、戻せる・やり直せる履歴があるか（開き直して空にする前に、捨てる履歴があるかを見る） */
  has(id: string): boolean {
    const h = this.books.get(id);
    return h !== undefined && (h.canUndo || h.canRedo);
  }

  /** 世帯を開き直した（中身を読み直した）: その世帯の履歴を空にして切り替える */
  reset(id: string): UndoHistory<S> {
    this.books.delete(id);
    return this.select(id);
  }

  /** いまの世帯の履歴を、別の世帯の名前で持ち直す（開いている世帯を新しい世帯として保存した。中身は同じなので続きから使う） */
  rename(to: string): void {
    const from = this.currentId;
    if (from === null || from === to) return;
    const h = this.books.get(from);
    this.books.delete(from);
    if (h !== undefined) this.books.set(to, h);
    else this.books.delete(to);
    this.currentId = to;
  }

  /** 世帯を閉じた・消した: 履歴を捨てる */
  drop(id: string): void {
    this.books.delete(id);
    if (this.currentId === id) this.currentId = null;
  }
}

/** 中身が同じか（JSON にできる値。同じ参照ならすぐ同じとする。変えていない枝は参照が同じなので速い） */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!Object.hasOwn(bo, k) || !deepEqual(ao[k], bo[k])) return false;
  return true;
}

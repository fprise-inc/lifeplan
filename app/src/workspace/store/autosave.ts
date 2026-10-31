// 自動保存（変更から少し待って、まとめて保存する）。本文の文字列が前に保存したものと同じなら保存しない。
// 保存は1つずつ（保存中に変わったら、終わってからもう一度）。世帯を切り替える・アプリを閉じるときは saveBeforeLeave で待たずに保存し、
// 保存できなかったら黙って捨てずに、保存し直す・捨てる・やめるを選ばせる
export type SaveState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; code: string };

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** 変更から保存までの待ち（ミリ秒） */
export const AUTOSAVE_MS = 1500;

/** 保存を続けても直らない失敗（自動保存を止める）: 分岐・閲覧だけ・開いていない・鍵が無い */
const STOP_CODES = new Set(["E_STORE_CONFLICT", "E_STORE_READ_ONLY", "E_STORE_NOT_OPEN", "E_STORE_NO_KEY", "E_STORE_UNKNOWN_HOUSEHOLD", "E_STORE_NEEDS_RECOVERY"]);

export class Autosaver {
  private saved: string | null = null;
  private latest: string | null = null;
  private timer: unknown = null;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  /** 最後の保存の失敗（保存できたら・開き直したら null） */
  private failed: string | null = null;

  private readonly save: (body: string) => Promise<string>;
  private readonly onState: (s: SaveState) => void;
  private readonly delay: number;
  private readonly timers: Timers;

  /** save は保存した日時（ISO 8601）を返す */
  constructor(save: (body: string) => Promise<string>, onState: (s: SaveState) => void, delay = AUTOSAVE_MS, timers: Timers = realTimers) {
    this.save = save;
    this.onState = onState;
    this.delay = delay;
    this.timers = timers;
  }

  /** 開いた・作った直後: この本文を「保存済み」とする（待っている保存は捨てる） */
  reset(savedBody: string | null, at?: string): void {
    this.cancel();
    this.saved = savedBody;
    this.latest = savedBody;
    this.stopped = savedBody === null;
    this.failed = null;
    this.onState(at !== undefined ? { kind: "saved", at } : { kind: "idle" });
  }

  /** 今の本文（変わっていれば、少し待って保存する） */
  change(body: string): void {
    if (this.stopped || this.saved === null) return;
    this.latest = body;
    if (body === this.saved) {
      if (this.timer !== null) {
        this.cancel();
        this.onState({ kind: "idle" });
      }
      return;
    }
    this.cancel();
    this.onState({ kind: "pending" });
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.run();
    }, this.delay);
  }

  /** 待たずに保存する（保存すべきものが無ければ何もしない） */
  async flush(): Promise<void> {
    this.cancel();
    await this.run();
  }

  get dirty(): boolean {
    return !this.stopped && this.latest !== null && this.latest !== this.saved;
  }

  /** 保存できていない変更がある（保存に失敗して自動保存を止めた後も。保存しない世帯では無い） */
  get unsaved(): boolean {
    return this.saved !== null && this.latest !== null && this.latest !== this.saved;
  }

  /** 最後の保存の失敗の符号（失敗していなければ null） */
  get failure(): string | null {
    return this.failed;
  }

  /** 失敗の後に、もう一度保存する（直らない失敗で自動保存を止めた後も1回試す）。body を渡せば、それを今の本文にする */
  async retry(body?: string): Promise<void> {
    if (this.saved === null) return;
    this.stopped = false;
    if (body !== undefined) this.latest = body;
    await this.flush();
  }

  private cancel(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  /** 保存は1つずつ順に（前の保存が終わってから次を始める） */
  private run(): Promise<void> {
    this.chain = this.chain.then(() => this.runOnce());
    return this.chain;
  }

  private async runOnce(): Promise<void> {
    if (this.stopped || this.latest === null || this.latest === this.saved) return;
    const body = this.latest;
    this.onState({ kind: "saving" });
    try {
      const at = await this.save(body);
      this.saved = body;
      this.failed = null;
      this.onState(this.latest === body ? { kind: "saved", at } : { kind: "pending" });
      // 保存中にまた変わった
      if (this.latest !== this.saved && this.timer === null) this.change(this.latest);
    } catch (e) {
      // 失敗したときは、次の変更か flush まで待つ
      const code = typeof e === "string" ? e : e instanceof Error ? e.message : "E_STORE";
      if (STOP_CODES.has(code)) this.stopped = true;
      this.failed = code;
      this.onState({ kind: "error", code });
    }
  }
}

/** 世帯を離れる前に聞いたときの答え: 保存し直す・変更を捨てて離れる・離れるのをやめる */
export type LeaveChoice = "retry" | "discard" | "cancel";

/**
 * 世帯を切り替える・アプリを閉じる前: 残りを待たずに保存する。保存できなかったら ask で選ばせる（失敗の符号を渡す）。
 * 離れてよければ true。current は今の画面の本文（保存し直すときに使う。自動保存を止めた後の変更も入れるため）
 */
export async function saveBeforeLeave(a: Autosaver | null, ask: (code: string) => Promise<LeaveChoice>, current?: () => string | null): Promise<boolean> {
  if (a === null) return true;
  await a.flush();
  // 保存の途中で変わったとき（失敗ではない）は、もう一度だけ保存する
  if (a.unsaved && a.failure === null) await a.flush();
  while (a.unsaved) {
    const c = await ask(a.failure ?? "E_STORE");
    if (c === "cancel") return false;
    if (c === "discard") return true;
    await a.retry(current?.() ?? undefined);
  }
  return true;
}

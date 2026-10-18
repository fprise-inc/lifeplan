// 自動保存（変更から少し待って、まとめて保存する）。本文の文字列が前に保存したものと同じなら保存しない。
// 保存は1つずつ（保存中に変わったら、終わってからもう一度）。世帯を切り替える・アプリを閉じるときは flush で待たずに保存する
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
      this.onState(this.latest === body ? { kind: "saved", at } : { kind: "pending" });
      // 保存中にまた変わった
      if (this.latest !== this.saved && this.timer === null) this.change(this.latest);
    } catch (e) {
      // 失敗したときは、次の変更か flush まで待つ
      const code = typeof e === "string" ? e : e instanceof Error ? e.message : "E_STORE";
      if (STOP_CODES.has(code)) this.stopped = true;
      this.onState({ kind: "error", code });
    }
  }
}

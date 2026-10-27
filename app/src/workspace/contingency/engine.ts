// 万一のときの計算（作業の層）: アプリの側（App）が1つだけ持ち、タブを切り替えても結果を捨てない。
// - グラフの枠（万一なし・必要保障額の推移・選んだ想定）: 見通しと同じ二本立て（DualEngine）。画面の側のエンジンで先に出し、本体の正の計算で置き換える。
//   同じ要求の枠は計算し直さないので、タブを開き直しても前の結果がすぐ出る
// - 年ごとの結果の帯（YearSweep）: 選べる年すべてについて「その年に起きたら資産が最後まで足りるか」を裏で計算する。
//   1年分は一生分の計算なので、画面の側のエンジンでも1年あたり数十ミリ秒かかる（スライダーの先出しの数ミリ秒とは違う）。
//   そこで画面の側の先出しは、選んでいる年の近くの数年だけを1年ずつ間をあけて計算し（画面を止めない）、
//   全部の年は本体の正の計算（画面とは別のスレッドで、並べて計算する）で出して確かめ、先出しを差し替える。
//   覚えるのは年ごとの要約（資産が尽きる年）だけで、表そのものは持たない。要求の中身（の指紋）ごとに覚えるので、同じ内容なら計算しない。
//   見るプランを切り替えると要求の中身が変わるので、プランごとに別に覚える（要約の決め方は、計算を始めたときの帯のものを使う）
import { DualEngine } from "../../engine/dual.ts";
import type { HostApi, WebEngine, WebSession } from "../../engine/host.ts";
import { forEngine } from "../../engine/moneyRows.ts";
import { isEngineError, type EngineError, type EngineRequest, type PreviewResult } from "../../engine/types.ts";

/** 要求の文字列の指紋（覚えておく鍵。文字列そのものは持たない） */
export function fingerprint(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b1 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}.${text.length.toString(36)}`;
}

/** 1つの年の結果（要約）。source は先出し（画面の側）か正の計算（本体）か */
export type YearOutcome = { state: "ready"; depletion: number | null; source: "preview" | "canonical" } | { state: "error"; code: string } | { state: "pending" };

export interface SweepEntry {
  year: number;
  request: EngineRequest;
}

interface Prepared {
  year: number;
  text: string;
  key: string;
}

export interface SweepOptions {
  host: HostApi;
  session: WebSession | null;
  onChange: () => void;
  /** 先出しを1回に何年ずつ計算するか（画面を止めない長さ。1年あたり数十ミリ秒） */
  previewChunk?: number;
  /** 先出しをする年の数（選んでいる年に近い順。残りの年は本体の正の計算だけで出す） */
  previewWindow?: number;
  /** 先出しの1回と次の1回の間（ミリ秒。その間に画面が動く） */
  previewGap?: number;
  /** 本体に1回で送る年の数（本体は並べて計算する） */
  canonicalChunk?: number;
  /** 覚えておく要約の数の上限 */
  limit?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

/** 年ごとの帯を計算する順番（YearSweep.want の説明のとおり） */
export function sweepOrder<T extends { year: number }>(list: readonly T[], focus: number | null): T[] {
  if (focus === null) return [...list];
  const first = list.reduce((m, x) => Math.min(m, x.year), Number.POSITIVE_INFINITY);
  const rank = (y: number) => (Math.abs(y - focus) <= 2 ? 0 : (y - first) % 5 === 0 ? 1 : 2);
  return [...list].sort((a, b) => rank(a.year) - rank(b.year) || Math.abs(a.year - focus) - Math.abs(b.year - focus) || a.year - b.year);
}

/** 年ごとの結果の帯の計算 */
export class YearSweep {
  private readonly cache = new Map<string, YearOutcome>();
  private current: Prepared[] = [];
  private summarize: (r: PreviewResult) => number | null = () => null;
  private previewRunning = false;
  private canonRunning = false;
  private readonly opts: Required<Omit<SweepOptions, "session">> & { session: WebSession | null };
  /** 先出しと正の計算で、資産が尽きる年が食い違った数（顧客の数字は残さない） */
  mismatches = 0;
  /** 計算の時間（先出しは1年あたり、正の計算は1回あたり。ミリ秒） */
  readonly timings: { kind: "preview" | "canonical"; ms: number; years: number }[] = [];

  constructor(opts: SweepOptions) {
    this.opts = { previewChunk: 1, previewWindow: 6, previewGap: 40, canonicalChunk: opts.host.kind === "tauri" ? 8 : 2, limit: 3000, setTimer: (fn, ms) => setTimeout(fn, ms), ...opts };
  }

  /** 年ごとの要求に指紋を付ける（描くたびに作り直さないよう、呼ぶ側で覚えておく） */
  static prepare(entries: readonly SweepEntry[]): Prepared[] {
    return entries.map((e) => {
      const text = JSON.stringify(forEngine(e.request));
      return { year: e.year, text, key: fingerprint(text) };
    });
  }

  outcome(key: string): YearOutcome {
    return this.cache.get(key) ?? { state: "pending" };
  }

  /**
   * 帯に出す年を置き直し、まだの年を裏で計算する。順番は、focus の年の前後（2年まで）→ 最初の年から5年ごと → 残りの年（それぞれ focus に
   * 近い順。0071: 起きる年を表の最後の年まで広げたので、先に要る年から埋めて帯の全体の形を早く見せる）
   */
  want(list: readonly Prepared[], summarize: (r: PreviewResult) => number | null, focus: number | null = null): void {
    this.summarize = summarize;
    this.current = sweepOrder(list, focus);
    this.kick();
  }

  /** 計算をやめる（帯を出さなくなったとき）。覚えた要約は残す */
  stop(): void {
    this.current = [];
  }

  /** ほかの計算（グラフの枠）で同じ要求の結果が出たときに、要約を覚える */
  record(text: string, result: PreviewResult | EngineError, source: "preview" | "canonical"): void {
    this.put(fingerprint(text), result, source);
  }

  /** 正の計算まで終わっているか（帯の年すべて） */
  settled(): boolean {
    return this.current.every((p) => {
      const o = this.cache.get(p.key);
      return o !== undefined && (o.state === "error" || (o.state === "ready" && o.source === "canonical"));
    });
  }

  private put(key: string, result: PreviewResult | EngineError | undefined, source: "preview" | "canonical", summarize: (r: PreviewResult) => number | null = this.summarize): void {
    const prev = this.cache.get(key);
    if (source === "preview" && prev !== undefined && prev.state !== "pending") return;
    let next: YearOutcome;
    if (result === undefined) next = { state: "error", code: "E_HOST" };
    else if (isEngineError(result)) next = { state: "error", code: result.error.code };
    else next = { state: "ready", depletion: summarize(result), source };
    if (source === "canonical" && prev?.state === "ready" && prev.source === "preview" && next.state === "ready" && prev.depletion !== next.depletion) this.mismatches++;
    this.cache.delete(key);
    this.cache.set(key, next);
    while (this.cache.size > this.opts.limit) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private kick(): void {
    if (!this.previewRunning && this.opts.session !== null) {
      this.previewRunning = true;
      this.opts.setTimer(() => this.previewStep(), 0);
    }
    if (!this.canonRunning) {
      this.canonRunning = true;
      void this.canonLoop();
    }
  }

  /** 先出し: 選んでいる年に近い数年を1年ずつ計算して画面に返し、次の1年は少し後に（その間に画面が動く） */
  private previewStep(): void {
    const session = this.opts.session;
    const todo = this.current
      .slice(0, this.opts.previewWindow)
      .filter((p) => !this.cache.has(p.key))
      .slice(0, this.opts.previewChunk);
    if (session === null || todo.length === 0) {
      this.previewRunning = false;
      return;
    }
    const t0 = performance.now();
    const slots = todo.map((p, i) => `${JSON.stringify(`y${i}`)}:${p.text}`);
    session.set(`{${slots.join(",")}}`);
    const out = JSON.parse(session.compute(JSON.stringify(todo.map((_, i) => `y${i}`)), '{"preview":true}')) as Record<string, { result: PreviewResult | EngineError }> | EngineError;
    todo.forEach((p, i) => this.put(p.key, isEngineError(out) ? out : out[`y${i}`]?.result, "preview"));
    this.timings.push({ kind: "preview", ms: (performance.now() - t0) / todo.length, years: todo.length });
    if (this.timings.length > 200) this.timings.shift();
    this.opts.onChange();
    this.opts.setTimer(() => this.previewStep(), this.opts.previewGap);
  }

  /** 正の計算: まだ確かめていない年を、本体にまとめて送る（本体は並べて計算する）。帯が変わったら新しい帯の年から */
  private async canonLoop(): Promise<void> {
    try {
      for (;;) {
        // 1回ごとに画面に順番を返す（本体の計算を待つ間も先出しと画面が動くように。開発用のサーバーでは同じスレッドで計算するため）
        await new Promise<void>((r) => this.opts.setTimer(r, 0));
        const todo = this.current
          .filter((p) => {
            const o = this.cache.get(p.key);
            return o === undefined || o.state === "pending" || (o.state === "ready" && o.source === "preview");
          })
          .slice(0, this.opts.canonicalChunk);
        if (todo.length === 0) return;
        const t0 = performance.now();
        // 計算している間に帯（見るプラン）が変わっても、送ったときの要約の決め方で覚える
        const summarize = this.summarize;
        try {
          const res = await this.opts.host.compute(todo.map((p, i) => ({ id: `y${i}`, rev: 1, request: p.text })));
          todo.forEach((p, i) => this.put(p.key, res.slots[`y${i}`]?.result, "canonical", summarize));
        } catch (e) {
          for (const p of todo) this.cache.set(p.key, { state: "error", code: typeof e === "string" ? e : "E_HOST" });
        }
        this.timings.push({ kind: "canonical", ms: performance.now() - t0, years: todo.length });
        if (this.timings.length > 200) this.timings.shift();
        this.opts.onChange();
      }
    } finally {
      this.canonRunning = false;
    }
  }
}

/** 万一のときの計算の入れ物（App が1つ持つ）。画面（ContingencyTab）は開いている間だけ知らせを受ける */
export class ContingencyEngine {
  readonly chart: DualEngine;
  readonly sweep: YearSweep;
  private readonly listeners = new Set<() => void>();
  /** 必要保障額の推移が出るまでの時間（開いてから。DEV の表示と自己確認） */
  readonly openings: { ms: number; cached: boolean }[] = [];

  constructor(opts: { host: HostApi; web: WebEngine | null; packs: string | null }) {
    const session = (): WebSession | null => {
      if (opts.web === null || opts.packs === null) return null;
      const s = opts.web.createSession(opts.packs);
      return s.status().startsWith('{"error"') ? null : s;
    };
    const emit = () => {
      for (const fn of this.listeners) fn();
    };
    // グラフの枠と年ごとの帯は、画面の側のエンジンのセッションを分ける（片方の計算がもう片方の枠を計算し直さないように）
    this.chart = new DualEngine({ session: session(), host: opts.host, onChange: emit });
    this.sweep = new YearSweep({ host: opts.host, session: session(), onChange: emit });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

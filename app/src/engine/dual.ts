// 二本立て（0005 の5・追記 2026-10-09）:
// - スライダーを動かしている間は、画面側のエンジン（WebView）で、見ている枠だけを先に出す（session.slide）
// - 操作が止まったら（最後の入力から150ミリ秒、または指を離したとき）、ほかの枠を先出しで計算し直し（session.release）、
//   本体の quickjs-ng で正の計算をして置き換える（host.compute）
// - 画面側の結果は保存・PDF・控えに渡さない（この部品は表示のための結果だけを持つ）
// - 画面側と本体の結果が食い違ったら本体の結果を表示し、食い違いの数を数える（顧客の数字は残さない）
import type { HostApi, WebSession } from "./host.ts";
import { forEngine } from "./moneyRows.ts";
import { isEngineError, type EngineError, type EngineRequest, type PreviewResult } from "./types.ts";

export type ResultSource = "preview" | "canonical";

export interface SlotView {
  /** 表示する結果（無ければ null） */
  result: PreviewResult | null;
  /** エラーの符号（エンジン・ホストのエラー。値は含まない） */
  error: string | null;
  /** 結果の出どころ: 先出し（確定前）か正の計算か */
  source: ResultSource | null;
  /** 要求が変わって、正の計算がまだ終わっていない */
  stale: boolean;
}

export interface Timing {
  kind: "preview" | "release" | "canonical";
  /** 画面から見た時間（ミリ秒） */
  ms: number;
  /** 本体の中の時間（canonical だけ） */
  hostMs?: number;
}

interface Slot {
  request: string;
  rev: number;
  result: PreviewResult | null;
  resultRev: number;
  source: ResultSource | null;
  error: string | null;
  /** 先出しの表（正の計算と比べるため。rev ごと） */
  previewTable: { rev: number; table: string } | null;
}

export interface DualOptions {
  session: WebSession | null;
  host: HostApi;
  onChange: () => void;
  /** 最後の入力から正の計算までの待ち（0005 の5 の目安 150ミリ秒） */
  idleMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const MAX_TIMINGS = 200;

export class DualEngine {
  private readonly slots = new Map<string, Slot>();
  private readonly opts: Required<Omit<DualOptions, "session">> & { session: WebSession | null };
  private timer: unknown = null;
  private inflight: Promise<void> | null = null;
  readonly timings: Timing[] = [];
  mismatches = 0;

  constructor(opts: DualOptions) {
    this.opts = {
      idleMs: 150,
      now: () => performance.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...opts,
    };
  }

  view(id: string): SlotView {
    const s = this.slots.get(id);
    if (s === undefined) return { result: null, error: null, source: null, stale: false };
    return { result: s.result, error: s.error, source: s.source, stale: s.resultRev !== s.rev || s.source !== "canonical" };
  }

  /** すべての枠が正の計算の結果になっているか */
  settled(): boolean {
    return [...this.slots.values()].every((s) => s.source === "canonical" && s.resultRev === s.rev) && this.inflight === null;
  }

  private record(t: Timing): void {
    this.timings.push(t);
    if (this.timings.length > MAX_TIMINGS) this.timings.shift();
  }

  /** 枠の要求を置く（変わった枠だけ番号が進む）。変わった枠の名前を返す */
  private put(requests: Record<string, EngineRequest>): string[] {
    const changed: string[] = [];
    for (const [id, req] of Object.entries(requests)) {
      // 基本の計算に入れない物（不確かな受け取る相続・贈与など）は、エンジンへ渡す要求から外す（0044）
      const text = JSON.stringify(forEngine(req));
      const s = this.slots.get(id);
      if (s === undefined) {
        this.slots.set(id, { request: text, rev: 1, result: null, resultRev: 0, source: null, error: null, previewTable: null });
        changed.push(id);
      } else if (s.request !== text) {
        s.request = text;
        s.rev++;
        changed.push(id);
      }
    }
    return changed;
  }

  private applyPreview(id: string, out: unknown): void {
    const s = this.slots.get(id);
    if (s === undefined) return;
    if (isEngineError(out)) {
      s.error = out.error.code;
      return;
    }
    const r = out as PreviewResult;
    s.result = r;
    s.resultRev = s.rev;
    s.source = "preview";
    s.error = null;
    s.previewTable = { rev: s.rev, table: JSON.stringify(r.table) };
  }

  /** 今ある枠の名前 */
  ids(): string[] {
    return [...this.slots.keys()];
  }

  /** 使わなくなった枠を消す（主画面の帯から外した案。画面側のエンジンの枠も消す）。消した枠の名前を返す */
  retain(ids: readonly string[]): string[] {
    const keep = new Set(ids);
    const gone = [...this.slots.keys()].filter((id) => !keep.has(id));
    if (gone.length === 0) return gone;
    for (const id of gone) this.slots.delete(id);
    this.opts.session?.set(`{${gone.map((id) => `${JSON.stringify(id)}:null`).join(",")}}`);
    return gone;
  }

  /** 世帯を開いたとき・リセットのとき: すべての枠を先出しで出し、すぐ正の計算をする */
  async set(requests: Record<string, EngineRequest>): Promise<void> {
    const changed = this.put(requests);
    const session = this.opts.session;
    if (session !== null && changed.length > 0) {
      const t = this.opts.now();
      const slotsJson = `{${changed.map((id) => `${JSON.stringify(id)}:${(this.slots.get(id) as Slot).request}`).join(",")}}`;
      session.set(slotsJson);
      const out = JSON.parse(session.compute(JSON.stringify(changed), '{"preview":true}')) as Record<string, { result: unknown }> | EngineError;
      this.record({ kind: "release", ms: this.opts.now() - t });
      if (isEngineError(out)) for (const id of changed) (this.slots.get(id) as Slot).error = out.error.code;
      else for (const id of changed) this.applyPreview(id, out[id]?.result);
      this.opts.onChange();
    }
    await this.release();
  }

  /** スライダーの1刻み: 枠を置き直し、見ている1枠だけを先に出す。正の計算は操作が止まってから */
  slide(focusId: string, requests: Record<string, EngineRequest>): void {
    const changed = this.put(requests);
    if (changed.length === 0) return;
    const session = this.opts.session;
    if (session !== null) {
      const t = this.opts.now();
      const slotsJson = `{${changed.map((id) => `${JSON.stringify(id)}:${(this.slots.get(id) as Slot).request}`).join(",")}}`;
      const out = JSON.parse(session.slide(slotsJson, focusId)) as { focus: Record<string, { result: unknown }> } | EngineError;
      this.record({ kind: "preview", ms: this.opts.now() - t });
      if (isEngineError(out)) (this.slots.get(focusId) as Slot).error = out.error.code;
      else this.applyPreview(focusId, out.focus[focusId]?.result);
    }
    this.opts.onChange();
    if (this.timer !== null) this.opts.clearTimer(this.timer);
    this.timer = this.opts.setTimer(() => {
      this.timer = null;
      void this.release();
    }, this.opts.idleMs);
  }

  /** 指を離した直後: ほかの枠を先出しで計算し直し、変わった枠を本体で正の計算する */
  async release(): Promise<void> {
    if (this.timer !== null) {
      this.opts.clearTimer(this.timer);
      this.timer = null;
    }
    // 前の正の計算が終わるのを待ってから（本体には最新の要求だけを送る）
    while (this.inflight !== null) await this.inflight;
    const session = this.opts.session;
    const stalePreview = [...this.slots.entries()].filter(([, s]) => s.resultRev !== s.rev).map(([id]) => id);
    if (session !== null && stalePreview.length > 0) {
      const t = this.opts.now();
      const out = JSON.parse(session.release('{"preview":true}')) as Record<string, { result: unknown }> | EngineError;
      this.record({ kind: "release", ms: this.opts.now() - t });
      if (!isEngineError(out)) for (const id of stalePreview) if (out[id] !== undefined) this.applyPreview(id, out[id].result);
      this.opts.onChange();
    }
    const todo = [...this.slots.entries()].filter(([, s]) => !(s.source === "canonical" && s.resultRev === s.rev));
    if (todo.length === 0) return;
    const sent = todo.map(([id, s]) => ({ id, rev: s.rev, request: s.request }));
    const t = this.opts.now();
    const run = (async () => {
      try {
        const res = await this.opts.host.compute(sent);
        this.record({ kind: "canonical", ms: this.opts.now() - t, hostMs: res.ms });
        for (const { id, rev } of sent) {
          const s = this.slots.get(id);
          const r = res.slots[id];
          // 計算している間に要求が変わった枠は捨てる（次の正の計算を待つ）
          if (s === undefined || r === undefined || s.rev !== rev || r.rev !== rev) continue;
          if (isEngineError(r.result)) {
            s.error = r.result.error.code;
            continue;
          }
          if (s.previewTable !== null && s.previewTable.rev === rev && s.previewTable.table !== JSON.stringify(r.result.table)) {
            this.mismatches++;
            if (import.meta.env?.DEV) console.warn("画面側と本体の結果が食い違いました", { slot: id, engine: r.result.header.engine.version });
          }
          s.result = r.result;
          s.resultRev = rev;
          s.source = "canonical";
          s.error = null;
        }
      } catch (e) {
        for (const { id } of sent) {
          const s = this.slots.get(id);
          if (s !== undefined) s.error = typeof e === "string" ? e : "E_HOST";
        }
      } finally {
        this.inflight = null;
      }
    })();
    this.inflight = run;
    await run;
    this.opts.onChange();
    // 待っている間にまた変わっていたら、続けて計算する（ただし次の操作のタイマーに任せる）
    if (this.timer === null && [...this.slots.values()].some((s) => s.resultRev !== s.rev || s.source !== "canonical") && sent.every(({ id, rev }) => this.slots.get(id)?.rev === rev) === false) {
      await this.release();
    }
  }
}

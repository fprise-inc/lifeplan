// 本体の計算の時間切れ（E_HOST_TIMEOUT。パソコンの負荷が高いとき）: 時間切れの枠だけを頼み直す・画面の文は入力のせいと書かない・
// もう一度計算すると時間切れの枠だけを計算し直す（0180 の2）
import { describe, expect, it } from "vitest";
import { DualEngine } from "../src/engine/dual.ts";
import type { ComputeResponse, HostApi, SlotRequest } from "../src/engine/host.ts";
import { retryTimedOut } from "../src/engine/retry.ts";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { engineErrorText, HOST_BUSY_TEXT, isHostBusy } from "../src/workspace/engineErrors.ts";
import { reportErrorText } from "../src/workspace/report/ReportTab.tsx";

const req = (n: number): EngineRequest => ({ trace: "none", input: { baseMonth: "2026-10", endYear: 2027, household: { members: [] }, n } }) as unknown as EngineRequest;
const result = (tag: number): PreviewResult => ({ header: { engine: { version: "t", sourceDigest: "x" }, baseMonth: "2026-10", endYear: 2027 }, table: [{ row: "cf.net", year: 2027, amount: tag }], summary: {} }) as unknown as PreviewResult;
const TIMEOUT = { error: { code: "E_HOST_TIMEOUT", ids: [] } };

/** 枠ごとに、決まった回数だけ時間切れを返す本体の代わり */
function busyHost(timeouts: Record<string, number>) {
  const calls: string[][] = [];
  const left = { ...timeouts };
  const compute = async (slots: SlotRequest[]): Promise<ComputeResponse> => {
    calls.push(slots.map((s) => s.id));
    const out: ComputeResponse["slots"] = {};
    for (const s of slots) {
      const n = left[s.id] ?? 0;
      if (n > 0) left[s.id] = n - 1;
      const v = (JSON.parse(s.request) as { input: { n: number } }).input.n;
      out[s.id] = { rev: s.rev, ms: 100, result: (n > 0 ? TIMEOUT : result(v)) as PreviewResult };
    }
    return { ms: 100, slots: out };
  };
  return { calls, compute };
}

const slot = (id: string, n: number): SlotRequest => ({ id, rev: 1, request: JSON.stringify(req(n)) });

describe("本体の計算の時間切れ: 頼み直し", () => {
  it("時間切れの枠だけを、待ってから頼み直し、結果を重ねる", async () => {
    const h = busyHost({ b: 1 });
    const waits: number[] = [];
    const compute = retryTimedOut(h.compute, { sleep: async (ms) => void waits.push(ms) });
    const res = await compute([slot("a", 1), slot("b", 2), slot("c", 3)]);
    expect(h.calls).toEqual([["a", "b", "c"], ["b"]]);
    expect(waits).toEqual([1000]);
    expect((res.slots.b?.result as PreviewResult).table[0]?.amount).toBe(2);
    expect(res.ms).toBe(200);
  });

  it("頼み直しは2回まで。それでも時間切れなら時間切れのまま返す。ほかのエラーは頼み直さない", async () => {
    const h = busyHost({ b: 5 });
    const compute = retryTimedOut(h.compute, { sleep: async () => undefined });
    const res = await compute([slot("a", 1), slot("b", 2)]);
    expect(h.calls).toEqual([["a", "b"], ["b"], ["b"]]);
    expect(res.slots.b?.result).toEqual(TIMEOUT);

    const calls: number[] = [];
    const other = retryTimedOut(
      async (slots) => (calls.push(slots.length), { ms: 1, slots: Object.fromEntries(slots.map((s) => [s.id, { rev: 1, ms: 1, result: { error: { code: "E_PARAM_NO_VALUE", ids: [] } } as unknown as PreviewResult }])) }),
      { sleep: async () => undefined },
    );
    await other([slot("a", 1)]);
    expect(calls).toEqual([1]);
  });
});

function fakeSession() {
  const slots = new Map<string, number>();
  const out = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { result: result(slots.get(id) as number) }]));
  return {
    set(j: string) {
      for (const [k, v] of Object.entries(JSON.parse(j) as Record<string, { input: { n: number } }>)) slots.set(k, v.input.n);
      return "{}";
    },
    compute: (ids?: string) => JSON.stringify(out(ids !== undefined ? (JSON.parse(ids) as string[]) : [...slots.keys()])),
    results: () => "{}",
    status: () => "{}",
    slide(j: string, focus: string) {
      this.set(j);
      return JSON.stringify({ focus: out([focus]), status: {} });
    },
    release: () => JSON.stringify(out([...slots.keys()])),
  };
}

describe("本体の計算の時間切れ: 画面", () => {
  it("頼み直しても時間切れの枠は「もう一度計算する」（release）で、その枠だけを計算し直し、正の計算に置き換わる", async () => {
    // 本体の代わり: proposal の枠は3回続けて時間切れ（最初と頼み直しの2回）、4回目で通る
    const h = busyHost({ proposal: 3 });
    const host = { kind: "browser-dev", compute: retryTimedOut(h.compute, { sleep: async () => undefined }) } as unknown as HostApi;
    const d = new DualEngine({ session: fakeSession(), host, onChange: () => undefined, setTimer: () => 0, clearTimer: () => undefined });
    await d.set({ current: req(1), proposal: req(2) });
    expect(d.view("current").source).toBe("canonical");
    const v = d.view("proposal");
    expect(v.error).toBe("E_HOST_TIMEOUT");
    expect(isHostBusy(v.error)).toBe(true);
    expect(v.result?.table[0]?.amount).toBe(2);
    // 「もう一度計算する」
    await d.release();
    expect(h.calls.at(-1)).toEqual(["proposal"]);
    const after = d.view("proposal");
    expect(after.error).toBeNull();
    expect(after.source).toBe("canonical");
    expect(after.stale).toBe(false);
  });

  it("文は入力のせいと書かない（符号だけにしない）。提案書の文も同じ", () => {
    const t = engineErrorText("E_HOST_TIMEOUT", [], "2026-10");
    expect(t).toContain("パソコンの負荷");
    expect(t).not.toBe("（E_HOST_TIMEOUT）");
    expect(HOST_BUSY_TEXT).not.toContain("今の入力");
    expect(reportErrorText("E_HOST_TIMEOUT")).toContain("パソコンの負荷");
    expect(engineErrorText("E_HOST_MEMORY", [], "2026-10")).toContain("メモリー");
  });
});

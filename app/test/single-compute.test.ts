// 1件だけの正の計算を同時に頼んだとき（取り崩しの計算・前回の控え）: 画面が止まらない・二重に計算しない・失敗で止まらない
import { afterEach, describe, expect, it, vi } from "vitest";
import { devBrowserHost, singleCompute, type ComputeResponse, type SlotRequest } from "../src/engine/host.ts";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { modelHousehold, realEngine } from "./helpers.ts";

const req = (n: number): EngineRequest => ({ trace: "none", input: { baseMonth: "2026-10", endYear: 2027, household: { members: [] }, n } });
const result = (tag: number): PreviewResult => ({ header: { engine: { version: "t", sourceDigest: "x" }, baseMonth: "2026-10", endYear: 2027 }, table: [{ row: "cf.net", year: 2027, amount: tag }], summary: {} });
const nOf = (s: SlotRequest) => (JSON.parse(s.request) as { input: { n: number } }).input.n;

/** 本体の代わり: 要求の n をそのまま結果にする。終わらせるのはテストが決める */
function fakeHost() {
  const calls: number[] = [];
  const pending: { n: number; resolve: (r: ComputeResponse) => void; reject: (e: unknown) => void }[] = [];
  let running = 0;
  let maxRunning = 0;
  return {
    calls,
    pending,
    get maxRunning() {
      return maxRunning;
    },
    compute: (slots: SlotRequest[]) =>
      new Promise<ComputeResponse>((resolve, reject) => {
        const n = nOf(slots[0] as SlotRequest);
        calls.push(n);
        maxRunning = Math.max(maxRunning, ++running);
        const done = <T,>(f: (v: T) => void) => (v: T) => {
          running--;
          f(v);
        };
        pending.push({ n, resolve: done(resolve), reject: done(reject) });
      }),
    /** いちばん古い計算を終わらせる */
    finish(error?: string) {
      const p = pending.shift();
      if (p === undefined) throw new Error("計算がありません");
      if (error !== undefined) p.reject(error);
      else p.resolve({ ms: 1, slots: { calc: { rev: 1, ms: 1, result: result(p.n) } } });
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("singleCompute", () => {
  it("同じ要求を同時に2つ頼むと、計算は1回で、両方に同じ結果を返す", async () => {
    const host = fakeHost();
    const one = singleCompute(host);
    const a = one(req(1));
    const b = one(req(1));
    await settle();
    expect(host.calls).toEqual([1]);
    host.finish();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra?.table).toEqual(result(1).table);
    expect(rb).toBe(ra);
  });

  it("違う要求を同時に頼むと、1つずつ順に計算し、それぞれの結果を返す", async () => {
    const host = fakeHost();
    const one = singleCompute(host);
    const a = one(req(1));
    const b = one(req(2));
    await settle();
    expect(host.calls).toEqual([1]);
    host.finish();
    await settle();
    expect(host.calls).toEqual([1, 2]);
    host.finish();
    expect((await a)?.table[0]?.amount).toBe(1);
    expect((await b)?.table[0]?.amount).toBe(2);
    expect(host.maxRunning).toBe(1);
  });

  it("計算が終わったあとに同じ要求を頼むと、計算し直す（前の結果を使い回さない）", async () => {
    const host = fakeHost();
    const one = singleCompute(host);
    const a = one(req(1));
    await settle();
    host.finish();
    await a;
    const b = one(req(1));
    await settle();
    expect(host.calls).toEqual([1, 1]);
    host.finish();
    expect((await b)?.table[0]?.amount).toBe(1);
  });

  it("本体の計算が失敗しても null を返し、次の要求は止まらずに計算する", async () => {
    const host = fakeHost();
    const one = singleCompute(host);
    const a = one(req(1));
    const b = one(req(1));
    const c = one(req(2));
    await settle();
    host.finish("E_HOST_THREAD");
    expect(await a).toBeNull();
    expect(await b).toBeNull();
    await settle();
    host.finish();
    expect((await c)?.table[0]?.amount).toBe(2);
  });

  it("エンジンのエラーは null を返す", async () => {
    const one = singleCompute({ compute: async () => ({ ms: 1, slots: { calc: { rev: 1, ms: 1, result: { error: { code: "E_INPUT", ids: [] } } } } }) });
    expect(await one(req(1))).toBeNull();
  });
});

describe("開発用のブラウザの計算（画面側のエンジン）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("同じ要求を同時に2つ頼んでも、計算の間に描画と入力が入り、結果は1件ずつのときと同じ", async () => {
    const { engine, packs } = realEngine();
    const fetches: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetches.push(url);
      return new Response(packs);
    });
    const host = devBrowserHost(engine);
    const request = JSON.stringify(modelHousehold("investmentCouple"));
    const alone = await host.compute([{ id: "calc", rev: 1, request }]);
    // 計算と計算の間にタイマー（描画・入力の代わり）が動くか
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    const order: string[] = [];
    const a = host.compute([{ id: "calc", rev: 1, request }]).then((r) => (order.push("a"), r));
    const b = host.compute([{ id: "calc", rev: 1, request }]).then((r) => (order.push("b"), r));
    let ticksAfterA = -1;
    void a.then(() => (ticksAfterA = ticks));
    const [ra, rb] = await Promise.all([a, b]);
    clearInterval(timer);
    expect(ticksAfterA).toBeGreaterThan(0);
    expect(ticks).toBeGreaterThan(ticksAfterA);
    expect(order).toEqual(["a", "b"]);
    expect(ra.slots.calc?.result).toEqual(alone.slots.calc?.result);
    expect(rb.slots.calc?.result).toEqual(alone.slots.calc?.result);
    expect(fetches).toEqual(["/__dev/packs"]);
  }, 60000);

  it("最初の計算を同時に頼んでも、パックを読むのは1回", async () => {
    const { engine, packs } = realEngine();
    const fetches: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetches.push(url);
      return new Response(packs);
    });
    const one = singleCompute(devBrowserHost(engine));
    const request = modelHousehold("investmentCouple");
    const [a, b] = await Promise.all([one(request), one(request)]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(fetches).toEqual(["/__dev/packs"]);
  }, 60000);

  it("計算に失敗しても、次の計算は止まらない", async () => {
    const { engine, packs } = realEngine();
    let fail = true;
    vi.stubGlobal("fetch", async () => {
      if (fail) {
        fail = false;
        throw new Error("E_DEV_NETWORK");
      }
      return new Response(packs);
    });
    const host = devBrowserHost(engine);
    const request = JSON.stringify(modelHousehold("investmentCouple"));
    await expect(host.compute([{ id: "calc", rev: 1, request }])).rejects.toThrow("E_DEV_NETWORK");
    const r = await host.compute([{ id: "calc", rev: 1, request }]);
    expect(r.slots.calc?.result).toHaveProperty("table");
  }, 60000);
});

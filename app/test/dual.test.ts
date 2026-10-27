import { describe, expect, it } from "vitest";
import { DualEngine } from "../src/engine/dual.ts";
import type { ComputeResponse, HostApi, SlotRequest } from "../src/engine/host.ts";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { applyLevers } from "../src/workspace/levers.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, realEngine } from "./helpers.ts";

const req = (n: number): EngineRequest => ({ trace: "none", input: { baseMonth: "2026-10", endYear: 2027, household: { members: [] }, n } });
const result = (tag: number): PreviewResult => ({ header: { engine: { version: "t", sourceDigest: "x" }, baseMonth: "2026-10", endYear: 2027 }, table: [{ row: "cf.net", year: 2027, amount: tag }], summary: {} });

/** 画面側のエンジンの代わり: 要求の n をそのまま結果にする */
function fakeSession() {
  const slots = new Map<string, number>();
  const calls: string[] = [];
  const out = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { result: result(slots.get(id) as number) }]));
  return {
    calls,
    set(j: string) {
      for (const [k, v] of Object.entries(JSON.parse(j) as Record<string, { input: { n: number } }>)) slots.set(k, v.input.n);
      return "{}";
    },
    compute(ids?: string) {
      calls.push("compute");
      return JSON.stringify(out(ids !== undefined ? (JSON.parse(ids) as string[]) : [...slots.keys()]));
    },
    results: () => "{}",
    status: () => "{}",
    slide(j: string, focus: string) {
      calls.push(`slide:${focus}`);
      this.set(j);
      return JSON.stringify({ focus: out([focus]), status: {} });
    },
    release() {
      calls.push("release");
      return JSON.stringify(out([...slots.keys()]));
    },
  };
}

/** 提案書・ヒアリングシート・世帯の保存の命令（この試験では使わない） */
const no = async () => Promise.reject("E");
const NO_FILES: Pick<HostApi, "report" | "sheets" | "takeaway" | "store" | "ai" | "office" | "statements"> = {
  report: { render: no, page: no, pageSvg: no, save: no, discard: async () => undefined },
  sheets: { save: no, open: async () => null },
  takeaway: { save: no },
  store: { status: no, list: no, create: no, open: no, save: no, rename: no, remove: no, recoveryKey: no, acknowledgeRecovery: no, testRecoveryKey: no, restoreWithRecoveryKey: no, closeReady: async () => undefined, forkInfo: no, resolveFork: no, resolveSyncCopies: no, leave: async () => undefined, devFileKeys: async () => false, listSamples: no, setCategory: no, assignSerial: no, makeSample: no, updateSample: no, categories: no, setCategories: no },
  ai: { status: no, setEnabled: no, copySetup: no, household: no, recordConsent: no, startShare: no, stopShare: no, decide: no },
  office: { status: no, start: no, join: no, cancel: no, approve: no, reject: no, remove: no, moveLocal: no, recover: no, end: no, dismissNotices: no, defaults: async () => ({}), putDefaults: no, syncStart: no, syncOpen: no, syncEnd: no, notices: async () => [] },
  statements: { office: no, learn: no, open: async () => null, saveSheet: no, openSheet: async () => null },
};

/** 本体の代わり: 結果は要求の n×10（正の計算）。応答は手で返す */
function fakeHost() {
  const pending: { slots: SlotRequest[]; resolve: (r: ComputeResponse) => void }[] = [];
  const host: HostApi = {
    kind: "browser-dev",
    packs: async () => "[]",
    listHouseholds: async () => [],
    openHousehold: async () => req(0),
    compute: (slots) => new Promise((resolve) => pending.push({ slots, resolve })),
    evidence: async () => ({ error: { code: "E", ids: [] } }),
    ...NO_FILES,
  };
  const answer = (i = 0, tamper = false) => {
    const p = pending.splice(i, 1)[0]!;
    p.resolve({ ms: 1, slots: Object.fromEntries(p.slots.map((s) => [s.id, { rev: s.rev, ms: 1, result: result((JSON.parse(s.request) as { input: { n: number } }).input.n * (tamper ? 10 : 1)) }])) });
  };
  return { host, pending, answer };
}

function timers() {
  const queue: { fn: () => void; ms: number }[] = [];
  return { queue, setTimer: (fn: () => void, ms: number) => (queue.push({ fn, ms }), queue.length), clearTimer: (h: unknown) => (queue[(h as number) - 1] = { fn: () => undefined, ms: 0 }) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("二本立て（0005 の5）", () => {
  it("開いたら全部の枠を先出しで出し、本体の正の計算で置き換える", async () => {
    const s = fakeSession();
    const h = fakeHost();
    const d = new DualEngine({ session: s, host: h.host, onChange: () => undefined, ...timers() });
    const p = d.set({ current: req(1), proposal: req(2) });
    expect(d.view("proposal").source).toBe("preview");
    expect(d.view("proposal").stale).toBe(true);
    await tick();
    expect(h.pending).toHaveLength(1);
    h.answer();
    await p;
    expect(d.view("proposal").source).toBe("canonical");
    expect(d.view("proposal").stale).toBe(false);
    expect(d.settled()).toBe(true);
  });

  it("スライダーの間は見ている枠だけを先に出し、止まってから正の計算をする", async () => {
    const s = fakeSession();
    const h = fakeHost();
    const t = timers();
    const d = new DualEngine({ session: s, host: h.host, onChange: () => undefined, ...t });
    const p = d.set({ current: req(1), proposal: req(2) });
    await tick();
    h.answer();
    await p;
    d.slide("proposal", { proposal: req(3) });
    d.slide("proposal", { proposal: req(4) });
    expect(s.calls.filter((c) => c === "slide:proposal")).toHaveLength(2);
    expect(d.view("proposal").result!.table[0]!.amount).toBe(4);
    expect(d.view("proposal").source).toBe("preview");
    expect(h.pending).toHaveLength(0);
    // 最後の入力から 150ミリ秒
    expect(t.queue.at(-1)!.ms).toBe(150);
    t.queue.at(-1)!.fn();
    await tick();
    expect(h.pending).toHaveLength(1);
    expect(h.pending[0]!.slots.map((x) => x.id)).toEqual(["proposal"]);
    h.answer();
    await tick();
    await tick();
    expect(d.view("proposal").source).toBe("canonical");
  });

  it("計算している間に要求が変わったら、古い正の計算の結果は捨てて計算し直す", async () => {
    const s = fakeSession();
    const h = fakeHost();
    const t = timers();
    const d = new DualEngine({ session: s, host: h.host, onChange: () => undefined, ...t });
    const p = d.set({ proposal: req(1) });
    await tick();
    d.slide("proposal", { proposal: req(5) });
    h.answer();
    await tick();
    await tick();
    expect(h.pending).toHaveLength(0);
    // 操作が止まったら（タイマー）、古い結果（n=1）は使わず、先出しの n=5 のまま、本体に n=5 を送る
    t.queue.at(-1)!.fn();
    await tick();
    expect(d.view("proposal").result!.table[0]!.amount).toBe(5);
    expect(d.view("proposal").source).toBe("preview");
    expect(h.pending).toHaveLength(1);
    expect(JSON.parse(h.pending[0]!.slots[0]!.request).input.n).toBe(5);
    h.answer();
    await p;
    await tick();
    expect(d.view("proposal").source).toBe("canonical");
  });

  it("画面側と本体が食い違ったら本体の結果を表示し、数を数える", async () => {
    const s = fakeSession();
    const h = fakeHost();
    const d = new DualEngine({ session: s, host: h.host, onChange: () => undefined, ...timers() });
    const p = d.set({ proposal: req(2) });
    await tick();
    h.answer(0, true);
    await p;
    expect(d.view("proposal").result!.table[0]!.amount).toBe(20);
    expect(d.mismatches).toBe(1);
  });

  it("画面側のエンジンが無くても、本体だけで動く", async () => {
    const h = fakeHost();
    const d = new DualEngine({ session: null, host: h.host, onChange: () => undefined, ...timers() });
    const p = d.set({ proposal: req(7) });
    expect(d.view("proposal").result).toBeNull();
    await tick();
    h.answer();
    await p;
    expect(d.view("proposal").result!.table[0]!.amount).toBe(7);
  });

  it("本物のエンジン: 先出し（セッション）と1件ずつの計算の表が一致する", async () => {
    const { engine, packs } = realEngine();
    const base = modelHousehold("salariedCoupleTwoKids");
    const self = roles(base).find((r) => r.key === "self")!.member;
    const host: HostApi = {
      ...NO_FILES,
      kind: "browser-dev",
      packs: async () => packs,
      listHouseholds: async () => [],
      openHousehold: async () => base,
      compute: async (slots) => ({
        ms: 0,
        slots: Object.fromEntries(slots.map((x) => [x.id, { rev: x.rev, ms: 0, result: (JSON.parse(engine.runBatch(`[${x.request}]`, packs, '{"preview":true}')) as PreviewResult[])[0]! }])),
      }),
      evidence: async () => ({ error: { code: "E", ids: [] } }),
    };
    const d = new DualEngine({ session: engine.createSession(packs), host, onChange: () => undefined, ...timers() });
    await d.set({ current: base, proposal: base });
    for (const v of [{ retireAge: 65 }, { retireAge: 65, pensionAge: 70 }, { retireAge: 68, nisaMonthly: 50000, livingMonthly: 260000 }]) {
      d.slide("proposal", { proposal: applyLevers(base, self.id, v, { reemployment: { fromAge: 60, type: "contract", annualSalary: 4200000, standardMonthlyRemuneration: 360000 } }) });
      await d.release();
    }
    expect(d.mismatches).toBe(0);
    expect(d.view("proposal").source).toBe("canonical");
  });
});

// 控え（PDF を書き出した時点・FP が残した時点）・万一のときに見るプラン・車の行（キャッシュフロー表）・提案書の推定の値の扱い
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { ComputeResponse, HostApi, SlotRequest } from "../src/engine/host.ts";
import type { PreviewResult } from "../src/engine/types.ts";
import { ScenarioBand } from "../src/presentation/ContingencyView.tsx";
import type { ContingencyModel } from "../src/presentation/model.ts";
import { ContingencyEngine, YearSweep } from "../src/workspace/contingency/engine.ts";
import { chartRequests, keptSlots, planSlot, scenarioRequest, scenarios } from "../src/workspace/contingency/requests.ts";
import { yearOptions } from "../src/workspace/contingency/present.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { itemStage } from "../src/workspace/input/items.ts";
import type { StageDef } from "../src/workspace/input/form.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues } from "../src/workspace/plans/plans.ts";
import { depletionYear, displayYears, rowDefs, sumByYear } from "../src/workspace/present.ts";
import { estimatedCards } from "../src/workspace/report/assemble.ts";
import { roles } from "../src/workspace/roles.ts";
import { SnapshotTools } from "../src/workspace/snapshots/SnapshotTools.tsx";
import { canonicalJson, keepSnapshots, makeSnapshot, readSnapshots, verifySnapshot, type Snapshot } from "../src/workspace/snapshots/snapshots.ts";
import { bodyOf, fromBody } from "../src/workspace/store/body.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { modelHousehold, preview, realEngine } from "./helpers.ts";

const noop = () => undefined;
const NOW = new Date(2026, 9, 19, 14, 3, 0);

function countingHost(): HostApi & { calls: number } {
  const { engine, packs } = realEngine();
  const host = {
    kind: "browser-dev" as const,
    calls: 0,
    compute: async (slots: SlotRequest[]): Promise<ComputeResponse> => {
      host.calls++;
      const out: ComputeResponse["slots"] = {};
      for (const s of slots) {
        const r = JSON.parse(engine.runBatch(`[${s.request}]`, packs, '{"preview":true}')) as unknown[];
        out[s.id] = { rev: s.rev, ms: 0, result: r[0] as PreviewResult };
      }
      return { ms: 0, slots: out };
    },
  };
  return host as unknown as HostApi & { calls: number };
}

describe("控え（0009 の2）", () => {
  const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));

  it("その時点の現状・プラン・保存していない変更を写し、作った後に世帯を直しても変わらない。指紋で改ざんを見つける", async () => {
    const drafts = { p1: { "lever:livingMonthly": 260000 } };
    const s = await makeSnapshot({ wh, drafts, draft: { trigger: "manual", memo: "  1回目の面談の後  ", plan: { id: CURRENT, letter: "A", name: "現状" } }, appVersion: "0.1.0", now: NOW, id: "snap-1" });
    expect(s).toMatchObject({ id: "snap-1", createdAt: expect.stringMatching(/^2026-10-19T14:03:00[+-]\d{2}:\d{2}$/), trigger: "manual", memo: "1回目の面談の後", baseMonth: wh.request.input.baseMonth, appVersion: "0.1.0" });
    expect(s.inputs.request).toEqual(wh.request);
    expect(s.inputs.request).not.toBe(wh.request);
    expect(s.inputs.unsavedPlanValues).toEqual(drafts);
    expect(s.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await verifySnapshot(s)).toBe(true);
    // 控えの中身を書き換えると、指紋が合わなくなる
    const changed = structuredClone(s);
    changed.inputs.request.input.endYear += 1;
    expect(await verifySnapshot(changed)).toBe(false);
    // 保存して読み直しても（キーの順が変わっても）同じ指紋
    const reread = JSON.parse(JSON.stringify({ ...s, memo: s.memo })) as Snapshot;
    expect(await verifySnapshot(reread)).toBe(true);
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });

  it("世帯ファイルの本文では区画 snapshots に置き（household の区画には入れない）、読むと戻る。控えが無ければ区画を作らない", async () => {
    const s = await makeSnapshot({ wh, drafts: {}, draft: { trigger: "pdf", memo: "提案書（12ページ）", plan: { id: "p1", letter: "B", name: "生活費を見直す" } }, appVersion: "0.1.0", now: NOW });
    const state = (w: WorkingHousehold) => ({ wh: w, workspace: { template: null, band: [], base: CURRENT, selected: CURRENT, shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: { extDefinitions: {}, ext: {} } });
    const body = bodyOf(state({ ...wh, snapshots: [s] }));
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(Object.keys(parsed)).toContain("snapshots");
    expect(JSON.stringify(parsed.household)).not.toContain(s.digest);
    const back = fromBody(body).wh.snapshots!;
    expect(back).toEqual([s]);
    expect(await verifySnapshot(back[0]!)).toBe(true);
    expect(Object.keys(JSON.parse(bodyOf(state(wh))) as object)).not.toContain("snapshots");
    expect(fromBody(bodyOf(state(wh))).wh.snapshots).toBeUndefined();
    expect(readSnapshots([{ id: 1 }, "x"])).toEqual([]);
  });

  it("元に戻す・入力の保存で世帯を置き換えても、今の控えを持ち越す（控えは履歴の対象にしない）", async () => {
    const s = await makeSnapshot({ wh, drafts: {}, draft: { trigger: "manual", memo: "", plan: null }, appVersion: "0.1.0", now: NOW });
    const cur: WorkingHousehold = { ...wh, snapshots: [s] };
    expect(keepSnapshots(wh, cur).snapshots).toEqual([s]);
    expect(keepSnapshots({ ...wh, snapshots: [s] }, wh).snapshots).toBeUndefined();
    expect(keepSnapshots(cur, cur)).toBe(cur);
  });

  it("一覧: 日時・きっかけ（PDF書き出し／手動）・メモ・プラン。ボタンは控えめな文字のボタン", async () => {
    const a = await makeSnapshot({ wh, drafts: {}, draft: { trigger: "pdf", memo: "提案書（12ページ）", plan: { id: "p1", letter: "B", name: "生活費を見直す" } }, appVersion: "0.1.0", now: NOW });
    const b = await makeSnapshot({ wh, drafts: {}, draft: { trigger: "manual", memo: "2回目の面談", plan: { id: CURRENT, letter: "A", name: "現状" } }, appVersion: "0.1.0", now: new Date(2026, 10, 2, 9, 30) });
    const html = renderToString(h(SnapshotTools, { list: [a, b], stored: true, onTake: async () => undefined, onRemove: noop, initialOpen: true }));
    expect(html).toContain("この時点を残す");
    expect(html).toContain("控えの一覧（2件）");
    expect(html).toContain("2026年10月19日 14:03");
    expect(html).toContain("PDF書き出し");
    expect(html).toContain("手動");
    expect(html).toContain("2回目の面談");
    expect(html).toContain("プランB 生活費を見直す");
    // 新しい順
    expect(html.indexOf("2回目の面談")).toBeLessThan(html.indexOf("提案書（12ページ）"));
    expect(html).toMatch(/class="link-btn"[^>]*data-snapshot-take/);
  });
});

describe("万一のときに見るプラン", () => {
  const base = fromRequest(modelHousehold("salariedCoupleTwoKids"));
  const self = roles(base.request).find((r) => r.key === "self")!.member;
  const cat = buildCatalog(base, self.id, null);
  const planReq = applyValues(base, { "lever:livingMonthly": 380000 }, cat);
  const planWh: WorkingHousehold = { ...base, request: planReq };
  const sc = scenarios(base).find((s) => s.key === "death:self")!;
  const year = 2028;

  it("プランを選ぶと、場面の帯・グラフ・必要保障額の要求がそのプランの中身になり、枠の名前もプランごとに分かれる", () => {
    const a = chartRequests(base, CURRENT, [self.id], sc, year);
    const b = chartRequests(planWh, "plan-b", [self.id], sc, year);
    expect(Object.keys(a)).toEqual([planSlot(CURRENT, "none"), planSlot(CURRENT, "prot:0"), planSlot(CURRENT, "sc")]);
    expect(Object.keys(b)).toEqual(["plan-b|none", "plan-b|prot:0", "plan-b|sc"]);
    for (const k of ["none", "prot:0", "sc"]) expect(JSON.stringify(b[`plan-b|${k}`]), k).not.toBe(JSON.stringify(a[planSlot(CURRENT, k)]));
    // 想定の前提（遺族の生活費の割合など）は同じものを使う
    expect(b["plan-b|sc"]!.input.contingencies).toEqual(a[planSlot(CURRENT, "sc")]!.input.contingencies);
    expect(b["plan-b|prot:0"]!.input.protection).toEqual(a[planSlot(CURRENT, "prot:0")]!.input.protection);
  });

  it("グラフの枠: 切り替えて戻すと前の結果がすぐある（最近見たプランの枠は残す）", async () => {
    const host = countingHost();
    const engine = new ContingencyEngine({ host, web: realEngine().engine, packs: realEngine().packs });
    const a = chartRequests(base, CURRENT, [self.id], sc, year);
    const b = chartRequests(planWh, "plan-b", [self.id], sc, year);
    engine.chart.retain(keptSlots(engine.chart.ids(), a, [CURRENT]));
    await engine.chart.set(a);
    const aNone = engine.chart.view(planSlot(CURRENT, "none")).result!;
    engine.chart.retain(keptSlots(engine.chart.ids(), b, ["plan-b", CURRENT]));
    await engine.chart.set(b);
    const bNone = engine.chart.view("plan-b|none").result!;
    // プランごとに別の結果（生活費を上げたプランは資産が少ない）
    const fin = (r: PreviewResult) => r.table.filter((c) => c.row === "cf.balance.financial").at(-1)!.amount;
    expect(fin(bNone)).toBeLessThan(fin(aNone));
    expect(bNone.table).toEqual(preview(b["plan-b|none"]!).table);
    // 戻す: 計算せずに前の結果
    const calls = host.calls;
    engine.chart.retain(keptSlots(engine.chart.ids(), a, [CURRENT, "plan-b"]));
    await engine.chart.set(a);
    expect(host.calls).toBe(calls);
    expect(engine.chart.view(planSlot(CURRENT, "none")).result).toBe(aNone);
    // 最近見たプランから外れた枠は消す
    expect(keptSlots(engine.chart.ids(), a, [CURRENT])).not.toContain("plan-b|none");
  });

  it("年ごとの結果の帯: プランごとに別に覚え、資産が尽きる年はそのプランの計算と一致する", async () => {
    const host = countingHost();
    const timers: (() => void)[] = [];
    const sweep = new YearSweep({ host, session: null, onChange: noop, setTimer: (fn) => void timers.push(fn) });
    const run = async () => {
      for (let i = 0; i < 200 && !sweep.settled(); i++) {
        while (timers.length > 0) timers.shift()!();
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    const opts = yearOptions(base.request, sc.member).slice(0, 3);
    const listOf = (w: WorkingHousehold) => YearSweep.prepare(opts.map((o) => ({ year: o.value, request: scenarioRequest(w, sc, o.value) })));
    const years = displayYears(base.request);
    const summarize = (r: PreviewResult) => depletionYear(r.table, years);
    const la = listOf(base);
    const lb = listOf(planWh);
    expect(la.map((p) => p.key)).not.toEqual(lb.map((p) => p.key));
    sweep.want(la, summarize);
    await run();
    sweep.want(lb, summarize);
    await run();
    for (const [i, p] of lb.entries()) expect(sweep.outcome(p.key)).toEqual({ state: "ready", depletion: depletionYear(preview(scenarioRequest(planWh, sc, opts[i]!.value)).table, years), source: "canonical" });
    // 現状の帯の結果も残っている（戻したときに計算しない）
    const calls = host.calls;
    sweep.want(la, summarize);
    await run();
    expect(host.calls).toBe(calls);
    for (const p of la) expect(sweep.outcome(p.key).state).toBe("ready");
  });

  it("場面の帯に「見るプラン」の切り替えを出す（既定は現状。プランが1つなら出さない）", () => {
    const model = { scenarios: [], selected: "", protection: { status: "ready", charts: [], error: null, ms: null } } as unknown as ContingencyModel;
    const plan = { options: [{ id: CURRENT, text: "プランA（現状）" }, { id: "p1", text: "プランB 保険の見直し" }], value: CURRENT, onChange: noop };
    const html = renderToString(h(ScenarioBand, { model, onSelect: noop, plan }));
    expect(html).toContain("見るプラン");
    expect(html).toContain("data-cg-plan");
    expect(html).toContain("プランB 保険の見直し");
    expect(renderToString(h(ScenarioBand, { model, onSelect: noop, plan: { ...plan, options: plan.options.slice(0, 1) } }))).not.toContain("見るプラン");
  });
});

describe("キャッシュフロー表の車の行（何台でも1行）", () => {
  it("車がある世帯だけ「車」の行を出し、支出の行の合計は支出合計と同じ（二重に数えない）", () => {
    const wh = fromRequest(modelHousehold("unexplainedSpending"));
    const add = (itemStage(wh, "car") as StageDef).sections[0]!.actions[0]!;
    const two = add.run(wh);
    const req = two.request;
    const r = preview(req);
    const defs = rowDefs(req);
    expect(defs.map((d) => d.key)).toContain("car");
    expect(rowDefs(modelHousehold("salariedCoupleTwoKids")).map((d) => d.key)).not.toContain("car");
    const ids = new Set(req.input.household.cars!.map((c) => c.id));
    const car = sumByYear(r.table, defs.find((d) => d.key === "car")!.match);
    const direct = sumByYear(r.table, (c) => c.object !== undefined && ids.has(c.object) && c.row.startsWith("cf.expense."));
    expect([...car.entries()]).toEqual([...direct.entries()]);
    const values = defs.filter((d) => d.group === "expense" && d.kind === "value");
    const total = sumByYear(r.table, defs.find((d) => d.key === "expenseTotal")!.match);
    for (const y of displayYears(req)) expect(values.reduce((s, d) => s + (sumByYear(r.table, d.match).get(y) ?? 0), 0), String(y)).toBe(total.get(y) ?? 0);
  });
});

describe("提案書の推定の値", () => {
  it("推定・仮の値の欄が残るカードを FP 向けの画面に出す（提案書には欄を書かない）", () => {
    const blank = blankHousehold("2026-10", () => crypto.randomUUID());
    // 年金は記録が無いので、働き方の期間から推計している（物の単位の推定）
    expect(estimatedCards(blank).map((c) => c.label)).toEqual(["家族", "年金", "基本生活費", "前提条件"]);
    // 前提条件は、FPライズの標準（仮の値）と持ち家の評価の目安のままなので推定（0070）
    expect(estimatedCards(fromRequest(modelHousehold("salariedCoupleTwoKids"))).map((c) => c.label)).toEqual(["前提条件"]);
  });
});

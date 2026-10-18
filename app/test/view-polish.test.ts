// 見通しと万一のときの直し: 表のライフイベントの丸（グラフの丸と同じ部品）・年ごとの結果の帯（計算と表示・1年ずつ見せる）・
// 操作中はグラフを上に表示（縮めた高さ・出す条件・表示の設定）・言葉の統一・タブを開き直したときに計算し直さないこと
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { DualEngine } from "../src/engine/dual.ts";
import type { ComputeResponse, HostApi, SlotRequest } from "../src/engine/host.ts";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { ChartDock, DOCK_MAX_SHARE, dockChartHeight, shouldDock } from "../src/presentation/ChartDock.tsx";
import { DockedContingency, ScenarioBand, YearStrip } from "../src/presentation/ContingencyView.tsx";
import { EVENT_R, placeFixedAbove } from "../src/presentation/EventDot.tsx";
import { chartHeight, MainChart } from "../src/presentation/MainChart.tsx";
import { CashflowTable, DockedResult } from "../src/presentation/MainView.tsx";
import type { ContingencyModel, YearStripModel } from "../src/presentation/model.ts";
import { TABS } from "../src/workspace/App.tsx";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { DisplaySettingsPanel } from "../src/workspace/DisplaySettingsPanel.tsx";
import { ContingencyEngine, fingerprint, YearSweep } from "../src/workspace/contingency/engine.ts";
import { scenarioCards, scenarioModel, yearOptions, yearRanges, yearStripModel, type YearResult } from "../src/workspace/contingency/present.ts";
import { baseRequest, protectionRequest, scenarioRequest, scenarios } from "../src/workspace/contingency/requests.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues } from "../src/workspace/plans/plans.ts";
import { depletionYear, displayYears, toPresentation } from "../src/workspace/present.ts";
import { roles } from "../src/workspace/roles.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyOf, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { modelHousehold, preview, realEngine } from "./helpers.ts";

const noop = () => undefined;

function openDemo() {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold("salariedCoupleTwoKids")!;
  const re = demo.reemployment!;
  const wh = fromRequest(req, { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } });
  return { wh, cat: buildCatalog(wh, self.id, demo), self };
}
const demo = openDemo();
const reqB = applyValues(demo.wh, { "lever:retireAge": 65 }, demo.cat);
const rA = preview(demo.wh.request);
const rB = preview(reqB);
const pm = toPresentation({ base: demo.wh.request, proposal: reqB, current: rA, proposed: rB, targetAge: 95, selectedYear: null, provisional: false, names: { selected: "B案", base: "A案", same: false } });

/** 本物のエンジンで計算する本体の代わり（呼ばれた回数と枠の数を数える） */
function countingHost(): HostApi & { calls: number; slots: number } {
  const { engine, packs } = realEngine();
  const host = {
    kind: "browser-dev" as const,
    calls: 0,
    slots: 0,
    compute: async (slots: SlotRequest[]): Promise<ComputeResponse> => {
      host.calls++;
      host.slots += slots.length;
      const out: ComputeResponse["slots"] = {};
      for (const s of slots) {
        const r = JSON.parse(engine.runBatch(`[${s.request}]`, packs, '{"preview":true}')) as unknown[];
        out[s.id] = { rev: s.rev, ms: 0, result: r[0] as PreviewResult };
      }
      return { ms: 0, slots: out };
    },
  };
  return host as unknown as HostApi & { calls: number; slots: number };
}

describe("生涯キャッシュフロー表のライフイベントの丸（グラフの下の丸と同じ部品）", () => {
  const html = renderToString(h(CashflowTable, { model: pm.table, selectedYear: null, onSelectYear: noop, onEvidence: noop }));
  const dots = html.match(/<span class="ev-dot( [^"]*)?"[^>]*>/g) ?? [];

  it("表の行はできごと（漢字と説明）を持ち、丸はキーボードで選べ、「2031年 住宅購入」の形で読み上げる", () => {
    const evRow = pm.table.rows.find((r) => r.kind === "events");
    expect(evRow?.kind).toBe("events");
    const chips = evRow?.kind === "events" ? evRow.events.flat() : [];
    expect(chips.length).toBeGreaterThan(0);
    expect(dots.length).toBe(chips.length);
    for (const d of dots) {
      expect(d).toMatch(/tabindex="0"/i);
      expect(d).toMatch(/role="img"/);
      expect(d).toMatch(/aria-label="\d{4}年 [^"]+"/);
    }
    // 説明の文はグラフの丸と同じ（年＋中身）
    const first = chips[0]!;
    expect(html).toContain(`aria-label="${first.year}年 ${first.text}"`);
    expect(html).not.toContain("<title>");
  });

  it("丸の大きさはグラフの丸と同じ（半径 12.5px × 文字の大きさ = 直径 1.5625rem）。漢字は丸の中央に置く", () => {
    const css = readFileSync(join(import.meta.dirname, "../src/styles/app.css"), "utf8");
    const rule = css.match(/\.cf \.ev-dot \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain(`width: ${(2 * EVENT_R) / 16}rem`);
    expect(rule).toContain(`height: ${(2 * EVENT_R) / 16}rem`);
    expect(rule).toContain("align-items: center");
    expect(rule).toContain("justify-content: center");
    expect(rule).toContain("border-radius: 50%");
    // グラフの丸も同じ半径
    const svg = renderToString(h(MainChart, { model: pm, mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop }));
    expect(svg).toContain(`<circle r="${EVENT_R}"></circle>`);
    expect(svg).toMatch(/dominant-baseline="central"/);
  });

  it("表の丸の説明は、丸の真上の中央（上に入らなければ下）。画面の左右からはみ出さない", () => {
    const p = placeFixedAbove({ left: 500, top: 300, width: 25, height: 25 }, 200, 30, 1200);
    expect(p.left).toBeCloseTo(412.5);
    expect(p.top + 30).toBeLessThanOrEqual(300);
    expect(p.below).toBe(false);
    const top = placeFixedAbove({ left: 500, top: 10, width: 25, height: 25 }, 200, 30, 1200);
    expect(top.below).toBe(true);
    expect(top.top).toBeGreaterThanOrEqual(35);
    expect(placeFixedAbove({ left: 2, top: 300, width: 25, height: 25 }, 200, 30, 1200).left).toBe(4);
    expect(placeFixedAbove({ left: 1190, top: 300, width: 25, height: 25 }, 200, 30, 1200).left).toBe(1200 - 4 - 200);
  });
});

describe("年ごとの結果の帯（計算と表示）", () => {
  const opts = [2027, 2028, 2029, 2030, 2031, 2032].map((y, i) => ({ value: y, age: 40 + i }));
  const ok = (source: "preview" | "canonical" = "canonical"): YearResult => ({ state: "ready", depletion: null, source });
  const short = (y: number): YearResult => ({ state: "ready", depletion: y, source: "canonical" });

  it("全部の年で足りる: 「2027〜2032年のどの年に起きても、最後まで資産は足ります」", () => {
    const m = yearStripModel({ options: opts, results: opts.map(() => ok()), who: "ご主人", noneDepletion: null, stale: false });
    expect(m.summary).toBe("2027〜2032年のどの年に起きても、最後まで資産は足ります");
    expect(m.tone).toBe("ok");
    expect(m.cells.every((c) => c.state === "ok")).toBe(true);
    expect(m.cells[0]!.label).toBe("2027年（ご主人40歳）に起きた場合、最後まで資産は足ります");
  });

  it("一部の年で不足: 続いた年をまとめて「2028〜2029年・2032年に起きると、資産が途中で不足します」。万一なしでも不足するときは添える", () => {
    const rs = [ok(), short(2050), short(2049), ok(), ok(), short(2055)];
    const m = yearStripModel({ options: opts, results: rs, who: "ご主人", noneDepletion: null, stale: false });
    expect(m.summary).toBe("2028〜2029年・2032年に起きると、資産が途中で不足します");
    expect(m.tone).toBe("short");
    expect(m.cells[1]).toMatchObject({ state: "short", shortYear: 2050, label: "2028年（ご主人41歳）に起きた場合、2050年に資産が不足" });
    const all = yearStripModel({ options: opts, results: opts.map(() => short(2040)), who: "ご主人", noneDepletion: 2060, stale: false });
    expect(all.summary).toBe("2027〜2032年のどの年に起きても、資産が途中で不足します（万一なしでも2060年に不足します）");
    expect(yearRanges([2040, 2031, 2032, 2033])).toBe("2031〜2033年・2040年");
  });

  it("計算中の年が残っている間は、一言の代わりに何年分できたか。先出しの結果は確定前の印", () => {
    const m = yearStripModel({ options: opts, results: [ok("preview"), { state: "pending" }], who: "ご主人", noneDepletion: undefined, stale: false });
    expect(m.done).toBe(1);
    expect(m.total).toBe(6);
    expect(m.tone).toBe("wait");
    expect(m.summary).toBe("年ごとの結果を計算しています（1/6年）");
    expect(m.cells[0]!.provisional).toBe(true);
    expect(m.cells.slice(1).every((c) => c.state === "pending")).toBe(true);
  });

  it("帯の部品: マスは年・年齢・結果の印（足りる ✓／不足 ▲と不足の始まる年。色だけに頼らない）。選んだ年は aria-checked、← → で動かせる並び", () => {
    const m = yearStripModel({ options: opts, results: [ok(), short(2050), { state: "pending" }, ok(), ok(), ok()], who: "ご主人", noneDepletion: null, stale: false });
    const html = renderToString(h(YearStrip, { model: m, selected: 2028, onSelect: noop, play: null, onPlay: noop, onPause: noop, onStop: noop }));
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(6);
    expect(html).toMatch(/aria-checked="true"[^>]*data-year-cell="2028"/);
    expect(html).toMatch(/data-year-cell="2027" data-state="ok"[^>]*>.*?✓/);
    expect(html).toMatch(/data-year-cell="2028" data-state="short"[^>]*>.*?▲2050/);
    expect(html).toMatch(/data-year-cell="2029" data-state="pending"/);
    expect(html).toContain("41歳");
    expect(html).toContain("▶ 1年ずつ見せる");
    expect(html).not.toContain("<select");
    // 見せている途中は一時停止と止める。一時停止中は続ける
    const playing = renderToString(h(YearStrip, { model: m, selected: 2028, onSelect: noop, play: "playing", onPlay: noop, onPause: noop, onStop: noop }));
    expect(playing).toContain("一時停止");
    expect(playing).toContain("止める");
    const paused = renderToString(h(YearStrip, { model: m, selected: 2028, onSelect: noop, play: "paused", onPlay: noop, onPause: noop, onStop: noop }));
    expect(paused).toContain("▶ 続ける");
  });

  it("本物のエンジン: 帯のマスの結果は、その年に起きた想定の計算で資産が尽きる年と一致する", async () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const sc = scenarios(wh).find((s) => s.key === "death:self")!;
    const options = yearOptions(wh.request, sc.member).slice(0, 4);
    const host = countingHost();
    const timers: (() => void)[] = [];
    const sweep = new YearSweep({ host, session: realEngine().engine.createSession(realEngine().packs), onChange: noop, setTimer: (fn) => void timers.push(fn) });
    const years = displayYears(wh.request);
    const list = YearSweep.prepare(options.map((o) => ({ year: o.value, request: scenarioRequest(wh, sc, o.value) })));
    sweep.want(list, (r) => depletionYear(r.table, years), options[0]!.value);
    // 先出し（画面の側のエンジン）: 選んだ年に近い年から1年ずつ（ここでは4年とも先出しの範囲）
    while (timers.length > 0) timers.shift()!();
    expect(list.every((p) => sweep.outcome(p.key).state === "ready")).toBe(true);
    // 正の計算（本体）で確かめて差し替える
    for (let i = 0; i < 200 && !sweep.settled(); i++) {
      while (timers.length > 0) timers.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(sweep.settled()).toBe(true);
    for (const [i, p] of list.entries()) {
      const o = sweep.outcome(p.key);
      const direct = depletionYear(preview(scenarioRequest(wh, sc, options[i]!.value)).table, years);
      expect(o).toEqual({ state: "ready", depletion: direct, source: "canonical" });
    }
    expect(sweep.mismatches).toBe(0);
    // 同じ内容でもう一度（タブを開き直したとき）: 計算しない
    const calls = host.calls;
    sweep.want(YearSweep.prepare(options.map((o) => ({ year: o.value, request: scenarioRequest(wh, sc, o.value) }))), (r) => depletionYear(r.table, years));
    for (let i = 0; i < 5; i++) {
      while (timers.length > 0) timers.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(host.calls).toBe(calls);
    expect(list.every((p) => sweep.outcome(p.key).state === "ready")).toBe(true);
  });

  it("画面の側の先出しは、選んだ年に近い数年だけ（1年ずつ間をあけて）。残りの年は本体の正の計算で出す", async () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const sc = scenarios(wh).find((s) => s.key === "disability:self")!;
    const options = yearOptions(wh.request, sc.member).slice(0, 8);
    const host = countingHost();
    const timers: (() => void)[] = [];
    const sweep = new YearSweep({ host, session: realEngine().engine.createSession(realEngine().packs), onChange: noop, setTimer: (fn) => void timers.push(fn), previewWindow: 3 });
    const years = displayYears(wh.request);
    const list = YearSweep.prepare(options.map((o) => ({ year: o.value, request: scenarioRequest(wh, sc, o.value) })));
    const focus = options[4]!.value;
    sweep.want(list, (r) => depletionYear(r.table, years), focus);
    while (timers.length > 0) timers.shift()!();
    const ready = list.filter((p) => sweep.outcome(p.key).state === "ready").map((p) => p.year);
    expect(ready.sort()).toEqual([focus - 1, focus, focus + 1]);
    expect(host.calls).toBe(0);
    for (let i = 0; i < 200 && !sweep.settled(); i++) {
      while (timers.length > 0) timers.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(sweep.settled()).toBe(true);
    expect(host.slots).toBe(8);
  });

  it("要求の指紋: 同じ文字列は同じ、1文字違えば違う", () => {
    expect(fingerprint('{"a":1}')).toBe(fingerprint('{"a":1}'));
    expect(fingerprint('{"a":1}')).not.toBe(fingerprint('{"a":2}'));
  });
});

describe("万一のときのタブを開き直したとき（計算の結果をアプリの側で持ち続ける）", () => {
  it("同じ世帯の中身なら、2回目に開いたときは計算せず、結果がすぐある", async () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const sc = scenarios(wh)[0]!;
    const self = roles(wh.request).find((r) => r.key === "self")!.member;
    const requests = (): Record<string, EngineRequest> => ({ none: baseRequest(wh.request), "prot:0": protectionRequest(wh, self.id), sc: scenarioRequest(wh, sc, 2030) });
    const host = countingHost();
    const engine = new ContingencyEngine({ host, web: realEngine().engine, packs: realEngine().packs });
    // 1回目に開く: 画面の側で先に出し、本体で確かめる
    await engine.chart.set(requests());
    expect(engine.chart.settled()).toBe(true);
    const calls = host.calls;
    expect(calls).toBeGreaterThan(0);
    // タブを切り替えて戻る（画面は外れても、計算の入れ物は App が持ち続ける）: 同じ要求を置き直す
    const before = engine.chart.timings.length;
    const pending = engine.chart.set(requests());
    // 置いた直後に、もう結果がある（「計算しています」を出さない）
    for (const id of ["none", "prot:0", "sc"]) expect(engine.chart.view(id).result).not.toBeNull();
    await pending;
    expect(host.calls).toBe(calls);
    expect(engine.chart.timings.length).toBe(before);
  });

  it("グラフの枠は見通しと同じ二本立て（DualEngine）: 画面の側の先出しのあと、本体の正の計算で置き換える", async () => {
    const host = countingHost();
    const engine = new ContingencyEngine({ host, web: realEngine().engine, packs: realEngine().packs });
    expect(engine.chart).toBeInstanceOf(DualEngine);
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const p = engine.chart.set({ none: baseRequest(wh.request) });
    expect(engine.chart.view("none").source).toBe("preview");
    await p;
    expect(engine.chart.view("none").source).toBe("canonical");
  });
});

describe("操作中はグラフを上に表示", () => {
  it("縮めたグラフは元の約43%。付いてくる部分は窓の高さの45%まで。低い窓では出さない", () => {
    for (const ih of [700, 900, 1100]) {
      const h1 = dockChartHeight(ih, 16, 92)!;
      expect(h1).toBeGreaterThan(0);
      expect(h1 / chartHeight(ih, 16)).toBeLessThanOrEqual(0.45);
      expect(h1 + 92).toBeLessThanOrEqual(ih * DOCK_MAX_SHARE + 1);
    }
    expect(dockChartHeight(900, 16, 92)! / chartHeight(900, 16)).toBeGreaterThan(0.4);
    // 万一のとき（年ごとの帯も付いてくる）は、そのぶん縮める
    expect(dockChartHeight(800, 16, 165)!).toBeLessThan(dockChartHeight(800, 16, 92)!);
    // 低い窓・文字を大きくした低い窓では出さない
    expect(dockChartHeight(480, 16, 165)).toBeNull();
    expect(dockChartHeight(560, 19, 165 * (19 / 16))).toBeNull();
  });

  it("出す条件: 元のグラフが上に隠れ、操作の欄が画面に見えているとき。境目でちらつかない（出す・消すの位置をずらす）", () => {
    const base = { controlsTop: 200, controlsBottom: 1400, innerHeight: 900, dockTotal: 300 };
    expect(shouldDock({ ...base, anchorBottom: 500, docked: false })).toBe(false);
    expect(shouldDock({ ...base, anchorBottom: 260, docked: false })).toBe(true);
    // 出ている間は、少し戻っても消えない
    expect(shouldDock({ ...base, anchorBottom: 310, docked: true })).toBe(true);
    expect(shouldDock({ ...base, anchorBottom: 310, docked: false })).toBe(false);
    // 操作の欄を通り過ぎた（表まで下りた）ら消す
    expect(shouldDock({ ...base, anchorBottom: -900, controlsTop: -1300, controlsBottom: 200, docked: true })).toBe(false);
  });

  it("付いてくる箱は、出していないときは中身を描かない。出しているときは見出し・×・縮めたグラフ（同じ部品・決めた高さ）", () => {
    expect(renderToString(h(ChartDock, { docked: false, onClose: noop }, "X"))).toBe('<div class="chart-dock" data-chart-dock="off"></div>');
    const html = renderToString(
      h(ChartDock, { docked: true, head: "見出し", onClose: noop }, h(DockedResult, { model: pm, provisional: false, mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop, height: 240 })),
    );
    expect(html).toContain("data-dock-close");
    expect(html).toContain('height="240"');
    expect(html).toContain("main-legend");
    expect(html).toContain("line-prop");
  });

  it("万一のときも同じ部品: 年ごとの帯（縮めた形）と、縮めたグラフ", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const req = wh.request;
    const sc = scenarios(wh).find((s) => s.key === "death:self")!;
    const none = preview(baseRequest(req));
    const result = preview(scenarioRequest(wh, sc, 2030));
    const protection: ContingencyModel["protection"] = { status: "ready", charts: [], error: null, ms: 1 };
    const strip: YearStripModel = yearStripModel({ options: [{ value: 2030, age: 40 }], results: [{ state: "ready", depletion: null, source: "canonical" }], who: "ご主人", noneDepletion: null, stale: false });
    const model: ContingencyModel = {
      protection,
      scenarios: scenarioCards({ req, scenarios: scenarios(wh), selected: sc.key, protection, grade: undefined }),
      selected: sc.key,
      year: 2030,
      strip,
      scenario: { status: "ready", model: scenarioModel({ req, scenario: sc, year: 2030, result, none, targetAge: 95, choice: undefined }), error: null, stale: false },
    };
    const html = renderToString(
      h(DockedContingency, { model, mode: "assets", pinnedYear: null, onPinYear: noop, onPick: noop, height: 200, strip: { selected: 2030, onSelect: noop, play: null, onPlay: noop, onPause: noop, onStop: noop } }),
    );
    expect(html).toContain('class="card ys compact"');
    expect(html).toContain('height="200"');
    expect(html).not.toContain('class="yc-a"');
  });

  it("表示の設定に「操作中はグラフを上に表示」（既定はオン）。世帯ファイルに書いた値を読み戻す", () => {
    expect(DEFAULT_DISPLAY_SETTINGS.dock).toBe(true);
    const html = renderToString(h(DisplaySettingsPanel, { value: DEFAULT_DISPLAY_SETTINGS, onChange: noop, onClose: noop, feeAvailable: true }));
    expect(html).toContain("操作中はグラフを上に表示");
    const box = html.match(/<input[^>]*data-dock-setting[^>]*>/)?.[0] ?? "";
    expect(box).toContain('type="checkbox"');
    expect(box).toMatch(/checked/);
    const ws = { template: null, band: [], base: "current", selected: "current", shownItems: [] };
    const off = bodyOf({ wh: demo.wh, workspace: ws, display: { ...DEFAULT_DISPLAY_SETTINGS, dock: false }, carry: EMPTY_CARRY });
    expect(fromBody(off).display.dock).toBe(false);
    // 前の版の本文（dock が無い）は既定（オン）で読む
    const old = JSON.parse(off) as { display: Record<string, unknown> };
    delete old.display.dock;
    expect(fromBody(JSON.stringify(old)).display.dock).toBe(true);
  });
});

describe("言葉の統一", () => {
  it("上のタブは「入力」「見通し」「万一のとき」「提案書」", () => {
    expect(TABS.map((t) => t.label)).toEqual(["入力", "見通し", "万一のとき", "提案書"]);
  });

  it("場面のカード: 不足がなければ「保障は足りています」。結果の行（最後まで足りる・○年に不足）は出さない。起きる年のプルダウンも無い", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const scs = scenarios(wh);
    const chart = { key: "self", title: "", sub: "", years: [2030], ages: [40], need: [0], needWithAssets: [0], coverage: [0], maxShort: null, reformFrom: null };
    const protection: ContingencyModel["protection"] = { status: "ready", charts: [chart], error: null, ms: 1 };
    const cards = scenarioCards({ req: wh.request, scenarios: scs, selected: scs[0]!.key, protection, grade: undefined });
    expect(cards.find((c) => c.key === "death:self")!.status).toBe("保障は足りています");
    expect(cards.every((c) => !("result" in c))).toBe(true);
    const strip = yearStripModel({ options: [], results: [], who: "", noneDepletion: null, stale: false });
    const html = renderToString(h(ScenarioBand, { model: { protection, scenarios: cards, selected: scs[0]!.key, year: 2030, strip, scenario: { status: "loading", model: null, error: null, stale: false } }, onSelect: noop }));
    expect(html).toContain("保障は足りています");
    expect(html).not.toContain("最後まで足りる");
    expect(html).not.toContain("p-amt");
    expect(html).not.toContain("<select");
  });

  /** 画面と帳票の元の文字列（文字列・テンプレート・JSX の文字。コメントは除く） */
  function visibleStrings(dir: string): { file: string; text: string }[] {
    const out: { file: string; text: string }[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          if (name !== "node_modules" && name !== "generated") walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const src = ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const visit = (n: ts.Node) => {
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) out.push({ file: p, text: n.text });
          ts.forEachChild(n, visit);
        };
        visit(src);
      }
    };
    walk(dir);
    return out;
  }

  it("利用者に見える文字列に「万が一」「主画面」「万一の想定」「死亡保険金で足ります」が残っていない（画面・帳票）", () => {
    const strings = [...visibleStrings(join(import.meta.dirname, "../src")), ...visibleStrings(join(import.meta.dirname, "../../report/src"))];
    expect(strings.length).toBeGreaterThan(1000);
    const bad = strings.filter((s) => /万が一|主画面|万一の想定|死亡保険金で足ります|今の備えで足ります/.test(s.text));
    expect(bad.map((b) => `${b.file.replace(/^.*\/(app|report)\//, "$1/")}: ${b.text}`)).toEqual([]);
  });
});

void MainChart;

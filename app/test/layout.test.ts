// 主画面の配置（2026-10-17）: 部品の組み立て・帯の案の選択・基準の切り替え・○歳時点の表示の切り替え・グラフの補間・表の差
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { DualEngine } from "../src/engine/dual.ts";
import type { HostApi, WebSession } from "../src/engine/host.ts";
import type { PreviewResult } from "../src/engine/types.ts";
import { chartHeight, MainChart } from "../src/presentation/MainChart.tsx";
import { CashflowTable, ResultCard } from "../src/presentation/MainView.tsx";
import { PlanBand } from "../src/presentation/PlanBand.tsx";
import { easeOutBack, lerpSeries, sameSeries } from "../src/presentation/tween.ts";
import { lockReason, modifiedSet, slotOfLetter, valuesOf, type Work } from "../src/workspace/App.tsx";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addToBand, bandModel, cleanBand, CURRENT, MAX_BAND, planLetters } from "../src/workspace/plans/band.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { applyValues, savePlan, type Values } from "../src/workspace/plans/plans.ts";
import { cashflowTable, displayYears, financialOf, sumByYear, toPresentation, withDiff } from "../src/workspace/present.ts";
import { roles } from "../src/workspace/roles.ts";
import { ageMarkOf, cardMetrics, DEFAULT_DISPLAY_SETTINGS, toggleMetric, verdictMetrics } from "../src/workspace/settings.ts";
import { metricsOf } from "../src/workspace/plans/compare.ts";
import { modelHousehold, preview } from "./helpers.ts";

const NOW = "2026-10-17T10:00:00.000Z";
const MARK = "MEMO-MARK-layout";

function openDemo(): { wh: WorkingHousehold; cat: Catalog } {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold("salariedCoupleTwoKids")!;
  const re = demo.reemployment!;
  const wh = fromRequest(req, { memo: [MARK], postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } });
  return { wh, cat: buildCatalog(wh, self.id, demo) };
}

/** 見本の世帯に案を足す（B: 65歳まで働く・生活費を減らす、C: B＋70歳まで、ほか） */
function withPlans(n: number): { wh: WorkingHousehold; cat: Catalog; ids: string[] } {
  const { wh: w0, cat } = openDemo();
  let wh = w0;
  const ids: string[] = [];
  const vals: Values[] = [
    { "lever:retireAge": 65, "lever:livingMonthly": 280000 },
    { "lever:retireAge": 70, "lever:livingMonthly": 280000 },
    { "lever:nisaMonthly": 50000 },
    { "lever:pensionAge": 70 },
    { "lever:livingMonthly": 260000 },
    { "lever:retireAge": 68 },
  ];
  for (let i = 0; i < n; i++) {
    const r = savePlan(wh, cat, { name: `${"BCDEFG"[i]}案 案${i + 1}`, base: null, values: vals[i % vals.length]!, now: NOW });
    wh = r.wh;
    ids.push(r.id);
  }
  return { wh, cat, ids };
}

const results = new Map<string, PreviewResult>();
const resultOf = (wh: WorkingHousehold, cat: Catalog, values: Values): PreviewResult => {
  const key = JSON.stringify(values);
  const hit = results.get(key);
  if (hit !== undefined) return hit;
  const r = preview(applyValues(wh, values, cat));
  results.set(key, r);
  return r;
};

describe("帯の案の選択", () => {
  it("案の文字: 現状は A、名前の頭の「B案」は文字にして名前から外す。重なる文字は空いている文字にする", () => {
    const { wh } = withPlans(2);
    const renamed = { ...wh, proposals: [...wh.proposals, { ...wh.proposals[0]!, id: "x", name: "B案 同じ文字" }, { ...wh.proposals[0]!, id: "y", name: "名前だけ" }] };
    const l = planLetters(renamed.proposals);
    expect(l.get(CURRENT)).toEqual({ letter: "A", name: "現状" });
    expect(l.get(wh.proposals[0]!.id)).toEqual({ letter: "B", name: "案1" });
    expect(l.get(wh.proposals[1]!.id)).toEqual({ letter: "C", name: "案2" });
    expect(l.get("x")!.letter).toBe("D");
    expect(l.get("x")!.name).toBe("同じ文字");
    expect(l.get("y")).toEqual({ letter: "E", name: "名前だけ" });
  });

  it("帯は現状＋5案まで。6つ目を足すと、選んでいない・基準でない案のうち最後のものが外れる（案は一覧に残る）", () => {
    expect(MAX_BAND).toBe(5);
    const band = ["b", "c", "d", "e", "f"];
    expect(addToBand(band.slice(0, 3), "g", [])).toEqual({ band: ["b", "c", "d", "g"], dropped: null });
    expect(addToBand(band, "g", ["f", "e"])).toEqual({ band: ["b", "c", "e", "f", "g"], dropped: "d" });
    expect(addToBand(band, "c", [])).toEqual({ band, dropped: null });
    // 消えた案は外し、重なりと6つ目以降を落とす
    const { wh, ids } = withPlans(6);
    expect(cleanBand([ids[0]!, "gone", ids[0]!, ...ids.slice(1)], wh.proposals)).toEqual(ids.slice(0, 5));
  });

  it("カード: 名前と「100歳まで足りる／○歳で不足」、基準・表示中・変更あり。計算中は「計算しています」", () => {
    const { wh, cat, ids } = withPlans(2);
    const letters = planLetters(wh.proposals);
    const cur = resultOf(wh, cat, {});
    const b = resultOf(wh, cat, wh.proposals[0]!.diffs.reduce((o, d) => ({ ...o, [d.key]: d.value.value }), {} as Values));
    const m = bandModel({ req: wh.request, slots: [CURRENT, ...ids], letters, results: new Map([[CURRENT, cur], [ids[0]!, b], [ids[1]!, null]]), modified: new Set([ids[0]!]), base: CURRENT, selected: ids[0]!, settings: DEFAULT_DISPLAY_SETTINGS });
    expect(m.cards.map((c) => [c.letter, c.status, c.base, c.shown, c.modified])).toEqual([
      ["A", "80歳で不足", true, false, false],
      ["B", "100歳まで足りる", false, true, true],
      ["C", "計算しています", false, false, false],
    ]);
    expect(m.cards[0]!.shortAge).toBe(80);
    expect(m.cards[1]!.shortAge).toBeNull();
    expect(m.cards[2]!.shortAge).toBeUndefined();
    // 既定では○歳時点の資産を出さない
    expect(m.cards.every((c) => c.metrics.length === 0)).toBe(true);
    expect(m.baseOptions.map((o) => o.label)).toEqual(["A 現状", "B 案1", "C 案2"]);
    expect(m.addNote).toBe("B案を写して動かす");
    // カードの鍵は文字だけ（案の ID は入らない）
    expect(JSON.stringify(m)).not.toContain(ids[0]!);
    expect(slotOfLetter(letters, [CURRENT, ...ids], "C")).toBe(ids[1]);
  });

  it("保存していない変更は案ごとに持つ（選び直しても消えない）。保存した中身と同じなら変更なし", () => {
    const { wh, cat, ids } = withPlans(2);
    const w: Work = { band: ids, base: CURRENT, sel: ids[0]!, drafts: { [ids[0]!]: { "lever:retireAge": 68, "lever:livingMonthly": 280000 }, [ids[1]!]: { "lever:retireAge": 70, "lever:livingMonthly": 280000 } } };
    expect([...modifiedSet(wh, cat, w)]).toEqual([ids[0]]);
    expect(valuesOf(wh, { ...w, sel: ids[1]! }, ids[0]!)["lever:retireAge"]).toBe(68);
    expect(valuesOf(wh, w, CURRENT)).toEqual({});
  });
});

describe("基準の切り替え", () => {
  const { wh, cat, ids } = withPlans(2);
  const valuesB: Values = { "lever:retireAge": 65, "lever:livingMonthly": 280000 };
  const valuesC: Values = { "lever:retireAge": 70, "lever:livingMonthly": 280000 };
  const rA = resultOf(wh, cat, {});
  const rB = resultOf(wh, cat, valuesB);
  const rC = resultOf(wh, cat, valuesC);
  const years = displayYears(wh.request);

  it("基準の案は灰の点線（current）、選んだ案は藍の実線（proposal）。1文は「B案は100歳まで足ります」と「A案（基準）は80歳で…」", () => {
    const m = toPresentation({ base: wh.request, proposal: applyValues(wh, valuesB, cat), current: rA, proposed: rB, targetAge: 95, selectedYear: null, provisional: false, names: { selected: "B案", base: "A案", same: false } });
    expect(m.result.parts.map((p) => p.text).join("")).toBe("B案は100歳まで足ります");
    expect(m.result.sub.map((p) => p.text).join("")).toBe("A案（基準）は80歳で資産が尽きます");
    expect(m.result.tone).toBe("up");
    expect(m.chart.current).toEqual(years.map((y) => financialOf(rA.table).get(y) ?? 0));
    expect(m.chart.proposal).toEqual(years.map((y) => financialOf(rB.table).get(y) ?? 0));
    expect(m.chart.depletions).toEqual([{ series: "current", year: 2061, label: "▲ A案 80歳で不足" }]);
    // 基準の案の線（年間収支・純資産）も基準の案の結果から
    expect(m.baseLines.net).toEqual(years.map((y) => sumByYear(rA.table, (c) => c.row === "cf.net").get(y) ?? 0));
  });

  it("基準を C案に替えると、点線と2行目が C案になる", () => {
    const m = toPresentation({ base: wh.request, proposal: applyValues(wh, valuesB, cat), current: rC, proposed: rB, targetAge: 95, selectedYear: null, provisional: false, names: { selected: "B案", base: "C案", same: false } });
    expect(m.chart.current).toEqual(years.map((y) => financialOf(rC.table).get(y) ?? 0));
    expect(m.result.sub.map((p) => p.text).join("")).toBe("C案（基準）は100歳まで足ります");
    expect(m.chart.depletions).toEqual([]);
  });

  it("基準の案を選んでいるとき（と現状を選んでいるとき）は、対策を動かせず理由を出す", () => {
    const letter = (id: string) => (id === CURRENT ? "A" : "B");
    expect(lockReason({ band: ids, base: CURRENT, sel: ids[0]!, drafts: {} }, letter)).toBeNull();
    expect(lockReason({ band: ids, base: ids[0]!, sel: ids[0]!, drafts: {} }, letter)).toContain("基準の案は動かせません");
    expect(lockReason({ band: ids, base: ids[0]!, sel: CURRENT, drafts: {} }, letter)).toContain("A案（現状）は入力の画面で直します");
    const same = toPresentation({ base: wh.request, proposal: wh.request, current: rA, proposed: rA, targetAge: 95, selectedYear: null, provisional: false, names: { selected: "A案", base: "A案", same: true } });
    expect(same.result.parts.map((p) => p.text).join("")).toBe("A案（基準）：80歳で資産が尽きます");
    expect(same.result.sub).toEqual([]);
  });

  it("表の差を表示: 年間収支と金融資産残高の下に「差（B−A）」の行（見ている案−基準）、基準と違うマスに印", () => {
    const req = applyValues(wh, valuesB, cat);
    const t = withDiff(req, cashflowTable(req, rB.table, years, "生涯キャッシュフロー表"), rB.table, rA.table, "差（B−A）");
    const keys = t.rows.map((r) => r.key);
    expect(keys[keys.indexOf("net") + 1]).toBe("diff:net");
    expect(keys[keys.indexOf("financial") + 1]).toBe("diff:financial");
    const d = t.rows.find((r) => r.key === "diff:financial");
    expect(d?.kind).toBe("diff");
    if (d?.kind !== "diff") return;
    years.forEach((y, i) => expect(d.cells[i]).toBe((financialOf(rB.table).get(y) ?? 0) - (financialOf(rA.table).get(y) ?? 0)));
    const fin = t.rows.find((r) => r.key === "financial");
    if (fin?.kind !== "total") throw new Error("financial");
    expect(fin.cells.some((c) => c.changed === true)).toBe(true);
    fin.cells.forEach((c, i) => expect(c.changed).toBe(d.cells[i] !== 0));
    const html = renderToString(
      h(CashflowTable, { model: t, selectedYear: 2041, onSelectYear: () => undefined, onEvidence: () => undefined, corner: "B案「案1」", controls: { plans: [{ key: "A", letter: "A" }, { key: "B", letter: "B" }], shown: "B", onShow: () => undefined, diff: { on: true, disabled: false, label: "差を表示（B−A）" }, onDiff: () => undefined } }),
    );
    expect(html).toContain("差（B−A）");
    expect(html).toContain("data-diff-row");
    expect(html).toContain(" chg");
  });
});

describe("○歳時点の表示の切り替え（既定では出さない）", () => {
  const { wh, cat } = withPlans(1);
  const rA = resultOf(wh, cat, {});
  const rB = resultOf(wh, cat, { "lever:retireAge": 65, "lever:livingMonthly": 280000 });
  const mA = metricsOf(wh.request, rA.table, 95);
  const mB = metricsOf(wh.request, rB.table, 95);

  it("既定: カード・1文・グラフに○歳時点の資産を出さない", () => {
    expect(DEFAULT_DISPLAY_SETTINGS.metrics).toEqual([]);
    expect(cardMetrics(DEFAULT_DISPLAY_SETTINGS, mB)).toEqual([]);
    expect(verdictMetrics(DEFAULT_DISPLAY_SETTINGS, { name: "B案", m: mB }, { name: "A案", m: mA })).toEqual([]);
    expect(ageMarkOf(DEFAULT_DISPLAY_SETTINGS, wh.request)).toBeNull();
    const m = toPresentation({ base: wh.request, proposal: wh.request, current: rA, proposed: rB, targetAge: 95, selectedYear: null, provisional: false, names: { selected: "B案", base: "A案", same: false } });
    const svg = renderToString(h(MainChart, { model: m, mode: "assets", explain: null, ageMark: null, onSelectYear: () => undefined }));
    expect(svg).not.toContain("m-age");
    expect(svg).not.toContain("dot-sel");
  });

  it("表示の設定で選ぶと、年齢を選んでカード・1文・グラフに出す（差はいつも選んだ案−基準）", () => {
    const s = { ...toggleMetric(DEFAULT_DISPLAY_SETTINGS, "assetsAtAge", true), atAge: 90 };
    const m90A = metricsOf(wh.request, rA.table, 90);
    const m90B = metricsOf(wh.request, rB.table, 90);
    expect(m90B.targetYear).toBe(2071);
    const man = (n: number) => `${n < 0 ? "▲" : ""}${Math.round(Math.abs(n) / 10000).toLocaleString("en-US")}`;
    expect(cardMetrics(s, m90B)).toEqual([{ label: "90歳時点", text: `${man(m90B.target)}万円`, neg: m90B.target < 0 }]);
    const parts = verdictMetrics(s, { name: "B案", m: m90B }, { name: "A案", m: m90A }).map((p) => p.text).join("");
    expect(parts).toContain(`90歳時点: B案 ${man(m90B.target)}万円`);
    expect(parts).toContain(`A案 ${man(m90A.target)}万円`);
    expect(parts).toContain(`差 +${man(m90B.target - m90A.target)}万円`);
    expect(ageMarkOf(s, wh.request)).toEqual({ year: 2071, label: "90歳" });
    // 生涯の手取りも足せる。並びは選択肢の順
    const s2 = toggleMetric(toggleMetric(DEFAULT_DISPLAY_SETTINGS, "takeHome", true), "assetsAtAge", true);
    expect(s2.metrics).toEqual(["assetsAtAge", "takeHome"]);
    expect(toggleMetric(s2, "assetsAtAge", false).metrics).toEqual(["takeHome"]);
    const m = toPresentation({ base: wh.request, proposal: wh.request, current: rA, proposed: rB, targetAge: 90, selectedYear: null, provisional: false, names: { selected: "B案", base: "A案", same: false } });
    const svg = renderToString(h(MainChart, { model: m, mode: "assets", explain: null, ageMark: ageMarkOf(s, wh.request), onSelectYear: () => undefined }));
    expect(svg).toContain("m-age");
    expect(svg).toContain("90歳");
  });
});

describe("グラフの補間", () => {
  it("少し行き過ぎて戻る動き: 始めは0、終わりは1、途中で1を少し超える", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 10);
    expect(easeOutBack(1)).toBe(1);
    const mid = [0.5, 0.6, 0.7, 0.8, 0.9].map(easeOutBack);
    expect(Math.max(...mid)).toBeGreaterThan(1);
    expect(Math.max(...mid)).toBeLessThan(1.15);
  });

  it("始めと終わりの値が一致し、途中は間の値になる", () => {
    const a = { x: [0, 100, -50], y: [10, 10, 10] };
    const b = { x: [100, 300, 50], y: [20, 0, 10] };
    expect(lerpSeries(a, b, 0)).toEqual(a);
    expect(lerpSeries(a, b, 1)).toEqual(b);
    const m = lerpSeries(a, b, 0.5);
    expect(m.x).toEqual([50, 200, 0]);
    m.x!.forEach((v, i) => {
      const lo = Math.min(a.x[i]!, b.x[i]!);
      const hi = Math.max(a.x[i]!, b.x[i]!);
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    });
    // 前に無い系列・長さの違う系列は新しい値のまま（崩れた形を描かない）
    expect(lerpSeries(a, { ...b, z: [1, 2] }, 0.5).z).toEqual([1, 2]);
    expect(lerpSeries({ x: [1, 2] }, b, 0.5).x).toEqual(b.x);
    expect(lerpSeries(null, b, 0.3)).toEqual(b);
  });

  it("同じ数字の束（先出しと正の計算が同じ）は同じと見る（動き直さない）", () => {
    expect(sameSeries({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(sameSeries({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(sameSeries({ a: [1, 2] }, { a: [1, 2], b: [] })).toBe(false);
    expect(sameSeries(null, { a: [] })).toBe(false);
  });

  it("グラフの高さは画面の高さに合わせる（ノートPCで約520px、最大700px、最小420px）", () => {
    expect(chartHeight(768, 16)).toBe(518);
    expect(chartHeight(1080, 16)).toBe(700);
    expect(chartHeight(600, 16)).toBe(420);
    expect(chartHeight(900, 19)).toBe(Math.round(900 - 250 * (19 / 16)));
  });
});

describe("配置の部品の組み立て", () => {
  const { wh, cat, ids } = withPlans(5);
  const letters = planLetters(wh.proposals);
  const rA = resultOf(wh, cat, {});
  const valuesB: Values = { "lever:retireAge": 65, "lever:livingMonthly": 280000 };
  const rB = resultOf(wh, cat, valuesB);
  const req = applyValues(wh, valuesB, cat);
  const m = toPresentation({ base: wh.request, proposal: req, current: rA, proposed: rB, targetAge: 95, selectedYear: 2041, provisional: false, names: { selected: "B案", base: "A案", same: false } });
  const band = bandModel({ req: wh.request, slots: [CURRENT, ...ids], letters, results: new Map([[CURRENT, rA], [ids[0]!, rB]]), modified: new Set(), base: CURRENT, selected: ids[0]!, settings: DEFAULT_DISPLAY_SETTINGS });
  const noop = () => undefined;
  const html = renderToString(
    h(
      "div",
      null,
      h(PlanBand, { model: band, onSelect: noop, onBase: noop, onAdd: noop }),
      h(ResultCard, { model: m, verdict: m.result, provisional: false, mode: "assets", onMode: noop, explain: null, onExplain: noop, ageMark: null, onSelectYear: noop }),
      h(CashflowTable, { model: m.table, selectedYear: m.selectedYear, onSelectYear: noop, onEvidence: noop }),
    ),
  );

  it("上から 案の帯 → グラフ → 表。帯は現状＋5案のカードと「＋ この案を元に作る」", () => {
    const at = (s: string) => html.indexOf(s);
    expect(at("data-band")).toBeGreaterThanOrEqual(0);
    expect(at("data-band")).toBeLessThan(at("data-result-card"));
    expect(at("data-result-card")).toBeLessThan(at("data-cf-card"));
    expect(html.match(/data-plan-card=/g)).toHaveLength(6);
    expect(html).toContain("＋ この案を元に作る");
    expect(html).toContain("表示中");
    expect(html).toContain("基準");
    // グラフは2本だけ（選んだ案の実線・基準の案の点線）
    expect(html.match(/class="line-prop"/g)).toHaveLength(1);
    expect(html.match(/class="line-base"/g)).toHaveLength(1);
    // 切り替えと説明モード
    for (const t of ["資産の推移", "収支の推移", "資産と負債の推移", "説明モード"]) expect(html).toContain(t);
    // 左の「目標」の欄は出さない
    expect(html).not.toContain("<h2>目標</h2>");
  });

  it("FP用のメモの目印も物の ID も、配置した部品に出ない（0016 の2）", () => {
    expect(html).not.toContain(MARK);
    for (const x of wh.request.input.household.members) expect(html).not.toContain(x.id);
    for (const id of ids) expect(html).not.toContain(id);
  });
});

describe("帯から外した案の枠を消す", () => {
  it("retain: 残す枠のほかを消し、画面側のエンジンの枠も消す", () => {
    const sets: string[] = [];
    const session = { set: (j: string) => (sets.push(j), "{}"), compute: (ids: string) => JSON.stringify(Object.fromEntries((JSON.parse(ids) as string[]).map((i) => [i, { result: { error: { code: "E_TEST" } } }]))), results: () => "{}", status: () => "{}", slide: () => '{"focus":{}}', release: () => "{}" } as unknown as WebSession;
    const host = { kind: "browser-dev", compute: async () => ({ ms: 0, slots: {} }) } as unknown as HostApi;
    const d = new DualEngine({ session, host, onChange: () => undefined, setTimer: () => 0, clearTimer: () => undefined });
    const req = modelHousehold("salariedCoupleTwoKids");
    void d.set({ a: req, b: req, c: req });
    expect(d.retain(["a", "c"])).toEqual(["b"]);
    expect(sets.at(-1)).toBe('{"b":null}');
    expect(d.view("b").result).toBeNull();
    expect(d.retain(["a", "c"])).toEqual([]);
  });
});

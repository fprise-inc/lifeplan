// 主画面の直し: 年のイベントの丸（真ん中の漢字・大きさ・重ならない並べ方・カーソルとフォーカスで表示）、
// グラフを左右に並べる表示（表示の設定。既定は重ねる）、年齢のつまみを1歳ずつ
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { eventRows, spreadX } from "../src/presentation/chart.ts";
import { EVENT_R, MainChart, MainLegend, planModel, planSeries, scaleInputs, sideLayout, SIDE_STACK_BELOW, type ChartMode } from "../src/presentation/MainChart.tsx";
import { ResultCard } from "../src/presentation/MainView.tsx";
import { placeAbove } from "../src/presentation/yearPick.ts";
import { parseHash } from "../src/workspace/App.tsx";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { DisplaySettingsPanel } from "../src/workspace/DisplaySettingsPanel.tsx";
import { fromRequest } from "../src/workspace/input/household.ts";
import { readLevers } from "../src/workspace/levers.ts";
import { ageControl, buildCatalog, PENSION_AGE_RANGE } from "../src/workspace/plans/items.ts";
import { applyValues, type Values } from "../src/workspace/plans/plans.ts";
import { toPresentation } from "../src/workspace/present.ts";
import { roles } from "../src/workspace/roles.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;

function openDemo() {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold("salariedCoupleTwoKids")!;
  const re = demo.reemployment!;
  const wh = fromRequest(req, { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } });
  return { wh, cat: buildCatalog(wh, self.id, demo), selfId: self.id };
}

const demo = openDemo();
const valuesB: Values = { "lever:retireAge": 65, "lever:livingMonthly": 280000 };
const reqB = applyValues(demo.wh, valuesB, demo.cat);
const rA = preview(demo.wh.request);
const rB = preview(reqB);
const model = (selectedYear: number | null = null) =>
  toPresentation({ base: demo.wh.request, proposal: reqB, current: rA, proposed: rB, targetAge: 95, selectedYear, provisional: false, names: { selected: "B案", base: "A案", same: false } });

/** SVG ごとの縦の目盛りの数字（右寄せの axis-label） */
const tickLabels = (html: string) => html.split("<svg").slice(1).map((svg) => [...svg.matchAll(/class="axis-label" text-anchor="end">([^<]+)</g)].map((m) => m[1]));

describe("年のイベントの丸", () => {
  it("重なる丸は横に並べ直す: どの2つも間隔 gap 以上、範囲からはみ出さない、まとまりの中心は元の位置の平均", () => {
    const xs = [100, 100, 104, 300, 500, 505, 990];
    const out = spreadX(xs, 28, 50, 980);
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(28 - 1e-9);
    for (const x of out) {
      expect(x).toBeGreaterThanOrEqual(50);
      expect(x).toBeLessThanOrEqual(980);
    }
    expect(out[3]).toBe(300);
    expect((out[0]! + out[1]! + out[2]!) / 3).toBeCloseTo(304 / 3 + 0, 0);
    expect((out[4]! + out[5]!) / 2).toBeCloseTo(502.5);
    expect(out[6]).toBe(980);
    // 同じ位置の丸は順番どおり左から
    expect(out[0]!).toBeLessThan(out[1]!);
  });

  it("狭いグラフで大きくずれるまとまりは交互に2段目へ。ずれが小さいときは1段のまま", () => {
    expect(eventRows([100, 100, 300], 28, 14)).toEqual([0, 0, 0]);
    const dense = [100, 111, 122, 133, 144, 300];
    const rows = eventRows(dense, 28, 14);
    expect(rows.slice(0, 5)).toEqual([0, 1, 0, 1, 0]);
    expect(rows[5]).toBe(0);
  });

  it("イベントの表示は丸の真上の中央。上に入らなければ下。枠からはみ出さない", () => {
    const p = placeAbove(500, 400, 425, 200, 30, 1000, 500);
    expect(p.left).toBe(400);
    expect(p.top + 30).toBeLessThanOrEqual(400);
    const edge = placeAbove(10, 400, 425, 200, 30, 1000, 500);
    expect(edge.left).toBe(4);
    const top = placeAbove(500, 20, 45, 200, 30, 1000, 500);
    expect(top.top).toBeGreaterThanOrEqual(45);
  });

  it("丸は半径12.5（文字の大きさに比例）、漢字は dominant-baseline で真ん中。キーボードで選べ、年と中身を読み上げる（<title> は使わない）", () => {
    const m = model();
    const html = renderToString(h(MainChart, { model: m, mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop }));
    const evs = html.match(/<g class="ev( [^"]*)?" [^>]*>/g) ?? [];
    expect(evs.length).toBe(m.events.length);
    for (const g of evs) {
      expect(g).toMatch(/tabindex="0"/i);
      expect(g).toMatch(/aria-label="\d{4}年 [^"]+"/);
    }
    expect(html).toContain(`<circle r="${EVENT_R}"></circle>`);
    expect(html).toMatch(/<text text-anchor="middle" dominant-baseline="central">学<\/text>/);
    expect(html).not.toContain("<title>");
    // 丸は年を読む面より上に置く（カーソルを合わせられる）
    expect(html.indexOf("data-hit-area")).toBeLessThan(html.indexOf('class="evs"'));
  });
});

describe("グラフを左右に並べる表示（表示の設定）", () => {
  it("既定は重ねる（1つのグラフ）。表示の設定の既定も重ねる", () => {
    expect(DEFAULT_DISPLAY_SETTINGS.layout).toBe("overlay");
    const html = renderToString(h(MainChart, { model: model(), mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop }));
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain('data-chart-layout="overlay"');
  });

  it("左右に並べる: 左に基準の案、右に選んだ案。各グラフの上に案の名前。線は1本ずつ", () => {
    const html = renderToString(h(MainChart, { model: model(), mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop, layout: "side" }));
    expect(html).toContain('data-chart-layout="side"');
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html.indexOf('data-side="base"')).toBeLessThan(html.indexOf('data-side="selected"'));
    expect(html).toMatch(/<b>A案<\/b><span class="side-tag">基準<\/span>/);
    expect(html).toMatch(/<b>B案<\/b><span class="side-tag">選んだ案<\/span>/);
    expect(html).not.toContain('class="line-base"');
    expect(html.match(/class="line-prop"/g)).toHaveLength(2);
  });

  for (const mode of ["assets", "flows", "balance"] as ChartMode[])
    it(`縦の目盛りは2つのグラフでそろえる（${mode}）。グラフの種類も同じ`, () => {
      const html = renderToString(h(MainChart, { model: model(), mode, explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop, layout: "side" }));
      const [a, b] = tickLabels(html);
      expect(a!.length).toBeGreaterThan(2);
      expect(a).toEqual(b);
      expect(html).toContain(`data-main-chart="${mode}"`);
    });

  it("目盛りは両方の案を覆う（基準の案の系列は基準の積み上げから読む）", () => {
    const m = model();
    const t = { "a.sel": m.chart.proposal, "a.base": m.chart.current, "f.net": m.flows.net, "f.bnet": m.baseLines.net, "bb.short": m.baseCharts.balance.shortfall, "b.bnw": m.baseLines.netWorth };
    const base = planSeries(t, "base");
    expect(base["a.sel"]).toBe(m.chart.current);
    expect(base["f.net"]).toBe(m.baseLines.net);
    expect(base["b.short"]).toBe(m.baseCharts.balance.shortfall);
    const pb = planModel(m, "base");
    expect(pb.names).toEqual({ selected: "A案", base: "A案", same: true });
    expect(pb.flows).toBe(m.baseCharts.flows);
    expect(pb.events).toBe(m.baseCharts.events);
    expect(pb.chart.depletions.every((d) => d.series === "proposal")).toBe(true);
    const ps = planModel(m, "selected");
    expect(ps.names.same).toBe(true);
    expect(ps.chart.current).toBe(m.chart.proposal);
    expect(scaleInputs(ps, t, "assets", m.chart.years.length)).toHaveLength(1);
  });

  it("年の固定は2つのグラフで同じ年（両方に○と表示）。読み上げは片方だけ", () => {
    const html = renderToString(h(MainChart, { model: model(), mode: "flows", explain: null, ageMark: null, pinnedYear: 2045, onSelectYear: noop, layout: "side" }));
    expect(html.match(/data-year-tip/g)).toHaveLength(2);
    expect(html.match(/class="hv-dot sel"/g)).toHaveLength(2);
    expect(html).not.toContain('class="hv-dot base"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toMatch(/収入 [\d,▲]+万円・支出 [\d,▲]+万円（A案）/);
    expect(html).toMatch(/収入 [\d,▲]+万円・支出 [\d,▲]+万円（B案）/);
  });

  it("説明モードと、選んだ案が基準の案のときは重ねる表示（1つのグラフ）のまま", () => {
    const ex = { model: { title: "説明", years: [], ages: [], steps: [{ key: "income" as const, title: "収入", sentence: [] }], work: [], pension: [], living: [], education: [], housing: [], financial: [] }, step: 0 };
    const a = renderToString(h(MainChart, { model: model(), mode: "assets", explain: ex, ageMark: null, pinnedYear: null, onSelectYear: noop, layout: "side" }));
    expect(a.match(/<svg/g)).toHaveLength(1);
    const m = model();
    const same = { ...m, names: { selected: "A案", base: "A案", same: true } };
    const b = renderToString(h(MainChart, { model: same, mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop, layout: "side" }));
    expect(b.match(/<svg/g)).toHaveLength(1);
  });

  it("狭い窓では縦に積む（幅の境は文字の大きさに比例）", () => {
    expect(sideLayout(SIDE_STACK_BELOW - 1, 520, 1).stacked).toBe(true);
    const row = sideLayout(1200, 520, 1);
    expect(row.stacked).toBe(false);
    expect(row.w * 2 + row.gap).toBeLessThanOrEqual(1200);
    expect(sideLayout(1000, 520, 1.25).stacked).toBe(true);
  });

  it("凡例: 左右に並べるときは案の名前を外し、線の種類だけ。結論の1文・グラフの切り替えはそのまま", () => {
    const m = model();
    const lg = renderToString(h(MainLegend, { model: m, mode: "flows", explain: null, side: true }));
    expect(lg).toContain("年間収支");
    expect(lg).not.toContain("年間収支 B案");
    expect(lg).not.toContain("（基準）");
    const card = renderToString(h(ResultCard, { model: m, verdict: m.result, provisional: false, mode: "assets", onMode: noop, layout: "side", explain: null, onExplain: noop, ageMark: null, pinnedYear: null, onSelectYear: noop }));
    expect(card).toContain("data-verdict");
    expect(card).toContain('data-chart-layout="side"');
    expect(card).toContain("data-chart-tab");
  });

  it("基準の案の年のイベントは基準の案の要求から（働く最後の年齢が違えば退職の年も違う）", () => {
    const m = toPresentation({ base: demo.wh.request, proposal: reqB, current: rB, proposed: rA, targetAge: 95, selectedYear: null, provisional: false, names: { selected: "A案", base: "B案", same: false }, baseProposal: reqB });
    const retire = (evs: { icon: string; text: string; year: number }[]) => evs.find((e) => e.icon === "退" && e.text.startsWith("ご主人"))?.year;
    expect(retire(m.baseCharts.events)).toBe(retire(toPresentation({ base: demo.wh.request, proposal: reqB, current: rA, proposed: rB, targetAge: 95, selectedYear: null, provisional: false }).events));
  });

  it("表示の設定に「比べ方: 重ねる（既定）／左右に並べる」。URL の #layout=side でも開ける", () => {
    const html = renderToString(h(DisplaySettingsPanel, { value: DEFAULT_DISPLAY_SETTINGS, onChange: noop, onClose: noop, feeAvailable: false }));
    expect(html).toContain("比べ方");
    expect(html).toMatch(/value="overlay" checked/);
    expect(html).toContain("重ねる（既定）");
    expect(html).toContain("左右に並べる");
    expect(parseHash("#layout=side").layout).toBe("side");
    expect(parseHash("#layout=x").layout).toBeUndefined();
  });
});

describe("年齢のつまみは1歳ずつ", () => {
  it("年金の受け取り開始は60〜75歳の中に収める。目盛りの数字は範囲の中の段だけ", () => {
    const c = ageControl([58, 60, 65, 70, 80], String, PENSION_AGE_RANGE);
    expect([c.min, c.max]).toEqual([60, 75]);
    expect(c.ticks).toEqual([60, 65, 70]);
    expect(ageControl([60, 62, 65], String, null)).toMatchObject({ min: 60, max: 65, ticks: [60, 62, 65] });
  });

  it("エンジンは範囲のどの年齢も受け付け、受け取り開始・退職の年が1歳ずつ動く", () => {
    const self = roles(demo.wh.request).find((r) => r.key === "self")!;
    const birthY = Number(self.member.birth.birthYearMonth.slice(0, 4));
    expect(readLevers(demo.wh.request, demo.selfId).pensionAge).toBeDefined();
    for (const k of ["pensionAge", "retireAge"] as const) {
      const c = demo.cat.byKey.get(`lever:${k}`)!.control;
      if (c.kind !== "age") throw new Error("年齢のつまみではない");
      let prev: number | null = null;
      for (let age = c.min; age <= c.max; age++) {
        const req = applyValues(demo.wh, { [`lever:${k}`]: age }, demo.cat);
        expect(readLevers(req, demo.selfId)[k], `${k}=${age}`).toBe(age);
        const r = preview(req);
        const m = toPresentation({ base: demo.wh.request, proposal: req, current: rA, proposed: r, targetAge: 95, selectedYear: null, provisional: false });
        const ev = m.events.find((e) => e.icon === (k === "pensionAge" ? "年" : "退") && e.text.startsWith(self.label));
        expect(ev, `${k}=${age}`).toBeDefined();
        expect(ev!.year - birthY).toBeGreaterThanOrEqual(age);
        if (prev !== null) expect(ev!.year).toBeGreaterThanOrEqual(prev);
        prev = ev!.year;
        if (k === "pensionAge") {
          // 受け取りは開始の年から（それより前の年に年金の収入が無い）
          const pension = m.flows.income.find((s) => s.key === "pension")!;
          const i = m.chart.years.indexOf(ev!.year);
          expect(pension.values[i - 1] ?? 0).toBeLessThanOrEqual(pension.values[i + 1] ?? 0);
        }
      }
    }
  });
});

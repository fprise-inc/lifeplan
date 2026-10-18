// 比べ方「全部の案を色分けで重ねる」: 案ごとの線の見た目（色・線の種類・印の形）、資産・収支・資産と負債の3つのグラフ、
// 凡例の強調と一時的に隠す、年の表示（全部の案の値を帯の順に）、帯のカードの印、説明モードでは1本のまま、提示層に渡すのは案の名前と数字だけ
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { MainChart, multiOn, type ChartMode, type MainChartModel } from "../src/presentation/MainChart.tsx";
import { ResultCard } from "../src/presentation/MainView.tsx";
import type { PlanBandModel, PlanLineModel, PresentationModel } from "../src/presentation/model.ts";
import { PlanBand } from "../src/presentation/PlanBand.tsx";
import { BASE_STYLE, MultiLegend, PLAN_STYLES, planStyles } from "../src/presentation/planLines.tsx";
import { parseHash } from "../src/workspace/App.tsx";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { DisplaySettingsPanel } from "../src/workspace/DisplaySettingsPanel.tsx";
import { fromRequest } from "../src/workspace/input/household.ts";
import { CURRENT, planLinesModel } from "../src/workspace/plans/band.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues, type Values } from "../src/workspace/plans/plans.ts";
import { displayYears, toPresentation } from "../src/workspace/present.ts";
import { roles } from "../src/workspace/roles.ts";
import { DEFAULT_DISPLAY_SETTINGS, LAYOUT_CHOICES } from "../src/workspace/settings.ts";
import { APP_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;

const req0 = modelHousehold("salariedCoupleTwoKids");
const selfMember = roles(req0).find((r) => r.key === "self")!.member;
const demo = demoHousehold("salariedCoupleTwoKids")!;
const re = demo.reemployment!;
const wh = fromRequest(req0, { postRetirement: { [selfMember.id]: { ...re, type: re.type as "contract" } } });
const cat = buildCatalog(wh, selfMember.id, demo);
const values: Record<string, Values> = {
  b: { "lever:retireAge": 65, "lever:livingMonthly": 280000 },
  c: { "lever:retireAge": 70 },
  d: { "lever:livingMonthly": 380000 },
};
const reqs = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, applyValues(wh, v, cat)]));
const results = new Map([[CURRENT, preview(wh.request)], ...Object.entries(reqs).map(([k, r]) => [k, preview(r)] as const)]);
const letters = new Map([
  [CURRENT, { letter: "A", name: "現状" }],
  ["b", { letter: "B", name: "65歳まで働く" }],
  ["c", { letter: "C", name: "70歳まで働く" }],
  ["d", { letter: "D", name: "生活費を増やす" }],
]);
const slots = [CURRENT, "b", "c", "d"];
const lines = (pending: string[] = []) =>
  planLinesModel({ req: wh.request, slots, letters, results: new Map([...results].map(([k, v]) => [k, pending.includes(k) ? null : v])), base: CURRENT, selected: "b" });

const model = (plans: PlanLineModel[] = lines()): PresentationModel & MainChartModel => ({
  ...toPresentation({ base: wh.request, proposal: reqs.b!, current: results.get(CURRENT)!, proposed: results.get("b")!, targetAge: 95, selectedYear: null, provisional: false, names: { selected: "B案", base: "A案", same: false } }),
  plans,
});

const draw = (mode: ChartMode, extra: Record<string, unknown> = {}) => renderToString(h(MainChart, { model: model(), mode, explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop, layout: "all", ...extra }));
const tickLabels = (html: string) => [...html.matchAll(/class="axis-label" text-anchor="end">([^<]+)</g)].map((m) => m[1]);

/** 白地とのコントラスト比 */
function contrast(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return 1.05 / (l + 0.05);
}

describe("案ごとの線の見た目", () => {
  it("基準の案は灰の破線と白抜きの丸。ほかは帯の順に、色・線の種類・印の形がすべて違う（色だけに頼らない）", () => {
    const st = planStyles([
      { key: "A", base: true },
      { key: "B", base: false },
      { key: "C", base: false },
      { key: "D", base: false },
      { key: "E", base: false },
      { key: "F", base: false },
    ]);
    expect(st.get("A")).toBe(BASE_STYLE);
    expect(BASE_STYLE.dash).not.toBe("");
    const others = ["B", "C", "D", "E", "F"].map((k) => st.get(k)!);
    for (const prop of ["color", "dash", "marker"] as const) expect(new Set([...others.map((s) => s[prop]), BASE_STYLE[prop]]).size).toBe(6);
    expect(others[0]).toBe(PLAN_STYLES[0]);
  });

  it("基準の案が現状でなくても、基準の案だけが灰の破線。ほかの案は帯の順に詰めて割り当てる", () => {
    const st = planStyles([
      { key: "A", base: false },
      { key: "B", base: true },
      { key: "C", base: false },
    ]);
    expect(st.get("B")).toBe(BASE_STYLE);
    expect(st.get("A")).toBe(PLAN_STYLES[0]);
    expect(st.get("C")).toBe(PLAN_STYLES[1]);
  });

  it("基準でない案の線の色は白地で 3:1 以上。基準の案は重ねる表示の基準の線と同じ色（--base）", () => {
    for (const s of PLAN_STYLES) expect(contrast(s.color)).toBeGreaterThanOrEqual(3);
    const css = readFileSync(join(APP_DIR, "src/styles/app.css"), "utf-8");
    expect(css).toContain(`--base: ${BASE_STYLE.color};`);
  });
});

describe("全部の案の線の値（作業の層）", () => {
  it("帯の順に、案の名前と、金融資産・年間収支・純資産の数字だけ。計算中の案は null", () => {
    const ls = lines(["c"]);
    expect(ls.map((l) => l.key)).toEqual(["A", "B", "C", "D"]);
    for (const l of ls) expect(Object.keys(l).sort()).toEqual(["base", "financial", "key", "name", "net", "netWorth", "selected", "title"]);
    expect(ls[0]).toMatchObject({ name: "A案", title: "現状", base: true, selected: false });
    expect(ls[1]).toMatchObject({ name: "B案", base: false, selected: true });
    const n = displayYears(wh.request).length;
    expect(ls[1]!.financial).toHaveLength(n);
    expect(ls[1]!.net).toHaveLength(n);
    expect(ls[1]!.netWorth).toHaveLength(n);
    expect(ls[2]).toMatchObject({ financial: null, net: null, netWorth: null });
    // 選んだ案の線は、重ねる表示の選んだ案の線と同じ数字
    const m = model(ls);
    expect(ls[1]!.financial).toEqual(m.chart.proposal);
    expect(ls[1]!.net).toEqual(m.flows.net);
    expect(ls[1]!.netWorth).toEqual(m.balance.netWorth);
  });
});

describe("全部の案を色分けで重ねるグラフ", () => {
  for (const mode of ["assets", "flows", "balance"] as ChartMode[])
    it(`${mode}: 1つのグラフに全部の案の線（色・線の種類・右端の印と文字）。積み上げの棒・不足の塗りは描かない`, () => {
      const html = draw(mode);
      expect(html).toContain('data-chart-layout="all"');
      expect(html.match(/<svg/g)).toHaveLength(1);
      expect(html.match(/class="multi-line"/g)).toHaveLength(4);
      for (const k of ["A", "B", "C", "D"]) expect(html).toContain(`data-multi-line="${k}"`);
      expect(html).not.toMatch(/class="bar /);
      expect(html).not.toContain('class="area-short"');
      expect(html).not.toContain('class="line-prop"');
      // 基準の案は灰の破線、選んだ案はいちばん上（最後）に描く
      expect(html).toMatch(new RegExp(`data-multi-line="A"><path [^>]*stroke="${BASE_STYLE.color}" stroke-dasharray="${BASE_STYLE.dash}"`));
      expect(html.lastIndexOf("data-multi-line=")).toBe(html.indexOf('data-multi-line="B"'));
      expect(html.match(/class="ml-end"/g)).toHaveLength(4);
    });

  it("0未満の範囲は線に塗りを付けず、薄い地と言葉で示す（不足が出る案があるとき）", () => {
    const html = draw("assets");
    expect(html).toContain('class="multi-zone"');
    expect(html).toContain("0未満は不足");
  });

  it("年を固定すると、全部の案の線の上に印、表示に全部の案の値を帯の順で（読み上げは1か所）", () => {
    const m = model();
    const y = m.chart.years[30]!;
    const html = renderToString(h(MainChart, { model: m, mode: "flows", explain: null, ageMark: null, pinnedYear: y, onSelectYear: noop, layout: "all" }));
    expect(html).toContain(`data-pinned-year="${y}"`);
    expect(html.match(/class="pl-mk[^"]* hv-mk"/g)).toHaveLength(4);
    const order = [...html.matchAll(/data-tip-plan="([A-Z])"/g)].map((x) => x[1]);
    expect(order).toEqual(["A", "B", "C", "D"]);
    expect(html).toContain("年間収支（帯の順）");
    expect(html.match(/role="status"/g)).toHaveLength(1);
    const i = m.chart.years.indexOf(y);
    const net = m.plans![2]!.net![i]!;
    expect(html).toContain(`${net < 0 ? "▲" : ""}${Math.abs(Math.round(net / 10000)).toLocaleString("en-US")}万円`);
  });

  it("凡例で合わせた案を強調し、ほかを薄くする", () => {
    const html = draw("assets", { multi: { focus: "C", hidden: [] } });
    expect(html).toMatch(/class="ml dim[^"]*" data-multi-line="A"/);
    expect(html).toMatch(/class="ml hi" data-multi-line="C"/);
    // 強調している案はいちばん上に描く
    expect(html.lastIndexOf("data-multi-line=")).toBe(html.indexOf('data-multi-line="C"'));
  });

  it("一時的に隠した案は描かず、年の表示にも出さない。縦の目盛りは動かない", () => {
    const all = draw("assets");
    const hid = draw("assets", { multi: { focus: null, hidden: ["D"] }, pinnedYear: model().chart.years[10] });
    expect(hid).not.toContain('data-multi-line="D"');
    expect(hid).not.toContain('data-tip-plan="D"');
    expect(tickLabels(hid)).toEqual(tickLabels(all));
  });

  it("説明モードでは今のまま1本で説明する。線が1本も計算できていなければ重ねる表示", () => {
    const ex = { model: { title: "説明", years: [], ages: [], steps: [{ key: "income" as const, title: "収入", sentence: [] }], work: [], pension: [], living: [], education: [], housing: [], financial: [] }, step: 0 };
    const html = renderToString(h(MainChart, { model: model(), mode: "assets", explain: ex, ageMark: null, pinnedYear: null, onSelectYear: noop, layout: "all" }));
    expect(html).not.toContain("multi-line");
    expect(html).toContain('data-chart-layout="overlay"');
    expect(multiOn("all", null, model(lines(["a", CURRENT, "b", "c", "d"])))).toBe(false);
    expect(multiOn("all", null, model())).toBe(true);
    expect(multiOn("overlay", null, model())).toBe(false);
  });

  it("縮めた表示（操作中に上に付いてくるグラフ）でも同じ線を描く", () => {
    const html = draw("balance", { height: 260 });
    expect(html).toContain("compact");
    expect(html.match(/class="multi-line"/g)).toHaveLength(4);
  });
});

describe("凡例と帯のカード", () => {
  it("凡例: 何の線かの見出し、案ごとの見本と名前。押すと隠す・戻す（aria-pressed）。計算中の案は押せない", () => {
    const html = renderToString(h(MultiLegend, { plans: lines(["d"]), mode: "flows", focus: null, onFocus: noop, hidden: ["C"], onToggle: noop }));
    expect(html).toContain("全部の案の年間収支");
    expect(html).toContain("積み上げの棒は出しません");
    expect(html).toMatch(/aria-pressed="false"[^>]*data-multi-item="C"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-multi-item="A"/);
    expect(html).toMatch(/disabled[^>]*data-multi-item="D"/);
    expect(html).toContain("計算中");
    expect(html.match(/class="pl-sw"/g)).toHaveLength(4);
  });

  it("資産と負債の推移の見出しは純資産", () => {
    const html = renderToString(h(MultiLegend, { plans: lines(), mode: "balance", focus: null, onFocus: noop, hidden: [], onToggle: noop }));
    expect(html).toContain("全部の案の純資産（資産−負債）");
  });

  it("グラフの枠: 全部の案を重ねるときは全部の案の凡例（重ねる表示の凡例は出さない）", () => {
    const m = model();
    const card = renderToString(h(ResultCard, { model: m, verdict: m.result, provisional: false, mode: "assets", onMode: noop, layout: "all", explain: null, onExplain: noop, ageMark: null, pinnedYear: null, onSelectYear: noop, multi: { hidden: [], onToggle: noop } }));
    expect(card).toContain("data-multi-legend");
    expect(card).not.toContain("（選んだ案）");
    const over = renderToString(h(ResultCard, { model: m, verdict: m.result, provisional: false, mode: "assets", onMode: noop, layout: "overlay", explain: null, onExplain: noop, ageMark: null, pinnedYear: null, onSelectYear: noop }));
    expect(over).not.toContain("data-multi-legend");
  });

  it("帯のカードの印はこの表示のときだけ。グラフの線と同じ見た目", () => {
    const band: PlanBandModel = {
      cards: ["A", "B", "C"].map((k, i) => ({ key: k, letter: k, name: k, shortAge: null, status: "100歳まで足りる", base: i === 0, shown: i === 1, modified: false, metrics: [] })),
      baseOptions: [],
      base: "A",
      addNote: "",
    };
    const off = renderToString(h(PlanBand, { model: band, onSelect: noop, onBase: noop, onAdd: noop }));
    expect(off).not.toContain("data-plan-mark");
    const on = renderToString(h(PlanBand, { model: band, onSelect: noop, onBase: noop, onAdd: noop, lineMarks: true }));
    expect(on.match(/data-plan-mark=/g)).toHaveLength(3);
    expect(on).toMatch(new RegExp(`data-plan-mark="A"><svg[^>]*><line [^>]*stroke="${BASE_STYLE.color}"`));
    expect(on).toMatch(new RegExp(`data-plan-mark="B"><svg[^>]*><line [^>]*stroke="${PLAN_STYLES[0]!.color}"`));
  });
});

describe("表示の設定", () => {
  it("比べ方に「全部の案を色分けで重ねる」。既定は重ねるのまま。URL の #layout=all でも開ける", () => {
    expect(DEFAULT_DISPLAY_SETTINGS.layout).toBe("overlay");
    expect(LAYOUT_CHOICES.map((c) => c.key)).toEqual(["overlay", "side", "all"]);
    const html = renderToString(h(DisplaySettingsPanel, { value: { ...DEFAULT_DISPLAY_SETTINGS, layout: "all" }, onChange: noop, onClose: noop, feeAvailable: false }));
    expect(html).toContain("全部の案を色分けで重ねる");
    expect(html).toMatch(/value="all" checked/);
    expect(parseHash("#layout=all").layout).toBe("all");
  });
});

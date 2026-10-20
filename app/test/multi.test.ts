// 比べ方「全部のプランを色分けで重ねる」: プランごとの線の色（実線・同じ丸。色はプランの内部 ID ごとに固定）、資産・収支の2つのグラフ（資産と負債の推移は「資産と負債」のタブ）、
// 凡例の強調と一時的に隠す（縦の目盛りはできるだけ動かさない）、年の表示（全部のプランの値を帯の順に）、帯のカードの印、説明モードでは1本のまま、
// 提示層に渡すのはプランの名前と色の番号と数字だけ
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { MainChart, multiOn, type ChartMode, type MainChartModel } from "../src/presentation/MainChart.tsx";
import { ResultCard } from "../src/presentation/MainView.tsx";
import type { PlanBandModel, PlanLineModel, PresentationModel } from "../src/presentation/model.ts";
import { PlanBand } from "../src/presentation/PlanBand.tsx";
import { colorStyle, MultiLegend, PLAN_COLOR_STYLES, PLAN_COLORS, planStyles } from "../src/presentation/planLines.tsx";
import { domainOf, multiDomain, RESCALE_BELOW } from "../src/presentation/chart.ts";
import { parseHash } from "../src/workspace/App.tsx";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { DisplaySettingsPanel } from "../src/workspace/DisplaySettingsPanel.tsx";
import { fromRequest } from "../src/workspace/input/household.ts";
import { assignColors, CURRENT, planLinesModel } from "../src/workspace/plans/band.ts";
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
const colors = assignColors(new Map(), ["b", "c", "d"], (id) => letters.get(id)?.letter, PLAN_COLORS);
const lines = (pending: string[] = [], base = CURRENT) =>
  planLinesModel({ req: wh.request, slots, letters, results: new Map([...results].map(([k, v]) => [k, pending.includes(k) ? null : v])), base, selected: "b", colors });

const model = (plans: PlanLineModel[] = lines()): PresentationModel & MainChartModel => ({
  ...toPresentation({ base: wh.request, proposal: reqs.b!, current: results.get(CURRENT)!, proposed: results.get("b")!, targetAge: 95, selectedYear: null, provisional: false, names: { selected: "プランB", base: "プランA", same: false } }),
  plans,
});

const draw = (mode: ChartMode, extra: Record<string, unknown> = {}) => renderToString(h(MainChart, { model: model(), mode, explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop, layout: "all", ...extra }));
const tickLabels = (html: string) => [...html.matchAll(/class="axis-label" text-anchor="end">([^<]+)</g)].map((m) => m[1]);

const linear = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));

/** 白地とのコントラスト比 */
function contrast(hex: string): number {
  const c = linear(hex);
  const l = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return 1.05 / (l + 0.05);
}

/** 色の見分け方の違い（1型・2型・3型。強さ 1.0）を模した変換（線形 RGB にかける行列） */
const CVD: Record<string, number[][]> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
const simulate = (hex: string, m: number[][]) => {
  const c = linear(hex);
  return m.map((r) => Math.min(1, Math.max(0, r[0]! * c[0]! + r[1]! * c[1]! + r[2]! * c[2]!)));
};
/** 線形 RGB → L*a*b* */
function lab(c: number[]): [number, number, number] {
  const x = (0.4124 * c[0]! + 0.3576 * c[1]! + 0.1805 * c[2]!) / 0.95047;
  const y = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  const z = (0.0193 * c[0]! + 0.1192 * c[1]! + 0.9505 * c[2]!) / 1.08883;
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** 色差（CIEDE2000） */
function deltaE([l1, a1, b1]: [number, number, number], [l2, a2, b2]: [number, number, number]): number {
  const rad = Math.PI / 180;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cb = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cb ** 7 / (cb ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + g);
  const ap2 = a2 * (1 + g);
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hue = (x: number, y: number) => {
    const v = Math.atan2(y, x) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1 = hue(ap1, b1);
  const h2 = hue(ap2, b2);
  let dh = h2 - h1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dL = l2 - l1;
  const dC = cp2 - cp1;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh * rad) / 2);
  const lb = (l1 + l2) / 2;
  const cbp = (cp1 + cp2) / 2;
  const hb = cp1 * cp2 === 0 ? h1 + h2 : Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2;
  const tt = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const dth = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cbp ** 7 / (cbp ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lb - 50) ** 2) / Math.sqrt(20 + (lb - 50) ** 2);
  const sc = 1 + 0.045 * cbp;
  const sh = 1 + 0.015 * cbp * tt;
  const rt = -Math.sin(2 * dth * rad) * rc;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

describe("プランごとの線の色", () => {
  it("色の番号ごとに6色（0: 現状、1〜5: プラン）。基準かどうか・帯の順には関わらない", () => {
    expect(PLAN_COLOR_STYLES).toHaveLength(6);
    expect(new Set(PLAN_COLOR_STYLES.map((s) => s.color)).size).toBe(6);
    const a = planStyles([
      { key: "A", colorIndex: 0 },
      { key: "B", colorIndex: 1 },
      { key: "C", colorIndex: 2 },
    ]);
    const b = planStyles([
      { key: "C", colorIndex: 2 },
      { key: "A", colorIndex: 0 },
      { key: "B", colorIndex: 1 },
    ]);
    for (const k of ["A", "B", "C"]) expect(a.get(k)).toBe(b.get(k));
    expect(a.get("A")).toBe(PLAN_COLOR_STYLES[0]);
    // 範囲の外の番号は 1〜5 に折り返す
    expect(colorStyle(6)).toBe(PLAN_COLOR_STYLES[1]);
  });

  it("どの色も白地で 3:1 以上。色の見分け方の違いを模した見え方でも、どの2色も近づきすぎない（色差 10 以上）", () => {
    for (const s of PLAN_COLOR_STYLES) expect(contrast(s.color), s.color).toBeGreaterThanOrEqual(3);
    for (const [kind, m] of Object.entries(CVD))
      for (let i = 0; i < PLAN_COLOR_STYLES.length; i++)
        for (let j = i + 1; j < PLAN_COLOR_STYLES.length; j++) {
          const d = deltaE(lab(simulate(PLAN_COLOR_STYLES[i]!.color, m)), lab(simulate(PLAN_COLOR_STYLES[j]!.color, m)));
          expect(d, `${kind} ${i}-${j}`).toBeGreaterThanOrEqual(10);
        }
  });

  it("現状の色は落ち着いた青灰（彩度がいちばん低い）。重ねる表示の基準の線の色（--base）は変えない", () => {
    const sat = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return (Math.max(...c) - Math.min(...c)) / Math.max(...c);
    };
    const [cur, ...rest] = PLAN_COLOR_STYLES.map((s) => sat(s.color));
    for (const r of rest) expect(cur!).toBeLessThan(r);
    const css = readFileSync(join(APP_DIR, "src/styles/app.css"), "utf-8");
    expect(css).toContain("--base: #8c96a3;");
    expect(css).toMatch(/\.chart \.line-base \{[^}]*stroke-dasharray: 9 6;/);
  });
});

describe("色の番号はプランの内部 ID ごとに固定（assignColors）", () => {
  const letterOf = (m: Record<string, string>) => (id: string) => m[id];
  const L = letterOf({ p1: "B", p2: "C", p3: "D", p4: "E", p5: "F", p6: "G", p7: "H" });

  it("初めて帯に入るプランは、文字（B→1、C→2…）の番号。現状はいつも 0", () => {
    const m = assignColors(new Map(), ["p1", "p2", "p3"], L, PLAN_COLORS);
    expect([m.get(CURRENT), m.get("p1"), m.get("p2"), m.get("p3")]).toEqual([0, 1, 2, 3]);
  });

  it("帯の並びを変えても、基準を変えても（基準は割り当てに関わらない）、同じプランは同じ番号", () => {
    const m1 = assignColors(new Map(), ["p1", "p2", "p3"], L, PLAN_COLORS);
    const m2 = assignColors(m1, ["p3", "p1", "p2"], L, PLAN_COLORS);
    for (const id of ["p1", "p2", "p3"]) expect(m2.get(id)).toBe(m1.get(id));
  });

  it("ほかのプランを外しても・名前を変えて文字が変わっても、番号は変わらない（文字ではなく内部 ID に付ける）", () => {
    const m1 = assignColors(new Map(), ["p1", "p2", "p3"], L, PLAN_COLORS);
    const m2 = assignColors(m1, ["p2", "p3"], letterOf({ p2: "B", p3: "C" }), PLAN_COLORS);
    expect([m2.get("p2"), m2.get("p3")]).toEqual([2, 3]);
  });

  it("文字の番号がふさがっていれば空いている番号。帯の中で番号が重ならない。外したプランは戻ったとき空いていれば同じ番号", () => {
    const m1 = assignColors(new Map(), ["p1", "p2", "p3", "p4", "p5"], L, PLAN_COLORS);
    // G は B と同じ番号（1）を望むが、ふさがっている。p5 を外して G を入れると、空いた 5
    const m2 = assignColors(m1, ["p1", "p2", "p3", "p4", "p6"], L, PLAN_COLORS);
    expect(m2.get("p6")).toBe(5);
    expect(new Set(["p1", "p2", "p3", "p4", "p6"].map((id) => m2.get(id))).size).toBe(5);
    // p5 を戻す（p6 を外す）と、p5 は前の番号 5
    const m3 = assignColors(m2, ["p1", "p2", "p3", "p4", "p5"], L, PLAN_COLORS);
    expect(m3.get("p5")).toBe(5);
    // 前の割り当ては書き換えない
    expect(m1.get("p6")).toBeUndefined();
  });

  it("覚えている番号が帯の中のほかのプランと重なるときは、後から来たほうが空いている番号に替わる", () => {
    const m = assignColors(
      new Map([
        ["p1", 1],
        ["p7", 1],
      ]),
      ["p1", "p7"],
      L,
      PLAN_COLORS,
    );
    expect(m.get("p1")).toBe(1);
    expect(m.get("p7")).toBe(2);
  });
});

describe("全部のプランの線の値（作業の層）", () => {
  it("帯の順に、プランの名前と色の番号と、金融資産・年間収支の数字だけ。計算中のプランは null", () => {
    const ls = lines(["c"]);
    expect(ls.map((l) => l.key)).toEqual(["A", "B", "C", "D"]);
    for (const l of ls) expect(Object.keys(l).sort()).toEqual(["base", "colorIndex", "financial", "key", "name", "net", "selected", "title"]);
    expect(ls[0]).toMatchObject({ name: "プランA", title: "現状", base: true, selected: false, colorIndex: 0 });
    expect(ls[1]).toMatchObject({ name: "プランB", base: false, selected: true, colorIndex: 1 });
    const n = displayYears(wh.request).length;
    expect(ls[1]!.financial).toHaveLength(n);
    expect(ls[1]!.net).toHaveLength(n);
    expect(ls[2]).toMatchObject({ financial: null, net: null });
    // 選んだプランの線は、重ねる表示の選んだプランの線と同じ数字
    const m = model(ls);
    expect(ls[1]!.financial).toEqual(m.chart.proposal);
    expect(ls[1]!.net).toEqual(m.flows.net);
  });

  it("基準を替えても、色の番号は同じ", () => {
    expect(lines([], "c").map((l) => l.colorIndex)).toEqual(lines().map((l) => l.colorIndex));
  });
});

/** その線の色（data-multi-line の中の path の stroke） */
const strokeOf = (html: string, key: string) => new RegExp(`data-multi-line="${key}"><g[^>]*><path [^>]*stroke="(#[0-9a-f]{6})"`).exec(html)?.[1];

describe("全部のプランを色分けで重ねるグラフ", () => {
  for (const mode of ["assets", "flows"] as ChartMode[])
    it(`${mode}: 1つのグラフに全部のプランの線（実線・同じ丸・右端の文字）。積み上げの棒・不足の塗りは描かない`, () => {
      const html = draw(mode);
      expect(html).toContain('data-chart-layout="all"');
      expect(html.match(/<svg/g)).toHaveLength(1);
      expect(html.match(/class="multi-line"/g)).toHaveLength(4);
      for (const k of ["A", "B", "C", "D"]) expect(html).toContain(`data-multi-line="${k}"`);
      expect(html).not.toMatch(/class="bar /);
      expect(html).not.toContain('class="area-short"');
      expect(html).not.toContain('class="line-prop"');
      // 線は全部実線、端の印は全部丸（線の種類・印の形で描き分けない）
      expect(html).not.toContain("stroke-dasharray");
      expect(html).not.toMatch(/<(rect|path)[^>]*class="pl-mk/);
      expect(html.match(/<circle class="pl-mk"/g)).toHaveLength(4);
      // 色はプランごと（基準のプラン＝現状も色の番号 0 の色）。選んだプランはいちばん上（最後）に描く
      expect(strokeOf(html, "A")).toBe(PLAN_COLOR_STYLES[0]!.color);
      expect(strokeOf(html, "B")).toBe(PLAN_COLOR_STYLES[1]!.color);
      expect(html.lastIndexOf("data-multi-line=")).toBe(html.indexOf('data-multi-line="B"'));
      expect(html.match(/class="ml-end"/g)).toHaveLength(4);
      // 基準のプランは右端の文字に「基準」の札
      expect(html.match(/class="ml-end-base"/g)).toHaveLength(1);
      expect(html).toMatch(/data-multi-line="A">[\s\S]*?<text[^>]*class="ml-end"[^>]*>A<tspan class="ml-end-base"[^>]*>基準<\/tspan>/);
    });

  it("基準を替えても、どの線も同じ色。「基準」の札だけが移る", () => {
    const m = { ...model(), plans: lines([], "c") };
    const html = renderToString(h(MainChart, { model: m, mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop, layout: "all" }));
    const before = draw("assets");
    for (const k of ["A", "B", "C", "D"]) expect(strokeOf(html, k)).toBe(strokeOf(before, k));
    expect(html).toMatch(/data-multi-line="C">[\s\S]*?class="ml-end"[^>]*>C<tspan class="ml-end-base"/);
    expect(html.match(/class="ml-end-base"/g)).toHaveLength(1);
  });

  it("0未満の範囲は線に塗りを付けず、薄い地と言葉で示す（不足が出るプランがあるとき）", () => {
    const html = draw("assets");
    expect(html).toContain('class="multi-zone"');
    expect(html).toContain("0未満は不足");
  });

  it("年を固定すると、全部のプランの線の上に丸、表示に全部のプランの値を帯の順で（読み上げは1か所）", () => {
    const m = model();
    const y = m.chart.years[30]!;
    const html = renderToString(h(MainChart, { model: m, mode: "flows", explain: null, ageMark: null, pinnedYear: y, onSelectYear: noop, layout: "all" }));
    expect(html).toContain(`data-pinned-year="${y}"`);
    expect(html.match(/<circle class="pl-mk hv-mk"/g)).toHaveLength(4);
    const order = [...html.matchAll(/data-tip-plan="([A-Z])"/g)].map((x) => x[1]);
    expect(order).toEqual(["A", "B", "C", "D"]);
    expect(html).toContain("年間収支（帯の順）");
    expect(html.match(/role="status"/g)).toHaveLength(1);
    const i = m.chart.years.indexOf(y);
    const net = m.plans![2]!.net![i]!;
    expect(html).toContain(`${net < 0 ? "▲" : ""}${Math.abs(Math.round(net / 10000)).toLocaleString("en-US")}万円`);
  });

  it("凡例で合わせたプランを強調し、ほかを薄くする", () => {
    const html = draw("assets", { multi: { focus: "C", hidden: [] } });
    expect(html).toMatch(/class="ml dim[^"]*" data-multi-line="A"/);
    expect(html).toMatch(/class="ml hi" data-multi-line="C"/);
    // 強調しているプランはいちばん上に描く
    expect(html.lastIndexOf("data-multi-line=")).toBe(html.indexOf('data-multi-line="C"'));
  });

  it("一時的に隠したプランは描かず、年の表示にも出さない", () => {
    const hid = draw("assets", { multi: { focus: null, hidden: ["D"] }, pinnedYear: model().chart.years[10] });
    expect(hid).not.toContain('data-multi-line="D"');
    expect(hid).not.toContain('data-tip-plan="D"');
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
    const html = draw("flows", { height: 260 });
    expect(html).toContain("compact");
    expect(html.match(/class="multi-line"/g)).toHaveLength(4);
  });

  it("重ねる表示（既定）の線の見た目は変えない: 基準のプランは灰の破線、選んだプランは藍の実線", () => {
    const html = renderToString(h(MainChart, { model: model(), mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop, layout: "overlay" }));
    expect(html).toContain('class="line-base"');
    expect(html).toContain('class="line-prop"');
    expect(html).not.toContain("multi-line");
  });
});

describe("線を隠したときの縦の目盛り", () => {
  const n = 40;
  const ramp = (from: number, to: number) => Array.from({ length: n }, (_, i) => Math.round((from + ((to - from) * i) / (n - 1)) * 10000));
  const synth = (lines: Record<string, number[]>): PlanLineModel[] =>
    Object.entries(lines).map(([k, v], i) => ({ key: k, name: `プラン${k}`, title: k, base: i === 0, selected: i === 1, colorIndex: i, financial: v, net: v }));
  // A〜C は 0〜3,000万円くらい、D だけ大きく外れて 1億2,000万円まで
  const plans = synth({ A: ramp(500, 2600), B: ramp(500, 3000), C: ramp(400, 2200), D: ramp(600, 12000) });
  const m0 = model();
  const synthModel = (): PresentationModel & MainChartModel => {
    const years = Array.from({ length: n }, (_, i) => 2026 + i);
    return { ...m0, chart: { ...m0.chart, years, ages: years.map((_, i) => 45 + i) }, events: [], plans };
  };
  const drawS = (hidden: string[]) => renderToString(h(MainChart, { model: synthModel(), mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop, layout: "all", multi: { focus: null, hidden } }));

  it("決め直すのは、表示中の線の値の幅が全部の線の目盛りの幅の半分（RESCALE_BELOW）未満になったときだけ", () => {
    expect(RESCALE_BELOW).toBe(0.5);
    const all = plans.map((p) => p.financial!);
    const full = domainOf(all);
    // 1本だけ隠しても、残りが目盛りの半分以上を使うなら決め直さない
    expect(multiDomain(all, [all[0]!, all[1]!, all[3]!])).toEqual({ domain: full, rescaled: false });
    // 大きく外れた線（D）を隠すと、残り（3,000万円まで）は目盛り（1億2,000万円まで）の半分未満 → 残りに合わせる
    const fit = multiDomain(all, all.slice(0, 3));
    expect(fit.rescaled).toBe(true);
    expect(fit.domain.max).toBeLessThan(full.max / 2);
    // 何も隠していない・全部隠したときは全部の線で決めたまま
    expect(multiDomain(all, all).rescaled).toBe(false);
    expect(multiDomain(all, []).rescaled).toBe(false);
  });

  it("少し隠しただけでは目盛りが動かない", () => {
    const base = drawS([]);
    for (const hidden of [["A"], ["C"], ["A", "C"], ["B", "C"]]) {
      const html = drawS(hidden);
      expect(tickLabels(html), hidden.join(",")).toEqual(tickLabels(base));
      expect(html).toContain('data-multi-scale="all"');
      expect(html).not.toContain("data-scale-note");
    }
  });

  it("大きく外れた線を隠したら、表示中の線に合わせて決め直す（その旨を小さく出す）。戻すと元の目盛り", () => {
    const base = drawS([]);
    const fit = drawS(["D"]);
    expect(tickLabels(fit)).not.toEqual(tickLabels(base));
    expect(fit).toContain('data-multi-scale="fit"');
    expect(fit).toContain("縦の目盛りを表示中の線に合わせています");
    const top = (html: string) => Math.max(...tickLabels(html).map((x) => Number(x!.replace(/,/g, "").replace("▲", "-"))));
    expect(top(fit)).toBeLessThan(top(base) / 2);
    expect(top(fit)).toBeGreaterThanOrEqual(3000);
    expect(tickLabels(drawS([]))).toEqual(tickLabels(base));
  });
});

describe("凡例と帯のカード", () => {
  it("凡例: 何の線かの見出し、プランごとの見本と名前。押すと隠す・戻す（aria-pressed）。計算中のプランは押せない", () => {
    const html = renderToString(h(MultiLegend, { plans: lines(["d"]), mode: "flows", focus: null, onFocus: noop, hidden: ["C"], onToggle: noop }));
    expect(html).toContain("全部のプランの年間収支");
    expect(html).toContain("積み上げの棒は出しません");
    expect(html).toMatch(/aria-pressed="false"[^>]*data-multi-item="C"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-multi-item="A"/);
    expect(html).toMatch(/disabled[^>]*data-multi-item="D"/);
    expect(html).toContain("計算中");
    expect(html.match(/class="pl-sw"/g)).toHaveLength(4);
    // 見本も実線と丸
    expect(html).not.toContain("stroke-dasharray");
    expect(html.match(/<circle class="pl-mk"/g)).toHaveLength(4);
    expect(html).toContain('<span class="ml-tag">基準</span>');
  });

  it("グラフの枠: 全部のプランを重ねるときは全部のプランの凡例（重ねる表示の凡例は出さない）", () => {
    const m = model();
    const card = renderToString(h(ResultCard, { model: m, verdict: m.result, provisional: false, mode: "assets", onMode: noop, layout: "all", explain: null, onExplain: noop, ageMark: null, pinnedYear: null, onSelectYear: noop, multi: { hidden: [], onToggle: noop } }));
    expect(card).toContain("data-multi-legend");
    expect(card).not.toContain("（選んだプラン）");
    const over = renderToString(h(ResultCard, { model: m, verdict: m.result, provisional: false, mode: "assets", onMode: noop, layout: "overlay", explain: null, onExplain: noop, ageMark: null, pinnedYear: null, onSelectYear: noop }));
    expect(over).not.toContain("data-multi-legend");
  });

  it("帯のカードの印はこの表示のときだけ。グラフの線と同じ色（色の番号で引く。基準のカードも同じ）", () => {
    const band: PlanBandModel = {
      cards: ["A", "B", "C"].map((k, i) => ({ key: k, letter: k, name: k, shortAge: null, status: "100歳まで足りる", base: i === 1, shown: i === 2, modified: false, metrics: [], colorIndex: [0, 3, 1][i]! })),
      baseOptions: [],
      base: "B",
      addNote: "",
    };
    const off = renderToString(h(PlanBand, { model: band, onSelect: noop, onBase: noop, onAdd: noop }));
    expect(off).not.toContain("data-plan-mark");
    const on = renderToString(h(PlanBand, { model: band, onSelect: noop, onBase: noop, onAdd: noop, lineMarks: true }));
    expect(on.match(/data-plan-mark=/g)).toHaveLength(3);
    expect(on).toMatch(new RegExp(`data-plan-mark="A"><svg[^>]*><line [^>]*stroke="${PLAN_COLOR_STYLES[0]!.color}"`));
    expect(on).toMatch(new RegExp(`data-plan-mark="B"><svg[^>]*><line [^>]*stroke="${PLAN_COLOR_STYLES[3]!.color}"`));
    expect(on).toMatch(new RegExp(`data-plan-mark="C"><svg[^>]*><line [^>]*stroke="${PLAN_COLOR_STYLES[1]!.color}"`));
    expect(on).toContain("基準のプラン");
    expect(on).toContain("＋ このプランを元に作る");
  });
});

describe("表示の設定", () => {
  it("比べ方に「全部のプランを色分けで重ねる」。既定は重ねるのまま。URL の #layout=all でも開ける", () => {
    expect(DEFAULT_DISPLAY_SETTINGS.layout).toBe("overlay");
    expect(LAYOUT_CHOICES.map((c) => c.key)).toEqual(["overlay", "side", "all"]);
    const html = renderToString(h(DisplaySettingsPanel, { value: { ...DEFAULT_DISPLAY_SETTINGS, layout: "all" }, onChange: noop, onClose: noop, feeAvailable: false }));
    expect(html).toContain("全部のプランを色分けで重ねる");
    expect(html).toMatch(/value="all" checked/);
    expect(parseHash("#layout=all").layout).toBe("all");
  });
});

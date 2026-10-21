// 狭い画面（スマホ）での見え方と、バランスシートの図の純資産の箱:
// - 狭い画面では、資産の推移のグラフの中の「○歳で不足」の文字を出さない（0の線の△と縦の点線は残す）。広い画面では今のまま
// - グラフの使い方の文は、狭い画面・タッチの端末では短い文（「クリック」「Esc」を言わない）
// - バランスシートの図: 純資産もほかの箱と同じ枠線なしのベタ塗り。柱を囲む枠は描かない。狭い画面では図の外の札を出さず、図の下の一覧に出す
// - 持ち帰り用のレポートの「1つ前に戻す」「最初に戻す」と、アプリの対策の「変更を取り消す」
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BsFigure } from "../src/presentation/BsFigure.tsx";
import { MainChart, MainLegend, TOUCH_HINT } from "../src/presentation/MainChart.tsx";
import type { BsYearModel } from "../src/presentation/model.ts";
import { NARROW_QUERY } from "../src/presentation/narrow.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues, type Values } from "../src/workspace/plans/plans.ts";
import { toPresentation } from "../src/workspace/present.ts";
import { roles } from "../src/workspace/roles.ts";
import { APP_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;
const g = globalThis as { window?: unknown };

/** 狭い画面のつもりで描く（matchMedia だけを置く。描き終えたら外す） */
function narrow<T>(fn: () => T): T {
  g.window = { matchMedia: (q: string) => ({ matches: q === NARROW_QUERY, addEventListener: noop, removeEventListener: noop }) };
  try {
    return fn();
  } finally {
    delete g.window;
  }
}
afterEach(() => {
  delete g.window;
});

function chartModel() {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold("salariedCoupleTwoKids")!;
  const re = demo.reemployment!;
  const wh = fromRequest(req, { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } });
  const cat = buildCatalog(wh, self.id, demo);
  const values: Values = { "lever:retireAge": 65, "lever:livingMonthly": 280000 };
  return toPresentation({ base: wh.request, proposal: applyValues(wh, values, cat), current: preview(wh.request), proposed: preview(applyValues(wh, values, cat)), targetAge: 95, selectedYear: null, provisional: false, names: { selected: "プランB", base: "プランA", same: false } });
}

describe("狭い画面: 資産の推移のグラフ", () => {
  const m = chartModel();
  const draw = () => renderToString(h(MainChart, { model: m, mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop }));

  it("広い画面では「○歳で不足」の文字を出す。狭い画面では出さず、△と縦の点線は残す", () => {
    expect(m.chart.depletions.length).toBeGreaterThan(0);
    const wide = draw();
    expect(wide).toContain('class="dep-txt"');
    const small = narrow(draw);
    expect(small).not.toContain('class="dep-txt"');
    expect(small).toContain("dep-tri");
    expect(small).toContain('class="dep-line"');
  });

  it("使い方の文は長い文と短い文の両方を持ち、狭い画面・タッチの端末では短い文だけを見せる（CSS）", () => {
    const html = renderToString(h(MainLegend, { model: m, mode: "assets", explain: null }));
    expect(html).toContain('class="hint-long"');
    expect(html).toContain(`<span class="hint-short">${TOUCH_HINT}</span>`);
    expect(TOUCH_HINT).not.toMatch(/クリック|Esc/);
    const css = readFileSync(join(APP_DIR, "src", "styles", "app.css"), "utf8");
    expect(css).toMatch(/\.hint-short \{ display: none; \}/);
    expect(css).toContain("@media (max-width: 639.98px), (hover: none)");
    expect(NARROW_QUERY).toBe("(max-width: 639.98px)");
  });
});

describe("バランスシートの図: 純資産の箱と狭い画面", () => {
  const groups = {
    liquid: { name: "すぐ使えるお金", short: "すぐ使える" },
    market: { name: "値動きのある運用", short: "値動きあり" },
    locked: { name: "引き出せないお金", short: "引き出せない" },
    illiquid: { name: "換金しにくい資産", short: "換金しにくい" },
    mortgage: { name: "住宅ローン", short: "住宅ローン" },
    debt: { name: "その他の負債", short: "その他の負債" },
  };
  const year = (lines: BsYearModel["lines"], netWorth: number): BsYearModel => {
    const assets = lines.filter((l) => l.group !== "mortgage" && l.group !== "debt").reduce((s, l) => s + l.amount, 0);
    return { year: 2026, age: 45, members: "", fact: true, lines, totalAssets: assets, totalLiabilities: assets - netWorth, netWorth, financial: 0, shortfall: 0, living: 3_600_000, events: [], say: { head: [], sub: [] }, insight: [], notes: {} };
  };
  const plus = year(
    [
      { key: "deposit", label: "預金", group: "liquid", amount: 8_600_000 },
      { key: "nisa", label: "NISA", group: "market", amount: 2_510_000 },
      { key: "land", label: "土地", group: "illiquid", amount: 14_690_000 },
      { key: "building", label: "建物", group: "illiquid", amount: 13_470_000 },
      { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 22_190_000 },
    ],
    17_080_000,
  );
  const minus = year(
    [
      { key: "land", label: "土地", group: "illiquid", amount: 12_000_000 },
      { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 9_000_000 },
      { key: "short", label: "資金の不足", group: "debt", amount: 7_000_000 },
    ],
    -4_000_000,
  );

  it("純資産はほかの箱と同じ枠線なしのベタ塗り（白い区切りだけ）。柱を囲む枠は描かない", () => {
    const html = renderToString(h(BsFigure, { year: plus, groups, height: 420, label: "今" }));
    const nw = /<g[^>]*data-bs-box="netWorth"[\s\S]*?<rect class="bsf-seg"([^>]*)>/.exec(html)?.[1] ?? "";
    expect(nw).toContain('fill="var(--bs-netWorth)"');
    expect(nw).toContain('stroke="#fff"');
    expect(html).not.toContain('stroke="var(--prop)"');
    expect(html).not.toMatch(/<rect[^>]*fill="none"[^>]*stroke="var\(--ink\)"/);
    // 白い文字が読める濃さ（前の薄い色ではない）
    const css = readFileSync(join(APP_DIR, "src", "styles", "balance.css"), "utf8");
    expect(css).toMatch(/--bs-netWorth: #565d8c;/);
    // 純資産のマイナスは意味が違うので、点線の枠のまま
    const neg = renderToString(h(BsFigure, { year: minus, groups, height: 420, label: "先" }));
    expect(neg).toContain('data-bs-box="neg"');
    expect(neg).toContain("stroke-dasharray");
  });

  it("狭い画面では図の外の札・金融資産のかっこを出さず、図の下の一覧に名前と金額を出す（純資産は箱の中にも名前と金額）", () => {
    const wide = renderToString(h(BsFigure, { year: plus, groups, height: 300, compact: true, label: "今" }));
    expect(wide).toContain("data-bs-label");
    expect(wide).not.toContain("data-bs-list");
    const small = narrow(() => renderToString(h(BsFigure, { year: plus, groups, height: 300, compact: true, label: "今" })));
    expect(small).not.toContain("data-bs-label");
    expect(small).not.toContain("data-bs-financial");
    for (const k of ["liquid", "market", "illiquid", "mortgage", "netWorth", "financial"]) expect(small).toContain(`data-bs-list="${k}"`);
    expect(small).toMatch(/data-bs-list="netWorth"[\s\S]*?純資産[\s\S]*?1,708/);
    expect(small).toMatch(/data-bs-box="netWorth"[\s\S]*?>純資産<\/text>/);
    const neg = narrow(() => renderToString(h(BsFigure, { year: minus, groups, height: 300, compact: true, label: "先" })));
    expect(neg).toMatch(/data-bs-list="neg"[\s\S]*?▲[\s\S]*?400/);
  });
});

describe("戻すボタンの言葉", () => {
  const src = (p: string) => readFileSync(join(APP_DIR, "src", p), "utf8");
  it("持ち帰り用のレポート: 「↶ 1つ前に戻す」と「最初に戻す」。計算できなかったときの案内も同じ言葉", () => {
    const t = src("takeaway/viewer/TakeawayView.tsx");
    expect(t).toMatch(/data-takeaway-undo>\s*<span aria-hidden="true">↶ <\/span>1つ前に戻す/);
    expect(t).toMatch(/data-takeaway-reset>\s*最初に戻す\s*</);
    expect(t).toContain("「1つ前に戻す」か「最初に戻す」を押してください");
    expect(t).not.toContain("FPの提案に戻す");
  });
  it("アプリの対策: 保存していない変更を全部取り消すボタンは「変更を取り消す」（上部の ↶ と紛れない）", () => {
    const t = src("workspace/LeverPanel.tsx");
    expect(t).toMatch(/data-plan-reset>\s*変更を取り消す/);
  });
});

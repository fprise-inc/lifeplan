// 狭い画面（スマホ）での見え方と、バランスシートの図の純資産の箱:
// - 資産の推移のグラフの資産が尽きる所は、狭い画面でも広い画面と同じ「!」の段と点線（文字はどちらも出さない。short-mark.test.ts）
// - グラフの使い方の文は、狭い画面・タッチの端末では短い文（「クリック」「Esc」を言わない）
// - バランスシートの図: 純資産もほかの箱と同じ枠線なしのベタ塗り（箱の間に細い余白・角を少し丸める）。柱を囲む枠は描かない。狭い画面では図の外の札を出さず、図の下の一覧に出す
// - バランスシートの図: 箱の中の文字はどれも白（色は白い文字が読める濃さ）。下の線は1本（目盛りの「0」の印と重ねない）
// - 持ち帰り用のレポートの「1つ前に戻す」「最初に戻す」と、アプリの対策の「変更を取り消す」
// - バランスシートの図: 箱の中の名前と金額は詰めない（1行で間が取れなければ2行・金額だけ・名前だけ）
// - 狭い画面で横にはみ出す元になっていた部品（選ぶ欄・切り替えのボタン・万一の内訳の表・基準のプランの札・足した項目の値・プランの帯）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { boxTextFit, boxTextW, BsFigure } from "../src/presentation/BsFigure.tsx";
import { MainChart, MainLegend } from "../src/presentation/MainChart.tsx";
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

  it("資産が尽きる所は、狭い画面でも広い画面と同じ「!」と点線（「○歳で不足」の文字と△はどちらも出さない）", () => {
    expect(m.chart.depletions.length).toBeGreaterThan(0);
    const wide = draw();
    const small = narrow(draw);
    expect(small).toBe(wide);
    expect(small).not.toContain("dep-txt");
    expect(small).not.toContain("dep-tri");
    expect(small).toContain('class="dep-line"');
    expect(small).toContain("data-short=");
  });

  it("結果のグラフの凡例には使い方の文を出さない（広い画面・狭い画面で分けた文も無い）", () => {
    const html = renderToString(h(MainLegend, { model: m, mode: "assets", explain: null }));
    expect(html).not.toContain("hint-long");
    expect(html).not.toContain("hint-short");
    expect(html).not.toContain("グラフに合わせると");
    const css = readFileSync(join(APP_DIR, "src", "styles", "app.css"), "utf8");
    expect(css).not.toContain(".hint-short");
    expect(css).not.toContain(".hint-long");
    expect(NARROW_QUERY).toBe("(max-width: 639.98px)");
  });
});

// バランスシートの図の見本（今の年: 土地・建物・住宅ローンあり／先の年: 純資産のマイナス）
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
  return { year: 2026, age: 45, members: "", fact: true, lines, totalAssets: assets, totalLiabilities: assets - netWorth, netWorth, financial: 0, shortfall: 0, living: 3_600_000, loanPay: 0, guarantee: 0, events: [], notes: {} };
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

describe("バランスシートの図: 純資産の箱と狭い画面", () => {
  it("純資産はほかの箱と同じ枠線なしのベタ塗り（角を少し丸めた形）。柱を囲む枠は描かない", () => {
    const html = renderToString(h(BsFigure, { year: plus, groups, height: 420, label: "今" }));
    const nw = /<g[^>]*data-bs-box="netWorth"[\s\S]*?<rect class="bsf-seg"([^>]*)>/.exec(html)?.[1] ?? "";
    expect(nw).toContain('fill="var(--bs-netWorth)"');
    expect(nw).not.toContain("stroke=");
    expect(nw).toContain('rx="4"');
    expect(html).not.toContain('stroke="var(--prop)"');
    expect(html).not.toMatch(/<rect[^>]*fill="none"[^>]*stroke="var\(--ink\)"/);
    // 白い文字が読める濃さ（前の薄い色ではない）
    const css = readFileSync(join(APP_DIR, "src", "styles", "balance.css"), "utf8");
    expect(css).toMatch(/--bs-netWorth: #355ba4;/);
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

describe("バランスシートの図: 箱の文字の色と下の線", () => {
  // いろいろな項目の箱（薄い色だった項目も入れる）
  const rich = year(
    [
      { key: "deposit", label: "預金", group: "liquid", amount: 6_000_000 },
      { key: "taxable", label: "課税口座", group: "market", amount: 4_000_000 },
      { key: "ideco", label: "iDeCo", group: "locked", amount: 4_000_000 },
      { key: "land", label: "土地", group: "illiquid", amount: 9_000_000 },
      { key: "building", label: "建物", group: "illiquid", amount: 8_000_000 },
      { key: "car", label: "車", group: "illiquid", amount: 3_000_000 },
      { key: "insurance", label: "保険の解約返戻金", group: "illiquid", amount: 3_000_000 },
      { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 12_000_000 },
      { key: "carLoan", label: "車のローン", group: "debt", amount: 3_000_000 },
    ],
    22_000_000,
  );
  const draws = (y: BsYearModel) => [
    renderToString(h(BsFigure, { year: y, groups, height: 560, label: "広い" })),
    renderToString(h(BsFigure, { year: y, groups, height: 300, compact: true, label: "並べる" })),
    narrow(() => renderToString(h(BsFigure, { year: y, groups, height: 380, label: "狭い" }))),
    narrow(() => renderToString(h(BsFigure, { year: y, groups, height: 300, compact: true, label: "狭い・並べる" }))),
  ];
  /** 箱ごとの中身（次の箱か、下の線の手前まで） */
  const boxes = (html: string) =>
    html
      .split(/(?=<g[^>]*data-bs-box=")/)
      .slice(1)
      .map((c) => ({ key: /data-bs-box="([^"]+)"/.exec(c)?.[1] ?? "", body: c.split("data-bs-baseline")[0] as string }));

  it("箱の中の文字はどれも白（建物も）。資金の不足の斜線・純資産のマイナスだけ濃い文字", () => {
    for (const y of [plus, rich, minus]) {
      for (const html of draws(y)) {
        for (const b of boxes(html)) {
          const fills = [...b.body.matchAll(/<text[^>]*fill="([^"]+)"/g)].map((m) => m[1]);
          if (b.key === "neg" || (b.key === "debt" && y === minus)) continue;
          expect(fills.every((f) => f === "#fff"), `${b.key}: ${fills.join(",")}`).toBe(true);
        }
      }
    }
    const small = narrow(() => renderToString(h(BsFigure, { year: plus, groups, height: 380, label: "狭い" })));
    expect(small).toMatch(/data-bs-box="illiquid"[\s\S]*?fill="#fff"[^>]*>建物<\/text>/);
  });

  it("箱の色はどれも白い文字との差 4.5:1 以上（画面の balance.css と提案書の Typst）。建物は土地より明るい", () => {
    const lum = (hex: string) => {
      const [r, g2, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * r + 0.7152 * g2 + 0.0722 * b;
    };
    const ratio = (hex: string) => 1.05 / (lum(hex) + 0.05);
    const css = readFileSync(join(APP_DIR, "src", "styles", "balance.css"), "utf8");
    const root = css.slice(0, css.indexOf("}"));
    const vars = [...root.matchAll(/--bs-([\w-]+):\s*(#[0-9a-f]{6})/g)].filter((m) => !["short", "short-line", "netWorth-ink"].includes(m[1] as string));
    expect(vars.length).toBeGreaterThan(30);
    for (const [, k, c] of vars) expect(ratio(c as string), `--bs-${k} ${c}`).toBeGreaterThanOrEqual(4.5);
    const typ = readFileSync(join(APP_DIR, "..", "report", "typst", "report-core", "parts", "layout.typ"), "utf8");
    const tcol = /#let bs-colors = \(([\s\S]*?)\n\)/.exec(typ)?.[1] ?? "";
    const tvars = [...tcol.matchAll(/(\w+): rgb\("(#[0-9a-f]{6})"\)/g)];
    expect(tvars.length).toBe(11);
    for (const [, k, c] of tvars) expect(ratio(c as string), `Typst ${k} ${c}`).toBeGreaterThanOrEqual(4.5);
    const get = (k: string) => (vars.find((m) => m[1] === k)?.[2] ?? "") as string;
    expect(lum(get("building"))).toBeGreaterThan(lum(get("land")) * 1.3);
  });

  it("下の線は箱の後に1本だけ（箱の白い縁に隠れて途切れない）。「0」の目盛りの印は重ねて描かない", () => {
    for (const y of [plus, rich, minus]) {
      for (const html of draws(y)) {
        expect(html.match(/data-bs-baseline/g)?.length).toBe(1);
        expect(html.indexOf("data-bs-baseline")).toBeGreaterThan(html.lastIndexOf("data-bs-box="));
        const lines = [...html.matchAll(/<line([^>]*)>/g)].map((m) => {
          const a = (n: string) => Number(new RegExp(` ${n}="([^"]+)"`).exec(m[1] as string)?.[1]);
          return { base: (m[1] as string).includes("data-bs-baseline"), x1: a("x1"), x2: a("x2"), y1: a("y1"), y2: a("y2") };
        });
        const bl = lines.find((l) => l.base)!;
        expect(bl.y1).toBe(bl.y2);
        expect(bl.x1).toBeGreaterThanOrEqual(0);
        // 下の線と同じ高さ（太さの中）に、ほかの横の線が無い
        const near = lines.filter((l) => !l.base && l.y1 === l.y2 && Math.abs(l.y1 - bl.y1) < 2);
        expect(near).toEqual([]);
      }
    }
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

describe("バランスシートの図: 箱の中の名前と金額を詰めない", () => {
  // ブラウザで測った太字の幅（文字の大きさに対する割合。画面の書体）。見積もりはこれより狭くならない
  const measured: Record<string, number> = { NISA: 2.79, iDeCo: 3.37, DC: 1.66, 預金: 2, 返戻金: 3, "3,940": 3.37, "8,274": 3.37, "951": 2.15, "1,234": 3.24, "12,345": 4.0 };

  it("幅の見積もりは、実際の太字の幅より狭くない", () => {
    for (const [s, em] of Object.entries(measured)) expect(boxTextW(s, 1), s).toBeGreaterThanOrEqual(em);
  });

  it("1行に置くのは、実際の幅で名前と金額の間が文字の大きさの0.6倍以上あるときだけ。入らなければ2行・金額だけ（狭い画面）・名前だけ（広い画面）", () => {
    const f = 11.5;
    for (const [name, value] of [["NISA", "3,940"], ["iDeCo", "951"], ["預金", "12,345"], ["返戻金", "1,234"], ["DC", "8,274"]] as const) {
      for (let colW = 30; colW <= 200; colW += 1) {
        for (const narrow of [true, false]) {
          const fit = boxTextFit(name, value, colW, f * 2.2, f, narrow);
          if (fit === "one") expect(colW - 20 - ((measured[name] as number) + (measured[value] as number)) * f, `${name}|${value} ${colW}`).toBeGreaterThanOrEqual(f * 0.6);
          expect(fit).not.toBe("two"); // 1行分の高さでは2行にしない
          if (fit !== "one") expect(fit).toBe(narrow ? (boxTextW(value, f) + 20 <= colW ? "value" : "none") : boxTextW(name, f) + 20 <= colW ? "name" : "none");
        }
        // 2行分の高さがあれば、名前の下の行に金額
        const tall = boxTextFit(name, value, colW, f * 3.2, f, true);
        if (tall !== "one" && Math.max(boxTextW(name, f), boxTextW(value, f)) + 20 <= colW) expect(tall).toBe("two");
      }
    }
    // 前に詰まって見えた幅（375px の「3時点を並べる」の柱の幅）: 1行にしない
    expect(boxTextFit("NISA", "3,940", 95, 30, 11.5, true)).not.toBe("one");
    expect(boxTextFit("NISA", "3,940", 95, 40, 11.5, true)).toBe("two");
    expect(boxTextFit("NISA", "3,940", 95, 25, 11.5, true)).toBe("value");
    expect(boxTextFit("NISA", "3,940", 95, 25, 11.5, false)).toBe("name");
    expect(boxTextFit("NISA", "3,940", 95, 15, 11.5, true)).toBe("none");
  });

  it("描いた図でも、1行の名前と金額の間が空き、2行のときは上下に重ならない（広い・並べる・狭い・狭い並べる）", () => {
    const dual = year(
      [
        { key: "deposit", label: "預金", group: "liquid", amount: 11_180_000 },
        { key: "nisa", label: "NISA", group: "market", amount: 39_400_000 },
        { key: "taxable", label: "課税口座", group: "market", amount: 8_274_000 },
        { key: "ideco", label: "iDeCo", group: "locked", amount: 9_510_000 },
        { key: "land", label: "土地", group: "illiquid", amount: 33_490_000 },
        { key: "building", label: "建物", group: "illiquid", amount: 23_850_000 },
        { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 23_330_000 },
      ],
      102_374_000,
    );
    const draws = [
      renderToString(h(BsFigure, { year: dual, groups, height: 560, label: "広い" })),
      renderToString(h(BsFigure, { year: dual, groups, height: 300, compact: true, label: "並べる" })),
      narrow(() => renderToString(h(BsFigure, { year: dual, groups, height: 380, label: "狭い" }))),
      narrow(() => renderToString(h(BsFigure, { year: dual, groups, height: 300, compact: true, label: "狭い・並べる" }))),
    ];
    let ones = 0;
    for (const html of draws) {
      const texts = [...html.matchAll(/<text([^>]*data-bs-text="(name|value)"[^>]*)>([^<]*)<\/text>/g)].map((m) => {
        const a = (n: string) => Number(new RegExp(` ${n}="([^"]+)"`).exec(m[1] as string)?.[1]);
        return { kind: m[2], end: (m[1] as string).includes('text-anchor="end"'), x: a("x"), y: a("y"), f: a("font-size"), s: m[3] as string };
      });
      expect(texts.length).toBeGreaterThan(0);
      for (const n of texts.filter((t) => t.kind === "name")) {
        const same = texts.find((t) => t.kind === "value" && t.end && t.y === n.y);
        const below = texts.find((t) => t.kind === "value" && !t.end && t.x === n.x && t.y > n.y && t.y - n.y < n.f * 2);
        if (same !== undefined) {
          ones++;
          expect(same.x - boxTextW(same.s, same.f) - (n.x + boxTextW(n.s, n.f)), `${n.s}|${same.s}`).toBeGreaterThanOrEqual(Math.max(10, n.f * 0.9) - 0.01);
        }
        if (below !== undefined) expect(below.y - n.y, `${n.s}|${below.s}`).toBeGreaterThanOrEqual(n.f * 1.2);
      }
    }
    expect(ones).toBeGreaterThan(0);
  });
});

describe("狭い画面で横にはみ出さない（CSS の決まり）", () => {
  const app = readFileSync(join(APP_DIR, "src", "styles", "app.css"), "utf8");
  const bal = readFileSync(join(APP_DIR, "src", "styles", "balance.css"), "utf8");
  /** 狭い画面の @media の中身（同じ幅の決まりの塊をすべてつなぐ） */
  const narrowCss = [...app.matchAll(/@media \(max-width: 639\.98px\) \{/g)]
    .map((m) => {
      let depth = 0;
      for (let i = (m.index as number) + m[0].length - 1; i < app.length; i++) {
        if (app[i] === "{") depth++;
        if (app[i] === "}" && --depth === 0) return app.slice((m.index as number) + m[0].length, i);
      }
      return "";
    })
    .join("\n");

  it("プランを並べる・前回と比べるの選ぶ欄は枠の幅を超えない（長いプランの名前でも）", () => {
    expect(bal).toMatch(/\.bs-pick select \{[^}]*max-width: min\(22em, 100%\);[^}]*min-width: 0;/);
  });
  it("切り替えのボタンは狭い画面で折り返す（ページの幅を超えない）", () => {
    expect(narrowCss).toMatch(/\.seg-g \{ flex-wrap: wrap; max-width: 100%; \}/);
  });
  it("万一の内訳の表は、狭い画面で項目の名前と見出しを折り返す", () => {
    expect(narrowCss).toMatch(/\.cg-break th\[scope="row"\], \.cg-break thead th \{ white-space: normal; \}/);
  });
  it("基準のプランの値の札は、狭い画面で折り返す", () => {
    expect(app).toMatch(/\.base-tag \{[^}]*max-width: 100%;/);
    expect(app).toMatch(/@media \(max-width: 639\.98px\) \{ \.base-tag \{ white-space: normal; \} \}/);
  });
  it("足した項目の値（長い文）は、狭い画面で折り返す", () => {
    expect(narrowCss).toMatch(/\.added-val \{ white-space: normal; overflow-wrap: anywhere; \}/);
  });
  it("プランの帯: 帯はページの幅を超えず、カードの並びは帯の中だけ横にスクロールする（縦のスクロールは奪わない）", () => {
    expect(app).toMatch(/\.band \{[^}]*min-width: 0; max-width: 100%;/);
    expect(app).toMatch(/\.band-cards \{[^}]*min-width: 0;[^}]*overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain;/);
  });
});

// バランスシートの図の外の見出しは要る所だけ・純資産の箱の中にも名前と金額（0027 の追記 2026-11-27。利用者の判断）:
// - 図の外の見出し（括弧と「住宅ローン 2,220万円」など）を出すのは、まとまりの中に箱が2つ以上あるとき（合計が箱の中の数字だけでは分からない）と、
//   箱が小さくて中に名前と金額の両方は入らないときだけ。箱が1つで中に名前と金額が入るまとまりは出さない（左右とも同じ）
// - 純資産の箱の中も、ほかの箱と同じく白抜きの名前と金額（「資産 − 負債」の説明はカーソルを合わせると出る小さな表示に回す）
// - 純資産の内訳（合算BS）のある箱・純資産のマイナスの箱は今のまま。並べた図の 0 の線と目盛りの高さは見出しがあってもなくてもそろう
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BOX_SHRINK, boxLinesH, boxPad, boxTextLayout, BsFigure, sideLabelNeeded, type BoxTextFit } from "../src/presentation/BsFigure.tsx";
import { figureBoxes, scaleFor } from "../src/presentation/bsLayout.ts";
import type { BsYearModel } from "../src/presentation/model.ts";

const groups = {
  liquid: { name: "すぐ使えるお金", short: "すぐ使える" },
  market: { name: "値動きのある運用", short: "値動きあり" },
  locked: { name: "引き出せないお金", short: "引き出せない" },
  illiquid: { name: "換金しにくい資産", short: "換金しにくい" },
  mortgage: { name: "住宅ローン", short: "住宅ローン" },
  propertyLoan: { name: "不動産のローン", short: "不動産のローン" },
  debt: { name: "その他の負債", short: "その他の負債" },
};
const M = 10_000;
const year = (y: number, lines: BsYearModel["lines"], netParts?: BsYearModel["netParts"]): BsYearModel => {
  const assets = lines.filter((l) => !["mortgage", "propertyLoan", "debt"].includes(l.group)).reduce((s, l) => s + l.amount, 0);
  const debts = lines.filter((l) => ["mortgage", "propertyLoan", "debt"].includes(l.group)).reduce((s, l) => s + l.amount, 0);
  return { year: y, age: 45 + y - 2026, members: "", fact: y === 2026, lines, totalAssets: assets, totalLiabilities: debts, netWorth: assets - debts, financial: 0, shortfall: 0, living: 3_600_000, loanPay: 0, guarantee: 0, events: [], notes: {}, ...(netParts !== undefined ? { netParts } : {}) };
};
// 利用者が見た「3時点を並べる」に近い形（今・退職の年・75歳）
const now = year(2026, [
  { key: "deposit", label: "預金", group: "liquid", amount: 818 * M },
  { key: "nisa", label: "NISA", group: "market", amount: 300 * M },
  { key: "fund", label: "投資信託", group: "market", amount: 59 * M },
  { key: "ideco", label: "iDeCo", group: "locked", amount: 210 * M },
  { key: "land", label: "土地", group: "illiquid", amount: 2242 * M },
  { key: "building", label: "建物", group: "illiquid", amount: 2056 * M },
  { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 2220 * M },
]);
const retire = year(2047, [
  { key: "deposit", label: "預金", group: "liquid", amount: 3158 * M },
  { key: "nisa", label: "NISA", group: "market", amount: 1066 * M },
  { key: "fund", label: "投資信託", group: "market", amount: 116 * M },
  { key: "land", label: "土地", group: "illiquid", amount: 2763 * M },
  { key: "building", label: "建物", group: "illiquid", amount: 754 * M },
  { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 351 * M },
]);
const age75 = year(2056, [
  { key: "deposit", label: "預金", group: "liquid", amount: 1717 * M },
  { key: "nisa", label: "NISA", group: "market", amount: 1517 * M },
  { key: "fund", label: "投資信託", group: "market", amount: 165 * M },
  { key: "land", label: "土地", group: "illiquid", amount: 3022 * M },
  { key: "building", label: "建物", group: "illiquid", amount: 754 * M },
]);
// 合算BS（純資産の内訳がある）
const combined = year(
  2026,
  [
    { key: "deposit", label: "預金", group: "liquid", amount: 3887 * M },
    { key: "co-cash", label: "現預金（会社）", group: "liquid", amount: 4000 * M },
    { key: "land", label: "土地", group: "illiquid", amount: 4690 * M },
    { key: "co-land", label: "土地（会社）", group: "illiquid", amount: 2500 * M },
    { key: "co-longDebt", label: "長期借入金（会社）", group: "debt", amount: 6000 * M },
  ],
  [
    { key: "netCompany", label: "会社の財産（剰余金）", amount: 3000 * M },
    { key: "netOwner", label: "個人の財産", amount: 6077 * M },
  ],
);
// 純資産のマイナス（足りない分）
const minus = year(2040, [
  { key: "deposit", label: "預金", group: "liquid", amount: 300 * M },
  { key: "land", label: "土地", group: "illiquid", amount: 1500 * M },
  { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 2600 * M },
]);

const wide = (y: BsYearModel) => renderToString(h(BsFigure, { year: y, groups, height: 560, label: "1年ずつ見る" }));
const compact = (y: BsYearModel, scale?: number) => renderToString(h(BsFigure, { year: y, groups, height: 460, compact: true, ...(scale !== undefined ? { scale } : {}), label: "並べる" }));
const BOTH = ["two", "three", "one"];

/** 箱（まとまり）ごとの、中の箱の文字の置き方（data-bs-fit） */
function fitsOf(html: string): Map<string, Map<string, BoxTextFit>> {
  const out = new Map<string, Map<string, BoxTextFit>>();
  for (const chunk of html.split("data-bs-baseline")[0]!.split(/(?=<g[^>]*data-bs-box=")/).slice(1)) {
    const key = /data-bs-box="([^"]+)"/.exec(chunk)?.[1] ?? "";
    out.set(key, new Map([...chunk.matchAll(/data-bs-part="([^"]+)" data-bs-fit="([a-z0-9]+)"/g)].map((m) => [m[1] as string, m[2] as BoxTextFit])));
  }
  return out;
}
const labelsOf = (html: string) => new Set([...html.matchAll(/data-bs-label="([^"]+)"/g)].map((m) => m[1] as string));

/** 描いた図で、見出しのある箱がちょうど「要る箱」（sideLabelNeeded）と同じか */
function expectLabelsByRule(y: BsYearModel, html: string) {
  const fits = fitsOf(html);
  const labels = labelsOf(html);
  const { left, right } = figureBoxes(y);
  for (const b of [...left, ...right].filter((b) => b.value >= 5000)) {
    const f = fits.get(b.key);
    if (f === undefined) continue;
    const need = sideLabelNeeded(b.parts.map((p) => ({ value: p.value, fit: f.get(p.key) ?? "none" })));
    expect(labels.has(b.key), `${y.year} ${b.key} ${JSON.stringify([...f])}`).toBe(need);
  }
}

describe("図の外の見出しを出す条件（sideLabelNeeded）", () => {
  it("箱が1つで中に名前と金額が入る（2行・名前を2行に分けて3行・1行）→ 出さない", () => {
    for (const fit of ["two", "three", "one"] as const) expect(sideLabelNeeded([{ value: 2220 * M, fit }]), fit).toBe(false);
  });
  it("箱が1つでも、中に名前と金額の両方は入らない（名前だけ・縮めた名前・何も入れない・狭い画面の金額だけ）→ 出す", () => {
    for (const fit of ["name", "name2", "cut", "none", "value"] as const) expect(sideLabelNeeded([{ value: 351 * M, fit }]), fit).toBe(true);
  });
  it("箱が2つ以上 → 中に名前と金額が入っていても出す（合計が箱の中の数字だけでは分からない）。額の無い箱は数えない", () => {
    expect(sideLabelNeeded([{ value: 2242 * M, fit: "two" }, { value: 2056 * M, fit: "two" }])).toBe(true);
    expect(sideLabelNeeded([{ value: 818 * M, fit: "two" }, { value: 0, fit: "none" }])).toBe(false);
  });
});

describe("境目: 箱がちょうど入るか入らないかの高さ（ふつうの文字・文字「大」）", () => {
  // 文字の大きさ: 1年ずつ見る（0.86）と並べる図（0.92 × 0.78）、根の文字 16px（ふつう）と 19px（文字「大」。app.css の html.big）
  const sizes = [16, 19].flatMap((px) => [
    { what: `1年ずつ見る ${px}px`, f: px * 0.86 },
    { what: `並べる ${px}px`, f: px * 0.92 * 0.78 },
  ]);
  const need = (name: string, value: string, colW: number, hh: number, f: number) => sideLabelNeeded([{ value: 1, fit: boxTextLayout(name, value, colW, hh, f, false).fit }]);

  it("広い柱（名前と金額が1行に並ぶ幅）: 1行の高さちょうどなら中に入って見出しなし、それより低いと見出しを出す", () => {
    for (const { what, f } of sizes) {
      const colW = 240;
      const h1 = boxLinesH(1, f);
      expect(boxTextLayout("住宅ローン", "2,220", colW, h1, f, false).fit, what).toBe("one");
      expect(need("住宅ローン", "2,220", colW, h1, f), what).toBe(false);
      expect(need("住宅ローン", "2,220", colW, h1 - 0.01, f), what).toBe(true);
    }
  });

  it("細い柱（1行には並ばない幅）: 少し小さくした2行の高さちょうどなら見出しなし、それより低いと名前だけになって見出しを出す", () => {
    for (const { what, f } of sizes) {
      // 「住宅ローン」（全角5文字）は入るが、名前と金額を1行に並べる幅は無い柱
      const colW = 6 * f + 2 * boxPad(6 * f + 12);
      const h2 = boxLinesH(2, f * BOX_SHRINK);
      expect(boxTextLayout("住宅ローン", "2,220", colW, h2, f, false).fit, what).toBe("two");
      expect(need("住宅ローン", "2,220", colW, h2, f), what).toBe(false);
      const below = boxTextLayout("住宅ローン", "2,220", colW, h2 - 0.01, f, false);
      expect(below.fit, what).toBe("name");
      expect(need("住宅ローン", "2,220", colW, h2 - 0.01, f), what).toBe(true);
    }
  });
});

describe("図の外の見出しは要る所だけ（描いた図）", () => {
  it("3時点を並べる: 箱が1つで中に入る住宅ローン・純資産・預金だけのすぐ使えるお金は見出しなし。箱が2つ以上の換金しにくい資産は見出しあり", () => {
    const sc = scaleFor([now, retire, age75]);
    const html = compact(now, sc);
    const labels = labelsOf(html);
    expect(labels.has("mortgage")).toBe(false);
    expect(labels.has("netWorth")).toBe(false);
    expect(labels.has("liquid")).toBe(false);
    expect(labels.has("illiquid")).toBe(true);
    expect(labels.has("market")).toBe(true);
    for (const y of [now, retire, age75]) expectLabelsByRule(y, compact(y, sc));
  });

  it("小さくて中に金額が入らない箱（退職の年の住宅ローン 351万円）は、箱が1つでも見出しを出す", () => {
    const html = compact(retire, scaleFor([now, retire, age75]));
    const fit = fitsOf(html).get("mortgage")?.get("mortgage");
    expect(BOTH).not.toContain(fit);
    expect(labelsOf(html).has("mortgage")).toBe(true);
  });

  it("1年ずつ見る（大きな図）: 左右とも同じ決まり", () => {
    for (const y of [now, retire, age75, combined, minus]) expectLabelsByRule(y, wide(y));
    const labels = labelsOf(wide(now));
    expect(labels.has("mortgage")).toBe(false);
    expect(labels.has("netWorth")).toBe(false);
    expect(labels.has("illiquid")).toBe(true);
  });

  it("並べる図でも、純資産の箱の中に名前と金額が出る", () => {
    const html = compact(now, scaleFor([now, retire, age75]));
    expect(html).toMatch(/data-bs-part="netWorth" data-bs-fit="(two|three|one)"[\s\S]*?>純資産<[\s\S]*?>3,465</);
  });
});

describe("純資産の箱の中の文字", () => {
  it("ほかの箱と同じく白抜きの名前と金額（「純資産」「7,506」）。「資産 − 負債」は箱の中に出さない", () => {
    for (const html of [wide(retire), compact(retire, scaleFor([now, retire, age75]))]) {
      const nw = html.slice(html.indexOf('data-bs-part="netWorth"'), html.indexOf("</g>", html.indexOf('data-bs-part="netWorth"')));
      expect(nw).toMatch(/data-bs-fit="(two|three|one)"/);
      expect(nw).toMatch(/<text[^>]*fill="#fff"[^>]*data-bs-text="name">純資産<\/text>/);
      expect(nw).toMatch(/<text[^>]*fill="#fff"[^>]*class="num" data-bs-text="value">7,506<\/text>/);
      expect(html).not.toContain("資産 − 負債");
    }
  });

  it("文字の大きさ・入れ方の順はほかの箱と同じ（同じ高さ・幅なら、住宅ローンの箱と同じ置き方と大きさ）", () => {
    const html = wide(now);
    const sizeOf = (k: string) => new RegExp(`data-bs-part="${k}"[^>]*>[\\s\\S]*?<text[^>]*font-size="([\\d.]+)"`).exec(html)?.[1];
    expect(sizeOf("netWorth")).toBe(sizeOf("mortgage"));
  });

  it("純資産の内訳（合算BS）がある箱は今のまま: 内訳ごとに名前と金額、横に「純資産」の見出し", () => {
    for (const html of [wide(combined), compact(combined)]) {
      const fits = fitsOf(html).get("netWorth");
      expect([...(fits?.keys() ?? [])]).toEqual(["netCompany", "netOwner"]);
      expect(fits?.get("netOwner")).toMatch(/two|three|one/);
      expect(labelsOf(html).has("netWorth")).toBe(true);
    }
  });

  it("純資産のマイナスの箱は今のまま: 点線の枠と「足りない分」、横に「▲」の見出し", () => {
    const html = wide(minus);
    expect(html).toContain('data-bs-box="neg"');
    expect(html).toContain("足りない分");
    expect(labelsOf(html).has("neg")).toBe(true);
  });
});

describe("並べた図の 0 の線と目盛り", () => {
  it("見出しのある図とない図を並べても、0 の線と目盛りの高さはそろう（縮尺と高さが同じ）", () => {
    const sc = scaleFor([now, retire, age75]);
    const htmls = [now, retire, age75].map((y) => compact(y, sc));
    const base = htmls.map((s) => /<line data-bs-baseline[^>]*y1="([\d.]+)"/.exec(s)?.[1]);
    expect(new Set(base).size).toBe(1);
    const tick = htmls.map((s) => /<text[^>]*y="([\d.]+)"[^>]*>2,000<\/text>/.exec(s)?.[1]);
    expect(tick[0]).toBeDefined();
    expect(new Set(tick).size).toBe(1);
    // 見出しの数は図によって違う（中身で決まる）
    expect(new Set(htmls.map((s) => labelsOf(s).size)).size).toBeGreaterThan(1);
  });
});

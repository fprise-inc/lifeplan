// バランスシートの図の見出しと並べ方（0027 の追記 2026-11-24）:
// - 図の外の見出し（名前と合計）は、まとまりの上端から下端までの括弧の真ん中に置く。括弧どうしは重ならない（左右とも同じ形）
// - 0 の線は左の柱の左端から（図の左にはみ出さない）
// - 横に並べた図は 0 の線の高さをそろえる（図の上の物の高さが違っても。alignFigures.ts）
// - 上の帯の世帯の名前: 長い名前はかぎかっこの中だけを「…」で縮め、閉じかぎと ▼ を残す。見本は要約（名前と同じ）を出さない
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BsFigure } from "../src/presentation/BsFigure.tsx";
import { alignOffsets, rowsOf } from "../src/presentation/alignFigures.ts";
import type { BsYearModel } from "../src/presentation/model.ts";
import { splitQuoted, TopBar } from "../src/workspace/header/TopBar.tsx";

const noop = () => undefined;
const groups = {
  liquid: { name: "すぐ使えるお金", short: "すぐ使える" },
  market: { name: "値動きのある運用", short: "値動きあり" },
  locked: { name: "引き出せないお金", short: "引き出せない" },
  illiquid: { name: "換金しにくい資産", short: "換金しにくい" },
  mortgage: { name: "住宅ローン", short: "住宅ローン" },
  propertyLoan: { name: "不動産のローン", short: "不動産のローン" },
  debt: { name: "その他の負債", short: "その他の負債" },
};
const year = (lines: BsYearModel["lines"], netWorth: number, netParts?: BsYearModel["netParts"]): BsYearModel => {
  const assets = lines.filter((l) => !["mortgage", "propertyLoan", "debt"].includes(l.group)).reduce((s, l) => s + l.amount, 0);
  return { year: 2026, age: 57, members: "", fact: true, lines, totalAssets: assets, totalLiabilities: assets - netWorth, netWorth, financial: 0, shortfall: 0, living: 3_600_000, loanPay: 0, guarantee: 0, events: [], notes: {}, ...(netParts !== undefined ? { netParts } : {}) };
};
const M = 10_000;
// 合算BS の合算の1枚に近い形（細い箱・長い名前・純資産の内訳）
const combined = year(
  [
    { key: "deposit", label: "預金", group: "liquid", amount: 3887 * M },
    { key: "co-cash", label: "現預金（会社）", group: "liquid", amount: 4000 * M },
    { key: "nisa", label: "NISA", group: "market", amount: 924 * M },
    { key: "mutualAid", label: "小規模企業共済", group: "locked", amount: 1221 * M },
    { key: "land", label: "土地", group: "illiquid", amount: 4690 * M },
    { key: "co-receivables", label: "売上債権（会社）", group: "illiquid", amount: 2500 * M },
    { key: "co-inventory", label: "在庫（会社）", group: "illiquid", amount: 450 * M },
    { key: "co-land", label: "土地（会社）", group: "illiquid", amount: 2500 * M },
    { key: "co-shortDebt", label: "短期借入金（会社）", group: "debt", amount: 1200 * M },
    { key: "co-longDebt", label: "長期借入金（会社）", group: "debt", amount: 6000 * M },
    { key: "co-otherLiabilities", label: "その他の負債（会社）", group: "debt", amount: 1700 * M },
  ],
  10_272 * M,
  [
    { key: "netCompany", label: "会社の財産（剰余金）", amount: 4000 * M },
    { key: "netOwner", label: "個人の財産", amount: 6272 * M },
  ],
);
const home = year(
  [
    { key: "deposit", label: "預金", group: "liquid", amount: 870 * M },
    { key: "nisa", label: "NISA", group: "market", amount: 251 * M },
    { key: "land", label: "土地", group: "illiquid", amount: 1469 * M },
    { key: "building", label: "建物", group: "illiquid", amount: 1347 * M },
    { key: "insurance", label: "保険の解約返戻金", group: "illiquid", amount: 214 * M },
    { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 2219 * M },
  ],
  1934 * M,
);

const draws = (y: BsYearModel) => [renderToString(h(BsFigure, { year: y, groups, height: 560, label: "広い" })), renderToString(h(BsFigure, { year: y, groups, height: 460, compact: true, label: "並べる" }))];
const num = (s: string | undefined) => Number(s);

/** 箱（まとまり）ごとの上端・下端（中の箱の四角から） */
function boxes(html: string): Map<string, { top: number; bot: number; x: number }> {
  const out = new Map<string, { top: number; bot: number; x: number }>();
  for (const chunk of html.split(/(?=<g[^>]*data-bs-box=")/).slice(1)) {
    const key = /data-bs-box="([^"]+)"/.exec(chunk)?.[1] ?? "";
    const rects = [...chunk.split("data-bs-baseline")[0]!.matchAll(/<rect class="bsf-seg" x="([\d.-]+)" y="([\d.-]+)" width="[\d.]+" height="([\d.]+)"/g)].map((m) => ({ x: num(m[1]), y: num(m[2]), h: num(m[3]) }));
    if (rects.length === 0) continue;
    out.set(key, { top: Math.min(...rects.map((r) => r.y)), bot: Math.max(...rects.map((r) => r.y + r.h)), x: Math.min(...rects.map((r) => r.x)) });
  }
  return out;
}
/** 括弧（data-bs-bracket）の上端・下端・縦の線の x */
function brackets(html: string): { key: string; x: number; top: number; bot: number }[] {
  return [...html.matchAll(/data-bs-bracket="([^"]+)" d="M([\d.-]+) ([\d.-]+) L([\d.-]+) ([\d.-]+) L([\d.-]+) ([\d.-]+)/g)].map((m) => ({ key: m[1] as string, x: num(m[4]), top: num(m[3]), bot: num(m[7]) }));
}

describe("図の外の見出しの括弧", () => {
  it("まとまりの上端から下端まで（箱の範囲の中）に括弧を引き、括弧どうしは重ならない。左右とも同じ形", () => {
    for (const y of [combined, home]) {
      for (const html of draws(y)) {
        const bx = boxes(html);
        const bs = brackets(html);
        expect(bs.length).toBeGreaterThanOrEqual(4);
        for (const b of bs) {
          const box = bx.get(b.key)!;
          expect(b.top, b.key).toBeGreaterThanOrEqual(box.top - 0.01);
          expect(b.bot, b.key).toBeLessThanOrEqual(box.bot + 0.01);
          // 箱の高さのほとんどを覆う（どこからどこまでかが分かる）
          expect(b.bot - b.top, b.key).toBeGreaterThanOrEqual(box.bot - box.top - 6);
        }
        // 同じ側の括弧どうしが重ならない
        for (const side of [bs.filter((b) => b.x < (bx.get("liquid")?.x ?? 0) + 1), bs.filter((b) => b.x > (bx.get("liquid")?.x ?? 0) + 1)]) {
          const s = [...side].sort((a, c) => a.top - c.top);
          for (let i = 1; i < s.length; i++) expect(s[i]!.top, `${s[i - 1]!.key}→${s[i]!.key}`).toBeGreaterThan(s[i - 1]!.bot);
        }
        // 左（資産）と右（負債＋純資産）の両方にある
        expect(bs.some((b) => b.key === "liquid")).toBe(true);
        expect(bs.some((b) => b.key === "netWorth")).toBe(true);
      }
    }
  });

  it("見出しは括弧の真ん中に置く（混んでずれたときだけ、括弧の真ん中から短い線でつなぐ）", () => {
    const html = draws(home)[0]!;
    const bs = brackets(html);
    const nw = bs.find((b) => b.key === "netWorth")!;
    const lab = html.slice(html.indexOf('data-bs-label="netWorth"'));
    const ys = [...lab.matchAll(/<text x="[\d.]+" y="([\d.]+)"/g)].slice(0, 2).map((m) => num(m[1]));
    // 名前と金額の2行のまん中が、括弧のまん中に近い
    expect(Math.abs((ys[0]! + ys[1]!) / 2 - (nw.top + nw.bot) / 2)).toBeLessThan(20);
  });
});

describe("0 の線", () => {
  it("左の柱の左端から始まる（図の左にはみ出さない）", () => {
    for (const y of [combined, home]) {
      for (const html of draws(y)) {
        const x1 = num(/<line[^>]*data-bs-baseline[^>]*x1="([\d.]+)"/.exec(html)?.[1]);
        const left = Math.min(...[...boxes(html).values()].map((b) => b.x));
        expect(x1).toBeGreaterThanOrEqual(left - 0.01);
      }
    }
  });
});

describe("箱の中の文字（合算BS の細い柱）", () => {
  it("入る箱には名前（と金額）を入れる。何も入らないのは小さすぎる箱だけ", () => {
    const html = draws(combined)[1]!;
    const parts = [...html.matchAll(/data-bs-part="([^"]+)" data-bs-fit="([a-z0-9]+)"/g)].map((m) => ({ key: m[1], fit: m[2] }));
    const fit = (k: string) => parts.find((p) => p.key === k)?.fit;
    expect(fit("deposit")).toMatch(/two|three|one/);
    expect(fit("co-longDebt")).toMatch(/two|three|one/);
    expect(fit("netCompany")).not.toBe("none");
    expect(fit("netOwner")).toMatch(/two|three|one/);
    // 白い文字（箱の色はどれも白い文字との差 4.5:1 以上。bs-colors.test.ts）
    expect(html).toMatch(/data-bs-part="co-longDebt"[\s\S]*?<text[^>]*fill="#fff"/);
  });
});

describe("横に並べた図の 0 の線をそろえる", () => {
  it("同じ行（上下の範囲が重なる）の図は、いちばん下の 0 の線に合わせて上に余白を足す。1列に並ぶ図はそろえない", () => {
    // 時点を並べる: 左の図だけ上に帯があって 40px 下がっている
    const rows = rowsOf([
      { top: 240, bottom: 700 },
      { top: 200, bottom: 660 },
      { top: 200, bottom: 660 },
    ]);
    expect(rows).toEqual([[1, 2, 0]]);
    expect(alignOffsets([700, 660, 660], rows)).toEqual([0, 40, 40]);
    // 狭い画面で1列（重ならない）: 余白を足さない
    const col = rowsOf([
      { top: 0, bottom: 400 },
      { top: 420, bottom: 820 },
    ]);
    expect(col).toEqual([[0], [1]]);
    expect(alignOffsets([380, 800], col)).toEqual([0, 0]);
    // 4つ並べて2行に折り返したとき: 行ごとにそろえる
    const two = rowsOf([
      { top: 0, bottom: 400 },
      { top: 20, bottom: 420 },
      { top: 500, bottom: 900 },
      { top: 510, bottom: 910 },
    ]);
    expect(two).toEqual([[0, 1], [2, 3]]);
    expect(alignOffsets([390, 410, 890, 895], two)).toEqual([20, 0, 5, 0]);
  });
});

describe("上の帯の世帯の名前", () => {
  const bar = (household: { no: string; sub: string; fictional?: boolean }) => renderToString(h(TopBar, { tabs: [{ id: "main", label: "結果" }], tab: "main", onTab: noop, household: { ...household, open: false, onToggle: noop }, alerts: [], notices: { items: [], onRead: noop, focus: null } as never, tools: null, big: false, onBig: noop }));
  it("かぎかっこの前・中・後ろに分ける（中だけを縮める）。かぎかっこが無ければ分けない", () => {
    expect(splitQuoted("見本「会社を経営する夫婦と子1人・50代（合算BS の見本）」")).toEqual({ before: "見本「", inner: "会社を経営する夫婦と子1人・50代（合算BS の見本）", after: "」" });
    expect(splitQuoted("見本「名前に「かぎ」がある」")).toEqual({ before: "見本「", inner: "名前に「かぎ」がある", after: "」" });
    expect(splitQuoted("A0042-1")).toBeNull();
    expect(splitQuoted("見本「」")).toBeNull();
  });
  it("見本: 閉じかぎと ▼ はいつも描き、要約（名前と同じ）は出さない。全部の名前はカーソルを合わせると出る", () => {
    const long = "とても長い名前の見本の世帯です全角三十字になるまで足していきますよ";
    const html = bar({ no: `見本「${long}」`, sub: long });
    expect(html).toMatch(/<span class="hh-qm">見本「<\/span><span class="hh-q">とても長い[^<]*<\/span><span class="hh-qm">」<\/span>/);
    expect(html).toContain("▼");
    expect(html).not.toContain("hh-sub");
    expect(html).toContain(`title="見本「${long}」"`);
  });
  it("顧客番号の世帯: 番号と要約（要約は入らなければ隠す）。架空の印も残す", () => {
    const html = bar({ no: "ABCDEFGHIJ-12345", sub: "本人・配偶者・子1人", fictional: true });
    expect(html).toContain('<span class="hh-q">ABCDEFGHIJ-12345</span>');
    expect(html).toContain('<span class="hh-sub">本人・配偶者・子1人</span>');
    expect(html).toContain("data-household-fictional");
    expect(html).toContain('title="ABCDEFGHIJ-12345 本人・配偶者・子1人"');
    // 空の要約は出さない
    expect(bar({ no: "0001", sub: "" })).not.toContain("hh-sub");
  });
});

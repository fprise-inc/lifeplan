// バランスシートの図の色と形（画面の balance.css・提案書の Typst）:
// - 箱の中の文字は白で小さい（画面 11〜14px の太字・提案書 7pt の太字）ので、どの色も白い文字との差 4.5:1 以上（WCAG の小さい文字の基準）
// - 意味で色相を分ける: 資産は青の仲間、負債は茶、純資産はアプリの藍の仲間（主役と分かる濃さ）
// - 隣り合う箱は、色の見え方の違う人（P・D・T型。2009年に発表された色覚の模し方の行列、強さ100%）と白黒の印刷でも分かれる（CIEDE2000 の色の差）
// - 提案書の図は画面と同じ色
// - 箱の形: 箱の間に細い余白、角を少し丸める。札・見出し・目盛りが枠の外で欠けたり重なったりしない
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BOX_GAP, BOX_RADIUS, BsFigure } from "../src/presentation/BsFigure.tsx";
import type { BsYearModel } from "../src/presentation/model.ts";
import { APP_DIR } from "../scripts/lib.ts";

const css = readFileSync(join(APP_DIR, "src", "styles", "balance.css"), "utf8");
const root = css.slice(0, css.indexOf("}"));
const app = new Map([...root.matchAll(/--bs-([\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1] as string, m[2] as string]));
const typ = readFileSync(join(APP_DIR, "..", "report", "typst", "report-core", "parts", "layout.typ"), "utf8");
const typColors = new Map([...(/#let bs-colors = \(([\s\S]*?)\n\)/.exec(typ)?.[1] ?? "").matchAll(/(\w+): rgb\("(#[0-9a-f]{6})"\)/g)].map((m) => [m[1] as string, m[2] as string]));
const appProp = /--prop: (#[0-9a-f]{6})/.exec(readFileSync(join(APP_DIR, "src", "styles", "app.css"), "utf8"))?.[1] ?? "";
const c = (k: string) => {
  const v = app.get(k);
  if (v === undefined) throw new Error(`--bs-${k} がない`);
  return v;
};

// ---- 色の計算 ----
type V3 = [number, number, number];
const rgb = (hex: string): V3 => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as V3;
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lin = (hex: string): V3 => rgb(hex).map(toLin) as V3;
const lum = (l: V3) => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
const ratioWhite = (hex: string) => 1.05 / (lum(lin(hex)) + 0.05);
const CVD_MATRIX: Record<"P" | "D" | "T", [V3, V3, V3]> = {
  P: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  D: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  T: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
/** 線形の値を、画面に出せる 8 ビットの色に丸めて線形に戻す */
const quant = (v: number) => {
  const x = Math.min(1, Math.max(0, v));
  return toLin(Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055) * 255) / 255);
};
/** 見え方を置き換えた線形の RGB（N: ふつう、G: 白黒の印刷＝明るさだけの灰色）。8 ビットの色に丸める */
function sim(hex: string, k: "N" | "P" | "D" | "T" | "G"): V3 {
  const l = lin(hex);
  if (k === "N") return l;
  if (k === "G") {
    const y = quant(lum(l));
    return [y, y, y];
  }
  return CVD_MATRIX[k].map((r) => quant(r[0] * l[0] + r[1] * l[1] + r[2] * l[2])) as V3;
}
function lab(l: V3): V3 {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = (0.4124 * l[0] + 0.3576 * l[1] + 0.1805 * l[2]) / 0.95047;
  const Y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  const Z = (0.0193 * l[0] + 0.1192 * l[1] + 0.9505 * l[2]) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
/** CIEDE2000 の色の差 */
function de2000(p: V3, q: V3): number {
  const [L1, a1, b1] = lab(p);
  const [L2, a2, b2] = lab(q);
  const rad = Math.PI / 180;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1 = Math.hypot(a1p, b1);
  const C2 = Math.hypot(a2p, b2);
  const h1 = (Math.atan2(b1, a1p) / rad + 360) % 360;
  const h2 = (Math.atan2(b2, a2p) / rad + 360) % 360;
  let dh = C1 * C2 === 0 ? 0 : h2 - h1;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2;
  const Cbp = (C1 + C2) / 2;
  const hb = C1 * C2 === 0 ? h1 + h2 : Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const dth = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dth * rad) * RC;
  const x = (L2 - L1) / SL;
  const y = (C2 - C1) / SC;
  const z = dH / SH;
  return Math.sqrt(x * x + y * y + z * z + RT * y * z);
}
/** OKLCH の色相（度） */
function hue(hex: string): number {
  const [r, g, b] = lin(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
}

const ASSETS = ["deposit", "zaikei", "finOther", "nisa", "childNisa", "taxable", "fxDeposit", "esop", "pooled", "cryptoAsset", "ideco", "corporateDc", "mutualAid", "land", "building", "realEstateOther", "car", "insurance", "otherAsset"];
const DEBTS = ["mortgage", "propertyLoan", "carLoan", "scholarship", "debtOther"];

describe("バランスシートの図の色", () => {
  it("箱の色はどれも白い文字との差 4.5:1 以上（資金の不足の斜線・図の外の文字の色は除く）", () => {
    const boxes = [...app.entries()].filter(([k]) => !["short", "short-line"].includes(k));
    expect(boxes.length).toBeGreaterThan(30);
    for (const [k, v] of boxes) expect(ratioWhite(v), `--bs-${k} ${v}`).toBeGreaterThanOrEqual(4.5);
    for (const [k, v] of typColors) expect(ratioWhite(v), `Typst ${k} ${v}`).toBeGreaterThanOrEqual(4.5);
  });

  it("意味で色相を分ける: 資産は青の仲間（青緑〜青）、負債は茶、純資産はアプリの藍の仲間で、濃さを保つ", () => {
    for (const k of ASSETS) expect(hue(c(k)), k).toBeGreaterThanOrEqual(170);
    for (const k of ASSETS) expect(hue(c(k)), k).toBeLessThanOrEqual(262);
    for (const k of DEBTS) expect(hue(c(k)), k).toBeGreaterThanOrEqual(30);
    for (const k of DEBTS) expect(hue(c(k)), k).toBeLessThanOrEqual(80);
    expect(Math.abs(hue(c("netWorth")) - hue(appProp))).toBeLessThan(6);
    // 主役: 白い文字との差 6:1 以上の濃さ（いちばん明るい資産の色よりはっきり濃い）
    expect(ratioWhite(c("netWorth"))).toBeGreaterThanOrEqual(6);
    // 金融資産の3層と換金しにくい資産: すぐ使えるお金・値動きのある運用は、換金しにくい資産（灰色がかった青）よりあざやか
    // 建物は土地より明るい（年数とともに減っていく資産）
    expect(lum(lin(c("building")))).toBeGreaterThan(lum(lin(c("land"))) * 1.3);
  });

  it("隣り合う箱は、ふつう・P型・D型・T型・白黒の印刷のどれでも色の差（CIEDE2000）8 以上", () => {
    const pairs: [string, string][] = [
      ["deposit", "nisa"],
      ["nisa", "ideco"],
      ["ideco", "land"],
      ["nisa", "land"],
      ["land", "building"],
      ["mortgage", "netWorth"],
      ["mortgage", "carLoan"],
      ["building", "car"],
    ];
    for (const k of ["N", "P", "D", "T", "G"] as const)
      for (const [a, b] of pairs) expect(de2000(sim(c(a), k), sim(c(b), k)), `${k} ${a}-${b}`).toBeGreaterThanOrEqual(8);
    // その他の負債と純資産（住宅ローンの下）も、白黒の印刷で分かれる
    for (const d of DEBTS.slice(1)) expect(de2000(sim(c(d), "G"), sim(c("netWorth"), "G")), d).toBeGreaterThanOrEqual(6.5);
  });

  it("提案書の図は画面と同じ色", () => {
    const same: Record<string, string> = { liquid: "deposit", market: "nisa", locked: "ideco", illiquid: "land", land: "land", building: "building", illiquidOther: "car", mortgage: "mortgage", debt: "carLoan", netWorth: "netWorth" };
    expect([...typColors.keys()].sort()).toEqual(Object.keys(same).sort());
    for (const [t, a] of Object.entries(same)) expect(typColors.get(t), t).toBe(c(a));
    // 推移のグラフの色も図の箱と同じ
    for (const [g, a] of Object.entries({ "g-liquid": "deposit", "g-market": "nisa", "g-locked": "ideco", "g-realEstate": "land", "g-other": "car", "g-mortgage": "mortgage", "g-debt": "carLoan", "t-mortgage": "mortgage", "t-debt": "carLoan" })) expect(c(g), g).toBe(c(a));
  });
});

// ---- 形と、札・見出し・目盛りの置き方 ----
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
  return { year: 2056, age: 75, members: "", fact: false, lines, totalAssets: assets, totalLiabilities: assets - netWorth, netWorth, financial: 0, shortfall: 0, living: 3_600_000, loanPay: 0, guarantee: 0, events: [], notes: {} };
};
const rects = (html: string) =>
  [...html.matchAll(/<rect class="bsf-seg"([^>]*)>/g)].map((m) => {
    const a = (n: string) => Number(new RegExp(` ${n}="([^"]+)"`).exec(m[1] as string)?.[1]);
    return { x: a("x"), y: a("y"), h: a("height"), rx: a("rx"), stroke: (m[1] as string).includes("stroke=") };
  });
/** 文字の幅の目安（BsFigure と同じ: 全角1・半角0.6） */
const textW = (s: string, f: number) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 1 : 0.6), 0) * f;

describe("バランスシートの図の形", () => {
  const rich = year(
    [
      { key: "deposit", label: "預金", group: "liquid", amount: 8_600_000 },
      { key: "nisa", label: "NISA", group: "market", amount: 2_510_000 },
      { key: "ideco", label: "iDeCo", group: "locked", amount: 1_800_000 },
      { key: "land", label: "土地", group: "illiquid", amount: 14_690_000 },
      { key: "building", label: "建物", group: "illiquid", amount: 13_470_000 },
      { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 22_190_000 },
    ],
    18_880_000,
  );

  it("箱は枠線なし、角を少し丸め、隣の箱との間に細い余白", () => {
    for (const compact of [false, true]) {
      const rs = rects(renderToString(h(BsFigure, { year: rich, groups, height: 420, compact, label: "図" })));
      expect(rs.length).toBe(7);
      for (const r of rs) {
        expect(r.stroke).toBe(false);
        expect(r.rx).toBe(Math.min(BOX_RADIUS, r.h / 2));
      }
      for (const side of new Set(rs.map((r) => r.x))) {
        const col = rs.filter((r) => r.x === side).sort((a, b) => a.y - b.y);
        for (let i = 1; i < col.length; i++) {
          const prev = col[i - 1]!;
          expect(col[i]!.y - (prev.y + prev.h)).toBeCloseTo(BOX_GAP, 5);
        }
      }
    }
  });

  it("並べる小さな図で純資産が大きくマイナスでも、左の札（▲○万円）が枠の左で欠けない", () => {
    const minus = year(
      [
        { key: "land", label: "土地", group: "illiquid", amount: 24_740_000 },
        { key: "short", label: "資金の不足", group: "debt", amount: 114_500_000 },
      ],
      -89_760_000,
    );
    const html = renderToString(h(BsFigure, { year: minus, groups, height: 300, compact: true, label: "並べる" }));
    const m = /data-bs-label="neg"[\s\S]*?<text x="([\d.]+)"[^>]*font-size="([\d.]+)"[\s\S]*?<text x="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>▲([\d,]+)<tspan font-size="([\d.]+)"/.exec(html);
    expect(m).not.toBeNull();
    const [, , , ax, af, amount, uf] = m!;
    const width = textW(`▲${amount}`, Number(af)) + textW("万円", Number(uf));
    expect(Number(ax) - width).toBeGreaterThanOrEqual(0);
  });

  it("1億円を超える年でも、見出しの左右の金額が「＝」に触れず、目盛りの数字が目盛りの線から離れる", () => {
    const big = year(
      [
        { key: "deposit", label: "預金", group: "liquid", amount: 35_530_000 },
        { key: "nisa", label: "NISA", group: "market", amount: 39_400_000 },
        { key: "land", label: "土地", group: "illiquid", amount: 37_070_000 },
        { key: "building", label: "建物", group: "illiquid", amount: 52_330_000 },
        { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 4_720_000 },
      ],
      159_610_000,
    );
    for (const compact of [false, true]) {
      const html = renderToString(h(BsFigure, { year: big, groups, height: 420, compact, label: "図" }));
      // 見出し: 左右の金額の右端・左端と「＝」の間に、すき間がある
      const heads = [...html.matchAll(/<text x="([\d.]+)"[^>]*text-anchor="middle" font-size="([\d.]+)" font-weight="700" fill="var\(--ink\)" class="num">([\d,]+)<tspan font-size="([\d.]+)">万円/g)].map((x) => ({ cx: Number(x[1]), w: textW(x[3] as string, Number(x[2])) + textW("万円", Number(x[4])) }));
      const eq = /<text x="([\d.]+)"[^>]*text-anchor="middle" font-size="([\d.]+)"[^>]*>＝<\/text>/.exec(html);
      expect(heads.length).toBe(2);
      const ex = Number(eq![1]);
      const ew = textW("＝", Number(eq![2]));
      expect(ex - ew / 2 - (heads[0]!.cx + heads[0]!.w / 2)).toBeGreaterThan(4);
      expect(heads[1]!.cx - heads[1]!.w / 2 - (ex + ew / 2)).toBeGreaterThan(4);
      // 目盛り: 一番上の数字（5桁）の左端が、目盛りの縦の線と印（5px）より右
      const axis = /<line x1="([\d.]+)" x2="\1" y1="[\d.]+" y2="[\d.]+" stroke="var\(--line\)"/.exec(html);
      const ticks = [...html.matchAll(/<text x="([\d.]+)"[^>]*text-anchor="end" font-size="([\d.]+)" fill="var\(--ink-2\)">([\d,]+)<\/text>/g)].map((x) => Number(x[1]) - textW(x[3] as string, Number(x[2])));
      expect(ticks.length).toBeGreaterThan(2);
      expect(Math.min(...ticks)).toBeGreaterThan(Number(axis![1]) + 5);
    }
  });
});

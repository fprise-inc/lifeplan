// 提案書の見本の画面の計算（workspace/report/viewer.ts）: 拡大・縮小の倍率、ページを先に読む順、見本の SVG の許可
import { describe, expect, it } from "vitest";
import { ACTUAL, allowedSvgAttr, allowedSvgTag, MAX_ZOOM, MIN_ZOOM, percentOf, prefetchOrder, scaleOf, stepZoom, VIEW_PAD, wheelZoom } from "../src/workspace/report/viewer.ts";

const A4 = [595.28, 841.89] as const;
const A4L = [841.89, 595.28] as const;

describe("拡大・縮小", () => {
  it("ページ全体は縦も横も窓に収まる（縦のページは高さで決まる）", () => {
    const s = scaleOf({ mode: "page" }, [900, 700], A4);
    expect(A4[1] * s).toBeCloseTo(700 - 2 * VIEW_PAD, 5);
    expect(A4[0] * s).toBeLessThanOrEqual(900 - 2 * VIEW_PAD);
  });

  it("横のページは幅で決まることがある。幅に合わせるは横幅だけで決まる", () => {
    const page = scaleOf({ mode: "page" }, [700, 900], A4L);
    expect(A4L[0] * page).toBeCloseTo(700 - 2 * VIEW_PAD, 5);
    const width = scaleOf({ mode: "width" }, [900, 300], A4);
    expect(A4[0] * width).toBeCloseTo(900 - 2 * VIEW_PAD, 5);
  });

  it("倍率の表示は実寸を 100%。＋／− は刻みを進み、上限と下限で止まる", () => {
    expect(percentOf(ACTUAL)).toBe(100);
    expect(percentOf(stepZoom(ACTUAL, 1))).toBe(110);
    expect(percentOf(stepZoom(ACTUAL, -1))).toBe(90);
    expect(percentOf(stepZoom(0.8 * ACTUAL, 1))).toBe(90);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(scaleOf({ mode: "custom", scale: 100 }, [900, 700], A4)).toBe(MAX_ZOOM);
  });

  it("Ctrl/⌘＋ホイール: 手前に回すと拡大、奥に回すと縮小", () => {
    expect(wheelZoom(ACTUAL, -100)).toBeGreaterThan(ACTUAL);
    expect(wheelZoom(ACTUAL, 100)).toBeLessThan(ACTUAL);
    expect(wheelZoom(MIN_ZOOM, 10000)).toBe(MIN_ZOOM);
  });

  it("窓の大きさがまだ分からないときは実寸", () => {
    expect(scaleOf({ mode: "page" }, [0, 0], A4)).toBe(ACTUAL);
  });
});

describe("ページを先に読む順", () => {
  it("表示中 → 次 → 前 → 近い順。読んだページは除く", () => {
    expect(prefetchOrder(3, 7, new Set())).toEqual([3, 4, 2, 5, 1, 6, 0]);
    expect(prefetchOrder(0, 4, new Set([1]))).toEqual([0, 2, 3]);
    expect(prefetchOrder(5, 6, new Set([0, 1, 2, 3, 4, 5]))).toEqual([]);
  });
});

describe("見本の SVG の許可", () => {
  it("Typst の SVG の要素は残し、スクリプト・外の文書・画像・リンク・style は捨てる", () => {
    for (const t of ["svg", "g", "path", "use", "defs", "symbol", "clipPath", "linearGradient"]) expect(allowedSvgTag(t), t).toBe(true);
    for (const t of ["script", "foreignObject", "image", "a", "style", "iframe", "animate", "set"]) expect(allowedSvgTag(t), t).toBe(false);
  });

  it("参照は文書の中の印（#…）だけ。on…・style の属性は捨てる", () => {
    expect(allowedSvgAttr("xlink:href", "#g1a2b")).toBe(true);
    expect(allowedSvgAttr("href", "https://example.com/")).toBe(false);
    expect(allowedSvgAttr("xlink:href", "javascript:alert(1)")).toBe(false);
    expect(allowedSvgAttr("onload", "x()")).toBe(false);
    expect(allowedSvgAttr("style", "fill:red")).toBe(false);
    expect(allowedSvgAttr("clip-path", "url(#c1)")).toBe(true);
    expect(allowedSvgAttr("fill", "url(https://example.com/a.svg#p)")).toBe(false);
    expect(allowedSvgAttr("fill", "#1f2933")).toBe(true);
    expect(allowedSvgAttr("transform", "matrix(1 0 0 1 10 20)")).toBe(true);
  });
});

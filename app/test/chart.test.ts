import { describe, expect, it } from "vitest";
import { areaBelow, FRAME, linePath, niceStep, scale } from "../src/presentation/chart.ts";

describe("グラフの座標", () => {
  it("目盛りの間隔は 1・2・5 の10のべき", () => {
    expect(niceStep(10_000)).toBe(2000);
    expect(niceStep(7_000)).toBe(2000);
    expect(niceStep(400)).toBe(100);
    expect(niceStep(0)).toBe(1);
  });
  it("縦の目盛りは 0 を必ず含み、系列の最小・最大を覆う", () => {
    const s = scale([[12_000_000, 58_000_000], [-25_000_000, 0]], 2);
    expect(s.ticks).toContain(0);
    expect(s.min).toBeLessThanOrEqual(-2500);
    expect(s.max).toBeGreaterThanOrEqual(5800);
    expect(s.y(0)).toBeGreaterThan(FRAME.top);
    expect(s.y(s.max * 10000)).toBeCloseTo(FRAME.top);
  });
  it("不足の面は 0 を横切るところから始まり、0 に戻って閉じる", () => {
    const s = scale([[10, 5, -5, -10]], 4);
    const d = areaBelow([10, 5, -5, -10], s);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    // 0 の高さの点が2つ（入りと出）
    expect(d.split(s.y(0).toFixed(1)).length - 1).toBe(2);
    expect(areaBelow([1, 2, 3], s)).toBe("");
    expect(linePath([1, 2], s).split("L").length).toBe(2);
  });
});

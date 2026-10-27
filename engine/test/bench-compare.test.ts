// 0005 の追記（2026-10-28）: 速さの計測の前の値の取り方と、警告・失敗の線（scripts/bench-compare.ts）
import { describe, expect, it } from "vitest";
import { type BenchResult, compareAll, crossOsTime, type HistoryEntry, median, noisyLoad, usableNights } from "../scripts/bench-compare.ts";

const night = (at: string, single: number, count = 100, ins?: number, tool = "cachegrind"): HistoryEntry => ({
  at,
  result: {
    node: { single: { median: single + 5, min: single } },
    counts: { single: count },
    ...(ins === undefined ? {} : { instructions: { tool, values: { "quickjs.startupSingle": ins } } }),
  },
});

describe("前の値", () => {
  it("中央値（偶数の件数は真ん中の2つの平均）", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("新しい順に最大5晩。bench/baseline.json を書き換えた時刻より前の晩は使わない", () => {
    const h = ["2026-11-01", "2026-11-03", "2026-11-02", "2026-11-05", "2026-11-04", "2026-11-06", "2026-10-30"].map((d) => night(d, 1));
    expect(usableNights(h, undefined).map((x) => x.at)).toEqual(["2026-11-06", "2026-11-05", "2026-11-04", "2026-11-03", "2026-11-02"]);
    expect(usableNights(h, "2026-11-04T00:00:00Z").map((x) => x.at)).toEqual(["2026-11-06", "2026-11-05"]);
  });

  it("晩が3つ以上あれば中央値、無ければ bench/baseline.json の値", () => {
    const now: BenchResult = { node: { single: { median: 110, min: 100 } }, counts: { single: 100 } };
    const three = [night("2026-11-01", 90), night("2026-11-02", 200), night("2026-11-03", 95)];
    const c = compareAll(now, three, { time: { min: { "node.single": 50 } } });
    expect(c.find((x) => x.kind === "time")).toMatchObject({ prev: 95, from: "毎晩3回の中央値" });
    const c2 = compareAll(now, three.slice(0, 2), { time: { min: { "node.single": 50 } } });
    expect(c2.find((x) => x.kind === "time")).toMatchObject({ prev: 50, from: "bench/baseline.json" });
    // 前の値が無い物差しは比べない
    expect(compareAll(now, [], {})).toEqual([]);
  });
});

describe("線", () => {
  const nights = [night("2026-11-01", 100, 1000, 5000), night("2026-11-02", 100, 1000, 5000), night("2026-11-03", 100, 1000, 5000)];
  const at = (count: number, ins: number, single = 100, tool = "cachegrind"): BenchResult => ({
    node: { single: { median: single, min: single } },
    counts: { single: count },
    instructions: { tool, values: { "quickjs.startupSingle": ins } },
  });

  it("呼び出しの回数と cachegrind の命令の数は +5% で警告、+10% で失敗", () => {
    const lv = (r: BenchResult) => Object.fromEntries(compareAll(r, nights, {}).map((c) => [c.kind, c.level]));
    expect(lv(at(1050, 5250))).toMatchObject({ count: "ok", instructions: "ok" });
    expect(lv(at(1051, 5300))).toMatchObject({ count: "warning", instructions: "warning" });
    expect(lv(at(1101, 5600))).toMatchObject({ count: "error", instructions: "error" });
  });

  it("time -l の命令の数は警告だけ。道具が違う晩とは比べない", () => {
    const h = nights.map((n) => ({ ...n, result: { ...n.result, instructions: { tool: "time -l", values: { "quickjs.startupSingle": 5000 } } } }));
    const c = compareAll(at(1000, 9000, 100, "time -l"), h, {}).find((x) => x.kind === "instructions");
    expect(c?.level).toBe("warning");
    expect(compareAll(at(1000, 9000, 100, "time -l"), nights, {}).some((x) => x.kind === "instructions")).toBe(false);
  });

  it("時間は1つの OS の中では知らせず、両方の OS が 1.5倍を超えたら警告・3倍を超えたら失敗", () => {
    const one = (single: number) => compareAll(at(1000, 5000, single), nights, {});
    expect(one(400).find((x) => x.kind === "time")?.level).toBe("ok");
    expect(crossOsTime(one(200), one(140))[0]?.level).toBe("ok");
    expect(crossOsTime(one(160), one(155))[0]?.level).toBe("warning");
    expect(crossOsTime(one(400), one(140))[0]?.level).toBe("ok");
    expect(crossOsTime(one(310), one(301))[0]?.level).toBe("error");
  });

  it("負荷の平均が論理コア数の半分を超えたら揺れが大きい", () => {
    expect(noisyLoad(5, 10)).toBe(false);
    expect(noisyLoad(5.1, 10)).toBe(true);
  });
});

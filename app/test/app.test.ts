import { describe, expect, it } from "vitest";
import { parseHash } from "../src/workspace/App.tsx";

describe("URL の # の後ろ（画面の確かめ用）", () => {
  it("読み取る", () => {
    expect(parseHash("")).toEqual({ big: false, selfcheck: false });
    expect(parseHash("#big&household=salariedCoupleTwoKids&levers=65,70,30000,280000&year=2047&evidence=pension:self:2047")).toEqual({
      big: true,
      selfcheck: false,
      household: "salariedCoupleTwoKids",
      levers: [65, 70, 30000, 280000],
      year: 2047,
      evidence: { row: "pension:self", year: 2047 },
    });
  });
  it("入力のホームで開くパネルとメモの引き出し（#stage= は #open= と同じ）", () => {
    expect(parseHash("#tab=input&open=work&level=detail&memo")).toEqual({ big: false, selfcheck: false, tab: "input", open: "work", level: "detail", memo: true });
    expect(parseHash("#stage=added:abc-1").open).toBe("added:abc-1");
    expect(parseHash("#open=<x>").open).toBeUndefined();
  });
});

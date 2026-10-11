import { describe, expect, it } from "vitest";
import { parseHash } from "../src/workspace/App.tsx";

describe("URL の # の後ろ（画面の確かめ用）", () => {
  it("読み取る", () => {
    expect(parseHash("")).toEqual({ share: false, selfcheck: false });
    expect(parseHash("#share&household=salariedCoupleTwoKids&levers=65,70,30000,280000&year=2047&evidence=pension:self:2047")).toEqual({
      share: true,
      selfcheck: false,
      household: "salariedCoupleTwoKids",
      levers: [65, 70, 30000, 280000],
      year: 2047,
      evidence: { row: "pension:self", year: 2047 },
    });
  });
});

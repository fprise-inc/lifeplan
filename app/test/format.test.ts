import { describe, expect, it } from "vitest";
import { group, man, manDiff, monthlyMan, toMan, yen } from "../src/presentation/format.ts";

describe("表示の書式", () => {
  it("万円に四捨五入し、マイナスは▲（符号は対称）", () => {
    expect(man(50_920_000)).toBe("5,092");
    expect(man(-20_274_999)).toBe("▲2,027");
    expect(man(-20_275_000)).toBe("▲2,028");
    expect(toMan(4_999)).toBe(0);
    expect(man(-4_999)).toBe("0");
  });
  it("差は＋／▲つき、0は±0", () => {
    expect(manDiff(71_190_000)).toBe("+7,119");
    expect(manDiff(-980_000)).toBe("▲98");
    expect(manDiff(1_000)).toBe("±0");
  });
  it("円と月額", () => {
    expect(yen(3_012_537)).toBe("3,012,537円");
    expect(group(1234567)).toBe("1,234,567");
    expect(monthlyMan(30_000)).toBe("3万円");
    expect(monthlyMan(0)).toBe("なし");
    expect(monthlyMan(15_500)).toBe("15,500円");
  });
});

// 推定の目安の年齢階級の表（wageStats.byAge.*）を使う道筋。実在の統計の値ではない【架空の見本】の表で確かめる
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/statistics.generated.ts", async (orig) => {
  const real = (await orig()) as { MASTER_VALUES: Record<string, unknown>; REGULATION_VALUES: Record<string, unknown> };
  const table = (k: number) => [
    { upTo: 19, amount: 200000 * k },
    { upTo: 24, amount: 230000 * k },
    { upTo: 29, amount: 270000 * k },
    { upTo: 39, amount: 330000 * k },
    { upTo: 49 },
    { upTo: null, amount: 300000 * k },
  ];
  const fictional = (value: unknown) => ({ title: "【架空の見本】年齢階級の表", value, rev: 1, reviewed: false, retrievedAt: null });
  return {
    REGULATION_VALUES: real.REGULATION_VALUES,
    MASTER_VALUES: {
      ...real.MASTER_VALUES,
      "wageStats.byAge.contractualMonthly.regular.male.all": fictional(table(1)),
      "wageStats.byAge.annualBonus.regular.male.all": fictional(table(4)),
      "wageStats.byAge.contractualMonthly.regular.male.large": fictional(table(2)),
    },
  };
});

const { salaryEstimate, wageCurve } = await import("../src/estimates.ts");

describe("年齢階級の表がある推定（架空の見本）", () => {
  it("年齢の階級の額×12 と、その階級の賞与", () => {
    const e = salaryEstimate("regular", "male", { age: 27 });
    expect(e?.annual.value).toBe(270000 * 12);
    expect(e?.annual.basis).toContain("27歳の階級×12");
    expect(e?.bonus.value).toBe(270000 * 4);
  });

  it("値の無い段（確かめられなかった段）は年齢計に戻る", () => {
    expect(salaryEstimate("regular", "male", { age: 45 })?.annual.value).toBe(387400 * 12);
  });

  it("規模別の表があれば規模、無ければ企業規模計", () => {
    expect(salaryEstimate("regular", "male", { age: 27, size: 2000 })?.annual.value).toBe(540000 * 12);
    expect(salaryEstimate("regular", "male", { age: 27, size: 50 })?.annual.value).toBe(270000 * 12);
  });

  it("年齢を渡さなければ年齢計（年齢の推定は呼び出し側が選ぶ）", () => {
    expect(salaryEstimate("regular", "male")?.annual.value).toBe(387400 * 12);
  });

  it("値の無い段がある表からは賃金カーブを作らない", () => {
    expect(wageCurve("regular", "male")).toBeNull();
  });
});

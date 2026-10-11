import { describe, expect, it } from "vitest";
import { addMonths, ageAt, ageReachedMonth, applyLevers, availableLevers, readLevers } from "../src/workspace/levers.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { roles } from "../src/workspace/roles.ts";
import type { Member } from "../src/engine/types.ts";
import { modelHousehold, preview } from "./helpers.ts";

const base = modelHousehold("salariedCoupleTwoKids");
const self = roles(base).find((r) => r.key === "self")!.member;
const demo = demoHousehold("salariedCoupleTwoKids")!;
const opts = { reemployment: demo.reemployment! };

describe("年齢と月", () => {
  const m = (ym: string, first = false): Member => ({ id: "x", kind: "self", sex: "male", birth: { birthYearMonth: ym, bornOnFirst: first } });
  it("年齢に達する月（1日生まれは前の月）", () => {
    expect(ageReachedMonth(m("1981-07"), 60)).toBe("2041-07");
    expect(ageReachedMonth(m("1981-07", true), 60)).toBe("2041-06");
    expect(ageReachedMonth(m("1980-01", true), 60)).toBe("2039-12");
  });
  it("その月の満年齢", () => {
    expect(ageAt(m("1981-07"), "2041-06")).toBe(59);
    expect(ageAt(m("1981-07"), "2041-07")).toBe(60);
    expect(ageAt(m("1980-01", true), "2039-12")).toBe(60);
    expect(ageAt(m("1980-01", true), "2040-11")).toBe(60);
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("打ち手", () => {
  it("現状の値を世帯から読む", () => {
    expect(readLevers(base, self.id)).toEqual({ retireAge: 60, pensionAge: 65, nisaMonthly: 10000, livingMonthly: 300000 });
    expect([...availableLevers(base, self.id)].sort()).toEqual(["livingMonthly", "nisaMonthly", "pensionAge", "retireAge"]);
  });

  it("当てた要求から読み直すと同じ値（元の要求は変えない）", () => {
    const before = JSON.stringify(base);
    for (const v of [
      { retireAge: 65, pensionAge: 68, nisaMonthly: 30000, livingMonthly: 280000 },
      { retireAge: 70, pensionAge: 75, nisaMonthly: 0, livingMonthly: 320000 },
      { retireAge: 62, pensionAge: 60, nisaMonthly: 50000, livingMonthly: 260000 },
    ]) {
      const req = applyLevers(base, self.id, v, opts);
      expect(readLevers(req, self.id)).toEqual(v);
    }
    expect(JSON.stringify(base)).toBe(before);
  });

  it("働く最後の年齢を延ばすと再雇用の期間を足し、退職の段階・NISA の終わりも合わせる", () => {
    const req = applyLevers(base, self.id, { retireAge: 65 }, opts);
    const mine = req.input.household.employmentPeriods!.filter((e) => e.member === self.id);
    expect(mine).toHaveLength(2);
    const re = mine[1]!;
    expect(re.from).toEqual({ at: "2041-07" });
    expect(re.to).toEqual({ at: "2046-06" });
    expect(re.type).toBe("contract");
    expect(re.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(req.input.household.livingExpenses![0]!.stages!.find((s) => s.label === "retirement")!.at).toEqual({ at: "2046-07" });
    expect(req.input.household.accounts!.find((a) => a.kind === "nisa")!.contributions![0]!.to).toEqual({ at: "2046-06" });
    // 同じ打ち手なら同じ要求（先出しの使い回しと本体の正の計算の照合のため）
    expect(JSON.stringify(applyLevers(base, self.id, { retireAge: 65 }, opts))).toBe(JSON.stringify(req));
  });

  it("年金の受け取り開始は、その年齢に達した月の翌月（基礎・厚生とも）", () => {
    const req = applyLevers(base, self.id, { pensionAge: 70 }, opts);
    const rec = req.input.household.pensionRecords!.find((r) => r.member === self.id)!;
    expect(rec.claim).toEqual({ basic: { at: "2051-08" }, employee: { at: "2051-08" } });
  });

  it("当てた要求はエンジンで計算でき、打ち手で結果が変わる", () => {
    const fin = (r: ReturnType<typeof preview>, y: number) => r.table.filter((c) => c.row === "cf.balance.financial" && c.year === y).reduce((s, c) => s + c.amount, 0);
    const a = preview(base);
    const b = preview(applyLevers(base, self.id, { retireAge: 65, nisaMonthly: 30000, livingMonthly: 280000 }, opts));
    expect(fin(b, 2076)).toBeGreaterThan(fin(a, 2076));
  });
});

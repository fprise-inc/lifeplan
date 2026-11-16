// 青色申告特別控除の令和9年分からの見直し（令和8年法律第12号による措置法25条の2の改正。同法附則33条。0155 の追記 2026-11-15）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { modelHousehold, realPacks } from "./helpers.ts";

type Obj = Record<string, unknown>;
const packs = realPacks();

const withBlue = (blueDeduction: string, baseMonth = "2026-07") => {
  const r = JSON.parse(JSON.stringify(modelHousehold("selfEmployed"))) as { input: Obj };
  r.input.baseMonth = baseMonth;
  const h = r.input.household as Obj;
  const me = (h.employmentPeriods as Obj[])[0]?.member as string;
  ((h.members as Obj[]).find((m) => m.id === me) as Obj).taxReturn = { method: "blue", blueDeduction };
  return { req: r, me };
};
const deduction = (blueDeduction: string, year: number, baseMonth?: string) => {
  const { req, me } = withBlue(blueDeduction, baseMonth);
  return (runEngine(req as never, packs, { checkInternal: true, entry: { component: "tax.totalIncome", input: { member: me, year } } }).entryOutput as { blueDeduction?: number }).blueDeduction;
};

describe("青色申告特別控除（令和9年分から）", () => {
  it("複式簿記で紙で申告する人（画面の「55万円」）は、2026年分まで55万円、2027年分から10万円", () => {
    expect([2026, 2027, 2028].map((y) => deduction("doubleEntry", y))).toEqual([550000, 100000, 100000]);
    // 計算基準月が1〜3月でも同じ（年分で決まる）
    expect([2026, 2027].map((y) => deduction("doubleEntry", y, "2026-02"))).toEqual([550000, 100000]);
  });

  it("電子申告の65万円と簡易簿記の10万円は変わらない", () => {
    expect([2026, 2027, 2040].map((y) => deduction("electronic", y))).toEqual([650000, 650000, 650000]);
    expect([2026, 2027].map((y) => deduction("simple", y))).toEqual([100000, 100000]);
  });

  it("総所得金額: 2026年分は「55万円」が「10万円」より45万円少なく、2027年分からは同じ", () => {
    const total = (b: string, y: number) => {
      const { req, me } = withBlue(b);
      return (runEngine(req as never, packs, { checkInternal: true, entry: { component: "tax.totalIncome", input: { member: me, year: y } } }).entryOutput as { total: number }).total;
    };
    expect(total("simple", 2026) - total("doubleEntry", 2026)).toBe(450000);
    expect(total("simple", 2027)).toBe(total("doubleEntry", 2027));
  });

});

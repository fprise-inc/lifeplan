// 計算基準月が1〜3月のときの、前年分の所得税の確定申告（3月の納付・還付）が表に載る（plan.memberFlows。0003 の追記 2026-11-14。点検で見つかった抜けの回帰）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { box, household, member, modelHousehold, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Flow = { row: string; ym: string; amount: number; accrualYear?: number; formula?: string; member?: string };
const packs = realPacks();
const settlement2025 = (req: Req) =>
  (runEngine(req, packs, { checkInternal: true }).flows as unknown as Flow[]).filter((f) => f.row === "cf.taxSi.incomeTax" && f.accrualYear === 2025 && f.formula === "incomeTax.annual.settlement");

const selfEmployedAt = (baseMonth: string): Req => {
  const r = JSON.parse(JSON.stringify(modelHousehold("selfEmployed"))) as Req;
  (r.input as unknown as Obj).baseMonth = baseMonth;
  return r;
};

describe("前年分の確定申告の精算（計算基準月が1〜3月）", () => {
  it("自営業（源泉徴収が無い）: 計算基準月が1月・3月なら2025年分の納付が2026年3月に載る。4月からは載らない", () => {
    for (const bm of ["2026-01", "2026-03"]) {
      const s = settlement2025(selfEmployedAt(bm));
      expect(s.map((f) => f.ym)).toEqual(["2026-03"]);
      expect(s[0]?.amount).toBeGreaterThan(100000);
    }
    expect(settlement2025(selfEmployedAt("2026-04"))).toEqual([]);
  });

  it("年の途中で辞めた会社員（12月に給与が無い）: 2025年分の還付が2026年3月に載る", () => {
    const A = uid("a");
    const req = household({
      baseMonth: "2026-02",
      endYear: 2030,
      members: [member("a", "self", "1985-04")],
      periods: [period("p", { member: "a", from: "2008-04", to: "2025-06", annual: 6000000, std: [500000, 500000] })],
      accounts: [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(5000000), asOf: "2026-01", contributions: [] }],
    });
    const s = settlement2025(req);
    expect(s.map((f) => f.ym)).toEqual(["2026-03"]);
    expect(s[0]?.amount).toBeLessThan(0);
  });
});

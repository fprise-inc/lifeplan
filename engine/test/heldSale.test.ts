// 貸していない不動産・その他の資産の売る予定と毎年の費用（0122）のテスト（L1）: 売る年の年末の評価額（plan.cashflow の残高と同じ）・
// 手取りと評価額を消すこと、不動産の分離課税（tax.realEstateSale に足す）、その他の資産の総合課税の譲渡所得（短期・長期・特別控除50万円・
// 長期の2分の1・損失は通算しない）、非課税と雑所得、つながる物の毎年の費用が売る月から止まること、売る予定の無い世帯の結果が変わらないこと。
// 手計算は別に書き、エンジンの結果と突き合わせる（製品の制度データ）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { HeldSaleOutput, RealEstateSaleTaxOutput, TotalIncomeOutput } from "../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const packs = realPacks();
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, packs, { checkInternal: true, entry: { component, input } }).entryOutput as T;
const full = (req: Req) => runEngine(req, packs, { checkInternal: true });
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const has = (r: { header: unknown }, code: string, id: string) => notices(r).some((n) => n.code === code && n.ids.includes(id));
type Flow = { row: string; ym: string; amount: number; member?: string; object?: string; formula?: string };
type Row = { row: string; year: number; amount: number; object?: string };
const flows = (r: ReturnType<typeof full>) => r.flows as unknown as Flow[];
const annual = (r: ReturnType<typeof full>) => (r as unknown as { annual: Row[] }).annual;

const A = uid("a");
const E = uid("estate");
const G = uid("gold");
const C = uid("cost");
const at = (ym: string) => ({ at: ym });

const estate = (o: Obj = {}): Obj => ({ id: E, kind: "realEstate", subtype: "villa", owner: A, marketValue: box(20000000), asOf: "2026-09", valueGrowth: "0.01", contributions: [], ...o });
const gold = (o: Obj = {}): Obj => ({ id: G, kind: "otherAsset", subtype: "preciousMetal", owner: A, marketValue: box(5000000), asOf: "2026-09", valueGrowth: "0.02", contributions: [], ...o });
const base = (accounts: Obj[], extra: Obj = {}): Req => {
  const req = household({
    baseMonth: "2026-10",
    endYear: 2036,
    members: [member("a", "self", "1980-01")],
    periods: [period("job", { member: "a", from: "2005-04", annual: 6000000, std: [500000, 500000] })],
    accounts: [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(10000000), asOf: "2026-09", contributions: [] }, ...accounts],
  });
  Object.assign(req.input.household as unknown as Obj, extra);
  return req;
};
const sales = (req: Req) => call<HeldSaleOutput>(req, "asset.heldSale", {}).sales;
const total = (req: Req, year: number) => call<TotalIncomeOutput>(req, "tax.totalIncome", { member: A, year });
const floor = (v: number, unit: number) => Math.floor(v / unit) * unit;
const balance = (r: ReturnType<typeof full>, object: string, year: number) => annual(r).find((x) => x.object === object && x.year === year && x.row.startsWith("cf.balance.account."))?.amount;

describe("売る年の評価額と手取り（0122）", () => {
  it("売却価格の省略はその年の年末の評価額（売らないときの残高の行と同じ）。手取りを一時金の収入にし、その年の年末から評価額の行を出さない", () => {
    const kept = full(base([estate(), gold()]));
    const req = base([estate({ sale: { at: at("2030-04") } }), gold({ sale: { at: at("2031-07") } })]);
    const s = sales(req);
    expect(s.find((x) => x.object === E)?.value).toBe(balance(kept, E, 2030));
    expect(s.find((x) => x.object === G)?.value).toBe(balance(kept, G, 2031));
    const e = s.find((x) => x.object === E);
    // 不動産の売却の費用の既定は4%
    expect(e?.costs).toBe(Math.floor((e?.price ?? 0) * 0.04));
    expect(e?.proceeds).toBe((e?.price ?? 0) - (e?.costs ?? 0));
    // その他の資産の売却の費用の既定は0
    expect(s.find((x) => x.object === G)?.costs).toBe(0);
    const r = full(req);
    expect(flows(r).filter((f) => f.object === E && f.row === "cf.income.lumpSum.realEstateSale")).toEqual([expect.objectContaining({ ym: "2030-04", amount: e?.proceeds, member: A })]);
    expect(flows(r).filter((f) => f.object === G && f.row === "cf.income.lumpSum.other")).toHaveLength(1);
    expect(balance(kept, E, 2030)).toBeGreaterThan(20000000);
    expect(balance(r, E, 2029)).toBe(balance(kept, E, 2029));
    expect(balance(r, E, 2030)).toBeUndefined();
    expect(balance(r, G, 2031)).toBeUndefined();
    expect(balance(r, G, 2030)).toBe(balance(kept, G, 2030));
  });

  it("売る月が計算基準月より前なら売ったとみなし、手取りを出さず、計算基準年から評価額を出さない。表の最後より後は売らない", () => {
    const past = base([estate({ sale: { at: at("2026-03") } })]);
    expect(sales(past)).toEqual([]);
    const r = full(past);
    expect(balance(r, E, 2026)).toBeUndefined();
    expect(flows(r).some((f) => f.object === E)).toBe(false);
    const later = full(base([estate({ sale: { at: at("2040-01") } })]));
    expect(balance(later, E, 2036)).toBeGreaterThan(0);
  });
});

describe("貸していない不動産を売ったときの税（分離課税。tax.realEstateSale）", () => {
  it("取得価額と取得の年月があれば実額と所有期間（売った年の1月1日で5年超なら長期）。建物のある不動産は非業務用の減価を引いていない知らせ", () => {
    const req = base([estate({ costBasis: box(15000000), acquiredAt: "2015-05", sale: { at: at("2030-04"), price: 25000000 } })]);
    const s = sales(req)[0];
    expect(s).toMatchObject({ taxation: "landBuilding", acquisitionCost: 15000000, estimated: false, term: "long", gain: 25000000 - 15000000 - 1000000 });
    const t = call<RealEstateSaleTaxOutput>(req, "tax.realEstateSale", {}).byMember;
    const gain = 9000000;
    const it0 = Math.floor(floor(gain, 1000) * 0.15);
    expect(t).toEqual([{ member: A, year: 2030, short: 0, long: gain, incomeTax: floor(it0 + Math.floor(it0 * 0.011) + Math.floor(it0 * 0.01), 100), residentTax: floor(floor(gain, 1000) * 0.05, 100) }]);
    const r = full(req);
    expect(flows(r).some((f) => f.row === "cf.taxSi.incomeTax.realEstateSale" && f.ym === "2031-03")).toBe(true);
    expect(has(r, "N_NOT_SUPPORTED", "heldAsset.saleBuildingDepreciation")).toBe(true);
    expect(has(r, "N_ASSUMED", "heldAsset.saleTaxSimplified")).toBe(true);
    // 土地（建物なし）は知らせない。短期
    const land = full(base([estate({ subtype: "vacantLand", costBasis: box(15000000), acquiredAt: "2025-05", sale: { at: at("2030-04"), price: 25000000 } })]));
    expect(has(land, "N_NOT_SUPPORTED", "heldAsset.saleBuildingDepreciation")).toBe(false);
    expect(sales(base([estate({ subtype: "vacantLand", costBasis: box(15000000), acquiredAt: "2025-05", sale: { at: at("2030-04"), price: 25000000 } })]))[0]?.term).toBe("short");
  });

  it("取得価額が無ければ概算取得費（5%）、取得の年月が無ければ長期とみなして知らせる", () => {
    const req = base([estate({ sale: { at: at("2030-04"), price: 20000000 } })]);
    expect(sales(req)[0]).toMatchObject({ acquisitionCost: 1000000, estimated: true, term: "long" });
    const r = full(req);
    expect(has(r, "N_ASSUMED", "heldAsset.saleEstimatedCost")).toBe(true);
    expect(has(r, "N_ASSUMED", "heldAsset.saleHoldingLong")).toBe(true);
  });
});

describe("その他の資産を売ったときの税（総合課税の譲渡所得・非課税・雑所得）", () => {
  it("長期は特別控除50万円の後の2分の1を総所得金額に入れる", () => {
    const req = base([gold({ costBasis: box(2000000), acquiredAt: "2020-01", sale: { at: at("2030-04"), price: 6000000 } })]);
    expect(sales(req)[0]).toMatchObject({ taxation: "transfer", term: "long", gain: 4000000 });
    const t = total(req, 2030);
    expect(t.transfer).toEqual({ short: 0, long: 4000000, included: (4000000 - 500000) / 2 });
    const without = total(base([gold()]), 2030);
    expect(t.total).toBe(without.total + 1750000);
  });

  it("5年以内（月で数え、ちょうど60か月は短期）は短期で全額。特別控除は短期から先に引く", () => {
    const short = (acq: string) => sales(base([gold({ costBasis: box(2000000), acquiredAt: acq, sale: { at: at("2030-04"), price: 6000000 } })]))[0]?.term;
    expect(short("2025-04")).toBe("short");
    expect(short("2025-03")).toBe("long");
    const S = uid("art");
    const req = base([
      gold({ costBasis: box(2000000), acquiredAt: "2020-01", sale: { at: at("2030-04"), price: 6000000 } }),
      { id: S, kind: "otherAsset", subtype: "art", owner: A, marketValue: box(1000000), asOf: "2026-09", contributions: [], costBasis: box(1000000), acquiredAt: "2028-01", sale: { at: at("2030-06"), price: 1300000 } },
    ]);
    // 短期の益30万円は特別控除で0、残りの20万円を長期から引く
    expect(total(req, 2030).transfer).toEqual({ short: 300000, long: 4000000, included: (4000000 - 200000) / 2 });
  });

  it("引ききれない損失はほかの所得と通算しない（知らせ）", () => {
    const req = base([gold({ costBasis: box(8000000), acquiredAt: "2020-01", sale: { at: at("2030-04"), price: 6000000 } })]);
    const t = total(req, 2030);
    expect(t.transfer).toEqual({ short: 0, long: 0, included: 0 });
    expect(t.total).toBe(total(base([gold()]), 2030).total);
    expect(has(full(req), "N_LIMIT_APPLIED", "heldAsset.transferLoss")).toBe(true);
  });

  it("非課税（敷金・保証金の既定、FP が選んだ生活用動産）は税をかけない。雑所得を選べば雑所得に足す", () => {
    const dep = base([gold({ subtype: "securityDeposit", sale: { at: at("2030-04") } })]);
    expect(sales(dep)[0]?.taxation).toBe("nonTaxable");
    expect(total(dep, 2030).transfer).toBeUndefined();
    const chosen = base([gold({ sale: { at: at("2030-04"), taxation: "nonTaxable" } })]);
    expect(sales(chosen)[0]).toMatchObject({ taxation: "nonTaxable" });
    expect(sales(chosen)[0]?.gain).toBeUndefined();
    const crypto = base([gold({ subtype: "businessAsset", costBasis: box(1000000), sale: { at: at("2030-04"), price: 3000000, taxation: "miscellaneous" } })]);
    expect(sales(crypto)[0]).toMatchObject({ taxation: "miscellaneous", gain: 2000000 });
    expect(total(crypto, 2030).miscellaneous).toBe(2000000);
  });
});

describe("つながる物の毎年の費用（0122）", () => {
  it("売る月から払わない。売る予定が無ければ最後まで払う", () => {
    const cost = { id: C, kind: "assetCost", object: E, row: "cf.expense.other.realEstate", from: at("2026-10"), to: null, everyYears: 1, amount: box(150000), growth: { kind: "none" } };
    const kept = full(base([estate()], { periodicExpenses: [cost] }));
    expect(flows(kept).filter((f) => f.object === C).map((f) => f.ym)).toEqual(Array.from({ length: 11 }, (_, i) => `${String(2026 + i)}-10`));
    const sold = full(base([estate({ sale: { at: at("2030-04") } })], { periodicExpenses: [cost] }));
    expect(flows(sold).filter((f) => f.object === C).map((f) => f.ym)).toEqual(["2026-10", "2027-10", "2028-10", "2029-10"]);
  });
});

// 収益不動産の借入の利息（不動産所得の経費）: 買った年・売った年は、その年にローンのある月のうち貸している月の分（asset.realEstate 改訂11。0028 の追記 2026-11-15）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const packs = realPacks();
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, packs, { checkInternal: true, entry: { component, input } }).entryOutput as T;
const A = uid("a");
const P = uid("prop");
const L = uid("propLoan");
const at = (ym: string) => ({ at: ym });
type Income = { year: number; interest: number; landInterest: number; income: number };

const prop = (o: Obj = {}) => ({
  id: P,
  kind: "realEstate",
  owner: A,
  marketValue: box(30000000),
  asOf: "2025-12",
  valueGrowth: "0",
  contributions: [],
  property: { structure: "rc", builtYear: 2015, landShare: "0.4", acquisition: { price: 30000000, at: "2020-04" }, rental: { monthly: box(120000), vacancyRate: "0", growth: "0" }, expenses: { annual: box(240000) }, ...o },
});
const loan = (o: Obj = {}) => ({ id: L, kind: "other", property: P, debtors: [{ member: A, role: "primary" }], principal: 25000000, start: at("2020-04"), rateSchedule: [{ from: at("2020-04"), type: "fixed", rate: "0.02" }], repayment: { method: "equalPayment", termMonths: 360 }, ...o });
const mk = (p: Obj, l: Obj, baseMonth = "2026-01") => {
  const r = household({ baseMonth, endYear: 2035, members: [member("a", "self", "1980-01")], periods: [period("p", { member: "a", from: "2003-04", to: "2040-03", annual: 7000000, std: [560000, 560000] })], accounts: [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(10000000), asOf: "2025-12", contributions: [] }, p] });
  ((r.input as unknown as Obj).household as Obj).debts = [l];
  return r;
};
const incomeOf = (req: Req, y: number) => (call<{ properties: { income: Income[] }[] }>(req, "asset.realEstate", {}).properties[0]?.income ?? []).find((x) => x.year === y);
const debtInterest = (req: Req, y: number) => call<{ interest?: { year: number; amount: number }[] }>(req, "debt.schedule", { object: L }).interest?.find((x) => x.year === y)?.amount ?? 0;
const bought = (ym: string, base?: string) =>
  mk(prop({ holdFrom: at(ym), acquisition: { price: 30000000, at: ym }, rental: { monthly: box(120000), vacancyRate: "0", growth: "0", from: at(ym) } }), loan({ start: at(ym), rateSchedule: [{ from: at(ym), type: "fixed", rate: "0.02" }] }), base);

describe("収益不動産の借入の利息を、買った年・売った年に二重に月割りしない", () => {
  it("2027年7月に買って貸し始める: その年の利息（ローンのある月はすべて貸している）を全部経費にする（前は×6/12で半分）", () => {
    const req = bought("2027-07");
    expect(debtInterest(req, 2027)).toBe(207484);
    expect(incomeOf(req, 2027)?.interest).toBe(207484);
    // 12か月貸している年は今までどおり全部
    expect(incomeOf(req, 2028)?.interest).toBe(debtInterest(req, 2028));
    // 土地の分の利息は利息に同じ割合（借入額のうち建物の取得価額を超える分）
    const i = incomeOf(req, 2027) as Income;
    expect(i.landInterest).toBeGreaterThan(0);
    expect(Math.abs(i.landInterest / i.interest - (incomeOf(req, 2028) as Income).landInterest / (incomeOf(req, 2028) as Income).interest)).toBeLessThan(0.001);
  });

  it("2028年7月に売って借入を返す（6月まで貸す）: その年のローンのある7か月のうち貸している6か月の分（前は×6/12）", () => {
    const req = mk(prop({ sale: { at: at("2028-07"), price: 30000000, repayLoan: true } }), loan());
    const year = debtInterest(req, 2028);
    expect(year).toBe(230785);
    expect(incomeOf(req, 2028)?.interest).toBe(Math.floor((year * 6) / 7));
    expect(incomeOf(req, 2027)?.interest).toBe(debtInterest(req, 2027));
  });

  it("12月に買う・12月に売る・計算基準月が1〜3月でも、ローンのある月と貸している月の重なりで按分する", () => {
    // 12月に借りたローンは最初の返済が翌年1月なので、その年の利息は無い
    const dec = bought("2027-12");
    expect(debtInterest(dec, 2027)).toBe(0);
    expect(incomeOf(dec, 2027)?.interest ?? 0).toBe(0);
    expect(incomeOf(dec, 2028)?.interest).toBe(debtInterest(dec, 2028));
    // 12月に売る（11月まで貸す）: ローンは12か月、貸しているのは11か月
    const sold = mk(prop({ sale: { at: at("2028-12"), price: 30000000, repayLoan: true } }), loan());
    expect(incomeOf(sold, 2028)?.interest).toBe(Math.floor((debtInterest(sold, 2028) * 11) / 12));
    // 計算基準月 2027-02 でも同じ
    const feb = bought("2027-07", "2027-02");
    expect(incomeOf(feb, 2027)?.interest).toBe(debtInterest(feb, 2027));
  });

  it("貸し始めがローンより後（7月に買って10月から貸す）: ローンのある6か月のうち貸している3か月の分", () => {
    const req = mk(
      prop({ holdFrom: at("2027-07"), acquisition: { price: 30000000, at: "2027-07" }, rental: { monthly: box(120000), vacancyRate: "0", growth: "0", from: at("2027-10") } }),
      loan({ start: at("2027-06"), rateSchedule: [{ from: at("2027-06"), type: "fixed", rate: "0.02" }] }),
    );
    // 6月に借りて最初の返済は7月: ローンのある月は7〜12月の6か月
    expect(incomeOf(req, 2027)?.interest).toBe(Math.floor((debtInterest(req, 2027) * 3) / 6));
  });
});

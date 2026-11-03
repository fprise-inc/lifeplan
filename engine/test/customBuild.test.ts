// 注文住宅（土地を買って建てる。0115）のテスト（L1）: 土地の決済・引き渡しの前の支払い・引き渡しに分けた頭金と諸費用（housing.residence 改訂5）、
// 土地を決済の月から持つ評価（housing.valuation 改訂3）、土地の分と建物の分に分けて借りたローンの住宅ローン控除とバランスシート
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { HousingLoanCreditOutput, HousingValuationOutput, ResidenceOutput } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, period, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const call = <T>(req: Req, component: string, input: unknown): T =>
  runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const A = uid("a");
const at = (ym: string) => ({ at: ym });
const withInput = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
type Cell = { row: string; year: number; amount: number; object?: string };
const under = (r: ReturnType<typeof full>, row: string, year: number) => (r.table as unknown as Cell[]).filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year).reduce((s, c) => s + c.amount, 0);

const base = (o: { inflation?: string; periods?: boolean } = {}) =>
  withInput(
    household({
      members: [member("a", "self", "1990-01")],
      endYear: 2045,
      accounts: [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(30000000), asOf: "2025-12", contributions: [] }],
      ...(o.periods === true ? { periods: [period("p", { member: "a", from: "2015-04", annual: 6000000, std: [500000, 500000] })] } : {}),
      events: [{ id: uid("mv"), kind: "moveIn", at: at("2028-03") }],
    }),
    (_h, input) => {
      (input.assumptions as Obj).inflation = { default: o.inflation ?? "0" };
    },
  );
/** 土地 2,000万円（2027年5月に決済）・建物 3,000万円（2028年3月に引き渡し）の注文住宅 */
const custom = (purchase: Obj = {}): Obj => ({
  id: uid("home"),
  kind: "own",
  from: at("2028-03"),
  to: null,
  purchase: {
    at: at("2028-03"),
    price: 50000000,
    downPayment: 5000000,
    costs: 3000000,
    land: { at: at("2027-05"), price: 20000000, downPayment: 3000000, costs: 1200000 },
    payments: [{ id: uid("pay1"), at: at("2027-09"), amount: 1000000, kind: "start" }],
    ...purchase,
  },
  ownership: [{ member: A, share: "1" }],
});
const flowsOf = (req: Req) => call<ResidenceOutput>(req, "housing.residence", {}).flows;
const pick = (fs: ResidenceOutput["flows"], row: string) => fs.filter((f) => f.row === row).map((f) => ({ ym: f.ym, amount: f.amount, formula: f.formula }));

describe("注文住宅の頭金と諸費用（housing.residence 改訂5）", () => {
  it("土地の決済の月に土地の分、引き渡しの前の支払いの月に建物の代金、残りを引き渡しの月に払う（合計は頭金・諸費用のまま）", () => {
    const fs = flowsOf(withInput(base(), (h) => (h.residences = [custom()])));
    expect(pick(fs, "cf.expense.housing.purchase.downPayment")).toEqual([
      { ym: "2027-05", amount: 3000000, formula: "housing.residence.landDownPayment" },
      { ym: "2027-09", amount: 1000000, formula: "housing.residence.buildingPayment" },
      { ym: "2028-03", amount: 1000000, formula: "housing.residence.downPayment" },
    ]);
    expect(pick(fs, "cf.expense.housing.purchase.costs")).toEqual([
      { ym: "2027-05", amount: 1200000, formula: "housing.residence.landCosts" },
      { ym: "2028-03", amount: 1800000, formula: "housing.residence.purchaseCosts" },
    ]);
  });

  it("内数が合計を超える分は、早い支払いから順に合計で止めて知らせる", () => {
    const req = withInput(base(), (h) => (h.residences = [custom({ downPayment: 3500000, costs: 1000000 })]));
    const fs = flowsOf(req);
    expect(pick(fs, "cf.expense.housing.purchase.downPayment").map((x) => [x.ym, x.amount])).toEqual([
      ["2027-05", 3000000],
      ["2027-09", 500000],
    ]);
    expect(pick(fs, "cf.expense.housing.purchase.costs").map((x) => [x.ym, x.amount])).toEqual([["2027-05", 1000000]]);
    expect(notices(full(req)).some((n) => n.code === "N_LIMIT_APPLIED" && n.ids.includes("residence.purchase.split"))).toBe(true);
    // 内数が合計のうちなら知らせない
    expect(notices(full(withInput(base(), (h) => (h.residences = [custom()])))).some((n) => n.ids.includes("residence.purchase.split"))).toBe(false);
  });

  it("土地の無い購入は前のまま（購入の月に頭金と諸費用）", () => {
    const fs = flowsOf(withInput(base(), (h) => (h.residences = [{ ...custom(), purchase: { at: at("2028-03"), price: 50000000, downPayment: 5000000, costs: 3000000 } }])));
    expect(pick(fs, "cf.expense.housing.purchase.downPayment").map((x) => [x.ym, x.amount])).toEqual([["2028-03", 5000000]]);
    expect(pick(fs, "cf.expense.housing.purchase.costs").map((x) => [x.ym, x.amount])).toEqual([["2028-03", 3000000]]);
  });
});

describe("注文住宅の評価（housing.valuation 改訂3）", () => {
  it("土地は決済の年から土地の代金で持ち、建物は引き渡しの年から（それより前の年末は土地だけ）。土地の割合の目安は使わない", () => {
    const req = withInput(base({ inflation: "0.01" }), (h) => (h.residences = [custom()]));
    const p = call<HousingValuationOutput>(req, "housing.valuation", {}).properties[0];
    expect(p?.years[0]).toEqual({ year: 2027, land: 20000000, building: 0, value: 20000000 });
    // 基にする年は引き渡しの年（2028年）。土地はその翌年から上昇率で上がる
    expect(p?.years[1]).toEqual({ year: 2028, land: 20000000, building: 30000000, value: 50000000 });
    expect(p?.years[2]?.land).toBe(20200000);
    expect(notices(full(req)).some((n) => n.code === "N_DEFAULT_USED" && n.ids.includes("residence.valuation.landShare"))).toBe(false);
  });

  it("評価額を入れた持ち家は、今までどおり土地の割合で分ける", () => {
    const req = withInput(base(), (h) => (h.residences = [{ ...custom(), valuation: { value: box(60000000), asOf: "2028-03", landShare: "0.5" } }]));
    const p = call<HousingValuationOutput>(req, "housing.valuation", {}).properties[0];
    expect(p?.years.find((y) => y.year === 2028)).toEqual({ year: 2028, land: 30000000, building: 30000000, value: 60000000 });
  });

  it("土地の分のローン（土地の決済の月）と建物の分のローン（引き渡しの月）: 土地の年末から資産に土地、負債にローンが載り、控除は入居の年から2本を合わせる", () => {
    const loan = (id: string, start: string, principal: number, cost: number): Obj => ({
      id: uid(id),
      kind: "mortgage",
      debtors: [{ member: A, role: "primary" }],
      principal,
      start: at(start),
      rateSchedule: [{ from: at(start), type: "fixed", rate: "0.01" }],
      repayment: { method: "equalPayment", termMonths: 420 },
      housing: { residence: uid("home"), moveIn: uid("mv"), propertyType: "zeh", newBuild: true, acquisitionCost: cost },
    });
    const req = withInput(base({ periods: true }), (h) => {
      h.residences = [custom()];
      h.debts = [loan("landLoan", "2027-05", 17000000, 20000000), loan("bLoan", "2028-03", 28000000, 30000000)];
    });
    const r = full(req);
    expect(under(r, "cf.balance.account.realEstate", 2027)).toBe(20000000);
    expect(under(r, "cf.balance.debt", 2027)).toBeGreaterThan(16000000);
    // 控除は入居（2028年）から。2本の年末残高を合わせて、借入限度額で止める
    expect(call<HousingLoanCreditOutput>(req, "tax.housingLoanCredit", { member: A, year: 2027 }).credit).toBe(0);
    const c = call<HousingLoanCreditOutput>(req, "tax.housingLoanCredit", { member: A, year: 2028 });
    expect(c.credit).toBeGreaterThan(0);
    const one = withInput(req, (h) => ((h.debts as Obj[]).splice(0, 1)));
    expect(c.credit).toBeGreaterThan(call<HousingLoanCreditOutput>(one, "tax.housingLoanCredit", { member: A, year: 2028 }).credit);
  });
});

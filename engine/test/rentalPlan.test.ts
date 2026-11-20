// 収益不動産の建てる・買う予定（asset.realEstate の planned。0232）のテスト（L1）: 予定の年の前後で評価額・ローン・家賃が切り替わる、自己資金の
// 支払いが予定の月に出る、土地は既にあり建物だけ建てる場合、土地ごと買う場合、ローンなし、予定の月が計算基準月の前後（1〜3月）、予定の月と重なる
// 売る予定の扱い、今ある物件の結果が変わらないこと、相続税の評価の材料（建物の固定資産税評価額の目安・貸している割合）
import { describe, expect, it } from "vitest";
import { straightLineRate } from "../src/components/asset.realEstate/index.ts";
import { runEngine } from "../src/engine/run.ts";
import { keinenRateText } from "../src/sdk/index.ts";
import type { RealEstateAnalysisOutput, RealEstateOutput } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const call = <T>(req: Req, component: string): T => runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component, input: {} } }).entryOutput as T;
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
type Cell = { row: string; year: number; amount: number; object?: string; formula?: string };
const cells = (r: ReturnType<typeof full>, row: string, year: number, object?: string) =>
  (r.table as unknown as Cell[]).filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year && (object === undefined || c.object === object)).reduce((s, c) => s + c.amount, 0);
const A = uid("a");
const P = uid("plan");
const Q = uid("now");
const L = uid("planLoan");
const at = (ym: string) => ({ at: ym });

/** 土地ごと買う予定（2030年7月。土地2,000万円・建物2,500万円・設備500万円、諸費用300万円。木造の一棟アパート） */
const buyPlan = (o: Obj = {}): Obj => ({ type: "buy", at: at("2030-07"), parts: { land: 20000000, building: 25000000, equipment: 5000000 }, costs: 3000000, ...o });
const buyAccount = (plan: Obj = buyPlan(), p: Obj = {}): Obj => ({
  id: P,
  kind: "realEstate",
  owner: A,
  marketValue: box(0),
  asOf: "2026-01",
  valueGrowth: "0",
  contributions: [],
  property: { kind: "apartment", structure: "wood", planned: plan, rental: { monthly: box(400000), vacancyRate: "0.1" }, expenses: { annual: box(600000) }, ...p },
});
/** 持っている土地（時価3,000万円・2000年1月に1,000万円で取得）に、2028年4月に建物（6,000万円・設備1,000万円、諸費用200万円）を建てる予定 */
const buildPlan = (o: Obj = {}): Obj => ({ type: "build", at: at("2028-04"), parts: { building: 60000000, equipment: 10000000 }, costs: 2000000, ...o });
const buildAccount = (plan: Obj = buildPlan(), p: Obj = {}): Obj => {
  const property: Obj = { kind: "apartment", structure: "wood", acquisition: { price: 10000000, at: "2000-01" }, planned: plan, rental: { monthly: box(500000), vacancyRate: "0.1" }, expenses: { annual: box(1200000) }, ...p };
  // undefined を渡した欄は入れない
  for (const k of Object.keys(property)) if (property[k] === undefined) delete property[k];
  return { id: P, kind: "realEstate", owner: A, marketValue: box(30000000), asOf: "2025-12", valueGrowth: "0", contributions: [], property };
};
/** 今ある区分マンション（予定の無い物件。結果が変わらないことを確かめる） */
const nowAccount: Obj = {
  id: Q,
  kind: "realEstate",
  owner: A,
  marketValue: box(30000000),
  asOf: "2025-12",
  valueGrowth: "0",
  contributions: [],
  property: { structure: "rc", builtYear: 2015, landShare: "0.4", acquisition: { price: 25000000, at: "2020-04" }, rental: { monthly: box(100000), vacancyRate: "0.05" }, expenses: { annual: box(240000) } },
};
const loan = (o: Obj = {}): Obj => ({
  id: L,
  kind: "other",
  property: P,
  debtors: [{ member: A, role: "primary" }],
  principal: 40000000,
  start: at("2030-07"),
  rateSchedule: [{ from: at("2030-07"), type: "fixed", rate: "0.02" }],
  repayment: { method: "equalPayment", termMonths: 360 },
  ...o,
});
const req = (accounts: Obj[], debts: Obj[] = [], baseMonth = "2026-01"): Req => {
  const r = household({
    baseMonth,
    endYear: 2060,
    members: [member("a", "self", "1970-01")],
    accounts: [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(100000000), asOf: "2025-12", contributions: [] }, ...accounts],
  });
  (r.input.household as unknown as Obj).debts = debts;
  return r;
};
const prop = (r: Req, id = P) => call<RealEstateOutput>(r, "asset.realEstate").properties.find((x) => x.object === id);

describe("土地ごと買う予定（buy）", () => {
  it("予定の年から評価額（代金の合計）・家賃・ローンが出て、前の年は出ない", () => {
    const r = req([buyAccount()], [loan()]);
    const p = prop(r);
    expect(p?.years[0]).toMatchObject({ year: 2030, land: 20000000, building: 30000000, value: 50000000 });
    expect(p?.years.some((x) => x.year < 2030)).toBe(false);
    const f = full(r);
    expect(cells(f, "cf.balance.account.realEstate", 2029)).toBe(0);
    expect(cells(f, "cf.balance.account.realEstate", 2030)).toBe(50000000);
    expect(cells(f, "cf.balance.debt", 2029)).toBe(0);
    expect(cells(f, "cf.balance.debt", 2030)).toBeGreaterThan(39000000);
    // 家賃は買った月（7月）から6か月: 40万円×0.9
    expect(cells(f, "cf.income.other.rental", 2029)).toBe(0);
    expect(cells(f, "cf.income.other.rental", 2030)).toBe(360000 * 6);
    // 経費の年額も買った月から（6か月分）
    expect(cells(f, "cf.expense.other.realEstate", 2029)).toBe(0);
    expect(cells(f, "cf.expense.other.realEstate", 2030)).toBe(300000);
  });

  it("買う月に自己資金（代金＋諸費用−これから借りるローン）を払う", () => {
    const f = full(req([buyAccount()], [loan()]));
    expect(cells(f, "cf.expense.lumpSum.realEstatePurchase", 2030)).toBe(50000000 + 3000000 - 40000000);
    const c = (f.table as unknown as Cell[]).find((x) => x.row === "cf.expense.lumpSum.realEstatePurchase");
    expect(c).toMatchObject({ object: P });
    const flow = call<RealEstateOutput>(req([buyAccount()], [loan()]), "asset.realEstate").flows.find((x) => x.row === "cf.expense.lumpSum.realEstatePurchase");
    expect(flow).toMatchObject({ ym: "2030-07", amount: 13000000, member: A, object: P, formula: "asset.realEstate.purchase" });
    expect(cells(f, "cf.expense.lumpSum.realEstatePurchase", 2029) + cells(f, "cf.expense.lumpSum.realEstatePurchase", 2031)).toBe(0);
    const p = prop(req([buyAccount()], [loan()]));
    expect(p?.facts?.planned).toEqual({ type: "buy", ym: "2030-07", paid: 13000000 });
    expect(p?.facts?.acquisition).toEqual({ total: 50000000, costs: 3000000, equity: 13000000 });
    expect(p?.facts?.builtYear).toBe(2030);
  });

  it("自己資金を入れたら、その額を払う。ローンなしなら代金と諸費用の全部", () => {
    expect(cells(full(req([buyAccount(buyPlan({ equity: 15000000 }))], [loan()])), "cf.expense.lumpSum.realEstatePurchase", 2030)).toBe(15000000);
    expect(cells(full(req([buyAccount()])), "cf.expense.lumpSum.realEstatePurchase", 2030)).toBe(53000000);
    // 計算基準月より前に借りたローン（今あるローン）は差し引かない
    const old = loan({ start: at("2020-01"), rateSchedule: [{ from: at("2020-01"), type: "fixed", rate: "0.02" }], principal: 5000000 });
    expect(cells(full(req([buyAccount()], [old])), "cf.expense.lumpSum.realEstatePurchase", 2030)).toBe(53000000);
  });

  it("減価償却は買った月から（新築の法定耐用年数、諸費用は額の比で建物と設備に足す）。器の時価・入れた取得は読まない", () => {
    const p = prop(req([buyAccount(buyPlan(), { acquisition: { price: 1, at: "2001-01" } })]));
    const bBase = 25000000 + Math.floor((3000000 * 25000000) / 50000000);
    const eBase = 5000000 + Math.floor((3000000 * 5000000) / 50000000);
    const ann = (b: number, life: number) => Math.floor(b * Number(straightLineRate(life)));
    const inc = p?.income.find((x) => x.year === 2030);
    expect(inc?.depreciation).toBe(Math.floor((ann(bBase, 22) * 6) / 12) + Math.floor((ann(eBase, 15) * 6) / 12));
    expect(p?.income.find((x) => x.year === 2031)?.depreciation).toBe(ann(bBase, 22) + ann(eBase, 15));
    expect(p?.income.some((x) => x.year < 2030)).toBe(false);
  });

  it("中古で買う（建った年を入れる）と簡便法の耐用年数で償却し、評価額の建物は築年数で減らす", () => {
    const p = prop(req([buyAccount(buyPlan({ parts: { land: 20000000, building: 10000000 }, costs: 0 }), { builtYear: 2010 })]));
    // 経過20年の木造: 22−20＋20×0.2＝6年
    expect(p?.income.find((x) => x.year === 2031)?.depreciation).toBe(Math.floor(10000000 * Number(straightLineRate(6))));
    expect(p?.years[0]).toMatchObject({ year: 2030, land: 20000000, building: 10000000 });
  });

  it("分析の数字は予定の年から（前の年は出さない）", () => {
    const a = call<RealEstateAnalysisOutput>(req([buyAccount()], [loan()]), "asset.realEstateAnalysis").properties.find((x) => x.object === P);
    expect(a?.years[0]?.year).toBe(2030);
    expect(a?.acquisition).toEqual({ total: 50000000, costs: 3000000, equity: 13000000 });
    expect(a?.years[0]?.repayment).toBeGreaterThan(0);
  });
});

describe("持っている土地に建てる予定（build）", () => {
  it("建てる前は土地だけ、建てる年から建物（建築費）を足す。家賃・経費・減価償却は建てる月から", () => {
    const p = prop(req([buildAccount()]));
    expect(p?.years.find((x) => x.year === 2026)).toMatchObject({ land: 30000000, building: 0 });
    expect(p?.years.find((x) => x.year === 2027)).toMatchObject({ land: 30000000, building: 0 });
    expect(p?.years.find((x) => x.year === 2028)).toMatchObject({ land: 30000000, building: 70000000, value: 100000000 });
    expect(p?.income.some((x) => x.year < 2028)).toBe(false);
    const inc = p?.income.find((x) => x.year === 2028);
    // 4月から9か月: 50万円×0.9
    expect(inc?.rent).toBe(450000 * 9);
    expect(inc?.expenses).toBe(900000);
    const bBase = 60000000 + Math.floor((2000000 * 60000000) / 70000000);
    const eBase = 10000000 + Math.floor((2000000 * 10000000) / 70000000);
    const ann = (b: number, life: number) => Math.floor(b * Number(straightLineRate(life)));
    expect(inc?.depreciation).toBe(Math.floor((ann(bBase, 22) * 9) / 12) + Math.floor((ann(eBase, 15) * 9) / 12));
    expect(p?.facts?.builtYear).toBe(2028);
    // 取得価額は土地の取得＋建築費、自己資金は払う額
    expect(p?.facts?.acquisition).toEqual({ total: 80000000, costs: 2000000, equity: 72000000 });
  });

  it("建てる月に自己資金を払い、建てた後のローンの利息を経費にする（土地の取得の分は建物の額を超える借入だけ）", () => {
    const l = loan({ principal: 70000000, start: at("2028-04"), rateSchedule: [{ from: at("2028-04"), type: "fixed", rate: "0.02" }] });
    const f = full(req([buildAccount()], [l]));
    expect(cells(f, "cf.expense.lumpSum.realEstatePurchase", 2028)).toBe(72000000 - 70000000);
    expect(cells(f, "cf.balance.debt", 2027)).toBe(0);
    expect(cells(f, "cf.balance.debt", 2028)).toBeGreaterThan(68000000);
    const inc = prop(req([buildAccount()], [l]))?.income.find((x) => x.year === 2029);
    expect(inc?.interest).toBeGreaterThan(0);
    expect(inc?.landInterest).toBe(0);
  });

  it("土地の割合・建った年を入れていても、建てる前の時価は全部土地、建物は建てる年に新築", () => {
    const p = prop(req([buildAccount(buildPlan(), { landShare: "0.3", builtYear: 1990 })]));
    expect(p?.years.find((x) => x.year === 2026)).toMatchObject({ land: 30000000, building: 0 });
    expect(p?.years.find((x) => x.year === 2028)?.building).toBe(70000000);
    expect(p?.facts?.builtYear).toBe(2028);
  });

  it("分析の数字は建てる年から", () => {
    const a = call<RealEstateAnalysisOutput>(req([buildAccount()]), "asset.realEstateAnalysis").properties.find((x) => x.object === P);
    expect(a?.years[0]?.year).toBe(2028);
  });

  it("土地の取得価額が無ければ、売ったときの取得費は土地の分を概算取得費（5%）、建物の分を建築費−償却の累計で出す", () => {
    const p = prop(req([buildAccount(buildPlan(), { acquisition: undefined, sale: { at: at("2040-04"), price: 90000000 } })]));
    expect(p?.sale?.term).toBe("long");
    const s = p?.sale;
    expect(s?.acquisitionCost).toBeGreaterThan(Math.floor(90000000 * 0.05));
    const n = notices(full(req([buildAccount(buildPlan(), { acquisition: undefined, sale: { at: at("2040-04"), price: 90000000 } })])));
    expect(n.some((x) => x.code === "N_ASSUMED" && x.ids.includes("realEstate.saleHoldingLong"))).toBe(true);
  });
});

describe("予定の月が計算基準月の前後（1〜3月）", () => {
  it("計算基準月より前の予定は支払いを表に出さず、その月から持っている", () => {
    const f = full(req([buyAccount(buyPlan({ at: at("2026-01") }))], [], "2026-02"));
    expect(cells(f, "cf.expense.lumpSum.realEstatePurchase", 2026)).toBe(0);
    expect(cells(f, "cf.balance.account.realEstate", 2026)).toBe(50000000);
    // 家賃は計算基準月から
    expect(cells(f, "cf.income.other.rental", 2026)).toBe(360000 * 11);
  });

  it("計算基準月と同じ月・後の月（同じ年の3月）の予定は、その月に払う", () => {
    expect(cells(full(req([buyAccount(buyPlan({ at: at("2026-02") }))], [], "2026-02")), "cf.expense.lumpSum.realEstatePurchase", 2026)).toBe(53000000);
    const f = full(req([buyAccount(buyPlan({ at: at("2026-03") }))], [], "2026-02"));
    expect(cells(f, "cf.expense.lumpSum.realEstatePurchase", 2026)).toBe(53000000);
    expect(cells(f, "cf.income.other.rental", 2026)).toBe(360000 * 10);
  });

  it("計算基準年の前の年の不動産所得（住民税のため）は、予定の月より前には入れない", () => {
    const p = prop(req([buyAccount(buyPlan({ at: at("2026-03") }))], [], "2026-02"));
    expect(p?.income.some((x) => x.year < 2026)).toBe(false);
    expect(p?.income.find((x) => x.year === 2026)?.rent).toBe(360000 * 10);
  });
});

describe("予定の年に売る予定と重なる場合", () => {
  it("予定の月か、それより前に売る予定は売らない（ローンも返さない。知らせ）", () => {
    const sale = { sale: { at: at("2030-07"), price: 60000000 } };
    const r = req([buyAccount(buyPlan(), sale)], [loan()]);
    const p = prop(r);
    expect(p?.sale).toBeNull();
    expect(p?.years.find((x) => x.year === 2031)?.value).toBeGreaterThan(0);
    const f = full(r);
    expect(cells(f, "cf.income.lumpSum.realEstateSale", 2030)).toBe(0);
    // 売ったときに返さない（返済の予定のまま、年末の残高が残る）
    expect(cells(f, "cf.balance.debt", 2031)).toBeGreaterThan(38000000);
    expect(notices(f).some((x) => x.code === "N_ASSUMED" && x.ids.includes("realEstate.planSaleIgnored"))).toBe(true);
  });

  it("同じ年の後の月に売るなら、買って売る（年末の評価額は無く、支払いと売却の手取りが同じ年に出る）", () => {
    const r = req([buyAccount(buyPlan(), { sale: { at: at("2030-11"), price: 52000000, costRate: "0" } })], [loan()]);
    const p = prop(r);
    expect(p?.years.length).toBe(0);
    expect(p?.sale).toMatchObject({ ym: "2030-11", price: 52000000, proceeds: 52000000, term: "short" });
    const f = full(r);
    expect(cells(f, "cf.expense.lumpSum.realEstatePurchase", 2030)).toBe(13000000);
    expect(cells(f, "cf.income.lumpSum.realEstateSale", 2030)).toBe(52000000);
    expect(cells(f, "cf.balance.debt", 2030)).toBe(0);
  });
});

describe("今ある物件の結果が変わらない", () => {
  it("予定の物件を足しても、今ある物件の評価額・不動産所得・分析の材料は同じ", () => {
    const before = prop(req([nowAccount]), Q);
    const after = prop(req([nowAccount, buyAccount()], [loan()]), Q);
    expect(after).toEqual(before);
    expect(before?.facts?.planned).toBeUndefined();
    expect(before?.years.every((x) => x.assessed === undefined)).toBe(true);
  });
});

describe("相続税の評価の材料", () => {
  it("予定の建物の固定資産税評価額の目安を、評価替えの年ごとに経年減点補正率で動かす（0181 の式）", () => {
    const p = prop(req([buildAccount(buildPlan({ assessed: box(28000000) }))]));
    const y = (n: number) => p?.years.find((x) => x.year === n);
    expect(y(2027)?.assessed).toBeUndefined();
    // 2028年に建てる木造: 2027年度の評価替えの補正率（経過1年の0.80）を元に、2030年度は築2年の0.75、2033年度は築5年の0.65
    expect(y(2028)?.assessed).toBe(28000000);
    expect(y(2029)?.assessed).toBe(28000000);
    expect(y(2030)?.assessed).toBe(Math.floor((28000000 * 0.75) / 0.8));
    expect(y(2033)?.assessed).toBe(Math.floor((28000000 * 0.65) / 0.8));
    // 築25年以上は0.20で止まる
    expect(y(2060)?.assessed).toBe(Math.floor((28000000 * 0.2) / 0.8));
  });

  it("貸している割合（年末の月）: 空室率を引いた割合、建てる前は0、今の実際の家賃収入は1", () => {
    const p = prop(req([buildAccount()]));
    expect(p?.years.find((x) => x.year === 2027)?.rentedShare).toBe("0");
    expect(p?.years.find((x) => x.year === 2028)?.rentedShare).toBe("0.9");
    const q = prop(req([{ ...nowAccount, property: { ...(nowAccount.property as Obj), rental: { monthly: box(100000), rentBy: "actual" } } }]), Q);
    expect(q?.years[0]?.rentedShare).toBe("1");
  });

  it("経年減点補正率は、画面（app の propertyTax.ts の keinenRate）と同じ値（app/test/rental-plan.test.ts が同じ値を確かめる）", () => {
    const wood = [0.8, 0.75, 0.7, 0.68, 0.65, 0.63, 0.61, 0.59, 0.56, 0.54, 0.52, 0.5, 0.47, 0.45, 0.43, 0.4, 0.38, 0.36, 0.34, 0.31, 0.29, 0.27, 0.25, 0.22, 0.2];
    for (let age = 1; age <= 70; age++) expect(Number(keinenRateText("wood", age)), `wood ${age}`).toBe(wood[Math.min(age, 25) - 1]);
    // 非木造は画面と同じ式（0.7 − 0.5×(経過−3)÷(年数−3) を小数4桁に）で照らす
    const nonWood = (n: number, a: number) => (a <= 3 ? [0.8, 0.75, 0.7][a - 1] : a >= n ? 0.2 : Math.round((0.7 - (0.5 * (a - 3)) / (n - 3)) * 10000) / 10000);
    for (const [s, n] of [["rc", 60], ["steel", 40], ["lightSteel", 30]] as const) for (let age = 1; age <= 70; age++) expect(Number(keinenRateText(s, age)), `${s} ${age}`).toBe(nonWood(n, age));
    expect([4, 30, 59].map((a) => keinenRateText("rc", a))).toEqual(["0.6912", "0.4632", "0.2088"]);
  });

  it("経年減点補正率の非木造の表（小数4桁）", () => {
    expect(keinenRateText("rc", 1)).toBe("0.80");
    expect(keinenRateText("rc", 4)).toBe("0.6912");
    expect(keinenRateText("rc", 60)).toBe("0.20");
    expect(keinenRateText("lightSteel", 30)).toBe("0.20");
    expect(keinenRateText("wood", 40)).toBe("0.20");
  });
});

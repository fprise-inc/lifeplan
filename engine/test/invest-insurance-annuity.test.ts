// 運用・NISA・保険の器の直し（0179）: 旧NISA・ジュニアNISA の内訳の無いときの非課税期間の終わり（R4-001）・移し先の利回り（R4-002）、
// 変額・外貨建の積立金の前の払込（R4-003）、契約者と受取人が違う年金の権利の贈与と雑所得（R4-004）、年金の年数が空・終身の必要経費（R4-005）、
// 必要経費の割合の端数（R4-006）。直す前はどれも落ちた
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { box, modelHousehold, realPacks } from "./helpers.ts";

const packs = realPacks();
const run = (req: EngineRequest) => runEngine(structuredClone({ ...req, trace: "none" }), packs) as EngineResult;
const call = <T>(req: EngineRequest, component: string, input: unknown): T => runEngine(req, packs, { checkInternal: true, entry: { component, input } }).entryOutput as T;
const id = (n: string) => `00000000-0000-4000-8000-0000000000${n}`;
const annualOf = (r: EngineResult, row: string, year: number) =>
  (r.annual as unknown as { row: string; year: number; amount: number }[]).filter((a) => a.row === row && a.year === year).reduce((s, a) => s + a.amount, 0);
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 年金暮らしの夫婦（預金だけ）の器を差し替える */
function pensioners(accounts: (self: string) => Obj[], end = 2050): EngineRequest {
  const req = modelHousehold("pensionCouple") as unknown as Obj;
  const self = req.input.household.members[0].id;
  req.input.household.accounts = accounts(self);
  req.input.endYear = end;
  return req as unknown as EngineRequest;
}
const deposit = (self: string) => ({ id: id("01"), kind: "deposit", owner: self, marketValue: box(5_000_000), asOf: "2026-09", contributions: [] });

describe("R4-001 旧NISA に買付の年の内訳が無いとき", () => {
  it("残高の時点（2026-09）の年は2023年で頭を打ち、2023年に買った一般NISA とみなして2027年末に課税口座へ移る", () => {
    const r = run(pensioners((self) => [deposit(self), { id: id("02"), kind: "legacyNisa", owner: self, marketValue: box(3_000_000), costBasis: box(1_000_000), asOf: "2026-09", contributions: [], expectedReturn: "0.05" }]));
    expect(annualOf(r, "cf.balance.account.legacyNisa", 2026)).toBeGreaterThan(0);
    expect(annualOf(r, "cf.balance.account.legacyNisa", 2027)).toBe(0); // 前は 2050年末も 9,796,220円のまま非課税
    expect(annualOf(r, "cf.balance.account.taxable", 2027)).toBeGreaterThan(0);
  });
  it("内訳を入れた器は今までどおり内訳の年で決める", () => {
    const r = run(pensioners((self) => [deposit(self), { id: id("02"), kind: "legacyNisa", owner: self, marketValue: box(3_000_000), costBasis: box(1_000_000), asOf: "2026-09", contributions: [], lots: [{ vintageYear: 2023, regime: "tsumitate", costBasis: 1_000_000, marketValue: 3_000_000 }] }]));
    expect(annualOf(r, "cf.balance.account.legacyNisa", 2041)).toBeGreaterThan(0);
    expect(annualOf(r, "cf.balance.account.legacyNisa", 2042)).toBe(0);
  });
});

describe("R4-002 旧NISA を課税口座へ移した後の利回り", () => {
  it("名義人に課税口座が無いとき、移した後も元の旧NISA と同じ利回り（5%）で増える", () => {
    const r = run(pensioners((self) => [deposit(self), { id: id("02"), kind: "legacyNisa", owner: self, marketValue: box(3_000_000), costBasis: box(1_000_000), asOf: "2026-09", contributions: [], expectedReturn: "0.05", lots: [{ vintageYear: 2022, regime: "general", costBasis: 1_000_000, marketValue: 3_000_000 }] }]));
    const y26 = annualOf(r, "cf.balance.account.taxable", 2026);
    expect(y26).toBe(3_037_500);
    expect(annualOf(r, "cf.balance.account.taxable", 2027)).toBe(Math.round(y26 * 1.05)); // 前は 3,067,875（前提の運用利回り 1%）
  });
});

describe("R4-003 変額・外貨建の積立金（前の入れ方）", () => {
  const req0 = modelHousehold("insuranceMaturityAnnuity") as unknown as Obj;
  const self = req0.input.household.members[0].id;
  const mk = (n: string, template: string, contractDate: string, premium: Obj) => ({
    id: id(n), template, policyholder: self, insured: self, contractDate, currency: "JPY", premium,
    deductionCategory: { type: "general", regime: "new" },
    coverages: [{ id: id(n[0] + "f"), role: "main", benefit: "death", amount: 3_000_000 }],
    simple: { loadRate: "0.1" },
  });
  const req = structuredClone(req0);
  req.input.household.insuranceContracts = [
    mk("a1", "insurance.variable", "2015-01", { amount: 20000, frequency: "monthly", payUntil: { at: "2044-12" } }),
    mk("b1", "insurance.foreignCurrency", "2020-04", { amount: 5_000_000, frequency: "single", payUntil: null }),
  ];
  req.input.assumptions.investmentReturn = { default: "0" };
  const r = run(req as unknown as EngineRequest) as unknown as { summary: { insurance: { byYear: { year: number; object: string; surrenderValue: number; paid: number }[] } } };
  const at = (n: string) => r.summary.insurance.byYear.find((e) => e.year === 2026 && e.object === id(n))!;
  it("2015年からの月払い（利回り0%・費用10%）: 2026年末の積立金＝払込の累計 2,880,000×0.9", () => {
    expect(at("a1").paid).toBe(2_880_000);
    expect(at("a1").surrenderValue).toBe(2_592_000); // 前は 648,000（2024年1月からの分だけ）
  });
  it("2020年の一時払い 500万円: 積立金＝500万×0.9", () => {
    expect(at("b1").surrenderValue).toBe(4_500_000); // 前は 0
  });
});

// 見本の個人年金: 契約者・被保険者＝本人（1986-01生まれ・男）、2016-02 から月1.5万円を 2046-01 まで（払込 5,385,000円）、年金 60万円×10年（2046-02 から）
const annuityReq = (f: (a: Obj, req: Obj) => void = () => {}): EngineRequest => {
  const req = modelHousehold("insuranceMaturityAnnuity") as unknown as Obj;
  f(req.input.household.insuranceContracts.find((c: Obj) => c.template === "insurance.privateAnnuity"), req);
  return req as unknown as EngineRequest;
};
const members = (req: EngineRequest) => (req as unknown as Obj).input.household.members as Obj[];
const misc = (req: EngineRequest, member: string, year: number) => call<{ miscellaneous: number }>(req, "insurance.income", { member, year }).miscellaneous;
type GiftTax = { amount: number; tax: number };

describe("R4-004 契約者と受取人（配偶者）が違う個人年金", () => {
  const toSpouse = (rate?: string) =>
    annuityReq((a, req) => {
      a.annuitant = req.input.household.members[1].id;
      if (rate !== undefined) req.input.estimateValues = { "preset.insurance.annuityAssumedRate": rate };
    });
  it("支払が始まる年（2046年）に年金を受け取る権利を1回贈与されたとみなす。評価額＝60万円×複利年金現価率（予定利率0.25%・10年＝9.864）＝5,918,400円、贈与税（一般税率）795,400円", () => {
    const req = toSpouse();
    const spouse = members(req)[1]!.id as string;
    const g = call<GiftTax>(req, "gift.tax", { member: spouse, year: 2046 });
    expect(g.amount).toBe(5_918_400); // 前は 600,000（その年の年金の額だけ）
    expect(g.tax).toBe(795_400); // 前は 0
    expect(call<GiftTax>(req, "gift.tax", { member: spouse, year: 2047 }).amount).toBe(0); // 毎年の年金は贈与でない
  });
  it("毎年の年金は雑所得。相続税評価割合 98.64%（百分の九十八を超える）なので課税割合0で、雑所得は0", () => {
    const req = toSpouse();
    const spouse = members(req)[1]!.id as string;
    for (const y of [2046, 2047, 2055]) expect(misc(req, spouse, y)).toBe(0);
  });
  it("予定利率5%（複利年金現価率 7.722）: 評価額 4,633,200円・贈与税 456,600円。相続税評価割合 77.22%→課税割合 20%、一課税単位 6,000,000×0.2÷45＝26,666円。2年目の課税部分 26,666円−必要経費（×90%）23,999円＝2,667円、10年目 239,994円−215,994円＝24,000円", () => {
    const req = toSpouse("0.05");
    const spouse = members(req)[1]!.id as string;
    const g = call<GiftTax>(req, "gift.tax", { member: spouse, year: 2046 });
    expect(g.amount).toBe(4_633_200);
    expect(g.tax).toBe(456_600);
    expect(misc(req, spouse, 2046)).toBe(0);
    expect(misc(req, spouse, 2047)).toBe(2_667);
    expect(misc(req, spouse, 2055)).toBe(24_000);
  });
  it("年金を受け取る権利の贈与はお金の動きに出さない（受け取る年金の行は今までどおり）", () => {
    const req = toSpouse();
    const a = (req as unknown as Obj).input.household.insuranceContracts.find((c: Obj) => c.template === "insurance.privateAnnuity");
    const out = call<{ flows: { ym: string; amount: number; formula: string }[]; receipts: { ym: string; kind: string; amount: number; taxClass: string }[] }>(req, "insurance.policy", { object: a.id });
    expect(out.flows.filter((f) => f.ym.startsWith("2046-")).map((f) => [f.formula, f.amount])).toEqual([["insurance.policy.annuity", 600_000]]);
    expect(out.receipts.filter((x) => x.ym === "2046-02").map((x) => [x.kind, x.taxClass, x.amount])).toEqual([
      ["annuityRight", "gift", 5_918_400],
      ["annuity", "miscellaneous", 600_000],
    ]);
  });
});

describe("R4-005・R4-006 個人年金の必要経費", () => {
  const self = (req: EngineRequest) => members(req)[0]!.id as string;
  it("見本: 割合 5,385,000÷6,000,000＝0.8975 → 0.90。必要経費 540,000円、雑所得 60,000円", () => {
    const req = annuityReq();
    expect(misc(req, self(req), 2047)).toBe(60_000); // 前は 61,500（割合をそのまま）
  });
  it("年金 70万円: 割合 0.7692… → 0.77。必要経費 539,000円、雑所得 161,000円", () => {
    const req = annuityReq((a) => (a.coverages[0].amount = 700_000));
    expect(misc(req, self(req), 2047)).toBe(161_000); // 前は 161,500
  });
  it("年金の年数を空にして保障の終わりを 2055-02 にした（同じ10回）なら、年数を入れたときと同じ", () => {
    const req = annuityReq((a) => {
      delete a.coverages[0].years;
      a.coverages[0].to = { at: "2055-02" };
    });
    expect(misc(req, self(req), 2047)).toBe(60_000); // 前は 600,000（必要経費 0）
  });
  it("年数も保障の終わりも無い終身年金: 支払総額の見込額＝60万円×余命年数（60歳・男 19年）。割合 5,385,000÷11,400,000 → 0.48、雑所得 312,000円", () => {
    const req = annuityReq((a) => delete a.coverages[0].years);
    expect(misc(req, self(req), 2047)).toBe(312_000); // 前は 600,000
  });
});

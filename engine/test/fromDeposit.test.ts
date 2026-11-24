// 預金から移す（accounts[].fromDeposit。0258）のテスト（L1）: 時期ごとの額を決済口座から器へ移す（年間収支に入れない）・計算基準月と表の最後の年の境目・
// NISA の成長投資枠の年の枠と生涯の枠の境目（ちょうど・1円超え）・預金が足りないとき・資産配分の口座・積立との順番。【架空の見本】の制度データで手計算と突き合わせる
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { box, fictionalPacks, household, member, period, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const A = uid("a");
const at = (ym: string) => ({ at: ym });
type Cell = { row: string; year: number; amount: number; object?: string; member?: string; formula?: string };
const cells = (r: ReturnType<typeof full>, row: string, year: number) => (r.table as unknown as Cell[]).filter((c) => c.row === row && c.year === year).reduce((s, c) => s + c.amount, 0);
type FlowRow = { row: string; ym: string; amount: number; object?: string; formula?: string };
const flowsOf = (r: ReturnType<typeof full>) => r.flows as unknown as FlowRow[];
const byFormula = (r: ReturnType<typeof full>, formula: string, year: number) => flowsOf(r).filter((c) => c.formula === formula && c.ym.startsWith(`${year}-`) && c.row.startsWith("cf.transfer.")).reduce((s, c) => s + c.amount, 0);
const notices = (r: ReturnType<typeof full>) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const withInput = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
const dep = (v: number, o: Obj = {}) => ({ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(v), asOf: "2025-12", contributions: [], ...o });
const tx = (moves: Obj[], o: Obj = {}) => ({ id: uid("tx"), kind: "taxable", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [], fromDeposit: moves, ...o });
const nisa = (moves: Obj[], o: Obj = {}) => ({ id: uid("nisa"), kind: "nisa", owner: A, marketValue: box(0), costBasis: box(0), asOf: "2025-12", contributions: [], fromDeposit: moves, ...o });
const move = (ym: string, amount: number) => ({ id: uid(`mv${ym}${amount}`), at: at(ym), amount });
/** 1980年6月生まれ・2035年12月まで会社員の世帯（計算基準月は2026年1月・表の最後の年は2050年） */
const mk = (accounts: Obj[], f: (h: Obj, input: Obj) => void = () => {}, endYear = 2050) =>
  withInput(household({ members: [member("a", "self", "1980-06")], periods: [period("p", { member: "a", from: "2003-04", to: "2035-12", annual: 8000000, std: [620000, 620000] })], accounts, endYear }), f);
const MAN = 10000;

describe("預金から移す（0258）", () => {
  it("課税口座へ3回に分けて移す: その月に決済口座から移し（移動の行・計算式 plan.cashflow.fromDeposit）、年間収支は変わらない", () => {
    const moves = [move("2026-01", 1000 * MAN), move("2028-01", 2000 * MAN), move("2033-01", 2000 * MAN)];
    const r = full(mk([dep(5000 * MAN), tx(moves)]));
    const none = full(mk([dep(5000 * MAN), tx([])]));
    expect(cells(r, "cf.transfer.investment", 2026)).toBe(1000 * MAN);
    expect(cells(r, "cf.transfer.investment", 2027)).toBe(0);
    expect(cells(r, "cf.transfer.investment", 2028)).toBe(2000 * MAN);
    expect(cells(r, "cf.transfer.investment", 2033)).toBe(2000 * MAN);
    const rows = flowsOf(r).filter((c) => c.row === "cf.transfer.investment" && c.amount > 0);
    expect(rows.map((c) => c.ym)).toEqual(["2026-01", "2028-01", "2033-01"]);
    expect(rows.every((c) => c.formula === "plan.cashflow.fromDeposit" && c.object === uid("tx"))).toBe(true);
    // 器の間の移動なので、年間収支には入れない
    for (const y of [2026, 2028, 2033]) expect(cells(r, "cf.net", y)).toBe(cells(none, "cf.net", y));
    expect(cells(r, "cf.balance.account.taxable", 2026)).toBeGreaterThan(1000 * MAN);
  });

  it("時期の境目: 計算基準月より前は使わない・計算基準月ちょうどは使う・表の最後の年の12月は使う・その後は使わない", () => {
    const r = full(mk([dep(10000 * MAN), tx([move("2025-12", 100 * MAN), move("2026-01", 200 * MAN), move("2050-12", 300 * MAN), move("2051-01", 400 * MAN)])]));
    expect(cells(r, "cf.transfer.investment", 2026)).toBe(200 * MAN);
    expect(cells(r, "cf.transfer.investment", 2050)).toBe(300 * MAN);
    const total = (r.table as unknown as Cell[]).filter((c) => c.row === "cf.transfer.investment").reduce((s, c) => s + c.amount, 0);
    expect(total).toBe(500 * MAN);
  });

  it("基準月が3月の世帯: 1〜2月の行は使わず、3月の行から使う", () => {
    const req = withInput(mk([dep(10000 * MAN), tx([move("2026-02", 100 * MAN), move("2026-03", 200 * MAN)])]), (_h, input) => (input.baseMonth = "2026-03"));
    expect(cells(full(req), "cf.transfer.investment", 2026)).toBe(200 * MAN);
  });

  it("NISA は成長投資枠に入れる: 年の枠（年240万円）ちょうどは全部入り、1円超えた分は預金に残す（課税口座で続ける前提でも）。知らせを出す", () => {
    const exact = full(mk([dep(5000 * MAN), nisa([move("2027-04", 240 * MAN)])]));
    expect(cells(exact, "cf.transfer.nisa.growth", 2027)).toBe(240 * MAN);
    expect(cells(exact, "cf.transfer.nisa.tsumitate", 2027)).toBe(0);
    expect(notices(exact)).not.toContainEqual({ code: "N_LIMIT_APPLIED", ids: ["plan.cashflow", "nisa.annualLimit"] });
    const over = (f: (h: Obj, input: Obj) => void = () => {}) => full(mk([dep(5000 * MAN), nisa([move("2027-04", 240 * MAN + 1)])], f));
    const r = over();
    expect(cells(r, "cf.transfer.nisa.growth", 2027)).toBe(240 * MAN);
    expect(cells(r, "cf.transfer.investment", 2027)).toBe(0);
    expect(notices(r)).toContainEqual({ code: "N_LIMIT_APPLIED", ids: ["plan.cashflow", "nisa.annualLimit"] });
    const taxable = over((_h, input) => ((input.assumptions as Obj).investment = { nisaOverflow: "taxable" }));
    expect(cells(taxable, "cf.transfer.nisa.growth", 2027)).toBe(240 * MAN);
    expect(cells(taxable, "cf.transfer.investment", 2027)).toBe(0);
    // 同じ年の2行は合わせて年の枠まで（2行目の超えた分を預金に残す）。翌年の行は翌年の枠
    const two = full(mk([dep(5000 * MAN), nisa([move("2027-01", 200 * MAN), move("2027-07", 100 * MAN), move("2028-01", 240 * MAN)])]));
    expect(cells(two, "cf.transfer.nisa.growth", 2027)).toBe(240 * MAN);
    expect(cells(two, "cf.transfer.nisa.growth", 2028)).toBe(240 * MAN);
  });

  it("NISA の生涯の枠（1,800万円）と成長投資枠の生涯の枠（1,200万円）: ちょうどは全部入り、1円超えた分は預金に残す", () => {
    // 生涯の枠の残り240万円（成長投資枠はまだ使っていない）
    const life = (amount: number) => full(mk([dep(5000 * MAN), nisa([move("2026-06", amount)], { marketValue: box(1560 * MAN), costBasis: box(1560 * MAN), frame: { lifetimeUsedCost: 1560 * MAN, growthUsedCost: 0, asOfYear: 2025 } })]));
    expect(cells(life(240 * MAN), "cf.transfer.nisa.growth", 2026)).toBe(240 * MAN);
    expect(cells(life(240 * MAN + 1), "cf.transfer.nisa.growth", 2026)).toBe(240 * MAN);
    expect(notices(life(240 * MAN + 1))).toContainEqual({ code: "N_LIMIT_APPLIED", ids: ["plan.cashflow", "nisa.annualLimit"] });
    // 成長投資枠の生涯の枠の残り200万円（生涯の枠は800万円残る）
    const growth = (amount: number) => full(mk([dep(5000 * MAN), nisa([move("2026-06", amount)], { marketValue: box(1000 * MAN), costBasis: box(1000 * MAN), frame: { lifetimeUsedCost: 1000 * MAN, growthUsedCost: 1000 * MAN, asOfYear: 2025 } })]));
    expect(cells(growth(200 * MAN), "cf.transfer.nisa.growth", 2026)).toBe(200 * MAN);
    expect(cells(growth(200 * MAN + 1), "cf.transfer.nisa.growth", 2026)).toBe(200 * MAN);
  });

  it("同じ年の積立とは月の順に枠を使う: つみたて投資枠を超えて成長投資枠に回った積立の後の12月の行は、成長投資枠の残りまで", () => {
    // つみたて投資枠に月15万円（年180万円）: 120万円を超えた60万円は成長投資枠へ。12月に移す240万円は残りの180万円まで
    const r = full(mk([dep(5000 * MAN), nisa([move("2027-12", 240 * MAN)], { contributions: [{ from: at("2026-01"), to: at("2035-12"), monthly: 150000 }] })]));
    expect(cells(r, "cf.transfer.nisa.tsumitate", 2027)).toBe(120 * MAN);
    expect(cells(r, "cf.transfer.nisa.growth", 2027)).toBe(240 * MAN);
    expect(byFormula(r, "plan.cashflow.fromDeposit", 2027)).toBe(180 * MAN);
    // 1月に移すと先に成長投資枠を使い切り、後の月のつみたて投資枠を超えた積立は入らない
    const jan = full(mk([dep(5000 * MAN), nisa([move("2027-01", 240 * MAN)], { contributions: [{ from: at("2026-01"), to: at("2035-12"), monthly: 150000 }] })]));
    expect(cells(jan, "cf.transfer.nisa.tsumitate", 2027)).toBe(120 * MAN);
    expect(cells(jan, "cf.transfer.nisa.growth", 2027)).toBe(240 * MAN);
    expect(byFormula(jan, "plan.cashflow.fromDeposit", 2027)).toBe(240 * MAN);
    expect(byFormula(jan, "plan.cashflow.contribution", 2027)).toBe(120 * MAN);
  });

  it("預金が足りないとき: ほかの赤字と同じく年末に取り崩して補い、取り崩せる口座が無ければ資金の不足に出す", () => {
    // 預金100万円から1,000万円を移す。取り崩す順番の課税口座から年末に売って補う
    const r = full(mk([dep(100 * MAN), tx([move("2026-01", 1000 * MAN)])]));
    expect(cells(r, "cf.transfer.investment", 2026)).toBe(1000 * MAN);
    expect(cells(r, "cf.balance.shortfall", 2026)).toBe(0);
    expect(cells(r, "cf.balance.account.taxable", 2026)).toBeLessThan(1000 * MAN);
    // 課税口座を引き出せない期間にすると、補えない分が資金の不足
    const locked = full(mk([dep(100 * MAN), tx([move("2026-01", 1000 * MAN)], { withdrawalLockedUntil: at("2040-12") })]));
    expect(cells(locked, "cf.balance.shortfall", 2026)).toBeGreaterThan(0);
  });

  it("資産配分の入れ方の口座: 移した額に配分の利回りをかける（その年は半年分）", () => {
    const req = mk([dep(5000 * MAN), tx([move("2026-01", 1000 * MAN)])], (_h, input) => {
      const a = input.assumptions as Obj;
      a.assetReturns = { "equity.global": { default: "0.06" }, "bond.global": { default: "0.01" } };
      a.investment = { method: "allocation", allocation: { mix: [{ assetClass: "equity.global", share: "0.5" }, { assetClass: "bond.global", share: "0.5" }], fees: { "equity.global": "0.005", "bond.global": "0.005" } } };
    });
    const r = full(req);
    expect(cells(r, "cf.transfer.investment", 2026)).toBe(1000 * MAN);
    // (6%×0.5＋1%×0.5)−0.5% = 3% の半年分
    expect(cells(r, "cf.balance.account.taxable", 2026)).toBe(1015 * MAN);
  });

  it("使わない器（iDeCo・こどもNISA）の行は移さない", () => {
    const ideco = { id: uid("ideco"), kind: "ideco", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [], fromDeposit: [move("2026-06", 100 * MAN)] };
    const r = full(mk([dep(1000 * MAN), ideco]));
    const moved = flowsOf(r).filter((c) => c.formula === "plan.cashflow.fromDeposit");
    expect(moved).toEqual([]);
  });
});

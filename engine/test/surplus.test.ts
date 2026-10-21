// 黒字のうち貯まる割合（ゆとりの支出）・取り崩しの計画と重なる年・まとめた金融資産の運用しない分（0031）のテスト（L1）。
// 【架空の見本】の制度データで、何も入れない世帯と比べて確かめる
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { box, fictionalPacks, household, member, period, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Cell = { row: string; year: number; amount: number; object?: string; member?: string; ym?: string };
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const A = uid("a");
const at = (ym: string) => ({ at: ym });
const table = (r: ReturnType<typeof full>) => r.table as unknown as Cell[];
const cells = (r: ReturnType<typeof full>, row: string, year: number) => table(r).filter((c) => c.row === row && c.year === year).reduce((s, c) => s + c.amount, 0);
const has = (r: ReturnType<typeof full>, row: string) => table(r).some((c) => c.row === row);
const withInput = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
const dep = (v: number, o: Obj = {}) => ({ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(v), asOf: "2025-12", contributions: [], ...o });
const living = (monthly: number) => ({ id: uid("living"), mode: "total", monthly: box(monthly) });
const rets = (input: Obj) => ((input.assumptions as Obj).assetReturns = { "cash.deposit": { default: "0.001" }, "equity.global": { default: "0.04" } });
/** 1980年6月生まれ・2035年12月まで会社員（年収800万円）・生活費 月20万円の世帯（2036年から赤字） */
const mk = (accounts: Obj[], f: (h: Obj, input: Obj) => void = () => {}, endYear = 2060) =>
  withInput(household({ members: [member("a", "self", "1980-06")], periods: [period("p", { member: "a", from: "2003-04", to: "2035-12", annual: 8000000, std: [620000, 620000] })], accounts, endYear }), (h, input) => {
    h.livingExpenses = [living(200000)];
    rets(input);
    f(h, input);
  });
const assume = (o: Obj) => (_h: Obj, input: Obj) => Object.assign(input.assumptions as Obj, o);

describe("黒字のうち貯まる割合（ゆとりの支出。0031）", () => {
  const base = full(mk([dep(5000000)]));
  const surplus2030 = cells(base, "cf.net", 2030);

  it("何も入れなければ今まで通り（ゆとりの支出の行は出ない）", () => {
    expect(has(base, "cf.expense.living.surplus")).toBe(false);
    const same = full(mk([dep(5000000)], assume({ surplusSaving: {} })));
    expect(table(same).filter((c) => c.row === "cf.balance.financial")).toEqual(table(base).filter((c) => c.row === "cf.balance.financial"));
    const all = full(mk([dep(5000000)], assume({ surplusSaving: { ratio: "1" } })));
    expect(has(all, "cf.expense.living.surplus")).toBe(false);
  });

  it("割合 60%: 黒字の年は黒字の4割を「ゆとりの支出」として支出に足し、年間収支は6割になる", () => {
    expect(surplus2030).toBeGreaterThan(0);
    const r = full(mk([dep(5000000)], assume({ surplusSaving: { ratio: "0.6" } })));
    const saved = Math.floor(surplus2030 * 0.6);
    expect(cells(r, "cf.expense.living.surplus", 2030)).toBe(surplus2030 - saved);
    expect(cells(r, "cf.net", 2030)).toBe(saved);
    expect(cells(r, "cf.balance.financial", 2035)).toBeLessThan(cells(base, "cf.balance.financial", 2035));
  });

  it("赤字の年は何もしない（退職の後の赤字の年は、年間収支が変わらない）", () => {
    const r = full(mk([dep(50000000)], assume({ surplusSaving: { ratio: "0.6" } })));
    const b = full(mk([dep(50000000)]));
    expect(cells(b, "cf.net", 2040)).toBeLessThan(0);
    expect(cells(r, "cf.expense.living.surplus", 2040)).toBe(0);
    expect(cells(r, "cf.net", 2040)).toBe(cells(b, "cf.net", 2040));
  });

  it("上限: 貯まる額は年○万円まで（割合と両方なら少ないほう）", () => {
    const cap = full(mk([dep(5000000)], assume({ surplusSaving: { cap: 1000000 } })));
    expect(cells(cap, "cf.net", 2030)).toBe(Math.min(1000000, surplus2030));
    expect(cells(cap, "cf.expense.living.surplus", 2030)).toBe(Math.max(0, surplus2030 - 1000000));
    const both = full(mk([dep(5000000)], assume({ surplusSaving: { ratio: "0.9", cap: 1000000 } })));
    expect(cells(both, "cf.net", 2030)).toBe(Math.min(1000000, Math.floor(surplus2030 * 0.9)));
  });

  it("期間で変える: 2032年から 80%（書いた組に置き換える）", () => {
    const r = full(mk([dep(5000000)], assume({ surplusSaving: { ratio: "0.5", changes: [{ from: at("2032-04"), ratio: "0.8" }] } })));
    expect(cells(r, "cf.net", 2031)).toBe(Math.floor(cells(base, "cf.net", 2031) * 0.5));
    expect(cells(r, "cf.net", 2032)).toBe(Math.floor(cells(base, "cf.net", 2032) * 0.8));
    // 始まりより前の年から変える組は、始まりの組の代わり
    const early = full(mk([dep(5000000)], assume({ surplusSaving: { ratio: "0.5", changes: [{ from: at("2020-01"), ratio: "0.7" }] } })));
    expect(cells(early, "cf.net", 2027)).toBe(Math.floor(cells(base, "cf.net", 2027) * 0.7));
  });

  it("一時金の収入（退職金など）は黒字から除き、全部が貯まる", () => {
    const lump = (h: Obj) =>
      (h.retirementBenefits = [{ id: uid("rb"), member: A, kind: "lumpSum", paidAt: at("2035-12"), amount: box(20000000) }]);
    const b = full(mk([dep(5000000)], lump));
    const r = full(mk([dep(5000000)], (h, input) => {
      lump(h);
      Object.assign(input.assumptions as Obj, { surplusSaving: { ratio: "0.6" } });
    }));
    const lumpIn = table(b).filter((c) => c.row.startsWith("cf.income.lumpSum") && c.year === 2035).reduce((s, c) => s + c.amount, 0);
    expect(lumpIn).toBeGreaterThan(0);
    const regular = cells(b, "cf.net", 2035) - lumpIn;
    expect(cells(r, "cf.expense.living.surplus", 2035)).toBe(regular > 0 ? regular - Math.floor(regular * 0.6) : 0);
    expect(cells(r, "cf.net", 2035)).toBe(cells(b, "cf.net", 2035) - cells(r, "cf.expense.living.surplus", 2035));
  });
});

describe("取り崩しの計画と重なる年（0031 の追記）", () => {
  it("取り崩しの計画がある年（始まりの年から）は、黒字でもゆとりの支出を差し引かない", () => {
    // 2033年4月から毎月10万円を取り崩す計画（まだ働いていて黒字の年）
    const plan = { drawdown: { start: at("2033-04"), method: "fixed", monthly: 100000 } };
    const r = full(mk([dep(5000000)], assume({ investment: plan, surplusSaving: { ratio: "0.6" } })));
    const d = full(mk([dep(5000000)], assume({ investment: plan })));
    // 計画の前の年は、今まで通り差し引く
    expect(cells(r, "cf.expense.living.surplus", 2032)).toBeGreaterThan(0);
    // 計画の始まりの年とその後は差し引かない（計画の額だけを使う）
    for (const y of [2033, 2034, 2035]) {
      expect(cells(d, "cf.net", y)).toBeGreaterThan(0);
      expect(cells(r, "cf.expense.living.surplus", y)).toBe(0);
      expect(cells(r, "cf.expense.living.drawdown", y)).toBe(cells(d, "cf.expense.living.drawdown", y));
      expect(cells(r, "cf.net", y)).toBe(cells(d, "cf.net", y));
    }
  });
});

describe("生活防衛資金をなくした（0031 の追記）", () => {
  it("前提の生活防衛資金（emergencyReserve）は入力として受け付けない（世帯ファイルは変換の段で捨てる）", () => {
    expect(() => full(mk([dep(3000000)], assume({ emergencyReserve: { months: 6 } })))).toThrow();
  });
});

describe("合計の入れ方: 運用しない分（0031）", () => {
  const pooled = (o: Obj = {}) => ({ id: uid("pool"), kind: "pooled", owner: A, marketValue: box(20000000), asOf: "2025-12", expectedReturn: "0.04", contributions: [], ...o });
  const total = (o: Obj = {}) => assume({ investment: { method: "total" }, ...o });

  it("運用しない分には利回りをかけず（預金の利回り）、残りに利回りをかける", () => {
    const b = full(mk([pooled()], total(), 2030));
    const r = full(mk([pooled({ uninvested: 5000000 })], total(), 2030));
    const retB = cells(b, "cf.balance.account.pooled", 2026) - 20000000;
    const retR = cells(r, "cf.balance.account.pooled", 2026) - 20000000;
    // 2,000万円×4% ＝ 80万円 → 1,500万円×4%＋500万円×0.1% ＝ 60.5万円
    expect(retB).toBe(800000);
    expect(retR).toBe(605000);
  });

  it("口座の入れ方と整合する: 合計 2,000万円（うち運用しない分 500万円）と、預金 500万円＋課税口座 1,500万円は、最初の年の金融資産が同じ", () => {
    const t = full(mk([pooled({ uninvested: 5000000 })], total(), 2030));
    const tx4 = { id: uid("tx4"), kind: "taxable", owner: A, marketValue: box(15000000), costBasis: box(15000000), asOf: "2025-12", expectedReturn: "0.04", contributions: [] };
    const a = full(mk([dep(5000000), tx4], assume({ investment: { method: "accounts" } }), 2030));
    expect(cells(t, "cf.balance.return", 2026)).toBe(cells(a, "cf.balance.return", 2026));
    expect(cells(t, "cf.balance.financial", 2026)).toBe(cells(a, "cf.balance.financial", 2026));
  });

  it("口座の入れ方では、まだ口座に分けていない分の運用しない分は使わない（預金の口座に入れる）", () => {
    const dep1 = dep(1000000);
    const a = full(mk([pooled({ uninvested: 5000000 }), dep1], assume({ investment: { method: "accounts" } }), 2030));
    const b = full(mk([pooled(), dep1], assume({ investment: { method: "accounts" } }), 2030));
    expect(cells(a, "cf.balance.account.pooled", 2027)).toBe(cells(b, "cf.balance.account.pooled", 2027));
  });
});

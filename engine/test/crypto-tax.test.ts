// 暗号資産の取り崩しと申告分離課税（0124）のテスト（L1）: 2028年からの特定暗号資産の申告分離課税（所得税・復興特別所得税と住民税）・
// 譲渡損失の繰越控除・税の扱いが雑所得の暗号資産。【架空の見本】の制度データ（test/fixtures/regulation。2027年までは制度なし、
// 2028年から所得税 15%・住民税 5%・繰越 3年。復興特別所得税は架空の 2%）で、規則どおりに計算するかを手計算と突き合わせる
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { box, fictionalPacks, household, member, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Cell = { row: string; year: number; amount: number; object?: string };
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const A = uid("a");
const at = (ym: string) => ({ at: ym });
const cells = (r: ReturnType<typeof full>, row: string, year: number, object?: string) =>
  (r.table as unknown as Cell[]).filter((c) => c.row === row && c.year === year && (object === undefined || c.object === object)).reduce((s, c) => s + c.amount, 0);
const BTC = uid("btc");
const ETH = uid("eth");
/** 預金0・家賃で毎年赤字の世帯に、暗号資産の器を足す（利回り0） */
const mk = (crypto: Obj[], f: (input: Obj) => void = () => {}): Req => {
  const r = JSON.parse(JSON.stringify(household({ members: [member("a", "self", "1980-06")], endYear: 2032 }))) as Req;
  const input = r.input as unknown as Obj;
  const h = input.household as Obj;
  h.accounts = [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [] }, ...crypto];
  h.residences = [{ id: uid("rent"), kind: "rent", from: at("2010-01"), to: null, rent: { monthly: box(100000) } }];
  (input.assumptions as Obj).assetReturns = { "cash.deposit": { default: "0" } };
  (input.assumptions as Obj).investmentReturn = { default: "0" };
  f(input);
  return r;
};
const coin = (id: string, value: number, cost: number | null, o: Obj = {}): Obj => ({ id, kind: "cryptoAsset", owner: A, marketValue: box(value), ...(cost === null ? {} : { costBasis: box(cost) }), asOf: "2025-12", contributions: [], ...o });
// 架空の見本の税率: 所得税 15% ×（1＋復興特別所得税 2%）＝ 15.3%、住民税 5%
const IT = 0.153;
const RT = 0.05;

describe("暗号資産の取り崩しと申告分離課税（plan.cashflow 改訂22。0124）", () => {
  it("2027年までは取り崩さず（資金の不足）、2028年から取り崩す。取得価額との差に所得税・住民税をかけ、手取りで足りるだけ売る", () => {
    const r = full(mk([coin(BTC, 10000000, 5000000)]));
    for (const y of [2026, 2027]) {
      expect(cells(r, "cf.transfer.withdrawal", y)).toBe(0);
      expect(cells(r, "cf.balance.shortfall", y)).toBeGreaterThan(0);
      expect(cells(r, "cf.balance.account.cryptoAsset", y)).toBe(10000000);
    }
    const y = 2028;
    const g = cells(r, "cf.transfer.withdrawal", y, BTC);
    expect(g).toBeGreaterThan(0);
    // 売った額の半分が利益（取得価額 500万円÷時価 1,000万円）
    const gain = g - Math.floor((5000000 * g) / 10000000);
    const it = cells(r, "cf.taxSi.incomeTax.cryptoAsset", y);
    const rt = cells(r, "cf.taxSi.residentTax.cryptoAsset", y);
    expect(it).toBe(Math.floor(gain * IT));
    expect(rt).toBe(Math.floor(gain * RT));
    // 上場株式等の譲渡益の税の行には出さない
    expect(cells(r, "cf.taxSi.incomeTax.capitalGains", y)).toBe(0);
    // 2027年までの不足を補い、決済口座は0に戻る（手取りで足りるだけ）
    expect(cells(r, "cf.balance.account.deposit", y)).toBe(0);
    expect(cells(r, "cf.balance.shortfall", y)).toBe(0);
    expect(cells(r, "cf.balance.account.cryptoAsset", y)).toBe(10000000 - g);
    // 年間収支は譲渡益の税を引いた後
    const sum = (prefix: string) => (r.table as unknown as Cell[]).filter((c) => c.year === y && c.row.startsWith(prefix)).reduce((s, c) => s + c.amount, 0);
    expect(cells(r, "cf.net", y)).toBe(sum("cf.income.") - sum("cf.taxSi.") - sum("cf.expense."));
  });

  it("取得価額を入れなければ時価と同じ（今の評価額までの値上がりに税をかけない）", () => {
    const r = full(mk([coin(BTC, 10000000, null)]));
    expect(cells(r, "cf.transfer.withdrawal", 2028)).toBeGreaterThan(0);
    expect(cells(r, "cf.taxSi.incomeTax.cryptoAsset", 2028)).toBe(0);
  });

  it("既定の取り崩しの順序では課税口座の次（課税口座を先に売る）", () => {
    const tx = uid("tx");
    const r = full(mk([coin(BTC, 10000000, null), { id: tx, kind: "taxable", owner: A, marketValue: box(100000000), asOf: "2025-12", contributions: [] }]));
    expect(cells(r, "cf.transfer.withdrawal", 2028, tx)).toBeGreaterThan(0);
    expect(cells(r, "cf.transfer.withdrawal", 2028, BTC)).toBe(0);
  });

  it("売ったときの税の扱いが雑所得（miscellaneous）の暗号資産と、書いた順序に無い暗号資産は取り崩さない", () => {
    const misc = full(mk([coin(BTC, 10000000, 5000000, { cryptoTaxation: "miscellaneous" })]));
    expect(cells(misc, "cf.transfer.withdrawal", 2030)).toBe(0);
    expect(cells(misc, "cf.balance.account.cryptoAsset", 2030)).toBe(10000000);
    expect(cells(misc, "cf.balance.shortfall", 2030)).toBeGreaterThan(0);
    const unordered = full(mk([coin(BTC, 10000000, 5000000)], (input) => ((input.assumptions as Obj).withdrawal = { order: [{ kind: "taxable" }] })));
    expect(cells(unordered, "cf.transfer.withdrawal", 2030)).toBe(0);
    // 物の ID で順序に書けば取り崩す
    const byId = full(mk([coin(BTC, 10000000, 5000000)], (input) => ((input.assumptions as Obj).withdrawal = { order: [{ object: BTC }] })));
    expect(cells(byId, "cf.transfer.withdrawal", 2028, BTC)).toBeGreaterThan(0);
  });

  it("譲渡損失は同じ名義人の暗号資産の利益から引き、引ききれない分は翌年以後3年まで繰り越す（課税口座の利益からは引かない）", () => {
    // 先に売る BTC は値下がり（時価 100万円・取得価額 600万円）、後で売る ETH は値上がり（時価 2,000万円・取得価額 400万円）
    const loss = 5000000;
    const r = full(mk([coin(BTC, 1000000, 6000000), coin(ETH, 20000000, 4000000)], (input) => ((input.assumptions as Obj).withdrawal = { order: [{ object: BTC }, { object: ETH }] })));
    expect(cells(r, "cf.transfer.withdrawal", 2028, BTC)).toBe(1000000);
    let left = loss;
    let taxedSomewhere = false;
    for (let y = 2028; y <= 2031; y++) {
      const g = cells(r, "cf.transfer.withdrawal", y, ETH);
      if (g === 0) continue;
      const gain = g - Math.floor((4000000 * g) / 20000000);
      // 前の年までに ETH を売った分だけ時価・取得価額は減るが、割合（利益は売った額の8割）は同じ
      const used = Math.min(gain, left);
      left -= used;
      const it = cells(r, "cf.taxSi.incomeTax.cryptoAsset", y);
      expect(Math.abs(it - Math.floor((gain - used) * IT))).toBeLessThanOrEqual(1);
      if (it > 0) taxedSomewhere = true;
    }
    expect(left).toBe(0);
    expect(taxedSomewhere).toBe(true);
  });

  it("繰り越した譲渡損失は3年を過ぎると使えない", () => {
    // 2028年に損失（BTC を全部売る）。ETH は2032年まで引き出せない（4年後の年から売る）
    const r = full(
      mk([coin(BTC, 1000000, 6000000), coin(ETH, 20000000, 4000000, { withdrawalLockedUntil: at("2031-12") })], (input) => ((input.assumptions as Obj).withdrawal = { order: [{ object: BTC }, { object: ETH }] })),
    );
    expect(cells(r, "cf.transfer.withdrawal", 2028, BTC)).toBe(1000000);
    const g = cells(r, "cf.transfer.withdrawal", 2032, ETH);
    expect(g).toBeGreaterThan(0);
    const gain = g - Math.floor((4000000 * g) / 20000000);
    expect(Math.abs(cells(r, "cf.taxSi.incomeTax.cryptoAsset", 2032) - Math.floor(gain * IT))).toBeLessThanOrEqual(1);
  });
});

// 資産運用（0026）のテスト（L1）: 積立の終わりの既定・期間を分けた積立・NISA の枠と超えた分・iDeCo の受け取り（既定と行き先）・
// 入れ方（合計・口座・資産配分）・利回りの書き換え・取り崩しの計画・相場の下落の型。【架空の見本】の制度データで手計算と突き合わせる
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { IdecoPayoutPlanOutput } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, period, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const A = uid("a");
const S = uid("s");
const at = (ym: string) => ({ at: ym });
const cells = (r: ReturnType<typeof full>, row: string, year: number, pred: (c: { object?: string; member?: string }) => boolean = () => true) =>
  (r.table as unknown as { row: string; year: number; amount: number; object?: string; member?: string }[]).filter((c) => c.row === row && c.year === year && pred(c)).reduce((s, c) => s + c.amount, 0);
const withInput = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
const dep = (v: number, o: Obj = {}) => ({ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(v), asOf: "2025-12", contributions: [], ...o });
const nisa = (o: Obj = {}) => ({ id: uid("nisa"), kind: "nisa", owner: A, marketValue: box(0), costBasis: box(0), asOf: "2025-12", contributions: [], ...o });
/** 1980年6月生まれ・2035年12月まで会社員（55歳で退職）の世帯 */
const mk = (accounts: Obj[], f: (h: Obj, input: Obj) => void = () => {}, endYear = 2050) =>
  withInput(household({ members: [member("a", "self", "1980-06")], periods: [period("p", { member: "a", from: "2003-04", to: "2035-12", annual: 8000000, std: [620000, 620000] })], accounts, endYear }), f);

describe("積立の終わりの既定（0026）", () => {
  it("積立の終わりが空の積立は、名義の人の退職の月まで（今までの「表の最後まで」をやめる）", () => {
    const r = full(mk([dep(5000000), { id: uid("tx"), kind: "taxable", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [{ from: at("2026-01"), to: null, monthly: 50000 }] }]));
    expect(cells(r, "cf.transfer.investment", 2035)).toBe(600000);
    expect(cells(r, "cf.transfer.investment", 2036)).toBe(0);
  });

  it("働き方の期間の無い人（配偶者）の積立は、本人の退職の月まで", () => {
    const req = withInput(mk([dep(5000000)]), (h) => {
      (h.members as Obj[]).push(member("s", "spouse", "1982-03"));
      (h.accounts as Obj[]).push({ id: uid("stx"), kind: "taxable", owner: S, marketValue: box(0), asOf: "2025-12", contributions: [{ from: at("2026-01"), to: null, monthly: 10000 }] });
    });
    const r = full(req);
    expect(cells(r, "cf.transfer.investment", 2035, (c) => c.member === S)).toBe(120000);
    expect(cells(r, "cf.transfer.investment", 2036, (c) => c.member === S)).toBe(0);
  });

  it("退職の月が計算基準月より前なら、積立の終わりが空の積立は取り崩しの計画の始まりの前の月まで（計画が無ければ表の最後まで）。知らせを出す", () => {
    // 2020年12月に退職した人（計算基準月は2026年1月）が、課税口座に月3万円を積み立てる
    const tx = { id: uid("tx"), kind: "taxable", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [{ from: at("2026-01"), to: null, monthly: 30000 }] };
    const retired = (f: (h: Obj, input: Obj) => void = () => {}) =>
      withInput(mk([dep(30000000), tx]), (h, input) => {
        (h.employmentPeriods as Obj[])[0] = period("p", { member: "a", from: "2003-04", to: "2020-12", annual: 8000000, std: [620000, 620000] });
        f(h, input);
      });
    const r = full(retired());
    expect(cells(r, "cf.transfer.investment", 2026)).toBe(360000);
    expect(cells(r, "cf.transfer.investment", 2050)).toBe(360000);
    const notices = (r.header as { notices: { code: string; ids: string[] }[] }).notices;
    expect(notices).toContainEqual({ code: "N_ASSUMED", ids: ["account.contributions.afterRetirement", uid("tx")] });
    // 取り崩しの計画が2030年1月からなら、2029年12月まで
    const planned = full(retired((_h, input) => ((input.assumptions as Obj).investment = { drawdown: { start: at("2030-01"), method: "fixed", monthly: 100000 } })));
    expect(cells(planned, "cf.transfer.investment", 2029)).toBe(360000);
    expect(cells(planned, "cf.transfer.investment", 2030)).toBe(0);
    // 退職がこれからの人には知らせを出さない
    expect((full(mk([dep(5000000), tx])).header as { notices: { code: string; ids: string[] }[] }).notices).not.toContainEqual(expect.objectContaining({ ids: ["account.contributions.afterRetirement", uid("tx")] }));
  });

  it("期間を分けた積立（45〜49歳 月3万円 → 50〜54歳 月5万円）は、期間ごとの額で積み立てる", () => {
    const r = full(mk([dep(5000000), nisa({ contributions: [{ from: at("2026-01"), to: at("2030-05"), monthly: 30000 }, { from: at("2030-06"), to: null, monthly: 50000 }] })]));
    expect(cells(r, "cf.transfer.nisa.tsumitate", 2027)).toBe(360000);
    expect(cells(r, "cf.transfer.nisa.tsumitate", 2030)).toBe(30000 * 5 + 50000 * 7);
    expect(cells(r, "cf.transfer.nisa.tsumitate", 2033)).toBe(600000);
    expect(cells(r, "cf.transfer.nisa.tsumitate", 2036)).toBe(0);
  });
});

describe("NISA の枠と、超えた分の扱い（0026）", () => {
  // つみたて投資枠に月15万円（年180万円）: 年120万円を超えた60万円は成長投資枠へ
  const heavy = (o: Obj = {}) => nisa({ contributions: [{ from: at("2026-01"), to: at("2035-12"), monthly: 150000 }], ...o });

  it("つみたて投資枠の年間の枠を超えた分は、成長投資枠の残りに入れる", () => {
    const r = full(mk([dep(30000000), heavy()]));
    expect(cells(r, "cf.transfer.nisa.tsumitate", 2027)).toBe(1200000);
    expect(cells(r, "cf.transfer.nisa.growth", 2027)).toBe(600000);
  });

  it("生涯の枠（1,800万円）を使い切った後の積立は、既定では預金に残し、課税口座で続ける前提なら課税口座へ移す", () => {
    // 年180万円 × 10年 = 1,800万円で、2035年に使い切る。今の取得価額 900万円があるので 2030年に使い切る
    const start = { marketValue: box(9000000), costBasis: box(9000000) };
    const r = full(mk([dep(30000000), heavy(start)]));
    expect(cells(r, "cf.balance.nisaFrame", 2030)).toBe(0);
    expect(cells(r, "cf.transfer.nisa.tsumitate", 2031) + cells(r, "cf.transfer.nisa.growth", 2031)).toBe(0);
    expect(cells(r, "cf.transfer.investment", 2031)).toBe(0);
    const t = full(mk([dep(30000000), heavy(start)], (_h, input) => ((input.assumptions as Obj).investment = { nisaOverflow: "taxable" })));
    expect(cells(t, "cf.transfer.investment", 2031)).toBe(1800000);
    expect(cells(t, "cf.balance.account.taxable", 2031)).toBeGreaterThan(1800000);
    // 2030年は枠の残り 900万円−（2026〜2029年の 720万円）= 180万円のうち、成長投資枠の残りまで
    expect(cells(t, "cf.transfer.nisa.tsumitate", 2030) + cells(t, "cf.transfer.nisa.growth", 2030) + cells(t, "cf.transfer.investment", 2030)).toBe(1800000);
  });
});

describe("iDeCo・企業型DC の受け取り（0026）", () => {
  const ideco = (o: Obj = {}) => ({ id: uid("ideco"), kind: "ideco", owner: A, marketValue: box(5000000), asOf: "2025-12", enrolledSince: "2010-01", contributions: [], ...o });

  it("受け取り方が空なら、退職の年（60歳より前の退職は60歳に達する月）に一時金で受け取る（今までの75歳をやめる）", () => {
    const plan = call<IdecoPayoutPlanOutput>(mk([dep(1000000), ideco()]), "account.idecoPayout", { member: A });
    expect(plan.accounts[0]?.start).toBe("2040-06");
    expect(plan.accounts[0]?.method).toBe("lumpSum");
  });

  it("65歳より後に退職する人は65歳に達する月。受け取り方だけ入れて始まりが空でも退職の年", () => {
    const late = withInput(mk([dep(1000000), ideco({ payout: { method: "annuity", annuityYears: 5 } })]), (h) => ((h.employmentPeriods as Obj[])[0] = period("p", { member: "a", from: "2003-04", to: "2048-12", annual: 8000000, std: [620000, 620000] })));
    const plan = call<IdecoPayoutPlanOutput>(late, "account.idecoPayout", { member: A });
    expect(plan.accounts[0]?.start).toBe("2045-06");
    expect(plan.accounts[0]?.method).toBe("annuity");
  });

  it("受け取ったお金を運用に回すと、受け取った年に NISA の枠の残りへ、超えた分は課税口座へ移す", () => {
    const r = full(mk([dep(1000000), ideco({ payout: { method: "lumpSum", destination: "invest" } })]));
    const paid = cells(r, "cf.income.lumpSum.ideco", 2040);
    expect(paid).toBeGreaterThan(5000000);
    expect(cells(r, "cf.transfer.nisa.tsumitate", 2040)).toBe(1200000);
    expect(cells(r, "cf.transfer.nisa.growth", 2040)).toBe(2400000);
    expect(cells(r, "cf.transfer.investment", 2040)).toBe(paid - 3600000);
    // 預金に入れる（既定）なら移さない
    const d = full(mk([dep(1000000), ideco({ payout: { method: "lumpSum" } })]));
    expect(cells(d, "cf.transfer.nisa.tsumitate", 2040) + cells(d, "cf.transfer.investment", 2040)).toBe(0);
  });
});

describe("入れ方（合計・口座・資産配分）（0026）", () => {
  const pooled = (v: number, monthly: number, rate: string) => ({ id: uid("pool"), kind: "pooled", owner: A, marketValue: box(v), asOf: "2025-12", expectedReturn: rate, contributions: monthly > 0 ? [{ from: at("2026-01"), to: null, monthly }] : [] });
  const tx = (v: number, monthly: number) => ({ id: uid("tx"), kind: "taxable", owner: A, marketValue: box(v), costBasis: box(v), asOf: "2025-12", expectedReturn: "0.04", contributions: monthly > 0 ? [{ from: at("2026-01"), to: null, monthly }] : [] });

  it("合計: 金融資産の器を外し、まとめた金融資産の器だけで計算する（FP が入れた利回り）", () => {
    const req = mk([dep(3000000), tx(2000000, 30000), pooled(10000000, 50000, "0.02")], (_h, input) => ((input.assumptions as Obj).investment = { method: "total" }));
    const r = full(req);
    expect(cells(r, "cf.balance.account.taxable", 2026)).toBe(0);
    expect(cells(r, "cf.transfer.savings.deposit", 2026)).toBe(600000);
    // 1,000万円＋年60万円＋（1,000万円×2% ＋ 年60万円×2%×1/2）
    expect(cells(r, "cf.balance.account.pooled", 2026)).toBe(10000000 + 600000 + 200000 + 6000);
  });

  it("口座: まとめた金融資産の器は「まだ分けていない分」（合計−口座の合計。毎月の積立も月ごとの差）", () => {
    const req = mk([dep(3000000), tx(2000000, 30000), pooled(10000000, 50000, "0.02")]);
    const r = full(req);
    // 残高 1,000万円−500万円、積立 月5万円−月3万円: 500万円＋24万円＋（500万円×2%＋24万円×2%×1/2）
    expect(cells(r, "cf.balance.account.pooled", 2026)).toBe(5000000 + 240000 + 100000 + 2400);
    expect(cells(r, "cf.transfer.savings.deposit", 2026)).toBe(240000);
    // 口座に全部分けると、まとめた器は消える
    const done = full(mk([dep(3000000), tx(7000000, 50000), pooled(10000000, 50000, "0.02")]));
    expect((done.table as unknown as { row: string }[]).some((c) => c.row === "cf.balance.account.pooled")).toBe(false);
  });

  it("資産配分: 運用する器に共通の配分と信託報酬を当て、利回り＝割合で平均した期待リターン−信託報酬（預金は変えない）", () => {
    const req = mk([dep(0), tx(10000000, 0)], (_h, input) => {
      const a = input.assumptions as Obj;
      a.assetReturns = { "equity.global": { default: "0.06" }, "bond.global": { default: "0.01" } };
      a.investment = { method: "allocation", allocation: { mix: [{ assetClass: "equity.global", share: "0.5" }, { assetClass: "bond.global", share: "0.5" }], fee: "0.005" } };
    });
    const r = full(req);
    // (6%×0.5＋1%×0.5)−0.5% = 3%
    expect(cells(r, "cf.balance.account.taxable", 2026)).toBe(10300000);
  });

  it("リバランスしないときは、資産の種類ごとの増え方で割合がずれる（株が増えると利回りも上がる）", () => {
    const mix = [{ assetClass: "equity.global", share: "0.5" }, { assetClass: "bond.global", share: "0.5" }];
    const run = (rebalance: boolean) =>
      full(
        mk([dep(0), tx(10000000, 0)], (_h, input) => {
          const a = input.assumptions as Obj;
          a.assetReturns = { "equity.global": { default: "0.06" }, "bond.global": { default: "0.01" } };
          a.investment = { method: "allocation", allocation: { mix, rebalance } };
        }),
      );
    const on = run(true);
    const off = run(false);
    expect(cells(off, "cf.balance.account.taxable", 2026)).toBe(cells(on, "cf.balance.account.taxable", 2026));
    expect(cells(off, "cf.balance.account.taxable", 2034)).toBeGreaterThan(cells(on, "cf.balance.account.taxable", 2034));
  });
});

describe("取り崩しの計画（0026）", () => {
  it("定額: 始まりの月から毎月の額を使う。その年の収支の不足より多い分を「取り崩して使うお金」として年間収支から引く", () => {
    const req = mk([dep(50000000)], (_h, input) => ((input.assumptions as Obj).investment = { drawdown: { start: at("2040-01"), method: "fixed", monthly: 200000 } }));
    const base = full(mk([dep(50000000)]));
    const r = full(req);
    const shortage = Math.max(0, -cells(base, "cf.net", 2041));
    expect(cells(r, "cf.expense.living.drawdown", 2041)).toBe(Math.max(0, 2400000 - shortage));
    expect(cells(r, "cf.expense.living.drawdown", 2039)).toBe(0);
    expect(cells(r, "cf.balance.financial", 2045)).toBeLessThan(cells(base, "cf.balance.financial", 2045));
  });

  it("定率: 年の初めの金融資産×率を使う", () => {
    const req = mk([dep(50000000)], (_h, input) => ((input.assumptions as Obj).investment = { drawdown: { start: at("2040-01"), method: "rate", rate: "0.04" } }));
    const r = full(req);
    const opening = cells(r, "cf.balance.financial", 2040);
    const base = full(mk([dep(50000000)]));
    const shortage = Math.max(0, -cells(base, "cf.net", 2041));
    // 年の初めの残高は取り崩しの計画で少しずつ変わるので、基準の世帯の不足と前の年末の残高で確かめる
    expect(cells(r, "cf.expense.living.drawdown", 2041)).toBe(Math.max(0, Math.floor(opening * 0.04) - shortage));
  });
});

describe("相場が下がった場合・利回りの書き換え（0026）", () => {
  const mixed = { id: uid("tx"), kind: "taxable", owner: A, marketValue: box(10000000), costBasis: box(10000000), asOf: "2025-12", assetMix: [{ assetClass: "equity.global", share: "0.6" }, { assetClass: "bond.global", share: "0.4" }], contributions: [] };
  const rets = (input: Obj) => ((input.assumptions as Obj).assetReturns = { "equity.global": { default: "0" }, "bond.global": { default: "0" } });

  it("株などが3割下がる（資産クラスを書いた下落）は、配分のうち株の割合だけ下げる。預金は下げない", () => {
    const req = mk([dep(5000000), mixed], (_h, input) => {
      rets(input);
      input.stressTest = { template: "marketDropAtRetirement", params: { year: 2030, drop: "0.3", assetClasses: ["equity.global", "equity.domestic", "reit.domestic", "reit.global"] } };
    });
    const r = full(req);
    // 1,000万円 × 0.3 × 0.6 = 180万円
    expect(cells(r, "cf.balance.account.taxable", 2030)).toBe(8200000);
  });

  it("10年間利回りが低いまま（退職の年から）・ずっと1%低い", () => {
    const tx = { ...mixed, assetMix: undefined, expectedReturn: "0.04" };
    delete (tx as Obj).assetMix;
    const low = full(mk([dep(5000000), tx], (_h, input) => (input.stressTest = { template: "lowReturnPeriod", params: { years: 10, cap: "0.005" } })));
    const base = full(mk([dep(5000000), tx]));
    // 退職の年（2035年）の運用益は 0.5% に抑える。その前は変わらない
    expect(cells(low, "cf.balance.account.taxable", 2034)).toBe(cells(base, "cf.balance.account.taxable", 2034));
    expect(cells(low, "cf.balance.account.taxable", 2035)).toBeLessThan(cells(base, "cf.balance.account.taxable", 2035));
    const short = full(mk([dep(5000000), tx], (_h, input) => (input.stressTest = { template: "returnShortfall", params: { add: "-0.01" } })));
    // 1,000万円 × 3%
    expect(cells(short, "cf.balance.account.taxable", 2026)).toBe(10300000);
    // 預金（運用しない器）には当てない
    expect(cells(short, "cf.balance.account.deposit", 2026)).toBe(cells(base, "cf.balance.account.deposit", 2026));
  });
});

describe("大きな病気（働けない期間の後に戻る）と退職給付（0026）", () => {
  it("休職の後に同じ勤め先に戻るときは、退職給付を休職の月に支給せず、戻った期間の終わりにもとの勤続期間で支給する", async () => {
    const { modelHousehold, realPacks } = await import("./helpers.ts");
    const req = modelHousehold("investmentCouple") as unknown as Req;
    const self = (req.input.household.members as unknown as { id: string; kind: string }[]).find((m) => m.kind === "self")?.id as string;
    (req.input as unknown as Obj).contingencies = [{ id: uid("ill"), kind: "incapacity", member: self, occurs: { at: "2027-01" }, recovery: { at: "2028-01" }, medical: { monthly: 600000, months: 6 } }];
    const r = runEngine(req, realPacks(), {});
    const base = runEngine(modelHousehold("investmentCouple"), realPacks(), {});
    const lump = (x: typeof r, y: number) => (x.table as unknown as { row: string; year: number; amount: number }[]).filter((c) => c.row === "cf.income.lumpSum.retirement" && c.year === y).reduce((s, c) => s + c.amount, 0);
    expect(lump(r, 2027)).toBe(0);
    expect(lump(r, 2041)).toBe(lump(base, 2041));
    expect(lump(r, 2041)).toBeGreaterThan(0);
  });
});

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

  it("預金の利回り（0137）: 預金・外貨預金・資産配分の現金は、資産の種類ごとの利回りに無ければ預金の利回り。省略は運用利回り（前の要求は今までどおり）", () => {
    const fx = { id: uid("fx"), kind: "fxDeposit", owner: A, marketValue: box(1000000), asOf: "2025-12", contributions: [] };
    const req = (deposit?: string, own?: string) =>
      mk([dep(10000000), fx, tx(10000000, 0)], (_h, input) => {
        const a = input.assumptions as Obj;
        a.investmentReturn = { default: "0.03" };
        if (deposit !== undefined) a.depositReturn = { default: deposit };
        if (own !== undefined) a.assetReturns = { "cash.deposit": { default: own } };
      });
    const bal = (r: ReturnType<typeof full>, row: string) => cells(r, row, 2026);
    // 預金の利回りが無い: 預金・外貨預金も運用利回り（3%）
    const old = full(req());
    expect(bal(old, "cf.balance.account.fxDeposit")).toBe(1030000);
    // 預金の利回り 0.1%: 外貨預金は 1,001,000円、課税口座は運用利回りのまま
    const r = full(req("0.001"));
    expect(bal(r, "cf.balance.account.fxDeposit")).toBe(1001000);
    expect(bal(r, "cf.balance.account.taxable")).toBe(bal(old, "cf.balance.account.taxable"));
    expect(bal(r, "cf.balance.financial")).toBeLessThan(bal(old, "cf.balance.financial"));
    // 資産の種類ごとの利回りに預金があれば、そちら（外貨預金は預金の利回りのまま）
    const ownR = full(req("0.001", "0.002"));
    expect(bal(ownR, "cf.balance.account.fxDeposit")).toBe(1001000);
    expect(bal(ownR, "cf.balance.financial")).toBeGreaterThan(bal(r, "cf.balance.financial"));
    // 資産配分の現金（cash.deposit）も預金の利回り
    const alloc = mk([dep(0), tx(10000000, 0)], (_h, input) => {
      const a = input.assumptions as Obj;
      a.investmentReturn = { default: "0.03" };
      a.depositReturn = { default: "0.001" };
      a.assetReturns = { "equity.global": { default: "0.06" } };
      a.investment = { method: "allocation", allocation: { mix: [{ assetClass: "equity.global", share: "0.5" }, { assetClass: "cash.deposit", share: "0.5" }] } };
    });
    // 6%×0.5＋0.1%×0.5 = 3.05%
    expect(cells(full(alloc), "cf.balance.account.taxable", 2026)).toBe(10305000);
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

describe("資産の種類ごとの信託報酬（0252）", () => {
  const tx = (v: number) => ({ id: uid("tx"), kind: "taxable", owner: A, marketValue: box(v), costBasis: box(v), asOf: "2025-12", contributions: [] });
  const returns = { "equity.global": { default: "0.06" }, "equity.emerging": { default: "0.08" }, "bond.domestic": { default: "0.01" } };
  const run = (allocation: Obj, end = 2050) =>
    full(
      mk(
        [dep(0), tx(10000000)],
        (_h, input) => {
          const a = input.assumptions as Obj;
          a.assetReturns = returns;
          a.investment = { method: "allocation", allocation };
        },
        end,
      ),
    );
  const bal = (r: ReturnType<typeof full>, y: number) => cells(r, "cf.balance.account.taxable", y);

  it("割合でならした信託報酬を引く: 先進国株式50%（0.1%）・新興国株式25%（0.2%）・国内債券25%（0.15%）", () => {
    const r = run({ mix: [{ assetClass: "equity.global", share: "0.5" }, { assetClass: "equity.emerging", share: "0.25" }, { assetClass: "bond.domestic", share: "0.25" }], fees: { "equity.global": "0.001", "equity.emerging": "0.002", "bond.domestic": "0.0015" } });
    // 期待リターン 6%×0.5＋8%×0.25＋1%×0.25 = 5.25%、信託報酬 0.1%×0.5＋0.2%×0.25＋0.15%×0.25 = 0.1375% → 5.1125%
    expect(bal(r, 2026)).toBe(10511250);
  });

  it("全部の種類に同じ値を入れた世帯（前の版の「平均」から移した形）は、前の版の fee と1円も違わない（リバランスしない・段階のある配分も）", () => {
    const mix = [{ assetClass: "equity.global", share: "0.3333" }, { assetClass: "equity.emerging", share: "0.3333" }, { assetClass: "bond.domestic", share: "0.3334" }];
    const stages = [{ id: uid("st"), at: at("2040-01"), mix: [{ assetClass: "bond.domestic", share: "0.7" }, { assetClass: "equity.global", share: "0.3" }], rampYears: 3 }];
    for (const rebalance of [true, false]) {
      const old = run({ mix, stages, fee: "0.0025", rebalance });
      const moved = run({ mix, stages, fees: { "equity.global": "0.0025", "equity.emerging": "0.0025", "bond.domestic": "0.0025", "cash.deposit": "0.0025" }, rebalance });
      for (const y of [2026, 2035, 2041, 2050]) expect(bal(moved, y)).toBe(bal(old, y));
    }
  });

  it("口座に残った運用の費用（口座ごとの入れ方で入れた fee）は、種類ごとの信託報酬が同じでも違っても上書きして二重に引かない", () => {
    const withFee = (allocation: Obj) =>
      full(
        mk([dep(0), { ...tx(10000000), fee: "0.01" }], (_h, input) => {
          const a = input.assumptions as Obj;
          a.assetReturns = returns;
          a.investment = { method: "allocation", allocation };
        }, 2026),
      );
    const mix = [{ assetClass: "equity.global", share: "0.5" }, { assetClass: "bond.domestic", share: "0.5" }];
    // 6%×0.5＋1%×0.5 = 3.5%。信託報酬 0.3%・0.1% → 割合でならして 0.2% → 3.3%（口座の費用1%は引かない）
    expect(bal(withFee({ mix, fees: { "equity.global": "0.003", "bond.domestic": "0.001" } }), 2026)).toBe(10330000);
    expect(bal(withFee({ mix, fees: { "equity.global": "0.002", "bond.domestic": "0.002" } }), 2026)).toBe(10330000);
    expect(bal(run({ mix, fees: { "equity.global": "0.003", "bond.domestic": "0.001" } }, 2026), 2026)).toBe(10330000);
    // 種類ごとの信託報酬が1つも無い配分（fees は空）も、口座の費用は使わない
    expect(bal(withFee({ mix, fees: {} }), 2026)).toBe(10350000);
  });

  it("fees に無い種類は fee を使い、どちらも無ければ引かない。段階の配分は、その段の割合でならす", () => {
    const mix = [{ assetClass: "equity.global", share: "0.5" }, { assetClass: "bond.domestic", share: "0.5" }];
    // 先進国株式 0.4%・国内債券は fee の 0.2% → 0.3%
    const withFallback = run({ mix, fees: { "equity.global": "0.004" }, fee: "0.002" }, 2026);
    const flat = run({ mix, fee: "0.003" }, 2026);
    expect(bal(withFallback, 2026)).toBe(bal(flat, 2026));
    // 国内債券の信託報酬が無い（fee も無い）: 先進国株式の 0.4%×0.5 = 0.2% だけ引く
    const none = run({ mix, fees: { "equity.global": "0.004" } }, 2026);
    expect(bal(none, 2026)).toBe(bal(run({ mix, fee: "0.002" }, 2026), 2026));
    // 段階: 2030年から国内債券だけ → 国内債券の信託報酬（0.1%）だけ
    const staged = run({ mix, fees: { "equity.global": "0.004", "bond.domestic": "0.001" }, stages: [{ id: uid("st2"), at: at("2030-01"), mix: [{ assetClass: "bond.domestic", share: "1" }] }] }, 2031);
    const onlyBond = run({ mix: [{ assetClass: "bond.domestic", share: "1" }], fee: "0.001" }, 2031);
    expect(bal(staged, 2031) / bal(staged, 2030)).toBeCloseTo(bal(onlyBond, 2031) / bal(onlyBond, 2030), 6);
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

describe("取り崩しの計画の始まりの年は、始まりの月から年末までの収支の不足と比較する（0026 の追記 2026-11-17）", () => {
  type Out = ReturnType<typeof full>;
  const living = (monthly: number) => ({ id: uid("living"), mode: "total", monthly: box(monthly) });
  /** 本人が払う掛金の行（決済口座から出る） */
  const SELF = new Set(["cf.transfer.ideco.ideco", "cf.transfer.ideco.matching", "cf.transfer.mutualAid"]);
  const sign = (row: string) => (row.startsWith("cf.income.") ? 1 : row.startsWith("cf.taxSi.") || row.startsWith("cf.expense.") ? -1 : 0);
  /** y 年の from（年月）から年末までの、取り崩して使うお金を除いた収支と本人の掛金（お金の動きから数える） */
  const windowOf = (r: Out, y: number, from: string) => {
    let net = 0;
    let self = 0;
    for (const f of r.flows as unknown as { row: string; ym: string; amount: number }[]) {
      if (Number(f.ym.slice(0, 4)) !== y || f.ym < from || f.row === "cf.expense.living.drawdown") continue;
      net += sign(f.row) * f.amount;
      if (SELF.has(f.row)) self += f.amount;
    }
    return { net, self };
  };
  const extraOf = (want: number, w: { net: number; self: number }) => Math.max(0, want - Math.max(0, -(w.net - w.self)));
  const drawdownIn = (r: Out, y: number) => cells(r, "cf.expense.living.drawdown", y);
  /**
   * 1980年6月生まれ。退職（働き方の期間の終わり）・計算基準月・取り崩しの計画を変えられる世帯。生活費は月25万円。
   * 65歳（2045年6月）から公的年金
   */
  const make = (o: { retire: string; start: string; baseMonth?: string; method?: "fixed" | "rate"; monthly?: number; ideco?: number; mutualAid?: number }) =>
    withInput(
      household({
        baseMonth: o.baseMonth ?? "2026-01",
        members: [member("a", "self", "1980-06")],
        periods: [period("p", { member: "a", from: "2003-04", to: o.retire, annual: 8000000, std: [620000, 620000] })],
        accounts: [
          dep(60000000),
          ...(o.ideco !== undefined ? [{ id: uid("ideco"), kind: "ideco", owner: A, marketValue: box(1000000), asOf: "2025-12", enrolledSince: "2010-01", contributions: [{ from: at("2026-01"), to: at(o.retire), monthly: o.ideco }] }] : []),
          ...(o.mutualAid !== undefined ? [{ id: uid("sbm"), kind: "smallBusinessMutualAid", owner: A, marketValue: box(1000000), asOf: "2025-12", contributions: [{ from: at("2026-01"), to: at(o.retire), monthly: o.mutualAid }] }] : []),
        ],
        endYear: 2050,
      }),
      (h, input) => {
        h.livingExpenses = [living(250000)];
        (input.assumptions as Obj).investment = { drawdown: { start: at(o.start), ...(o.method === "rate" ? { method: "rate", rate: "0.04" } : { method: "fixed", monthly: o.monthly ?? 300000 }) } };
      },
    );
  const monthsFrom = (start: string) => 13 - Number(start.slice(5, 7));

  it("年の途中から（退職の翌月から）: 始まりの月より前の給与の黒字で不足を打ち消さない。始まりの年の取り崩しは前より少なく、次の年はまる1年で今までどおり", () => {
    const r = full(make({ retire: "2036-06", start: "2036-07" }));
    const after = windowOf(r, 2036, "2036-07");
    const whole = windowOf(r, 2036, "2036-01");
    // 始まりの月より前は黒字、後は不足の年
    expect(whole.net - after.net).toBeGreaterThan(0);
    expect(after.net).toBeLessThan(0);
    const want = 300000 * 6;
    expect(drawdownIn(r, 2036)).toBe(extraOf(want, after));
    // 前の比較のしかた（まる1年の不足）より少ない
    expect(drawdownIn(r, 2036)).toBeLessThan(extraOf(want, whole));
    // 次の年はまる1年の不足と比較する
    expect(drawdownIn(r, 2037)).toBe(extraOf(300000 * 12, windowOf(r, 2037, "2037-01")));
    // 始まりの前の年は取り崩さない
    expect(drawdownIn(r, 2035)).toBe(0);
  });

  it("始まりが1月なら、まる1年の不足と比較する（今までどおり）", () => {
    const r = full(make({ retire: "2035-12", start: "2036-01" }));
    expect(drawdownIn(r, 2036)).toBe(extraOf(300000 * 12, windowOf(r, 2036, "2036-01")));
  });

  it("始まりが12月なら、12月の1か月の額と12月の収支の不足を比較する", () => {
    const r = full(make({ retire: "2036-06", start: "2036-12" }));
    expect(drawdownIn(r, 2036)).toBe(extraOf(300000, windowOf(r, 2036, "2036-12")));
    expect(drawdownIn(r, 2037)).toBe(extraOf(300000 * 12, windowOf(r, 2037, "2037-01")));
  });

  it("定率も同じ: 年の初めの金融資産×率×月数/12 と、始まりの月から年末までの不足と比較する", () => {
    const r = full(make({ retire: "2036-06", start: "2036-07", method: "rate" }));
    const opening = cells(r, "cf.balance.financial", 2035);
    const want = Math.floor((Math.floor(opening * 0.04) * 6) / 12);
    const after = windowOf(r, 2036, "2036-07");
    expect(drawdownIn(r, 2036)).toBe(extraOf(want, after));
    expect(drawdownIn(r, 2036)).toBeLessThan(extraOf(want, windowOf(r, 2036, "2036-01")));
  });

  it("始まりの月から後も黒字の年（まだ働いている年）は、不足が無いので計画の額をそのまま使う", () => {
    const r = full(make({ retire: "2040-12", start: "2036-07" }));
    const after = windowOf(r, 2036, "2036-07");
    expect(after.net).toBeGreaterThan(0);
    expect(drawdownIn(r, 2036)).toBe(300000 * 6);
  });

  it("本人の iDeCo の掛金も、始まりの月より前の分を除く", () => {
    const r = full(make({ retire: "2036-06", start: "2036-07", ideco: 20000 }));
    const after = windowOf(r, 2036, "2036-07");
    const whole = windowOf(r, 2036, "2036-01");
    expect(whole.self).toBeGreaterThan(0);
    expect(after.self).toBe(0);
    expect(drawdownIn(r, 2036)).toBe(extraOf(300000 * 6, after));
  });

  it("小規模企業共済の掛金も、始まりの月より前の分を除く", () => {
    const r = full(make({ retire: "2036-06", start: "2036-07", mutualAid: 30000 }));
    const after = windowOf(r, 2036, "2036-07");
    expect(windowOf(r, 2036, "2036-01").self).toBe(30000 * 6);
    expect(after.self).toBe(0);
    expect(drawdownIn(r, 2036)).toBe(extraOf(300000 * 6, after));
  });

  it("公的年金を受け取り始める年（65歳の6月から）に始めるときも、始まりの月から年末までで比較する", () => {
    for (const start of ["2045-03", "2045-06", "2045-09"]) {
      const r = full(make({ retire: "2040-12", start }));
      expect(drawdownIn(r, 2045)).toBe(extraOf(300000 * monthsFrom(start), windowOf(r, 2045, start)));
      expect(drawdownIn(r, 2046)).toBe(extraOf(300000 * 12, windowOf(r, 2046, "2046-01")));
    }
  });

  it("計算基準月が1〜3月の世帯: 始まりが計算基準年の途中なら計算基準月からではなく始まりの月から、計算基準月以前なら計算基準月から年末まで", () => {
    for (const baseMonth of ["2026-01", "2026-02", "2026-03"]) {
      // 退職の後の年は住民税などで不足が大きいので、毎月の額を大きくして比較する
      const mid = full(make({ baseMonth, retire: "2026-05", start: "2026-06", monthly: 800000 }));
      const after = windowOf(mid, 2026, "2026-06");
      expect(after.net).toBeLessThan(0);
      expect(drawdownIn(mid, 2026)).toBe(extraOf(800000 * 7, after));
      expect(drawdownIn(mid, 2026)).toBeGreaterThan(0);
      expect(drawdownIn(mid, 2026)).toBeLessThan(extraOf(800000 * 7, windowOf(mid, 2026, baseMonth)));
      // 始まりが計算基準月より前（もう始めている）: 計算基準月から年末まで（その年の表の全部）で比較する
      const early = full(make({ baseMonth, retire: "2025-12", start: "2025-10" }));
      expect(drawdownIn(early, 2026)).toBe(extraOf(300000 * monthsFrom(baseMonth), windowOf(early, 2026, baseMonth)));
      // 始まりが計算基準月と同じ
      const same = full(make({ baseMonth, retire: "2025-12", start: baseMonth }));
      expect(drawdownIn(same, 2026)).toBe(extraOf(300000 * monthsFrom(baseMonth), windowOf(same, 2026, baseMonth)));
    }
  });

  it("プランで始まりを変えても、それぞれの始まりの年は始まりの月から、それより後の年はまる1年で比較する", () => {
    for (const start of ["2036-04", "2036-10", "2037-02"]) {
      const r = full(make({ retire: "2036-06", start }));
      const y = Number(start.slice(0, 4));
      expect(drawdownIn(r, y)).toBe(extraOf(300000 * monthsFrom(start), windowOf(r, y, start)));
      expect(drawdownIn(r, y + 1)).toBe(extraOf(300000 * 12, windowOf(r, y + 1, `${y + 1}-01`)));
    }
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

  it("割合の合計が100%でなくても、合計で割って按分する（利回り・下落の割合とも。1行だけならその資産クラスが100%。0177）", () => {
    const withMix = (mix: Obj[], drop = false) =>
      full(
        mk([dep(5000000), { ...mixed, assetMix: mix }], (_h, input) => {
          (input.assumptions as Obj).assetReturns = { "equity.global": { default: "0.05" }, "bond.global": { default: "0.01" } };
          if (drop) input.stressTest = { template: "marketDropAtRetirement", params: { year: 2030, drop: "0.3", assetClasses: ["equity.global"] } };
        }),
      );
    const bal = (r: ReturnType<typeof full>) => cells(r, "cf.balance.account.taxable", 2040);
    const eq = (s: string) => ({ assetClass: "equity.global", share: s });
    const bd = (s: string) => ({ assetClass: "bond.global", share: s });
    // 合計120%（90%・30%）は 75%・25% と同じ
    expect(bal(withMix([eq("0.9"), bd("0.3")]))).toBe(bal(withMix([eq("0.75"), bd("0.25")])));
    // 合計50%（40%・10%）は 80%・20% と同じ
    expect(bal(withMix([eq("0.4"), bd("0.1")]))).toBe(bal(withMix([eq("0.8"), bd("0.2")])));
    // 1行だけ50%は100%と同じ。0%の行を足しても同じ
    expect(bal(withMix([eq("0.5")]))).toBe(bal(withMix([eq("1")])));
    expect(bal(withMix([eq("0.5"), bd("0")]))).toBe(bal(withMix([eq("1")])));
    // 合計0%は資産の配分が無いのと同じ（運用利回り）
    const none = { ...mixed } as Obj;
    delete none.assetMix;
    expect(bal(withMix([eq("0"), bd("0")]))).toBe(bal(full(mk([dep(5000000), none], (_h, input) => ((input.assumptions as Obj).assetReturns = { "equity.global": { default: "0.05" }, "bond.global": { default: "0.01" } })))));
    // 下落の割合も按分（1行50%の株は、株100%と同じだけ下がる）
    expect(cells(withMix([eq("0.5")], true), "cf.balance.account.taxable", 2030)).toBe(cells(withMix([eq("1")], true), "cf.balance.account.taxable", 2030));
    expect(cells(withMix([eq("0.9"), bd("0.3")], true), "cf.balance.account.taxable", 2030)).toBe(cells(withMix([eq("0.75"), bd("0.25")], true), "cf.balance.account.taxable", 2030));
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

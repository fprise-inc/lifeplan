// 収益不動産の税と出口（0081）のテスト（L1）: 売ったときの譲渡所得（長期と短期の境目・概算取得費・償却の累計・税額と払う月・住民税の年のずれ・
// 合計所得金額と国民健康保険料の基）、売るときにローンを返す、青色申告特別控除（事業的規模の目安と知らせ・引く順と上限）、純損失の繰り越し（3年）、
// 民泊・宿の所得の区分（雑所得の赤字は通算しない・事業所得の赤字は通算する）、新しい欄を入れていない世帯の結果が変わらないこと。
// 手計算は別に書き、エンジンの結果と突き合わせる（製品の制度データ）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { DebtScheduleOutput, LossCarryforwardOutput, RealEstateOutput, RealEstateSaleTaxOutput, TotalIncomeOutput } from "../src/sdk/contracts.ts";
import { box, household, member, modelHousehold, period, realPacks, uid, clone } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const packs = realPacks();
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, packs, { checkInternal: true, entry: { component, input } }).entryOutput as T;
const full = (req: Req) => runEngine(req, packs, { checkInternal: true });
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const has = (r: { header: unknown }, code: string, id: string) => notices(r).some((n) => n.code === code && n.ids.includes(id));
type Flow = { row: string; ym: string; amount: number; member?: string; object?: string; formula?: string };
const flows = (r: ReturnType<typeof full>) => r.flows as unknown as Flow[];
type Cell = { row: string; year: number; amount: number };
const cells = (r: ReturnType<typeof full>, row: string, year: number) => (r.table as unknown as Cell[]).filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year).reduce((s, c) => s + c.amount, 0);

const A = uid("a");
const P = uid("prop");
const L = uid("propLoan");
const at = (ym: string) => ({ at: ym });

/** マンション1室（鉄筋コンクリート・2015年築・2020年4月に2,500万円で取得・土地4割・家賃10万円） */
const property = (o: Obj = {}): Obj => ({
  structure: "rc",
  builtYear: 2015,
  landShare: "0.4",
  acquisition: { price: 25000000, at: "2020-04" },
  rental: { monthly: box(100000) },
  expenses: { annual: box(240000) },
  ...o,
});
const account = (p: Obj = property(), id = P): Obj => ({ id, kind: "realEstate", owner: A, marketValue: box(30000000), asOf: "2026-09", valueGrowth: "0", contributions: [], property: p });
const loan = (o: Obj = {}): Obj => ({
  id: L,
  kind: "other",
  property: P,
  debtors: [{ member: A, role: "primary" }],
  principal: 20000000,
  start: at("2020-04"),
  rateSchedule: [{ from: at("2020-04"), type: "fixed", rate: "0.01" }],
  repayment: { method: "equalPayment", termMonths: 300 },
  ...o,
});
/** 給与600万円の会社員（製品の制度データは2025年分からなので、計算基準月を10月にする） */
const base = (o: { accounts?: Obj[]; debts?: Obj[]; taxReturn?: Obj; selfEmployed?: number; endYear?: number } = {}): Req => {
  const req = household({
    baseMonth: "2026-10",
    endYear: o.endYear ?? 2036,
    members: [member("a", "self", "1980-01", o.taxReturn !== undefined ? { taxReturn: o.taxReturn } : {})],
    periods:
      o.selfEmployed !== undefined
        ? [{ id: uid("biz"), member: A, from: at("2010-04"), to: null, type: "selfEmployed", business: { income: box(o.selfEmployed) } }]
        : [period("job", { member: "a", from: "2005-04", annual: 6000000, std: [500000, 500000] })],
    accounts: [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(10000000), asOf: "2026-09", contributions: [] }, ...(o.accounts ?? [account()])],
  });
  if (o.debts !== undefined) (req.input.household as unknown as Obj).debts = o.debts;
  return req;
};
const prop = (req: Req) => call<RealEstateOutput>(req, "asset.realEstate", {}).properties[0];
const saleTax = (req: Req) => call<RealEstateSaleTaxOutput>(req, "tax.realEstateSale", {}).byMember;
const total = (req: Req, year: number) => call<TotalIncomeOutput>(req, "tax.totalIncome", { member: A, year });
const floor = (v: number, unit: number) => Math.floor(v / unit) * unit;

describe("売ったときの譲渡所得（分離課税）", () => {
  it("取得費は取得価額−建物の償却の累計、長期の税率（所得税15%＋復興特別所得税・防衛特別所得税、住民税5%）。所得税は翌年3月、住民税は翌年度の4回", () => {
    const req = base({ accounts: [account(property({ sale: { at: at("2027-06"), price: 40000000, costRate: "0.04" } }))] });
    const s = prop(req)?.sale;
    // 建物 1,500万円・償却率 0.024（中古の簡便法 47−5＋1＝43年）。2020年4月〜2027年5月に貸していた分の償却
    const dep = 15000000 * 0.024;
    const accumulated = (dep * 9) / 12 + dep * 6 + (dep * 5) / 12;
    expect(s?.acquisitionCost).toBe(25000000 - accumulated);
    expect(s?.estimated).toBe(false);
    expect(s?.term).toBe("long");
    const gain = 40000000 - (25000000 - accumulated) - 1600000;
    expect(s?.gain).toBe(gain);
    // 2027年分: 所得税15%、復興特別所得税1.1%・防衛特別所得税1%（基準所得税額に掛ける）、100円未満の切り捨て
    const it = Math.floor(floor(gain, 1000) * 0.15);
    const incomeTax = floor(it + Math.floor(it * 0.011) + Math.floor(it * 0.01), 100);
    const residentTax = floor(floor(gain, 1000) * 0.05, 100);
    expect(saleTax(req)).toEqual([{ member: A, year: 2027, short: 0, long: gain, incomeTax, residentTax }]);
    const r = full(req);
    const it0 = flows(r).filter((f) => f.row === "cf.taxSi.incomeTax.realEstateSale");
    expect(it0).toEqual([expect.objectContaining({ ym: "2028-03", amount: incomeTax, member: A })]);
    const rt = flows(r).filter((f) => f.row === "cf.taxSi.residentTax.realEstateSale");
    expect(rt.map((f) => f.ym)).toEqual(["2028-06", "2028-08", "2028-10", "2029-01"]);
    expect(rt.reduce((a, f) => a + f.amount, 0)).toBe(residentTax);
    // 2回目以後は1,000円単位（端数は最初の納期）
    expect(rt.slice(1).every((f) => f.amount % 1000 === 0)).toBe(true);
    // 今までの「税は計算していない」の知らせは出ない。簡略にしたところの知らせは出す
    expect(notices(r).some((n) => n.ids.includes("realEstate.saleTax"))).toBe(false);
    expect(has(r, "N_ASSUMED", "realEstate.saleTaxSimplified")).toBe(true);
  });

  it("長期と短期の境目: 売った年の1月1日に所有期間が5年を超えれば長期（取得の年が売った年の6年前以前）", () => {
    const term = (acq: string, sale: string) => prop(base({ accounts: [account(property({ acquisition: { price: 25000000, at: acq }, rental: { monthly: box(100000), from: at(acq) }, sale: { at: at(sale), price: 40000000 } }))] }))?.sale?.term;
    expect(term("2021-12", "2027-01")).toBe("long");
    expect(term("2022-01", "2027-12")).toBe("short");
    expect(term("2022-01", "2028-01")).toBe("long");
  });

  it("短期は所得税30%・住民税9%。短期と長期の損益は差し引き、引ききれない損失はほかの所得と通算しない", () => {
    const Q = uid("prop2");
    const shortGain = account(property({ acquisition: { price: 25000000, at: "2024-04" }, rental: { monthly: box(100000), from: at("2024-04") }, sale: { at: at("2027-06"), price: 40000000 } }));
    const req = base({ accounts: [shortGain] });
    const st = saleTax(req)[0];
    const g = prop(req)?.sale?.gain ?? 0;
    expect(prop(req)?.sale?.term).toBe("short");
    const it = Math.floor(floor(g, 1000) * 0.3);
    expect(st).toEqual({ member: A, year: 2027, short: g, long: 0, incomeTax: floor(it + Math.floor(it * 0.011) + Math.floor(it * 0.01), 100), residentTax: floor(floor(g, 1000) * 0.09, 100) });
    // 長期の物件を損失で売る（同じ年）: 短期の益から引く
    const longLoss = account(property({ sale: { at: at("2027-09"), price: 5000000 } }), Q);
    const both = base({ accounts: [shortGain, longLoss] });
    const loss = call<RealEstateOutput>(both, "asset.realEstate", {}).properties.find((p) => p.object === Q)?.sale?.gain ?? 0;
    expect(loss).toBeLessThan(0);
    expect(saleTax(both)[0]?.short).toBe(Math.max(0, g + loss));
    // 損失だけの年: 税は0で、合計所得金額（給与）は変わらない
    const onlyLoss = base({ accounts: [longLoss] });
    expect(saleTax(onlyLoss)[0]).toMatchObject({ short: 0, long: 0, incomeTax: 0, residentTax: 0 });
    const tl = total(onlyLoss, 2027);
    expect(tl.total).toBe(tl.employment + (tl.realEstate ?? 0));
    expect(tl.separate).toBeUndefined();
    expect(tl.landBuilding).toBeUndefined();
  });

  it("取得の入力が無ければ概算取得費（売却価格の5%）で、長期とみなして知らせる。取得時の諸費用は取得費に入る", () => {
    const req = base({ accounts: [account(property({ acquisition: undefined, sale: { at: at("2027-06"), price: 40000000 } }))] });
    const s = prop(req)?.sale;
    expect(s).toMatchObject({ acquisitionCost: 2000000, estimated: true, term: "long", gain: 40000000 - 2000000 - 1600000 });
    const r = full(req);
    expect(has(r, "N_ASSUMED", "realEstate.saleEstimatedCost")).toBe(true);
    expect(has(r, "N_ASSUMED", "realEstate.saleHoldingLong")).toBe(true);
    // 諸費用 100万円（建物の分は償却の基に足し、土地の分は償却しない）
    const withCosts = base({ accounts: [account(property({ acquisition: { price: 25000000, at: "2020-04", costs: 1000000 }, sale: { at: at("2027-06"), price: 40000000 } }))] });
    const plain = base({ accounts: [account(property({ sale: { at: at("2027-06"), price: 40000000 } }))] });
    const buildingCost = 15000000 + 600000;
    const dep = Math.floor(buildingCost * 0.024);
    const accumulated = Math.floor((dep * 9) / 12) + dep * 6 + Math.floor((dep * 5) / 12);
    expect(prop(withCosts)?.sale?.acquisitionCost).toBe(26000000 - accumulated);
    expect((prop(withCosts)?.sale?.acquisitionCost ?? 0) - (prop(plain)?.sale?.acquisitionCost ?? 0)).toBeGreaterThan(0);
  });

  it("貸していない期間が長いと、非業務用の期間の償却を引いていないと知らせる", () => {
    const req = base({ accounts: [account(property({ rental: { monthly: box(100000), from: at("2023-04") }, sale: { at: at("2027-06") } }))] });
    expect(has(full(req), "N_NOT_SUPPORTED", "realEstate.saleNonBusinessPeriod")).toBe(true);
    const ok = base({ accounts: [account(property({ sale: { at: at("2027-06") } }))] });
    expect(has(full(ok), "N_NOT_SUPPORTED", "realEstate.saleNonBusinessPeriod")).toBe(false);
  });

  it("合計所得金額には特別控除前の譲渡所得が入り（separate）、総所得金額（total）には入らない。国民健康保険料の所得割の基にも入る", () => {
    const sale = account(property({ sale: { at: at("2027-06"), price: 40000000 } }));
    const req = base({ accounts: [sale] });
    const none = base({ accounts: [account()] });
    const t = total(req, 2027);
    expect(t.landBuilding).toEqual({ short: 0, long: prop(req)?.sale?.gain });
    expect(t.separate).toBe(prop(req)?.sale?.gain);
    // 2027年の不動産所得は売る前の月まで（家賃・償却が減る分だけ total が違う）
    expect(t.total).toBe((total(none, 2027).total as number) - ((prop(none)?.income.find((x) => x.year === 2027)?.income ?? 0) - (prop(req)?.income.find((x) => x.year === 2027)?.income ?? 0)));
    // 国民健康保険（自営）: 売った翌年度（2028年度）の保険料が上がる
    const nh = (accounts: Obj[]) => {
      const r = base({ accounts, selfEmployed: 3000000 });
      const part = (x: string) => ({ incomeRate: box(x), perCapita: box(40000), perHousehold: box(20000) });
      (r.input.household as unknown as Obj).premiumRates = [{ id: uid("pr"), kind: "nationalHealth", parts: { medical: part("0.07"), elderlySupport: part("0.02"), care: part("0.02") } }];
      return full(r);
    };
    const h0 = nh([account()]);
    const h1 = nh([sale]);
    const health = (r: ReturnType<typeof full>, y: number) => cells(r, "cf.taxSi.health", y) + cells(r, "cf.taxSi.care", y);
    expect(health(h1, 2029) - health(h0, 2029)).toBeGreaterThan(0);
    // 売った年度（2027年度）は前の年の所得なので変わらない
    expect(health(h1, 2027)).toBe(health(h0, 2027));
  });
});

describe("売るときにローンを返す", () => {
  it("既定（返す）: 売る月の返済の後に残りを一括で返し、その後の返済・利息は無い。返さないなら予定のまま", () => {
    const req = base({ accounts: [account(property({ sale: { at: at("2030-06") } }))], debts: [loan()] });
    const sched = call<DebtScheduleOutput>(req, "debt.schedule", { object: L });
    const payoff = sched.flows.filter((f) => f.formula === "debt.schedule.salePayoff");
    expect(payoff).toHaveLength(1);
    expect(payoff[0]).toMatchObject({ ym: "2030-06", row: "cf.expense.debt.other" });
    expect(payoff[0]?.amount).toBeGreaterThan(10000000);
    expect(sched.payoff).toBe("2030-06");
    expect(sched.flows.some((f) => f.ym > "2030-06")).toBe(false);
    expect(sched.yearEnd.find((x) => x.year === 2030)?.balance).toBe(0);
    // 返さない: 返済は予定のまま続く
    const keep = base({ accounts: [account(property({ sale: { at: at("2030-06"), repayLoan: false } }))], debts: [loan()] });
    const s2 = call<DebtScheduleOutput>(keep, "debt.schedule", { object: L });
    expect(s2.flows.some((f) => f.formula === "debt.schedule.salePayoff")).toBe(false);
    expect(s2.yearEnd.find((x) => x.year === 2030)?.balance).toBeGreaterThan(0);
    // 一括で返した額＝返さないときの、その月の返済の後の残高
    const before = (r: Req) => {
      const x = call<DebtScheduleOutput>(r, "debt.schedule", { object: L });
      return x.flows.filter((f) => f.ym <= "2030-06").reduce((a, f) => a + f.amount, 0);
    };
    expect(before(req) - before(keep)).toBe(payoff[0]?.amount);
    // キャッシュフロー表: 売った年の支出に一括で返した額が入る
    expect(cells(full(req), "cf.expense.debt.other", 2030) - cells(full(keep), "cf.expense.debt.other", 2030)).toBeGreaterThan(10000000);
  });
});

describe("青色申告特別控除", () => {
  it("事業的規模でないのに55万円・65万円を選んだら、10万円で計算して知らせる。事業的規模（10室）なら選んだ額", () => {
    const condo = account(property({ kind: "condo", rental: { monthly: box(150000) } }));
    const white = base({ accounts: [condo] });
    const blue = base({ accounts: [condo], taxReturn: { method: "blue", blueDeduction: "doubleEntry" } });
    const reW = total(white, 2027).realEstate ?? 0;
    expect(reW).toBeGreaterThan(100000);
    expect(total(blue, 2027).blueDeduction).toBe(100000);
    expect(total(blue, 2027).realEstate).toBe(reW - 100000);
    expect(total(white, 2027).total - total(blue, 2027).total).toBe(100000);
    expect(has(full(blue), "N_LIMIT_APPLIED", "taxReturn.blueDeduction")).toBe(true);
    // 一棟アパート10戸（事業的規模の目安に当たる）: 55万円。個人事業税は計算しないと知らせる
    const apt = account(property({ kind: "apartment", units: 10, rental: { monthly: box(600000) } }));
    const big = base({ accounts: [apt], taxReturn: { method: "blue", blueDeduction: "doubleEntry" } });
    expect(prop(big)?.units).toEqual({ rooms: 10, houses: 0 });
    expect(total(big, 2027).blueDeduction).toBe(550000);
    expect(has(full(big), "N_LIMIT_APPLIED", "taxReturn.blueDeduction")).toBe(false);
    expect(has(full(big), "N_NOT_SUPPORTED", "realEstate.businessTax")).toBe(true);
    // 戸建て5棟（1棟を2室として10）でも当たる
    const houses = [0, 1, 2, 3, 4].map((i) => account(property({ kind: "house", rental: { monthly: box(100000) } }), uid(`h${i}`)));
    expect(total(base({ accounts: houses, taxReturn: { method: "blue", blueDeduction: "electronic" } }), 2027).blueDeduction).toBe(650000);
    // 省略は10万円
    expect(total(base({ accounts: [apt], taxReturn: { method: "blue" } }), 2027).blueDeduction).toBe(100000);
  });

  it("上限は不動産所得と事業所得の黒字の合計で、不動産所得から先に引く。事業所得があれば不動産所得が事業的規模でなくても55万円", () => {
    // 不動産所得が小さい（20万円ほど）自営の人: 55万円のうち不動産所得の分を引き、残りを事業所得から引く
    const small = account(property({ kind: "condo", rental: { monthly: box(70000) } }));
    const w = base({ accounts: [small], selfEmployed: 3000000 });
    const b = base({ accounts: [small], selfEmployed: 3000000, taxReturn: { method: "blue", blueDeduction: "doubleEntry" } });
    const re = total(w, 2027).realEstate ?? 0;
    expect(re).toBeGreaterThan(0);
    expect(re).toBeLessThan(550000);
    const tb = total(b, 2027);
    expect(tb.blueDeduction).toBe(550000);
    expect(tb.realEstate).toBe(0);
    expect(tb.other).toBe((total(w, 2027).other ?? 0) - (550000 - re));
    expect(has(full(b), "N_LIMIT_APPLIED", "taxReturn.blueDeduction")).toBe(false);
    // 不動産所得が損失なら、事業所得からだけ引く（上限は黒字の所得の合計）
    const lossy = account(property({ kind: "condo", rental: { monthly: box(20000) } }));
    const tl = total(base({ accounts: [lossy], selfEmployed: 300000, taxReturn: { method: "blue", blueDeduction: "doubleEntry" } }), 2027);
    expect(tl.blueDeduction).toBe(300000);
    expect(tl.other).toBe(0);
  });
});

describe("純損失の繰り越し（青色申告・3年）", () => {
  // 2027年に大きな修繕（全額をその年の経費）で大きな損失。給与600万円
  const lossReq = (taxReturn?: Obj) => base({ accounts: [account(property({ repairs: [{ id: uid("rp"), at: at("2027-03"), amount: 40000000 }] }))], ...(taxReturn !== undefined ? { taxReturn } : {}) });
  it("損益通算をしても引ききれない損失を翌年から3年、古い順に総所得金額から引く。4年目には引かない。白色は捨てる", () => {
    const blue = lossReq({ method: "blue" });
    const white = lossReq();
    const t27 = total(blue, 2027);
    expect(t27.total).toBe(0);
    const netLoss = t27.netLoss ?? 0;
    expect(netLoss).toBeGreaterThan(30000000);
    const cf = call<LossCarryforwardOutput>(blue, "tax.lossCarryforward", { member: A }).byYear;
    const row = (y: number) => cf.find((x) => x.year === y);
    expect(row(2027)).toMatchObject({ netLoss, deducted: 0, remaining: netLoss });
    let left = netLoss;
    for (const y of [2028, 2029, 2030]) {
      const d = Math.min(left, total(blue, y).total);
      expect(row(y)?.deducted).toBe(d);
      left -= d;
    }
    expect(left).toBeGreaterThan(0);
    // 4年目（2031年）は引かない
    expect(row(2031)?.deducted ?? 0).toBe(0);
    // 合計所得金額は繰越控除の前のまま
    const t28 = total(blue, 2028);
    expect(t28.total).toBe(t28.employment + (t28.realEstate ?? 0));
    // 白色は繰り越さない
    expect(call<LossCarryforwardOutput>(white, "tax.lossCarryforward", { member: A }).byYear).toEqual([]);
    // 所得税（2028〜2030年は0）と住民税（2029〜2031年度の所得割は0）が下がる。2031年からは損失の無い青色の人と同じに戻る
    const noLoss = base({ taxReturn: { method: "blue" } });
    const it = (r: Req, y: number) => call<{ total: number }>(r, "incomeTax.annual", { member: A, year: y }).total;
    expect(it(blue, 2028)).toBe(0);
    expect(it(white, 2028)).toBeGreaterThan(0);
    expect(it(blue, 2031)).toBe(it(noLoss, 2031));
    const rt = (r: Req, fy: number) => call<{ incomeLevy: { municipal: number; prefectural: number } }>(r, "residentTax.annual", { member: A, fiscalYear: fy }).incomeLevy;
    expect(rt(blue, 2029)).toEqual({ municipal: 0, prefectural: 0 });
    expect(rt(white, 2029).municipal).toBeGreaterThan(0);
    expect(rt(blue, 2032)).toEqual(rt(noLoss, 2032));
  });

  it("国民健康保険料の所得割の基からも引く（自営）", () => {
    const nh = (taxReturn?: Obj) => {
      const r = base({ accounts: [account(property({ repairs: [{ id: uid("rp"), at: at("2027-03"), amount: 20000000 }] }))], selfEmployed: 3000000, ...(taxReturn !== undefined ? { taxReturn } : {}) });
      const part = (x: string) => ({ incomeRate: box(x), perCapita: box(40000), perHousehold: box(20000) });
      (r.input.household as unknown as Obj).premiumRates = [{ id: uid("pr"), kind: "nationalHealth", parts: { medical: part("0.07"), elderlySupport: part("0.02"), care: part("0.02") } }];
      return full(r);
    };
    const health = (r: ReturnType<typeof full>, y: number) => cells(r, "cf.taxSi.health", y) + cells(r, "cf.taxSi.care", y);
    // 2029年（2028年度の後半〜2029年度の前半）: 青色は2028年の所得から繰り越した損失を引くので下がる
    expect(health(nh({ method: "blue" }), 2029)).toBeLessThan(health(nh(), 2029));
  });
});

describe("民泊・宿の所得の区分", () => {
  const lodgingProp = (business: string, extra: Obj = {}) =>
    account(property({ kind: "lodging", lodging: { business, ...extra }, rental: { monthly: box(100000) }, expenses: { annual: box(3600000) } }));
  it("住宅宿泊事業・特区民泊は雑所得（赤字はほかの所得と通算しない）、旅館業は事業所得（赤字は通算する）。営業の形より入れた区分を使う", () => {
    const none = base({ accounts: [] });
    const misc = base({ accounts: [lodgingProp("privateLodging")] });
    expect(prop(misc)?.incomeKind).toBe("miscellaneous");
    const inc = prop(misc)?.income.find((x) => x.year === 2027)?.income ?? 0;
    expect(inc).toBeLessThan(0);
    const tm = total(misc, 2027);
    expect(tm.lodging).toEqual({ miscellaneous: inc, business: 0 });
    expect(tm.realEstate).toBeUndefined();
    expect(tm.total).toBe(total(none, 2027).total);
    expect(prop(base({ accounts: [lodgingProp("specialZone")] }))?.incomeKind).toBe("miscellaneous");
    // 旅館業: 事業所得の赤字は給与所得から引く
    const inn = base({ accounts: [lodgingProp("inn")] });
    expect(prop(inn)?.incomeKind).toBe("business");
    expect(total(inn, 2027).total).toBe((total(none, 2027).total as number) + inc);
    expect(has(full(inn), "N_NOT_SUPPORTED", "realEstate.businessTax")).toBe(true);
    // 入れた区分（不動産所得）を使う
    const asRent = base({ accounts: [lodgingProp("privateLodging", { incomeKind: "realEstate" })] });
    expect(prop(asRent)?.incomeKind).toBeUndefined();
    expect(total(asRent, 2027).realEstate).toBe(inc);
    // 今までの「不動産所得として計算」の知らせは出さない
    expect(notices(full(misc)).some((n) => n.ids.includes("realEstate.lodgingIncome"))).toBe(false);
  });

  it("雑所得の黒字は雑所得に入り、事業所得の黒字には青色申告特別控除（事業所得なので55万円）が引ける", () => {
    const good = (business: string, taxReturn?: Obj) => base({ accounts: [account(property({ kind: "lodging", lodging: { business }, rental: { monthly: box(400000) }, expenses: { annual: box(600000) } }))], ...(taxReturn !== undefined ? { taxReturn } : {}) });
    const m = good("privateLodging");
    const inc = prop(m)?.income.find((x) => x.year === 2027)?.income ?? 0;
    expect(inc).toBeGreaterThan(550000);
    expect(total(m, 2027).miscellaneous).toBe(inc);
    const b = total(good("inn", { method: "blue", blueDeduction: "doubleEntry" }), 2027);
    expect(b.blueDeduction).toBe(550000);
    expect(b.other).toBe(inc - 550000);
    // 雑所得には青色申告特別控除は無い
    expect(total(good("privateLodging", { method: "blue", blueDeduction: "doubleEntry" }), 2027).blueDeduction).toBeUndefined();
  });
});

describe("新しい欄を入れていない世帯", () => {
  it("売却の予定・民泊・宿・青色申告の無い世帯は、税の行が増えず、白色を明示しても結果は同じ", () => {
    const req = base({ debts: [loan()] });
    const r = full(req);
    expect(flows(r).some((f) => f.row.endsWith(".realEstateSale"))).toBe(false);
    const white = clone(req);
    ((white.input.household as unknown as { members: Obj[] }).members[0] as Obj).taxReturn = { method: "white" };
    expect(full(white).table).toEqual(r.table);
    // 見本の世帯（収益不動産あり）も、白色を明示しても同じ
    const m = modelHousehold("dualAssetsTwoKids");
    const m2 = clone(m);
    for (const x of (m2.input.household as unknown as { members: Obj[] }).members) x.taxReturn = { method: "white" };
    expect(full(m2 as never).table).toEqual(full(m as never).table);
  });
});

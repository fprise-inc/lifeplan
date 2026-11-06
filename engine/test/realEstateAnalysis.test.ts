// 収益不動産の分析の数字（asset.realEstateAnalysis。0082）のテスト（L1）: 各指標の式（手計算と突き合わせる。率の割り算は小数12桁・銀行丸め）、
// 分母が0・無いとき、元金の返済が減価償却費を上回る年、減価償却が終わる年、民泊・宿、合計の行、今の予定の売却の税引後の手取り、
// 税引後の手残り（増える税と社会保険料の向き）、表に載る月の分（計算基準月から）、物件の無い世帯
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { DebtScheduleOutput, RealEstateAnalysisOutput, RealEstateOutput, RealEstateSaleTaxOutput } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, period, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Cell = { row: string; year: number; amount: number; object?: string };
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const analysis = (req: Req) => call<RealEstateAnalysisOutput>(req, "asset.realEstateAnalysis", {});
const A = uid("a");
const P = uid("prop");
const Q = uid("prop2");
const L = uid("propLoan");
const at = (ym: string) => ({ at: ym });

Decimal.set({ precision: 60 });
const div12 = (a: Decimal.Value, b: Decimal.Value) => new Decimal(a).div(b).toDecimalPlaces(12, Decimal.ROUND_HALF_EVEN);
const r12 = (a: Decimal.Value, b: Decimal.Value) => div12(a, b).toString();
const floorYen = (d: Decimal.Value) => new Decimal(d).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();
const sameRate = (got: string | null, want: string) => expect(got === null ? null : new Decimal(got).toString()).toBe(new Decimal(want).toString());

/** マンション1室（鉄筋コンクリート・2015年築・2020年4月に2,500万円で取得〔諸費用150万円・自己資金500万円〕・土地4割） */
const property = (o: Obj = {}): Obj => ({
  structure: "rc",
  builtYear: 2015,
  landShare: "0.4",
  acquisition: { price: 25000000, at: "2020-04", costs: 1500000, equity: 5000000 },
  rental: { monthly: box(100000), vacancyRate: "0.05", commonFee: 10000, keyMoney: 120000 },
  expenses: { annual: box(240000), rate: "0.05" },
  ...o,
});
const account = (id: string = P, p: Obj = property()): Obj => ({ id, kind: "realEstate", owner: A, marketValue: box(30000000), asOf: "2025-12", valueGrowth: "0", contributions: [], property: p });
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
const base = (o: { accounts?: Obj[]; debts?: Obj[]; baseMonth?: string; periods?: Obj[] } = {}): Req => {
  const req = household({
    baseMonth: o.baseMonth ?? "2026-01",
    endYear: 2060,
    members: [member("a", "self", "1980-01")],
    periods: o.periods ?? [period("w", { member: "a", from: "2000-04", annual: 6000000 })],
    accounts: [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(10000000), asOf: "2025-12", contributions: [] }, ...(o.accounts ?? [account()])],
  });
  (req.input.household as unknown as Obj).debts = o.debts ?? [loan()];
  return req;
};

describe("物件ごと・年ごとの指標の式", () => {
  const req = base();
  const a = analysis(req);
  const re = call<RealEstateOutput>(req, "asset.realEstate", {}).properties[0];
  const sched = call<DebtScheduleOutput>(req, "debt.schedule", { object: L });
  const p = a.properties[0];
  const y = p?.years.find((x) => x.year === 2027);
  const c = re?.cash?.find((x) => x.year === 2027);

  it("金額: 満室のときの収入（空室を見込む前の家賃と共益費。礼金は入れない）・実際に入る収入・経費・返済・手残り・ローン残高・含み益", () => {
    expect(y?.months).toBe(12);
    expect(y?.gross).toBe((100000 + 10000) * 12);
    // 実際に入る収入: 家賃と共益費の空室を見込んだ後の額と礼金・更新料（12か月に分ける）
    expect(y?.rent).toBe((95000 + 9500) * 12 + 120000);
    expect(y?.rent).toBe(c?.rent);
    // 経費: 年額＋（家賃＋共益費）×5%
    expect(y?.expenses).toBe(240000 + floorYen(new Decimal(104500).mul("0.05")) * 12);
    const pays = sched.flows.filter((f) => f.ym.startsWith("2027-")).reduce((s, f) => s + f.amount, 0);
    expect(y?.repayment).toBe(pays);
    expect(y?.debtService).toBe(pays);
    const interest = sched.interest?.find((x) => x.year === 2027)?.amount ?? 0;
    expect(y?.principal).toBe(pays - interest);
    expect(y?.cashBeforeTax).toBe((y?.rent ?? 0) - (y?.expenses ?? 0) - (y?.repairs ?? 0) - pays);
    expect(y?.cashAfterTax).toBe((y?.cashBeforeTax ?? 0) - (y?.tax ?? 0));
    expect(y?.loanBalance).toBe(sched.yearEnd.find((x) => x.year === 2027)?.balance);
    const v = re?.years.find((x) => x.year === 2027)?.value ?? 0;
    expect(y?.value).toBe(v);
    expect(y?.equity).toBe(v - (y?.loanBalance ?? 0));
    expect(y?.age).toBe(12);
    // 残りの耐用年数は実際の償却で数える（2020年に築5年で取得: 簡便法で 47−5＋1＝43年、償却率 0.024〔1÷43 を小数3桁に切り上げ〕で
    // 2020年4月から償却して 2061年に終わる。0127）
    expect(p?.depreciationEnd.building).toBe(2061);
    expect(y?.remainingLife).toBe(2061 - 2027 + 1);
  });

  it("残りの耐用年数は、中古の簡便法の耐用年数で数えた、その年から建物の償却が終わる年までの年数（法定耐用年数−築年数ではない。0127）", () => {
    // 木造（法定22年）・2008年築を2016年11月に取得: 簡便法で 22−8＋1＝15年 → 2031年に終わる。2027年は築19年で、法定で数えると残り3年、実際は5年（2027〜2031年）
    const wood = base({ accounts: [account(P, property({ structure: "wood", builtYear: 2008, acquisition: { price: 25000000, at: "2016-11", costs: 1500000 } }))] });
    const w = analysis(wood).properties[0];
    expect(w?.legalLife).toBe(22);
    expect(w?.depreciationEnd.building).toBe(2031);
    const row = (yy: number) => w?.years.find((x) => x.year === yy);
    expect(row(2027)?.age).toBe(19);
    expect(row(2027)?.remainingLife).toBe(5);
    expect(row(2031)?.remainingLife).toBe(1);
    expect(row(2032)?.remainingLife).toBe(0);
    // 売るまでに終わらないときは、貸し続けたら終わる年まで数える
    const sold = base({ accounts: [account(P, property({ sale: { at: at("2030-06") } }))] });
    const s0 = analysis(sold).properties[0];
    expect(s0?.depreciationEnd.building).toBeNull();
    const cont = s0?.depreciationEndIfContinued?.building as number;
    expect(s0?.years.find((x) => x.year === 2027)?.remainingLife).toBe(cont - 2027 + 1);
    // 減価償却を引き継いだ物件は、引き継いだ未償却残高と年額で償却が終わる年まで（2025年末の残り 300万円・年額 60万円 → 2026〜2029年に
    // 60万円、2030年に 599,999円で終わる〔1円を残す〕。取得価額からの簡便法の年数〔2031年まで〕ではない。0126 の引き継ぎと 0127 の数え方）
    const carried = base({ accounts: [account(P, property({ structure: "wood", builtYear: 2008, acquisition: { price: 25000000, at: "2016-11", costs: 1500000 }, depreciationCarryover: { year: 2025, building: { book: 3000000, annual: 600000 } } }))] });
    const c0 = analysis(carried).properties[0];
    expect(c0?.depreciationEnd.building).toBe(2030);
    expect(c0?.years.find((x) => x.year === 2027)?.remainingLife).toBe(4);
    expect(c0?.years.find((x) => x.year === 2030)?.remainingLife).toBe(1);
    expect(c0?.years.find((x) => x.year === 2031)?.remainingLife).toBe(0);
    // 取得価額が無い（償却しない）建物は出さない
    const noAcq = base({ accounts: [account(P, property({ acquisition: undefined }))], debts: [] });
    expect(analysis(noAcq).properties[0]?.years.every((x) => x.remainingLife === null)).toBe(true);
  });

  it("率: 表面利回り・実質利回り（分母は取得価額＋諸費用）・損益分岐の入居率・返済比率・返済余裕率・借入の割合・自己資金に対する手残りの割合", () => {
    if (y === undefined) throw new Error("no row");
    sameRate(y.grossYield, r12(y.gross ?? 0, 25000000));
    sameRate(y.netYield, r12(y.rent - y.expenses, 26500000));
    sameRate(y.breakEven, r12(y.expenses + y.debtService, y.gross ?? 0));
    sameRate(y.repaymentRatio, r12(y.debtService, y.rent));
    sameRate(y.dscr, r12(y.rent - y.expenses, y.debtService));
    sameRate(y.ltv, r12(y.loanBalance, y.value ?? 0));
    sameRate(y.ccr, r12(y.cashBeforeTax, 5000000));
    expect(p?.acquisition).toEqual({ total: 25000000, costs: 1500000, equity: 5000000 });
    expect(p?.legalLife).toBe(47);
    expect(p?.builtYear).toBe(2015);
  });

  it("その物件で増える税と社会保険料: 黒字の物件は増え（プラス）、赤字の物件は減る（マイナス）。税引後＝税引前−その額", () => {
    expect((y?.income ?? 0) > 0).toBe(true);
    expect((y?.tax ?? 0) > 0).toBe(true);
    // 経費を大きくして赤字にする（土地の利息の分を除いても損失が残る）
    const loss = analysis(base({ accounts: [account(P, property({ expenses: { annual: box(2400000) } }))] })).properties[0]?.years.find((x) => x.year === 2027);
    expect((loss?.income ?? 0) < 0).toBe(true);
    expect((loss?.tax ?? 0) < 0).toBe(true);
    expect(loss?.cashAfterTax).toBe((loss?.cashBeforeTax ?? 0) - (loss?.tax ?? 0));
  });

  it("計算基準月が年の途中なら、計算基準年の金額は表に載る月の分（キャッシュフロー表の家賃収入の行と同じ）で、率は年あたりに直す", () => {
    const r = base({ baseMonth: "2026-04" });
    const t = full(r);
    const b = (t.summary as unknown as { realEstateAnalysis: RealEstateAnalysisOutput }).realEstateAnalysis.properties[0]?.years[0];
    expect(b?.year).toBe(2026);
    expect(b?.months).toBe(9);
    const cell = (t.table as unknown as Cell[]).find((x) => x.row === "cf.income.other.rental" && x.year === 2026 && x.object === P)?.amount;
    expect(b?.rent).toBe(cell);
    sameRate(b?.grossYield ?? null, r12(floorYen(new Decimal(b?.gross ?? 0).mul(12).div(9)), 25000000));
  });
});

describe("分母が0・無いとき（出さない）", () => {
  it("取得の入力が無ければ表面利回り・実質利回りは null。自己資金が無ければ自己資金に対する手残りの割合は null", () => {
    const p0 = property();
    delete p0.acquisition;
    const y = analysis(base({ accounts: [account(P, p0)] })).properties[0]?.years.find((x) => x.year === 2027);
    expect(y?.grossYield).toBeNull();
    expect(y?.netYield).toBeNull();
    expect(y?.ccr).toBeNull();
    const noEquity = analysis(base({ accounts: [account(P, property({ acquisition: { price: 25000000, at: "2020-04" } }))] })).properties[0]?.years.find((x) => x.year === 2027);
    expect(noEquity?.ccr).toBeNull();
    expect(noEquity?.netYield).not.toBeNull();
  });

  it("ローンが無ければ返済比率・返済余裕率・借入の割合は null。元金の返済が減価償却費を上回る年も無い", () => {
    const p = analysis(base({ debts: [] })).properties[0];
    const y = p?.years.find((x) => x.year === 2027);
    expect(y?.repayment).toBe(0);
    expect(y?.repaymentRatio).toBeNull();
    expect(y?.dscr).toBeNull();
    expect(y?.ltv).toBeNull();
    expect(p?.deadCross).toBeNull();
    // 損益分岐の入居率は経費だけで出る
    sameRate(y?.breakEven ?? null, r12(y?.expenses ?? 0, y?.gross ?? 0));
  });

  it("貸していない年（貸し終わりの後）は、貸している月数が0で率は出さない。返し終わった後の返済余裕率も出さない", () => {
    const p = analysis(base({ accounts: [account(P, property({ rental: { monthly: box(100000), to: at("2030-12") } }))] })).properties[0];
    const y = p?.years.find((x) => x.year === 2031);
    expect(y?.months).toBe(0);
    expect(y?.rent).toBe(0);
    for (const k of ["grossYield", "netYield", "breakEven", "repaymentRatio", "dscr", "ccr"] as const) expect(y?.[k], k).toBeNull();
    // 返し終わった後（2045年4月から返済なし）
    const after = analysis(base()).properties[0]?.years.find((x) => x.year === 2046);
    expect(after?.debtService).toBe(0);
    expect(after?.dscr).toBeNull();
    expect(after?.ltv).toBe("0");
  });
});

describe("元金の返済が減価償却費を上回る年・減価償却が終わる年", () => {
  it("元金（約定の返済−利息）＞減価償却費になる最初の年。上回る前の年は元金≦減価償却費", () => {
    // 借入を小さくして、元金が償却を上回る年を表の途中にする（元金は年とともに増える）
    const req = base({ debts: [loan({ principal: 12000000, rateSchedule: [{ from: at("2020-04"), type: "fixed", rate: "0.04" }], repayment: { method: "equalPayment", termMonths: 360 } })] });
    const p = analysis(req).properties[0];
    const dc = p?.deadCross;
    expect(dc).not.toBeNull();
    expect(dc as number).toBeGreaterThan(2026);
    for (const y of p?.years ?? []) {
      if (y.months === 0) continue;
      if (y.year < (dc as number)) expect(y.principal, String(y.year)).toBeLessThanOrEqual(y.depreciation ?? 0);
      if (y.year === dc) expect(y.principal).toBeGreaterThan(y.depreciation ?? 0);
    }
  });

  it("減価償却が終わる年: 中古の木造（簡便法で短い耐用年数）は表の中の年、終わった次の年から減価償却費が0。表の期間の後でも数える", () => {
    const wood = property({ structure: "wood", builtYear: 2000, acquisition: { price: 20000000, at: "2020-04" } });
    const p = analysis(base({ accounts: [account(P, wood)], debts: [] })).properties[0];
    const end = p?.depreciationEnd.building as number;
    expect(end).toBeGreaterThan(2020);
    expect(end).toBeLessThan(2030);
    expect(p?.years.find((x) => x.year === end)?.depreciation ?? 0).toBeGreaterThan(0);
    expect(p?.years.find((x) => x.year === end + 1)?.depreciation).toBe(0);
    // 新築の鉄筋コンクリート（47年）は表の期間の後
    const rc = analysis(base({ accounts: [account(P, property({ builtYear: 2020 }))] })).properties[0];
    expect(rc?.depreciationEnd.building as number).toBeGreaterThan(2060);
    // 売る予定があれば、売るまでに終わらないので null
    const sold = analysis(base({ accounts: [account(P, property({ builtYear: 2020, sale: { at: at("2040-06") } }))] })).properties[0];
    expect(sold?.depreciationEnd.building).toBeNull();
  });
});

describe("民泊・宿", () => {
  it("表面利回りは出さず、稼働率・1泊の単価・営業日数・年の売上を並べる。損益分岐は稼働率100%の売上に対する割合", () => {
    const lodging = property({
      kind: "lodging",
      rental: { monthly: box(0) },
      lodging: { business: "privateLodging", salesBy: "night", nightly: 20000, occupancy: "0.6", days: 180, incomeKind: "realEstate" },
    });
    const p = analysis(base({ accounts: [account(P, lodging)] })).properties[0];
    const y = p?.years.find((x) => x.year === 2027);
    expect(p?.lodging).toBe(true);
    expect(y?.grossYield).toBeNull();
    // 稼働率100%の売上: 20,000円×180日÷12 を12か月
    expect(y?.gross).toBe(floorYen(new Decimal(20000).mul(180).div(12)) * 12);
    expect(y?.lodging).toEqual({ occupancy: "0.6", nightly: 20000, days: 180, sales: y?.rent });
    sameRate(y?.breakEven ?? null, r12((y?.expenses ?? 0) + (y?.debtService ?? 0), y?.gross ?? 0));
    expect(y?.netYield).not.toBeNull();
  });

  it("月の売上の見込みで入れた民泊・宿は、満室のときの収入が無い（損益分岐も出さない）", () => {
    const lodging = property({ kind: "lodging", rental: { monthly: box(150000) }, lodging: { business: "inn", salesBy: "month" } });
    const y = analysis(base({ accounts: [account(P, lodging)] })).properties[0]?.years.find((x) => x.year === 2027);
    expect(y?.gross).toBeNull();
    expect(y?.breakEven).toBeNull();
    expect(y?.grossYield).toBeNull();
  });
});

describe("全物件の合計", () => {
  it("金額は物件の足し算。率は物件の年あたりの額を足して出す（分母は数字のある物件の分）", () => {
    const second = property({ acquisition: { price: 15000000, at: "2018-04", equity: 15000000 }, rental: { monthly: box(80000) }, expenses: { annual: box(120000) } });
    const a = analysis(base({ accounts: [account(), account(Q, second)] }));
    expect(a.properties.length).toBe(2);
    const t = a.total.find((x) => x.year === 2027);
    const ys = a.properties.map((p) => p.years.find((x) => x.year === 2027));
    for (const k of ["rent", "expenses", "repayment", "cashBeforeTax", "tax", "cashAfterTax", "loanBalance"] as const) expect(t?.[k], k).toBe(ys.reduce((s, y) => s + (y?.[k] ?? 0), 0));
    sameRate(t?.grossYield ?? null, r12(ys.reduce((s, y) => s + (y?.gross ?? 0), 0), 25000000 + 15000000));
    sameRate(t?.netYield ?? null, r12(ys.reduce((s, y) => s + ((y?.rent ?? 0) - (y?.expenses ?? 0)), 0), 26500000 + 15000000));
    sameRate(t?.ccr ?? null, r12(ys.reduce((s, y) => s + (y?.cashBeforeTax ?? 0), 0), 5000000 + 15000000));
    // 借入の割合は、全物件の評価額に対するローン残高の合計（ローンの無い物件の評価額も分母に入る）
    sameRate(t?.ltv ?? null, r12(t?.loanBalance ?? 0, ys.reduce((s, y) => s + (y?.value ?? 0), 0)));
  });
});

describe("今の予定の売却", () => {
  it("税引後の手取り＝手取り−売ったときの一括の返済−譲渡所得の税（名義の人×年の額）", () => {
    const req = base({ accounts: [account(P, property({ sale: { at: at("2035-06"), price: 40000000 } }))] });
    const p = analysis(req).properties[0];
    const tax = call<RealEstateSaleTaxOutput>(req, "tax.realEstateSale", {}).byMember.find((x) => x.year === 2035);
    const sched = call<DebtScheduleOutput>(req, "debt.schedule", { object: L });
    const payoff = sched.flows.filter((f) => f.formula === "debt.schedule.salePayoff").reduce((s, f) => s + f.amount, 0);
    expect(payoff).toBeGreaterThan(0);
    expect(p?.exit?.loanPayoff).toBe(payoff);
    expect(p?.exit?.tax).toBe((tax?.incomeTax ?? 0) + (tax?.residentTax ?? 0));
    expect((p?.exit?.tax ?? 0) > 0).toBe(true);
    expect(p?.exit?.net).toBe((p?.exit?.proceeds ?? 0) - payoff - (p?.exit?.tax ?? 0));
    // 売った年の返済に一括の返済を入れない・売った年の後の行は無い
    const y = p?.years.find((x) => x.year === 2035);
    expect(y?.repayment).toBe(sched.flows.filter((f) => f.ym.startsWith("2035-") && f.formula !== "debt.schedule.salePayoff").reduce((s, f) => s + f.amount, 0));
    expect(p?.years.at(-1)?.year).toBe(2035);
    expect(y?.held).toBe(false);
    expect(y?.value).toBeNull();
  });
});

describe("要約・物件の無い世帯", () => {
  it("summary の realEstateAnalysis は部品の出力と同じ。物件の無い世帯では欄が無く、表は変わらない", () => {
    const req = base();
    const r = full(req);
    expect((r.summary as { realEstateAnalysis?: unknown }).realEstateAnalysis).toEqual(analysis(req));
    const none = full(base({ accounts: [], debts: [] }));
    expect((none.summary as Obj).realEstateAnalysis).toBeUndefined();
  });
});

describe("含み益・帳簿価額・建物の無い物件（約束の版 1.1）", () => {
  it("含み益＝評価額−帳簿価額（asset.realEstate の帳簿価額）。売ったときの手残りの目安（equity）は評価額−ローン残高のまま", () => {
    const req = base();
    const re = call<RealEstateOutput>(req, "asset.realEstate", {}).properties[0];
    const y = analysis(req).properties[0]?.years.find((x) => x.year === 2027);
    const book = re?.years.find((x) => x.year === 2027)?.book as number;
    expect(book).toBeGreaterThan(0);
    expect(y?.bookValue).toBe(book);
    expect(y?.unrealizedGain).toBe((y?.value ?? 0) - book);
    expect(y?.equity).toBe((y?.value ?? 0) - (y?.loanBalance ?? 0));
    const p0 = property();
    delete p0.acquisition;
    const none = analysis(base({ accounts: [account(P, p0)] })).properties[0]?.years.find((x) => x.year === 2027);
    expect(none?.bookValue).toBeNull();
    expect(none?.unrealizedGain).toBeNull();
  });

  it("合計の含み益は、数字のある物件の分の足し算", () => {
    const p0 = property();
    delete p0.acquisition;
    const a = analysis(base({ accounts: [account(P), account(Q, p0)] }));
    const t = a.total.find((x) => x.year === 2027);
    expect(t?.unrealizedGain).toBe(a.properties[0]?.years.find((x) => x.year === 2027)?.unrealizedGain);
  });

  it("売るまでに減価償却が終わらなければ、貸し続けたら終わる年を添える", () => {
    const sold = analysis(base({ accounts: [account(P, property({ builtYear: 2020, sale: { at: at("2040-06") } }))] })).properties[0];
    expect(sold?.depreciationEnd.building).toBeNull();
    expect(sold?.depreciationEndIfContinued?.building).toBeGreaterThan(2040);
    expect(analysis(base()).properties[0]?.depreciationEndIfContinued).toBeUndefined();
  });

  it("建物の無い物件（貸している土地・駐車場）は、建った年・法定耐用年数・築年数を出さない", () => {
    const land = property({ kind: "land", structure: undefined, builtYear: undefined, landShare: undefined });
    for (const k of Object.keys(land)) if (land[k] === undefined) delete land[k];
    const p = analysis(base({ accounts: [account(P, land)] })).properties[0];
    expect(p?.builtYear).toBeNull();
    expect(p?.legalLife).toBeNull();
    expect(p?.years.every((x) => x.age === null && x.remainingLife === null)).toBe(true);
    expect(p?.depreciationEnd).toEqual({ building: null, equipment: null });
  });
});

describe("今の実際の家賃収入で入れた物件（約束の版 1.2・0126）", () => {
  const req = base({ accounts: [account(P, property({ rental: { rentBy: "actual", monthly: box(95000), vacancyRate: "0.05", commonFee: 9500, keyMoney: 120000 } }))] });
  const p = analysis(req).properties[0];
  const y = p?.years.find((x) => x.year === 2027);
  it("満室の額が無いので表面利回り・損益分岐の入居率は null。今の家賃収入での表面利回り（礼金・更新料を除く年額÷取得価額）を出す", () => {
    expect(p?.rentBy).toBe("actual");
    expect(p?.lodging).toBe(false);
    expect(y?.gross).toBeNull();
    expect(y?.grossYield).toBeNull();
    expect(y?.breakEven).toBeNull();
    sameRate(y?.currentYield ?? null, r12((95000 + 9500) * 12, 25000000));
    // 実質利回り・返済比率などは今までどおり出す
    expect(y?.netYield).not.toBeNull();
    expect(y?.dscr).not.toBeNull();
  });
  it("満室時の家賃で入れた物件には currentYield も rentBy も無い。合計の表面利回りは満室のときの収入のある物件だけ", () => {
    const b = analysis(base());
    expect(b.properties[0]?.rentBy).toBeUndefined();
    expect(b.properties[0]?.years[0]?.currentYield).toBeUndefined();
    const two = analysis(base({ accounts: [account(P, property({ rental: { rentBy: "actual", monthly: box(95000) } })), account(Q)] }));
    const t = two.total.find((x) => x.year === 2027);
    const q = two.properties.find((x) => x.object === Q)?.years.find((x) => x.year === 2027);
    expect(t?.grossYield).toBe(q?.grossYield);
  });
});

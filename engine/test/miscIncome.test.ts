// 雑所得の区分（0085）のテスト: 公的年金等以外の雑所得は1つの区分（入るお金の行の雑所得〔業務・その他〕・保険の雑所得・民泊・宿の雑所得）で
// 赤字も含めて差し引き、赤字は公的年金等の雑所得からだけ引いて、ほかの所得とは通算しない。事業所得を選んだ行の赤字はほかの所得と通算する。
// 住民税・国民健康保険料の所得にも入る。赤字の行が無い世帯の結果は前と同じ。製品の制度データで確かめる
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { IncomeFlowsOutput, InsuranceIncomeOutput, TotalIncomeOutput } from "../src/sdk/index.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
type Cell = { row: string; year: number; amount: number };
const packs = realPacks();
const full = (req: EngineRequest): EngineResult => runEngine(req, packs, { checkInternal: true });
const call = <T>(req: EngineRequest, component: string, input: unknown): T => runEngine(req, packs, { checkInternal: true, entry: { component, input } }).entryOutput as T;
const edit = (req: EngineRequest, f: (h: Obj) => void): EngineRequest => {
  const r = structuredClone(req) as unknown as { input: { household: Obj } };
  f(r.input.household);
  return r as unknown as EngineRequest;
};
const cells = (r: EngineResult, row: string, year: number) => (r.table as unknown as Cell[]).filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year).reduce((s, c) => s + c.amount, 0);
const notices = (r: EngineResult) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const S = uid("mi-self");
const W = uid("mi-wife");
const at = (ym: string) => ({ at: ym });

/** 本人（会社員・年収600万円。selfEmployed なら自営で国民健康保険）・配偶者（収入なし）。2026年10月から endYear まで */
function base(o: { selfEmployed?: number; endYear?: number; retireAt?: string } = {}): EngineRequest {
  const job =
    o.selfEmployed !== undefined
      ? { id: uid("mi-job"), member: S, from: at("2010-04"), to: null, type: "selfEmployed", business: { income: box(o.selfEmployed) } }
      : period("mi-job", { member: "mi-self", from: "1998-04", ...(o.retireAt !== undefined ? { to: o.retireAt } : {}), annual: 6000000, std: [500000, 500000] });
  const req = household({
    baseMonth: "2026-10",
    endYear: o.endYear ?? 2032,
    members: [member("mi-self", "self", "1975-05", { sex: "male" }), member("mi-wife", "spouse", "1977-08")],
    relations: [{ type: "spouse", a: S, b: W, marriage: "legal", from: { at: "2002-04" }, to: null }],
    periods: [job],
    residentTaxAssessments: [
      { id: uid("mi-rta"), member: S, fiscalYear: 2026, amount: box(300000) },
      { id: uid("mi-rtw"), member: W, fiscalYear: 2026, amount: box(0) },
    ],
  });
  if (o.selfEmployed === undefined) return req;
  // 国民健康保険の料率（架空の自治体の値）
  const part = (x: string) => ({ incomeRate: box(x), perCapita: box(40000), perHousehold: box(20000) });
  return edit(req, (h) => (h.premiumRates = [{ id: uid("mi-pr"), kind: "nationalHealth", parts: { medical: part("0.07"), elderlySupport: part("0.02"), care: part("0.02") } }]));
}
/** 2028年に毎月受け取る入るお金の行（月額と必要経費の月額） */
const row = (name: string, o: Obj): Obj => ({ id: uid(`mi:${name}`), from: at("2028-01"), to: at("2028-12"), everyYears: 1, monthly: true, growth: { kind: "none" }, ...o });
const withRows = (req: EngineRequest, ...rows: Obj[]) => edit(req, (h) => (h.incomeFlows = rows));
const total = (req: EngineRequest, year: number, who = S) => call<TotalIncomeOutput>(req, "tax.totalIncome", { member: who, year });
const tax = (r: EngineResult, year: number) => cells(r, "cf.taxSi.incomeTax", year);
const residentTax = (r: EngineResult, year: number) => cells(r, "cf.taxSi.residentTax", year);
const health = (r: EngineResult, year: number) => cells(r, "cf.taxSi.health", year) + cells(r, "cf.taxSi.care", year);
const lossNotice = (r: EngineResult) => notices(r).some((n) => n.code === "N_LIMIT_APPLIED" && n.ids.includes("income.miscellaneousLoss"));

describe("雑所得（公的年金等以外）を1つの区分として計算する", () => {
  it("副業（雑所得）の赤字は給与所得と通算しない: 合計所得金額・所得税・翌年度の住民税は副業の無い世帯と同じで、捨てた赤字を添えて知らせる", () => {
    const plain = base();
    // 月10万円の収入、月20万円の必要経費（年120万円の赤字）
    const req = withRows(plain, row("side", { kind: "sideJob", amount: box(100000), cost: box(200000) }));
    const t = total(req, 2028);
    expect(t.total).toBe(total(plain, 2028).total);
    expect(t.miscellaneous).toBeUndefined();
    expect(t.miscellaneousLoss).toBe(1200000);
    const flows = call<IncomeFlowsOutput>(req, "income.flows", {}).byMember.find((x) => x.member === S && x.year === 2028);
    expect(flows).toMatchObject({ miscBusiness: 0, miscellaneousNet: -1200000 });
    const r = full(req);
    const p = full(plain);
    expect(tax(r, 2028) + tax(r, 2029)).toBe(tax(p, 2028) + tax(p, 2029));
    expect(residentTax(r, 2029) + residentTax(r, 2030)).toBe(residentTax(p, 2029) + residentTax(p, 2030));
    expect(lossNotice(r)).toBe(true);
    expect(lossNotice(p)).toBe(false);
  });

  it("同じ副業を事業所得にすると、赤字は給与所得と通算する（合計所得金額が赤字の分だけ下がり、所得税・住民税が下がる）。知らせは出ない", () => {
    const plain = base();
    const req = withRows(plain, row("side", { kind: "sideJob", taxTreatment: "business", amount: box(100000), cost: box(200000) }));
    const t = total(req, 2028);
    expect(t.total).toBe(total(plain, 2028).total - 1200000);
    expect(t.other).toBe(0);
    expect(t.miscellaneousLoss).toBeUndefined();
    const r = full(req);
    const p = full(plain);
    expect(tax(r, 2028) + tax(r, 2029)).toBeLessThan(tax(p, 2028) + tax(p, 2029));
    expect(residentTax(r, 2029) + residentTax(r, 2030)).toBeLessThan(residentTax(p, 2029) + residentTax(p, 2030));
    expect(lossNotice(r)).toBe(false);
    // 黒字の事業所得は前と同じく足す
    const plus = withRows(plain, row("side", { kind: "sideJob", taxTreatment: "business", amount: box(200000), cost: box(50000) }));
    expect(total(plus, 2028).total).toBe(total(plain, 2028).total + 1800000);
  });

  it("雑所得の中では差し引く: 副業（雑所得〔業務〕）の赤字は、売電（雑所得〔その他〕）の黒字から引く", () => {
    const plain = base();
    const both = withRows(plain, row("side", { kind: "sideJob", amount: box(50000), cost: box(100000) }), row("power", { kind: "powerSale", amount: box(80000) }));
    // 赤字 60万円、黒字 96万円 → 雑所得 36万円
    const t = total(both, 2028);
    expect(t.miscellaneous).toBe(360000);
    expect(t.total).toBe(total(plain, 2028).total + 360000);
    expect(t.miscellaneousLoss).toBeUndefined();
    // 赤字の方が大きければ、雑所得は0円で、残りの赤字は給与所得から引かない
    const more = withRows(plain, row("side", { kind: "sideJob", amount: box(50000), cost: box(200000) }), row("power", { kind: "powerSale", amount: box(80000) }));
    expect(total(more, 2028).total).toBe(total(plain, 2028).total);
    expect(total(more, 2028).miscellaneousLoss).toBe(1800000 - 960000);
  });

  it("公的年金等以外の雑所得の赤字は、公的年金等の雑所得から引く（引ききれない分は捨てる）", () => {
    // 2027年3月に辞め、65歳（2040年6月）から老齢年金を受ける。2041年は年金だけの年
    const plain = base({ endYear: 2042, retireAt: "2027-03" });
    const pension = total(plain, 2041);
    expect(pension.publicPension).toBeGreaterThan(300000);
    const loss = (cost: number) => withRows(plain, row("side", { kind: "sideJob", from: at("2041-01"), to: at("2041-12"), amount: box(100000), cost: box(cost) }));
    // 年30万円の赤字は年金の雑所得から引く
    expect(total(loss(125000), 2041).total).toBe(pension.total - 300000);
    expect(total(loss(125000), 2041).miscellaneousLoss).toBeUndefined();
    // 年金の雑所得より大きい赤字は、引ききれない分を捨てる
    const big = total(loss(1100000), 2041);
    expect(big.total).toBe(pension.total - (pension.publicPension ?? 0));
    expect(big.miscellaneousLoss).toBe(12000000 - (pension.publicPension ?? 0));
  });

  it("個人年金保険の年金（公的年金等以外の雑所得）が元本割れで赤字なら、副業の雑所得の黒字から引く", () => {
    // 払込 月3万円×131か月（2016年4月〜払込の終わりの前の月）＝393万円、年金 年30万円×10年＝300万円（毎年 30万円 − 393万円×30万円/300万円 ＝ −9.3万円）
    const annuity = {
      id: uid("mi-ins"),
      template: "insurance.privateAnnuity",
      policyholder: S,
      insured: S,
      contractDate: "2016-04",
      currency: "JPY",
      premium: { amount: 30000, frequency: "monthly", payUntil: at("2027-03") },
      deductionCategory: { type: "pension", regime: "new" },
      coverages: [{ id: uid("mi-ann"), role: "main", benefit: "annuity", amount: 300000, from: at("2027-04"), years: 10 }],
    };
    const plain = edit(base(), (h) => (h.insuranceContracts = [annuity]));
    const ins = call<InsuranceIncomeOutput>(plain, "insurance.income", { member: S, year: 2028 });
    expect(ins.miscellaneous).toBe(0);
    expect(ins.miscellaneousNet).toBe(-93000);
    // 年金だけなら雑所得は0円（赤字は給与所得から引かない）
    expect(total(plain, 2028).total).toBe(total(base(), 2028).total);
    expect(total(plain, 2028).miscellaneousLoss).toBe(93000);
    // 副業の雑所得 年60万円から 9.3万円を引く
    const side = withRows(plain, row("side", { kind: "sideJob", amount: box(50000) }));
    expect(total(side, 2028).miscellaneous).toBe(600000 - 93000);
  });

  it("国民健康保険料の所得にも入る: 雑所得の黒字で翌年度の保険料が上がり、雑所得の赤字では下がらない（事業所得の赤字なら下がる）", () => {
    const plain = base({ selfEmployed: 4000000 });
    const p = full(plain);
    const plus = full(withRows(plain, row("side", { kind: "sideJob", amount: box(100000) })));
    const minus = full(withRows(plain, row("side", { kind: "sideJob", amount: box(100000), cost: box(150000) })));
    const biz = full(withRows(plain, row("side", { kind: "sideJob", taxTreatment: "business", amount: box(100000), cost: box(150000) })));
    // 2028年の所得は2029年度（2029年6月〜2030年5月）の保険料に効く
    const fy = (r: EngineResult) => health(r, 2029) + health(r, 2030);
    expect(fy(plus)).toBeGreaterThan(fy(p));
    expect(fy(minus)).toBe(fy(p));
    expect(fy(biz)).toBeLessThan(fy(p));
    // 所得の年の保険料は変わらない
    expect(health(plus, 2028)).toBe(health(p, 2028));
  });

  it("赤字の無い雑所得・事業所得の行は前と同じ: 区分ごとの額は今までの欄にも出し、表の行（雑所得・副業）を変えても税は同じ", () => {
    const plain = base();
    const req = withRows(plain, row("side", { kind: "sideJob", amount: box(100000), cost: box(20000) }), row("power", { kind: "powerSale", amount: box(10000) }), row("biz", { kind: "other", taxTreatment: "business", amount: box(30000) }));
    const fl = call<IncomeFlowsOutput>(req, "income.flows", {}).byMember.find((x) => x.member === S && x.year === 2028);
    expect(fl).toMatchObject({ miscBusiness: 960000, miscOther: 120000, business: 360000, miscellaneousNet: 1080000, businessNet: 360000 });
    const t = total(req, 2028);
    expect(t.miscellaneous).toBe(1080000);
    expect(t.total).toBe(total(plain, 2028).total + 1080000 + 360000);
    // 表の行は見せ方だけ: 雑所得の行に載せても税・社会保険料は同じ
    const moved = edit(req, (h) => ((h.incomeFlows as Obj[])[0]!.row = "cf.income.other.miscellaneous"));
    const a = full(req);
    const b = full(moved);
    expect(cells(b, "cf.income.other.miscellaneous", 2028)).toBe(1200000);
    expect(cells(b, "cf.income.other.sideJob", 2028)).toBe(0);
    expect(cells(a, "cf.income.other.sideJob", 2028)).toBe(1200000);
    for (const y of [2028, 2029, 2030]) expect(cells(b, "cf.taxSi", y)).toBe(cells(a, "cf.taxSi", y));
  });
});

describe("確定申告不要制度（公的年金等の収入が400万円以下）の「その他の所得」に雑所得を入れる", () => {
  it("年金の人に副業の雑所得が年20万円を超えてあれば、翌年3月に追加の所得税を払う（20万円以下なら申告しない）", () => {
    const plain = base({ endYear: 2042, retireAt: "2027-03" });
    const side = (monthly: number) => withRows(plain, row("side", { kind: "sideJob", from: at("2041-01"), to: at("2041-12"), amount: box(monthly) }));
    const settle = (r: EngineResult) => r.flows.filter((f) => f.formula === "incomeTax.annual.settlement" && f.accrualYear === 2041 && f.member === S).reduce((s, f) => s + f.amount, 0);
    expect(settle(full(plain))).toBeLessThanOrEqual(0);
    // 年60万円（20万円を超える）: 申告して払う
    expect(settle(full(side(50000)))).toBeGreaterThan(0);
    // 年12万円（20万円以下）: 追加の納付は申告しない
    expect(settle(full(side(10000)))).toBe(settle(full(plain)));
  });
});

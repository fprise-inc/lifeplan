// 住まい以外の不動産（asset.realEstate）のテスト（L1）: 土地と建物の評価、家賃収入（空室・変化率）、経費、減価償却費（新築・中古の簡便法・
// 月割り）、借入の利息（土地の分）、不動産所得の合計所得金額への反映（損益通算と土地の利息の制限）、国民健康保険料、売却、土地と建物の行の合計。
// 手計算は別に書き（率の割り算は小数12桁・銀行丸め、金額は円未満切り捨て）、エンジンの結果と突き合わせる
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { usedLife, straightLineRate } from "../src/components/asset.realEstate/index.ts";
import { runEngine } from "../src/engine/run.ts";
import type { DebtScheduleOutput, RealEstateOutput, TotalIncomeOutput } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Packs = ReturnType<typeof fictionalPacks>;
const call = <T>(req: Req, component: string, input: unknown, packs: Packs = fictionalPacks()): T =>
  runEngine(req, packs, { checkInternal: true, entry: { component, input } }).entryOutput as T;
const full = (req: Req, packs: Packs = fictionalPacks()) => runEngine(req, packs, { checkInternal: true });
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const A = uid("a");
const P = uid("prop");
const L = uid("propLoan");
const at = (ym: string) => ({ at: ym });
const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
type Cell = { row: string; year: number; amount: number; object?: string };
const cells = (r: ReturnType<typeof full>, row: string, year: number) => (r.table as unknown as Cell[]).filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year).reduce((s, c) => s + c.amount, 0);

Decimal.set({ precision: 60 });
const div12 = (a: Decimal.Value, b: Decimal.Value) => new Decimal(a).div(b).toDecimalPlaces(12, Decimal.ROUND_HALF_EVEN);
const floorYen = (d: Decimal) => d.toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();
const remain = (a: number, life: number, floor: string) => {
  if (a <= 0) return new Decimal(1);
  const raw = new Decimal(1).minus(div12(a, life));
  return raw.lt(floor) ? new Decimal(floor) : raw;
};

/** マンション1室（鉄筋コンクリート・2015年築・2020年4月に2,500万円で取得・土地4割）。時価3,000万円（2025年12月） */
const property = (o: Obj = {}): Obj => {
  const p: Obj = {
    structure: "rc",
    builtYear: 2015,
    landShare: "0.4",
    acquisition: { price: 25000000, at: "2020-04" },
    rental: { monthly: box(100000), vacancyRate: "0.05", growth: "-0.01" },
    expenses: { annual: box(240000), rate: "0.05" },
    ...o,
  };
  // undefined を渡した欄は入れない
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  return p;
};
const account = (p: Obj = property(), extra: Obj = {}): Obj => ({ id: P, kind: "realEstate", owner: A, marketValue: box(30000000), asOf: "2025-12", valueGrowth: "0", contributions: [], property: p, ...extra });
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
const base = (o: { periods?: Obj[]; accounts?: Obj[]; endYear?: number; baseMonth?: string } = {}) =>
  household({
    baseMonth: o.baseMonth ?? "2026-01",
    endYear: o.endYear ?? 2060,
    members: [member("a", "self", "1980-01")],
    periods: o.periods ?? [],
    accounts: [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(10000000), asOf: "2025-12", contributions: [] }, ...(o.accounts ?? [account()])],
  });
const out = (req: Req) => call<RealEstateOutput>(req, "asset.realEstate", {});

describe("評価額（土地と建物）", () => {
  it("時価を土地の割合で分け、土地は増減率で、建物は構造の耐用年数で（中古は今の築年数の割合に対する比で）減らす", () => {
    const p = out(base()).properties[0];
    expect(p?.object).toBe(P);
    const f0 = remain(2025 - 2015, 47, "0.2");
    for (const y of [2026, 2030, 2040, 2052, 2060]) {
      const building = floorYen(new Decimal(18000000).mul(div12(remain(y - 2015, 47, "0.2"), f0)));
      expect(p?.years.find((x) => x.year === y), String(y)).toEqual({ year: y, land: 12000000, building, value: 12000000 + building });
    }
    // 2052年に築37年で下限（2割）より上、2060年は下限の比
    expect(p?.years.at(-1)?.year).toBe(2060);
  });

  it("キャッシュフロー表には土地と建物の行で出し、合計は評価額。金融資産には入れない", () => {
    const r = full(base());
    const p = out(base()).properties[0];
    for (const y of [2026, 2045]) {
      const e = p?.years.find((x) => x.year === y);
      expect(cells(r, "cf.balance.account.realEstate.land", y)).toBe(e?.land);
      expect(cells(r, "cf.balance.account.realEstate.building", y)).toBe(e?.building);
      expect(cells(r, "cf.balance.account.realEstate", y)).toBe(e?.value);
    }
    const t = r.table as unknown as Cell[];
    expect(t.some((c) => c.row === "cf.balance.account.realEstate")).toBe(false);
    const fin = t.filter((c) => c.year === 2030 && c.row === "cf.balance.account.deposit").reduce((s, c) => s + c.amount, 0);
    expect(cells(r, "cf.balance.financial", 2030)).toBe(fin);
  });

  it("中身の無い不動産の器は、今までどおり評価額の増減率で1行（土地と建物に分けない）", () => {
    const r = full(base({ accounts: [{ id: P, kind: "realEstate", owner: A, marketValue: box(30000000), asOf: "2025-12", valueGrowth: "0.01", contributions: [] }] }));
    const t = r.table as unknown as Cell[];
    expect(t.some((c) => c.row === "cf.balance.account.realEstate" && c.year === 2026)).toBe(true);
    expect(t.some((c) => c.row.startsWith("cf.balance.account.realEstate."))).toBe(false);
    expect(t.some((c) => c.row === "cf.income.other.rental")).toBe(false);
  });
});

describe("家賃収入・経費・減価償却費", () => {
  it("家賃は空室を見込んだ額を毎月、変化率は計算基準年の翌年から。経費は年額の12分の1と家賃×割合", () => {
    const req = base();
    const o = out(req);
    const rent = (ym: string) => o.flows.filter((f) => f.ym === ym && f.row === "cf.income.other.rental").reduce((s, f) => s + f.amount, 0);
    const exp = (ym: string) => o.flows.filter((f) => f.ym === ym && f.row === "cf.expense.other.realEstate").reduce((s, f) => s + f.amount, 0);
    expect(rent("2026-01")).toBe(95000); // 100,000 × 0.95
    expect(rent("2027-05")).toBe(94050); // 99,000 × 0.95
    expect(rent("2028-05")).toBe(floorYen(new Decimal(99000 - 990).mul("0.95"))); // 98,010 × 0.95
    expect(exp("2026-03")).toBe(20000 + 4750);
    expect(o.flows.every((f) => f.member === A && f.object === P)).toBe(true);
    // お金の動きは計算基準月から（前の年の分は所得の計算だけ）
    expect(o.flows.some((f) => f.ym < "2026-01")).toBe(false);
    const r = full(req);
    expect(cells(r, "cf.income.other.rental", 2026)).toBe(95000 * 12);
    expect(cells(r, "cf.expense.other.realEstate", 2026)).toBe(24750 * 12);
  });

  it("減価償却費: 建物の取得価額×定額法の償却率（中古は簡便法の耐用年数）。取得の年は月割り、帳簿の残りが1円になるまで", () => {
    expect(usedLife(47, 5)).toBe(43); // 47−5＋1
    expect(usedLife(22, 30)).toBe(4); // 22×0.2
    expect(usedLife(19, 18)).toBe(4); // 1＋3
    expect(usedLife(22, 0)).toBe(22);
    expect(straightLineRate(43)).toBe("0.024");
    expect(straightLineRate(22)).toBe("0.046");
    expect(straightLineRate(47)).toBe("0.022");
    expect(straightLineRate(4)).toBe("0.250");
    const inc = out(base()).properties[0]?.income ?? [];
    // 建物の取得価額 2,500万円×(1−0.4)＝1,500万円、×0.024＝360,000円
    expect(inc.find((x) => x.year === 2026)?.depreciation).toBe(360000);
    expect(inc[0]?.year).toBe(2024); // 計算基準年の2年前から
    // 新築・2026年4月に取得（9か月）→ 月割り。木造22年 0.046
    const fresh = out(base({ accounts: [account(property({ structure: "wood", builtYear: undefined, acquisition: { price: 10000000, at: "2026-04" }, landShare: "0.5" }))] })).properties[0]?.income ?? [];
    expect(fresh.find((x) => x.year === 2026)?.depreciation).toBe(floorYen(new Decimal(230000).mul(9).div(12)));
    expect(fresh.find((x) => x.year === 2027)?.depreciation).toBe(230000);
    // 帳簿の残りが1円になるまで: 5,000,000 − 172,500 − 230,000×k
    const total = fresh.reduce((s, x) => s + x.depreciation, 0);
    expect(total).toBe(5000000 - 1);
    expect(fresh.filter((x) => x.depreciation > 0).at(-1)?.depreciation).toBeLessThan(230000);
  });

  it("取得の入力が無い賃貸は減価償却費を入れず、知らせる", () => {
    const r = full(base({ accounts: [account(property({ acquisition: undefined }))] }));
    expect(notices(r).some((n) => n.code === "N_INPUT_REQUIRED" && n.ids.includes("account.property.acquisition"))).toBe(true);
    expect(out(base({ accounts: [account(property({ acquisition: undefined }))] })).properties[0]?.income.every((x) => x.depreciation === 0)).toBe(true);
  });

  it("借入の利息（debt.property で不動産を指す負債）を引き、土地の取得のための分（借入額のうち建物の取得価額を超える分の割合）を添える", () => {
    const req = edit(base(), (h) => (h.debts = [loan()]));
    const sched = call<DebtScheduleOutput>(req, "debt.schedule", { object: L });
    const i2026 = sched.interest?.find((x) => x.year === 2026)?.amount ?? 0;
    // 利息＝その年の返済額−残高の減り
    const r = full(req);
    const paid = (r.flows as unknown as { row: string; ym: string; amount: number; object?: string }[]).filter((f) => f.object === L && f.ym.startsWith("2026")).reduce((s, f) => s + f.amount, 0);
    const bal = (y: number) => sched.yearEnd.find((x) => x.year === y)?.balance ?? 0;
    expect(i2026).toBe(paid - (bal(2025) - bal(2026)));
    expect(i2026).toBeGreaterThan(0);
    const e = out(req).properties[0]?.income.find((x) => x.year === 2026);
    expect(e?.interest).toBe(i2026);
    expect(e?.landInterest).toBe(floorYen(new Decimal(i2026).mul(5000000).div(20000000)));
    expect(e?.income).toBe((e?.rent ?? 0) - (e?.expenses ?? 0) - (e?.depreciation ?? 0) - i2026);
    // 返済は今までどおり負債の返済の行に出る
    expect(cells(r, "cf.expense.debt.other", 2026)).toBe(paid);
  });
});

describe("不動産所得の税と社会保険への反映", () => {
  const salaried = (accounts?: Obj[], debts?: Obj[]) =>
    // 製品の制度データは2025年分から（計算基準月を10月にして、前の年度の住民税を2024年の所得から計算しないようにする）
    edit(base({ baseMonth: "2026-10", periods: [period("job", { member: "a", from: "2005-04", annual: 6000000, std: [500000, 500000] })], ...(accounts !== undefined ? { accounts } : {}) }), (h) => {
      if (debts !== undefined) h.debts = debts;
    });
  const total = (req: Req, year: number) => call<TotalIncomeOutput>(req, "tax.totalIncome", { member: A, year }, realPacks());

  it("合計所得金額に不動産所得を足し、所得税・住民税が増える", () => {
    const none = salaried([]);
    const withProp = salaried();
    const e = out(withProp).properties[0]?.income.find((x) => x.year === 2027);
    expect(e?.income).toBeGreaterThan(0);
    const t0 = total(none, 2027);
    const t1 = total(withProp, 2027);
    expect(t1.realEstate).toBe(e?.income);
    expect(t1.total - t0.total).toBe(e?.income);
    const it0 = call<{ total: number }>(none, "incomeTax.annual", { member: A, year: 2027 }, realPacks()).total;
    const it1 = call<{ total: number }>(withProp, "incomeTax.annual", { member: A, year: 2027 }, realPacks()).total;
    expect(it1).toBeGreaterThan(it0);
    const rt = (req: Req) => call<{ total: number }>(req, "residentTax.annual", { member: A, fiscalYear: 2028 }, realPacks()).total;
    expect(rt(withProp)).toBeGreaterThan(rt(none));
  });

  it("損失はほかの所得から引く（損益通算）。ただし土地の取得のための借入の利息の分は引けない", () => {
    // 家賃を小さくして損失にする
    const lossy = account(property({ rental: { monthly: box(30000) } }));
    const req = salaried([lossy], [loan()]);
    const none = salaried([]);
    const e = out(req).properties[0]?.income.find((x) => x.year === 2027);
    expect(e?.income).toBeLessThan(0);
    expect(e?.landInterest).toBeGreaterThan(0);
    const t1 = total(req, 2027);
    const t0 = total(none, 2027);
    const allowed = Math.min(0, (e?.income ?? 0) + (e?.landInterest ?? 0));
    expect(t1.realEstate).toBe(allowed);
    expect(t1.total - t0.total).toBe(allowed);
    // 借入が建物の取得価額より小さければ、土地の分は無い（全部引ける）
    const small = salaried([lossy], [loan({ principal: 10000000 })]);
    const e2 = out(small).properties[0]?.income.find((x) => x.year === 2027);
    expect(e2?.landInterest).toBe(0);
    expect(total(small, 2027).realEstate).toBe(e2?.income);
  });

  it("国民健康保険の世帯では、前の年の不動産所得が保険料に入る", () => {
    const nh = (accounts?: Obj[]) =>
      edit(
        base({ baseMonth: "2026-10", periods: [{ id: uid("biz"), member: A, from: at("2010-04"), to: null, type: "selfEmployed", business: { income: box(3000000) } }], ...(accounts !== undefined ? { accounts } : {}), endYear: 2030 }),
        (h) => {
          const part = (r: string) => ({ incomeRate: box(r), perCapita: box(40000), perHousehold: box(20000) });
          h.premiumRates = [{ id: uid("pr"), kind: "nationalHealth", parts: { medical: part("0.07"), elderlySupport: part("0.02"), care: part("0.02") } }];
          h.residentTaxAssessments = [{ id: uid("rta"), member: A, fiscalYear: 2026, amount: box(150000) }];
        },
      );
    const r0 = full(nh([]), realPacks());
    const r1 = full(nh(), realPacks());
    const e = out(nh()).properties[0]?.income.find((x) => x.year === 2027);
    // 2028年度（2028年4月〜）は2027年の所得で決まる。所得割の差＝不動産所得×（医療7%＋支援金2%＋介護2%）（100円未満の切り捨てなどの差は小さい）
    const health = (r: ReturnType<typeof full>) => cells(r, "cf.taxSi.health", 2029) + cells(r, "cf.taxSi.care", 2029);
    const d = health(r1) - health(r0);
    expect(d).toBeGreaterThan(0);
    expect(Math.abs(d - (e?.income ?? 0) * 0.11)).toBeLessThan(e === undefined ? 0 : e.income * 0.11 * 0.1);
  });
});

describe("売却と貸し終わり", () => {
  it("売却の月に手取り（評価額−費用4%）を受け取り、家賃はその前の月まで、売った年の年末には持っていない", () => {
    const req = base({ accounts: [account(property({ sale: { at: at("2035-06") } }))] });
    const o = out(req);
    const p = o.properties[0];
    const f0 = remain(2025 - 2015, 47, "0.2");
    const building = floorYen(new Decimal(18000000).mul(div12(remain(2035 - 2015, 47, "0.2"), f0)));
    const value = 12000000 + building;
    const costs = floorYen(new Decimal(value).mul("0.04"));
    expect(p?.sale).toEqual({ ym: "2035-06", value, price: value, costs, proceeds: value - costs });
    expect(p?.years.at(-1)?.year).toBe(2034);
    expect(o.flows.filter((f) => f.row === "cf.income.lumpSum.realEstateSale")).toEqual([{ row: "cf.income.lumpSum.realEstateSale", ym: "2035-06", amount: value - costs, accrualYear: 2035, member: A, object: P, formula: "asset.realEstate.sale" }]);
    expect(o.flows.filter((f) => f.row === "cf.income.other.rental").at(-1)?.ym).toBe("2035-05");
    expect(o.flows.some((f) => f.ym > "2035-05" && f.row === "cf.expense.other.realEstate")).toBe(false);
    expect(p?.income.find((x) => x.year === 2035)?.rent).toBe(o.flows.filter((f) => f.row === "cf.income.other.rental" && f.ym.startsWith("2035")).reduce((s, f) => s + f.amount, 0));
    const r = full(req);
    expect(cells(r, "cf.balance.account.realEstate", 2034)).toBeGreaterThan(0);
    expect(cells(r, "cf.balance.account.realEstate", 2035)).toBe(0);
    expect(notices(r).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("realEstate.saleTax"))).toBe(true);
  });

  it("貸し終わりの後は家賃も減価償却費も無く、年額の経費は持っている間かかる", () => {
    const o = out(base({ accounts: [account(property({ rental: { monthly: box(100000), to: at("2030-12") } }))] }));
    expect(o.flows.some((f) => f.row === "cf.income.other.rental" && f.ym > "2030-12")).toBe(false);
    expect(o.flows.filter((f) => f.row === "cf.expense.other.realEstate" && f.ym.startsWith("2031")).reduce((s, f) => s + f.amount, 0)).toBe(240000);
    expect(o.properties[0]?.income.some((x) => x.year === 2031)).toBe(false);
  });
});

describe("要約の物件ごとの数字（plan.cashflow の details から。帳票の入力の材料）", () => {
  it("summary の realEstate は asset.realEstate の出力の properties と同じ。表の土地と建物の行・家賃収入の行の物の分と一致する", () => {
    const req = base({ accounts: [account(property({ sale: { at: at("2035-06") } }))] });
    (req.input.household as unknown as Obj).debts = [loan()];
    const r = full(req);
    const o = out(req);
    const s = (r.summary as { realEstate?: RealEstateOutput["properties"] }).realEstate;
    expect(s).toEqual(o.properties.map((p) => ({ object: p.object, owner: p.owner, years: p.years, income: p.income, sale: p.sale })));
    const table = r.table as unknown as Cell[];
    for (const y of [2026, 2030, 2034]) {
      const v = s?.[0]?.years.find((e) => e.year === y);
      expect(table.filter((c) => c.object === P && c.year === y && c.row.startsWith("cf.balance.account.realEstate.")).reduce((a, c) => a + c.amount, 0)).toBe(v?.value);
      expect(table.find((c) => c.object === P && c.year === y && c.row === "cf.income.other.rental")?.amount).toBe(s?.[0]?.income.find((e) => e.year === y)?.rent);
    }
  });

  it("中身を入れた不動産が無い世帯では、summary に realEstate の欄が無い", () => {
    const r = full(base({ accounts: [] }));
    expect((r.summary as Obj).realEstate).toBeUndefined();
    const noContent = account();
    delete noContent.property;
    const plain = full(base({ accounts: [noContent] }));
    expect((plain.summary as Obj).realEstate).toBeUndefined();
  });
});

describe("お金の欄（取得の内訳・諸費用・家賃以外の収入・経費の費目・大きな修繕・民泊・宿。0080）", () => {
  const dep = (req: Req, y: number) => out(req).properties[0]?.income.find((x) => x.year === y)?.depreciation;
  const flowsAt = (req: Req, row: string, ym: string, formula?: string) =>
    out(req)
      .flows.filter((f) => f.ym === ym && f.row === row && (formula === undefined || f.formula === formula))
      .reduce((s, f) => s + f.amount, 0);

  it("新しい欄を入れていない世帯の結果は変わらず、自己資金だけを入れても結果は同じ", () => {
    const r0 = full(base());
    const r1 = full(base({ accounts: [account(property({ acquisition: { price: 25000000, at: "2020-04", equity: 5000000 } }))] }));
    expect(r1.table).toEqual(r0.table);
    expect(r1.flows).toEqual(r0.flows);
  });

  it("取得価額の内訳: 土地の割合より優先して分け、建物附属設備は別の耐用年数（法定15年。中古は簡便法）で償却する", () => {
    const parts = { land: 10000000, building: 12000000, equipment: 3000000 };
    const req = base({ accounts: [account(property({ acquisition: { price: 25000000, at: "2020-04", parts } }))] });
    // 建物: 鉄筋コンクリート47年の中古（経過5年）→ 43年 0.024。建物附属設備: 15年の中古（経過5年）→ 15−5＋1＝11年 0.091
    expect(usedLife(15, 5)).toBe(11);
    expect(straightLineRate(11)).toBe("0.091");
    expect(dep(req, 2026)).toBe(12000000 * 0.024 + 3000000 * 0.091);
    // 建物附属設備は11年で帳簿の残りが1円になり、その後は建物の分だけ
    expect(dep(req, 2033)).toBe(288000);
    const sum = out(req).properties[0]?.income.reduce((s, x) => s + x.depreciation, 0) ?? 0;
    expect(sum).toBeGreaterThan(0);
    // 耐用年数を入れたら、その年数で（簡便法を重ねない）
    const ten = base({ accounts: [account(property({ acquisition: { price: 25000000, at: "2020-04", parts, equipmentLife: 10 } }))] });
    expect(dep(ten, 2026)).toBe(288000 + 300000);
  });

  it("取得価額の内訳の土地の割合は、評価額の土地の割合の省略にも使う（目安の知らせを出さない）。入れた土地の割合があればそちら", () => {
    const parts = { land: 7500000, building: 17500000 };
    const noShare = base({ accounts: [account(property({ landShare: undefined, acquisition: { price: 25000000, at: "2020-04", parts } }))] });
    expect(out(noShare).properties[0]?.years.find((x) => x.year === 2026)?.land).toBe(9000000); // 3,000万円×0.3
    expect(notices(full(noShare)).some((n) => n.code === "N_DEFAULT_USED" && n.ids.includes("account.property.landShare"))).toBe(false);
    const withShare = base({ accounts: [account(property({ acquisition: { price: 25000000, at: "2020-04", parts } }))] });
    expect(out(withShare).properties[0]?.years.find((x) => x.year === 2026)?.land).toBe(12000000); // 入れた土地の割合 0.4
    // 減価償却は内訳の建物の額から（1,750万円×0.024）
    expect(dep(withShare, 2026)).toBe(420000);
  });

  it("取得時の諸費用: 建物（と建物附属設備）の分を取得価額の比で償却の基に足す。土地の利息の分も、足した後の建物の額で分ける", () => {
    const req = edit(base({ accounts: [account(property({ acquisition: { price: 25000000, at: "2020-04", costs: 1000000 } }))] }), (h) => (h.debts = [loan()]));
    // 建物 1,500万円＋諸費用 100万円×1,500/2,500＝60万円 → 1,560万円×0.024
    expect(dep(req, 2026)).toBe(374400);
    const e = out(req).properties[0]?.income.find((x) => x.year === 2026);
    expect(e?.landInterest).toBe(floorYen(new Decimal(e?.interest ?? 0).mul(4400000).div(20000000)));
  });

  it("家賃以外の月の収入は家賃と同じ空室の割合・変化率で、割合の経費も掛かる。礼金・更新料は12か月に分け、空室・割合の経費は掛けない", () => {
    const rental = { monthly: box(100000), vacancyRate: "0.05", growth: "-0.01", commonFee: 5000, parking: 10000, keyMoney: 120000 };
    const req = base({ accounts: [account(property({ rental }))] });
    expect(flowsAt(req, "cf.income.other.rental", "2026-01")).toBe(95000 + 14250 + 10000);
    // 2027年: 家賃 99,000×0.95、家賃以外 14,850×0.95（円未満切り捨て）、礼金・更新料 118,800÷12
    expect(flowsAt(req, "cf.income.other.rental", "2027-05")).toBe(94050 + 14107 + 9900);
    // 経費: 年額の12分の1＋（家賃＋家賃以外）×5%
    expect(flowsAt(req, "cf.expense.other.realEstate", "2026-03")).toBe(20000 + floorYen(new Decimal(109250).mul("0.05")));
  });

  it("経費の費目を1つでも入れたら、年額はその合計（年額の欄は使わない）", () => {
    const req = base({ accounts: [account(property({ expenses: { annual: box(240000), items: { management: 120000, propertyTax: 60000 } } }))] });
    expect(flowsAt(req, "cf.expense.other.realEstate", "2026-03")).toBe(15000);
    expect(out(req).properties[0]?.income.find((x) => x.year === 2026)?.expenses).toBe(180000);
  });

  it("大きな修繕: その月の一時の支出にし、貸している月なら全額をその年の経費にする（知らせ）。貸し終わりの後は経費にしない", () => {
    const repairs = [
      { id: uid("rp1"), at: at("2030-06"), amount: 3000000, label: "外壁" },
      { id: uid("rp2"), at: at("2045-03"), amount: 2000000 },
    ];
    const req = base({ accounts: [account(property({ repairs, rental: { monthly: box(100000), to: at("2040-12") } }))] });
    expect(flowsAt(req, "cf.expense.other.realEstate", "2030-06", "asset.realEstate.repair")).toBe(3000000);
    expect(flowsAt(req, "cf.expense.other.realEstate", "2045-03", "asset.realEstate.repair")).toBe(2000000);
    const plainReq = base({ accounts: [account(property({ rental: { monthly: box(100000), to: at("2040-12") } }))] });
    const inc = (r: Req, y: number) => out(r).properties[0]?.income.find((x) => x.year === y);
    expect((inc(req, 2030)?.expenses ?? 0) - (inc(plainReq, 2030)?.expenses ?? 0)).toBe(3000000);
    expect(inc(req, 2045)).toBeUndefined();
    expect(notices(full(req)).some((n) => n.code === "N_ASSUMED" && n.ids.includes("realEstate.repairExpensed"))).toBe(true);
    expect(notices(full(plainReq)).some((n) => n.ids.includes("realEstate.repairExpensed"))).toBe(false);
  });

  it("民泊・宿: 1泊の単価×稼働率×営業日数（住宅宿泊事業は180日まで）を12で割った額を毎月。空室の割合は使わず、仲介サイトの手数料は割合の経費に足す", () => {
    const lodging = { business: "privateLodging", salesBy: "night", nightly: 20000, occupancy: "0.7", days: 200, platformRate: "0.15" };
    const req = base({ accounts: [account(property({ lodging, rental: { monthly: box(0), vacancyRate: "0.1", commonFee: 5000 }, expenses: { annual: box(240000), rate: "0.2" } }))] });
    // 20,000×0.7＝14,000円 ×180日 ÷12＝210,000円（家賃以外の月の収入も使わない）
    expect(flowsAt(req, "cf.income.other.rental", "2026-04")).toBe(210000);
    expect(flowsAt(req, "cf.expense.other.realEstate", "2026-04")).toBe(20000 + 210000 * 0.35);
    const ns = notices(full(req));
    expect(ns.some((n) => n.code === "N_LIMIT_APPLIED" && n.ids.includes("realEstate.lodging.days"))).toBe(true);
    expect(ns.some((n) => n.code === "N_ASSUMED" && n.ids.includes("realEstate.lodgingIncome"))).toBe(true);
    expect(ns.some((n) => n.ids.includes("realEstate.consumptionTax"))).toBe(false);
    // 月の売上の見込み（家賃の欄）で入れたら、その額を空室の割合なしで
    const month = base({ accounts: [account(property({ lodging: { business: "inn" }, rental: { monthly: box(300000), vacancyRate: "0.1" } }))] });
    expect(flowsAt(month, "cf.income.other.rental", "2026-04")).toBe(300000);
    expect(notices(full(month)).some((n) => n.code === "N_LIMIT_APPLIED")).toBe(false);
  });

  it("民泊・宿の売上が年1,000万円を超えると、消費税は計算に入れていないと知らせる", () => {
    const req = base({ accounts: [account(property({ lodging: { business: "inn", salesBy: "night", nightly: 40000, occupancy: "0.8", days: 365 }, rental: { monthly: box(0) } }))] });
    expect(out(req).properties[0]?.income.find((x) => x.year === 2026)?.rent).toBeGreaterThan(10000000);
    expect(notices(full(req)).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("realEstate.consumptionTax"))).toBe(true);
  });

  it("物件のローンに団信があれば、名義の人が亡くなった月の返済の後に残高が消え、その後の利息は不動産所得に入らない", () => {
    const req = edit(base({ baseMonth: "2026-10" }), (h, input) => {
      h.debts = [loan({ creditLife: { covered: [A], events: ["death"] } })];
      input.contingencies = [{ id: uid("cg"), kind: "death", member: A, occurs: at("2030-06") }];
    });
    const sched = call<DebtScheduleOutput>(req, "debt.schedule", { object: L }, realPacks());
    expect(sched.yearEnd.find((x) => x.year === 2029)?.balance).toBeGreaterThan(0);
    expect(sched.yearEnd.find((x) => x.year === 2030)?.balance).toBe(0);
    expect(sched.interest?.find((x) => x.year === 2031)?.amount ?? 0).toBe(0);
    const r = full(req, realPacks());
    expect((r.flows as unknown as { object?: string; ym: string; amount: number }[]).filter((f) => f.object === L && f.ym > "2030-06").reduce((s, f) => s + f.amount, 0)).toBe(0);
  });
});

// 生活費・周期的な支出・車・FP顧問料・現状の検算・退職給付と退職所得の税・役員・小規模企業共済・教育費と公的支援・児童手当の部品のテスト（L1）。
// 【架空の見本】の制度データ（test/fixtures/regulation。製品のパックの値の形を写したもの）で、規則どおりに計算するかを手計算と突き合わせる
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EducationCostOutput, RetirementIncomeOutput, RetirementReceipt } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Cell = { row: string; year: number; amount: number; member?: string; object?: string };
type Flow = { row: string; ym: string; amount: number; member?: string; object?: string; formula: string };
const call = <T>(req: Req, component: string, input: unknown, stubs?: Record<string, (i: unknown) => unknown>): T =>
  runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component, input }, ...(stubs ? { stubs } : {}) }).entryOutput as T;
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const at = (ym: string) => ({ at: ym });
const A = uid("a");
const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
const cells = (r: { table: unknown }, prefix: string, year: number) =>
  (r.table as Cell[]).filter((c) => (c.row === prefix || c.row.startsWith(`${prefix}.`)) && c.year === year).reduce((s, c) => s + c.amount, 0);
const sumFlows = (fs: readonly Flow[], f: (x: Flow) => boolean) => fs.filter(f).reduce((s, x) => s + x.amount, 0);
/** 収入の無い世帯（税・保険料の部品が動かない） */
const quiet = (o: Obj = {}) =>
  household({ members: [member("a", "self", "1980-01")], endYear: 2040, baseMonth: "2027-01", ...o }) as Req;
const withInflation = (req: Req, r = "0.01") => edit(req, (_h, input) => ((input.assumptions as Obj).inflation = { default: r }));

describe("生活費（expense.living）", () => {
  it("総額: 計算基準年の価格の月額を物価上昇率で1年ごとに伸ばし（円未満切り捨て）、段階は最初の額に対する割合", () => {
    const req = withInflation(edit(quiet(), (h) => (h.livingExpenses = [{ id: uid("lv"), mode: "total", monthly: box(100000), stages: [{ at: at("2029-04"), label: "retirement", ratio: "0.8" }] }])));
    const fs = call<{ flows: Flow[] }>(req, "expense.living", {}).flows;
    const year = (y: number) => sumFlows(fs, (f) => f.ym.startsWith(`${y}-`));
    expect(year(2027)).toBe(1200000);
    expect(year(2028)).toBe(1212000);
    // 2029: 1〜3月は 1,224,120/12、4月からは 0.8 を掛けた年額（960,000 を2年伸ばした 979,296）/12
    expect(sumFlows(fs, (f) => f.ym === "2029-01")).toBe(102010);
    expect(sumFlows(fs, (f) => f.ym === "2029-05")).toBe(81608);
    expect(fs.every((f) => f.row === "cf.expense.living")).toBe(true);
  });

  it("費目別: 費目ごとの行（家計調査の区分）。月額の段階は費目の割合で分ける", () => {
    const req = edit(quiet(), (h) => {
      h.livingExpenses = [
        {
          id: uid("lv"),
          mode: "byCategory",
          categories: [
            { category: "food", monthly: box(60000) },
            { category: "utilities", monthly: box(20000) },
          ],
          stages: [{ at: at("2028-01"), monthly: box(40000) }],
          growth: { kind: "none" },
        },
      ];
    });
    const fs = call<{ flows: Flow[] }>(req, "expense.living", {}).flows;
    expect(sumFlows(fs, (f) => f.ym === "2027-03" && f.row === "cf.expense.living.food")).toBe(60000);
    expect(sumFlows(fs, (f) => f.ym === "2027-03" && f.row === "cf.expense.living.utilities")).toBe(20000);
    expect(sumFlows(fs, (f) => f.ym === "2028-03" && f.row === "cf.expense.living.food")).toBe(30000);
    expect(sumFlows(fs, (f) => f.ym === "2028-03" && f.row === "cf.expense.living.utilities")).toBe(10000);
  });

  it("内訳の10費目と仕送り・前の分け方の2費目（0100）: どれも内訳ごとの行で、計算は内訳の合計", () => {
    const keys = ["food", "utilities", "communication", "transit", "furniture", "clothing", "health", "recreation", "pocketAndSocial", "other", "allowance", "transport", "otherConsumption"];
    const req = edit(quiet(), (h) => {
      h.livingExpenses = [{ id: uid("lv"), mode: "byCategory", categories: keys.map((category, i) => ({ category, monthly: box(1000 * (i + 1)) })), growth: { kind: "none" } }];
    });
    const fs = call<{ flows: Flow[] }>(req, "expense.living", {}).flows;
    for (const [i, c] of keys.entries()) expect(sumFlows(fs, (f) => f.ym === "2027-03" && f.row === `cf.expense.living.${c}`), c).toBe(1000 * (i + 1));
    expect(sumFlows(fs, (f) => f.ym === "2027-03")).toBe((1000 * keys.length * (keys.length + 1)) / 2);
    expect(() => full(req)).not.toThrow();
  });
});

describe("周期的な支出・車（expense.periodic・expense.car）", () => {
  it("何年かごとの支出は最初の月から同じ月に、固定の率で伸ばす", () => {
    const req = edit(quiet(), (h) => (h.periodicExpenses = [{ id: uid("pe"), row: "cf.expense.lumpSum.other", from: at("2027-08"), to: at("2033-12"), everyYears: 3, amount: box(500000), growth: { kind: "rate", rate: "0.1" } }]));
    const fs = call<{ flows: Flow[] }>(req, "expense.periodic", {}).flows;
    expect(fs.map((f) => [f.ym, f.amount])).toEqual([
      ["2027-08", 500000],
      ["2030-08", 665500],
      ["2033-08", 885780],
    ]);
  });

  it("車: 購入（下取りを引き、ローンの分を除く）・自動車ローン（debt.schedule）・車検・保険・自動車税、ローンの残高は負債の残高に載る", () => {
    const req = edit(quiet({ endYear: 2034 }), (h) => {
      h.accounts = [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(10000000), asOf: "2027-01", contributions: [] }];
      h.cars = [
        {
          id: uid("car"),
          owner: A,
          purchase: { first: at("2027-04"), everyYears: 5, price: 3000000, tradeIn: 500000 },
          loan: { share: "0.5", rate: "0", termMonths: 50 },
          inspection: { amount: 100000 },
          insurance: { annual: 60000 },
          tax: { annual: 30000 },
          growth: { kind: "none" },
        },
      ];
    });
    const out = call<{ flows: Flow[]; loans: { yearEnd: { year: number; balance: number }[] }[] }>(req, "expense.car", { member: A });
    const f = (ym: string, row: string) => sumFlows(out.flows, (x) => x.ym === ym && x.row === row);
    // 1回目は下取りなし: 3,000,000 の半分をローン（金利0・50回で月30,000）
    expect(f("2027-04", "cf.expense.lumpSum.car")).toBe(1500000);
    expect(f("2027-05", "cf.expense.debt.car")).toBe(30000);
    // 2回目（2032-04）は下取り後の 2,500,000 の半分
    expect(f("2032-04", "cf.expense.lumpSum.car")).toBe(1250000);
    // 車検は購入から3年後・その後2年ごと（次の買い替えの前まで）
    expect(out.flows.filter((x) => x.formula === "expense.car.inspection").map((x) => x.ym)).toEqual(["2030-04"]);
    expect(f("2027-05", "cf.expense.living.car")).toBe(30000);
    expect(f("2028-04", "cf.expense.insurance.nonLife")).toBe(60000);
    const r = full(req);
    expect(cells(r, "cf.balance.debt.other", 2027)).toBe(1500000 - 8 * 30000);
  });
});

describe("車の維持費と万一のときの扱い（expense.car 改訂2）", () => {
  const B = uid("b");
  const couple = (car: Obj, contingency?: Obj) =>
    edit(quiet({ endYear: 2034, members: [member("a", "self", "1980-01"), member("b", "spouse", "1982-01", { sex: "female" })] }), (h, input) => {
      h.relations = [{ type: "spouse", a: A, b: B, marriage: "legal", from: null, to: null }];
      h.accounts = [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(10000000), asOf: "2027-01", contributions: [] }];
      h.cars = [{ id: uid("car"), owner: B, purchase: { first: at("2027-04"), everyYears: 5, price: 2000000 }, growth: { kind: "none" }, ...car }];
      if (contingency !== undefined) input.contingencies = [contingency];
    });
  it("維持費の合計・駐車場代・燃料代は年額の12分の1を持っている間の毎月（端数は年の初めの月から）", () => {
    const req = couple({ upkeep: { annual: 120005 }, parking: { annual: 120000 }, fuel: { annual: 60000 } });
    const out = call<{ flows: Flow[] }>(req, "expense.car", { member: B }).flows;
    const by = (formula: string, ym: string) => sumFlows(out, (f) => f.formula === formula && f.ym === ym);
    expect(by("expense.car.upkeep", "2027-03")).toBe(0);
    expect(by("expense.car.upkeep", "2027-04")).toBe(10000);
    expect(by("expense.car.parking", "2027-05")).toBe(10000);
    expect(by("expense.car.fuel", "2028-01")).toBe(5000);
    expect(sumFlows(out, (f) => f.formula === "expense.car.upkeep" && f.ym.startsWith("2028-"))).toBe(120005);
    expect(out.filter((f) => f.formula.startsWith("expense.car.") && f.formula !== "expense.car.purchase").every((f) => f.row === "cf.expense.living.car")).toBe(true);
  });
  it("万一のときに止める車は、万一の月の翌月から購入も維持費も止まる。組んだローンの返済は続く", () => {
    const death = { id: uid("cg"), kind: "death", member: A, occurs: at("2029-06") };
    const keep = couple({ parking: { annual: 120000 }, loan: { rate: "0", termMonths: 60 } }, death);
    const stop = couple({ parking: { annual: 120000 }, loan: { rate: "0", termMonths: 60 }, onContingency: { mode: "stop" } }, death);
    const half = couple({ parking: { annual: 120000 }, onContingency: { mode: "ratio", ratio: "0.5" } }, death);
    const f = (req: Req, formula: string, ym: string) => sumFlows(call<{ flows: Flow[] }>(req, "expense.car", { member: B }).flows, (x) => x.formula.startsWith(formula) && x.ym === ym);
    expect(f(keep, "expense.car.parking", "2029-07")).toBe(10000);
    expect(f(stop, "expense.car.parking", "2029-06")).toBe(10000);
    expect(f(stop, "expense.car.parking", "2029-07")).toBe(0);
    expect(f(half, "expense.car.parking", "2029-07")).toBe(5000);
    // 2回目の購入（2032-04）: 止める車は買わない・ローンも組まない。割合なら半分
    expect(f(stop, "expense.car.purchase", "2032-04")).toBe(0);
    expect(f(half, "expense.car.purchase", "2032-04")).toBe(1000000);
    // 1回目のローン（2027年）の返済は万一の後も続く
    const loanFlows = (req: Req) => call<{ flows: Flow[] }>(req, "expense.car", { member: B }).flows.filter((x) => x.row === "cf.expense.debt.car" && x.ym === "2030-01");
    expect(loanFlows(stop).reduce((s2, x) => s2 + x.amount, 0)).toBe(loanFlows(keep).reduce((s2, x) => s2 + x.amount, 0));
    expect(loanFlows(stop).length).toBeGreaterThan(0);
  });
});

describe("FP顧問料（expense.advisoryFee）と要約", () => {
  const fee = (o: Obj = {}) =>
    edit(quiet(), (h) => {
      h.accounts = [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(5000000), asOf: "2027-01", contributions: [] }];
      h.advisoryFees = [{ id: uid("fee"), payer: A, terms: { oneTime: [{ at: at("2027-02"), amount: 300000 }], recurring: { from: at("2027-04"), to: at("2030-03"), annual: 120000, revision: { rate: "0.05" } } }, ...o }];
    });
  it("単発と継続（年額を始めの月に毎年。改定率を1年ごとに）を、生活費と別の行 cf.expense.advisoryFee に。個人の顧問料は所得から引かない（知らせ）", () => {
    const r = full(fee());
    expect(cells(r, "cf.expense.advisoryFee", 2027)).toBe(420000);
    expect(cells(r, "cf.expense.advisoryFee", 2028)).toBe(126000);
    expect(cells(r, "cf.expense.advisoryFee", 2029)).toBe(132300);
    expect(cells(r, "cf.expense.advisoryFee", 2030)).toBe(0);
    expect(notices(r).some((n) => n.code === "N_NOT_DEDUCTIBLE")).toBe(true);
    const s = (r as unknown as { summary: { advisoryFee: { total: number; byYear: { year: number; cumulative: number }[]; contracts: { object: string }[] } } }).summary;
    expect(s.advisoryFee.total).toBe(678300);
    expect(s.advisoryFee.byYear.find((y) => y.year === 2028)?.cumulative).toBe(546000);
    expect(s.advisoryFee.contracts[0]?.object).toBe(uid("fee"));
  });
  it("enabled: false の契約は計算しない（案ごとの ON/OFF）。顧問料は税・社会保険料を変えない", () => {
    const off = full(fee({ enabled: false }));
    expect(cells(off, "cf.expense.advisoryFee", 2027)).toBe(0);
    expect((off as unknown as { summary: Obj }).summary.advisoryFee).toBeUndefined();
    const on = full(fee());
    expect(cells(on, "cf.taxSi", 2028)).toBe(cells(off, "cf.taxSi", 2028));
  });
});

describe("現状の検算（expense.reconcile）", () => {
  const mk = (actual: number, treatment = "keepUnexplained") =>
    edit(household({ members: [member("a", "self", "1985-01")], periods: [period("p", { member: "a", from: "2010-04", annual: 6000000, std: [500000, 500000] })], baseMonth: "2027-01", endYear: 2030 }), (h) => {
      h.accounts = [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(1000000), asOf: "2027-01", contributions: [] }];
      h.savingsChecks = [{ id: uid("chk"), year: 2027, actualSavings: box(actual), treatment }];
    });
  it("計算上の貯蓄額（年間収支）と実際の貯蓄額の差を使途不明金として毎月載せ、年間収支から引く", () => {
    const base = full(mk(0));
    const computed = (call<{ checks: { computed: number }[] }>(mk(0), "expense.reconcile", {}).checks[0] as { computed: number }).computed;
    const r = full(mk(1000000));
    expect(cells(r, "cf.expense.other.unexplained", 2027)).toBe(computed - 1000000);
    expect(cells(r, "cf.net", 2027)).toBe(1000000);
    expect(cells(base, "cf.net", 2027)).toBe(0);
  });
  it("生活費に足す扱いは cf.expense.living。計算より多く貯まっていれば載せずに知らせる", () => {
    const r = full(mk(1000000, "addToLiving"));
    expect(cells(r, "cf.expense.living", 2027)).toBeGreaterThan(0);
    expect(cells(r, "cf.expense.other.unexplained", 2027)).toBe(0);
    const surplus = full(mk(99000000));
    expect(notices(surplus).some((n) => n.code === "N_RECONCILE_SURPLUS")).toBe(true);
  });
});

describe("退職所得の分離課税（tax.retirementIncome）", () => {
  const receipt = (o: Omit<Partial<RetirementReceipt>, "amount"> & { ym: string; amount: number; serviceFrom: string; serviceTo: string }): RetirementReceipt =>
    ({ object: uid(`r.${o.ym}`), source: "retirement", ...o }) as RetirementReceipt;
  // 税率の表は製品のパック（架空の見本の税率は実在の値と違う）
  const tax = (year: number, receipts: RetirementReceipt[]) =>
    runEngine(quiet({ baseMonth: "2027-01" }), realPacks(), { checkInternal: true, entry: { component: "tax.retirementIncome", input: { member: A, year } }, stubs: { "retirement.receipts": () => ({ receipts }) } })
      .entryOutput as RetirementIncomeOutput;

  it("勤続30年・2,000万円: 控除 800万＋70万×10＝1,500万、課税退職所得 250万、所得税 (250万×10%−97,500)×102.1%、住民税 10%", () => {
    const t = tax(2030, [receipt({ ym: "2030-04", amount: 20000000, serviceFrom: "2000-04", serviceTo: "2030-03" })]);
    expect(t.years).toBe(30);
    expect(t.deduction).toBe(15000000);
    expect(t.taxable).toBe(2500000);
    expect(t.incomeTax).toBe(155702);
    expect(t.residentTax).toBe(250000);
    expect(t.flows.map((f) => f.row).sort()).toEqual(["cf.taxSi.incomeTax.retirement", "cf.taxSi.residentTax.retirement"]);
  });

  it("勤続年数の1年未満は切り上げ、控除は最低80万円", () => {
    expect(tax(2030, [receipt({ ym: "2030-04", amount: 3000000, serviceFrom: "2020-02", serviceTo: "2030-03" })]).years).toBe(11);
    expect(tax(2030, [receipt({ ym: "2030-04", amount: 500000, serviceFrom: "2029-10", serviceTo: "2030-03" })]).deduction).toBe(800000);
  });

  it("短期退職手当等（勤続5年以下・役員以外）: 控除の後の300万円を超える部分は1/2にしない", () => {
    const t = tax(2030, [receipt({ ym: "2030-04", amount: 6000000, serviceFrom: "2026-04", serviceTo: "2030-03" })]);
    expect(t.deduction).toBe(1600000);
    expect(t.income).toBe(1500000 + 1400000);
  });

  it("特定役員退職手当等（役員等の勤続5年以下）は1/2にしない", () => {
    const t = tax(2030, [receipt({ ym: "2030-04", amount: 5000000, serviceFrom: "2027-04", serviceTo: "2030-03", officerFrom: "2027-04", officerTo: "2030-03" })]);
    expect(t.income).toBe(5000000 - 1200000);
  });

  it("重複排除期間: 前年以前4年内の退職手当等と重なる勤続期間の控除を引く（DC 一時金が先なら9年内、DC 一時金を受ける年は19年内）", () => {
    const dc = receipt({ ym: "2030-06", amount: 15000000, serviceFrom: "2005-04", serviceTo: "2030-05", source: "dc" });
    const later = (y: number) => receipt({ ym: `${y}-04`, amount: 20000000, serviceFrom: "2000-04", serviceTo: `${y}-03` });
    // DC 一時金（2030年）の6年後の退職金: 9年内なので重なる25年分（2005-04〜2030-03 の 300か月）の控除を引く
    const t = tax(2036, [dc, later(2036)]);
    expect(t.overlapYears).toBe(25);
    expect(t.deduction).toBe(8000000 + 700000 * 16 - (8000000 + 700000 * 5));
    // 10年後なら重ならない
    expect(tax(2040, [dc, later(2040)]).overlapYears).toBe(0);
    // 退職金（2030年）の後に DC 一時金（2045年）: 19年内
    const ret = later(2030);
    const dcLater = receipt({ ym: "2045-06", amount: 5000000, serviceFrom: "2005-04", serviceTo: "2045-05", source: "dc" });
    expect(tax(2045, [ret, dcLater]).overlapYears).toBe(25);
  });

  it("前年以前9年内に DC 一時金があれば、前の退職手当等も9年内で見る（施行令70条1項2号ロ(1)。PR #14 の 8 の(1)）", () => {
    const dc = receipt({ ym: "2030-06", amount: 15000000, serviceFrom: "2005-04", serviceTo: "2030-05", source: "dc" });
    // 2031年の退職金（6年前。4年内ではないが、9年内に DC 一時金があるので9年内で見る）と重なる 2026-04〜2031-03 の5年
    const r1 = receipt({ ym: "2031-04", amount: 3000000, serviceFrom: "2026-04", serviceTo: "2031-03" });
    const r2 = receipt({ ym: "2037-04", amount: 8000000, serviceFrom: "2026-04", serviceTo: "2037-03" });
    expect(tax(2037, [dc, r1, r2]).overlapYears).toBe(5);
    // DC 一時金が無ければ、2031年の退職金は4年内の外
    expect(tax(2037, [r1, r2]).overlapYears).toBe(0);
  });

  it("DC 一時金を受ける年の19年内は、令和4年4月1日以後に支払を受けるものから（3月までは14年内。支払の月で分かれる）", () => {
    // 前の退職金は2006年（2022年の16年前）。2022年3月の DC 一時金は14年内なので重ならず、4月なら19年内で重なる
    const ret = receipt({ ym: "2006-04", amount: 10000000, serviceFrom: "1996-04", serviceTo: "2006-03" });
    const dcAt = (ym: string) => receipt({ ym, amount: 5000000, serviceFrom: "2001-04", serviceTo: "2022-02", source: "dc" });
    // 2022年の税率の表は製品のパックに無いので、架空の見本のパック（製品と同じ区切りの形）で計算する
    const at = (ym: string) =>
      runEngine(quiet({ baseMonth: "2027-01" }), fictionalPacks(), { checkInternal: true, entry: { component: "tax.retirementIncome", input: { member: A, year: 2022 } }, stubs: { "retirement.receipts": () => ({ receipts: [ret, dcAt(ym)] }) } })
        .entryOutput as RetirementIncomeOutput;
    expect(at("2022-03").overlapYears).toBe(0);
    expect(at("2022-04").overlapYears).toBe(5);
  });

  it("前の一時金がその控除額に満たないときは、前の勤続期間を額から換算した年数（切り捨て）とみなす", () => {
    // 前: 2026年に500万円・勤続20年（控除800万）→ 500万÷40万＝12年 → 2006-04 から12年分だけ重なる
    const prev = receipt({ ym: "2026-04", amount: 5000000, serviceFrom: "2006-04", serviceTo: "2026-03" });
    const now = receipt({ ym: "2029-04", amount: 10000000, serviceFrom: "2006-04", serviceTo: "2029-03" });
    expect(tax(2029, [prev, now]).overlapYears).toBe(12);
  });

  it("同じ年に2回受けると、2回目は合わせた税額との差を源泉徴収する", () => {
    const t = tax(2030, [
      receipt({ ym: "2030-04", amount: 10000000, serviceFrom: "2000-04", serviceTo: "2030-03" }),
      receipt({ ym: "2030-06", amount: 15000000, serviceFrom: "2000-04", serviceTo: "2030-03" }),
    ]);
    const it2 = t.flows.filter((f) => f.row === "cf.taxSi.incomeTax.retirement");
    expect(it2.map((f) => f.ym)).toEqual(["2030-06"]);
    expect(it2[0]?.amount).toBe(t.incomeTax);
  });
});

describe("退職給付（retirement.benefit）・小規模企業共済（account.mutualAid）", () => {
  const mk = (benefits: Obj[], extra: (h: Obj) => void = () => {}) =>
    edit(household({ members: [member("a", "self", "1970-01")], periods: [period("p", { member: "a", from: "1995-04", to: "2032-03", annual: 6000000, std: [500000, 500000] })], baseMonth: "2027-01", endYear: 2045 }), (h) => {
      h.retirementBenefits = benefits;
      h.accounts = [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(5000000), asOf: "2027-01", contributions: [] }];
      extra(h);
    });
  it("退職一時金は働き方の期間の終わりの翌月に、勤続期間つきで退職所得の一時金になる", () => {
    const req = mk([{ id: uid("rb"), member: A, kind: "lumpSum", employment: uid("p"), amount: box(20000000) }]);
    const out = call<{ receipts: RetirementReceipt[] }>(req, "retirement.receipts", { member: A });
    expect(out.receipts).toEqual([{ ym: "2032-04", amount: 20000000, object: uid("rb"), source: "retirement", serviceFrom: "1995-04", serviceTo: "2032-03" }]);
    expect(cells(full(req), "cf.taxSi.incomeTax.retirement", 2032)).toBeGreaterThan(0);
  });

  it("勤め先の期間が無い退職金は、黙って落とさず知らせる（受け取る時期が決まらない・指す先の無い勤め先。0163）", () => {
    const gone = "00000000-0000-4000-8000-00000000dead";
    const dangling = full(mk([{ id: uid("rb"), member: A, kind: "lumpSum", employment: gone, amount: box(20000000) }]));
    expect(cells(dangling, "cf.income.lumpSum.retirement", 2032)).toBe(0);
    const ids = notices(dangling).filter((n) => n.code === "N_INPUT_REQUIRED").map((n) => n.ids.join(","));
    expect(ids).toContain(`reference.retirementBenefit.employment,${uid("rb")}`);
    expect(ids).toContain(`retirement.benefit,${uid("rb")},retirementBenefit.paidAt`);
    // 勤め先を空にしても（受け取る時期も勤続期間も無い）、受け取る時期の知らせは出る。指す先の知らせは出ない
    const cleared = notices(full(mk([{ id: uid("rb"), member: A, kind: "lumpSum", amount: box(20000000) }]))).filter((n) => n.code === "N_INPUT_REQUIRED").map((n) => n.ids.join(","));
    expect(cleared).toContain(`retirement.benefit,${uid("rb")},retirementBenefit.paidAt`);
    expect(cleared.some((x) => x.startsWith("reference."))).toBe(false);
    // 勤め先があれば、どちらも出ない
    const ok = notices(full(mk([{ id: uid("rb"), member: A, kind: "lumpSum", employment: uid("p"), amount: box(20000000) }]))).map((n) => n.ids.join(","));
    expect(ok.some((x) => x.includes("retirementBenefit.paidAt") || x.startsWith("reference."))).toBe(false);
  });

  it("DB の併用: 一時金と、残りを予定利率0で年数に等分した年金（年6回）。年金は公的年金等の収入", () => {
    const req = mk([{ id: uid("db"), member: A, kind: "db", employment: uid("p"), amount: box(12000000), receipt: { method: "mixed", lumpShare: "0.5", years: 10 } }]);
    const out = call<{ flows: Flow[]; annuities: { ym: string; amount: number }[] }>(req, "retirement.benefit", { member: A });
    expect(sumFlows(out.flows, (f) => f.row === "cf.income.lumpSum.db")).toBe(6000000);
    expect(out.annuities.filter((p) => p.ym.startsWith("2033-")).reduce((s, p) => s + p.amount, 0)).toBe(600000);
    expect(out.annuities.length).toBe(60);
    expect(call<{ revenue: number }>(req, "tax.publicPensionIncome", { member: A, year: 2033 }).revenue).toBeGreaterThanOrEqual(600000);
  });

  it("役員退職慰労金の見込み: 最終報酬月額×在任年数（切り上げ）×功績倍率", () => {
    const req = mk([{ id: uid("off"), member: A, kind: "officerAllowance", officerService: { from: at("2027-04"), to: at("2030-09") }, paidAt: at("2030-10"), estimate: { finalMonthly: 800000, multiplier: "2" } }]);
    const out = call<{ receipts: RetirementReceipt[] }>(req, "retirement.benefit", { member: A });
    expect(out.receipts[0]?.amount).toBe(800000 * 4 * 2);
  });

  it("国民年金基金の掛金は社会保険料（控除の対象）、年金は公的年金等", () => {
    const req = mk([{ id: uid("npf"), member: A, kind: "nationalPensionFund", contributions: { monthly: 20000, from: at("2027-01"), to: at("2029-12") }, receipt: { start: at("2035-01"), years: null, annualAmount: 240000 } }]);
    expect(call<{ amount: number }>(req, "tax.socialInsurancePaid", { member: A, year: 2028 }).amount).toBeGreaterThanOrEqual(240000);
    expect(cells(full(req), "cf.income.corporatePension.nationalPensionFund", 2036)).toBe(240000);
  });

  it("小規模企業共済: 掛金は上限で止めて全額が小規模企業共済等掛金控除、一括は退職所得、分割は公的年金等", () => {
    const req = mk([], (h) => {
      (h.accounts as Obj[]).push({
        id: uid("ma"),
        kind: "smallBusinessMutualAid",
        owner: A,
        marketValue: box(1000000),
        asOf: "2027-01",
        enrolledSince: "2017-04",
        contributions: [{ from: at("2027-01"), to: null, monthly: 80000 }],
        payout: { start: at("2035-04"), method: "mixed", lumpShare: "0.5", annuityYears: 10 },
      });
    });
    const out = call<{ paid: { amount: number }[]; receipts: RetirementReceipt[]; annuities: { amount: number }[] }>(req, "account.mutualAid", { member: A });
    expect(out.paid[0]?.amount).toBe(70000);
    const ded = call<{ smallBusiness: number }>(req, "tax.deductions", { member: A, year: 2028, regime: "incomeTax" });
    expect(ded.smallBusiness).toBe(840000);
    expect(out.receipts[0]?.source).toBe("mutualAid");
    expect(out.receipts[0]?.serviceFrom).toBe("2017-04");
    expect(out.annuities.length).toBe(60);
    const r = full(req);
    expect(cells(r, "cf.transfer.mutualAid", 2028)).toBe(840000);
    expect(cells(r, "cf.balance.account.smallBusinessMutualAid", 2030)).toBeGreaterThan(0);
  });
});

describe("役員（executive）", () => {
  const mk = (to: string | null = null, birth = "1980-01") =>
    household({ members: [member("a", "self", birth)], periods: [period("e", { member: "a", from: "2020-04", to, type: "executive", annual: 12000000, bonus: 1200000, std: [650000, 650000] })], baseMonth: "2027-01", endYear: 2036 });
  it("役員報酬は cf.income.salary.executive。健康保険・厚生年金に入り、雇用保険には入らない", () => {
    const req = mk();
    const r = full(req);
    expect(cells(r, "cf.income.salary.executive", 2028)).toBe(13200000);
    expect(cells(r, "cf.taxSi.employment", 2028)).toBe(0);
    expect(cells(r, "cf.taxSi.pension", 2028)).toBeGreaterThan(0);
    const st = call<{ months: { month: string; employment: boolean; health: boolean; pension: boolean }[] }>(req, "socialInsurance.employeeStatus", { member: A });
    const m = st.months.find((x) => x.month === "2028-05");
    expect([m?.health, m?.pension, m?.employment]).toEqual([true, true, false]);
  });
  it("70歳以降も働く月は、保険料はかからず、在職老齢年金の基にする標準報酬月額に相当する額が出る", () => {
    const req = mk(null, "1958-01");
    const cov = call<{ months: { month: string; pensionStd: number | null; workingStd?: number }[] }>(req, "socialInsurance.coverage", { member: A, fromYear: 2027 });
    const m = cov.months.find((x) => x.month === "2029-06");
    expect(m?.pensionStd).toBeNull();
    expect(m?.workingStd).toBe(650000);
  });
});

describe("教育費（education.cost）・公的支援（education.support）・児童手当（benefit.childAllowance）", () => {
  const C = uid("c");
  const mk = (stages: Obj[], o: Obj = {}, birth = "2012-06", annual = 5000000) =>
    edit(
      household({
        members: [member("a", "self", "1980-01"), member("c", "child", birth)],
        relations: [{ type: "parentOf", parent: A, child: C }],
        periods: [period("p", { member: "a", from: "2005-04", annual, std: [400000, 400000] })],
        baseMonth: "2027-01",
        endYear: 2036,
      }),
      (h) => {
        h.goals = [{ id: uid("g"), kind: "education", owner: C, education: { stages, ...o } }];
      },
    );
  const flowsOf = (req: Req) => call<EducationCostOutput>(req, "education.cost", { member: C });

  it("学年は4月2日区切り: 2012年6月生まれは2028年4月に高校、2031年4月に大学。私立大学の入学金は入学の前の2月、授業料は4月と10月に半分ずつ", () => {
    const out = flowsOf(mk([{ stage: "highSchool", sector: "private" }, { stage: "university", sector: "private", field: "humanities" }]));
    expect(out.enrollments.map((e) => [e.stage, e.from])).toEqual([
      ["highSchool", "2028-04"],
      ["university", "2031-04"],
    ]);
    const f = out.flows as unknown as Flow[];
    expect(f.filter((x) => x.row === "cf.expense.education.entrance").map((x) => x.ym)).toEqual(["2031-02"]);
    expect(f.filter((x) => x.formula === "education.cost.tuition" && x.ym.startsWith("2031")).map((x) => x.ym)).toEqual(["2031-04", "2031-10"]);
  });

  it("4月1日生まれは前の学年（2012年4月1日生まれは2027年4月に高校）", () => {
    const req = edit(mk([{ stage: "highSchool" }], {}, "2012-04"), (h) => (((h.members as Obj[])[1] as Obj).birth = { birthYearMonth: "2012-04", bornOnFirst: true }));
    expect(flowsOf(req).enrollments[0]?.from).toBe("2027-04");
  });

  it("学校が決まっていれば学費データの行（入学年度×年次×費目×支払月）で上書きし、別の入学年度の行なら推計と知らせる", () => {
    const rows = [
      { entryYear: 2031, grade: 1, item: "tuition.admission", monthOffset: -2, amount: 300000 },
      ...[1, 2, 3, 4].flatMap((g) => [
        { entryYear: 2031, grade: g, item: "tuition.annual", monthOffset: 0, amount: 500000 },
        { entryYear: 2031, grade: g, item: "tuition.annual", monthOffset: 6, amount: 500000 },
      ]),
    ];
    const school = { school: "X000000000001", unit: "X000000000001/d001", rows, source: { pack: "master.education.tuition", version: "2026.1.0", fictional: true } };
    const out = flowsOf(mk([{ stage: "university", sector: "private", school }]));
    expect(sumFlows(out.flows as unknown as Flow[], (x) => x.ym === "2031-02")).toBe(300000);
    expect(out.enrollments[0]?.fees.find((x) => x.fiscalYear === 2032)?.tuition).toBe(1000000);
    const later = mk([{ stage: "university", sector: "private", school: { ...school, rows: rows.map((r) => ({ ...r, entryYear: 2029 })) } }]);
    expect(notices(full(later)).some((n) => n.code === "N_ESTIMATED")).toBe(true);
  });

  it("保育料は3歳になった後の最初の4月から無償", () => {
    const out = call<{ flows: Flow[] }>(mk([{ stage: "nursery", from: at("2027-04"), monthly: 40000 }], {}, "2025-05"), "education.nurseryFee", { member: C });
    const ns = out.flows.filter((x) => x.row === "cf.expense.education.nursery");
    expect(ns[0]?.ym).toBe("2027-04");
    expect(ns.at(-1)?.ym).toBe("2029-03");
  });

  it("高校の就学支援金（私立の上限）と、大学の修学支援（住民税の課税標準額から区分。非課税なら第I区分で授業料・入学金を上限まで減免と給付型奨学金）", () => {
    const req = mk([{ stage: "highSchool", sector: "private" }, { stage: "university", sector: "private", living: "away" }], {}, "2012-06", 0);
    const f = call<{ flows: Flow[] }>(req, "education.support", { member: C }).flows;
    expect(sumFlows(f, (x) => x.formula === "education.support.highSchool" && x.ym >= "2028-04" && x.ym <= "2029-03")).toBe(457200);
    expect(sumFlows(f, (x) => x.formula === "education.support.tuitionWaiver" && x.ym.startsWith("2031"))).toBe(700000);
    // 入学金は統計の平均（240,365円）が上限（26万円）より小さいので全額
    expect(sumFlows(f, (x) => x.formula === "education.support.admissionWaiver")).toBe(240365);
    expect(sumFlows(f, (x) => x.formula === "education.support.grant" && x.ym === "2031-05")).toBe(75800);
    expect(f.every((x) => x.row === "cf.income.benefit.education" && x.member === A)).toBe(true);
  });

  it("修学支援: 住民税の決定額だけの年度は、決定額の10分の6を支給額算定基準額とみなす（知らせ。改訂3）", () => {
    // 大学の1年目（2031年度）。4〜9月は2030年度の住民税（収入なしで非課税 → 第I区分）、10〜3月は2031年度の決定額 40,000円 → 24,000円（第II区分）。
    // 前は課税標準額を0円とみなし、決定額がいくらでも第I区分になっていた
    const req = edit(mk([{ stage: "university", sector: "private", living: "home" }], {}, "2012-06", 0), (h) => {
      h.residentTaxAssessments = [{ id: uid("rt"), member: A, fiscalYear: 2031, amount: box(40000) }];
    });
    const r = runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "education.support", input: { member: C } } });
    const f = (r.entryOutput as { flows: Flow[] }).flows;
    expect(sumFlows(f, (x) => x.formula === "education.support.grant" && x.ym === "2031-05")).toBe(38300);
    expect(sumFlows(f, (x) => x.formula === "education.support.grant" && x.ym === "2031-11")).toBe(25600);
    expect(notices(r)).toContainEqual({ code: "N_APPROXIMATED", ids: ["education.support", "educationSupport.higher.assessedResidentTax"] });
    // 決定額 300,000円 → 180,000円（対象外）
    const high = edit(req, (h) => ((h.residentTaxAssessments as Obj[])[0]!.amount = box(300000)));
    expect(sumFlows(call<{ flows: Flow[] }>(high, "education.support", { member: C }).flows, (x) => x.ym >= "2031-10" && x.ym <= "2032-03")).toBe(0);
  });

  it("修学支援: 計算基準月より前に終わる半期は判定しない。計算基準月が6〜9月の年の4〜9月の分は、計算基準月に払っている住民税の年度で判定する（改訂3）", () => {
    // 2008年6月生まれは2027年4月に大学。計算基準月 2027年7月: 7〜9月の分は本来は2026年度の住民税（収入なしで非課税）で判定するが、
    // 表に載る最初の年度の2027年度の住民税（決定額 300,000円 → 対象外）で判定する
    const req = edit(mk([{ stage: "university", sector: "private", living: "home" }], {}, "2008-06", 0), (h, input) => {
      input.baseMonth = "2027-07";
      h.residentTaxAssessments = [{ id: uid("rt"), member: A, fiscalYear: 2027, amount: box(300000) }];
    });
    const f = call<{ flows: Flow[] }>(req, "education.support", { member: C }).flows;
    expect(sumFlows(f, (x) => x.ym <= "2028-03")).toBe(0);
    // 2028年度の10〜3月は2028年度の住民税（収入なしで非課税 → 第I区分）
    expect(sumFlows(f, (x) => x.formula === "education.support.grant" && x.ym === "2028-11")).toBe(38300);
  });

  describe("大学の修学支援の多子世帯は、住民税の扶養で数える（日本学生支援機構: 前期は前々年・後期は前年の12月31日の扶養）", () => {
    // 親（年収1,000万円。所得では区分の対象外）・上の子 e・大学に入る子 c（2012年6月生まれ。2031年4月に私立大学）・下の子 y
    const E = uid("e");
    const mkMulti = (eBirth: string, eJob?: { from: string; annual: number }) =>
      edit(
        household({
          members: [member("a", "self", "1975-01"), member("e", "child", eBirth), member("c", "child", "2012-06"), member("y", "child", "2015-06")],
          relations: [E, C, uid("y")].map((child) => ({ type: "parentOf", parent: A, child })),
          periods: [
            period("p", { member: "a", from: "2000-04", annual: 10000000, std: [650000, 650000] }),
            ...(eJob
              ? [period("pe", { member: "e", from: eJob.from, type: "partTime", annual: eJob.annual, pensionCategory: "none", healthInsurance: { kind: "dependent" }, extra: { employmentInsuranceCovered: false } })]
              : []),
          ],
          baseMonth: "2027-01",
          endYear: 2036,
        }),
        (h) => {
          h.goals = [{ id: uid("g"), kind: "education", owner: C, education: { stages: [{ stage: "university", sector: "private" }] } }];
        },
      );
    const waiver = (req: Req, ym: string) => {
      const f = runEngine(req, realPacks(), { checkInternal: true, entry: { component: "education.support", input: { member: C } } }).entryOutput as { flows: Flow[] };
      return sumFlows(f.flows, (x) => x.formula === "education.support.tuitionWaiver" && x.ym === ym);
    };

    it("上の子が22歳を過ぎても、所得が無く扶養に残っていれば（浪人・大学院など）数える", () => {
      const req = mkMulti("2004-06");
      expect(waiver(req, "2031-04") + waiver(req, "2031-10")).toBe(700000);
    });

    it("上の子が18歳で就職して扶養を外れたら数えない", () => {
      const req = mkMulti("2010-06", { from: "2029-04", annual: 3000000 });
      expect(waiver(req, "2031-04") + waiver(req, "2031-10")).toBe(0);
    });

    it("前期（4〜9月）は前々年、後期（10〜3月）は前年の12月31日の扶養で数える", () => {
      // 上の子が2030年4月に就職: 2029年12月31日は扶養（前期は多子世帯）、2030年12月31日は扶養を外れる（後期は対象外）
      const req = mkMulti("2007-06", { from: "2030-04", annual: 3000000 });
      expect(waiver(req, "2031-04")).toBe(350000);
      expect(waiver(req, "2031-10")).toBe(0);
    });

    it("特定親族特別控除の年齢（19〜22歳）で合計所得金額が95万円以下の子も数える", () => {
      // 給与150万円（所得は扶養の上限58万円を超え、95万円以下）: 数える
      const within = mkMulti("2010-06", { from: "2029-04", annual: 1500000 });
      expect(waiver(within, "2031-04") + waiver(within, "2031-10")).toBe(700000);
      // 給与200万円: 2029年（4〜12月の150万円）は95万円以下で数え、2030年（200万円）は95万円を超えるので数えない
      const over = mkMulti("2010-06", { from: "2029-04", annual: 2000000 });
      expect(waiver(over, "2031-04")).toBe(350000);
      expect(waiver(over, "2031-10")).toBe(0);
    });
  });

  it("児童手当: 3歳未満15,000円・3歳から10,000円・第3子30,000円、偶数月に前2か月分", () => {
    const req = edit(
      household({ members: [member("a", "self", "1985-01"), member("c1", "child", "2010-05"), member("c2", "child", "2016-05"), member("c3", "child", "2026-03")], baseMonth: "2027-01", endYear: 2030 }),
      () => {},
    );
    const f = call<{ flows: Flow[] }>(req, "benefit.childAllowance", {}).flows;
    const paid = (ym: string, c: string) => sumFlows(f, (x) => x.ym === ym && x.object === uid(c));
    expect(paid("2027-02", "c1")).toBe(20000);
    expect(paid("2027-02", "c3")).toBe(60000);
    expect(f.every((x) => Number(x.ym.slice(5)) % 2 === 0)).toBe(true);
    // 第1子が18歳の年度末（2029年3月）を過ぎても22歳の年度末までは数えるので、第3子は30,000円のまま
    expect(paid("2029-06", "c3")).toBe(60000);
  });

  it("高校の就学支援金は、国籍・在留資格の要件で対象外にした子には出さない（知らせ。PR #14 の 8 の(5)）", () => {
    const req = mk([{ stage: "highSchool", sector: "private" }], { highSchoolSupport: "ineligible" }, "2012-06", 0);
    const r = runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "education.support", input: { member: C } } });
    expect(sumFlows((r.entryOutput as { flows: Flow[] }).flows, (x) => x.formula === "education.support.highSchool")).toBe(0);
    expect(notices(r)).toContainEqual({ code: "N_NOT_ELIGIBLE", ids: ["education.support", "educationSupport.highSchool.nationality", C] });
  });

  it("児童手当の3歳の切り替えは誕生日の属する月の翌月から（1日生まれも同じ。PR #14 の 8 の(2)）", () => {
    for (const bornOnFirst of [false, true]) {
      const req = edit(household({ members: [member("a", "self", "1985-01"), member("c", "child", "2024-05", { birth: { birthYearMonth: "2024-05", bornOnFirst } })], baseMonth: "2027-01", endYear: 2028 }), () => {});
      const f = call<{ flows: Flow[] }>(req, "benefit.childAllowance", {}).flows;
      const paid = (ym: string) => sumFlows(f, (x) => x.ym === ym);
      // 6月の支払いは4・5月分（3歳未満）、8月の支払いは6・7月分（3歳から）
      expect(paid("2027-06")).toBe(30000);
      expect(paid("2027-08")).toBe(20000);
    }
  });

  it("貸与の奨学金（世帯で返す）: 在学中に受け取り、受け取りの終わりの7か月後から debt.schedule で返す", () => {
    const req = mk([{ stage: "university", sector: "national" }], { scholarships: [{ monthly: 50000, from: at("2031-04"), to: at("2033-03"), rate: "0", termMonths: 120, repaidBy: "household" }] });
    const out = flowsOf(req);
    const f = out.flows as unknown as Flow[];
    expect(sumFlows(f, (x) => x.row === "cf.income.other.scholarship")).toBe(1200000);
    expect(f.find((x) => x.row === "cf.expense.debt.scholarship")?.ym).toBe("2033-10");
    expect(out.loans[0]?.member).toBe(C);
    expect(out.childRepaid).toBeUndefined();
    // 名義を親にすると、負債の名義は親（返済は世帯のまま）
    const p = flowsOf(edit(req, (h) => (((h.goals as Obj[])[0]!.education as Obj).scholarships = [{ monthly: 50000, from: at("2031-04"), to: at("2033-03"), rate: "0", termMonths: 120, repaidBy: "household", debtor: "parent" }])));
    expect(p.loans[0]?.member).toBe(A);
  });

  it("貸与の奨学金（子が返す。省略も子。0104）: 受け取りは世帯の入るお金のまま、返済は世帯のお金の動き・負債に入れず、要約の childScholarships に出す", () => {
    const sch = { monthly: 50000, from: at("2031-04"), to: at("2033-03"), rate: "0", termMonths: 120 };
    const byChild = mk([{ stage: "university", sector: "national" }], { scholarships: [sch] });
    const byHousehold = mk([{ stage: "university", sector: "national" }], { scholarships: [{ ...sch, repaidBy: "household" }] });
    const out = flowsOf(byChild);
    const f = out.flows as unknown as Flow[];
    expect(sumFlows(f, (x) => x.row === "cf.income.other.scholarship")).toBe(1200000);
    expect(f.some((x) => x.row === "cf.expense.debt.scholarship")).toBe(false);
    expect(out.loans).toEqual([]);
    // 120万円を0%・120か月: 月1万円を2033年10月から（表の最後の2036年12月まで39か月）
    expect(out.childRepaid).toEqual([{ object: uid("g"), member: C, principal: 1200000, monthly: 10000, from: "2033-10", to: "2036-12", total: 390000 }]);
    const r = full(byChild);
    const h = full(byHousehold);
    expect(cells(r, "cf.expense.debt.scholarship", 2034)).toBe(0);
    expect(cells(h, "cf.expense.debt.scholarship", 2034)).toBe(120000);
    expect(cells(r, "cf.balance.debt.other", 2034)).toBe(0);
    expect(cells(h, "cf.balance.debt.other", 2034)).toBeGreaterThan(0);
    expect(cells(r, "cf.net", 2034) - cells(h, "cf.net", 2034)).toBe(120000);
    expect((r.summary as { childScholarships?: unknown }).childScholarships).toEqual(out.childRepaid);
    expect((h.summary as { childScholarships?: unknown }).childScholarships).toBeUndefined();
    // repaidBy: child と書いても同じ
    expect(flowsOf(mk([{ stage: "university", sector: "national" }], { scholarships: [{ ...sch, repaidBy: "child", debtor: "parent" }] })).childRepaid?.[0]?.member).toBe(C);
  });
});

describe("小さな修正（PR #9・#11 の「ロジックの誤りの可能性」）", () => {
  it("こどもNISA の払い出しは、その年3月31日に12歳である年から（4月2日生まれは12歳の誕生日の翌年から）", () => {
    const mk = (birth: string) =>
      edit(edit(household({ members: [member("a", "self", "1980-01"), member("c", "child", birth)], baseMonth: "2027-01", endYear: 2041 }), (h) => {
        h.accounts = [
          { id: uid("dep"), kind: "deposit", owner: A, marketValue: box(0), asOf: "2027-01", contributions: [] },
          { id: uid("cn"), kind: "childNisa", owner: uid("c"), marketValue: box(3000000), asOf: "2027-01", contributions: [] },
        ];
        h.livingExpenses = [{ id: uid("lv"), mode: "total", monthly: box(10000), growth: { kind: "none" } }];
      }),
      (_h: Obj, input: Obj) => ((input.assumptions as Obj).withdrawal = { order: [{ kind: "childNisa" }] }),
    );
    const firstWithdrawal = (birth: string) => {
      const r = full(mk(birth));
      return (r.table as Cell[]).filter((c) => c.row === "cf.transfer.withdrawal" && c.object === uid("cn")).map((c) => c.year).sort()[0];
    };
    // 2027年3月生まれは 2039年3月に12歳（達する日）→ 2039年から。2027年5月生まれは 2039年5月に12歳 → 2040年から
    expect(firstWithdrawal("2027-03")).toBe(2039);
    expect(firstWithdrawal("2027-05")).toBe(2040);
  });

  it("住民税の住宅ローン控除の上限: 居住年が平成28年〜令和7年なら（所得税の基礎控除−48万円）を課税総所得金額等に足す", () => {
    const req = household({ members: [member("a", "self", "1980-01")], events: [{ id: uid("mv"), kind: "moveIn", at: at("2024-04") }], baseMonth: "2027-01", endYear: 2028 });
    const out = call<{ residentBasicOffset?: number }>(edit(req, (h) => {
      h.debts = [{ id: uid("loan"), kind: "mortgage", debtors: [{ member: A, role: "primary" }], principal: 30000000, start: at("2024-03"), rateSchedule: [{ from: at("2024-03"), type: "fixed", rate: "0.01" }], repayment: { method: "equalPayment", termMonths: 420 }, housing: { moveIn: uid("mv"), propertyType: "certified", newBuild: true } }];
    }), "tax.housingLoanCredit", { member: A, year: 2027 }, { "tax.incomeWithin": () => ({ within: true }) });
    expect(out.residentBasicOffset).toBe(480000);
  });
});

describe("小さな修正（続き）", () => {
  it("iDeCo の第5号: 令和11年11月末までは、前に掛金を出していなくても60〜70歳で加入できる（経過措置）", () => {
    const mk = (from: string) =>
      edit(household({ members: [member("a", "self", "1966-05")], baseMonth: "2027-01", endYear: 2031 }), (h) => {
        h.accounts = [{ id: uid("id"), kind: "ideco", owner: A, marketValue: box(0), asOf: "2027-01", contributions: [{ from: at(from), to: null, monthly: 20000 }] }];
      });
    const paid = (from: string, y: number) => call<{ payments: { ym: string; amount: number }[] }>(mk(from), "ideco.contribution", { member: A }).payments.filter((p) => p.ym.startsWith(`${y}-`)).reduce((s, p) => s + p.amount, 0);
    expect(paid("2027-01", 2027)).toBe(240000);
    // 経過措置の後（2029年12月から）に初めて加入するときは、前の加入がないので第5号にならない
    expect(paid("2030-01", 2030)).toBe(0);
  });

  it("再評価率の表の無い年度（令和9年度以後）は、値のある最後の年度の表を報酬比例の改定の比で延ばす（知らせ N_PARAM_PROJECTED）", () => {
    const req = household({ baseMonth: "2027-06", endYear: 2028, members: [member("pt.a", "self", "1965-05", { sex: "male" })] });
    (req.input.household as unknown as Obj).pensionRecords = [
      {
        id: uid("pt.r"),
        member: uid("pt.a"),
        kind: "history",
        asOf: "2027-06",
        history: [
          { from: "1995-01", to: "1995-12", category: "employee", averageRemunerationAtTime: 300000 },
          { from: "2005-01", to: "2005-12", category: "employee", averageRemunerationAtTime: 400000 },
        ],
      },
    ];
    const r = runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "pension.record", input: { member: uid("pt.a") } } });
    // 前提（賃金・物価）が0なので改定の比は1。令和8年度の架空の表（1.2・1.1）と同じ額
    expect((r.entryOutput as { amounts: { employee: number } }).amounts.employee).toBe(30240 + 26400);
    const ns = (r.header as { notices: { code: string; ids: string[] }[] }).notices;
    expect(ns.some((n) => n.code === "N_PARAM_PROJECTED" && n.ids.includes("pension.revaluationRate"))).toBe(true);
    expect(ns.some((n) => n.code === "N_PARAM_MISSING" && n.ids.includes("pension.revaluationRate"))).toBe(false);
  });

  it("老齢基礎年金の子の加算: 月数が300に満たないと ×月数/300、受給権を得た後に生まれた子は数えない", () => {
    const mk = (months: number, childBirth: string | null) => {
      const members = [member("pc.a", "self", "1963-05", { sex: "male" }), ...(childBirth === null ? [] : [member("pc.c", "child", childBirth)])];
      const req = household({ baseMonth: "2028-01", endYear: 2031, members });
      const from = "1983-06";
      // 1983年6月から months か月（その月を含めて数える）
      const last = 1983 * 12 + 5 + months - 1;
      const to = `${Math.floor(last / 12)}-${String((last % 12) + 1).padStart(2, "0")}`;
      (req.input.household as unknown as Obj).pensionRecords = [{ id: uid("pc.r"), member: uid("pc.a"), kind: "history", asOf: "2027-12", history: [{ from, to, category: "national1" }] }];
      const out = runEngine(req, realPacks(), { checkInternal: true, entry: { component: "pension.oldAge", input: { member: uid("pc.a") } } }).entryOutput as { months: { month: string; basic: number }[] };
      return out.months.find((m) => m.month === "2030-04")?.basic ?? 0;
    };
    const full480 = mk(480, "2020-01") - mk(480, null);
    const part200 = mk(200, "2020-01") - mk(200, null);
    expect(full480).toBeGreaterThan(0);
    expect(Math.abs(part200 - Math.floor((full480 * 200) / 300))).toBeLessThanOrEqual(1);
    expect(mk(480, "2029-01") - mk(480, null)).toBe(0);
  });
});

describe("セッションの先出しの範囲（0005 の追記 2026-10-09）", () => {
  it("slide は見ている1枠だけを先出しし、ほかの枠は古い印のまま前の結果を返す。release で残りを計算し直す", async () => {
    const { createSession, runJson } = await import("../src/engine/run.ts");
    const packsJson = JSON.stringify(fictionalPacks());
    const s = createSession(packsJson);
    const req = (annual: number) => household({ members: [member("a", "self", "1985-01")], periods: [period("p", { member: "a", from: "2010-04", annual, std: [400000, 400000] })], baseMonth: "2027-01", endYear: 2030 });
    const slots = (annual: number) => JSON.stringify({ "p0/s0": req(annual), "p0/s1": edit(req(annual), (h) => (((h.members as Obj[])[0] as Obj).leaves = at("2029-04"))), "p1/s0": req(annual + 1000000) });
    s.set(slots(5000000));
    s.release();
    expect(Object.values(JSON.parse(s.status()) as Record<string, { state: string }>).every((x) => x.state === "fresh")).toBe(true);
    const tick = JSON.parse(s.slide(slots(5100000), "p0/s0")) as { focus: Record<string, { state: string }>; status: Record<string, { state: string }> };
    expect(Object.keys(tick.focus)).toEqual(["p0/s0"]);
    expect(tick.status["p0/s0"]?.state).toBe("fresh");
    expect(tick.status["p0/s1"]?.state).toBe("stale");
    const stale = JSON.parse(s.results(JSON.stringify(["p0/s1"]))) as Record<string, { state: string; resultRev: number; rev: number; result: unknown }>;
    expect(stale["p0/s1"]?.state).toBe("stale");
    expect(stale["p0/s1"]?.result).not.toBeNull();
    const rel = JSON.parse(s.release()) as Record<string, unknown>;
    expect(Object.keys(rel).sort()).toEqual(["p0/s1", "p1/s0"]);
    const now = JSON.parse(s.results()) as Record<string, { state: string; result: unknown }>;
    expect(Object.values(now).every((x) => x.state === "fresh")).toBe(true);
    const one = JSON.parse(runJson(JSON.stringify(req(6100000)), packsJson)) as { header: unknown; table: unknown; summary: unknown };
    expect(JSON.stringify(now["p1/s0"]?.result)).toBe(JSON.stringify({ header: one.header, table: one.table, summary: one.summary }));
  });
});

describe("学費データの形（0010 の3。【架空の見本】）", () => {
  it("架空の見本のパックは形の検査を通り、世帯の教育の目標へ写した行で計算できる", async () => {
    const { checkTuitionPack, checkTuitionUnit, toHouseholdSchool } = await import("../scripts/tuition.ts");
    const { join } = await import("node:path");
    const { ENGINE_DIR } = await import("../scripts/lib.ts");
    const p = checkTuitionPack(join(ENGINE_DIR, "test", "fixtures", "master", "education.tuition"));
    expect(p.fictional).toBe(true);
    expect(p.units.length).toBe(2);
    const med = p.units.find((u) => u.years === 6);
    expect(med).toBeDefined();
    // 年次が欠けたら誤り
    const broken = { ...(med as object), rows: (med as { rows: { grade: number }[] }).rows.filter((r) => r.grade !== 4) };
    expect(() => checkTuitionUnit(broken as never, "x", true)).toThrow("4年次");
    const school = toHouseholdSchool(med as never, 2027, "2026.1.0", true);
    expect((school.rows as unknown[]).length).toBe(1 + 6 * 3);
  });
});

describe("受け取り方の比較（6.4）: 年金で受けると、公的年金等控除・保険料・住民税の非課税の判定まで変わる", () => {
  it("DB を年金で受けると、退職所得の税は減り、受け取る間の所得税・住民税・国民健康保険料は増える（retirementSequence）", async () => {
    const { modelHousehold } = await import("./helpers.ts");
    const run = (receipt: Obj) => {
      const r = JSON.parse(JSON.stringify(modelHousehold("retirementSequence"))) as Req;
      ((r.input.household as unknown as Obj).retirementBenefits as Obj[])[1] = { ...(((r.input.household as unknown as Obj).retirementBenefits as Obj[])[1] as Obj), receipt };
      return runEngine(r, realPacks());
    };
    const lump = run({ method: "lumpSum" });
    const annuity = run({ method: "annuity", years: 10, conversionRate: "0.015" });
    const span = (r: { table: unknown }, p: string, y0: number, y1: number) => Array.from({ length: y1 - y0 + 1 }, (_, i) => cells(r, p, y0 + i)).reduce((s, x) => s + x, 0);
    expect(span(annuity, "cf.taxSi.incomeTax.retirement", 2036, 2036)).toBeLessThan(span(lump, "cf.taxSi.incomeTax.retirement", 2036, 2036));
    for (const p of ["cf.taxSi.incomeTax", "cf.taxSi.residentTax", "cf.taxSi.health"]) expect(span(annuity, p, 2038, 2045)).toBeGreaterThan(span(lump, p, 2038, 2045));
  });

  it("年金の額で住民税の非課税の判定が変わる（公的年金等控除の後の所得が非課税限度額を超える）", () => {
    const mk = (annual: number) =>
      edit(household({ members: [member("a", "self", "1958-05")], baseMonth: "2027-01", endYear: 2029 }), (h) => {
        h.retirementBenefits = annual === 0 ? [] : [{ id: uid("db"), member: A, kind: "db", receipt: { method: "annuity", start: at("2027-01"), years: 10, annualAmount: annual } }];
      });
    const ex = (annual: number) => runEngine(mk(annual), realPacks(), { checkInternal: true, entry: { component: "residentTax.exemption", input: { member: A, fiscalYear: 2028 } } }).entryOutput as { perCapitaExempt: boolean };
    expect(ex(0).perCapitaExempt).toBe(true);
    expect(ex(2400000).perCapitaExempt).toBe(false);
  });
});

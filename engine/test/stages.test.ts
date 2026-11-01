// 段階と例外の年・働き方の期間ごとの伸び（0040）のテスト（L1）: 周期的な支出・家賃・修繕費・固定資産税・住まい以外の不動産の家賃と経費・
// 器の利回りと資産配分の段階、段の境の月、例外の年、少しずつ移す段、給与・事業所得の伸びの率と昇給カーブの値ID、空の段階は今と同じ結果。
// 【架空の見本】の制度データで、手計算と突き合わせる
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { EngineError } from "../src/errors.ts";
import { box, clone, fictionalPacks, household, member, modelHousehold, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Flow = { row: string; ym: string; amount: number; member?: string; object?: string; formula: string };
type Cell = { row: string; year: number; amount: number; object?: string; member?: string };
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const at = (ym: string) => ({ at: ym });
const A = uid("a");
const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = clone(req);
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
const sum = (fs: readonly Flow[], f: (x: Flow) => boolean) => fs.filter(f).reduce((s, x) => s + x.amount, 0);
const cells = (r: { table: unknown }, row: string, year: number) => (r.table as Cell[]).filter((c) => c.row === row && c.year === year).reduce((s, c) => s + c.amount, 0);
/** 段・例外の年の1件（ID は名前から決める） */
const stage = (name: string, o: Obj) => ({ id: uid(`stage:${name}`), ...o });
const exception = (name: string, year: number, amount: number) => ({ id: uid(`exception:${name}`), year, amount: box(amount) });
/** 次の年の残高: 前の年の残高＋運用益（期首残高×年利の円未満を0に向けて切り捨て。収支の無い器） */
const grow = (v: number, rate: string) => {
  const [i, f = ""] = rate.replace("-", "").split(".");
  const den = 10n ** BigInt(f.length);
  const num = BigInt(`${i}${f}`) * (rate.startsWith("-") ? -1n : 1n);
  return v + Number((BigInt(v) * num) / den);
};

describe("周期的な支出（expense.periodic）の段階と例外の年", () => {
  /** 収入の無い世帯（2027年1月から2040年まで） */
  const quiet = () => household({ members: [member("a", "self", "1980-01")], endYear: 2040, baseMonth: "2027-01" }) as Req;
  const flows = (pe: Obj) => call<{ flows: Flow[] }>(edit(quiet(), (h) => (h.periodicExpenses = [{ id: uid("pe"), row: "cf.expense.lumpSum.other", to: null, growth: { kind: "none" }, ...pe }])), "expense.periodic", {}).flows;
  const byYear = (fs: readonly Flow[]) => Object.fromEntries(fs.map((f) => [Number(f.ym.slice(0, 4)), f.amount]));

  it("段の境の月: 段の月の支払いから段の額。後の段は割合（元の額×割合）。例外の年はその年の支払いだけ（0円は払わない）", () => {
    const fs = flows({
      from: at("2027-08"),
      everyYears: 1,
      amount: box(100000),
      stages: [stage("s1", { at: at("2030-08"), amount: box(200000) }), stage("s2", { at: at("2033-09"), ratio: "0.5" })],
      exceptions: [exception("e1", 2029, 0), exception("e2", 2035, 70000)],
    });
    const y = byYear(fs);
    expect(y[2027]).toBe(100000);
    expect(y[2028]).toBe(100000);
    expect(y[2029]).toBeUndefined();
    // 段の月（8月）の支払いから
    expect(y[2030]).toBe(200000);
    // 2033年9月の段は、2033年8月の支払いにはまだ当たらない
    expect(y[2033]).toBe(200000);
    expect(y[2034]).toBe(50000);
    expect(y[2035]).toBe(70000);
    expect(y[2040]).toBe(50000);
  });

  it("段の額は計算基準年の価格で、元の欄の伸び方をそのまま重ねる。支払いの無い年の例外の年は支払いを足さない", () => {
    const fs = flows({ from: at("2027-08"), everyYears: 3, amount: box(100000), growth: { kind: "rate", rate: "0.1" }, stages: [stage("s", { at: at("2030-01"), amount: box(200000) })], exceptions: [exception("e", 2031, 999999)] });
    expect(fs.map((f) => [f.ym, f.amount])).toEqual([
      ["2027-08", 100000],
      ["2030-08", 266200], // 200,000 を3年伸ばす
      ["2033-08", 354312], // 200,000 を6年伸ばす（1年ごとに円未満切り捨て）
      ["2036-08", 471588],
      ["2039-08", 627682],
    ]);
  });

  it("少しずつ移す段: 段の月から1年たつごとに、次の段の値へ (次−今)÷n ずつ。次の段の月が先に来たらその月から次の段", () => {
    const run = (ramp: number, nextAt: string, firstAt = "2028-01") =>
      byYear(flows({ from: at("2027-01"), everyYears: 1, amount: box(100000), stages: [stage("a", { at: at(firstAt), amount: box(100000), rampYears: ramp }), stage("b", { at: at(nextAt), amount: box(200000) })] }));
    const y = run(4, "2032-01");
    expect([y[2027], y[2028], y[2029], y[2030], y[2031], y[2032], y[2033]]).toEqual([100000, 100000, 125000, 150000, 175000, 200000, 200000]);
    // 4年かけるはずが、次の段が2030年1月に来る
    const cut = run(4, "2030-01");
    expect([cut[2029], cut[2030]]).toEqual([125000, 200000]);
    // 2年で届き、次の段の月まではその値のまま
    const early = run(2, "2032-01");
    expect([early[2029], early[2030], early[2031], early[2032]]).toEqual([150000, 200000, 200000, 200000]);
    // 段が3月から: 1月の支払いは、まる1年たってから動く
    const march = run(4, "2034-01", "2028-03");
    expect([march[2028], march[2029], march[2030]]).toEqual([100000, 100000, 125000]);
  });

  it("下がる段と割合の段も少しずつ移せる（差に掛けた額を円未満切り捨て）", () => {
    const y = byYear(flows({ from: at("2027-01"), everyYears: 1, amount: box(100000), stages: [stage("a", { at: at("2027-01"), ratio: "1", rampYears: 3 }), stage("b", { at: at("2030-01"), amount: box(0) })] }));
    // 100,000 → 0 を3年で: 100,000−33,333.3…（差の −33,333 を足す）
    expect([y[2027], y[2028], y[2029], y[2030]]).toEqual([100000, 66667, 33334, undefined]);
  });

  it("元の額が0円でも、段の額があれば払う", () => {
    const y = byYear(flows({ from: at("2027-04"), everyYears: 1, amount: box(0), stages: [stage("a", { at: at("2030-01"), amount: box(50000) })] }));
    expect(y[2029]).toBeUndefined();
    expect(y[2030]).toBe(50000);
  });
});

describe("住まい（housing.residence）の段階と例外の年", () => {
  const mk = (residences: Obj[]) => edit(household({ members: [member("a", "self", "1990-01")], endYear: 2032 }), (h) => (h.residences = residences));
  const own = (o: Obj) => ({ id: uid("h"), kind: "own", from: at("2027-04"), to: null, ownership: [{ member: A, share: "1" }], ...o });
  const flowsOf = (req: Req) => call<{ flows: Flow[] }>(req, "housing.residence", {}).flows;

  it("家賃: 段の月から段の額に、住み始めから直近の更新までの年数だけ上昇率（年率）を重ねる。例外の年は0円。更新料は前の月の家賃（例外は当てない）×月数", () => {
    const fs = flowsOf(
      mk([{ id: uid("r"), kind: "rent", from: at("2025-04"), to: null, rent: { monthly: box(100000), growth: "0.1", renewalFee: "1", stages: [stage("r1", { at: at("2028-01"), amount: box(80000) })], exceptions: [exception("r2", 2030, 0)] } }]),
    );
    const f = (ym: string, row = "cf.expense.housing.rent") => sum(fs, (x) => x.ym === ym && x.row === row);
    expect(f("2027-03")).toBe(100000);
    expect(f("2027-04", "cf.expense.housing.rent.renewal")).toBe(100000);
    // 更新（2年ごと）の月に、その間の2年分をまとめて上げる（年率10%を2回）
    expect(f("2027-04")).toBe(121000);
    expect(f("2027-12")).toBe(121000);
    // 段の月から（直近の更新までの2年分を当てる）
    expect(f("2028-01")).toBe(96800);
    expect(f("2029-04", "cf.expense.housing.rent.renewal")).toBe(96800);
    expect(f("2029-04")).toBe(117128);
    expect(fs.some((x) => x.ym.startsWith("2030-"))).toBe(false);
    expect(f("2031-01")).toBe(117128);
    expect(f("2031-04", "cf.expense.housing.rent.renewal")).toBe(117128);
    expect(f("2031-04")).toBe(141724);
  });

  it("家賃: 更新の間隔が12の倍数でないときは、住み始めからの経った年数（1年未満は切り捨て）のうち、前の更新から増えた年数分を上げる", () => {
    const fs = flowsOf(mk([{ id: uid("r"), kind: "rent", from: at("2025-04"), to: null, rent: { monthly: box(100000), growth: "0.1", renewalEveryMonths: 18 } }]));
    const f = (ym: string) => sum(fs, (x) => x.ym === ym && x.row === "cf.expense.housing.rent");
    expect(f("2026-09")).toBe(100000);
    // 18か月目（1年6か月）: 1年分
    expect(f("2026-10")).toBe(110000);
    // 36か月目（3年）: 前の更新から増えた2年分
    expect(f("2028-04")).toBe(133100);
    // 54か月目（4年6か月）: 1年分
    expect(f("2029-10")).toBe(146410);
  });

  describe("家賃: 計算基準月より前に住み始めた賃貸は、入れた家賃を今の家賃とし、計算基準月より後の更新からだけ上げる（改訂4）", () => {
    const rentOf = (fs: readonly Flow[], ym: string, row = "cf.expense.housing.rent") => sum(fs, (x) => x.ym === ym && x.row === row);
    const rows = (fs: readonly Flow[], row: string) => fs.filter((x) => x.row === row).map((x) => x.ym);

    it("住み始めが何年も前: 計算基準月までの更新（3回）は重ねず、次の更新でその間の2年分を上げる", () => {
      // 2019-04 から2年ごと。2021-04・2023-04・2025-04 の更新は計算基準月（2026-01）より前
      const fs = flowsOf(mk([{ id: uid("r"), kind: "rent", from: at("2019-04"), to: null, rent: { monthly: box(100000), growth: "0.1", renewalFee: "1" } }]));
      expect(rentOf(fs, "2026-01")).toBe(100000);
      expect(rentOf(fs, "2027-03")).toBe(100000);
      expect(rows(fs, "cf.expense.housing.rent.renewal")).toEqual(["2027-04", "2029-04", "2031-04"]);
      // 計算基準月の後の最初の更新: 今の家賃は 2025-04 の更新で決まった額なので、その更新の間の2年分
      expect(rentOf(fs, "2027-04", "cf.expense.housing.rent.renewal")).toBe(100000);
      expect(rentOf(fs, "2027-04")).toBe(121000);
      expect(rentOf(fs, "2029-04", "cf.expense.housing.rent.renewal")).toBe(121000);
      expect(rentOf(fs, "2029-04")).toBe(146410);
    });

    it("計算基準月ちょうどの更新は済んだものとし、入れた家賃×月数の更新料だけを払う", () => {
      const fs = flowsOf(mk([{ id: uid("r"), kind: "rent", from: at("2024-01"), to: null, rent: { monthly: box(100000), growth: "0.1", renewalFee: "1" } }]));
      expect(rentOf(fs, "2026-01", "cf.expense.housing.rent.renewal")).toBe(100000);
      expect(rentOf(fs, "2026-01")).toBe(100000);
      expect(rentOf(fs, "2027-12")).toBe(100000);
      expect(rentOf(fs, "2028-01")).toBe(121000);
    });

    it("計算基準月の後に住み始める賃貸は前と同じ（住み始めの家賃から、更新のたびに上げる）", () => {
      const fs = flowsOf(mk([{ id: uid("r"), kind: "rent", from: at("2027-04"), to: null, rent: { monthly: box(100000), growth: "0.1", renewalFee: "1" } }]));
      expect(rentOf(fs, "2027-04")).toBe(100000);
      expect(rentOf(fs, "2029-03")).toBe(100000);
      expect(rentOf(fs, "2029-04", "cf.expense.housing.rent.renewal")).toBe(100000);
      expect(rentOf(fs, "2029-04")).toBe(121000);
      expect(rentOf(fs, "2031-04")).toBe(146410);
    });

    it("更新の間隔が12の倍数でない: 年数は住み始めから数えたまま、計算基準月の後の更新の分だけ当てる", () => {
      // 2023-04 から18か月ごと。2024-10 の更新（1年分）は計算基準月より前で重ねない
      const fs = flowsOf(mk([{ id: uid("r"), kind: "rent", from: at("2023-04"), to: null, rent: { monthly: box(100000), growth: "0.1", renewalEveryMonths: 18 } }]));
      expect(rentOf(fs, "2026-01")).toBe(100000);
      expect(rentOf(fs, "2026-03")).toBe(100000);
      // 36か月目（3年）: 前の更新（1年6か月）から増えた2年分
      expect(rentOf(fs, "2026-04")).toBe(121000);
      // 54か月目（4年6か月）: 1年分
      expect(rentOf(fs, "2027-10")).toBe(133100);
      // 72か月目（6年）: 2年分
      expect(rentOf(fs, "2029-04")).toBe(161051);
    });

    it("段階と例外の年も、計算基準月までの最後の更新から数えた年数だけ重ねる（段の無い月は段階の無い計算と同じ）", () => {
      const base = { id: uid("r"), kind: "rent", from: at("2019-04"), to: null };
      const plain = flowsOf(mk([{ ...base, rent: { monthly: box(100000), growth: "0.1", renewalFee: "1" } }]));
      const fs = flowsOf(mk([{ ...base, rent: { monthly: box(100000), growth: "0.1", renewalFee: "1", stages: [stage("r1", { at: at("2028-01"), amount: box(80000) })], exceptions: [exception("r2", 2030, 0)] } }]));
      for (const ym of ["2026-01", "2027-03", "2027-04", "2027-12"]) expect(rentOf(fs, ym)).toBe(rentOf(plain, ym));
      expect(rentOf(fs, "2027-04", "cf.expense.housing.rent.renewal")).toBe(100000);
      // 段の月から: 段の額に、計算基準月の後の更新（2027-04）の2年分
      expect(rentOf(fs, "2028-01")).toBe(96800);
      expect(rentOf(fs, "2029-04", "cf.expense.housing.rent.renewal")).toBe(96800);
      expect(rentOf(fs, "2029-04")).toBe(117128);
      expect(fs.some((x) => x.ym.startsWith("2030-"))).toBe(false);
      // 計算基準月より前の月は出さない
      expect(fs.some((x) => x.ym < "2026-01")).toBe(false);
    });

    it("計算基準月ちょうどの更新（段階あり）も、更新料は前の月の段の額×月数で、上げない", () => {
      const fs = flowsOf(mk([{ id: uid("r"), kind: "rent", from: at("2024-01"), to: null, rent: { monthly: box(100000), growth: "0.1", renewalFee: "1", exceptions: [exception("r2", 2031, 0)] } }]));
      expect(rentOf(fs, "2026-01", "cf.expense.housing.rent.renewal")).toBe(100000);
      expect(rentOf(fs, "2026-01")).toBe(100000);
      expect(rentOf(fs, "2028-01")).toBe(121000);
    });
  });

  it("修繕費: 段（年齢の時点）の月から段の額に、計算基準年からの年数だけ上昇率を当てる。例外の年はその年だけ", () => {
    const fs = flowsOf(
      mk([
        own({
          purchase: { price: 40000000, downPayment: 5000000, costs: 0 },
          maintenance: { monthly: box(10000), growth: "0.1", stages: [stage("m1", { at: { memberAge: { member: A, years: 40 } }, amount: box(20000) })], exceptions: [exception("m2", 2031, 5000)] },
        }),
      ]),
    );
    const f = (ym: string) => sum(fs, (x) => x.ym === ym && x.row === "cf.expense.housing.maintenance");
    expect(f("2029-12")).toBe(13310);
    // 1990年1月生まれ（2日以後）が40歳に達するのは2030年1月
    expect(f("2030-01")).toBe(29282);
    expect(f("2031-06")).toBe(8052);
    expect(f("2032-01")).toBe(35431);
  });

  it("固定資産税: 年ごとの段（段の時点の属する年から）。少しずつ移す段は年の差で数える。例外の年は0円", () => {
    const fs = flowsOf(
      mk([
        own({
          purchase: { price: 40000000, downPayment: 5000000, costs: 0 },
          propertyTax: { annual: box(120000), stages: [stage("t1", { at: at("2028-06"), amount: box(120000), rampYears: 2 }), stage("t2", { at: at("2031-01"), amount: box(60000) })], exceptions: [exception("t3", 2032, 0)] },
        }),
      ]),
    );
    const year = (y: number) => sum(fs, (x) => x.row === "cf.expense.housing.propertyTax" && (x as Flow & { accrualYear: number }).accrualYear === y);
    expect([2027, 2028, 2029, 2030, 2031].map(year)).toEqual([120000, 120000, 90000, 60000, 60000]);
    expect(year(2032)).toBe(0);
    expect(sum(fs, (x) => x.ym === "2030-02" && x.row === "cf.expense.housing.propertyTax")).toBe(22500);
    expect(sum(fs, (x) => x.ym === "2030-04" && x.row === "cf.expense.housing.propertyTax")).toBe(15000);
  });
});

describe("住まい以外の不動産（asset.realEstate）の家賃と経費の段階と例外の年", () => {
  const P = uid("prop");
  const property = (rental: Obj = {}, expenses: Obj = {}): Obj => ({
    structure: "rc",
    builtYear: 2015,
    landShare: "0.4",
    acquisition: { price: 25000000, at: "2020-04" },
    rental: { monthly: box(100000), vacancyRate: "0.05", growth: "-0.01", ...rental },
    expenses: { annual: box(240000), rate: "0.05", ...expenses },
  });
  const mk = (p: Obj) =>
    household({
      baseMonth: "2026-01",
      endYear: 2034,
      members: [member("a", "self", "1980-01")],
      accounts: [
        { id: uid("dep"), kind: "deposit", owner: A, marketValue: box(10000000), asOf: "2025-12", contributions: [] },
        { id: P, kind: "realEstate", owner: A, marketValue: box(30000000), asOf: "2025-12", valueGrowth: "0", contributions: [], property: p },
      ],
    });
  const flowsOf = (req: Req) => call<{ flows: Flow[] }>(req, "asset.realEstate", {}).flows;
  const rent = (fs: readonly Flow[], ym: string) => sum(fs, (x) => x.ym === ym && x.row === "cf.income.other.rental");
  const exp = (fs: readonly Flow[], ym: string) => sum(fs, (x) => x.ym === ym && x.row === "cf.expense.other.realEstate");

  it("家賃は月ごとの段（元の家賃と同じ変化率・空室を重ねる）、例外の年は受け取らない。経費の年額は年ごとの段で、家賃に対する割合はその月の家賃に", () => {
    const staged = flowsOf(mk(property({ stages: [stage("p1", { at: at("2028-07"), amount: box(120000) })], exceptions: [exception("p2", 2030, 0)] }, { stages: [stage("p3", { at: at("2029-03"), ratio: "0.5" })], exceptions: [exception("p4", 2031, 0)] })));
    const plain100 = flowsOf(mk(property()));
    const plain120 = flowsOf(mk(property({ monthly: box(120000) })));
    expect(rent(staged, "2028-06")).toBe(rent(plain100, "2028-06"));
    expect(rent(staged, "2028-07")).toBe(rent(plain120, "2028-07"));
    expect(rent(staged, "2029-01")).toBe(rent(plain120, "2029-01"));
    expect(staged.some((x) => x.row === "cf.income.other.rental" && x.ym.startsWith("2030-"))).toBe(false);
    expect(rent(staged, "2031-05")).toBe(rent(plain120, "2031-05"));
    // 経費: 2028年は年額24万円の12分の1＋家賃×5%、2029年は年額の半分（その年の全部の月）、2030年は家賃が無いので年額の分だけ
    expect(exp(staged, "2028-07")).toBe(20000 + Math.floor(rent(staged, "2028-07") * 0.05));
    expect(exp(staged, "2029-01")).toBe(10000 + Math.floor(rent(staged, "2029-01") * 0.05));
    expect(exp(staged, "2030-05")).toBe(10000);
    // 2031年は年額の例外が0円: 家賃に対する割合の分だけ
    expect(exp(staged, "2031-05")).toBe(Math.floor(rent(staged, "2031-05") * 0.05));
  });

  it("不動産所得の家賃収入にも段階と例外の年が入る", () => {
    const req = mk(property({ exceptions: [exception("p", 2030, 0)] }));
    const out = call<{ properties: { income: { year: number; rent: number }[] }[] }>(req, "asset.realEstate", {});
    const income = (out.properties[0] as { income: { year: number; rent: number }[] }).income;
    expect(income.find((x) => x.year === 2030)?.rent).toBe(0);
    expect(income.find((x) => x.year === 2029)?.rent).toBeGreaterThan(0);
  });
});

describe("器の利回りと資産配分の段階・例外の年（plan.cashflow・account.ideco）", () => {
  /** 1980年6月生まれ・2035年12月まで会社員の世帯。課税口座1,000万円（積立なし）の年末の残高で利回りを見る */
  const mk = (tx: Obj, f: (h: Obj, input: Obj) => void = () => {}) =>
    edit(
      household({
        members: [member("a", "self", "1980-06")],
        periods: [period("p", { member: "a", from: "2003-04", to: "2035-12", annual: 8000000, std: [620000, 620000] })],
        accounts: [
          { id: uid("dep"), kind: "deposit", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [] },
          { id: uid("tx"), kind: "taxable", owner: A, marketValue: box(10000000), costBasis: box(10000000), asOf: "2025-12", expectedReturn: "0.04", contributions: [], ...tx },
        ],
        endYear: 2032,
      }),
      f,
    );
  const balances = (req: Req) => {
    const r = full(req);
    return Object.fromEntries([2026, 2027, 2028, 2029, 2030, 2031].map((y) => [y, cells(r, "cf.balance.account.taxable", y)]));
  };

  it("器の利回りの段階（その時点の属する年から）と少しずつ移す段、例外の年", () => {
    const b = balances(
      mk({
        returnStages: [stage("r1", { at: at("2027-07"), expectedReturn: "0.02", rampYears: 2 }), stage("r2", { at: at("2030-01"), expectedReturn: "0.06" })],
        returnExceptions: [{ id: uid("x"), year: 2031, expectedReturn: "-0.1" }],
      }),
    );
    expect(b[2026]).toBe(grow(10000000, "0.04"));
    // 2027年7月の段は2027年から。2028年は 2%＋(6%−2%)×1/2、2029年は2年たって6%
    expect(b[2027]).toBe(grow(b[2026] as number, "0.02"));
    expect(b[2028]).toBe(grow(b[2027] as number, "0.04"));
    expect(b[2029]).toBe(grow(b[2028] as number, "0.06"));
    expect(b[2030]).toBe(grow(b[2029] as number, "0.06"));
    expect(b[2031]).toBe(grow(b[2030] as number, "-0.1"));
  });

  it("資産の配分の段は器の利回りに代わる（運用の費用はその後に引く）", () => {
    const b = balances(
      mk({ fee: "0.005", returnStages: [stage("m", { at: at("2028-01"), assetMix: [{ assetClass: "equity.global", share: "0.5" }, { assetClass: "bond.global", share: "0.5" }] })] }, (_h, input) => {
        (input.assumptions as Obj).assetReturns = { "equity.global": { default: "0.06" }, "bond.global": { default: "0.01" } };
      }),
    );
    expect(b[2027]).toBe(grow(grow(10000000, "0.035"), "0.035"));
    expect(b[2028]).toBe(grow(b[2027] as number, "0.03"));
  });

  it("資産配分の入れ方の段階（年齢の時点）は、運用する器の配分の段階になる。資産クラスを書いた時価の下落はその年の段の配分で", () => {
    const run = (stages: Obj[]) =>
      mk({}, (_h, input) => {
        const a = input.assumptions as Obj;
        a.assetReturns = { "equity.global": { default: "0.06" }, "bond.global": { default: "0.01" } };
        a.investment = { method: "allocation", allocation: { mix: [{ assetClass: "equity.global", share: "0.5" }, { assetClass: "bond.global", share: "0.5" }], stages } };
        a.marketShocks = [{ year: 2031, drop: "0.3", assetClasses: ["equity.global"] }];
      });
    const b = balances(run([stage("a50", { at: { memberAge: { member: A, years: 50 } }, mix: [{ assetClass: "bond.global", share: "1" }] })]));
    // 50歳に達するのは2030年6月 → 2030年から債券だけ（1%）。2031年の株の下落は当たらない
    expect(b[2029]).toBe(grow(grow(grow(grow(10000000, "0.035"), "0.035"), "0.035"), "0.035"));
    expect(b[2030]).toBe(grow(b[2029] as number, "0.01"));
    expect(b[2031]).toBe(grow(b[2030] as number, "0.01"));
    // 段階が無ければ、株の割合の分だけ下がる
    const none = balances(run([]));
    expect(none[2031]).toBeLessThan(grow(none[2030] as number, "0.035"));
  });

  it("iDeCo の器も利回りの段階で運用する", () => {
    const ideco = (o: Obj) => ({ id: uid("ideco"), kind: "ideco", owner: A, marketValue: box(1000000), asOf: "2025-12", enrolledSince: "2015-04", contributions: [], expectedReturn: "0.03", payout: { method: "lumpSum", start: at("2045-07") }, ...o });
    const value = (req: Req, y: number) => cells(full(req), "cf.balance.account.ideco", y);
    const base = mk({}, (h) => (h.accounts as Obj[]).push(ideco({})));
    const staged = mk({}, (h) => (h.accounts as Obj[]).push(ideco({ returnStages: [stage("i", { at: at("2027-01"), expectedReturn: "0" })] })));
    expect(value(staged, 2026)).toBe(value(base, 2026));
    expect(value(staged, 2027)).toBe(value(staged, 2026));
    expect(value(base, 2027)).toBeGreaterThan(value(base, 2026));
  });
});

describe("働き方の期間ごとの伸び（income.salary・income.business）", () => {
  const mk = (p: Obj) => household({ members: [member("a", "self", "1980-01")], periods: [p], wageGrowth: "0.01", endYear: 2030 });
  const salaryIn = (req: Req, ym: string) => call<{ flows: Flow[] }>(req, "income.salary", { member: A }).flows.filter((f) => f.ym === ym && f.formula === "income.salary.monthly").reduce((s, f) => s + f.amount, 0);

  it("給与の伸びの率は賃金上昇率の代わり（マイナスも書ける）。空欄は賃金上昇率、昇給カーブの値IDは今までどおり", () => {
    const withGrowth = (growth: Obj | undefined) => {
      const x = period("p", { member: "a", from: "2020-04", annual: 6000000 }) as Obj & { salary: Obj };
      if (growth !== undefined) x.salary.growth = growth;
      return mk(x);
    };
    expect(salaryIn(withGrowth(undefined), "2027-01")).toBe(505000); // 6,060,000 ÷ 12
    expect(salaryIn(withGrowth({ rate: "0.02" }), "2027-01")).toBe(510000);
    expect(salaryIn(withGrowth({ rate: "-0.05" }), "2028-01")).toBe(451250); // 6,000,000 × 0.95 × 0.95 ÷ 12
    // 昇給カーブの値IDは今までどおり書ける。率と同時には書けない
    expect(() => full(withGrowth({ curve: "wageStats.default" }))).not.toThrow();
    expect(() => full(withGrowth({ curve: "wageStats.default", rate: "0.02" }))).toThrow(EngineError);
  });

  it("事業所得の伸びの率（省略は賃金上昇率）", () => {
    const self = (growth?: Obj) =>
      mk({ id: uid("p"), member: A, from: at("2020-04"), to: null, type: "selfEmployed", healthInsurance: { kind: "national" }, business: { income: box(5000000), ...(growth !== undefined ? { growth } : {}) } });
    const year = (req: Req, y: number) => call<{ byYear: { year: number; income: number }[] }>(req, "income.business", { member: A }).byYear.find((x) => x.year === y)?.income;
    expect(year(self(), 2027)).toBe(5050000);
    expect(year(self({ rate: "-0.05" }), 2027)).toBe(4750000);
    expect(year(self({ rate: "0.1" }), 2028)).toBe(6050000);
  });
});

describe("空の段階・例外の年・伸びは今と同じ結果", () => {
  /** 段階と例外の年を持てる所すべてに空の並びを入れる */
  const empty = (req: ReturnType<typeof modelHousehold>) => {
    const r = clone(req);
    const h = r.input.household as unknown as Obj;
    for (const e of (h.periodicExpenses as Obj[] | undefined) ?? []) Object.assign(e, { stages: [], exceptions: [] });
    for (const x of (h.residences as Obj[] | undefined) ?? []) for (const k of ["rent", "maintenance", "propertyTax"]) if (x[k] !== undefined) Object.assign(x[k] as Obj, { stages: [], exceptions: [] });
    for (const a of (h.accounts as Obj[] | undefined) ?? []) {
      Object.assign(a, { returnStages: [], returnExceptions: [] });
      const p = a.property as Obj | undefined;
      if (p?.rental !== undefined) Object.assign(p.rental as Obj, { stages: [], exceptions: [] });
      if (p?.expenses !== undefined) Object.assign(p.expenses as Obj, { stages: [], exceptions: [] });
    }
    const inv = ((r.input as unknown as Obj).assumptions as Obj).investment as Obj | undefined;
    if (inv?.allocation !== undefined) Object.assign(inv.allocation as Obj, { stages: [] });
    return r;
  };
  const strip = (x: ReturnType<typeof runEngine>) => JSON.stringify({ flows: x.flows, table: x.table, annual: x.annual, summary: x.summary, notices: (x.header as { notices: unknown }).notices });

  it.each(["housingPurchase", "investmentCouple", "sampleSingle40s", "sampleSeniorCouple", "lifetime100Assets", "elderCare"])("見本の世帯 %s に空の並びを入れても結果は同じ", (name) => {
    const req = modelHousehold(name);
    expect(strip(runEngine(empty(req), realPacks(), {}))).toBe(strip(runEngine(req, realPacks(), {})));
  });

  it("入力の形: 段は ID と時点が要り、額と割合はどちらか一方。例外の年は ID・年・額が要る", () => {
    const quiet = () => household({ members: [member("a", "self", "1980-01")], endYear: 2030, baseMonth: "2027-01" }) as Req;
    const pe = (o: Obj) => edit(quiet(), (h) => (h.periodicExpenses = [{ id: uid("pe"), row: "cf.expense.lumpSum.other", from: at("2027-08"), everyYears: 1, amount: box(1), ...o }]));
    expect(() => full(pe({ stages: [stage("a", { at: at("2028-01"), amount: box(1), ratio: "0.5" })] }))).toThrow(EngineError);
    expect(() => full(pe({ stages: [{ at: at("2028-01"), amount: box(1) }] }))).toThrow(EngineError);
    expect(() => full(pe({ stages: [stage("a", { at: at("2028-01"), amount: box(1), rampYears: 0 })] }))).toThrow(EngineError);
    expect(() => full(pe({ exceptions: [{ id: uid("e"), year: 2028 }] }))).toThrow(EngineError);
    expect(() => full(pe({ stages: [stage("a", { at: { memberAge: { member: A, years: 50 } }, ratio: "0.5", rampYears: 3 })], exceptions: [exception("e", 2028, 0)] }))).not.toThrow();
  });
});

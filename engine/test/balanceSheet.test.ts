// 全資産・全負債のバランスシートの材料のテスト（L1）: 持ち家の評価（housing.valuation）・売却・車の評価額（asset.car）・その他の資産。
// 手計算は decimal.js で別に書き（エンジンの率の割り算と同じ小数12桁・銀行丸め、金額は円未満切り捨て）、エンジンの結果と突き合わせる
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { CarValuationOutput, HousingValuationOutput } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const call = <T>(req: Req, component: string, input: unknown): T =>
  runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const A = uid("a");
const at = (ym: string) => ({ at: ym });
const withInput = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
type Cell = { row: string; year: number; amount: number; object?: string };
const cells = (r: ReturnType<typeof full>, row: string, year: number) => (r.table as unknown as Cell[]).filter((c) => c.row === row && c.year === year).reduce((s, c) => s + c.amount, 0);
const has = (r: ReturnType<typeof full>, row: string, year: number) => (r.table as unknown as Cell[]).some((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year);
/** 行とその下の行（不動産は土地と建物の行に分けて出す）の合計 */
const under = (r: ReturnType<typeof full>, row: string, year: number) => (r.table as unknown as Cell[]).filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year).reduce((s, c) => s + c.amount, 0);

const base = (o: { endYear?: number; inflation?: string } = {}) =>
  withInput(household({ members: [member("a", "self", "1985-01")], endYear: o.endYear ?? 2060, accounts: [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(30000000), asOf: "2025-12", contributions: [] }] }), (_h, input) => {
    if (o.inflation !== undefined) (input.assumptions as Obj).inflation = { default: o.inflation };
  });
const home = (o: Obj = {}): Obj => ({
  id: uid("home"),
  kind: "own",
  from: at("2027-04"),
  to: null,
  purchase: { price: 40000000, downPayment: 40000000, costs: 0 },
  ownership: [{ member: A, share: "1" }],
  ...o,
});
const valuation = (req: Req) => call<HousingValuationOutput>(req, "housing.valuation", {});

// ---- 独立の手計算（decimal.js）----
Decimal.set({ precision: 60 });
/** 率の割り算（小数12桁・銀行丸め） */
const div12 = (a: number, b: number) => new Decimal(a).div(b).toDecimalPlaces(12, Decimal.ROUND_HALF_EVEN);
/** 築年数 a の残りの割合（下限つき） */
const remain = (a: number, life: number, floor: string) => {
  if (a <= 0) return new Decimal(1);
  const raw = new Decimal(1).minus(div12(a, life));
  return raw.lt(floor) ? new Decimal(floor) : raw;
};
const floorYen = (d: Decimal) => d.toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();
/** 年末の評価額（土地・建物）。y0 は基にする年、built は建った年 */
function expected(o: { basis: number; share: string; life: number; floor: string; y0: number; built: number; growth: string }, y: number): { land: number; building: number } {
  let land = floorYen(new Decimal(o.basis).mul(o.share));
  const b0 = o.basis - land;
  for (let k = o.y0 + 1; k <= y; k++) land += floorYen(new Decimal(land).mul(o.growth));
  const f0 = remain(o.y0 - o.built, o.life, o.floor);
  const f = remain(y - o.built, o.life, o.floor);
  const building = f.eq(f0) ? b0 : floorYen(new Decimal(b0).mul(f.div(f0).toDecimalPlaces(12, Decimal.ROUND_HALF_EVEN)));
  return { land, building };
}

describe("持ち家の評価（housing.valuation）", () => {
  it("購入した新築: 土地（目安3割）は物価上昇率で上がり、建物（木造22年）は定額で減って下限（2割）で止まる", () => {
    const req = withInput(base({ inflation: "0.01" }), (h) => (h.residences = [home()]));
    const out = valuation(req);
    const p = out.properties[0];
    expect(p?.object).toBe(uid("home"));
    expect(p?.years[0]).toEqual({ year: 2027, land: 12000000, building: 28000000, value: 40000000 });
    const o = { basis: 40000000, share: "0.3", life: 22, floor: "0.2", y0: 2027, built: 2027, growth: "0.01" };
    for (const y of [2028, 2030, 2040, 2048, 2049, 2050, 2060]) {
      const e = expected(o, y);
      const got = p?.years.find((x) => x.year === y);
      expect(got, String(y)).toEqual({ year: y, land: e.land, building: e.building, value: e.land + e.building });
    }
    // 22年を過ぎた建物は下限（建てた時の2割）
    expect(p?.years.find((x) => x.year === 2060)?.building).toBe(5600000);
    expect(notices(full(req)).some((n) => n.code === "N_DEFAULT_USED" && n.ids.includes("residence.valuation.landShare"))).toBe(true);
  });

  it("構造・土地の割合・前提（耐用年数・下限・土地の上昇率）を変えられる", () => {
    const req = withInput(base({ inflation: "0.02" }), (h, input) => {
      h.residences = [home({ valuation: { structure: "rc", landShare: "0.5" } })];
      (input.assumptions as Obj).realEstateValuation = { landGrowth: { default: "0" }, usefulLife: { rc: 40 }, residualFloor: "0" };
    });
    const p = valuation(req).properties[0];
    const o = { basis: 40000000, share: "0.5", life: 40, floor: "0", y0: 2027, built: 2027, growth: "0" };
    for (const y of [2028, 2047, 2060]) {
      const e = expected(o, y);
      const got = p?.years.find((x) => x.year === y);
      expect(got, String(y)).toEqual({ year: y, land: e.land, building: e.building, value: e.land + e.building });
    }
    expect(p?.years.find((x) => x.year === 2047)?.land).toBe(20000000);
    expect(p?.years.find((x) => x.year === 2047)?.building).toBe(10000000);
  });

  it("今住んでいる持ち家（購入の入力なし）: 評価額と時点・建った年から、中古の建物は今の築年数の割合に対する比で減らす", () => {
    const req = withInput(base(), (h) => {
      h.residences = [{ id: uid("own"), kind: "own", from: at("2010-04"), to: null, ownership: [{ member: A, share: "1" }], valuation: { value: box(30000000), asOf: "2026-01", structure: "wood", builtYear: 2010, landShare: "0.4" } }];
    });
    const p = valuation(req).properties[0];
    const o = { basis: 30000000, share: "0.4", life: 22, floor: "0.2", y0: 2026, built: 2010, growth: "0" };
    expect(p?.years[0]?.year).toBe(2026);
    for (const y of [2026, 2027, 2031, 2032, 2033, 2040]) {
      const e = expected(o, y);
      expect(p?.years.find((x) => x.year === y), String(y)).toEqual({ year: y, land: e.land, building: e.building, value: e.land + e.building });
    }
  });

  it("評価の基にする額が無い持ち家は評価せず、知らせる", () => {
    const req = withInput(base(), (h) => (h.residences = [{ id: uid("own"), kind: "own", from: at("2010-04"), to: null, ownership: [{ member: A, share: "1" }] }]));
    const r = full(req);
    expect(has(r, "cf.balance.account.realEstate", 2027)).toBe(false);
    expect(notices(r).some((n) => n.code === "N_INPUT_REQUIRED" && n.ids.includes("residence.valuation"))).toBe(true);
  });

  it("売却: 住み終わりの月に、評価額から売却の費用（目安4%）を引いた手取りが現金になり、売った年の年末には持っていない", () => {
    const req = withInput(base(), (h) => (h.residences = [home({ to: at("2040-06"), sale: {} })]));
    const out = valuation(req);
    const p = out.properties[0];
    const e = expected({ basis: 40000000, share: "0.3", life: 22, floor: "0.2", y0: 2027, built: 2027, growth: "0" }, 2040);
    const value = e.land + e.building;
    const costs = floorYen(new Decimal(value).mul("0.04"));
    expect(p?.sale).toEqual({ ym: "2040-06", value, price: value, costs, proceeds: value - costs, tax: 0 });
    expect(p?.years.at(-1)?.year).toBe(2039);
    expect(out.flows).toEqual([{ row: "cf.income.lumpSum.realEstateSale", ym: "2040-06", amount: value - costs, accrualYear: 2040, member: A, object: uid("home"), formula: "housing.valuation.sale" }]);
    const r = full(req);
    expect(has(r, "cf.balance.account.realEstate", 2039)).toBe(true);
    expect(has(r, "cf.balance.account.realEstate", 2040)).toBe(false);
    expect(cells(r, "cf.income.lumpSum.realEstateSale", 2040)).toBe(value - costs);
    // 手取りはその年の収支に入り、決済口座（金融資産）が増える（増えた額の運用益の分だけ差は手取りより大きい）
    const keep = full(withInput(base(), (h) => (h.residences = [home({ to: at("2040-06") })])));
    expect(cells(r, "cf.net", 2040) - cells(keep, "cf.net", 2040)).toBe(value - costs);
    expect(cells(r, "cf.balance.financial", 2040) - cells(keep, "cf.balance.financial", 2040)).toBeGreaterThanOrEqual(value - costs);
    expect(notices(r).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("residence.saleTax"))).toBe(true);
    expect(notices(keep).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("residence.sale"))).toBe(true);
  });

  it("売却価格・費用の割合を入れたときはその額で", () => {
    const req = withInput(base(), (h) => (h.residences = [home({ to: at("2035-03"), sale: { price: 35000000, costRate: "0.05" } })]));
    expect(valuation(req).properties[0]?.sale).toMatchObject({ price: 35000000, costs: 1750000, proceeds: 33250000 });
  });

  it("譲渡所得の税の額（0053）: 入れた額を売った月に名義の人の出るお金にし、知らせは出さない。該当なし・0円は税なし", () => {
    const sold = (sale: Obj) => withInput(base(), (h) => (h.residences = [home({ to: at("2035-03"), sale: { price: 60000000, ...sale } })]));
    const none = full(sold({}));
    const taxed = sold({ tax: box(4200000) });
    const out = valuation(taxed);
    expect(out.properties[0]?.sale).toMatchObject({ price: 60000000, tax: 4200000 });
    // 所得税と住民税の明細に、長期譲渡の税率の比（15.315対5）で分ける（合計は入れた額。端数は所得税の側）
    const income = 4200000 - floorYen(new Decimal(4200000).mul(5000).div(20315));
    expect(out.flows.filter((f) => f.formula === "housing.valuation.saleTax")).toEqual([
      { row: "cf.taxSi.incomeTax.realEstateSale", amount: income, ym: "2035-03", accrualYear: 2035, member: A, object: uid("home"), formula: "housing.valuation.saleTax" },
      { row: "cf.taxSi.residentTax.realEstateSale", amount: 4200000 - income, ym: "2035-03", accrualYear: 2035, member: A, object: uid("home"), formula: "housing.valuation.saleTax" },
    ]);
    const r = full(taxed);
    expect(cells(r, "cf.taxSi.incomeTax.realEstateSale", 2035) + cells(r, "cf.taxSi.residentTax.realEstateSale", 2035)).toBe(4200000);
    expect(cells(none, "cf.net", 2035) - cells(r, "cf.net", 2035)).toBe(4200000);
    expect(notices(r).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("residence.saleTax"))).toBe(false);
    expect(notices(none).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("residence.saleTax"))).toBe(true);
    // 該当なし（税はかからないと FP が決めた）は0円で、知らせも出さない
    const na = full(sold({ tax: { state: "notApplicable", origin: { kind: "manual" } } }));
    expect(has(na, "cf.taxSi.incomeTax.realEstateSale", 2035)).toBe(false);
    expect(notices(na).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("residence.saleTax"))).toBe(false);
    expect(cells(na, "cf.net", 2035)).toBe(cells(none, "cf.net", 2035));
  });
});

describe("車の評価額（asset.car）", () => {
  it("買った月の価格から次の買い替えの下取りの額まで、月ごとに定額で下がる。手放した後は持っていない", () => {
    const req = withInput(base({ endYear: 2040 }), (h) => {
      h.cars = [{ id: uid("car"), owner: A, purchase: { first: at("2027-04"), everyYears: 6, price: 3000000, tradeIn: 600000 }, until: at("2037-03"), growth: { kind: "none" } }];
    });
    const out = call<CarValuationOutput>(req, "asset.car", {});
    const v = new Map(out.cars[0]?.years.map((e) => [e.year, e.value]));
    const at12 = (months: number) => 3000000 - floorYen(new Decimal(2400000).mul(months).div(72));
    expect(v.has(2026)).toBe(false);
    expect(v.get(2027)).toBe(at12(8));
    expect(v.get(2032)).toBe(at12(68));
    // 2033年4月に買い替え（その年の12月は買ってから8か月）
    expect(v.get(2033)).toBe(at12(8));
    expect(v.get(2036)).toBe(at12(44));
    expect(v.has(2037)).toBe(false);
    const r = full(req);
    expect(cells(r, "cf.balance.account.car", 2030)).toBe(v.get(2030));
  });

  it("今の車（owned）は最初の買い替えの月に下取りの額になるように下げる", () => {
    const req = withInput(base({ endYear: 2032 }), (h) => {
      h.cars = [{ id: uid("car"), owner: A, purchase: { first: at("2029-01"), everyYears: 5, price: 2000000, tradeIn: 500000, owned: true }, growth: { kind: "none" } }];
    });
    const v = new Map(call<CarValuationOutput>(req, "asset.car", {}).cars[0]?.years.map((e) => [e.year, e.value]));
    // 2024年1月に買ったとみなす: 2026年12月は35か月
    expect(v.get(2026)).toBe(2000000 - floorYen(new Decimal(1500000).mul(35).div(60)));
    expect(v.get(2028)).toBe(2000000 - floorYen(new Decimal(1500000).mul(59).div(60)));
    expect(v.get(2029)).toBe(2000000 - floorYen(new Decimal(1500000).mul(11).div(60)));
  });
});

describe("その他の資産と合計の一致", () => {
  it("その他の資産（otherAsset）は増減率で動き、金融資産に入れず、取り崩さない", () => {
    const req = withInput(base({ endYear: 2030 }), (h) => {
      (h.accounts as Obj[]).push({ id: uid("art"), kind: "otherAsset", owner: A, marketValue: box(1000000), asOf: "2025-12", contributions: [], valueGrowth: "-0.1" });
    });
    const r = full(req);
    expect(cells(r, "cf.balance.account.otherAsset", 2026)).toBe(900000);
    expect(cells(r, "cf.balance.account.otherAsset", 2027)).toBe(810000);
    expect(cells(r, "cf.balance.financial", 2027)).toBe(cells(r, "cf.balance.account.deposit", 2027));
    // 増減率を入れなければ動かない
    const flat = full(withInput(base({ endYear: 2028 }), (h) => (h.accounts as Obj[]).push({ id: uid("art"), kind: "otherAsset", owner: A, marketValue: box(1000000), asOf: "2025-12", contributions: [] })));
    expect(cells(flat, "cf.balance.account.otherAsset", 2028)).toBe(1000000);
  });

  it("暗号資産（cryptoAsset。0122）: 金融資産の合計に入れ、取り崩さない。利回りは器の利回りか資産の配分、どちらも無ければ0。積立は決済口座から", () => {
    const btc = uid("btc");
    const withCrypto = (o: Obj, deposit = 30000000) =>
      withInput(base({ endYear: 2030 }), (h) => {
        (h.accounts as Obj[])[0] = { ...((h.accounts as Obj[])[0] as Obj), marketValue: box(deposit) };
        (h.accounts as Obj[]).push({ id: btc, kind: "cryptoAsset", owner: A, marketValue: box(1000000), asOf: "2025-12", contributions: [], ...o });
      });
    const flat = full(withCrypto({}));
    expect(cells(flat, "cf.balance.account.cryptoAsset", 2028)).toBe(1000000);
    expect(cells(flat, "cf.balance.financial", 2028)).toBe(cells(flat, "cf.balance.account.deposit", 2028) + 1000000);
    // 器の利回り（年率）で増える
    const grown = full(withCrypto({ expectedReturn: "0.1" }));
    expect(cells(grown, "cf.balance.account.cryptoAsset", 2026)).toBe(1100000);
    expect(cells(grown, "cf.balance.account.cryptoAsset", 2027)).toBe(1210000);
    // 積立は決済口座から出て、暗号資産の積立の行に出る
    const monthly = full(withCrypto({ contributions: [{ from: at("2026-01"), to: at("2026-12"), monthly: 10000 }] }));
    expect(cells(monthly, "cf.balance.account.cryptoAsset", 2026)).toBe(1120000);
    expect(((monthly.table as unknown as Cell[]).filter((c) => c.row === "cf.transfer.savings.cryptoAsset" && c.year === 2026).reduce((s, c) => s + c.amount, 0))).toBe(120000);
    // 預金が尽きても取り崩さない（資金の不足が出る）
    const poor = full(withCrypto({}, 0));
    const shortfall = (r: ReturnType<typeof full>) => (r.table as unknown as Cell[]).some((c) => c.row === "cf.balance.shortfall");
    expect(shortfall(poor)).toBe(true);
    expect(cells(poor, "cf.balance.account.cryptoAsset", 2030)).toBe(1000000);
    // 取り崩す順番に書いても取り崩さない
    const ordered = full(
      withInput(withCrypto({}, 0), (_h, input) => {
        (input.assumptions as Obj).withdrawal = { order: [{ kind: "cryptoAsset" }, { kind: "deposit" }] };
      }),
    );
    expect(cells(ordered, "cf.balance.account.cryptoAsset", 2030)).toBe(1000000);
  });

  it("暗号資産の時価の下落（0122）: 器の種類を書かない下落は下げる。資産クラスを書いた下落は、配分の無い暗号資産を下げない。kinds に書けば下げる", () => {
    const btc = uid("btc");
    const req = (shock: Obj) =>
      withInput(base({ endYear: 2028 }), (h, input) => {
        (h.accounts as Obj[]).push({ id: btc, kind: "cryptoAsset", owner: A, marketValue: box(1000000), asOf: "2025-12", contributions: [] });
        (input.assumptions as Obj).marketShocks = [{ year: 2026, drop: "0.5", ...shock }];
      });
    expect(cells(full(req({})), "cf.balance.account.cryptoAsset", 2026)).toBe(500000);
    expect(cells(full(req({ assetClasses: ["equity.global"] })), "cf.balance.account.cryptoAsset", 2026)).toBe(1000000);
    expect(cells(full(req({ kinds: ["cryptoAsset"] })), "cf.balance.account.cryptoAsset", 2026)).toBe(500000);
    // 預金は既定の下落でも下げない（今までどおり）
    expect(cells(full(req({})), "cf.balance.account.deposit", 2026)).toBeGreaterThan(29000000);
  });

  it("金融資産の合計は、金融資産の器の残高の合計（不動産・車・その他の資産・保険は入れない）。純資産＝資産の合計−負債の合計", () => {
    const req = withInput(base({ endYear: 2045, inflation: "0.01" }), (h) => {
      (h.accounts as Obj[]).push(
        { id: uid("nisa"), kind: "nisa", owner: A, marketValue: box(2000000), asOf: "2025-12", contributions: [{ from: at("2026-01"), to: null, monthly: 30000 }] },
        { id: uid("land"), kind: "realEstate", owner: A, marketValue: box(8000000), asOf: "2025-12", contributions: [] },
        { id: uid("gold"), kind: "otherAsset", owner: A, marketValue: box(500000), asOf: "2025-12", contributions: [] },
      );
      h.residences = [home()];
      h.cars = [{ id: uid("car"), owner: A, purchase: { first: at("2028-04"), everyYears: 7, price: 2500000, tradeIn: 300000, owned: true }, growth: { kind: "none" } }];
      h.debts = [
        {
          id: uid("loan"),
          kind: "mortgage",
          debtors: [{ member: A, role: "primary" }],
          principal: 20000000,
          start: at("2027-04"),
          rateSchedule: [{ from: at("2027-04"), type: "fixed", rate: "0.01" }],
          repayment: { method: "equalPayment", termMonths: 300 },
        },
      ];
    });
    const r = full(req);
    const table = r.table as unknown as Cell[];
    const NOT_FINANCIAL = new Set(["cf.balance.account.realEstate", "cf.balance.account.insurance", "cf.balance.account.otherAsset", "cf.balance.account.car"]);
    for (const y of [2026, 2027, 2030, 2045]) {
      const accounts = table.filter((c) => c.year === y && c.row.startsWith("cf.balance.account."));
      const fin = accounts.filter((c) => !NOT_FINANCIAL.has(c.row) && !c.row.startsWith("cf.balance.account.realEstate.")).reduce((s, c) => s + c.amount, 0);
      expect(fin, String(y)).toBe(cells(r, "cf.balance.financial", y));
      const assets = accounts.reduce((s, c) => s + c.amount, 0);
      const debts = table.filter((c) => c.year === y && c.row.startsWith("cf.balance.debt.")).reduce((s, c) => s + c.amount, 0);
      const realEstate = under(r, "cf.balance.account.realEstate", y);
      const others = cells(r, "cf.balance.account.otherAsset", y) + cells(r, "cf.balance.account.car", y) + cells(r, "cf.balance.account.insurance", y);
      expect(assets - debts, String(y)).toBe(cells(r, "cf.balance.financial", y) + realEstate + others - debts);
    }
    expect(under(r, "cf.balance.account.realEstate", 2030)).toBeGreaterThan(8000000);
    expect(cells(r, "cf.balance.account.car", 2026)).toBeGreaterThan(0);
    expect(cells(r, "cf.balance.debt.mortgage", 2030)).toBeGreaterThan(0);
  });
});

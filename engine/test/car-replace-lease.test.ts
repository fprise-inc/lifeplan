// 車の買い替えの決まり・手放す月に買わない・リースと長期レンタル（expense.car 改訂4・asset.car 改訂3・0101）のテスト（L1）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { carLeaseIncludes, carPurchaseMonths } from "../src/sdk/cars.ts";
import type { CarValuationOutput } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Flow = { row: string; ym: string; amount: number; member?: string; object?: string; formula: string };
const A = uid("a");
const CAR = uid("car");
const at = (ym: string) => ({ at: ym });
const withCar = (car: Obj, endYear = 2045): Req => {
  const r = JSON.parse(JSON.stringify(household({ members: [member("a", "self", "1980-01")], endYear, baseMonth: "2027-01" }))) as Req;
  const h = (r.input as unknown as Obj).household as Obj;
  h.accounts = [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(10000000), asOf: "2027-01", contributions: [] }];
  h.cars = [{ id: CAR, owner: A, growth: { kind: "none" }, ...car }];
  return r;
};
const run = (req: Req, component: string, input: unknown) => runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component, input } }).entryOutput;
const flows = (req: Req) => (run(req, "expense.car", { member: A }) as { flows: Flow[] }).flows;
const buys = (fs: readonly Flow[]) => fs.filter((f) => f.formula === "expense.car.purchase").map((f) => f.ym);
const values = (req: Req) => new Map((run(req, "asset.car", {}) as CarValuationOutput).cars[0]?.years.map((e) => [e.year, e.value as number]));
const ym = (y: number, m: number) => y * 12 + m - 1;

describe("購入の月の決まり（SDK の carPurchaseMonths）", () => {
  it("手放す月には買わない（その前の月までの購入だけ）", () => {
    expect(carPurchaseMonths({ first: ym(2027, 4), everyYears: 5, release: ym(2037, 4), end: ym(2045, 12) })).toEqual([ym(2027, 4), ym(2032, 4)]);
    expect(carPurchaseMonths({ first: ym(2027, 4), everyYears: 5, release: ym(2037, 5), end: ym(2045, 12) })).toEqual([ym(2027, 4), ym(2032, 4), ym(2037, 4)]);
    expect(carPurchaseMonths({ first: ym(2027, 4), everyYears: 5, release: null, end: ym(2037, 4) })).toEqual([ym(2027, 4), ym(2032, 4), ym(2037, 4)]);
  });

  it("この1台だけ: これから買う車は1回だけ、今の車は買わない。○歳まで: その月までの購入だけ", () => {
    const o = { first: ym(2027, 4), everyYears: 5, release: ym(2050, 1), end: ym(2060, 12) };
    expect(carPurchaseMonths({ ...o, replace: "none" })).toEqual([ym(2027, 4)]);
    expect(carPurchaseMonths({ ...o, owned: true, replace: "none" })).toEqual([]);
    expect(carPurchaseMonths({ ...o, replace: { lastAt: ym(2037, 4) } })).toEqual([ym(2027, 4), ym(2032, 4), ym(2037, 4)]);
    expect(carPurchaseMonths({ ...o, replace: { lastAt: ym(2037, 3) } })).toEqual([ym(2027, 4), ym(2032, 4)]);
    // 手放す月より後の「○歳まで」は、買い替え続けると同じ
    expect(carPurchaseMonths({ ...o, replace: { lastAt: ym(2055, 1) } })).toEqual(carPurchaseMonths(o));
  });

  it("リースの月額に含む物の既定（カーリースは保険を含まない、長期レンタルは全部）。書いた物はそのまま", () => {
    expect(carLeaseIncludes({ type: "carLease" })).toEqual({ taxAndCompulsory: true, inspectionMaintenance: true, insurance: false });
    expect(carLeaseIncludes({ type: "longRental" })).toEqual({ taxAndCompulsory: true, inspectionMaintenance: true, insurance: true });
    expect(carLeaseIncludes({ type: "carLease", includes: { insurance: true, taxAndCompulsory: false } })).toEqual({ taxAndCompulsory: false, inspectionMaintenance: true, insurance: true });
  });
});

describe("買い替え（expense.car 改訂4）", () => {
  const p = { first: at("2027-04"), everyYears: 5, price: 2000000, tradeIn: 400000 };

  it("手放す月と買い替えの月が重なると、その月には買わない（前は買っていた）", () => {
    const fs = flows(withCar({ purchase: p, until: at("2037-04") }));
    expect(buys(fs)).toEqual(["2027-04", "2032-04"]);
  });

  it("この1台だけ（これから買う車）: 1回だけ買い、手放す月まで維持費を数える", () => {
    const fs = flows(withCar({ purchase: { ...p, replace: { kind: "none" } }, until: at("2040-03"), upkeep: { annual: 120000 }, upkeepMode: "total" }));
    expect(buys(fs)).toEqual(["2027-04"]);
    expect(fs.find((f) => f.formula === "expense.car.purchase")?.amount).toBe(2000000);
    expect(fs.filter((f) => f.formula === "expense.car.upkeep").map((f) => f.ym).at(-1)).toBe("2040-03");
  });

  it("今の車に乗り続ける: 買わず、車検は次の買い替えの周期の前に買ったとみなして手放すまで続ける", () => {
    const fs = flows(withCar({ purchase: { ...p, owned: true, replace: { kind: "none" } }, until: at("2034-12"), inspection: { amount: 100000 } }));
    expect(buys(fs)).toEqual([]);
    // 2022年4月に買ったとみなす: 車検は 2025・2027・2029・2031・2033 年の4月（計算基準月より後だけ）
    expect(fs.filter((f) => f.formula === "expense.car.inspection").map((f) => f.ym)).toEqual(["2027-04", "2029-04", "2031-04", "2033-04"]);
  });

  it("○歳まで買い替える: その年齢になる前の月までの購入だけで、その後は手放すまで乗る", () => {
    // 本人は1980年1月生まれ。55歳まで（2035年1月になる前の月＝2034年12月まで）
    const fs = flows(withCar({ purchase: { ...p, replace: { kind: "until", until: { memberAge: { member: A, years: 54, months: 11 } } } }, until: at("2044-12") }));
    expect(buys(fs)).toEqual(["2027-04", "2032-04"]);
  });

  it("買い替え続ける（repeat）と省略は同じ", () => {
    expect(flows(withCar({ purchase: { ...p, replace: { kind: "repeat" } }, until: at("2044-12") }))).toEqual(flows(withCar({ purchase: p, until: at("2044-12") })));
  });
});

describe("リース・長期レンタル（expense.car 改訂4）", () => {
  const tax = { annual: 36000 };
  const insurance = { annual: 70000 };
  const inspection = { amount: 100000 };

  it("月額を始まりから手放す月まで、車の維持費の行に毎月（契約の年数の後も同じ月額。購入・ローンは無い）", () => {
    const fs = flows(withCar({ lease: { type: "carLease", monthly: 40000, from: at("2028-04"), termYears: 7 }, until: at("2040-03"), loan: { rate: "0.02", termMonths: 60 } }));
    const lease = fs.filter((f) => f.formula === "expense.car.lease");
    expect(lease[0]?.ym).toBe("2028-04");
    expect(lease.at(-1)?.ym).toBe("2040-03");
    expect(lease.length).toBe(12 * 12);
    expect(lease.every((f) => f.amount === 40000 && f.row === "cf.expense.living.car")).toBe(true);
    expect(fs.some((f) => f.formula === "expense.car.purchase" || f.row.startsWith("cf.expense.debt"))).toBe(false);
  });

  it("始まりの省略はもう借りている（計算基準月から）。手放す時期が無ければ最後まで", () => {
    const lease = flows(withCar({ lease: { type: "longRental", monthly: 50000 } }, 2030)).filter((f) => f.formula === "expense.car.lease");
    expect(lease[0]?.ym).toBe("2027-01");
    expect(lease.at(-1)?.ym).toBe("2030-12");
  });

  it("月額に含む物は内訳から数えない（カーリース: 税・車検は数えず保険は数える。長期レンタル: どれも数えない。値は残る）", () => {
    const rest = { tax, insurance, inspection, parking: { annual: 120000 }, upkeepMode: "detail", until: at("2040-12") };
    const lease = flows(withCar({ lease: { type: "carLease", monthly: 40000 }, ...rest }));
    expect(lease.some((f) => f.formula === "expense.car.tax" || f.formula === "expense.car.inspection")).toBe(false);
    expect(lease.filter((f) => f.formula === "expense.car.insurance").length).toBeGreaterThan(0);
    expect(lease.filter((f) => f.formula === "expense.car.parking").length).toBeGreaterThan(0);
    const rental = flows(withCar({ lease: { type: "longRental", monthly: 50000 }, ...rest }));
    expect(rental.some((f) => ["expense.car.tax", "expense.car.inspection", "expense.car.insurance"].includes(f.formula))).toBe(false);
    // 含む物を外したら数える（車検は始まりから3年後）
    const own = flows(withCar({ lease: { type: "carLease", monthly: 40000, from: at("2028-01"), includes: { inspectionMaintenance: false } }, ...rest }));
    expect(own.filter((f) => f.formula === "expense.car.inspection").map((f) => f.ym)[0]).toBe("2031-01");
  });

  it("評価額を持たない", () => {
    expect(values(withCar({ lease: { type: "carLease", monthly: 40000 } })).size).toBe(0);
  });

  it("買う車とリースの両方を持つ車は入力の検査で止まる", () => {
    expect(() => flows(withCar({ purchase: { first: at("2027-04"), everyYears: 5, price: 2000000 }, lease: { type: "carLease", monthly: 40000 } }))).toThrow();
  });
});

describe("評価額（asset.car 改訂3）", () => {
  it("この1台だけの車は、買った月から手放す月に0になるように定額で下がる", () => {
    const v = values(withCar({ purchase: { first: at("2027-01"), everyYears: 8, price: 2400000, tradeIn: 300000, replace: { kind: "none" } }, until: at("2039-01") }));
    // 12年（144か月）で0に。2027年12月は11か月
    expect(v.get(2027)).toBe(2400000 - Math.floor((2400000 * 11) / 144));
    expect(v.get(2032)).toBe(2400000 - Math.floor((2400000 * 71) / 144));
    expect(v.get(2038)).toBe(2400000 - Math.floor((2400000 * 143) / 144));
    expect(v.has(2039)).toBe(false);
  });

  it("買い替え続ける車は前のとおり（次の買い替えの下取りの額まで）", () => {
    const v = values(withCar({ purchase: { first: at("2027-01"), everyYears: 8, price: 2400000, tradeIn: 300000 }, until: at("2039-01") }));
    expect(v.get(2027)).toBe(2400000 - Math.floor((2100000 * 11) / 96));
  });
});

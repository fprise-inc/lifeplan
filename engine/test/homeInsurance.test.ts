// 住宅購入の予定の火災保険・地震保険（0221）のテスト（L1）: 購入の月（注文住宅は引き渡しの月）から契約の年数ごとに払う（housing.residence 改訂9）、
// 住み終わり・計算の最後の年・保険の入力項目で入れた印との境目、地震保険の分の地震保険料控除（tax.deductions 改訂9。年数で割った額を毎年）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { DeductionsOutput, ResidenceOutput } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, period, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const call = <T>(req: Req, component: string, input: unknown): T =>
  runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const A = uid("a");
const at = (ym: string) => ({ at: ym });
const withInput = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};

const base = (o: { endYear?: number; baseMonth?: string } = {}) =>
  withInput(
    household({
      members: [member("a", "self", "1985-01")],
      endYear: o.endYear ?? 2045,
      accounts: [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(30000000), asOf: "2025-12", contributions: [] }],
      periods: [period("p", { member: "a", from: "2010-04", annual: 6000000, std: [500000, 500000] })],
    }),
    (_h, input) => {
      if (o.baseMonth !== undefined) input.baseMonth = o.baseMonth;
    },
  );
const insurance = (o: Obj = {}): Obj => ({ years: 5, fire: box(100000), earthquake: box(200000), ...o });
const home = (o: { at?: string; to?: string | null; ins?: Obj | null; purchase?: Obj } = {}): Obj => ({
  id: uid("home"),
  kind: "own",
  from: at(o.at ?? "2028-03"),
  to: o.to === undefined || o.to === null ? null : at(o.to),
  purchase: { at: at(o.at ?? "2028-03"), price: 40000000, downPayment: 40000000, costs: 2000000, ...(o.ins === null ? {} : { homeInsurance: o.ins ?? insurance() }), ...(o.purchase ?? {}) },
  ownership: [{ member: A, share: "1" }],
});
const flowsOf = (req: Req) => call<ResidenceOutput>(req, "housing.residence", {}).flows;
const ins = (req: Req) =>
  flowsOf(req)
    .filter((f) => f.row === "cf.expense.housing.insurance")
    .map((f) => [f.ym, f.amount, f.formula === "housing.residence.fireInsurance" ? "fire" : "quake"]);
const quakeDeduction = (req: Req, year: number, regime: "incomeTax" | "residentTax" = "incomeTax") => call<DeductionsOutput>(req, "tax.deductions", { member: A, year, regime }).earthquake;

describe("火災保険・地震保険を払う月（housing.residence 改訂9）", () => {
  it("購入の月に契約の年数分を払い、その後は年数ごとに計算の最後まで払う（伸ばさない）", () => {
    const req = withInput(base(), (h) => (h.residences = [home()]));
    expect(ins(req)).toEqual([
      ["2028-03", 100000, "fire"],
      ["2028-03", 200000, "quake"],
      ["2033-03", 100000, "fire"],
      ["2033-03", 200000, "quake"],
      ["2038-03", 100000, "fire"],
      ["2038-03", 200000, "quake"],
      ["2043-03", 100000, "fire"],
      ["2043-03", 200000, "quake"],
    ]);
  });

  it("契約の年数1年は毎年。計算の最後の年をまたぐ更新（最後の年の更新）も年数分を払う", () => {
    const one = withInput(base({ endYear: 2031 }), (h) => (h.residences = [home({ ins: insurance({ years: 1, earthquake: box(0) }) })]));
    expect(ins(one)).toEqual([
      ["2028-03", 100000, "fire"],
      ["2029-03", 100000, "fire"],
      ["2030-03", 100000, "fire"],
      ["2031-03", 100000, "fire"],
    ]);
    const five = withInput(base({ endYear: 2033 }), (h) => (h.residences = [home()]));
    expect(ins(five).map((x) => x[0])).toEqual(["2028-03", "2028-03", "2033-03", "2033-03"]);
  });

  it("買う月が1月・12月でも、その月から年数ごと", () => {
    expect(ins(withInput(base(), (h) => (h.residences = [home({ at: "2028-01" })])))[2]?.[0]).toBe("2033-01");
    expect(ins(withInput(base(), (h) => (h.residences = [home({ at: "2027-12" })])))[2]?.[0]).toBe("2032-12");
  });

  it("住み終わり（売る・住み替え）があれば、住み終わりの月より前の更新まで。住み終わりの月の更新は払わない", () => {
    expect(ins(withInput(base(), (h) => (h.residences = [home({ to: "2038-03" })]))).map((x) => x[0])).toEqual(["2028-03", "2028-03", "2033-03", "2033-03"]);
    expect(ins(withInput(base(), (h) => (h.residences = [home({ to: "2038-04" })]))).map((x) => x[0])).toEqual(["2028-03", "2028-03", "2033-03", "2033-03", "2038-03", "2038-03"]);
    const sold = withInput(base(), (h) => (h.residences = [{ ...home({ to: "2035-06" }), sale: {} }]));
    expect(ins(sold).map((x) => x[0])).toEqual(["2028-03", "2028-03", "2033-03", "2033-03"]);
  });

  it("注文住宅は引き渡しの月（購入の月）から。土地の決済の月には払わない", () => {
    const req = withInput(base(), (h) => (h.residences = [home({ purchase: { land: { at: at("2027-05"), price: 20000000 } } })]));
    expect(ins(req)[0]?.[0]).toBe("2028-03");
    expect(ins(req).some((x) => x[0] === "2027-05")).toBe(false);
  });

  it("前に買った家（購入の月が計算基準月より前）は、計算基準月より後の更新から", () => {
    const req = withInput(base(), (h) => (h.residences = [home({ at: "2024-07" })]));
    expect(ins(req).map((x) => x[0]).slice(0, 2)).toEqual(["2029-07", "2029-07"]);
  });

  it("保険の入力項目で入れた印（countedInInsurance）なら払わない・控除にも入れない。火災保険・地震保険の無い購入の予定は前のまま", () => {
    const off = withInput(base(), (h) => (h.residences = [home({ ins: insurance({ countedInInsurance: true }) })]));
    expect(ins(off)).toEqual([]);
    expect(quakeDeduction(off, 2028)).toBe(0);
    const none = withInput(base(), (h) => (h.residences = [home({ ins: null })]));
    expect(ins(none)).toEqual([]);
    expect(call<ResidenceOutput>(none, "housing.residence", {}).earthquakePremiums).toBeUndefined();
  });

  it("表の行は住居関連費の下（火災保険・地震保険）。購入の予定の無い今の持ち家は何も変わらない", () => {
    const req = withInput(base(), (h) => (h.residences = [home()]));
    const cells = (full(req).table as unknown as { row: string; year: number; amount: number }[]).filter((c) => c.row === "cf.expense.housing.insurance");
    expect(cells.find((c) => c.year === 2028)?.amount).toBe(300000);
    const owned = withInput(base(), (h) => (h.residences = [{ id: uid("own"), kind: "own", from: at("2015-04"), to: null, ownership: [{ member: A, share: "1" }] }]));
    expect(ins(owned)).toEqual([]);
  });
});

describe("地震保険料控除（tax.deductions 改訂9）", () => {
  it("5年分を一括で払った地震保険料は、払った年から5年の間、5分の1ずつを地震保険料にする（所得税は全額・5万円まで、住民税は半分・2.5万円まで）", () => {
    const req = withInput(base(), (h) => (h.residences = [home()]));
    // 20万円 ÷ 5 = 4万円（所得税は全額、住民税は半分）
    for (const y of [2028, 2029, 2030, 2031, 2032]) expect(quakeDeduction(req, y)).toBe(40000);
    expect(quakeDeduction(req, 2028, "residentTax")).toBe(20000);
    // 2033年は次の契約の1年目
    expect(quakeDeduction(req, 2033)).toBe(40000);
    expect(quakeDeduction(req, 2027)).toBe(0);
  });

  it("上限で止める（架空の制度データの上限）。1年契約はその年に払った額", () => {
    const big = withInput(base(), (h) => (h.residences = [home({ ins: insurance({ earthquake: box(1000000) }) })]));
    const bigger = withInput(base(), (h) => (h.residences = [home({ ins: insurance({ earthquake: box(5000000) }) })]));
    expect(quakeDeduction(big, 2029)).toBeLessThan(200000);
    expect(quakeDeduction(big, 2029)).toBe(quakeDeduction(bigger, 2029));
    const one = withInput(base(), (h) => (h.residences = [home({ ins: insurance({ years: 1, earthquake: box(30000) }) })]));
    expect(quakeDeduction(one, 2030)).toBe(30000);
  });

  it("前に買った家の、計算基準月より前に一括で払った分も、残りの年の控除に入る", () => {
    const req = withInput(base(), (h) => (h.residences = [home({ at: "2024-07" })]));
    expect(quakeDeduction(req, 2026)).toBe(40000);
    expect(quakeDeduction(req, 2028)).toBe(40000);
  });

  it("地震保険料が0円（付けない）なら控除は無い", () => {
    const req = withInput(base(), (h) => (h.residences = [home({ ins: insurance({ earthquake: box(0) }) })]));
    expect(quakeDeduction(req, 2029)).toBe(0);
  });
});

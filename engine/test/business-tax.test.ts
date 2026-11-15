// 個人事業税（tax.businessTax。地方税法72条の49の12・72条の49の14・72条の49の17・72条の51。0155 の追記 2026-11-15）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { box, household, member, modelHousehold, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Flow = { row: string; ym: string; amount: number; member?: string; accrualYear?: number; formula?: string };
const packs = realPacks();
const A = uid("a");
const run = (req: Req) => runEngine(req, packs, { checkInternal: true });
const bt = (req: Req, year: number) =>
  runEngine(req, packs, { checkInternal: true, entry: { component: "tax.businessTax", input: { member: A, year } } }).entryOutput as { flows: Flow[]; total: number; income: number; months: number; deduction: number; taxable: number };
const paid = (req: Req) => (run(req).flows as unknown as Flow[]).filter((f) => f.row === "cf.taxSi.businessTax").map((f) => [f.ym, f.amount, f.accrualYear] as const);

interface Biz {
  readonly id?: string;
  readonly from: string;
  readonly to?: string | null;
  readonly income: number;
  readonly cls?: string;
}
const selfEmployed = (b: Biz) => ({
  id: uid(b.id ?? "biz"),
  member: A,
  from: { at: b.from },
  to: b.to === undefined || b.to === null ? null : { at: b.to },
  type: "selfEmployed",
  business: { income: box(b.income), ...(b.cls !== undefined ? { businessTaxClass: b.cls } : {}) },
});
const mk = (bs: readonly Biz[], o: { baseMonth?: string; endYear?: number; taxReturn?: Obj; birth?: string } = {}): Req =>
  household({
    baseMonth: o.baseMonth ?? "2026-01",
    endYear: o.endYear ?? 2032,
    wageGrowth: "0",
    members: [member("a", "self", o.birth ?? "1980-05", o.taxReturn !== undefined ? { taxReturn: o.taxReturn } : {})],
    periods: bs.map(selfEmployed),
    accounts: [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(30000000), asOf: "2025-12", contributions: [] }],
  });

describe("個人事業税の額", () => {
  it("事業所得850万円・第1種: (850万−290万)×5%＝28万円を翌年の8月と11月に半分ずつ", () => {
    const req = mk([{ from: "2015-04", income: 8500000 }]);
    const t = bt(req, 2027);
    expect([t.income, t.months, t.deduction, t.taxable, t.total]).toEqual([8500000, 12, 2900000, 5600000, 280000]);
    expect(t.flows.map((f) => [f.ym, f.amount, f.row])).toEqual([
      ["2028-08", 140000, "cf.taxSi.businessTax"],
      ["2028-11", 140000, "cf.taxSi.businessTax"],
    ]);
  });

  it("分けた額の1,000円未満は8月の分（500万円: 10.5万円→8月 53,000円・11月 52,000円）。290万円以下は0円", () => {
    const t = bt(mk([{ from: "2015-04", income: 5000000 }]), 2027);
    expect(t.total).toBe(105000);
    expect(t.flows.map((f) => f.amount)).toEqual([53000, 52000]);
    // 課税標準の1,000円未満を切り捨て、税額の100円未満を切り捨て: (3,412,345−2,900,000)→512,000×5%＝25,600
    expect(bt(mk([{ from: "2015-04", income: 3412345 }]), 2027).total).toBe(25600);
    const none = bt(mk([{ from: "2015-04", income: 2900000 }]), 2027);
    expect([none.total, none.flows]).toEqual([0, []]);
  });

  it("業種の区分: 第2種4%・第3種5%・あん摩・はり・装蹄師など3%・法定業種でない仕事は0円。入れないのと第1種は同じ", () => {
    const of = (cls?: string) => bt(mk([{ from: "2015-04", income: 8500000, ...(cls !== undefined ? { cls } : {}) }]), 2027).total;
    expect(of()).toBe(280000);
    expect(of("class1")).toBe(280000);
    expect(of("class2")).toBe(224000);
    expect(of("class3")).toBe(280000);
    expect(of("class3Reduced")).toBe(168000);
    expect(of("none")).toBe(0);
    expect(paid(mk([{ from: "2015-04", income: 8500000, cls: "none" }]))).toEqual([]);
  });

  it("青色申告特別控除は引かない（青色65万円でも白色と同じ額）", () => {
    const white = bt(mk([{ from: "2015-04", income: 8500000 }]), 2027).total;
    const blue = bt(mk([{ from: "2015-04", income: 8500000 }], { taxReturn: { method: "blue", blueDeduction: "electronic" } }), 2027).total;
    expect(blue).toBe(white);
  });

  it("区分の違う期間がある年は、課税標準を区分ごとの所得で按分する（地方税法72条の49の17第2項）", () => {
    const req = mk([
      { id: "b1", from: "2015-04", to: "2027-06", income: 6000000, cls: "class1" },
      { id: "b2", from: "2027-07", income: 6000000, cls: "class3Reduced" },
    ]);
    const t = bt(req, 2027);
    // 所得 300万＋300万、12か月で控除290万、課税標準310万を半分ずつ: 155万×5%＋155万×3%
    expect([t.income, t.months, t.taxable, t.total]).toEqual([6000000, 12, 3100000, 124000]);
    // 法定業種でない期間の月は、事業主控除の月数に数えない
    const mixed = bt(mk([{ id: "b1", from: "2015-04", to: "2027-06", income: 6000000, cls: "none" }, { id: "b2", from: "2027-07", income: 6000000 }]), 2027);
    expect([mixed.income, mixed.months, mixed.deduction]).toEqual([3000000, 6, 1450000]);
  });
});

describe("始めた年・やめた年・亡くなった年", () => {
  it("年の途中で始めた年は事業主控除を月割り（1,000円未満の切り上げ: 5か月 1,209,000円）", () => {
    const t = bt(mk([{ from: "2027-08", income: 6000000 }]), 2027);
    expect([t.months, t.deduction]).toEqual([5, 1209000]);
    // (250万−1,209,000)×5%＝64,550 の100円未満を切り捨て
    expect(t.total).toBe(64500);
    expect(t.flows.map((f) => f.ym)).toEqual(["2028-08", "2028-11"]);
  });

  it("年の途中でやめた年の分は、やめた月の2か月後に1回で（1〜3月にやめたら4月、12月にやめたら翌年2月）", () => {
    const june = bt(mk([{ from: "2015-04", to: "2028-06", income: 8400000 }]), 2028);
    expect([june.months, june.deduction, june.total]).toEqual([6, 1450000, Math.floor((4200000 - 1450000) / 1000) * 50]);
    expect(june.flows.map((f) => [f.ym, f.amount, f.formula])).toEqual([["2028-08", june.total, "tax.businessTax.closure"]]);
    expect(bt(mk([{ from: "2015-04", to: "2028-02", income: 24000000 }]), 2028).flows.map((f) => f.ym)).toEqual(["2028-04"]);
    expect(bt(mk([{ from: "2015-04", to: "2028-12", income: 8400000 }]), 2028).flows.map((f) => f.ym)).toEqual(["2029-02"]);
    // 前の年の分は今までどおり翌年の8月・11月
    expect(bt(mk([{ from: "2015-04", to: "2028-06", income: 8400000 }]), 2027).flows.map((f) => f.ym)).toEqual(["2028-08", "2028-11"]);
    // 次の月に別の自営の期間が続くなら、やめたことにしない
    const cont = bt(mk([{ id: "b1", from: "2015-04", to: "2028-06", income: 8400000 }, { id: "b2", from: "2028-07", income: 8400000 }]), 2028);
    expect(cont.flows.map((f) => f.ym)).toEqual(["2029-08", "2029-11"]);
  });

  it("亡くなる想定: 亡くなった月で事業が終わり、その年の分を亡くなった人の名で2か月後に払う", () => {
    const req = mk([{ from: "2015-04", income: 8400000 }]);
    (req.input as unknown as Obj).contingencies = [{ id: uid("death"), kind: "death", member: A, occurs: { at: "2029-05" } }];
    const flows = (run(req).flows as unknown as Flow[]).filter((f) => f.row === "cf.taxSi.businessTax" && (f.accrualYear ?? 0) >= 2028);
    // 2028年の分（8月・11月）と、2029年1〜5月の分（7月に1回）
    expect(flows.map((f) => [f.ym, f.accrualYear, f.member])).toEqual([
      ["2029-07", 2029, A],
      ["2029-08", 2028, A],
      ["2029-11", 2028, A],
    ]);
    const t = bt(req, 2029);
    expect([t.months, t.deduction, t.income]).toEqual([5, 1209000, 3500000]);
  });
});

describe("表に載る月", () => {
  it("計算基準月が1〜3月・1〜5月なら前年分の8月・11月も載る。12月なら前年分は載らない。表の最後の年の分は表の外", () => {
    const of = (baseMonth: string) => paid(mk([{ from: "2015-04", income: 8500000 }], { baseMonth, endYear: 2028 }));
    expect(of("2026-02").slice(0, 2)).toEqual([
      ["2026-08", 140000, 2025],
      ["2026-11", 140000, 2025],
    ]);
    expect(of("2026-05")[0]).toEqual(["2026-08", 140000, 2025]);
    expect(of("2026-09")[0]).toEqual(["2026-11", 140000, 2025]);
    expect(of("2026-12")[0]).toEqual(["2027-08", 140000, 2026]);
    // 表の最後の年（2028年）の分は2029年に払うので載らない
    expect(of("2026-02").at(-1)).toEqual(["2028-11", 140000, 2027]);
  });

  it("表の行 cf.taxSi.businessTax に入り、年間収支を減らす（モデル世帯 selfEmployed: 2027年は 2026年分の 10.5万円）", () => {
    const req = modelHousehold("selfEmployed") as unknown as Req;
    const table = run(req).table as unknown as { row: string; year: number; amount: number }[];
    const y2027 = table.filter((c) => c.row === "cf.taxSi.businessTax" && c.year === 2027).reduce((s, c) => s + c.amount, 0);
    expect(y2027).toBe(105000);
  });
});

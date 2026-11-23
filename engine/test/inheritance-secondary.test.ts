// 相続税の試算の次の回（0250）: 遺産の分け方（配偶者の割合・配偶者のほかの相続人の分け方）、小規模宅地等の特例の減額を土地を取得する人に寄せる、
// 一次と二次の推移（先に亡くなる人がその年に亡くなったら、の一次と、後に亡くなる人が表の最後の年の12月に亡くなる二次）、相次相続控除、
// 二次の未成年者控除の残り（inheritance.estimate 改訂7・約束の版 1.3）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { box, clone, household, member, modelHousehold, realPacks, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
type Req = EngineRequest;
type Heir = { member?: string; acquisition: number; tax: number; payable: number; spouseReduction: number; minorCredit?: number; landReduction?: number; successiveCredit?: number };
type Point = {
  point: string;
  decedent: string;
  status: string;
  assets: Record<string, number> & { taxablePrice: number };
  byHeir: Heir[];
  totalTax: number;
  payable: number;
  minorCredit?: number;
  division?: { entered: boolean; spouseShare?: string; adjusted?: true };
  cautions: string[];
  lands?: { object: string; special: { status: string; reduction: number } }[];
};
type Row = { year: number; month: string; primary: number; secondary: number; total: number; primaryTaxable: number; secondaryTaxable: number; spouseAcquisition: number; spouseTax: number; inherited: number; successiveCredit: number; secondaryMinorCredit: number };
type Timeline = { first: string; second: string; secondMonth: string; step: number; series: { key: string; spouseShare?: string; rows: Row[] }[] };
type Out = { points: Point[]; notIncluded: string[]; timeline?: Timeline };

const H = uid("h");
const W = uid("w");
const C1 = uid("c1");
const C2 = uid("c2");
const HOME = uid("home");
const RENT = uid("rent");
const at = (ym: string) => ({ at: ym });

function family(o: { amount?: number; baseMonth?: string; endYear?: number; kidBirths?: string[]; kids?: number } = {}): Req {
  const births = o.kidBirths ?? ["1992-05", "1994-05"];
  const kids = [C1, C2].slice(0, o.kids ?? 2);
  return household({
    baseMonth: o.baseMonth ?? "2026-01",
    endYear: o.endYear ?? 2030,
    members: [{ ...member("h", "self", "1956-04"), sex: "male" }, member("w", "spouse", "1958-04"), ...kids.map((_, i) => member(`c${i + 1}`, "child", births[i] as string))],
    relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }],
    accounts: [{ id: uid("dep"), kind: "deposit", owner: H, marketValue: box(o.amount ?? 200_000_000), asOf: "2026-01", contributions: [] }],
  });
}
const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = clone(req);
  f(r.input.household as unknown as Obj, r.input as unknown as Obj);
  return r;
};
const withHome = (req: Req, value = 60_000_000): Req =>
  edit(req, (h) => {
    h.residences = [{ id: HOME, kind: "own", from: at("2000-04"), to: null, ownership: [{ member: H, share: "1" }], valuation: { value: box(value), asOf: "2026-01", structure: "wood", builtYear: 2000, landShare: "1" } }];
  });
const withRental = (req: Req, value = 80_000_000): Req =>
  edit(req, (h) =>
    (h.accounts as Obj[]).push({
      id: RENT,
      kind: "realEstate",
      owner: H,
      marketValue: box(value),
      asOf: "2026-01",
      contributions: [],
      valueGrowth: "0",
      property: { landShare: "1", structure: "rc", builtYear: 2010, rental: { monthly: box(200_000), from: at("2015-04") } },
    }),
  );
const run = (req: Req, request: Obj): Out => (runEngine(edit(req, (_h, input) => (input.inheritanceTax = request)), realPacks(), { checkInternal: true }).inheritanceTax as Out);
const nowOf = (req: Req, request: Obj = {}, who = H): Point => run(req, { points: ["now"], members: [who], ...request }).points[0] as Point;
const heir = (p: Point, m: string) => p.byHeir.find((b) => b.member === m) as Heir;
const D = { detailed: true };
const TL = { detailed: true, points: ["now"], members: [H], timeline: {} };

describe("相続税も試算しない世帯・分け方を入れない世帯は今までと同じ", () => {
  it("detailed が無ければ、分け方と推移の要求があっても結果は同じで、推移を出さない", () => {
    const req = withHome(family());
    const plain = run(req, { points: ["now", "bothAfter"] });
    const asked = run(req, { points: ["now", "bothAfter"], division: { spouseShare: "1" }, timeline: {}, lands: [{ object: HOME, area: "200", primary: { acquirer: "cohabiting", member: C1, met: true } }] });
    expect(asked).toEqual(plain);
    expect(asked.timeline).toBeUndefined();
    expect(plain.points.every((p) => p.division === undefined)).toBe(true);
  });

  it("相続税も試算する世帯で、特例の減額も分け方も無ければ、法定相続分どおり（改訂6と同じ人ごとの額）", () => {
    const p = nowOf(family(), D);
    expect(p.division).toBeUndefined();
    expect(heir(p, W).acquisition).toBe(p.assets.taxablePrice / 2);
    expect(heir(p, C1).acquisition).toBe(p.assets.taxablePrice / 4);
  });

  it("推移を求めても、時点の結果は同じ（推移は別の欄）", () => {
    const req = withRental(withHome(family()));
    const a = run(req, { ...D, points: ["now", "bothAfter"] });
    const b = run(req, { ...D, points: ["now", "bothAfter"], timeline: { alternatives: [{ key: "all", spouseShare: "1" }] } });
    expect(b.points).toEqual(a.points);
    expect(b.timeline?.series.map((s) => s.key)).toEqual(["entered", "all"]);
  });

  it("見本の世帯（detailed の無い要求）は推移を出さず、時点の結果は前と同じ形", () => {
    const out = runEngine(edit(modelHousehold("rentalSample"), (_h, input) => (input.inheritanceTax = { points: ["now", "bothAfter"], timeline: {} })), realPacks(), { checkInternal: true }).inheritanceTax as Out;
    expect(out.timeline).toBeUndefined();
    expect(out.points.every((p) => p.division === undefined && p.lands === undefined)).toBe(true);
  });
});

describe("配偶者の軽減: 1億6千万円と法定相続分の境（相続税法19条の2・No.4158）", () => {
  const share = (amount: number, spouseShare: string) => nowOf(family({ amount }), { ...D, division: { spouseShare } });
  it("遺産2億円（法定相続分1億円）: ちょうど1億6千万円は0円、1億6,200万円は超えた分だけ", () => {
    const p80 = share(200_000_000, "0.8");
    expect(p80.assets.taxablePrice).toBe(200_000_000);
    expect(heir(p80, W).acquisition).toBe(160_000_000);
    expect(heir(p80, W).payable).toBe(0);
    expect(p80.division).toMatchObject({ entered: true, spouseShare: "0.8" });
    const p81 = share(200_000_000, "0.81");
    expect(heir(p81, W).acquisition).toBe(162_000_000);
    // 配偶者の税 = 総額×0.81、軽減 = 総額×1.6億/2億 → 納める額は総額×0.01（100円未満切り捨て）
    expect(heir(p81, W).spouseReduction).toBe(Math.floor((p81.totalTax * 160_000_000) / 200_000_000));
    expect(heir(p81, W).payable).toBe(Math.floor((heir(p81, W).tax - heir(p81, W).spouseReduction) / 100) * 100);
    expect(heir(p81, W).payable).toBeGreaterThan(0);
  });

  it("遺産4億円（法定相続分2億円が1億6千万円より多い）: 1億8千万円・2億円は0円、2億2千万円は法定相続分を超えた分だけ", () => {
    expect(heir(share(400_000_000, "0.45"), W).payable).toBe(0);
    expect(heir(share(400_000_000, "0.5"), W).payable).toBe(0);
    const p = share(400_000_000, "0.55");
    expect(heir(p, W).spouseReduction).toBe(Math.floor((p.totalTax * 200_000_000) / 400_000_000));
    expect(heir(p, W).payable).toBeGreaterThan(0);
  });

  it("各人の税は相続税の総額×各人の課税価格÷課税価格の合計（No.4152）。配偶者のほかは残りを法定相続分の比で分け、入れた人の割合はその人に", () => {
    const p = nowOf(family(), { ...D, division: { spouseShare: "0.6", shares: [{ member: C1, share: "0.75" }] } });
    expect(heir(p, W).acquisition).toBe(120_000_000);
    expect(heir(p, C1).acquisition).toBe(60_000_000);
    expect(heir(p, C2).acquisition).toBe(20_000_000);
    expect(heir(p, C1).tax).toBe(Math.floor((p.totalTax * 60_000_000) / 200_000_000));
  });
});

describe("小規模宅地等の特例の減額を、土地を取得する人に寄せる", () => {
  const home = { object: HOME, area: "200", method: "routePrice", routePrice: 200_000 };
  it("配偶者が取得するとみなした自宅: 減った額は配偶者の取得から引き、子は財産（特例の前）の法定相続分で取得する", () => {
    const req = withHome(family());
    const p = nowOf(req, { ...D, lands: [home] });
    const red = p.assets.smallLandReduction as number;
    expect(red).toBe(32_000_000);
    expect(heir(p, W).landReduction).toBe(red);
    // 子の取得 = 特例の前の課税価格の1/4（債務は無い）
    const before = p.assets.taxablePrice + red;
    expect(Math.abs(heir(p, C1).acquisition - before / 4)).toBeLessThanOrEqual(1000);
    // 法定相続分の比で特例の後の額を分けた前の回より、子の税は多い（配偶者の軽減で配偶者は0円のまま）
    expect(heir(p, C1).tax).toBeGreaterThan(Math.floor(p.totalTax / 4));
    expect(heir(p, W).payable).toBe(0);
    expect(p.division).toMatchObject({ entered: false });
  });

  it("同居の子を選んだ自宅（取得する人 member）: 減った額はその子の取得から引く。ほかの子は引かない", () => {
    const p = nowOf(withHome(family()), { ...D, lands: [{ ...home, primary: { acquirer: "cohabiting", member: C1, met: true } }] });
    expect(heir(p, C1).landReduction).toBe(32_000_000);
    expect(heir(p, C2).landReduction).toBeUndefined();
    expect(heir(p, C1).acquisition).toBeLessThan(heir(p, C2).acquisition);
  });

  it("取得する土地の評価が割合の分より大きい人は、その人の分を土地の評価まで増やす（注意 divisionAdjusted）", () => {
    const p = nowOf(withHome(family({ amount: 10_000_000 }), 200_000_000), { ...D, division: { spouseShare: "0" }, lands: [home] });
    expect(p.division?.adjusted).toBe(true);
    expect(p.cautions).toContain("divisionAdjusted");
    expect(heir(p, W).acquisition).toBeGreaterThan(0);
  });
});

describe("一次と二次の推移", () => {
  it("先に亡くなる人は後に亡くなる人（年下）でない人。計算基準年の一次は「いま亡くなったら」と同じ額、表の最後の年までの年ごと", () => {
    const req = withRental(withHome(family()));
    const out = run(req, { ...TL, lands: [{ object: HOME, area: "200" }] });
    const tl = out.timeline as Timeline;
    expect(tl.first).toBe(H);
    expect(tl.second).toBe(W);
    expect(tl.secondMonth).toBe("2030-12");
    const rows = tl.series[0]?.rows as Row[];
    expect(rows.map((r) => r.year)).toEqual([2026, 2027, 2028, 2029, 2030]);
    expect(rows[0]?.month).toBe("2026-01");
    expect(rows[1]?.month).toBe("2027-12");
    expect(rows[0]?.primary).toBe(out.points[0]?.payable);
    for (const r of rows) expect(r.total).toBe(r.primary + r.secondary);
  });

  it("間引き（step）: 計算基準年と表の最後の年はいつも出す", () => {
    const out = run(family({ endYear: 2036 }), { ...TL, timeline: { step: 4 } });
    expect(out.timeline?.series[0]?.rows.map((r) => r.year)).toEqual([2026, 2030, 2034, 2036]);
  });

  it("二次の財産に、一次で配偶者が取得した額（一次で納めた額を引く）が乗る。配偶者が全部取得すれば一次は0円で二次が重い", () => {
    const out = run(family(), { ...TL, timeline: { alternatives: [{ key: "all", spouseShare: "1" }, { key: "none", spouseShare: "0" }] } });
    const by = (k: string) => (out.timeline?.series.find((s) => s.key === k)?.rows ?? [])[0] as Row;
    const legal = by("entered");
    expect(legal.spouseAcquisition).toBe(100_000_000);
    expect(legal.inherited).toBe(100_000_000 - legal.spouseTax);
    expect(legal.secondaryTaxable).toBe(100_000_000);
    const none = by("none");
    expect(none.secondary).toBe(0);
    expect(none.secondaryTaxable).toBe(0);
    const all = by("all");
    // 遺産2億円・配偶者が全部: 配偶者の軽減で1億6千万円までは0円、超えた分の税を一次で納める
    expect(all.spouseTax).toBeGreaterThan(0);
    expect(all.inherited).toBe(200_000_000 - all.spouseTax);
    expect(all.secondary).toBeGreaterThan(legal.secondary);
  });

  it("相次相続控除（相続税法20条・No.4168）: 一次と二次が同じ年（表の最後の年の12月）は10/10、3年前は7/10、10年を超えれば無し", () => {
    const out = run(family({ endYear: 2040 }), { ...TL, timeline: { alternatives: [{ key: "all", spouseShare: "1" }] } });
    const rows = out.timeline?.series.find((s) => s.key === "all")?.rows as Row[];
    const row = (y: number) => rows.find((r) => r.year === y) as Row;
    // A×C/(B−A)（1を超えれば1）×(10−E)/10。C は二次の課税価格、B は一次の配偶者の課税価格
    const expected = (r: Row, years: number) => {
      const capped = r.secondaryTaxable >= r.spouseAcquisition - r.spouseTax ? r.spouseTax : (r.spouseTax * r.secondaryTaxable) / (r.spouseAcquisition - r.spouseTax);
      return (capped * (10 - years)) / 10;
    };
    const same = row(2040);
    expect(same.month).toBe("2040-12");
    expect(same.successiveCredit).toBeGreaterThan(0);
    expect(Math.abs(same.successiveCredit - expected(same, 0))).toBeLessThanOrEqual(10);
    const three = row(2037);
    expect(Math.abs(three.successiveCredit - expected(three, 3))).toBeLessThanOrEqual(10);
    // 2030-12 → 2040-12 はちょうど10年（10−10＝0）、2026-01 → 2040-12 は14年11か月
    expect(row(2030).successiveCredit).toBe(0);
    expect(row(2026).successiveCredit).toBe(0);
    // 9年11か月（2031-12 の一次 → 2040-12 は9年）: 1/10
    expect(Math.abs(row(2031).successiveCredit - expected(row(2031), 9))).toBeLessThanOrEqual(10);
  });

  it("計算基準月が1〜3月: 計算基準年の一次はその月（2026-02）、相次相続控除の経過年数は1年未満を切り捨てる（2026-02 → 2030-12 は4年10か月で 6/10）", () => {
    const out = run(family({ baseMonth: "2026-02" }), { ...TL, timeline: { alternatives: [{ key: "all", spouseShare: "1" }] } });
    const r = out.timeline?.series.find((s) => s.key === "all")?.rows[0] as Row;
    expect(r.month).toBe("2026-02");
    const capped = r.secondaryTaxable >= r.spouseAcquisition - r.spouseTax ? r.spouseTax : (r.spouseTax * r.secondaryTaxable) / (r.spouseAcquisition - r.spouseTax);
    expect(Math.abs(r.successiveCredit - (capped * 6) / 10)).toBeLessThanOrEqual(10);
  });

  it("未成年者控除の年齢（12月の一次。万一の想定の同じ月の姿で確かめる）: 2010-12 生まれは 2027-12 に17歳で1年分、2011-01 生まれは16歳で2年分", () => {
    const minorAt = (birth: string) => {
      const c = edit(family({ kidBirths: [birth, "1994-05"], amount: 400_000_000 }), (_h, input) => {
        input.contingencies = [{ id: uid("ct"), kind: "death", member: H, occurs: at("2027-12") }];
        input.inheritanceTax = { detailed: true };
      });
      const p = (runEngine(c, realPacks(), { checkInternal: true }).inheritanceTax as Out).points[0] as Point;
      return heir(p, C1).minorCredit ?? 0;
    };
    expect(minorAt("2010-12")).toBe(100_000);
    expect(minorAt("2011-01")).toBe(200_000);
  });

  it("二次の未成年者控除は、一次で受けた分の残りまで（相続税法19条の3第3項）: 同じ年に一次で全部受けた子は二次で受けない", () => {
    const req = family({ kidBirths: ["2020-05", "1994-05"], amount: 400_000_000 });
    const out = run(req, { ...TL, timeline: { alternatives: [{ key: "all", spouseShare: "1" }] } });
    const legal = out.timeline?.series[0]?.rows.find((r) => r.year === 2030) as Row;
    const all = out.timeline?.series[1]?.rows.find((r) => r.year === 2030) as Row;
    // 2030-12 に10歳: 満18歳まで8年×10万円。法定相続分の一次で全部受けたので二次は0円。配偶者が全部取得した一次では子は受けていない
    expect(legal.secondaryMinorCredit).toBe(0);
    expect(all.secondaryMinorCredit).toBe(800_000);
    // 一次が2026-01（子は5歳）なら、一次で受けた分（13年×10万円）が二次の額（8年分）より多いので、二次は0円
    expect(out.timeline?.series[0]?.rows[0]?.secondaryMinorCredit).toBe(0);
  });

  it("二次の自宅は、一次で配偶者が取得した分も含めて secondary の取得する人で特例を使う（選ぶまで使わない）", () => {
    const req = withHome(family(), 80_000_000);
    const home = { object: HOME, area: "200", method: "routePrice", routePrice: 400_000 };
    const without = run(req, { ...TL, lands: [home] }).timeline?.series[0]?.rows[0] as Row;
    const withChoice = run(req, { ...TL, lands: [{ ...home, secondary: { acquirer: "cohabiting", member: C1, met: true } }] }).timeline?.series[0]?.rows[0] as Row;
    // 土地 8,000万円（全部を配偶者が取得）→ 二次で 200㎡×80% の 6,400万円減る
    expect(without.secondaryTaxable - withChoice.secondaryTaxable).toBe(64_000_000);
  });

  it("一次で子が取得した土地は二次の財産に入らない（配偶者が取得した土地は入る）", () => {
    const req = withRental(family());
    const rent = { object: RENT, area: "100", method: "routePrice", routePrice: 800_000, rentalRatio: "0", use: "none" };
    const toSpouse = run(req, { ...TL, lands: [{ ...rent, primary: { acquirer: "spouse" } }] }).timeline?.series[0]?.rows[0] as Row;
    const toChild = run(req, { ...TL, lands: [{ ...rent, primary: { acquirer: "successor", member: C1 } }] }).timeline?.series[0]?.rows[0] as Row;
    expect(toSpouse.secondaryTaxable).toBeGreaterThan(toChild.secondaryTaxable);
  });

  it("法律婚の夫婦でない世帯には推移を出さない", () => {
    const single = edit(family(), (h) => {
      h.members = (h.members as Obj[]).filter((m) => m.id !== W);
      h.relations = [];
    });
    expect(run(single, TL).timeline).toBeUndefined();
  });
});


// 相続税の試算（相続税も試算する世帯だけ）: 土地・建物の評価、貸家・貸家建付地、小規模宅地等の特例、2割加算・未成年者控除（inheritance.estimate 改訂5。0231）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { box, clone, household, member, modelHousehold, realPacks, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
type Req = EngineRequest;
type Special = { status: string; rate?: string; acquirer?: string; defaulted?: boolean; appliedArea?: string; reduction: number; recentRental?: boolean };
type Land = { object: string; method: string; landMarket: number; buildingMarket: number; land: number; building: number; buildingSource: string; rentalRatio?: string; area?: string; use: string; special: Special };
type Point = {
  point: string;
  decedent: string;
  status: string;
  assets: Record<string, number>;
  heirs: { member: string; relation: string }[];
  byHeir: { member?: string; tax: number; payable: number; surcharge?: number; minorCredit?: number; spouseReduction: number }[];
  totalTax: number;
  payable: number;
  surcharge?: number;
  minorCredit?: number;
  lands?: Land[];
  cautions: string[];
};

const H = uid("h");
const W = uid("w");
const C1 = uid("c1");
const C2 = uid("c2");
const HOME = uid("home");
const RENT = uid("rent");
const at = (ym: string) => ({ at: ym });

function family(o: { kids?: number; amount?: number; baseMonth?: string; endYear?: number; kidBirths?: string[]; spouse?: boolean } = {}): Req {
  const births = o.kidBirths ?? ["1992-05", "1994-05"];
  const kids = [C1, C2].slice(0, o.kids ?? 2);
  return household({
    baseMonth: o.baseMonth ?? "2026-01",
    endYear: o.endYear ?? 2030,
    members: [
      { ...member("h", "self", "1966-04"), sex: "male" },
      ...(o.spouse === false ? [] : [member("w", "spouse", "1968-04")]),
      ...kids.map((_, i) => member(`c${i + 1}`, "child", births[i] as string)),
    ],
    relations: o.spouse === false ? [] : [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }],
    accounts: [{ id: uid("dep"), kind: "deposit", owner: H, marketValue: box(o.amount ?? 100_000_000), asOf: "2026-01", contributions: [] }],
  });
}

const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = clone(req);
  f(r.input.household as unknown as Obj, r.input as unknown as Obj);
  return r;
};
/** 土地だけの持ち家（時価 value、名義の割合 ownership） */
const withHome = (req: Req, value = 40_000_000, ownership: Obj[] = [{ member: H, share: "1" }]): Req =>
  edit(req, (h) => {
    h.residences = [
      { id: HOME, kind: "own", from: at("2020-04"), to: null, ownership, valuation: { value: box(value), asOf: "2026-01", structure: "rc", builtYear: 2020, landShare: "1" } },
    ];
  });
/** 貸している物件（土地の割合 0.5） */
const withRental = (req: Req, o: { value?: number; from?: string; vacancy?: string; landShare?: string } = {}): Req =>
  edit(req, (h) =>
    (h.accounts as Obj[]).push({
      id: RENT,
      kind: "realEstate",
      owner: H,
      marketValue: box(o.value ?? 40_000_000),
      asOf: "2026-01",
      contributions: [],
      valueGrowth: "0",
      property: { landShare: o.landShare ?? "0.5", structure: "rc", builtYear: 2010, rental: { monthly: box(150_000), from: at(o.from ?? "2015-04"), ...(o.vacancy !== undefined ? { vacancyRate: o.vacancy } : {}) } },
    }),
  );
const run = (req: Req) => runEngine(req, realPacks(), { checkInternal: true });
const pointsOf = (req: Req, request: Obj = {}): Point[] => {
  const r = edit(req, (_h, input) => (input.inheritanceTax = request));
  return (run(r).inheritanceTax as { points: Point[]; notIncluded: string[] }).points;
};
const nowOf = (req: Req, request: Obj = {}, who = H) => pointsOf(req, { points: ["now"], members: [who], ...request })[0] as Point;
const landOf = (p: Point, object = HOME) => p.lands?.find((l) => l.object === object) as Land;

describe("相続税も試算しない世帯は今までと同じ（入力は増やさない）", () => {
  it("設定 lands があっても、detailed が無ければ結果は同じ（土地の評価・特例・2割加算・未成年者控除を入れない）", () => {
    const req = withRental(withHome(family()));
    const plain = pointsOf(req);
    const withLands = pointsOf(req, { lands: [{ object: HOME, area: "200", method: "routePrice", routePrice: 300_000 }] });
    expect(withLands).toEqual(plain);
    expect(plain.every((p) => p.lands === undefined && p.assets.smallLandReduction === undefined)).toBe(true);
    expect(plain[0]?.cautions).toContain("smallLandSpecial");
  });

  it("見本の世帯の相続税の目安は、改訂5でも同じ（detailed の無い要求）", () => {
    for (const name of ["salariedCoupleTwoKids", "rentalSample"]) {
      const out = run(edit(modelHousehold(name), (_h, input) => (input.inheritanceTax = { points: ["now", "bothAfter"] })));
      const points = (out.inheritanceTax as { points: Point[]; notIncluded: string[] }).points;
      expect(points.every((p) => p.lands === undefined)).toBe(true);
      expect((out.inheritanceTax as { notIncluded: string[] }).notIncluded).toContain("smallLandSpecial");
    }
  });

  it("相続税も試算する世帯の含めていない一覧から、小規模宅地等の特例・土地の評価・2割加算・未成年者控除を外す", () => {
    const r = run(edit(family(), (_h, input) => (input.inheritanceTax = { points: ["now"], detailed: true })));
    const ni = (r.inheritanceTax as { notIncluded: string[] }).notIncluded;
    for (const k of ["smallLandSpecial", "landValuationDetail", "twentyPercentSurcharge", "minorCredit"]) expect(ni).not.toContain(k);
    expect(ni).toContain("landCorrectionDetail");
  });

  it("土地が無い世帯は、相続税も試算しても財産と税は同じ（lands は空）", () => {
    const req = family();
    const a = nowOf(req);
    const b = nowOf(req, { detailed: true });
    expect(b.lands).toEqual([]);
    expect(b.assets.taxablePrice).toBe(a.assets.taxablePrice);
    expect(b.payable).toBe(a.payable);
  });
});

describe("土地の評価の入れ方", () => {
  const D = { detailed: true };
  it("時価×評価の割合（省略）: 持ち家の土地は時価の80%。配偶者がいれば、選んでいない自宅は配偶者が取得するとみなして80%減らす", () => {
    const p = nowOf(withHome(family()), { ...D, lands: [{ object: HOME, area: "200" }] });
    const l = landOf(p);
    expect(l.method).toBe("market");
    expect(l.land).toBe(Math.floor(l.landMarket * 0.8));
    expect(l.special).toMatchObject({ status: "applied", acquirer: "spouse", defaulted: true, rate: "0.8", appliedArea: "200" });
    expect(l.special.reduction).toBe(Math.floor(l.land * 0.8));
    expect(p.assets.smallLandReduction).toBe(l.special.reduction);
    expect(p.cautions).not.toContain("smallLandSpecial");
  });

  it("路線価×面積×補正の率、固定資産税評価額×倍率、固定資産税評価額×8/7（推定）", () => {
    const req = withHome(family());
    const route = landOf(nowOf(req, { ...D, lands: [{ object: HOME, area: "150", method: "routePrice", routePrice: 300_000, adjustment: "0.95", use: "none" }] }));
    expect(route.method).toBe("routePrice");
    expect(route.land).toBe(42_750_000);
    const mult = landOf(nowOf(req, { ...D, lands: [{ object: HOME, method: "multiplier", fixedValue: 5_000_000, multiplier: "1.1", use: "none" }] }));
    expect(mult.land).toBe(5_500_000);
    const est = landOf(nowOf(req, { ...D, lands: [{ object: HOME, method: "fixedEstimate", fixedValue: 7_000_000, use: "none" }] }));
    expect(est.land).toBe(8_000_000);
  });

  it("入れ方に要る値が無ければ時価×評価の割合に戻し、注意を出す（路線価があっても面積が無い）", () => {
    const p = nowOf(withHome(family()), { ...D, lands: [{ object: HOME, method: "routePrice", routePrice: 300_000 }] });
    expect(landOf(p).method).toBe("market");
    expect(p.cautions).toContain("landInputMissing");
    // 面積が無いので特例は適用しない（注意）
    expect(landOf(p).special.status).toBe("noArea");
    expect(p.cautions).toContain("smallLandAreaMissing");
  });

  it("夫婦の一方だけが名義: 名義の無い人の相続には入らない。夫婦で半分ずつなら面積も半分", () => {
    const wifeOnly = withHome(family(), 40_000_000, [{ member: W, share: "1" }]);
    expect(nowOf(wifeOnly, { ...D, lands: [{ object: HOME, area: "200" }] }).lands).toEqual([]);
    const w = nowOf(wifeOnly, { ...D, lands: [{ object: HOME, area: "200" }] }, W);
    expect(landOf(w).special.status).toBe("applied");
    const half = nowOf(withHome(family(), 40_000_000, [{ member: H, share: "0.5" }, { member: W, share: "0.5" }]), { ...D, lands: [{ object: HOME, area: "400" }] });
    expect(landOf(half).area).toBe("200");
    expect(landOf(half).special.appliedArea).toBe("200");
  });
});

describe("小規模宅地等の特例: 面積の上限・要件・取得する人", () => {
  const D = { detailed: true };
  const route = (area: string, extra: Obj = {}) => ({ object: HOME, area, method: "routePrice", routePrice: 100_000, ...extra });
  it("自宅: ちょうど330㎡は全部、331㎡は330㎡まで（上限の注意）", () => {
    const req = withHome(family());
    const p330 = landOf(nowOf(req, { ...D, lands: [route("330")] }));
    expect(p330.land).toBe(33_000_000);
    expect(p330.special).toMatchObject({ status: "applied", appliedArea: "330", reduction: 26_400_000 });
    const p = nowOf(req, { ...D, lands: [route("331")] });
    expect(landOf(p).special.appliedArea).toBe("330");
    // 33,100,000 × 330/331 × 80% = 26,400,000
    expect(landOf(p).special.reduction).toBe(26_400_000);
    expect(p.cautions).toContain("smallLandAreaLimit");
  });

  it("取得する人が要件を満たさなければ適用しない（同居の親族で要件の印が無い・要件を満たさない人）。印があれば適用する", () => {
    const req = withHome(family());
    expect(landOf(nowOf(req, { ...D, lands: [route("200", { primary: { acquirer: "cohabiting" } })] })).special.status).toBe("notMet");
    expect(landOf(nowOf(req, { ...D, lands: [route("200", { primary: { acquirer: "other", met: true } })] })).special.status).toBe("notMet");
    expect(landOf(nowOf(req, { ...D, lands: [route("200", { primary: { acquirer: "noHome", met: true } })] })).special.status).toBe("applied");
  });

  it("配偶者のいない人の自宅は、取得する人を選ぶまで適用しない（注意）", () => {
    const p = nowOf(withHome(family({ spouse: false })), { ...D, lands: [route("200")] });
    expect(landOf(p).special.status).toBe("notSet");
    expect(p.cautions).toContain("smallLandNotSet");
  });

  it("二人とも亡くなった後（二次）は secondary を読む。選んでいなければ適用しない", () => {
    const req = withHome(family(), 40_000_000, [{ member: H, share: "1" }]);
    const both = (lands: Obj[]) => pointsOf(req, { points: ["bothAfter"], detailed: true, lands })[0] as Point;
    expect(landOf(both([route("200", { primary: { acquirer: "spouse" } })])).special.status).toBe("notSet");
    expect(landOf(both([route("200", { primary: { acquirer: "spouse" }, secondary: { acquirer: "spouse" } })])).special.status).toBe("notMet");
    expect(landOf(both([route("200", { secondary: { acquirer: "cohabiting", met: true } })])).special.status).toBe("applied");
  });

  it("自宅の特例は、亡くなる月に住んでいる持ち家だけ（住まい以外の不動産に自宅を選んでも適用しない）", () => {
    const p = nowOf(withRental(family()), { ...D, lands: [{ object: RENT, area: "100", use: "residence", primary: { acquirer: "spouse" } }] });
    expect(landOf(p, RENT).special.status).toBe("notLived");
  });
});

describe("貸家・貸家建付地と貸付の特例", () => {
  const D = { detailed: true };
  it("賃貸割合の省略は1−空室率。建物は30%×賃貸割合、土地は借地権割合（省略 D 60%）×30%×賃貸割合を引く。貸付は200㎡・50%", () => {
    const req = withRental(family(), { vacancy: "0.1" });
    const p = nowOf(req, { ...D, lands: [{ object: RENT, area: "150", buildingValue: 10_000_000, primary: { acquirer: "successor", met: true } }] });
    const l = landOf(p, RENT);
    expect(l.rentalRatio).toBe("0.9");
    expect(l.use).toBe("rental");
    expect(l.buildingSource).toBe("entered");
    expect(l.building).toBe(7_300_000);
    // 土地の時価×80%×(1−0.6×0.3×0.9)
    expect(l.land).toBe(Math.floor(Math.floor(l.landMarket * 0.8) * 0.838));
    expect(l.special).toMatchObject({ status: "applied", rate: "0.5", appliedArea: "150" });
    expect(l.special.reduction).toBe(Math.floor(l.land * 0.5));
    // 借地権割合 C（70%）
    const c = landOf(nowOf(req, { ...D, lands: [{ object: RENT, area: "150", leaseholdRatio: "C", use: "none" }] }), RENT);
    expect(c.land).toBe(Math.floor(Math.floor(c.landMarket * 0.8) * 0.811));
  });

  it("貸し始めて3年以内は対象にしない（ちょうど36か月前は対象・35か月前は対象外）。事業的規模を3年を超えて続けている印があれば対象", () => {
    const lands = (extra: Obj = {}) => [{ object: RENT, area: "100", primary: { acquirer: "successor", met: true }, ...extra }];
    const at36 = landOf(nowOf(withRental(family(), { from: "2023-01" }), { ...D, lands: lands() }), RENT);
    expect(at36.special.status).toBe("applied");
    const p35 = nowOf(withRental(family(), { from: "2023-02" }), { ...D, lands: lands() });
    expect(landOf(p35, RENT).special).toMatchObject({ status: "within3Years", recentRental: true });
    expect(p35.cautions).toContain("smallLandRecentRental");
    expect(landOf(nowOf(withRental(family(), { from: "2023-02" }), { ...D, lands: lands({ rentalContinued: true }) }), RENT).special.status).toBe("applied");
  });

  it("計算基準月が1〜3月でも、3年の境目は亡くなる月から数える（2026-03 の要求で 2023-03 は対象・2023-04 は対象外）", () => {
    const lands = [{ object: RENT, area: "100", primary: { acquirer: "successor", met: true } }];
    expect(landOf(nowOf(withRental(family({ baseMonth: "2026-03" }), { from: "2023-03" }), { ...D, lands }), RENT).special.status).toBe("applied");
    expect(landOf(nowOf(withRental(family({ baseMonth: "2026-03" }), { from: "2023-04" }), { ...D, lands }), RENT).special.status).toBe("within3Years");
  });

  it("収益不動産だけの世帯: 取得する人を選ばなければ適用しない（貸付は自動で選ばない）", () => {
    const p = nowOf(withRental(family()), { ...D, lands: [{ object: RENT, area: "100" }] });
    expect(landOf(p, RENT).special.status).toBe("notSet");
  });

  it("組み合わせ: 貸付の1㎡あたりが大きければ、貸付を入れて 自宅×200/330＋貸付≦200㎡（貸付100㎡なら自宅は165㎡まで）", () => {
    const req = withRental(withHome(family()), { value: 200_000_000, landShare: "1" });
    const p = nowOf(req, {
      ...D,
      lands: [
        { object: HOME, area: "330", method: "routePrice", routePrice: 100_000 },
        { object: RENT, area: "100", method: "routePrice", routePrice: 1_000_000, rentalRatio: "0", use: "rental", primary: { acquirer: "successor", met: true } },
      ],
    });
    expect(landOf(p, RENT).special).toMatchObject({ status: "applied", appliedArea: "100", reduction: 50_000_000 });
    expect(landOf(p).special).toMatchObject({ status: "applied", appliedArea: "165", reduction: 13_200_000 });
    expect(p.assets.smallLandReduction).toBe(63_200_000);
  });

  it("組み合わせ: 自宅の方が多く減るなら貸付を入れない（自宅330㎡を全部）", () => {
    const req = withRental(withHome(family()), { value: 20_000_000, landShare: "1" });
    const p = nowOf(req, {
      ...D,
      lands: [
        { object: HOME, area: "330", method: "routePrice", routePrice: 500_000 },
        { object: RENT, area: "200", method: "routePrice", routePrice: 100_000, rentalRatio: "0", use: "rental", primary: { acquirer: "successor", met: true } },
      ],
    });
    expect(landOf(p).special).toMatchObject({ status: "applied", appliedArea: "330", reduction: 132_000_000 });
    expect(landOf(p, RENT).special.status).toBe("limit");
  });

  it("自宅と事業は別々の上限（自宅330㎡・事業400㎡）。自分の会社に貸している土地は事業の400㎡に入る", () => {
    const req = withRental(withHome(family()), { value: 40_000_000, landShare: "1" });
    const p = nowOf(req, {
      ...D,
      lands: [
        { object: HOME, area: "330", method: "routePrice", routePrice: 100_000 },
        { object: RENT, area: "500", method: "routePrice", routePrice: 100_000, rentalRatio: "0", use: "familyCompany", primary: { acquirer: "successor", met: true } },
      ],
    });
    expect(landOf(p).special.appliedArea).toBe("330");
    expect(landOf(p, RENT).special).toMatchObject({ status: "applied", appliedArea: "400", rate: "0.8", reduction: 32_000_000 });
  });
});

describe("建物の評価", () => {
  it("固定資産税評価額の推定（画面が入れる buildingEstimate）を使い、入れた値があればそちらを使う。無ければ時価×評価の割合", () => {
    const req = withRental(family());
    const est = landOf(nowOf(req, { detailed: true, lands: [{ object: RENT, buildingEstimate: 8_000_000, rentalRatio: "0", use: "none" }] }), RENT);
    expect(est).toMatchObject({ buildingSource: "estimate", building: 8_000_000 });
    const both = landOf(nowOf(req, { detailed: true, lands: [{ object: RENT, buildingEstimate: 8_000_000, buildingValue: 9_000_000, rentalRatio: "0", use: "none" }] }), RENT);
    expect(both.building).toBe(9_000_000);
    const none = landOf(nowOf(req, { detailed: true, lands: [{ object: RENT, rentalRatio: "0", use: "none" }] }), RENT);
    expect(none).toMatchObject({ buildingSource: "market", building: Math.floor(none.buildingMarket * 0.8) });
  });
});

describe("2割加算と未成年者控除（相続税も試算する世帯だけ）", () => {
  it("未成年者控除は満18歳になるまでの年数×10万円（誕生月の前後: 2010-03 生まれは 2026-02 に15歳で3年、2026-03 に16歳で2年）", () => {
    const req = (baseMonth: string) => family({ baseMonth, kidBirths: ["2010-03", "1994-05"], amount: 200_000_000 });
    const minorOf = (p: Point) => p.byHeir.find((b) => b.member === C1)?.minorCredit ?? 0;
    expect(minorOf(nowOf(req("2026-02"), { detailed: true }))).toBe(300_000);
    expect(minorOf(nowOf(req("2026-03"), { detailed: true }))).toBe(200_000);
    // 試算しない世帯には入れない
    expect(minorOf(nowOf(req("2026-02")))).toBe(0);
  });

  it("引ききれない未成年者控除は、ほかの相続人の税から引く（配偶者の税が0なら子から）", () => {
    // 遺産5,000万円・配偶者と子2人（1人は2025-12 生まれ）: 子の税は少なく、控除の180万円を引ききれない
    const p = nowOf(family({ amount: 50_000_000, kidBirths: ["2025-12", "1994-05"] }), { detailed: true });
    const minor = p.byHeir.find((b) => b.member === C1);
    const adult = p.byHeir.find((b) => b.member === C2);
    expect(minor?.payable).toBe(0);
    expect((minor?.minorCredit ?? 0) + (adult?.minorCredit ?? 0)).toBe(p.minorCredit);
    expect(adult?.minorCredit ?? 0).toBeGreaterThan(0);
    expect(adult?.payable).toBe(Math.max(0, Math.floor(((adult?.tax ?? 0) - (adult?.minorCredit ?? 0)) / 100) * 100));
  });

  it("兄弟姉妹が相続人なら、その人の税に2割加算（配偶者には加算しない）", () => {
    const sib = { id: uid("sib"), kind: "sibling", joins: null, leaves: null, expected: false, outside: { of: H, periods: [] } };
    const req = edit(family({ kids: 0, amount: 200_000_000 }), (h) => (h.members as Obj[]).push(sib));
    const plain = nowOf(req);
    const p = nowOf(req, { detailed: true });
    const s0 = plain.byHeir.find((b) => b.member === sib.id);
    const s1 = p.byHeir.find((b) => b.member === sib.id);
    expect(s1?.surcharge).toBe(Math.floor((s0?.tax ?? 0) * 0.2));
    expect(s1?.tax).toBe((s0?.tax ?? 0) + (s1?.surcharge ?? 0));
    expect(p.byHeir.find((b) => b.member === W)?.surcharge).toBeUndefined();
    expect(p.cautions).not.toContain("twentyPercentSurcharge");
  });
});

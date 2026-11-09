// 相続税の目安（inheritance.estimate。0039）と、不動産を持ち始める時点（asset.realEstate の holdFrom）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { box, clone, household, member, modelHousehold, realPacks, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
type Req = EngineRequest;
type Point = {
  point: string;
  decedent: string;
  month: string;
  valuationYear: number;
  status: string;
  assets: Record<
    "financial" | "realEstateMarket" | "realEstate" | "other" | "insurance" | "insuranceExempt" | "retirement" | "retirementExempt" | "settlementGifts" | "debts" | "funeral" | "taxablePrice",
    number
  > & { unpaidTaxes?: number };
  heirs: { member: string; relation: string; outside: boolean; counted: boolean; share?: string; adopted?: boolean; representing?: string }[];
  heirCount: number;
  heirCountOverridden: boolean;
  basicDeduction: number;
  taxableEstate: number;
  totalTax: number;
  spouseReduction: number;
  settlementCredit: number;
  byHeir: { member?: string; count?: number; outside: boolean; acquisition: number; tax: number; spouseReduction: number; credit: number; payable: number; refund: number }[];
  payable: number;
  payableHousehold: number;
  payableOutside: number;
  refund: number;
  noTax: boolean;
  margin: number;
  amount: number;
  state: string;
  cautions: string[];
};

const H = uid("h");
const W = uid("w");
const C1 = uid("c1");
const C2 = uid("c2");
const C3 = uid("c3");
const at = (ym: string) => ({ at: ym });

const deposit = (owner: string | null, amount: number, name = `dep-${owner ?? "none"}`): Obj => ({
  id: uid(name),
  kind: "deposit",
  ...(owner !== null ? { owner } : {}),
  marketValue: box(amount),
  asOf: "2026-01",
  contributions: [],
});

/** 夫婦と子（世帯の中）。本人の名義の預金 */
function family(o: { kids?: number; amount?: number; endYear?: number; extraMembers?: Obj[]; relations?: Obj[]; marriage?: "legal" | "deFacto" } = {}): Req {
  const kids = [C1, C2, C3].slice(0, o.kids ?? 2);
  const req = household({
    baseMonth: "2026-01",
    endYear: o.endYear ?? 2030,
    members: [
      { ...member("h", "self", "1966-04"), sex: "male" },
      member("w", "spouse", "1968-04"),
      ...kids.map((id, i) => member(`c${i + 1}`, "child", `199${i}-05`)),
      ...(o.extraMembers ?? []),
    ],
    relations: [{ type: "spouse", a: H, b: W, marriage: o.marriage ?? "legal", from: null, to: null }, ...(o.relations ?? [])],
    accounts: [deposit(H, o.amount ?? 100_000_000)],
  });
  return req;
}

const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = clone(req);
  f(r.input.household as unknown as Obj, r.input as unknown as Obj);
  return r;
};
const withEstimate = (req: Req, request: Obj = {}): Req => edit(req, (_h, input) => (input.inheritanceTax = request));
const run = (req: Req) => runEngine(req, realPacks(), { checkInternal: true });
const points = (req: Req, request: Obj = {}): Point[] => (run(withEstimate(req, request)).inheritanceTax as { points: Point[] }).points;
const nowOf = (req: Req, who = H, request: Obj = {}) => points(req, { points: ["now"], members: [who], ...request })[0] as Point;

/** 世帯の外の家族（生年月なし。贈与者として読む人） */
const outside = (name: string, kind: string, of: string, extra: Obj = {}): Obj => ({ id: uid(name), kind, joins: null, leaves: null, expected: false, outside: { of, periods: [] }, ...extra });

describe("相続税の目安: 税の総額・配偶者の軽減・基礎控除の境（国税庁の計算の順）", () => {
  it("遺産1億円・配偶者と子2人: 課税遺産総額5,200万円、税の総額630万円、配偶者の軽減で配偶者は0、子は157.5万円ずつ", () => {
    const p = nowOf(family());
    expect(p.status).toBe("ok");
    expect(p.heirs.map((h) => [h.relation, h.share])).toEqual([["spouse", "1/2"], ["child", "1/4"], ["child", "1/4"]]);
    expect(p.heirCount).toBe(3);
    expect(p.basicDeduction).toBe(48_000_000);
    expect(p.assets.taxablePrice).toBe(100_000_000);
    expect(p.taxableEstate).toBe(52_000_000);
    // 配偶者 2,600万円×15%−50万円＝340万円、子 1,300万円×15%−50万円＝145万円ずつ
    expect(p.totalTax).toBe(6_300_000);
    expect(p.spouseReduction).toBe(3_150_000);
    expect(p.byHeir.map((b) => [b.acquisition, b.tax, b.payable])).toEqual([[50_000_000, 3_150_000, 0], [25_000_000, 1_575_000, 1_575_000], [25_000_000, 1_575_000, 1_575_000]]);
    expect(p.payable).toBe(3_150_000);
    expect(p.payableHousehold).toBe(3_150_000);
    expect(p.payableOutside).toBe(0);
    expect(p.amount).toBe(3_150_000);
    expect(p.state).toBe("estimated");
    expect(p.noTax).toBe(false);
  });

  it("基礎控除の境: 課税価格がちょうど基礎控除（4,800万円）なら税は0（かからない見込み・余り0）、1,000円多いと課税遺産総額1,000円", () => {
    const at4800 = nowOf(family({ amount: 48_000_000 }));
    expect(at4800.noTax).toBe(true);
    expect(at4800.margin).toBe(0);
    expect(at4800.totalTax).toBe(0);
    const over = nowOf(family({ amount: 48_001_000 }));
    expect(over.noTax).toBe(false);
    expect(over.margin).toBe(-1_000);
    expect(over.taxableEstate).toBe(1_000);
    // 法定相続分に応ずる取得金額は1,000円未満を切り捨てるので、税の総額は0
    expect(over.totalTax).toBe(0);
    // 課税価格の1,000円未満は切り捨て
    expect(nowOf(family({ amount: 48_000_999 })).assets.taxablePrice).toBe(48_000_000);
  });

  it("配偶者だけが相続人: 1億6,000万円までは配偶者に税がかからない（法定相続分は全部）", () => {
    const p = nowOf(family({ kids: 0, amount: 200_000_000 }));
    expect(p.heirs.map((h) => [h.relation, h.share])).toEqual([["spouse", "1/1"]]);
    expect(p.totalTax).toBeGreaterThan(0);
    expect(p.payable).toBe(0);
    expect(p.spouseReduction).toBe(p.totalTax);
  });

  it("事実婚の配偶者は相続人に入れない（子だけ）", () => {
    const p = nowOf(family({ marriage: "deFacto" }));
    expect(p.heirs.map((h) => h.relation)).toEqual(["child", "child"]);
    expect(p.basicDeduction).toBe(42_000_000);
  });
});

describe("相続税の目安: 法定相続人の数え方", () => {
  it("子がいなければ親（世帯の外の家族）: 配偶者2/3・親1/3を2人で", () => {
    const req = family({ kids: 0, extraMembers: [outside("fa", "parent", H), outside("mo", "parent", H)] });
    const p = nowOf(req);
    expect(p.heirs.map((h) => [h.relation, h.share, h.outside])).toEqual([["spouse", "2/3", false], ["parent", "1/6", true], ["parent", "1/6", true]]);
    expect(p.heirCount).toBe(3);
  });

  it("親が亡くなっていれば兄弟姉妹: 配偶者3/4・兄弟姉妹1/4。2割加算の注意。世帯の外の相続人の納める額を分ける", () => {
    const req = family({ kids: 0, amount: 300_000_000, extraMembers: [outside("fa", "parent", H, { leaves: at("2020-01") }), outside("sis", "sibling", H)] });
    const p = nowOf(req);
    expect(p.heirs.map((h) => [h.relation, h.share])).toEqual([["spouse", "3/4"], ["sibling", "1/4"]]);
    expect(p.cautions).toContain("twentyPercentSurcharge");
    expect(p.payableOutside).toBeGreaterThan(0);
    expect(p.payableHousehold).toBe(0);
    expect(p.payable).toBe(p.payableOutside);
  });

  it("配偶者の親・兄弟は本人の相続人にならない（誰の家族か of で分ける）", () => {
    const req = family({ kids: 0, extraMembers: [outside("wfa", "parent", W)] });
    expect(nowOf(req, H).heirs.map((h) => h.relation)).toEqual(["spouse"]);
    expect(nowOf(req, W).heirs.map((h) => [h.relation, h.share])).toEqual([["spouse", "2/3"], ["parent", "1/3"]]);
  });

  it("前の結婚の子（世帯の外の子）も子として数える", () => {
    const req = family({ kids: 1, extraMembers: [outside("prev", "child", H)] });
    const p = nowOf(req);
    expect(p.heirs.map((h) => [h.relation, h.share, h.outside])).toEqual([["spouse", "1/2", false], ["child", "1/4", false], ["child", "1/4", true]]);
    // 配偶者の相続では前の結婚の子は数えない
    expect(nowOf(req, W).heirs.filter((h) => h.relation === "child")).toHaveLength(1);
  });

  it("代襲: 先に亡くなった子の子が、親の分を等分する", () => {
    const req = family({
      kids: 1,
      // 関係（parentOf）で指す世帯の外の家族は、生年月を入れて構成員として読む
      extraMembers: [
        outside("dead", "child", H, { leaves: at("2024-01"), birth: { birthYearMonth: "1988-01", bornOnFirst: false }, sex: "male" }),
        outside("g1", "grandchild", H, { birth: { birthYearMonth: "2015-01", bornOnFirst: false }, sex: "male" }),
        outside("g2", "grandchild", H, { birth: { birthYearMonth: "2017-01", bornOnFirst: false }, sex: "female" }),
      ],
      relations: [
        { type: "parentOf", parent: H, child: C1 },
        { type: "parentOf", parent: H, child: uid("dead") },
        { type: "parentOf", parent: uid("dead"), child: uid("g1") },
        { type: "parentOf", parent: uid("dead"), child: uid("g2") },
      ],
    });
    const p = nowOf(req);
    expect(p.heirs.map((h) => [h.relation, h.share, h.representing ?? null])).toEqual([
      ["spouse", "1/2", null],
      ["child", "1/4", null],
      ["grandchild", "1/8", uid("dead")],
      ["grandchild", "1/8", uid("dead")],
    ]);
    expect(p.heirCount).toBe(4);
    expect(p.basicDeduction).toBe(54_000_000);
  });

  it("養子の数の制限: 実子がいれば養子は1人まで（数えない養子は注意）。実子がいなければ2人まで", () => {
    const p = nowOf(family({ kids: 3 }), H, { adopted: [C2, C3] });
    expect(p.heirs.map((h) => [h.member, h.counted])).toEqual([[W, true], [C1, true], [C2, true], [C3, false]]);
    expect(p.heirCount).toBe(3);
    expect(p.cautions).toContain("adoptedLimit");
    const none = nowOf(family({ kids: 3 }), H, { adopted: [C1, C2, C3] });
    expect(none.heirCount).toBe(3);
    expect(none.heirs.filter((h) => !h.counted).map((h) => h.member)).toEqual([C3]);
  });

  it("まだ生まれていない子は数えない", () => {
    const req = edit(family({ kids: 1 }), (h) => (h.members as Obj[]).push({ ...member("baby", "child", "2027-03"), expected: true, joins: at("2027-03") }));
    expect(nowOf(req).heirCount).toBe(2);
  });

  it("法定相続人の数を直す（放棄・代襲など）: 基礎控除と非課税の枠はその数、配偶者のほかは等分とみなしてまとめた1行", () => {
    const p = nowOf(family(), H, { heirCounts: [{ decedent: H, count: 4 }] });
    expect(p.heirCount).toBe(4);
    expect(p.heirCountOverridden).toBe(true);
    expect(p.basicDeduction).toBe(54_000_000);
    expect(p.byHeir.map((b) => [b.member ?? null, b.count ?? null])).toEqual([[W, null], [null, 3]]);
    // 課税遺産総額 4,600万円: 配偶者 2,300万円→295万円、子 766.6万円（1,000円未満切り捨て）×10%＝76.66万円×3
    expect(p.totalTax).toBe(5_249_800);
  });
});

describe("相続税の目安: 財産の内訳（非課税の枠・不動産・債務・精算課税の足し戻し）", () => {
  it("死亡退職金の非課税: 500万円×法定相続人の数を超えた分だけ課税価格に入れる", () => {
    const p = nowOf(family({ amount: 0 }), H, { retirementAllowances: [{ decedent: H, amount: 20_000_000 }] });
    expect(p.assets.retirement).toBe(20_000_000);
    expect(p.assets.retirementExempt).toBe(15_000_000);
    expect(p.assets.taxablePrice).toBe(5_000_000);
  });

  it("死亡保険金の非課税: 本人が契約者で被保険者の契約の保険金に、500万円×法定相続人の数", () => {
    const req = edit(family({ amount: 0 }), (h) => {
      h.insuranceContracts = [
        {
          id: uid("ins"),
          template: "insurance.wholeLife",
          policyholder: H,
          insured: H,
          contractDate: "2016-04",
          currency: "JPY",
          premium: { amount: 20000, frequency: "monthly", payUntil: at("2036-04") },
          deductionCategory: { type: "general", regime: "new" },
          beneficiaries: [{ member: W, share: "1" }],
          coverages: [{ id: uid("cov"), role: "main", benefit: "death", amount: 30_000_000 }],
          simple: { returnRate: "0.9" },
        },
      ];
    });
    const p = nowOf(req);
    expect(p.assets.insurance).toBe(30_000_000);
    expect(p.assets.insuranceExempt).toBe(15_000_000);
    // 解約返戻金（保険の契約の権利）は保険金と二重に数えない
    expect(p.assets.other).toBe(0);
    expect(p.assets.taxablePrice).toBe(15_000_000);
    // 配偶者の相続では、本人が被保険者の契約は数えない
    expect(nowOf(req, W).assets.insurance).toBe(0);
  });

  it("不動産は時価×評価の割合（省略は80%。直せる）、名義の割合で分ける。持ち家があると小規模宅地等の特例の注意", () => {
    const req = edit(family({ amount: 0 }), (h) => {
      h.residences = [
        {
          id: uid("home"),
          kind: "own",
          from: at("2020-04"),
          to: null,
          purchase: { at: at("2020-04"), price: 40_000_000, downPayment: 40_000_000, costs: 0 },
          ownership: [{ member: H, share: "0.5" }, { member: W, share: "0.5" }],
          valuation: { value: box(40_000_000), asOf: "2026-01", structure: "rc", builtYear: 2026, landShare: "1" },
        },
      ];
    });
    const p = nowOf(req);
    expect(p.assets.realEstateMarket).toBeGreaterThan(0);
    expect(p.assets.realEstate).toBe(Math.floor(p.assets.realEstateMarket * 0.8));
    expect(p.cautions).toContain("smallLandSpecial");
    const full = nowOf(req, H, { realEstateRatio: "1" });
    expect(full.assets.realEstate).toBe(full.assets.realEstateMarket);
    // 夫婦で半分ずつ: 配偶者の相続でも同じ額
    expect(nowOf(req, W).assets.realEstateMarket).toBe(p.assets.realEstateMarket);
  });

  it("債務は亡くなる人の分だけ。団信で消える分は引かない", () => {
    const loan = (creditLife: Obj | undefined): Req =>
      edit(family({ amount: 60_000_000 }), (h) => {
        h.debts = [
          {
            id: uid("loan"),
            kind: "mortgage",
            debtors: [{ member: H, role: "primary" }],
            principal: 20_000_000,
            start: at("2025-12"),
            rateSchedule: [{ from: at("2025-12"), type: "fixed", rate: "0" }],
            repayment: { method: "equalPayment", termMonths: 240 },
            ...(creditLife !== undefined ? { creditLife } : {}),
          },
        ];
      });
    const plain = nowOf(loan(undefined));
    expect(plain.assets.debts).toBeGreaterThan(0);
    expect(plain.assets.taxablePrice).toBe(Math.floor((60_000_000 - plain.assets.debts) / 1000) * 1000);
    expect(nowOf(loan({ covered: [H] })).assets.debts).toBe(0);
    // 配偶者の相続では本人の借入は数えない
    expect(nowOf(loan(undefined), W).assets.debts).toBe(0);
  });

  it("名義の無い財産（名義の割合を入れていない持ち家）は夫婦で半分ずつ（直せる）。葬式の費用を引く", () => {
    const req = edit(family({ amount: 0 }), (h) => {
      h.residences = [
        { id: uid("home"), kind: "own", from: at("2020-04"), to: null, valuation: { value: box(40_000_000), asOf: "2026-01", structure: "rc", builtYear: 2026, landShare: "1" } },
      ];
    });
    const half = nowOf(req, H, { realEstateRatio: "1" });
    const all = nowOf(req, H, { realEstateRatio: "1", unassignedShare: "1" });
    expect(all.assets.realEstateMarket).toBeGreaterThan(0);
    expect(half.assets.realEstateMarket).toBe(Math.floor(all.assets.realEstateMarket / 2));
    const withFuneral = nowOf(req, H, { realEstateRatio: "1", unassignedShare: "1", funeral: 2_000_000 });
    expect(withFuneral.assets.taxablePrice).toBe(Math.floor((all.assets.realEstateMarket - 2_000_000) / 1000) * 1000);
  });

  it("相続時精算課税の足し戻し: 子への3,000万円の贈与は（3,000万−110万）を課税価格に足し、払った贈与税78万円を子の税から引く", () => {
    const req = edit(family({ amount: 100_000_000 }), (h) => {
      h.goals = [{ id: uid("g"), kind: "education", owner: C1, education: { stages: [], gifts: [{ at: at("2025-06"), amount: 30_000_000, purpose: "other", payer: H, taxMethod: "settlement" }] } }];
    });
    const p = nowOf(req);
    expect(p.assets.settlementGifts).toBe(28_900_000);
    expect(p.assets.taxablePrice).toBe(128_900_000);
    expect(p.settlementCredit).toBe(780_000);
    const c1 = p.byHeir.find((b) => b.member === C1);
    const c2 = p.byHeir.find((b) => b.member === C2);
    expect(c1?.credit).toBe(780_000);
    expect(c1?.payable).toBe(Math.floor(((c2?.tax ?? 0) - 780_000) / 100) * 100);
    // 配偶者が贈与者でない贈与は、配偶者の相続に足さない
    expect(nowOf(req, W).assets.settlementGifts).toBe(0);
    // 払う人を書いていない子への援助は、子の親（関係が無ければ本人）からの贈与と読む
    const noPayer = edit(req, (h) => delete ((((h.goals as Obj[])[0] as { education: { gifts: Obj[] } }).education.gifts[0]) as Obj).payer);
    expect(nowOf(noPayer).assets.settlementGifts).toBe(28_900_000);
  });

  it("引ききれない精算課税の贈与税は還付", () => {
    const req = edit(family({ amount: 0 }), (h) => {
      h.goals = [{ id: uid("g"), kind: "education", owner: C1, education: { stages: [], gifts: [{ at: at("2025-06"), amount: 40_000_000, purpose: "other", payer: H, taxMethod: "settlement" }] } }];
    });
    const p = nowOf(req);
    // 足し戻し 3,890万円＜基礎控除 4,800万円で税は0。払った贈与税（(3,890万−2,500万)×20%＝278万円）は還付
    expect(p.totalTax).toBe(0);
    expect(p.refund).toBe(2_780_000);
    expect(p.payable).toBe(0);
  });
});

describe("相続税の目安: 時点", () => {
  it("万一の想定の無い要求では、いま本人・いま配偶者・二人とも亡くなった後（表の最後の年。子だけ）", () => {
    const ps = points(family({ endYear: 2040 }));
    expect(ps.map((p) => [p.point, p.decedent, p.month, p.valuationYear])).toEqual([
      ["now", H, "2026-01", 2026],
      ["now", W, "2026-01", 2026],
      ["bothAfter", W, "2040-12", 2040],
    ]);
    const both = ps[2] as Point;
    expect(both.heirs.map((h) => h.relation)).toEqual(["child", "child"]);
    // 夫婦の財産を合わせる（本人の名義の預金も入る）
    expect(both.assets.financial).toBeGreaterThan(0);
    expect(points(family({ endYear: 2040 }), { lastSurvivor: H }).find((p) => p.point === "bothAfter")?.decedent).toBe(H);
  });

  it("万一の想定（死亡）の要求では、その時点だけ（財産は亡くなる年の前の年末）", () => {
    const req = edit(family({ endYear: 2035 }), (_h, input) => (input.contingencies = [{ id: uid("ct"), kind: "death", member: H, occurs: at("2029-06") }]));
    const ps = points(req);
    expect(ps.map((p) => [p.point, p.decedent, p.month, p.valuationYear])).toEqual([["contingency", H, "2029-06", 2028]]);
    expect(ps[0]?.assets.financial).toBeGreaterThan(0);
  });

  it("FP が入れた額（時点ごと）が目安より優先する（目安は並べたまま）", () => {
    const ps = points(family(), { overrides: [{ point: "now", decedent: H, amount: 5_000_000 }] });
    const h = ps.find((p) => p.point === "now" && p.decedent === H) as Point;
    expect(h.amount).toBe(5_000_000);
    expect(h.state).toBe("confirmed");
    expect(h.payable).toBe(3_150_000);
    const w = ps.find((p) => p.point === "now" && p.decedent === W) as Point;
    expect(w.state).toBe("estimated");
  });

  it("入れていない決まりの一覧を出す", () => {
    const out = run(withEstimate(family())).inheritanceTax as { notIncluded: string[] };
    expect(out.notIncluded).toContain("smallLandSpecial");
    expect(out.notIncluded).toContain("twentyPercentSurcharge");
    expect(out.notIncluded).toContain("calendarGiftAddBack");
  });

  it("要求が指す人が構成員でなければエラー", () => {
    expect(() => run(withEstimate(family(), { members: [uid("nobody")] }))).toThrow();
  });
});

describe("相続税の目安はお金の流れを変えない（表示だけ）", () => {
  for (const name of ["salariedCoupleTwoKids", "lifetime100Assets", "pairLoanDeath", "housingGiftFromParents"]) {
    it(`見本の世帯 ${name}: 表・お金の動き・年ごとの行は、目安を求めても同じ`, () => {
      const req = modelHousehold(name);
      const a = run(req);
      const b = run(withEstimate(req));
      expect(b.table).toEqual(a.table);
      expect(b.flows).toEqual(a.flows);
      expect(b.annual).toEqual(a.annual);
      expect(b.inheritanceTax).toBeDefined();
      expect(a.inheritanceTax).toBeUndefined();
    });
  }
});

describe("不動産を持ち始める時点（asset.realEstate の holdFrom）", () => {
  const req = (holdFrom: string | undefined) =>
    edit(family({ amount: 0, endYear: 2032 }), (h) =>
      (h.accounts as Obj[]).push({
        id: uid("land"),
        kind: "realEstate",
        owner: H,
        marketValue: box(20_000_000),
        asOf: "2026-01",
        contributions: [],
        valueGrowth: "0",
        property: { landShare: "1", ...(holdFrom !== undefined ? { holdFrom: at(holdFrom) } : {}), rental: { monthly: box(100_000), from: at("2026-01") } },
      }),
    );
  it("持ち始める年の年末から評価額に入り、家賃はその月から。受け取るときの支払いは無い", () => {
    const before = run(req(undefined));
    const after = run(req("2029-04"));
    const val = (r: ReturnType<typeof run>, y: number) => r.annual.find((a) => a.row === "cf.balance.account.realEstate.land" && a.year === y)?.amount ?? null;
    expect(val(before, 2027)).toBe(20_000_000);
    expect(val(after, 2028)).toBe(null);
    expect(val(after, 2029)).toBe(20_000_000);
    const rent = (r: ReturnType<typeof run>) => r.flows.filter((f) => f.row === "cf.income.other.rental").map((f) => f.ym);
    expect(rent(after)[0]).toBe("2029-04");
    expect(rent(before)[0]).toBe("2026-01");
    // 相続税の目安: いまは持っていないので入らない、二人とも亡くなった後は入る
    const ps = points(req("2029-04"));
    expect(ps.find((p) => p.point === "now" && p.decedent === H)?.assets.realEstateMarket).toBe(0);
    expect(ps.find((p) => p.point === "bothAfter")?.assets.realEstateMarket).toBe(20_000_000);
  });
});

describe("相続税の目安: 亡くなった人がまだ払っていない所得の税を債務に入れる（相続税法13条・14条2項。0039 の追記）", () => {
  const selfOf = (r: Req) => (r.input.household.members as unknown as { id: string; kind: string }[]).find((m) => m.kind === "self")?.id as string;
  const model = (name: string, death?: string): Req =>
    edit(modelHousehold(name), (h, input) => {
      delete input.protection;
      if (death === undefined) delete input.contingencies;
      else input.contingencies = [{ id: uid(`unpaid-${name}`), kind: "death", member: (h.members as { id: string; kind: string }[]).find((m) => m.kind === "self")?.id, occurs: { at: death } }];
    });

  it("万一の想定（rentalSample の本人が 2042-01 に亡くなる）: 2041年の物件の売却の譲渡所得の税・所得税の確定申告・住民税（5,866,317円）を債務に入れる", () => {
    const p = points(model("rentalSample", "2042-01"))[0] as Point;
    expect(p.point).toBe("contingency");
    // 譲渡所得の所得税 3,765,100円・住民税 1,229,200円、所得税の確定申告 300,017円、住民税 572,000円（必要保障額で数える物と同じ）
    expect(p.assets.unpaidTaxes).toBe(5_866_317);
    // 前は債務 0円・課税価格 149,463,000円・納める額 9,119,300円
    expect(p.assets.debts).toBe(5_866_317);
    expect(p.assets.taxablePrice).toBeGreaterThanOrEqual(149_463_000 - 5_867_000);
    expect(p.assets.taxablePrice).toBeLessThanOrEqual(149_463_000 - 5_865_000);
    expect(p.payable).toBeLessThan(9_119_300);
  });

  it("いま亡くなったら（salariedCoupleTwoKids の本人。計算基準月 2026-10）: 前の年の所得の住民税の残りを債務に、準確定申告の還付をその他の財産に入れる", () => {
    const r = model("salariedCoupleTwoKids");
    const p = nowOf(r, selfOf(r));
    // 必要保障額の計算基準年と同じ: 住民税の残り（普通徴収に切り替わる）221,200円、準確定申告の還付 92,033円
    expect(p.assets.unpaidTaxes).toBe(221_200);
    // 前は債務 22,189,745円・その他 0円
    expect(p.assets.debts).toBe(22_189_745 + 221_200);
    expect(p.assets.other).toBe(92_033);
  });

  it("二人とも亡くなった後は入れない（表の終わりより後に払う税は表に無い）", () => {
    const p = points(model("rentalSample")).find((x) => x.point === "bothAfter") as Point;
    expect(p.assets.unpaidTaxes ?? 0).toBe(0);
    expect(p.assets.debts).toBe(0);
  });
});

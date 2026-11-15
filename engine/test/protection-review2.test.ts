// 保障・相続の別の目の点検（2回目）で見つかった誤りの見張り。期待値は制度の決まりと「同じお金は1回だけ・同じ時点で数える」から手で作った。
// 直す前の木では、どれも落ちた（当たらない人の額が変わらないことの見張りを除く）
// - 必要保障額: 亡くなる人の確定拠出年金・小規模企業共済の残高を、死亡一時金・共済金と金融資産の両方に数えない（0170 の追記）
// - 相続税の目安の「いま」: どの財産も計算基準月の初めの姿で数える（0039 の追記）
// - ひとり親・寡婦: 配偶者が12月に亡くなる年も、12月31日の現況で死別（国税庁タックスアンサー No.1170・No.1171。0156 の追記）
// - 遺族基礎年金: 子だけが受け取るときの子の加算は、2人目が c12、3人目からが c3（国民年金法39条の2。日本年金機構「遺族基礎年金」。0170 の追記）
// - 被扶養者・第3号の収入の見込みに、不動産収入・企業年金を入れる（協会けんぽ・日本年金機構の被扶養者の収入要件。0174 の追記）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const run = (req: Any, extra: Any = {}): Any => runEngine(clone({ ...req, trace: "none" }), realPacks(), extra);
const entry = (req: Any, component: string, input: Any): Any => run(req, { entry: { component, input } }).entryOutput;
const at = (s: string) => ({ at: s });
const spouseRel = (a: string, b: string) => ({ type: "spouse", a: uid(a), b: uid(b), marriage: "legal", from: null, to: null });
const parentOf = (p: string, c: string) => ({ type: "parentOf", parent: uid(p), child: uid(c) });

describe("必要保障額: 亡くなる人の確定拠出年金・小規模企業共済の残高を2回引かない", () => {
  // 夫40歳（年収600万円）・妻・子1人、生活費 月35万円
  const mk = (accounts: Any[], base = "2026-04", method = "accumulation"): Any => {
    const q: Any = household({
      baseMonth: base,
      endYear: 2060,
      members: [member("n.h", "self", "1986-05", { sex: "male" }), member("n.w", "spouse", "1988-05"), member("n.k", "child", "2020-06")],
      relations: [spouseRel("n.h", "n.w"), parentOf("n.h", "n.k"), parentOf("n.w", "n.k")] as never,
      periods: [period("n.p", { member: "n.h", from: "2009-04", annual: 6000000 })],
      accounts,
    });
    q.input.household.livingExpenses = [{ id: uid("n.lv"), mode: "total", monthly: box(350000) }];
    q.input.protection = { members: [uid("n.h")], method, fromYear: Number(base.slice(0, 4)), toYear: Number(base.slice(0, 4)) + 2 };
    return q;
  };
  const dep = (n: number, base = "2026-04") => ({ id: uid("n.dep"), kind: "deposit", owner: uid("n.h"), marketValue: box(n), asOf: base, contributions: [] });
  const dc = (kind: string, n: number, owner = "n.h", base = "2026-04") => ({ id: uid(`n.${kind}.${owner}`), kind, owner: uid(owner), marketValue: box(n), asOf: base, enrolledSince: "2012-01", contributions: [] });
  const mutualAid = (n: number) => ({
    id: uid("n.ma"),
    kind: "smallBusinessMutualAid",
    owner: uid("n.h"),
    marketValue: box(n),
    asOf: "2026-04",
    enrolledSince: "2012-01",
    contributions: [],
    payout: { start: { at: "2051-05" }, method: "mixed", lumpShare: "0.5", annuityYears: 10 },
  });
  const years = (q: Any): Any[] => run(q).protection.members[0].years;

  it("預金500万円＋iDeCo 500万円の「金融資産を含む額」は、預金1,000万円と同じ（計算基準年と後の年。前は iDeCo の分だけ少なかった）", () => {
    const b = years(mk([dep(5_000_000), dc("ideco", 5_000_000)]));
    const c = years(mk([dep(10_000_000)]));
    expect(b.map((y) => y.needWithAssets)).toEqual(c.map((y) => y.needWithAssets));
    expect(b[0].needWithAssets).toBe(30_274_107); // 前は 25,274,107円
    // 死亡一時金は準備できる資金に1回だけ。金融資産は預金だけ
    expect(b[0].breakdown.lumpResources.dcLump).toBe(5_000_000);
    expect(b[0].assets).toBe(5_000_000);
    for (const y of b) expect(y.need - y.assets).toBe(y.needWithAssets);
  });

  it("企業型DC・小規模企業共済でも同じ（入れ方を変えても同じ額）", () => {
    const c = years(mk([dep(10_000_000)]));
    const corp = years(mk([dep(5_000_000), dc("corporateDc", 5_000_000)]));
    expect(corp.map((y) => y.needWithAssets)).toEqual(c.map((y) => y.needWithAssets));
    const ma = years(mk([dep(5_000_000), mutualAid(5_000_000)]));
    expect(ma[0].needWithAssets).toBe(c[0].needWithAssets);
    expect(ma[0].breakdown.lumpResources.mutualAidLump).toBe(5_000_000);
    // 後の年も、金融資産は預金だけ（預金500万円だけの世帯と同じ。共済の残高は共済金の1回だけ）
    const a = years(mk([dep(5_000_000)]));
    expect(ma.map((y) => y.assets)).toEqual(a.map((y) => y.assets));
  });

  it("逆算方式でも同じ", () => {
    const b = years(mk([dep(5_000_000), dc("ideco", 5_000_000)], "2026-04", "reverse"));
    const c = years(mk([dep(10_000_000)], "2026-04", "reverse"));
    expect(b.map((y) => y.needWithAssets)).toEqual(c.map((y) => y.needWithAssets));
  });

  it("配偶者の名義の iDeCo は、亡くなる人の死亡一時金にならないので金融資産に残す（今までどおり）", () => {
    const y = years(mk([dep(5_000_000), dc("ideco", 5_000_000, "n.w")]))[0];
    expect(y.breakdown.lumpResources.dcLump).toBe(0);
    expect(y.assets).toBe(10_000_000);
  });

  it("計算基準月が1月でも同じ", () => {
    const b = years(mk([dep(5_000_000, "2026-01"), dc("ideco", 5_000_000, "n.h", "2026-01")], "2026-01"));
    const c = years(mk([dep(10_000_000, "2026-01")], "2026-01"));
    expect(b.map((y) => y.needWithAssets)).toEqual(c.map((y) => y.needWithAssets));
  });
});

describe("相続税の目安の「いま」: どの財産も計算基準月の初めの姿で数える", () => {
  // 夫・妻・子2人、夫の名義の預金4,000万円（基礎控除 4,800万円の内）
  const mk = (base = "2026-04"): Any =>
    household({
      baseMonth: base,
      endYear: 2040,
      members: [member("i.h", "self", "1981-05", { sex: "male" }), member("i.w", "spouse", "1983-08"), member("i.c1", "child", "2012-06"), member("i.c2", "child", "2014-06")],
      relations: [spouseRel("i.h", "i.w"), parentOf("i.h", "i.c1"), parentOf("i.w", "i.c1"), parentOf("i.h", "i.c2"), parentOf("i.w", "i.c2")] as never,
      periods: [period("i.p", { member: "i.h", from: "2004-04", annual: 8000000 })],
      accounts: [{ id: uid("i.dep"), kind: "deposit", owner: uid("i.h"), marketValue: box(40_000_000), asOf: base, contributions: [] }],
    });
  const now = (req: Any, points: string[] = ["now"]): Any => {
    const q = clone(req);
    q.input.inheritanceTax = { points, members: [uid("i.h")] };
    return run(q).inheritanceTax.points;
  };
  /** 5,000万円の家を買う（頭金1,000万円・団信つきのローン4,000万円） */
  const buy = (req: Any, ym: string, creditLife = true): Any => {
    const q = clone(req);
    q.input.household.residences = [{ id: uid("i.home"), kind: "own", from: at(ym), to: null, purchase: { price: 50_000_000, downPayment: 10_000_000, costs: 0 }, ownership: [{ member: uid("i.h"), share: "1" }] }];
    q.input.household.debts = [
      {
        id: uid("i.loan"),
        kind: "mortgage",
        debtors: [{ member: uid("i.h"), role: "primary" }],
        principal: 40_000_000,
        start: at(ym),
        rateSchedule: [{ from: at(ym), type: "fixed", rate: "0.015" }],
        repayment: { method: "equalPayment", termMonths: 420 },
        ...(creditLife ? { creditLife: { covered: [uid("i.h")], events: ["death"] } } : {}),
      },
    ];
    return q;
  };
  const term = (req: Any, from: string, to: string): Any => {
    const q = clone(req);
    q.input.household.insuranceContracts = [
      {
        id: uid("i.ins"),
        template: "insurance.term",
        policyholder: uid("i.h"),
        insured: uid("i.h"),
        contractDate: from,
        currency: "JPY",
        premium: { amount: 5000, frequency: "monthly", payUntil: at(to) },
        deductionCategory: { type: "general", regime: "new" },
        coverages: [{ id: uid("i.cov"), role: "main", benefit: "death", amount: 30_000_000, to: at(to) }],
      },
    ];
    return q;
  };

  it("計算基準年のうちに買う家（計算基準月・10月・12月）は入れない（前は家4,000万円が入り、税の総額 3,462,500円）", () => {
    const plain = now(mk())[0];
    for (const ym of ["2026-04", "2026-10", "2026-12"]) {
      const p = now(buy(mk(), ym))[0];
      expect(p.assets.realEstateMarket).toBe(0);
      expect(p.assets.financial).toBe(40_000_000);
      expect(p.assets.taxablePrice).toBe(plain.assets.taxablePrice);
      expect(p.totalTax).toBe(0);
    }
    // 団信の無いローンでも、借りる前の負債は引かない
    expect(now(buy(mk(), "2026-10", false))[0].assets.debts).toBe(plain.assets.debts);
  });

  it("計算基準月が1月・3月でも同じ。計算基準月より前に買った家は入れる", () => {
    for (const base of ["2026-01", "2026-03"]) {
      expect(now(buy(mk(base), "2026-10"))[0].assets.realEstateMarket).toBe(0);
    }
    const before = now(buy(mk("2026-04"), "2026-03"))[0];
    expect(before.assets.realEstateMarket).toBe(50_000_000);
    expect(before.assets.debts).toBe(now(mk())[0].assets.debts); // 団信で消える
  });

  it("二人とも亡くなった後（表の最後の年の12月）は今までどおり年末の姿（家を入れる）", () => {
    const p = now(buy(mk(), "2026-10"), ["bothAfter"])[0];
    expect(p.assets.realEstateMarket).toBeGreaterThan(0);
  });

  it("死亡保険金は計算基準月の死亡保障額（今年のうちに終わる保険は入れ、計算基準月より後に始まる保険は入れない）", () => {
    expect(now(term(mk(), "2016-10", "2026-09"))[0].assets.insurance).toBe(30_000_000); // 前は0円
    expect(now(term(mk(), "2026-10", "2046-09"))[0].assets.insurance).toBe(0); // 前は3,000万円
    expect(now(term(mk(), "2026-04", "2046-03"))[0].assets.insurance).toBe(30_000_000); // 計算基準月に始まる保障は、その月に亡くなれば出る
    expect(now(term(mk(), "2016-10", "2046-09"))[0].assets.insurance).toBe(30_000_000);
  });

  it("今のローンの債務は計算基準月の残高（入れた残高のまま。前は計算基準年の年末の残高で少なかった）", () => {
    const q = mk();
    q.input.household.debts = [
      {
        id: uid("i.old"),
        kind: "mortgage",
        debtors: [{ member: uid("i.h"), role: "primary" }],
        principal: 35_000_000,
        start: at("2016-04"),
        balance: box(30_000_000),
        balanceAsOf: "2026-04",
        rateSchedule: [{ from: at("2016-04"), type: "fixed", rate: "0.01" }],
        repayment: { method: "equalPayment", termMonths: 420 },
      },
    ];
    const p = now(q)[0];
    expect(p.assets.debts - p.assets.unpaidTaxes).toBe(30_000_000);
    // 計算基準年のうちに返し終えるローンも、計算基準月の残高で入れる（年末の残高は0円）
    const s = clone(q);
    s.input.household.debts[0] = { ...s.input.household.debts[0], kind: "other", principal: 600_000, balance: box(300_000), repayment: { method: "equalPrincipal", termMonths: 120 }, start: at("2016-10") };
    const ps = now(s)[0];
    expect(ps.assets.debts - ps.assets.unpaidTaxes).toBe(300_000);
  });

  it("計算基準月より後、計算基準年のうちに売る家は、その年の評価額で入れる（前は年末に無いので抜けた）", () => {
    const q = mk("2026-01");
    q.input.household.residences = [
      { id: uid("i.home"), kind: "own", from: at("2010-04"), to: at("2026-09"), valuation: { value: box(30_000_000), asOf: "2026-01" }, sale: { tax: box(0) }, ownership: [{ member: uid("i.h"), share: "1" }] },
    ];
    expect(now(q)[0].assets.realEstateMarket).toBe(30_000_000);
  });
});

describe("ひとり親・寡婦: 配偶者が12月に亡くなる年も、12月31日の現況で死別", () => {
  const mk = (deathAt: string, kid: boolean): Any => {
    const q: Any = household({
      baseMonth: "2026-04",
      endYear: 2040,
      members: [member("s.h", "self", "1986-05", { sex: "male" }), member("s.w", "spouse", "1988-05", { sex: "female" }), ...(kid ? [member("s.k", "child", "2020-06")] : [])],
      relations: [spouseRel("s.h", "s.w"), ...(kid ? [parentOf("s.h", "s.k"), parentOf("s.w", "s.k")] : [])] as never,
      periods: [period("s.p", { member: "s.h", from: "2009-04", annual: 6000000 }), period("s.pw", { member: "s.w", from: "2011-04", annual: 3600000 })],
    });
    q.input.contingencies = [{ id: uid("s.cg"), kind: "death", member: uid("s.h"), occurs: { at: deathAt } }];
    return q;
  };
  const status = (q: Any, year: number) => entry(q, "tax.survivorStatus", { member: uid("s.w"), year });

  it("子ありは12月でもその年からひとり親、子なしは寡婦（11月と同じ。翌年1月に亡くなるならその年はどちらでもない）", () => {
    for (const d of ["2030-11", "2030-12"]) {
      expect(status(mk(d, true), 2030)).toEqual({ widow: false, singleParent: true });
      expect(status(mk(d, false), 2030)).toEqual({ widow: true, singleParent: false });
    }
    expect(status(mk("2031-01", true), 2030)).toEqual({ widow: false, singleParent: false });
    expect(status(mk("2031-01", true), 2031)).toEqual({ widow: false, singleParent: true });
  });

  it("12月に亡くなる年の妻の所得税・住民税は11月と同じ（前は所得税 64,400円・住民税 147,600円で、合わせて 54,900円多かった）", () => {
    const tax = (d: string, prefix: string) =>
      (run(mk(d, true)).flows as Any[]).filter((f) => f.member === uid("s.w") && f.accrualYear === 2030 && f.row.startsWith(prefix)).reduce((a, f) => a + f.amount, 0);
    expect(tax("2030-12", "cf.taxSi.incomeTax")).toBe(45_000);
    expect(tax("2030-12", "cf.taxSi.residentTax")).toBe(112_100);
    expect(tax("2030-11", "cf.taxSi.incomeTax")).toBe(45_000);
  });
});

describe("遺族基礎年金: 子だけが受け取るときの3人目からの加算", () => {
  // ひとり親（母）が亡くなり、子だけが受け取る（2026年度の額）
  const kidsOf = (n: number) => Array.from({ length: n }, (_, i) => `y.c${i + 1}`);
  const mk = (kids: string[], withSpouse = false): Any =>
    household({
      baseMonth: "2026-04",
      endYear: 2032,
      members: [
        member("y.m", "self", "1986-05", { sex: withSpouse ? "male" : "female" }),
        ...(withSpouse ? [member("y.w", "spouse", "1988-08", { sex: "female" })] : []),
        ...kids.map((k, i) => member(k, "child", `${2016 + i * 2}-06`)),
      ],
      relations: [...(withSpouse ? [spouseRel("y.m", "y.w")] : []), ...kids.flatMap((k) => [parentOf("y.m", k), ...(withSpouse ? [parentOf("y.w", k)] : [])])] as never,
      periods: [period("y.p", { member: "y.m", from: "2009-04", annual: 5000000 })],
    });
  const childOnly = (n: number, ym: string) => {
    const kids = kidsOf(n);
    const req = mk(kids);
    let basic = 0;
    for (const k of kids) basic += (entry(req, "pension.survivor", { member: uid(k), death: { member: uid("y.m"), month: "2026-04" } }).months as Any[]).find((x) => x.month === ym)?.basic ?? 0;
    return basic;
  };
  const spouseCase = (n: number, ym: string) =>
    (entry(mk(kidsOf(n), true), "pension.survivor", { member: uid("y.w"), death: { member: uid("y.m"), month: "2026-04" } }).months as Any[]).find((x) => x.month === ym)?.basic;

  it("1人目が基本額、2人目が 243,800円、3人目から 81,300円（前は3人目にも 243,800円）", () => {
    expect(childOnly(1, "2027-01")).toBe(847_300);
    expect(childOnly(2, "2027-01")).toBe(1_091_100);
    expect(childOnly(3, "2027-01")).toBe(1_172_400); // 前は 1,334,900円
    expect(childOnly(4, "2027-01")).toBe(1_253_700); // 前は 1,416,200円
  });

  it("配偶者が受け取るときは今までどおり（1人目・2人目が 243,800円、3人目から 81,300円）", () => {
    expect(spouseCase(3, "2027-01")).toBe(847_300 + 243_800 * 2 + 81_300);
  });

  it("2028年4月からは子の加算が一律なので、子だけの3人は配偶者と子2人と同じ額", () => {
    expect(childOnly(3, "2028-04")).toBe(spouseCase(2, "2028-04"));
    expect(childOnly(3, "2028-03")).toBe(1_172_400);
  });
});

describe("被扶養者・第3号の収入の見込みに、不動産収入・企業年金を入れる", () => {
  // 会社員の夫と、勤めていない妻（妻の名義の貸している不動産・企業年金）
  const mk = (o: { monthly?: number; expenses?: number; db?: number; wifeBirth?: string; holdFrom?: string } = {}): Any => {
    const q: Any = household({
      baseMonth: "2026-04",
      endYear: 2030,
      members: [member("d.h", "self", "1970-05", { sex: "male" }), member("d.w", "spouse", o.wifeBirth ?? "1982-05")],
      relations: [spouseRel("d.h", "d.w")] as never,
      periods: [period("d.p", { member: "d.h", from: "1993-04", annual: 6000000 })],
      accounts:
        o.monthly === undefined
          ? []
          : [
              {
                id: uid("d.re"),
                kind: "realEstate",
                owner: uid("d.w"),
                marketValue: box(30_000_000),
                asOf: "2026-04",
                valueGrowth: "0",
                contributions: [],
                property: {
                  structure: "rc",
                  builtYear: 2015,
                  landShare: "0.4",
                  acquisition: { price: 25_000_000, at: "2020-04" },
                  rental: { monthly: box(o.monthly), vacancyRate: "0", growth: "0" },
                  expenses: { annual: box(o.expenses ?? 0), rate: "0" },
                  ...(o.holdFrom === undefined ? {} : { holdFrom: at(o.holdFrom) }),
                },
              },
            ],
    });
    if (o.db !== undefined) q.input.household.retirementBenefits = [{ id: uid("d.db"), member: uid("d.w"), kind: "db", receipt: { method: "annuity", start: at("2027-01"), years: 10, annualAmount: o.db } }];
    return q;
  };
  const health = (q: Any, ym: string) => (entry(q, "socialInsurance.healthStatus", { member: uid("d.w") }).months as Any[]).find((x) => x.month === ym)?.kind;
  const cat = (q: Any, ym: string) => (entry(q, "pension.category", { member: uid("d.w") }).months as Any[]).find((x) => x.month === ym)?.category;

  it("家賃収入が年130万円以上なら扶養・第3号にならない（前は年204万円でも扶養のまま）", () => {
    expect(health(mk({ monthly: 170_000 }), "2026-04")).toBe("national");
    expect(cat(mk({ monthly: 170_000 }), "2026-04")).toBe("1");
    expect(health(mk({ monthly: 100_000 }), "2026-04")).toBe("dependent");
    expect(cat(mk({ monthly: 100_000 }), "2026-04")).toBe("3");
  });

  it("境目: 年 1,299,996円は扶養、年 1,300,008円は扶養でない（130万円未満）。経費を引いた額で見る", () => {
    expect(health(mk({ monthly: 108_333 }), "2026-04")).toBe("dependent");
    expect(health(mk({ monthly: 108_334 }), "2026-04")).toBe("national");
    expect(health(mk({ monthly: 150_000, expenses: 600_000 }), "2026-04")).toBe("dependent");
  });

  it("持ち始める時点の月から見込みに入る", () => {
    const q = mk({ monthly: 170_000, holdFrom: "2027-01" });
    expect(health(q, "2026-12")).toBe("dependent");
    expect(health(q, "2027-01")).toBe("national");
  });

  it("60歳以上は年180万円未満（60歳になる月から。1日生まれの人は前の月から）", () => {
    // 妻 1966年5月生まれ: 60歳は 2026年5月。年 1,680,000円
    const q = mk({ monthly: 140_000, wifeBirth: "1966-05" });
    expect(health(q, "2026-04")).toBe("national");
    expect(health(q, "2026-05")).toBe("dependent");
    const first = clone(q);
    first.input.household.members[1].birth.bornOnFirst = true;
    expect(health(first, "2026-04")).toBe("dependent");
  });

  it("年金で受け取る企業年金（確定給付。年200万円）を受け始める月から扶養でない", () => {
    const q = mk({ db: 2_000_000 });
    expect(health(q, "2026-12")).toBe("dependent");
    expect(health(q, "2027-01")).toBe("national");
    expect(cat(q, "2027-01")).toBe("1");
  });
});

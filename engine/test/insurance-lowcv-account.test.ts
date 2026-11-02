// 低解約返戻金型終身保険とアカウント型（利率変動型積立終身保険）の計算（0055 の追記 2026-11-03）: 運用の計算は入れず、設計書の数字を写す形。
// 低解約返戻金型は払込中の率・払込の終わりの率・年齢ごとの率の点（点の間はまっすぐ）、アカウント型は積立金の直線・払込の後の3つの扱い・
// 途中の解約・万一のとき
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { InsurancePolicyOutput } from "../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = EngineRequest;
type Obj = Record<string, unknown>;
const H = uid("h");
const W = uid("w");
const ID = uid("ins");
const at = (ym: string) => ({ at: ym });
const run = (req: Req) => runEngine(req, realPacks(), { checkInternal: true });
const policy = (req: Req): InsurancePolicyOutput => runEngine(req, realPacks(), { checkInternal: true, entry: { component: "insurance.policy", input: { object: ID } } }).entryOutput as InsurancePolicyOutput;
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;

const family = () =>
  household({
    baseMonth: "2026-10",
    endYear: 2075,
    members: [member("h", "self", "1990-05", { sex: "male" }), member("w", "spouse", "1992-08")],
    relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }],
    periods: [period("ph", { member: "h", from: "2013-04", annual: 6000000, std: [500000, 500000] })],
    residentTaxAssessments: [{ id: uid("rta"), member: H, fiscalYear: 2026, amount: box(300000) }],
  });
const withContract = (o: Obj, extra?: (input: Obj) => void): Req => {
  const req = JSON.parse(JSON.stringify(family())) as Req;
  const input = req.input as unknown as Obj;
  (input.household as Obj).insuranceContracts = [
    {
      id: ID,
      template: "insurance.wholeLife",
      policyholder: H,
      insured: H,
      contractDate: "2020-04",
      currency: "JPY",
      deductionCategory: { type: "general", regime: "new" },
      ...o,
    },
  ];
  extra?.(input);
  return req;
};
const year = (out: InsurancePolicyOutput, y: number) => out.years.find((e) => e.year === y)!;
const death = (ym: string) => (input: Obj) => void (input.contingencies = [{ id: uid("cg"), kind: "death", member: H, occurs: at(ym) }]);

describe("低解約返戻金型終身保険（払込中の率・払込の終わりの率・年齢ごとの率の点）", () => {
  // 2020年4月から2040年3月まで月1万円（240か月）
  const lowCv = (simple: Obj, extra?: (input: Obj) => void) =>
    withContract(
      {
        subtype: "lowSurrender",
        premium: { amount: 10000, frequency: "monthly", payUntil: at("2040-04") },
        coverages: [{ id: uid("d"), role: "main", benefit: "death", amount: 10000000, to: null }],
        simple,
      },
      extra,
    );

  it("払込中は払込保険料の累計×払込中の率（まっすぐ伸ばさない）。払込が終わった時から払込の終わりの率", () => {
    const out = policy(lowCv({ returnRate: "1.05", returnRateDuring: "0.7" }));
    // 2026年末は6保険年度の終わり（2026年3月まで72か月）
    expect(year(out, 2026).surrenderValue).toBe(504000);
    // 2039年末は19保険年度の終わり（228か月）
    expect(year(out, 2039).surrenderValue).toBe(1596000);
    // 2040年末は払込が終わった後（240か月）。その後も同じ率のまま
    expect(year(out, 2040).surrenderValue).toBe(2520000);
    expect(year(out, 2070).surrenderValue).toBe(2520000);
    // 払込中の率が無ければ、前のとおり払込の終わりの率に向かってまっすぐ伸ばす（終身保険の今の形は変わらない）
    expect(year(policy(lowCv({ returnRate: "1.05" })), 2026).surrenderValue).toBe(Math.round((720000 * 1.05 * 72) / 240));
  });

  it("年齢ごとの率の点: 払込の終わりの月と点の間をまっすぐつなぎ、最後の点の後はその率のまま。払込の終わりより前の年齢の点は使わない", () => {
    const pts = [
      { id: uid("p40"), age: 40, rate: "2.0" },
      { id: uid("p70"), age: 70, rate: "1.3" },
      { id: uid("p60"), age: 60, rate: "1.15" },
    ];
    const out = policy(lowCv({ returnRate: "1.05", returnRateDuring: "0.7", returnRatePoints: pts }));
    // 40歳の点（2030年5月。払込中）は使わない
    expect(year(out, 2030).surrenderValue).toBe(840000);
    // 2045年末は25保険年度の終わり（2045年3月）。払込の終わり（2040年4月・105%）と60歳（2050年5月・115%）の間の 59/121
    const v = year(out, 2045).surrenderValue;
    expect(Math.abs(v - (2520000 + (240000 * 59) / 121))).toBeLessThanOrEqual(1);
    // 2055年末（2055年3月）は60歳と70歳（2060年5月・130%）の間
    const w = year(out, 2055).surrenderValue;
    expect(w > 2400000 * 1.15 && w < 2400000 * 1.3).toBe(true);
    // 最後の点の後は、その率のまま
    expect(year(out, 2070).surrenderValue).toBe(3120000);
  });

  it("解約の月に、その時の解約返戻金を一時所得で受け取る（払込中なら払込中の率）", () => {
    const r = run(lowCv({ returnRate: "1.05", returnRateDuring: "0.7" }, (input) => void (((input.household as Obj).insuranceContracts as Obj[])[0]!.surrender = at("2030-04"))));
    const s = r.flows.filter((f) => f.row === "cf.income.lumpSum.surrender");
    expect(s.map((f) => [f.ym, f.amount])).toEqual([["2030-04", 840000]]);
  });
});

describe("アカウント型（積立金の直線・払込の後の扱い・途中の解約・万一のとき）", () => {
  // 2020年4月から2040年3月まで月2万円（240か月）。保障の部分は死亡保険金3,000万円（払込の終わりまで）
  const acct = (account: Obj, extra?: (input: Obj) => void, payUntil: Obj | null = at("2040-04")) =>
    withContract(
      {
        subtype: "account",
        premium: { amount: 20000, frequency: "monthly", payUntil },
        coverages: [{ id: uid("t"), role: "main", benefit: "death", amount: 30000000, to: at("2040-03") }],
        simple: { account },
      },
      extra,
    );

  it("積立金は契約の月の0円から、払込が終わった時の額まで保険年度ごとにまっすぐ増える（解約返戻金）", () => {
    const out = policy(acct({ value: 3000000, after: "wholeLife", deathBenefit: 5000000 }));
    expect(year(out, 2026).surrenderValue).toBe((3000000 * 72) / 240);
    expect(year(out, 2030).surrenderValue).toBe((3000000 * 120) / 240);
    expect(year(out, 2039).surrenderValue).toBe((3000000 * 228) / 240);
    expect(year(out, 2040).surrenderValue).toBe(3000000);
  });

  it("終身保険に移す: 保障の部分が終わっても契約は続き、死亡保険金は終身保険の額・解約返戻金は払込が終わった時の額のまま", () => {
    const out = policy(acct({ value: 3000000, after: "wholeLife", deathBenefit: 5000000 }));
    // 払込中は保障の部分＋その時の積立金
    expect(year(out, 2026).deathBenefit).toBe(30000000 + (3000000 * 72) / 240);
    expect(year(out, 2045)).toMatchObject({ deathBenefit: 5000000, surrenderValue: 3000000 });
    expect(year(out, 2075)).toMatchObject({ deathBenefit: 5000000, surrenderValue: 3000000 });
    expect(out.endsAt).toBeNull();
    // 払込は払込の終わりまで
    expect(year(out, 2041).premium).toBe(0);
  });

  it("年金で受け取る: 払込の終わりの月から毎年、年数の間（雑所得。必要経費は払込保険料×年金額÷年金の総額）。積立金は受け取った回数の分だけ減る", () => {
    const out = policy(acct({ value: 3000000, after: "annuity", annual: 330000, years: 10 }));
    const ann = out.receipts.filter((x) => x.kind === "annuity");
    expect(ann.map((x) => x.ym)).toEqual(["2040-04", "2041-04", "2042-04", "2043-04", "2044-04", "2045-04", "2046-04", "2047-04", "2048-04", "2049-04"]);
    expect(ann.every((x) => x.amount === 330000 && x.taxClass === "miscellaneous" && x.member === H && x.cost === (4800000 * 330000) / 3300000)).toBe(true);
    // 2045年末の値は25保険年度の終わり（2045年3月）の時点で、それまでに5回受け取った
    expect(year(out, 2045).surrenderValue).toBe((3000000 * 5) / 10);
    expect(year(out, 2050).surrenderValue).toBe(0);
    // 年数の省略は10年
    expect(policy(acct({ value: 3000000, after: "annuity", annual: 330000 })).receipts.filter((x) => x.kind === "annuity")).toHaveLength(10);
  });

  it("解約して受け取る: 払込の終わりの月に払込が終わった時の額を一時所得で受け取り、契約は終わる", () => {
    const out = policy(acct({ value: 3000000, after: "surrender" }));
    expect(out.receipts.filter((x) => x.kind === "surrender").map((x) => [x.ym, x.amount, x.taxClass])).toEqual([["2040-04", 3000000, "temporary"]]);
    expect(out.endsAt).toBe("2040-04");
    expect(year(out, 2041)).toMatchObject({ deathBenefit: 0, surrenderValue: 0 });
    const r = run(acct({ value: 3000000, after: "surrender" }));
    expect(r.flows.filter((f) => f.row === "cf.income.lumpSum.surrender").reduce((n, f) => n + f.amount, 0)).toBe(3000000);
  });

  it("途中で解約したときの解約返戻金も積立金の線から（解約の月までに終わった保険年度の分）", () => {
    const out = policy(acct({ value: 3000000, after: "wholeLife", deathBenefit: 5000000 }, (input) => void (((input.household as Obj).insuranceContracts as Obj[])[0]!.surrender = at("2030-04"))));
    expect(out.receipts.filter((x) => x.kind === "surrender").map((x) => [x.ym, x.amount])).toEqual([["2030-04", 1500000]]);
    // 年金の扱いで、受け取りの途中に解約したときは残りの積立金
    const mid = policy(acct({ value: 3000000, after: "annuity", annual: 330000, years: 10 }, (input) => void (((input.household as Obj).insuranceContracts as Obj[])[0]!.surrender = at("2043-06"))));
    expect(mid.receipts.filter((x) => x.kind === "annuity")).toHaveLength(4);
    expect(mid.receipts.filter((x) => x.kind === "surrender").map((x) => x.amount)).toEqual([(3000000 * 6) / 10]);
  });

  it("万一のとき: 払込中に亡くなったら、保障の部分の死亡保険金とその時の積立金を受け取る（契約者＝被保険者なので相続税の対象）", () => {
    const out = policy(acct({ value: 3000000, after: "wholeLife", deathBenefit: 5000000 }, death("2030-06")));
    const d = out.receipts.filter((x) => x.kind === "death");
    expect(d.map((x) => [x.ym, x.amount, x.member, x.taxClass])).toEqual([["2030-07", 30000000 + 1500000, W, "inheritance"]]);
    // 終身保険に移した後に亡くなったら、終身保険の死亡保険金
    const later = policy(acct({ value: 3000000, after: "wholeLife", deathBenefit: 5000000 }, death("2050-06")));
    expect(later.receipts.filter((x) => x.kind === "death").map((x) => x.amount)).toEqual([5000000]);
    // 年金の受け取りの途中に亡くなったら、年金はそこで止まり、残りの積立金を死亡保険金として受け取る
    const ann = policy(acct({ value: 3000000, after: "annuity", annual: 330000, years: 10 }, death("2043-06")));
    expect(ann.receipts.filter((x) => x.kind === "annuity")).toHaveLength(4);
    expect(ann.receipts.filter((x) => x.kind === "death").map((x) => x.amount)).toEqual([(3000000 * 6) / 10]);
  });

  it("払込の終わりが無い（終身払い）ときは積立金を0円とし、入力を求める知らせを出す", () => {
    const req = acct({ value: 3000000, after: "wholeLife", deathBenefit: 5000000 }, undefined, null);
    expect(year(policy(req), 2030).surrenderValue).toBe(0);
    expect(notices(run(req)).some((n) => n.code === "N_INPUT_REQUIRED" && n.ids.includes("insurance.simple.account"))).toBe(true);
  });
});

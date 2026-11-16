// iDeCo・企業型DC の一時金の退職所得控除の勤続年数（所得税法施行令69条1項2号: 掛金を納付した加入者期間。0003 の追記 2026-11-15）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { RetirementIncomeOutput, RetirementReceipt } from "../src/sdk/index.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const packs = realPacks();
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, packs, { checkInternal: true, entry: { component, input } }).entryOutput as T;
const full = (req: Req) => runEngine(req, packs, { checkInternal: true });
const A = uid("a");
const IDECO = uid("ideco");
const at = (ym: string) => ({ at: ym });
const notices = (req: Req) => ((full(req).header as unknown as { notices: { code: string; ids: string[] }[] }).notices ?? []).map((n) => `${n.code}|${n.ids.join(",")}`);

/** 退職所得控除（勤続年数 n 年。20年以下は40万円×n、20年超は800万円＋70万円×(n−20)。最低80万円） */
const D = (n: number) => Math.max(800000, n <= 20 ? 400000 * n : 8000000 + 700000 * (n - 20));
/** (一時金−控除)÷2 に所得税5%×102.1%（2027年分からは復興1.1%＋防衛1%で同じ）と住民税10%（課税退職所得が195万円以下のとき） */
const smallTax = (amount: number, years: number) => {
  const taxable = Math.floor(Math.max(0, amount - D(years)) / 2 / 1000) * 1000;
  return Math.floor(taxable * 0.05 * 1.021) + Math.floor((taxable * 0.06) / 100) * 100 + Math.floor((taxable * 0.04) / 100) * 100;
};

interface Opt {
  readonly baseMonth?: string;
  readonly birth?: string;
  readonly bornOnFirst?: boolean;
  readonly retire: string;
  readonly enrolledSince?: string;
  readonly contributions: readonly { from: string; to: string | null; monthly: number }[];
  readonly payoutStart?: string;
  readonly balance?: number;
}
const mk = (o: Opt): Req =>
  household({
    baseMonth: o.baseMonth ?? "2026-01",
    endYear: 2040,
    members: [member("a", "self", o.birth ?? "1970-06", o.bornOnFirst === true ? { birth: { birthYearMonth: o.birth ?? "1970-06", bornOnFirst: true } } : {})],
    periods: [period("p", { member: "a", from: "1993-04", to: o.retire, annual: 6000000, std: [500000, 500000] })],
    accounts: [
      { id: uid("dep"), kind: "deposit", owner: A, marketValue: box(10000000), asOf: "2025-12", contributions: [] },
      {
        id: IDECO,
        kind: "ideco",
        owner: A,
        marketValue: box(o.balance ?? 8000000),
        asOf: "2025-12",
        ...(o.enrolledSince !== undefined ? { enrolledSince: o.enrolledSince } : {}),
        expectedReturn: "0",
        contributions: o.contributions.map((c) => ({ from: at(c.from), to: c.to === null ? null : at(c.to), monthly: c.monthly })),
        ...(o.payoutStart !== undefined ? { payout: { method: "lumpSum", start: at(o.payoutStart) } } : {}),
      },
    ],
  });
const receipts = (req: Req) => call<{ receipts: RetirementReceipt[] }>(req, "retirement.receipts", { member: A }).receipts.filter((r) => r.source === "dc");
const taxOf = (req: Req) => {
  const r = receipts(req)[0] as RetirementReceipt;
  return { r, t: call<RetirementIncomeOutput>(req, "tax.retirementIncome", { member: A, year: Number(r.ym.slice(0, 4)) }) };
};

describe("確定拠出年金の一時金の勤続期間は、掛金を払った月（所得税法施行令69条1項2号）", () => {
  it("60歳まで掛けて65歳で一時金: 加入の月から最後に掛けた月まで（241か月→21年）。前は受け取りの月からさかのぼって15年", () => {
    const { r, t } = taxOf(mk({ retire: "2030-06", enrolledSince: "2010-06", contributions: [{ from: "2010-06", to: "2030-06", monthly: 20000 }], payoutStart: "2035-07" }));
    expect([r.ym, r.serviceFrom, r.serviceTo, r.servicePeriods]).toEqual(["2035-07", "2010-06", "2030-06", undefined]);
    expect(t.years).toBe(21);
    expect(t.deduction).toBe(8700000);
    // 前は 2015-07〜2030-06 の15年・控除600万円・税 232,617円
    expect(t.total).toBe(28699);
  });

  it("60歳を過ぎても掛けた月を数える（65歳まで掛けて300か月→25年。控除1,150万円で税0円。前は20年）", () => {
    const { r, t } = taxOf(mk({ retire: "2035-06", enrolledSince: "2010-06", contributions: [{ from: "2010-06", to: null, monthly: 20000 }] }));
    expect([r.serviceFrom, r.serviceTo]).toEqual(["2010-06", "2035-05"]);
    expect(t.years).toBe(25);
    expect(t.deduction).toBe(11500000);
    expect(t.total).toBe(0);
  });

  it("60歳ちょうどで受け取る: 最初の掛金の月も数える（前は1か月短く240か月→20年）", () => {
    const { r, t } = taxOf(mk({ retire: "2030-06", enrolledSince: "2010-06", contributions: [{ from: "2010-06", to: "2030-06", monthly: 20000 }] }));
    expect([r.ym, r.serviceFrom, r.serviceTo]).toEqual(["2030-07", "2010-06", "2030-06"]);
    expect(t.years).toBe(21);
    expect(t.total).toBe(smallTax(9080000, 21));
  });

  it("60歳を過ぎてから加入した人: 加入から最後の掛金まで（53か月→5年。前はいつも1年・控除80万円）", () => {
    const { r, t } = taxOf(mk({ retire: "2035-06", balance: 0, enrolledSince: "2031-01", contributions: [{ from: "2031-01", to: null, monthly: 60000 }] }));
    expect([r.ym, r.serviceFrom, r.serviceTo]).toEqual(["2036-01", "2031-01", "2035-05"]);
    expect(t.years).toBe(5);
    expect(t.deduction).toBe(2000000);
    expect(t.total).toBe(89119);
  });

  it("掛金を止めていた月は数えない（計算基準月より前に止めた期間・後に止めた期間とも。期間の並び servicePeriods）", () => {
    // 2020-04〜2022-03 の2年を止めた（計算基準月より前）: 118＋99＝217か月→19年
    const before = taxOf(mk({ retire: "2030-06", enrolledSince: "2010-06", contributions: [{ from: "2010-06", to: "2020-03", monthly: 20000 }, { from: "2022-04", to: "2030-06", monthly: 20000 }] }));
    expect(before.r.servicePeriods).toEqual([{ from: "2010-06", to: "2020-03" }, { from: "2022-04", to: "2030-06" }]);
    expect(before.t.years).toBe(19);
    // 2028年の1年を止める（計算基準月より後）: 241−12＝229か月→20年
    const after = taxOf(mk({ retire: "2030-06", enrolledSince: "2010-06", contributions: [{ from: "2010-06", to: "2027-12", monthly: 20000 }, { from: "2029-01", to: "2030-06", monthly: 20000 }] }));
    expect(after.r.servicePeriods).toEqual([{ from: "2010-06", to: "2027-12" }, { from: "2029-01", to: "2030-06" }]);
    expect(after.t.years).toBe(20);
  });

  it("同じ期間の入れ方の違い（加入の始まり＋計算基準月からの積立・加入の始まりなしで昔からの積立・両方）は同じ年数", () => {
    const a = taxOf(mk({ retire: "2030-06", enrolledSince: "2010-06", contributions: [{ from: "2026-01", to: "2030-06", monthly: 20000 }] }));
    const b = taxOf(mk({ retire: "2030-06", contributions: [{ from: "2010-06", to: "2030-06", monthly: 20000 }] }));
    const c = taxOf(mk({ retire: "2030-06", enrolledSince: "2010-06", contributions: [{ from: "2010-06", to: "2030-06", monthly: 20000 }] }));
    for (const x of [a, b, c]) {
      expect([x.r.serviceFrom, x.r.serviceTo, x.t.years]).toEqual(["2010-06", "2030-06", 21]);
    }
    expect(a.t.total).toBe(c.t.total);
  });

  it("加入の始まりも計算基準月より前の積立も無いときは、計算基準月から数えて知らせる", () => {
    const req = mk({ retire: "2030-06", contributions: [{ from: "2026-01", to: "2030-06", monthly: 20000 }] });
    const { r, t } = taxOf(req);
    expect([r.serviceFrom, r.serviceTo, t.years]).toEqual(["2026-01", "2030-06", 5]);
    expect(notices(req)).toContain(`N_ASSUMED|retirement.receipts,ideco.lumpSumServiceEstimated,${IDECO}`);
    // 加入の始まりを入れれば知らせない
    expect(notices(mk({ retire: "2030-06", enrolledSince: "2010-06", contributions: [{ from: "2026-01", to: "2030-06", monthly: 20000 }] })).some((n) => n.includes("lumpSumServiceEstimated"))).toBe(false);
  });

  it("計算基準月が1〜3月・12月に受け取る・1日生まれ: 掛金を払った月がそのまま期間になる", () => {
    // 計算基準月 2026-03、12月に受け取る
    const dec = taxOf(mk({ baseMonth: "2026-03", retire: "2030-06", enrolledSince: "2010-06", contributions: [{ from: "2010-06", to: "2030-06", monthly: 20000 }], payoutStart: "2035-12" }));
    expect([dec.r.ym, dec.r.serviceFrom, dec.r.serviceTo, dec.t.years]).toEqual(["2035-12", "2010-06", "2030-06", 21]);
    // 1日生まれは65歳に達する月が1か月早いので、掛けられる最後の月も1か月早い（2035-04）
    const first = taxOf(mk({ birth: "1970-06", bornOnFirst: true, retire: "2035-06", enrolledSince: "2010-06", contributions: [{ from: "2010-06", to: null, monthly: 20000 }] }));
    const other = taxOf(mk({ birth: "1970-06", retire: "2035-06", enrolledSince: "2010-06", contributions: [{ from: "2010-06", to: null, monthly: 20000 }] }));
    expect(other.r.serviceTo).toBe("2035-05");
    expect(first.r.serviceTo < other.r.serviceTo).toBe(true);
  });

  it("受け取る前に亡くなる想定では一時金が無く、退職所得の税も無い", () => {
    const req = mk({ retire: "2030-06", enrolledSince: "2010-06", contributions: [{ from: "2010-06", to: "2030-06", monthly: 20000 }], payoutStart: "2035-07" });
    (req.input as unknown as Obj).contingencies = [{ id: uid("death"), kind: "death", member: A, occurs: { at: "2033-05" } }];
    expect(receipts(req)).toEqual([]);
    const flows = full(req).flows as unknown as { row: string }[];
    expect(flows.some((f) => f.row === "cf.taxSi.incomeTax.retirement")).toBe(false);
  });
});

describe("前の一時金と重なる期間（重複排除期間）も、掛金を払った月で見る", () => {
  const receipt = (o: Omit<Partial<RetirementReceipt>, "amount"> & { ym: string; amount: number; serviceFrom: string; serviceTo: string }): RetirementReceipt =>
    ({ object: uid(`r.${o.ym}`), source: "retirement", ...o }) as RetirementReceipt;
  const tax = (year: number, rs: RetirementReceipt[]) =>
    runEngine(household({ baseMonth: "2027-01", members: [member("a", "self", "1975-04")] }), packs, { checkInternal: true, entry: { component: "tax.retirementIncome", input: { member: A, year } }, stubs: { "retirement.receipts": () => ({ receipts: rs }) } })
      .entryOutput as RetirementIncomeOutput;

  it("DC 一時金（2030年。2005-04〜2030-05 のうち2015年の1年を止めた）の6年後の退職金: 重なるのは掛金を払った288か月（24年）", () => {
    const dc = receipt({ ym: "2030-06", amount: 15000000, serviceFrom: "2005-04", serviceTo: "2030-05", source: "dc", servicePeriods: [{ from: "2005-04", to: "2014-12" }, { from: "2016-01", to: "2030-05" }] });
    const later = receipt({ ym: "2036-04", amount: 20000000, serviceFrom: "2000-04", serviceTo: "2036-03" });
    const t = tax(2036, [dc, later]);
    expect(t.overlapYears).toBe(24);
    expect(t.deduction).toBe(D(36) - D(24));
    // 止めた月の無い同じ期間なら25年（前からの扱い）
    const whole = receipt({ ym: "2030-06", amount: 15000000, serviceFrom: "2005-04", serviceTo: "2030-05", source: "dc" });
    expect(tax(2036, [whole, later]).overlapYears).toBe(25);
  });

  it("同じ年の DC 一時金（止めた月あり）と退職金は、勤続期間を合わせて1回だけ数える", () => {
    const dc = receipt({ ym: "2036-04", amount: 5000000, serviceFrom: "2010-04", serviceTo: "2036-03", source: "dc", servicePeriods: [{ from: "2010-04", to: "2019-03" }, { from: "2021-04", to: "2036-03" }] });
    const ret = receipt({ ym: "2036-04", amount: 20000000, serviceFrom: "2016-04", serviceTo: "2036-03" });
    // DC の止めた月（2019-04〜2021-03）は退職金の勤続期間（2016-04〜）に入るので、和は 2010-04〜2036-03 の312か月→26年
    expect(tax(2036, [dc, ret]).years).toBe(26);
  });
});

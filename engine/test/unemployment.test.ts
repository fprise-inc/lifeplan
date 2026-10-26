// 雇用保険の失業の給付（基本手当・高年齢求職者給付金）と高年齢雇用継続給付、年金・被扶養者とのつながり（0037。製品の制度データで手計算と突き合わせる）
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { CategoryOutput, HealthStatusOutput, PensionOutput, UnemploymentOutput } from "../src/sdk/contracts.ts";
import { clone, fictionalPacks, household, member, modelHousehold, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
const H = uid("h");
const W = uid("w");
const packs = realPacks();
const run = (req: EngineRequest) => runEngine(req, packs, { checkInternal: true });
const entry = <T>(req: Req, component: string, input: unknown, stubs?: Record<string, (i: unknown) => unknown>) =>
  runEngine(req, packs, { checkInternal: true, entry: { component, input }, ...(stubs ? { stubs } : {}) }).entryOutput as T;
const unemp = (req: Req, who = H) => entry<UnemploymentOutput>(req, "benefit.unemployment", { member: who });
const setH = (req: Req, key: string, value: unknown) => {
  (req.input.household as unknown as Record<string, unknown>)[key] = value;
  return req;
};
const notices = (r: EngineResult) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const pays = (o: UnemploymentOutput, formula: string) => o.flows.filter((f) => f.formula === formula).map((f) => [f.ym, f.amount] as const);
const total = (o: UnemploymentOutput, formula: string) => pays(o, formula).reduce((s, [, a]) => s + a, 0);

/** 1人の世帯: from〜to の勤め（給与の年額 annual）の後、働かない（unemployed の期間） */
function leaver(o: { birth: string; from: string; to: string; annual: number; extra?: Record<string, unknown>; idleTo?: string | null; next?: Record<string, unknown>; baseMonth?: string; endYear?: number; sex?: string }): Req {
  const periods: Record<string, unknown>[] = [period("job", { member: "h", from: o.from, to: o.to, annual: o.annual, extra: o.extra ?? {} })];
  const after = { ...period("idle", { member: "h", from: next(o.to), to: o.idleTo ?? null, type: "unemployed", annual: 0, healthInsurance: { kind: "national" }, pensionCategory: "none" }) };
  periods.push(after);
  if (o.next !== undefined) periods.push(o.next);
  return household({ baseMonth: o.baseMonth ?? "2026-04", endYear: o.endYear ?? 2028, members: [member("h", "self", o.birth, { sex: o.sex ?? "male" })], periods });
}
/** 健康保険の種類を書かない無職の期間（エンジンが扶養か国民健康保険かを導く） */
function idleWithoutHealth(name: string, who: string, from: string): Record<string, unknown> {
  const p = period(name, { member: who, from, type: "unemployed", annual: 0, pensionCategory: "none" });
  delete p.healthInsurance;
  return p;
}
function next(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

describe("基本手当", () => {
  it("自己都合（35歳・被保険者であった期間11年）: 賃金日額10,000円、日額6,307円（80%〜50%の逓減）、待期7日＋給付制限1か月の後に120日、受けた日の月の翌月に払う", () => {
    const o = unemp(leaver({ birth: "1991-05", from: "2015-04", to: "2026-12", annual: 3600000 }));
    // 10,000×(0.8−0.3×(10,000−5,480)/(13,490−5,480))＝6,307.1… → 6,307円。日: 37日目〜156日目（1か月30日）
    expect(o.receipts.map((x) => [x.month, x.days, x.daily])).toEqual([
      ["2027-02", 23, 6307],
      ["2027-03", 30, 6307],
      ["2027-04", 30, 6307],
      ["2027-05", 30, 6307],
      ["2027-06", 7, 6307],
    ]);
    expect(pays(o, "benefit.unemployment.basicAllowance")).toEqual([
      ["2027-03", 145061],
      ["2027-04", 189210],
      ["2027-05", 189210],
      ["2027-06", 189210],
      ["2027-07", 44149],
    ]);
    expect(o.flows.every((f) => f.row === "cf.income.benefit.unemployment")).toBe(true);
  });

  it("所定給付日数の境目: 一般の離職者は被保険者であった期間9年11か月で90日、10年で120日", () => {
    const days = (from: string) => unemp(leaver({ birth: "1991-05", from, to: "2026-12", annual: 3600000 })).receipts.reduce((s, x) => s + x.days, 0);
    expect(days("2017-02")).toBe(90);
    expect(days("2017-01")).toBe(120);
  });

  it("会社都合（50歳・25年）: 330日、給付制限なし。賃金日額は45〜59歳の上限18,220円で、日額は50%の9,110円", () => {
    const o = unemp(leaver({ birth: "1976-03", from: "2001-04", to: "2026-09", annual: 7200000, extra: { endsWith: "involuntary" } }));
    expect(o.receipts.reduce((s, x) => s + x.days, 0)).toBe(330);
    expect(o.receipts[0]).toEqual({ month: "2026-10", days: 23, daily: 9110 });
    expect(total(o, "benefit.unemployment.basicAllowance")).toBe(330 * 9110);
  });

  it("会社都合の30歳未満・35歳・45歳の境目（離職の日の年齢）で日数が変わる", () => {
    const days = (birth: string) =>
      unemp(leaver({ birth, from: "2014-04", to: "2026-09", annual: 3600000, extra: { endsWith: "involuntary" } })).receipts.reduce((s, x) => s + x.days, 0);
    // 被保険者であった期間12年5か月（10年以上20年未満）
    expect(days("1996-10")).toBe(180); // 29歳
    expect(days("1996-09")).toBe(210); // 30歳に達した月に離職
    expect(days("1991-09")).toBe(240); // 35歳
    expect(days("1981-09")).toBe(270); // 45歳
  });

  it("60歳以上65歳未満: 給付率は80%〜45%で、逓減の式と（賃金日額×5%＋12,120円×40%）の低い方。定年（省略）は給付制限なし", () => {
    const o = unemp(leaver({ birth: "1965-05", from: "1990-04", to: "2026-12", annual: 3600000 }));
    // 10,000×(0.8−0.35×4,520/6,640)＝5,617 と 500＋4,848＝5,348 の低い方。20年以上の一般の150日。待期7日の後から
    expect(o.receipts[0]).toEqual({ month: "2027-01", days: 23, daily: 5348 });
    expect(o.receipts.reduce((s, x) => s + x.days, 0)).toBe(150);
  });

  it("賃金日額の下限（3,203円）と、上限（60歳以上65歳未満 17,400円×45%＝7,830円）", () => {
    const low = unemp(leaver({ birth: "1991-05", from: "2015-04", to: "2026-12", annual: 480000 }));
    // 40,000×6÷180＝1,333円 → 下限 3,203円 ×80%＝2,562円
    expect(low.receipts[0]?.daily).toBe(2562);
    const high = unemp(leaver({ birth: "1965-05", from: "1990-04", to: "2026-12", annual: 12000000 }));
    expect(high.receipts[0]?.daily).toBe(7830);
  });

  it("推定: 次に働くまで3か月以上なら受け取り、2か月なら受け取らない。unemploymentClaim で上書きできる。次に働く月で打ち切る", () => {
    const job2 = (from: string) => period("job2", { member: "h", from, annual: 3600000 });
    const two = unemp(leaver({ birth: "1991-05", from: "2015-04", to: "2026-12", annual: 3600000, idleTo: "2027-02", next: job2("2027-03") }));
    expect(two.flows).toEqual([]);
    const three = unemp(leaver({ birth: "1991-05", from: "2015-04", to: "2026-12", annual: 3600000, idleTo: "2027-03", next: job2("2027-04") }));
    // 37日目〜89日目（2027-02 の23日・2027-03 の30日）で打ち切り
    expect(three.receipts.map((x) => [x.month, x.days])).toEqual([
      ["2027-02", 23],
      ["2027-03", 30],
    ]);
    const forced = unemp(leaver({ birth: "1991-05", from: "2015-04", to: "2026-12", annual: 3600000, extra: { unemploymentClaim: true }, idleTo: "2027-02", next: job2("2027-03") }));
    expect(forced.receipts.map((x) => x.days)).toEqual([23]);
    const off = unemp(leaver({ birth: "1991-05", from: "2015-04", to: "2026-12", annual: 3600000, extra: { unemploymentClaim: false } }));
    expect(off.flows).toEqual([]);
    const sample = modelHousehold("jobLeaver");
    const self = sample.input.household.members[0]?.id as string;
    expect(notices(run(sample))).toContainEqual({ code: "N_ESTIMATED", ids: ["benefit.unemployment", "employment.unemploymentClaim", self] });
  });

  it("受給資格: 離職の日以前2年間に12か月（会社都合は1年間に6か月）。休業のまま辞めた（sickLeave）は推定では受け取らない", () => {
    expect(unemp(leaver({ birth: "1991-05", from: "2026-02", to: "2026-12", annual: 3600000 })).flows).toEqual([]);
    expect(unemp(leaver({ birth: "1991-05", from: "2026-01", to: "2026-12", annual: 3600000 })).receipts.reduce((s, x) => s + x.days, 0)).toBe(90);
    expect(unemp(leaver({ birth: "1991-05", from: "2026-07", to: "2026-12", annual: 3600000, extra: { endsWith: "involuntary" } })).receipts.reduce((s, x) => s + x.days, 0)).toBe(90);
    expect(unemp(leaver({ birth: "1991-05", from: "2015-04", to: "2026-12", annual: 3600000, extra: { endsWith: "sickLeave" } })).flows).toEqual([]);
  });

  it("架空の見本の制度データ（失業の給付の値が無い）では計算しない", () => {
    const req = leaver({ birth: "1991-05", from: "2015-04", to: "2026-12", annual: 3600000 });
    const o = runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "benefit.unemployment", input: { member: H } } }).entryOutput as UnemploymentOutput;
    expect(o).toEqual({ flows: [], receipts: [], pensionStops: [] });
  });
});

describe("高年齢求職者給付金", () => {
  it("65歳以上で辞めたとき、受け取ると入れたときだけ、基本手当日額（60歳未満の式・30歳未満の上限）の50日分を一時金で", () => {
    const base = { birth: "1961-03", from: "2000-04", to: "2026-09", annual: 3600000 };
    expect(unemp(leaver(base)).flows).toEqual([]);
    const o = unemp(leaver({ ...base, extra: { unemploymentClaim: true } }));
    // 定年（60歳以上の省略）なので給付制限なし。待期の後の失業の認定（2026-10）の翌月
    expect(pays(o, "benefit.unemployment.elderlyJobSeeker")).toEqual([["2026-11", 50 * 6307]]);
    expect(o.pensionStops).toEqual([]);
  });

  it("64歳11か月で辞めると基本手当（150日）、65歳に達した月に辞めると高年齢求職者給付金", () => {
    const at64 = unemp(leaver({ birth: "1961-11", from: "2000-04", to: "2026-09", annual: 3600000 }));
    expect(at64.receipts.reduce((s, x) => s + x.days, 0)).toBe(150);
    const at65 = unemp(leaver({ birth: "1961-09", from: "2000-04", to: "2026-09", annual: 3600000, extra: { unemploymentClaim: true } }));
    expect(at65.receipts).toEqual([]);
    expect(pays(at65, "benefit.unemployment.elderlyJobSeeker").length).toBe(1);
  });
});

describe("高年齢雇用継続基本給付金", () => {
  const reemployed = (contractAnnual: number, birth = "1966-05") =>
    household({
      baseMonth: "2026-04",
      endYear: 2032,
      members: [member("h", "self", birth, { sex: "male" })],
      periods: [
        period("job", { member: "h", from: "2000-04", to: "2026-05", annual: 6000000 }),
        period("re", { member: "h", from: "2026-06", to: "2031-05", type: "contract", annual: contractAnnual }),
      ],
    });

  it("60歳到達時の賃金月額499,980円の64%未満（月25万円）: 給与の10%（60歳に達した日が令和7年4月以後）を、65歳に達する月まで", () => {
    const o = unemp(reemployed(3000000));
    const p = pays(o, "benefit.unemployment.elderlyContinuation");
    expect(p[0]).toEqual(["2026-07", 25000]);
    // 65歳に達する月（2031-05）の分まで（翌月に払う）
    expect(p.at(-1)).toEqual(["2031-06", 25000]);
    expect(p.length).toBe(60);
  });

  it("64%以上75%未満は75%で0円になるよう減らし、75%以上は出ない", () => {
    // 月35万円（70%）: 0.1×0.64×(374,985−350,000)/(0.75−0.64)＝14,536
    expect(pays(unemp(reemployed(4200000)), "benefit.unemployment.elderlyContinuation")[0]).toEqual(["2026-07", 14536]);
    expect(pays(unemp(reemployed(4500000)), "benefit.unemployment.elderlyContinuation")).toEqual([]);
  });

  it("年金の停止: 標準報酬月額の4%（64%未満のとき）を在職老齢年金の停止に加えて止める月を出す", () => {
    const o = unemp(reemployed(3000000));
    const stop = o.pensionStops.find((s) => s.month === "2026-06");
    expect(stop?.kind).toBe("continuation");
    // 標準報酬月額 260,000円（月25万円）×4%
    expect(stop?.amount).toBe(10400);
  });
});

describe("年金・被扶養者とのつながり", () => {
  const woman = () =>
    setH(
      household({
        baseMonth: "2026-04",
        endYear: 2031,
        members: [member("h", "self", "1965-06")],
        periods: [
          period("job", { member: "h", from: "1990-04", to: "2029-08", annual: 3600000 }),
          period("idle", { member: "h", from: "2029-09", type: "unemployed", annual: 0, healthInsurance: { kind: "national" }, pensionCategory: "none" }),
        ],
      }),
      "pensionRecords",
      [{ id: uid("rec.h"), member: H, kind: "history", asOf: "2026-03", history: [{ from: "1990-04", to: "2026-03", category: "employee", averageRemuneration: 300000 }] }],
    );

  it("基本手当を受ける間は特別支給の老齢厚生年金を止める（求職の申込みの月の翌月から、150日÷30＝5か月）。老齢基礎年金は止めない", () => {
    const req = woman();
    const o = unemp(req);
    expect(o.pensionStops.map((s) => [s.month, s.kind])).toEqual([
      ["2029-10", "basicAllowance"],
      ["2029-11", "basicAllowance"],
      ["2029-12", "basicAllowance"],
      ["2030-01", "basicAllowance"],
      ["2030-02", "basicAllowance"],
    ]);
    const pension = entry<PensionOutput>(req, "pension.oldAge", { member: H });
    const special = (ym: string) => pension.months.find((x) => x.month === ym)?.special ?? 0;
    expect(special("2029-09")).toBeGreaterThan(0);
    for (const ym of ["2029-10", "2029-11", "2029-12", "2030-01", "2030-02"]) expect(special(ym)).toBe(0);
    expect(special("2030-03")).toBe(special("2029-09"));
    // 受け取らないと入れれば止めない
    const off = woman();
    (off.input.household.employmentPeriods[0] as unknown as Record<string, unknown>).unemploymentClaim = false;
    expect(entry<PensionOutput>(off, "pension.oldAge", { member: H }).months.find((x) => x.month === "2029-11")?.special).toBe(special("2029-09"));
  });

  it("高年齢雇用継続給付の停止の月額は、年額で特別支給から引く（部品の出力を差し替えて確かめる）", () => {
    const req = woman();
    const plain = entry<PensionOutput>(req, "pension.oldAge", { member: H }, { "benefit.unemployment": () => ({ flows: [], receipts: [], pensionStops: [] }) });
    const cut = entry<PensionOutput>(req, "pension.oldAge", { member: H }, {
      "benefit.unemployment": () => ({ flows: [], receipts: [], pensionStops: [{ month: "2029-08", kind: "continuation", amount: 10000 }] }),
    });
    const at = (o: PensionOutput, ym: string) => o.months.find((x) => x.month === ym);
    expect((at(plain, "2029-08")?.special ?? 0) - (at(cut, "2029-08")?.special ?? 0)).toBe(120000);
    expect(at(cut, "2029-08")?.basic).toBe(at(plain, "2029-08")?.basic);
    expect(at(cut, "2029-07")?.special).toBe(at(plain, "2029-07")?.special);
  });

  it("基本手当日額×360が130万円以上の月は、配偶者の扶養（健康保険）・第3号にしない。待期・給付制限の月は扶養のまま", () => {
    const req = household({
      baseMonth: "2026-04",
      endYear: 2028,
      members: [member("h", "self", "1985-05", { sex: "male" }), member("w", "spouse", "1988-05")],
      relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }],
      periods: [
        period("hjob", { member: "h", from: "2008-04", annual: 6000000 }),
        period("wjob", { member: "w", from: "2012-04", to: "2026-12", annual: 3600000 }),
        idleWithoutHealth("widle", "w", "2027-01"),
      ],
    });
    // 日額 6,307円×360＝2,270,520円 ≥ 130万円。日を受けるのは 2027-02〜2027-06
    const cat = entry<CategoryOutput>(req, "pension.category", { member: W }).months;
    const c = (ym: string) => cat.find((x) => x.month === ym)?.category;
    expect(c("2027-01")).toBe("3");
    expect(c("2027-02")).toBe("1");
    expect(c("2027-06")).toBe("1");
    expect(c("2027-07")).toBe("3");
    const hs = entry<HealthStatusOutput>(req, "socialInsurance.healthStatus", { member: W }).months;
    const k = (ym: string) => hs.find((x) => x.month === ym)?.kind;
    expect(k("2027-01")).toBe("dependent");
    expect(k("2027-03")).toBe("national");
    expect(k("2027-07")).toBe("dependent");
  });

  it("給付は非課税（所得税・住民税の計算に入らない）で、表の行は雇用保険の失業の給付など（見本の世帯 jobLeaver）", () => {
    const sample = modelHousehold("jobLeaver");
    const r = run(sample);
    const mine = r.flows.filter((f) => f.formula?.startsWith("benefit.unemployment"));
    expect(mine.length).toBeGreaterThan(0);
    expect(new Set(mine.map((f) => f.row))).toEqual(new Set(["cf.income.benefit.unemployment"]));
    const off = clone(sample);
    (off.input.household.employmentPeriods[0] as unknown as Record<string, unknown>).unemploymentClaim = false;
    const tax = (x: EngineResult) => x.flows.filter((f) => f.row.startsWith("cf.taxSi.incomeTax") || f.row.startsWith("cf.taxSi.residentTax")).reduce((s, f) => s + f.amount, 0);
    expect(tax(r)).toBe(tax(run(off)));
  });
});


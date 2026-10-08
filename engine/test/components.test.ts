// 計算部品のテスト（L1）。【架空の見本】の制度データ（test/fixtures/regulation）で、規則どおりに計算するかを手計算と突き合わせる
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { CoverageOutput, DeductionsOutput, SalaryOutput } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, period, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
const call = <T>(req: Req, component: string, input: unknown): T =>
  runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const full = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true });
const flowsOf = (r: ReturnType<typeof full>, row: string, from: string, to = from) => r.flows.filter((f) => f.row === row && f.ym >= from && f.ym <= to);
const total = (xs: readonly { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const A = uid("a");

describe("給与・賞与（income.salary）", () => {
  it("年額を12か月に、賞与を支給月に分け、端数は最後の月。翌年からは賃金上昇率で伸ばす", () => {
    const req = household({
      members: [member("a", "self", "1990-01")],
      periods: [period("p", { member: "a", from: "2020-04", annual: 1200005, bonus: 300001, std: [100000, 100000] })],
      wageGrowth: "0.1",
    });
    const pays = call<SalaryOutput>(req, "income.salary", { member: A }).payments;
    const at = (ym: string) => pays.find((p) => p.ym === ym);
    expect(pays[0]?.ym).toBe("2024-01"); // 住民税のため計算基準年の2年前から
    expect(at("2026-01")?.salary).toBe(100000);
    expect(at("2026-12")?.salary).toBe(100005);
    expect(at("2026-06")?.bonus).toBe(150000);
    expect(at("2026-12")?.bonus).toBe(150001);
    // 2027年は 1,200,005×1.1＝1,320,005.5 → 円未満切り捨て
    expect(pays.filter((p) => p.ym.startsWith("2027")).reduce((s, p) => s + p.salary, 0)).toBe(1320005);
    // 計算基準年より前の年は伸ばさない
    expect(pays.filter((p) => p.ym.startsWith("2025")).reduce((s, p) => s + p.salary, 0)).toBe(1200005);
  });
});

describe("被用者保険の資格と標準報酬（socialInsurance.coverage）", () => {
  it("等級表から標準報酬月額を決める。6月以後に資格を取った年は翌年8月まで資格取得時の報酬、9月からは4〜6月の平均（定時決定）", () => {
    const req = household({
      members: [member("a", "self", "1990-01")],
      periods: [period("p", { member: "a", from: "2026-07", annual: 1800000 })],
      wageGrowth: "1",
    });
    const cov = call<CoverageOutput>(req, "socialInsurance.coverage", { member: A, fromYear: 2026 });
    const m = (ym: string) => cov.months.find((x) => x.month === ym);
    expect(m("2026-06")).toBeUndefined();
    expect(m("2026-07")?.healthStd).toBe(200000); // 報酬月額 150,000 は 2級（150,000以上250,000未満）
    expect(m("2027-08")?.healthStd).toBe(200000);
    expect(m("2027-09")?.healthStd).toBe(300000); // 2027年の4〜6月は月300,000
    expect(m("2027-09")?.pensionStd).toBe(300000);
    // 置き換え口（標準報酬月額の直接入力）があれば、それを使う
    const req2 = household({ members: [member("a", "self", "1990-01")], periods: [period("p", { member: "a", from: "2026-07", annual: 1800000, std: [980000, 600000] })] });
    expect(call<CoverageOutput>(req2, "socialInsurance.coverage", { member: A, fromYear: 2026 }).months[0]?.healthStd).toBe(980000);
  });

  it("介護保険は40歳に達した月から（1日生まれは前の月から）、厚生年金は70歳に達した月の前月まで", () => {
    const care = (first: boolean) => {
      const req = household({ members: [member("a", "self", "1986-05", { birth: { birthYearMonth: "1986-05", bornOnFirst: first } })], periods: [period("p", { member: "a", from: "2020-04", annual: 3600000, std: [300000, 300000] })] });
      return call<CoverageOutput>(req, "socialInsurance.coverage", { member: A, fromYear: 2026 }).months.filter((x) => x.care)[0]?.month;
    };
    expect(care(false)).toBe("2026-05");
    expect(care(true)).toBe("2026-04");
    const old = household({ members: [member("a", "self", "1956-08")], periods: [period("p", { member: "a", from: "2020-04", annual: 3600000, std: [300000, 300000] })] });
    const months = call<CoverageOutput>(old, "socialInsurance.coverage", { member: A, fromYear: 2026 }).months;
    expect(months.filter((x) => x.pensionStd !== null).at(-1)?.month).toBe("2026-07");
    expect(months.find((x) => x.month === "2026-09")?.healthStd).toBe(300000); // 健康保険は続く
  });

  it("月末に辞めればその月までかかり、月の途中なら前月まで。最後の月は前月分と一緒に最後の給与から控除する", () => {
    const mk = (monthEnd: boolean) =>
      call<CoverageOutput>(
        household({ members: [member("a", "self", "1990-01")], periods: [period("p", { member: "a", from: "2020-04", to: "2026-06", annual: 3600000, std: [300000, 300000], extra: { endsOnMonthEnd: monthEnd } })] }),
        "socialInsurance.coverage",
        { member: A, fromYear: 2026 },
      ).months;
    const end = mk(true);
    expect(end.at(-1)?.month).toBe("2026-06");
    expect(end.filter((x) => x.paidIn === "2026-06").map((x) => x.month)).toEqual(["2026-05", "2026-06"]);
    const mid = mk(false);
    expect(mid.at(-1)?.month).toBe("2026-05");
    expect(mid.at(-1)?.paidIn).toBe("2026-06");
  });

  it("標準賞与額は1,000円未満を切り捨て、健康保険は年度の累計、厚生年金は1回ごとに上限", () => {
    const req = household({ members: [member("a", "self", "1990-01")], periods: [period("p", { member: "a", from: "2020-04", annual: 3600000, bonus: 4001999, std: [300000, 300000] })] });
    const b = call<CoverageOutput>(req, "socialInsurance.coverage", { member: A, fromYear: 2026 }).bonuses;
    const at = (ym: string) => b.find((x) => x.month === ym);
    expect(at("2026-06")?.healthStdBonus).toBe(2000000); // 2,000,999 → 2,000,000
    expect(at("2026-12")?.healthStdBonus).toBe(1000000); // 年度の上限 3,000,000 の残り
    expect(at("2027-06")?.healthStdBonus).toBe(2000000); // 新しい年度
    expect(at("2026-06")?.pensionStdBonus).toBe(1000000);
  });

  it("パートの雇用保険は週の所定労働時間から導く（20時間以上。入力で上書きできる）。公務員は雇用保険なし", () => {
    const pt = (hours: string, extra: Record<string, unknown> = {}) =>
      household({
        members: [member("a", "self", "1990-01")],
        periods: [period("p", { member: "a", from: "2020-04", type: "partTime", annual: 1200000, pensionCategory: "none", healthInsurance: { kind: "dependent" }, extra: { employer: { size: 300, weeklyHours: hours }, ...extra } })],
      });
    // 週15時間は、2028年10月（週10時間以上に広がる）から被保険者
    const w15 = call<CoverageOutput>(pt("15"), "socialInsurance.coverage", { member: A, fromYear: 2026 }).wages;
    expect(w15.filter((w) => w.month < "2028-10")).toEqual([]);
    expect(w15.some((w) => w.month === "2028-10")).toBe(true);
    expect(call<CoverageOutput>(pt("25"), "socialInsurance.coverage", { member: A, fromYear: 2026 }).wages.length).toBeGreaterThan(0);
    expect(call<CoverageOutput>(pt("15", { employmentInsuranceCovered: true }), "socialInsurance.coverage", { member: A, fromYear: 2026 }).wages.some((w) => w.month === "2026-01")).toBe(true);
    const cs = household({ members: [member("a", "self", "1990-01")], periods: [period("p", { member: "a", from: "2020-04", type: "civilServant", annual: 4800000, std: [400000, 400000], healthInsurance: { kind: "mutualAid", employeeRate: box("0.05") } })] });
    expect(call<CoverageOutput>(cs, "socialInsurance.coverage", { member: A, fromYear: 2026 }).wages).toEqual([]);
  });
});

describe("保険料（健康保険・介護・支援金・厚生年金・雇用保険）", () => {
  const req = household({
    members: [member("a", "self", "1986-05")],
    periods: [period("p", { member: "a", from: "2020-04", annual: 3600000, std: [300000, 300000], extra: { salary: { annual: box(3600000), bonus: box(0), commutingMonthly: box(15000) }, employer: { size: 300, weeklyHours: "40", industry: "construction" } } })],
  });
  const r = full(req);

  it("健康保険料率・介護保険料率・支援金率を合算した率で折半して1回だけ丸め、介護と支援金の分を除いた残りを健康保険の行にする", () => {
    // 2026年1月分（2月に控除）: 300,000×10%÷2
    expect(total(flowsOf(r, "cf.taxSi.health", "2026-02"))).toBe(15000);
    expect(total(flowsOf(r, "cf.taxSi.childSupport", "2026-02"))).toBe(0);
    // 2026年5月分（40歳に達した月。6月に控除）: 300,000×(10%＋2%＋0.4%)÷2＝18,600。介護 3,000、支援金 600
    expect(total(flowsOf(r, "cf.taxSi.health", "2026-06")) - total(flowsOf(r, "cf.taxSi.health", "2026-06").filter((f) => f.formula.endsWith("bonus")))).toBe(15000);
    expect(flowsOf(r, "cf.taxSi.care", "2026-06").find((f) => f.formula === "socialInsurance.care.monthly")?.amount).toBe(3000);
    expect(flowsOf(r, "cf.taxSi.childSupport", "2026-06").find((f) => f.formula === "socialInsurance.childSupport.monthly")?.amount).toBe(600);
  });

  it("厚生年金は標準報酬月額×率÷2、雇用保険は通勤手当を含む賃金×事業の種類の率（支払いごとに丸める）", () => {
    expect(flowsOf(r, "cf.taxSi.pension", "2026-03")[0]?.amount).toBe(30000);
    // (300,000＋15,000)×1.3%＝4,095
    expect(flowsOf(r, "cf.taxSi.employment", "2026-03")[0]?.amount).toBe(4095);
  });

  it("健保組合は被保険者負担の率を入力で受ける", () => {
    const u = household({
      members: [member("a", "self", "1986-05")],
      periods: [period("p", { member: "a", from: "2020-04", annual: 3600000, std: [300000, 300000], healthInsurance: { kind: "union", employeeRate: box("0.045"), careEmployeeRate: box("0.009") } })],
    });
    const ru = full(u);
    expect(flowsOf(ru, "cf.taxSi.health", "2026-02")[0]?.amount).toBe(13500);
    // 支援金の率の入力が無ければ、全国一律の率の半分（300,000×0.2%＝600）
    expect(flowsOf(ru, "cf.taxSi.childSupport", "2026-06")[0]?.amount).toBe(600);
    expect(flowsOf(ru, "cf.taxSi.care", "2026-06")[0]?.amount).toBe(2700);
  });

  it("自営の期間は国民健康保険・国民年金の保険料がかかり、被用者保険はかからない", () => {
    const se = household({
      members: [member("a", "self", "1986-05")],
      periods: [{ id: uid("p"), member: uid("a"), from: { at: "2020-04" }, to: null, type: "selfEmployed", business: { income: box(3000000) } }],
    });
    const r = full(se);
    const rows = new Set(r.flows.map((f) => f.row));
    expect(rows.has("cf.taxSi.health")).toBe(true);
    expect(rows.has("cf.taxSi.pension")).toBe(true);
    expect(rows.has("cf.income.business")).toBe(true);
    expect(r.flows.some((f) => f.formula.startsWith("socialInsurance.health."))).toBe(false);
  });
});

describe("所得税・住民税（手計算との突き合わせ）", () => {
  const req = household({ members: [member("a", "self", "1990-01")], periods: [period("p", { member: "a", from: "2020-04", annual: 4800000, std: [400000, 400000] })] });
  const r = full(req);

  it("所得税: 給与所得 3,520,000 − 所得控除 1,274,400 → 課税所得 2,245,000 → 249,000 ＋ 2% → 253,900（100円未満切り捨て）", () => {
    // 社会保険料控除: 健康保険 20,000×12、支援金 800×8、厚生年金 40,000×12、雇用保険 4,000×12
    const ded = call<DeductionsOutput>(req, "tax.deductions", { member: A, year: 2026, regime: "incomeTax" });
    expect(ded.socialInsurance).toBe(774400);
    expect(ded.basic).toBe(500000);
    expect(total(flowsOf(r, "cf.taxSi.incomeTax", "2026-01", "2026-12"))).toBe(253900);
  });

  it("住民税: 課税総所得 2,345,000、調整控除 2,500（5万円×5%）、所得割 市139,200・県92,800、均等割・森林環境税 5,000 → 6月〜翌5月の12回（100円未満の端数は6月）", () => {
    const fy2027 = r.flows.filter((f) => f.row === "cf.taxSi.residentTax" && f.accrualYear === 2026);
    expect(fy2027.map((f) => f.ym)).toEqual(["2027-06", "2027-07", "2027-08", "2027-09", "2027-10", "2027-11", "2027-12", "2028-01", "2028-02", "2028-03", "2028-04", "2028-05"]);
    // 237,000÷12＝19,750。地方税法20条の4の2第6項: 特別徴収の分割金額の100円未満の端数（50円×12＝600円）は最初の納期（6月）の分に合わせる
    expect(fy2027.map((f) => f.amount)).toEqual([20300, ...Array.from({ length: 11 }, () => 19700)]);
  });

  it("dataSet で古い版（2026.1.0）を選ぶと、版 2026.2.0 で足した2027年分の基礎控除の行を使わない", () => {
    const old = { ...req, input: { ...req.input, dataSet: { "regulation.testTax": "2026.1.0" } } } as Req;
    expect(call<DeductionsOutput>(old, "tax.deductions", { member: A, year: 2027, regime: "incomeTax" }).basic).toBe(500000);
    expect(call<DeductionsOutput>(req, "tax.deductions", { member: A, year: 2027, regime: "incomeTax" }).basic).toBe(600000);
  });
});

describe("所得控除（tax.deductions）", () => {
  const fam = (extra: { spouseSalary?: number; d?: number; parent?: boolean } = {}) =>
    household({
      members: [
        member("a", "self", "1980-01"),
        member("b", "spouse", "1982-01"),
        member("c", "child", "2009-03"),
        member("d", "child", "2006-05"),
        member("e", "child", "2012-02"),
        member("f", "child", "2010-12"),
        member("g", "child", "2011-01", { birth: { birthYearMonth: "2011-01", bornOnFirst: true } }),
        member("h", "child", "2011-01"),
        ...(extra.parent ? [member("p", "parent", "1950-04", { support: { dependent: true, cohabiting: true } })] : []),
      ],
      relations: [{ type: "spouse", a: uid("a"), b: uid("b"), marriage: "legal", from: null, to: null }],
      periods: [
        period("pa", { member: "a", from: "2000-04", annual: 6000000, std: [500000, 500000] }),
        ...(extra.spouseSalary ? [period("pb", { member: "b", from: "2000-04", type: "partTime", annual: extra.spouseSalary, pensionCategory: "none", healthInsurance: { kind: "dependent" }, extra: { employmentInsuranceCovered: false } })] : []),
        ...(extra.d ? [period("pd", { member: "d", from: "2025-04", type: "partTime", annual: extra.d, pensionCategory: "none", healthInsurance: { kind: "dependent" }, extra: { employmentInsuranceCovered: false } })] : []),
      ],
    });
  const ded = (req: Req, who = "a") => call<DeductionsOutput>(req, "tax.deductions", { member: uid(who), year: 2026, regime: "incomeTax" });

  it("配偶者控除: 配偶者の合計所得金額が上限以下（給与100万円→所得40万円）なら、本人の所得の段の額", () => {
    expect(ded(fam({ spouseSalary: 1000000 })).spouse).toBe(400000);
    // 所得の少ない側は配偶者控除を受けない
    expect(ded(fam({ spouseSalary: 1000000 }), "b").spouse).toBe(0);
  });

  it("配偶者特別控除: 給与150万円→所得90万円は、本人900万円以下の表の100万円以下の段", () => {
    const d = ded(fam({ spouseSalary: 1500000 }));
    expect(d.spouse).toBe(0);
    expect(d.spouseSpecial).toBe(400000);
  });

  it("扶養控除はその年の12月31日の年齢で判定する（16歳・19〜22歳・1月1日生まれ）", () => {
    // c 17歳: 一般、d 20歳: 特定、e 14歳: なし、f 2010年12月生まれ: 16歳、g 2011年1月1日生まれ: 16歳、h 2011年1月2日以後生まれ: 15歳
    expect(ded(fam()).dependents).toBe(400000 + 600000 + 400000 + 400000);
    expect(ded(fam(), "b").dependents).toBe(0); // 所得の多い側だけが受ける
  });

  it("特定親族特別控除: 19〜22歳で所得が上限を超えた親族（給与160万円→所得100万円）", () => {
    const d = ded(fam({ d: 1600000 }));
    expect(d.specifiedRelative).toBe(300000);
    expect(d.dependents).toBe(400000 + 400000 + 400000);
  });

  it("同居老親等の扶養控除", () => {
    expect(ded(fam({ parent: true })).dependents).toBe(400000 + 600000 + 400000 + 400000 + 550000);
  });

  it("生命保険料控除（新旧の併用・23歳未満の扶養親族の特例・1円未満切り上げ）・地震保険料控除・iDeCo の掛金", () => {
    const contract = (name: string, cat: string, regime: string | null, amount: number) => ({
      id: uid(name), template: "insurance.wholeLife", policyholder: A, insured: A, contractDate: "2015-06", currency: "JPY",
      premium: { amount, frequency: "annual", payUntil: null }, deductionCategory: { type: cat, ...(regime ? { regime } : {}) },
    });
    const base = (contracts: Record<string, unknown>[], members = [member("a", "self", "1980-01")]) =>
      household({
        members, periods: [period("pa", { member: "a", from: "2000-04", annual: 6000000, std: [500000, 500000] })], insuranceContracts: contracts,
        accounts: [{ id: uid("i"), kind: "ideco", owner: A, marketValue: box(0), asOf: "2026-01", contributions: [{ from: { at: "2020-01" }, to: null, monthly: 10000 }] }],
      });
    const d1 = ded(base([contract("n", "general", "new", 40000), contract("o", "general", "old", 30000), contract("q", "earthquake", null, 50000), contract("l", "longTermNonLife", null, 15000)]));
    expect(d1.lifeInsurance).toBe(30000); // 新 25,000＋旧 25,000 は上限 30,000、旧だけ 25,000 より大きい
    expect(d1.earthquake).toBe(45000);
    expect(d1.smallBusiness).toBe(120000);
    expect(ded(base([contract("n", "careMedical", "new", 15001)])).lifeInsurance).toBe(12501); // 15,001×1/2＋5,000＝12,500.5 → 切り上げ
    const withChild = base([contract("n", "general", "new", 40000), contract("o", "general", "old", 30000)], [member("a", "self", "1980-01"), member("k", "child", "2015-01")]);
    expect(ded(withChild).lifeInsurance).toBe(50000); // 特例の表で新 50,000、併用の上限 50,000
  });
});

describe("住民税の徴収", () => {
  const mk = (to: string | null, assessments?: Record<string, unknown>[]) =>
    full(household({
      baseMonth: "2026-01",
      endYear: 2028,
      members: [member("a", "self", "1990-01")],
      periods: [period("p", { member: "a", from: "2020-04", to, annual: 4800000, std: [400000, 400000] })],
      ...(assessments ? { residentTaxAssessments: assessments } : {}),
    }));
  it("給与を受けている間は特別徴収、辞めた後の残りは最後の給与の月にまとめる", () => {
    const r = mk("2027-09");
    const fy = r.flows.filter((f) => f.row === "cf.taxSi.residentTax" && f.accrualYear === 2026);
    expect(fy.map((f) => f.ym)).toEqual(["2027-06", "2027-07", "2027-08", "2027-09", "2027-09"]);
    expect(fy.at(-1)?.formula).toBe("residentTax.special.lumpSum");
    expect(total(fy)).toBe(237000);
  });
  it("年度の6月に給与が無ければ普通徴収（6・8・10月・翌年1月）", () => {
    const r = mk("2027-05");
    const fy = r.flows.filter((f) => f.row === "cf.taxSi.residentTax" && f.accrualYear === 2026);
    expect(fy.map((f) => f.ym)).toEqual(["2027-06", "2027-08", "2027-10", "2028-01"]);
    expect(fy.every((f) => f.formula === "residentTax.ordinary.installment")).toBe(true);
  });
  it("置き換え口: 決定通知書の年税額があれば、その年度はその額を使う", () => {
    const r = mk(null, [{ id: uid("r"), member: A, fiscalYear: 2026, amount: box(120000) }]);
    const fy = r.flows.filter((f) => f.row === "cf.taxSi.residentTax" && f.accrualYear === 2025);
    expect(fy).toHaveLength(12);
    expect(fy.every((f) => f.amount === 10000)).toBe(true);
  });
});

describe("住民税の分割金額の端数（地方税法20条の4の2第6項）", () => {
  it("普通徴収は1,000円未満、特別徴収は100円未満の端数を最初の納期の分に合わせる（全額が単位未満なら全額を最初の納期に）", () => {
    const r = runEngine(
      household({ baseMonth: "2026-01", endYear: 2027, members: [member("a", "self", "1980-01")], residentTaxAssessments: [
        { id: uid("rta.o"), member: uid("a"), fiscalYear: 2026, amount: box(123456), collection: "ordinary" },
        { id: uid("rta.s"), member: uid("a"), fiscalYear: 2027, amount: box(850), collection: "ordinary" },
      ] }),
      fictionalPacks(),
      { checkInternal: true },
    );
    const of = (fy: number) => r.flows.filter((f) => f.row === "cf.taxSi.residentTax" && f.accrualYear === fy - 1).map((f) => [f.ym, f.amount]);
    // 123,456÷4＝30,864 → 1,000円未満を切り捨てた30,000円ずつ、端数3,456円は6月へ
    expect(of(2026)).toEqual([["2026-06", 33456], ["2026-08", 30000], ["2026-10", 30000], ["2027-01", 30000]]);
    // 全額が1,000円未満なら全額を最初の納期に
    expect(of(2027)).toEqual([["2027-06", 850]]);
  });
});

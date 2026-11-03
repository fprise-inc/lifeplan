// 働き方の期間・公的年金・国民年金・国民健康保険・後期高齢者医療・介護保険（第1号）・休業の給付・年金の税（【架空の見本】の制度データで手計算と突き合わせる L1）
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { CategoryOutput, HealthStatusOutput, PensionOutput, RevisionOutput } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, modelHousehold, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
const H = uid("h");
const W = uid("w");
const run = (req: Req, packs = fictionalPacks()) => runEngine(req, packs, { checkInternal: true });
const entry = <T>(req: Req, component: string, input: unknown, stubs?: Record<string, (i: unknown) => unknown>, packs = fictionalPacks()) =>
  runEngine(req, packs, { checkInternal: true, entry: { component, input }, ...(stubs ? { stubs } : {}) }).entryOutput as T;
const setH = (req: Req, key: string, value: unknown) => {
  (req.input.household as unknown as Record<string, unknown>)[key] = value;
  return req;
};
const setA = (req: Req, a: Record<string, unknown>) => {
  Object.assign(req.input.assumptions as unknown as Record<string, unknown>, a);
  return req;
};
const spouse = { type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null };
const flowsOf = (r: EngineResult, pred: (f: EngineResult["flows"][number]) => boolean) => r.flows.filter(pred);
const monthOf = (o: PensionOutput, ym: string) => o.months.find((x) => x.month === ym);
const rec = (who: string, kind: string, extra: Record<string, unknown>) => ({ id: uid(`rec.${who}`), member: uid(who), kind, ...extra });
const notices = (r: EngineResult) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;

describe("延長の仮定（決定1）", () => {
  it("期限の後の値が分からない制度は最後の値が続くとみなし、見出しの notices に値の行と年を出す", () => {
    const req = household({
      baseMonth: "2026-10",
      endYear: 2030,
      members: [member("h", "self", "1980-01")],
      periods: [period("p", { member: "h", from: "2010-04", annual: 6000000, std: [500000, 500000] })],
      residentTaxAssessments: [{ id: uid("rta"), member: H, fiscalYear: 2026, amount: box(300000) }],
    });
    // 最新の版は令和10年分以後の給与所得控除（rev 3）を知っているので延長しない。rev 3 を知らない版 2026.2.0 の時点で延長の仮定を確かめる
    expect(notices(run(req, realPacks())).some((n) => n.code === "N_PARAM_EXTENDED")).toBe(false);
    const r = run({ ...req, input: { ...req.input, dataSet: { "regulation.tax": "2026.2.0" } } } as typeof req, realPacks());
    expect(notices(r)).toContainEqual({ code: "N_PARAM_EXTENDED", ids: ["incomeTax.employmentIncomeDeduction@2", "2028", "2030"] });
    expect(r.flows.some((f) => f.row === "cf.taxSi.incomeTax" && f.ym.startsWith("2030"))).toBe(true);
  });
});

describe("被保険者の種別と適用拡大（決定2）", () => {
  const partTime = (extra: Record<string, unknown> = {}) =>
    household({
      baseMonth: "2027-01",
      endYear: 2028,
      members: [member("h", "self", "1985-01", { sex: "male" }), member("w", "spouse", "1988-06")],
      relations: [spouse],
      periods: [
        period("ph", { member: "h", from: "2010-04", annual: 6000000, std: [500000, 500000] }),
        period("pw", { member: "w", from: "2024-04", type: "partTime", annual: 1200000, extra: { employer: { size: 40, weeklyHours: "25" }, ...extra } }),
      ],
    });
  it("規模40人の勤め先の週25時間のパートは、2027年9月まで第3号・家族の扶養、10月（36人以上）から第2号・勤め先の健康保険", () => {
    const req = partTime();
    const cat = entry<CategoryOutput>(req, "pension.category", { member: W }).months;
    expect(cat.find((m) => m.month === "2027-09")?.category).toBe("3");
    expect(cat.find((m) => m.month === "2027-10")?.category).toBe("2");
    const hs = entry<HealthStatusOutput>(req, "socialInsurance.healthStatus", { member: W }).months;
    expect(hs.find((m) => m.month === "2027-09")).toEqual({ month: "2027-09", kind: "dependent", supporter: H });
    expect(hs.find((m) => m.month === "2027-10")?.kind).toBe("kyokaikenpo");
  });
  it("導いた結果は期間の employeeInsurance で上書きできる", () => {
    const req = partTime({ employeeInsurance: { ...box(true), origin: { kind: "override" } } });
    expect(entry<CategoryOutput>(req, "pension.category", { member: W }).months.find((m) => m.month === "2027-01")?.category).toBe("2");
  });
  it("学生は短時間労働者の要件では入らない（4分の3の基準では入る）", () => {
    expect(entry<CategoryOutput>(partTime({ student: true }), "pension.category", { member: W }).months.find((m) => m.month === "2028-01")?.category).toBe("3");
    const full = partTime({ student: true, employer: { size: 40, weeklyHours: "32" } });
    expect(entry<CategoryOutput>(full, "pension.category", { member: W }).months.find((m) => m.month === "2027-01")?.category).toBe("2");
  });
  describe("健康保険の扶養の判定（収入がある者についての被扶養者の認定）", () => {
    const C = uid("c");
    const P = uid("p");
    const kind = (req: Req, who: string, ym: string, stubs?: Record<string, (i: unknown) => unknown>) =>
      entry<HealthStatusOutput>(req, "socialInsurance.healthStatus", { member: who }, stubs, realPacks()).months.find((m) => m.month === ym);
    // 偶数月に年額の6分の1ずつ払う年金（stubs 用）
    const yearly = (amount: number) => Array.from({ length: 6 }, (_, k) => 2026 + k).flatMap((y) => [2, 4, 6, 8, 10, 12].map((mo) => ({ ym: `${y}-${String(mo).padStart(2, "0")}`, amount: Math.floor(amount / 6), accrualYear: y })));
    const pensionStub = (who: string, amount: number) => (i: unknown) =>
      (i as { member: string }).member === who ? { flows: [], months: [], payments: yearly(amount).map((x) => ({ ...x, part: "basic" })) } : { flows: [], months: [], payments: [] };
    it("扶養する人は本人・配偶者に限らない（勤める子の扶養に入る60歳以上の親）。同居なら子の収入の2分の1の未満のときだけ", () => {
      const req = (childAnnual: number) =>
        household({
          baseMonth: "2027-01",
          endYear: 2028,
          members: [member("h", "self", "1965-03", { sex: "male" }), member("c", "child", "1998-05")],
          periods: [
            { id: uid("ph"), member: H, from: { at: "1990-04" }, to: null, type: "unemployed" },
            period("pc", { member: "c", from: "2021-04", annual: childAnnual, std: [Math.floor(childAnnual / 12), Math.floor(childAnnual / 12)] }),
          ],
        });
      const stubs = { "pension.oldAge": pensionStub(H, 1500000) };
      // 年金 150万円 ＜ 180万円（60歳以上）、150万円 ×2 ＜ 子の年収 400万円 → 子の扶養
      expect(kind(req(4000000), H, "2027-06", stubs)).toEqual({ month: "2027-06", kind: "dependent", supporter: C });
      // 子の年収 250万円の2分の1 ≦ 150万円 → 国民健康保険
      expect(kind(req(2500000), H, "2027-06", stubs)?.kind).toBe("national");
    });
    it("収入の見込みに遺族年金・障害年金を入れる。障害年金を受ける人は180万円の基準", () => {
      const req = household({
        baseMonth: "2027-01",
        endYear: 2028,
        members: [member("h", "self", "1975-03", { sex: "male" }), member("p", "parent", "1955-02", { support: { dependent: true, cohabiting: true } })],
        periods: [period("ph", { member: "h", from: "1998-04", annual: 8000000, std: [650000, 650000] })],
      });
      const survivor = (amount: number) => (i: unknown) => ((i as { member: string }).member === P ? { flows: yearly(amount).map((x) => ({ ...x, row: "cf.income.pension.survivor", member: P, formula: "pension.survivor.payment" })), months: [], deceased: null, death: null, lumpSum: 0 } : { flows: [], months: [], deceased: null, death: null, lumpSum: 0 });
      // 老齢年金 70万円＋遺族年金 150万円 ≧ 180万円 → 国民健康保険（遺族年金を入れなければ扶養になっていた）
      expect(kind(req, P, "2027-06", { "pension.oldAge": pensionStub(P, 700000), "pension.survivor": survivor(1500000) })?.kind).toBe("national");
      expect(kind(req, P, "2027-06", { "pension.oldAge": pensionStub(P, 700000), "pension.survivor": survivor(1000000) })?.kind).toBe("dependent");
      // 59歳の配偶者の障害年金 150万円: 130万円以上だが、障害年金を受ける人の基準 180万円の未満 → 扶養
      const couple = household({
        baseMonth: "2027-01",
        endYear: 2028,
        members: [member("h", "self", "1968-03", { sex: "male" }), member("w", "spouse", "1968-06")],
        relations: [spouse],
        periods: [period("ph", { member: "h", from: "1990-04", annual: 8000000, std: [650000, 650000] })],
      });
      const disability = (i: unknown) => ((i as { member: string }).member === W ? { flows: yearly(1500000).map((x) => ({ ...x, row: "cf.income.pension.disability", member: W, formula: "pension.disability.payment" })), months: [], choices: [] } : { flows: [], months: [], choices: [] });
      expect(kind(couple, W, "2027-06", { "pension.disability": disability })?.kind).toBe("dependent");
      expect(kind(couple, W, "2027-06", { "pension.oldAge": pensionStub(W, 1500000) })?.kind).toBe("national");
    });
    it("親・祖父母は扶養していると入れたときだけ。別居なら仕送りの額の未満。19〜22歳の150万円の基準は配偶者に使わない", () => {
      const req = (support?: Record<string, unknown>) =>
        household({
          baseMonth: "2027-01",
          endYear: 2028,
          members: [member("h", "self", "1975-03", { sex: "male" }), member("p", "parent", "1955-02", support === undefined ? {} : { support })],
          periods: [period("ph", { member: "h", from: "1998-04", annual: 8000000, std: [650000, 650000] })],
        });
      const stubs = { "pension.oldAge": pensionStub(P, 1000000) };
      expect(kind(req(), P, "2027-06", stubs)?.kind).toBe("national");
      expect(kind(req({ dependent: true, cohabiting: true }), P, "2027-06", stubs)?.kind).toBe("dependent");
      // 別居: 年金 100万円 ≧ 仕送り 月5万円×12 → 国民健康保険。仕送り 月10万円なら扶養
      expect(kind(req({ dependent: true, cohabiting: false, allowance: 50000 }), P, "2027-06", stubs)?.kind).toBe("national");
      expect(kind(req({ dependent: true, cohabiting: false, allowance: 100000 }), P, "2027-06", stubs)?.kind).toBe("dependent");
      // 20歳の配偶者の収入 140万円: 配偶者は130万円の基準 → 国民健康保険。20歳の子なら150万円の基準 → 扶養
      const young = household({
        baseMonth: "2027-01",
        endYear: 2028,
        members: [member("h", "self", "1985-03", { sex: "male" }), member("w", "spouse", "2007-02"), member("c", "child", "2007-02")],
        relations: [spouse],
        periods: [
          period("ph", { member: "h", from: "2005-04", annual: 8000000, std: [650000, 650000] }),
          ...["w", "c"].map((who) => period(`p${who}`, { member: who, from: "2026-04", type: "partTime", annual: 1400000, pensionCategory: "none", extra: { employer: { size: 10, weeklyHours: "20" }, employmentInsuranceCovered: false } })),
        ],
      });
      expect(kind(young, W, "2027-06")?.kind).toBe("national");
      expect(kind(young, C, "2027-06")?.kind).toBe("dependent");
    });
  });

  it("夫が退職すると、60歳未満の妻は第3号でなくなり第1号の国民年金保険料（翌月払い）がかかる", () => {
    const req = household({
      baseMonth: "2027-01",
      endYear: 2028,
      members: [member("h", "self", "1967-06", { sex: "male" }), member("w", "spouse", "1970-02")],
      relations: [spouse],
      periods: [period("ph", { member: "h", from: "1990-04", to: "2027-06", annual: 6000000, std: [500000, 500000] })],
    });
    const cat = entry<CategoryOutput>(req, "pension.category", { member: W }).months;
    expect(cat.find((m) => m.month === "2027-06")?.category).toBe("3");
    expect(cat.find((m) => m.month === "2027-07")?.category).toBe("1");
    const np = flowsOf(run(req), (f) => f.formula === "socialInsurance.nationalPension.monthly" && f.member === W);
    // 2027年7月分は8月に払う。令和9年度は架空の値で18,000円
    expect(np[0]).toMatchObject({ ym: "2027-08", amount: 18000, accrualYear: 2027 });
    // 夫は国民健康保険、妻も扶養がなくなり国民健康保険
    const hs = entry<HealthStatusOutput>(req, "socialInsurance.healthStatus", { member: W }).months;
    expect(hs.find((m) => m.month === "2027-07")?.kind).toBe("national");
  });
});

describe("公的年金", () => {
  it("加入歴から老齢基礎年金を計算し、偶数月に前2か月分を払う（1円未満の切り捨ての合計は2月の支払いに足す）", () => {
    // 満額 800,000×1.06＝848,000（100円単位）。480月
    const req = setH(household({ baseMonth: "2026-04", endYear: 2027, members: [member("h", "self", "1961-05", { sex: "male" })] }), "pensionRecords", [
      rec("h", "history", { asOf: "2021-04", history: [{ from: "1981-05", to: "2021-04", category: "national1" }] }),
    ]);
    const o = entry<PensionOutput>(req, "pension.oldAge", { member: H });
    expect(monthOf(o, "2026-06")?.basic).toBe(848000);
    expect(monthOf(o, "2026-05")).toBeUndefined();
    const basic = o.payments.filter((p) => p.part === "basic").map((p) => [p.ym, p.amount]);
    expect(basic.slice(0, 4)).toEqual([["2026-08", 141333], ["2026-10", 141333], ["2026-12", 141333], ["2027-02", 141334]]);
  });

  it("繰上げ（減額率 0.4%/月）は基礎と厚生を同時に、繰下げ（増額率 0.7%/月）は別々に", () => {
    const plan = (claim: Record<string, unknown>) =>
      setH(household({ baseMonth: "2026-04", endYear: 2032, members: [member("h", "self", "1961-05", { sex: "male" })] }), "pensionRecords", [
        rec("h", "projection", { asOf: "2026-04", amounts: { basic: box(800000), employee: box(1000000) }, claim }),
      ]);
    // 厚生だけを繰り上げる入力: 繰上げは同時に請求する決まり（国民年金法附則9条の2第2項）なので、基礎も同じ月から
    const early = entry<PensionOutput>(plan({ basic: { at: "2031-06" }, employee: { at: "2024-06" } }), "pension.oldAge", { member: H });
    expect(monthOf(early, "2026-06")?.employee).toBe(904000); // 24か月の繰上げ: 1−0.096
    expect(monthOf(early, "2026-06")?.basic).toBe(723200);
    // 基礎だけを繰り下げる
    const late = entry<PensionOutput>(plan({ basic: { at: "2031-06" } }), "pension.oldAge", { member: H });
    expect(monthOf(late, "2026-06")?.employee).toBe(1000000);
    expect(monthOf(late, "2026-06")?.basic).toBe(0);
    expect(monthOf(late, "2031-06")?.basic).toBe(1136000); // 60か月の繰下げ: 1.42
  });

  it("在職老齢年金: 基本月額20万円＋標準報酬40万円が調整額50万円を超える分の半分（月5万円）を止める", () => {
    const req = setH(
      household({
        baseMonth: "2026-04",
        endYear: 2027,
        members: [member("h", "self", "1959-05", { sex: "male" })],
        periods: [period("p", { member: "h", from: "1990-04", annual: 4800000, std: [400000, 400000] })],
      }),
      "pensionRecords",
      [rec("h", "projection", { asOf: "2026-04", amounts: { basic: box(800000), employee: box(2400000) } })],
    );
    const m = monthOf(entry<PensionOutput>(req, "pension.oldAge", { member: H }), "2026-06");
    expect(m).toMatchObject({ employee: 1800000, suspended: 600000, basic: 800000 });
  });

  it("加給年金（配偶者が65歳になるまで）と振替加算（配偶者の生年月日の率）", () => {
    const req = setH(
      household({ baseMonth: "2026-04", endYear: 2029, members: [member("h", "self", "1961-05", { sex: "male" }), member("w", "spouse", "1963-08")], relations: [spouse] }),
      "pensionRecords",
      [rec("h", "projection", { asOf: "2026-04", months: { basic: 480, employee: 300 }, amounts: { basic: box(800000), employee: box(1000000) } })],
    );
    const h = entry<PensionOutput>(req, "pension.oldAge", { member: H });
    // 加給: 200,000×1.06＋100,000×1.06（特別加算）＝318,000
    expect(monthOf(h, "2026-06")?.employee).toBe(1318000);
    expect(monthOf(h, "2028-08")?.employee).toBe(1318000);
    expect(monthOf(h, "2028-09")?.employee).toBe(1000000);
    const w = entry<PensionOutput>(req, "pension.oldAge", { member: W });
    // 妻: 加入の記録が無いので働き方の期間から推計（20〜59歳の480月を第1号とみなす）。振替加算 200,000×1.06×0.1＝21,200
    expect(monthOf(w, "2028-09")?.basic).toBe(848000 + 21200);
    expect(notices(run(req))).toContainEqual({ code: "N_ESTIMATED", ids: ["pension.record", "pensionRecord", W] });
  });

  it("特別支給の老齢厚生年金（報酬比例）と、65歳からの経過的加算", () => {
    const req = setH(
      household({ baseMonth: "2026-04", endYear: 2030, members: [member("w", "self", "1964-06")] }),
      "pensionRecords",
      [{ id: uid("rec.w"), member: W, kind: "history", asOf: "2026-03", history: [{ from: "1987-04", to: "2026-03", category: "employee", averageRemuneration: 300000 }] }],
    );
    const o = entry<PensionOutput>(req, "pension.oldAge", { member: W });
    // 300,000×(0.007×192＋0.005×276)＝817,200（2025年度の水準）。報酬比例の系列の比 1.0605/1.05＝1.01 → 825,372
    expect(monthOf(o, "2028-06")).toBeUndefined();
    expect(monthOf(o, "2028-07")?.special).toBe(825372);
    expect(monthOf(o, "2029-06")?.special).toBe(825372);
    // 65歳から: 報酬比例＋経過的加算（1,696×468−848,000×446/480＝793,728−787,933＝5,795）
    expect(monthOf(o, "2029-07")).toMatchObject({ special: 0, employee: 825372 + 5795 });
  });

  it("改定率は前提（物価・賃金・マクロ経済スライド）で延ばし、名目で下がらず、引き切れない調整は繰り越す", () => {
    const req = setA(household({ baseMonth: "2026-04", endYear: 2029, members: [member("h", "self", "1975-01")] }), {
      inflation: { default: "0.02" },
      wageGrowth: { default: "0.01", byYear: { "2027": "-0.01" } },
      pensionMacroSlide: { default: "0.004" },
    });
    const rv = entry<RevisionOutput>(req, "pension.revision", { member: H }).byFiscalYear;
    const at = (fy: number) => rv.find((x) => x.fiscalYear === fy);
    expect(at(2026)).toMatchObject({ rate: "1.06", projected: false });
    expect(at(2027)?.rate).toBe("1.06636"); // 1.06×(1＋0.01−0.004)
    expect(at(2028)?.rate).toBe("1.0556964"); // 賃金−1%: 0.99、調整0.4%は繰り越す
    expect(at(2029)?.rate).toBe("1.0578077928"); // 1%−(0.4%＋0.4%)＝0.2%（四捨五入で小数12桁）
    expect(notices(run(req)).some((n) => n.code === "N_PARAM_PROJECTED")).toBe(true);
  });
});

describe("年金の税（決定4・6）", () => {
  it("公的年金等控除（65歳以上・1,000万円以下の列）と所得金額調整控除で合計所得金額を出す", () => {
    const req = household({ baseMonth: "2026-04", endYear: 2027, members: [member("h", "self", "1958-01")] });
    const stubs = {
      "pension.oldAge": () => ({ flows: [], months: [], payments: [{ ym: "2026-02", part: "basic", amount: 2000000, accrualYear: 2025 }] }),
      "tax.employmentIncome": () => ({ revenue: 3000000, deduction: 1000000, income: 2000000 }),
    };
    const t = entry<{ total: number; employment: number; publicPension: number; adjustment: number }>(req, "tax.totalIncome", { member: H, year: 2026 }, stubs);
    // 年金 2,000,000−1,100,000＝900,000。調整控除 10万＋10万−10万＝10万
    expect(t).toMatchObject({ publicPension: 900000, adjustment: 100000, employment: 1900000, total: 2800000 });
  });

  it("年の途中で辞めた年は、12か月分に換算した源泉徴収とみなし、翌年3月に確定申告で精算（還付）する", () => {
    const req = household({ baseMonth: "2026-04", endYear: 2028, members: [member("h", "self", "1975-01")], periods: [period("p", { member: "h", from: "2000-04", to: "2027-03", annual: 6000000, std: [500000, 500000] })] });
    const r = run(req);
    const it2027 = flowsOf(r, (f) => f.row === "cf.taxSi.incomeTax" && f.accrualYear === 2027);
    expect(it2027.filter((f) => f.formula === "incomeTax.annual.withholding").map((f) => f.ym)).toEqual(["2027-01", "2027-02", "2027-03"]);
    const settle = it2027.find((f) => f.formula === "incomeTax.annual.settlement");
    expect(settle?.ym).toBe("2028-03");
    expect(settle?.amount).toBeLessThan(0);
    expect(it2027.reduce((s, f) => s + f.amount, 0)).toBe(0); // 給与3か月分なら所得税はかからない（架空の控除）
  });

  it("住民税の年金からの特別徴収: 前の年度から続くときは 4・6・8月に前の年度の6分の1、10・12・2月に残り", () => {
    const req = household({ baseMonth: "2026-04", endYear: 2027, members: [member("h", "self", "1955-01")] });
    const stubs = {
      "tax.totalIncome": () => ({ total: 2000000, employment: 0, publicPension: 2000000 }),
      "tax.deductions": () => ({ basic: 0, spouse: 0, spouseSpecial: 0, dependents: 0, specifiedRelative: 0, socialInsurance: 0, lifeInsurance: 0, earthquake: 0, smallBusiness: 0, total: 1000000, personalDiff: 0 }),
      "pension.oldAge": () => ({ flows: [], months: [], payments: ["2025-04", "2025-06", "2025-08", "2025-10", "2025-12", "2026-02", "2026-04", "2026-06", "2026-08", "2026-10", "2026-12", "2027-02"].map((ym) => ({ ym, part: "basic", amount: 300000, accrualYear: 2026 })) }),
    };
    const out = entry<{ flows: { ym: string; amount: number; formula: string }[]; total: number }>(req, "residentTax.annual", { member: H, fiscalYear: 2026 }, stubs);
    expect(out.flows.map((f) => f.ym)).toEqual(["2026-04", "2026-06", "2026-08", "2026-10", "2026-12", "2027-02"]);
    expect(out.flows.reduce((s, f) => s + f.amount, 0)).toBe(out.total);
    expect(out.flows[0]?.formula).toBe("residentTax.pension.provisional");
  });
});

describe("国民健康保険・後期高齢者医療・介護保険（第1号）（決定3）", () => {
  it("国民健康保険: 区分ごとに所得割＋均等割＋平等割（既定の料率）を10回の納期に分ける", () => {
    const req = household({
      baseMonth: "2026-04",
      endYear: 2027,
      members: [member("h", "self", "1981-01")],
      periods: [{ id: uid("p"), member: H, from: { at: "2010-04" }, to: null, type: "selfEmployed", business: { income: box(3000000) } }],
    });
    const stubs = {
      "tax.totalIncome": () => ({ total: 3000000, employment: 0, publicPension: 0, other: 3000000 }),
      "tax.publicPensionIncome": () => ({ revenue: 0, deduction: 0, income: 0 }),
    };
    const f = entry<{ flows: { row: string; formula: string; amount: number; ym: string }[] }>(req, "socialInsurance.nationalHealth", { fiscalYear: 2026 }, stubs).flows;
    const sum = (formula: string) => f.filter((x) => x.formula === formula).reduce((s, x) => s + x.amount, 0);
    // 基礎（所得）2,570,000。医療 205,600＋40,000＋30,000、支援金 77,100＋12,000＋10,000、介護 51,400＋15,000＋6,000、子ども 7,710＋1,200＋800
    expect(sum("socialInsurance.nationalHealth.medical")).toBe(275600);
    expect(sum("socialInsurance.nationalHealth.elderlySupport")).toBe(99100);
    expect(sum("socialInsurance.nationalHealth.care")).toBe(72400);
    expect(sum("socialInsurance.nationalHealth.childSupport")).toBe(9710);
    expect([...new Set(f.map((x) => x.ym))]).toHaveLength(10);
  });

  it("国民健康保険は世帯の入力（決定通知書の年額）で上書きでき、料率の入力も使える。既定が無ければ知らせる", () => {
    const base = () =>
      household({
        baseMonth: "2026-06",
        endYear: 2027,
        members: [member("h", "self", "1981-01")],
        periods: [{ id: uid("p"), member: H, from: { at: "2010-04" }, to: null, type: "selfEmployed", business: { income: box(3000000) } }],
        // 令和8年度の住民税は前年の所得から計算するので、令和6年度の保険料の値が要る。決定通知書の額で入れる（前の作業と同じ）
        residentTaxAssessments: [{ id: uid("rta"), member: H, fiscalYear: 2026, amount: box(150000) }],
      });
    const assessed = setH(base(), "premiumAssessments", [{ id: uid("pa"), member: H, kind: "nationalHealth", fiscalYear: 2026, amount: box(400000) }]);
    const f = entry<{ flows: { amount: number }[] }>(assessed, "socialInsurance.nationalHealth", { fiscalYear: 2026 }).flows;
    expect(f.reduce((s, x) => s + x.amount, 0)).toBe(400000);
    // 制度データに全国の目安の料率が無ければ、世帯の入力が無いときは計算せずに N_INPUT_REQUIRED（目安の値を抜いたパックで確かめる）
    const RATE_ID = /^socialInsurance\.nationalHealth\.(medical|elderlySupport|care|childSupport)\.(incomeRate|perCapita|perHousehold)$/;
    const noDefault = realPacks().map((p) => ({ ...p, values: p.values.filter((v) => !RATE_ID.test(String(v.id))) }));
    const r = run(base(), noDefault);
    expect(notices(r)).toContainEqual({ code: "N_INPUT_REQUIRED", ids: ["socialInsurance.nationalHealth", "socialInsurance.nationalHealth.rates"] });
    expect(r.flows.some((x) => x.formula.startsWith("socialInsurance.nationalHealth."))).toBe(false);
    const rated = setH(base(), "premiumRates", [{ id: uid("pr"), kind: "nationalHealth", parts: { medical: { incomeRate: box("0.07"), perCapita: box(40000), perHousehold: box(20000) } } }]);
    const r2 = run(rated, realPacks());
    expect(r2.flows.some((x) => x.formula === "socialInsurance.nationalHealth.medical")).toBe(true);
  });

  it("国民健康保険: 製品のデータの全国の目安の料率で計算し（0円にしない）、目安を使ったことを知らせる", () => {
    const req = household({
      baseMonth: "2026-04",
      endYear: 2027,
      members: [member("h", "self", "1981-01")],
      periods: [{ id: uid("p"), member: H, from: { at: "2010-04" }, to: null, type: "selfEmployed", business: { income: box(3000000) } }],
    });
    const stubs = {
      "tax.totalIncome": () => ({ total: 3000000, employment: 0, publicPension: 0, other: 3000000 }),
      "tax.publicPensionIncome": () => ({ revenue: 0, deduction: 0, income: 0 }),
    };
    const out = runEngine(req, realPacks(), { checkInternal: true, entry: { component: "socialInsurance.nationalHealth", input: { fiscalYear: 2026 } }, stubs });
    const f = (out.entryOutput as { flows: { formula: string; amount: number }[] }).flows;
    const sum = (formula: string) => f.filter((x) => x.formula === formula).reduce((s, x) => s + x.amount, 0);
    // 基礎（所得）2,570,000。医療 7.77%＝199,689＋29,349＋16,429、支援金 2.70%＝69,390＋10,625＋5,269、介護（45歳）2.09%＝53,713＋12,473＋3,238
    expect(sum("socialInsurance.nationalHealth.medical")).toBe(245467);
    expect(sum("socialInsurance.nationalHealth.elderlySupport")).toBe(85284);
    expect(sum("socialInsurance.nationalHealth.care")).toBe(69424);
    expect(notices(out)).toContainEqual({ code: "N_DEFAULT_USED", ids: ["socialInsurance.nationalHealth", "socialInsurance.nationalHealth.nationalStandard"] });
    expect(notices(out).some((n) => n.code === "N_INPUT_REQUIRED")).toBe(false);
    // 子ども・子育て支援金分（令和8年度から）の全国の目安はまだ無いので、入れずに計算したことを知らせる
    expect(notices(out)).toContainEqual({ code: "N_PARAM_MISSING", ids: ["socialInsurance.nationalHealth", "socialInsurance.nationalHealth.childSupport.nationalStandard"] });
    // 料率の入力の区分は入力の欄だけを使い（平等割の無い市町村）、入力の無い区分は全国の目安で計算して知らせる
    const rated = setH(JSON.parse(JSON.stringify(req)) as Req, "premiumRates", [{ id: uid("pr"), kind: "nationalHealth", parts: { medical: { incomeRate: box("0.07"), perCapita: box(40000) } } }]);
    const o2 = runEngine(rated, realPacks(), { checkInternal: true, entry: { component: "socialInsurance.nationalHealth", input: { fiscalYear: 2026 } }, stubs });
    const f2 = (o2.entryOutput as { flows: { formula: string; amount: number }[] }).flows;
    const sum2 = (formula: string) => f2.filter((x) => x.formula === formula).reduce((s, x) => s + x.amount, 0);
    expect(sum2("socialInsurance.nationalHealth.medical")).toBe(179900 + 40000);
    expect(sum2("socialInsurance.nationalHealth.elderlySupport")).toBe(85284);
    expect(notices(o2)).toContainEqual({ code: "N_DEFAULT_USED", ids: ["socialInsurance.nationalHealth", "socialInsurance.nationalHealth.nationalStandard"] });
    // 世帯全体の計算でも、国民健康保険料が表に載る（前の年度の住民税は決定通知書の額で入れる）
    const all = run(
      household({
        baseMonth: "2026-06",
        endYear: 2027,
        members: [member("h", "self", "1981-01")],
        periods: [{ id: uid("p"), member: H, from: { at: "2010-04" }, to: null, type: "selfEmployed", business: { income: box(3000000) } }],
        residentTaxAssessments: [{ id: uid("rta"), member: H, fiscalYear: 2026, amount: box(150000) }],
      }),
      realPacks(),
    );
    expect(all.flows.filter((x) => x.formula === "socialInsurance.nationalHealth.medical" && x.accrualYear === 2026).reduce((s, x) => s + x.amount, 0)).toBeGreaterThan(0);
  });

  it("健康保険の任意継続: 資格を失ったときの標準報酬月額（協会けんぽは上限32万円）×保険料率（折半しない）を毎月払い、2年を過ぎたら国民健康保険", () => {
    const req = (hi: Record<string, unknown> = { kind: "kyokaikenpo", insurer: "kyokaikenpo.13" }) =>
      household({
        baseMonth: "2026-06",
        endYear: 2029,
        members: [member("h", "self", "1976-01")],
        periods: [
          period("p1", { member: "h", from: "2000-04", to: "2026-03", annual: 4800000, std: [400000, 400000], healthInsurance: hi }),
          { id: uid("p2"), member: H, from: { at: "2026-04" }, to: null, type: "unemployed", healthInsurance: { kind: "continuation" } },
        ],
        residentTaxAssessments: [{ id: uid("rta"), member: H, fiscalYear: 2026, amount: box(200000) }],
      });
    const r = run(req(), realPacks());
    const at = (formula: string, ym: string) => flowsOf(r, (f) => f.formula === formula && f.ym === ym).reduce((s, f) => s + f.amount, 0);
    // 50歳・東京: 320,000×(9.85%＋介護1.62%＋支援金0.23%)＝37,440（円未満切り捨て）。介護 5,184・支援金 736・健康保険 31,520
    expect(at("socialInsurance.continuation.health", "2026-07")).toBe(31520);
    expect(at("socialInsurance.continuation.care", "2026-07")).toBe(5184);
    expect(at("socialInsurance.continuation.childSupport", "2026-07")).toBe(736);
    const hs = entry<HealthStatusOutput>(req(), "socialInsurance.healthStatus", { member: H }, undefined, realPacks()).months;
    expect(hs.find((m) => m.month === "2028-03")?.kind).toBe("continuation");
    expect(hs.find((m) => m.month === "2028-04")?.kind).toBe("national");
    expect(flowsOf(r, (f) => f.formula.startsWith("socialInsurance.continuation.") && f.ym >= "2028-04")).toEqual([]);
    expect(flowsOf(r, (f) => f.formula === "socialInsurance.nationalHealth.medical" && f.ym >= "2028-06").length).toBeGreaterThan(0);
    // 任意継続の保険料は社会保険料控除に入る
    const paid = entry<{ amount: number }>(req(), "tax.socialInsurancePaid", { member: H, year: 2027 }, undefined, realPacks()).amount;
    expect(paid).toBeGreaterThanOrEqual(37440 * 12);
    // 健保組合の任意継続は料率・上限が組合ごとなので計算せずに知らせる
    const u = run(req({ kind: "union", employeeRate: box("0.05") }), realPacks());
    expect(flowsOf(u, (f) => f.formula.startsWith("socialInsurance.continuation."))).toEqual([]);
    expect(notices(u)).toContainEqual({ code: "N_INPUT_REQUIRED", ids: ["socialInsurance.continuation", "socialInsurance.continuation.rates"] });
  });

  it("後期高齢者医療: 所得割＋均等割（軽減の判定は65歳以上の年金の所得から15万円を引く）、区分ごとに100円未満を切り捨て、年金から6回", () => {
    const req = household({ baseMonth: "2026-04", endYear: 2027, members: [member("h", "self", "1948-01")] });
    const stubs = {
      "tax.totalIncome": () => ({ total: 2000000, employment: 0, publicPension: 2000000 }),
      "tax.publicPensionIncome": () => ({ revenue: 3100000, deduction: 1100000, income: 2000000 }),
      "pension.oldAge": () => ({ flows: [], months: [], payments: [{ ym: "2026-06", part: "basic", amount: 500000, accrualYear: 2026 }] }),
    };
    const f = entry<{ flows: { formula: string; amount: number; ym: string }[] }>(req, "socialInsurance.lateElderly", { member: H, fiscalYear: 2026 }, stubs).flows;
    const sum = (formula: string) => f.filter((x) => x.formula === formula).reduce((s, x) => s + x.amount, 0);
    expect(sum("socialInsurance.lateElderly.medical")).toBe(207000); // 1,570,000×10%＋50,000
    expect(sum("socialInsurance.lateElderly.childSupport")).toBe(4100); // 3,140＋1,000 → 100円未満切り捨て
    expect([...new Set(f.map((x) => x.ym))]).toEqual(["2026-04", "2026-06", "2026-08", "2026-10", "2026-12", "2027-02"]);
  });

  it("介護保険（第1号）: 市町村の基準額（入力）×12×合計所得金額の段階の割合", () => {
    const req = setH(household({ baseMonth: "2026-04", endYear: 2027, members: [member("h", "self", "1956-01")] }), "premiumRates", [
      { id: uid("pr"), kind: "careFirst", baseMonthly: box(7000) },
    ]);
    const stubs = {
      "tax.totalIncome": () => ({ total: 1900000, employment: 0, publicPension: 1900000 }),
      "tax.publicPensionIncome": () => ({ revenue: 3000000, deduction: 1100000, income: 1900000 }),
      "pension.oldAge": () => ({ flows: [], months: [], payments: [{ ym: "2026-06", part: "basic", amount: 500000, accrualYear: 2026 }] }),
    };
    const f = entry<{ flows: { amount: number }[] }>(req, "socialInsurance.careFirst", { member: H, fiscalYear: 2026 }, stubs).flows;
    expect(f.map((x) => x.amount)).toEqual([18200, 18200, 18200, 18200, 18200, 18200]); // 7,000×12×1.3
  });
});

describe("休業（決定5）", () => {
  const family = () =>
    household({
      baseMonth: "2026-04",
      endYear: 2028,
      members: [member("m", "self", "1992-05"), member("f", "spouse", "1991-03", { sex: "male" }), member("c", "child", "2027-04")],
      relations: [{ type: "spouse", a: uid("m"), b: uid("f"), marriage: "legal", from: null, to: null }],
      periods: [
        period("m1", { member: "m", from: "2015-04", to: "2027-02", annual: 4800000, std: [400000, 400000] }),
        { id: uid("m2"), member: uid("m"), from: { at: "2027-03" }, to: { at: "2027-05" }, type: "leave", leaveKind: "maternity" },
        { id: uid("m3"), member: uid("m"), from: { at: "2027-06" }, to: { at: "2028-02" }, type: "leave", leaveKind: "childcare" },
        period("m4", { member: "m", from: "2028-03", annual: 4800000, std: [400000, 400000] }),
        period("f1", { member: "f", from: "2013-04", to: "2027-03", annual: 7200000, std: [600000, 600000] }),
        { id: uid("f2"), member: uid("f"), from: { at: "2027-04" }, to: { at: "2027-04" }, type: "leave", leaveKind: "childcare", leaveChild: uid("c") },
        period("f3", { member: "f", from: "2027-05", annual: 7200000, std: [600000, 600000] }),
      ],
    });
  const r = run(family());
  const M = uid("m");
  const F = uid("f");
  it("休業の月は給与が止まり、産前産後休業・育児休業の月の健康保険料・厚生年金保険料は免除", () => {
    expect(flowsOf(r, (f) => f.row === "cf.income.salary" && f.member === M && f.ym >= "2027-03" && f.ym <= "2028-02")).toEqual([]);
    const si = flowsOf(r, (f) => (f.row === "cf.taxSi.health" || f.row === "cf.taxSi.pension") && f.member === M && f.object === uid("m1") && f.accrualYear === 2027);
    expect(si.every((f) => f.ym <= "2027-03")).toBe(true); // 2月分（3月の給与から）まで
  });
  it("出産育児一時金（出生の月）と出産手当金（400,000÷30＝13,330円（10円単位）×2/3＝8,887円×98日。休業の終わりの翌月）", () => {
    expect(flowsOf(r, (f) => f.formula === "benefit.health.childbirthLumpSum")).toMatchObject([{ ym: "2027-04", amount: 500000, member: M }]);
    expect(flowsOf(r, (f) => f.formula === "benefit.health.maternityAllowance")).toMatchObject([{ ym: "2027-06", amount: 870926, member: M }]);
  });
  it("育児休業給付金（産前産後休業の前6か月の給与÷180×30日×67%、7か月目から50%）を2か月分ずつ払う", () => {
    const c = flowsOf(r, (f) => f.formula === "benefit.employment.childcareLeave" && f.member === M);
    // 日額 2,400,000÷180＝13,333 → ×30＝399,990
    expect(c.filter((f) => f.ym === "2027-08").map((f) => f.amount)).toEqual([267993, 267993]);
    expect(c.filter((f) => f.ym === "2028-02").map((f) => f.amount)).toEqual([199995, 199995]);
    expect(c.filter((f) => f.ym === "2028-04").map((f) => f.amount)).toEqual([199995]);
  });
  it("父の出生後休業支援給付（日額の上限16,000円×28日×13%。配偶者が産後休業中なら配偶者の育休を要件としない）", () => {
    expect(flowsOf(r, (f) => f.formula === "benefit.employment.postBirth" && f.member === F).map((f) => f.amount)).toEqual([58240]);
    expect(flowsOf(r, (f) => f.formula === "benefit.employment.childcareLeave" && f.member === F).map((f) => f.amount)).toEqual([321600]);
  });
  it("介護休業給付金: 通算93日・3回までは対象の家族ごとに数える（母の介護の後の義父の介護も出る。同じ家族の4回目は出ない）", () => {
    const P1 = uid("p1");
    const P2 = uid("p2");
    const leave = (n: string, from: string, to: string) => ({ id: uid(n), member: H, from: { at: from }, to: { at: to }, type: "leave", leaveKind: "care" });
    const work = (n: string, from: string, to: string | null) => period(n, { member: "h", from, to, annual: 4800000, std: [400000, 400000] });
    const req = household({
      baseMonth: "2026-10",
      endYear: 2032,
      members: [member("h", "self", "1980-01"), member("p1", "parent", "1950-01"), member("p2", "other", "1948-01")],
      periods: [
        work("w1", "2010-04", "2026-12"),
        leave("l1", "2027-01", "2027-03"),
        work("w2", "2027-04", "2028-05"),
        leave("l2", "2028-06", "2028-08"),
        work("w3", "2028-09", "2029-06"),
        leave("l3", "2029-07", "2029-07"),
        work("w4", "2029-08", null),
      ],
      residentTaxAssessments: [{ id: uid("rta"), member: H, fiscalYear: 2026, amount: box(200000) }],
    });
    setH(req, "careExpenses", [
      { id: uid("care1"), member: P1, from: { at: "2027-01" }, months: 36, otherMonthly: box(10000), initial: box(0) },
      { id: uid("care2"), member: P2, from: { at: "2028-06" }, months: 24, otherMonthly: box(10000), initial: box(0) },
    ]);
    const amounts = () => flowsOf(run(req, realPacks()), (f) => f.formula === "benefit.employment.careLeave").map((f) => [f.object, f.amount] as const);
    const got = new Map(amounts());
    // 母（P1）の介護で90日、義父（P2）の介護でも90日（人ごとに数えると3日だけになっていた）
    expect(got.get(uid("l1"))).toBeGreaterThan(0);
    expect(got.get(uid("l2"))).toBe(got.get(uid("l1")));
    // 母の介護の2回目は、30日のうち通算93日の残りの3日分だけ
    expect(got.get(uid("l3"))).toBeGreaterThan(0);
    expect(got.get(uid("l3"))).toBeLessThan((got.get(uid("l1")) as number) / 10);
    // 同じ家族の4回目からは出ない（1か月ずつ4回）
    const four = household({
      baseMonth: "2026-10",
      endYear: 2032,
      members: [member("h", "self", "1980-01"), member("p1", "parent", "1950-01")],
      periods: [
        work("v1", "2010-04", "2026-12"),
        leave("k1", "2027-01", "2027-01"),
        work("v2", "2027-02", "2027-12"),
        leave("k2", "2028-01", "2028-01"),
        work("v3", "2028-02", "2028-12"),
        leave("k3", "2029-01", "2029-01"),
        work("v4", "2029-02", "2029-12"),
        leave("k4", "2030-01", "2030-01"),
        work("v5", "2030-02", null),
      ],
      residentTaxAssessments: [{ id: uid("rta"), member: H, fiscalYear: 2026, amount: box(200000) }],
    });
    setH(four, "careExpenses", [{ id: uid("care1"), member: P1, from: { at: "2027-01" }, months: 60, otherMonthly: box(10000), initial: box(0) }]);
    const g4 = new Map(flowsOf(run(four, realPacks()), (f) => f.formula === "benefit.employment.careLeave").map((f) => [f.object, f.amount] as const));
    expect([uid("k1"), uid("k2"), uid("k3")].every((k) => (g4.get(k) ?? 0) > 0)).toBe(true);
    expect(g4.has(uid("k4"))).toBe(false);
  });

  it("傷病手当金（最初の月は待期3日を除く。翌月に払う）", () => {
    const req = household({
      baseMonth: "2026-04",
      endYear: 2027,
      members: [member("h", "self", "1980-01")],
      periods: [
        period("p1", { member: "h", from: "2010-04", to: "2026-08", annual: 3600000, std: [300000, 300000] }),
        { id: uid("p2"), member: H, from: { at: "2026-09" }, to: { at: "2026-10" }, type: "leave", leaveKind: "sick" },
        period("p3", { member: "h", from: "2026-11", annual: 3600000, std: [300000, 300000] }),
      ],
    });
    // 300,000÷30＝10,000 ×2/3＝6,667
    expect(flowsOf(run(req), (f) => f.formula === "benefit.health.sicknessAllowance").map((f) => [f.ym, f.amount])).toEqual([["2026-10", 6667 * 27], ["2026-11", 6667 * 30]]);
  });

  it("傷病手当金: 計算基準年の前の年に始まった休業も、休業の前12か月の標準報酬月額で日額を出す", () => {
    const req = household({
      baseMonth: "2026-10",
      endYear: 2027,
      members: [member("h", "self", "1980-01")],
      periods: [
        period("p1", { member: "h", from: "2010-04", to: "2025-09", annual: 3600000, std: [300000, 300000] }),
        { id: uid("p2"), member: H, from: { at: "2025-10" }, to: { at: "2026-12" }, type: "leave", leaveKind: "sick" },
        period("p3", { member: "h", from: "2027-01", annual: 3600000, std: [300000, 300000] }),
      ],
      residentTaxAssessments: [{ id: uid("rta"), member: H, fiscalYear: 2026, amount: box(150000) }],
    });
    const f = flowsOf(run(req, realPacks()), (x) => x.formula === "benefit.health.sicknessAllowance");
    // 300,000÷30＝10,000 ×2/3＝6,667。計算基準月（2026年10月）からの休業の月も払う
    expect(f.filter((x) => x.ym >= "2026-11").map((x) => [x.ym, x.amount])).toEqual([["2026-11", 6667 * 30], ["2026-12", 6667 * 30], ["2027-01", 6667 * 30]]);
  });
});

describe("昇給カーブ（決定7）", () => {
  it("年齢の係数の比で給与を伸ばす（29歳 1.15 → 30歳 1.4）", () => {
    const req = household({ baseMonth: "2026-01", endYear: 2027, members: [member("h", "self", "1997-06")], periods: [period("p", { member: "h", from: "2020-04", annual: 4000000, std: [300000, 300000], extra: {} })] });
    const p = (req.input.household.employmentPeriods[0] as unknown as { salary: Record<string, unknown> }).salary;
    p.growth = { curve: "wageStats.default" };
    const r = run(req);
    const y = (yy: number) => flowsOf(r, (f) => f.row === "cf.income.salary" && f.ym.startsWith(`${yy}`)).reduce((s, f) => s + f.amount, 0);
    expect(y(2026)).toBe(4000000);
    expect(y(2027)).toBe(4869565);
  });

  it("実在の統計の昇給カーブ（wageStats.default。賃金構造基本統計調査 令和7年）: 書いた期間だけ、29歳→30歳で係数の比 1.8261/1.5989 を掛ける", () => {
    const base = modelHousehold("single25");
    (base.input as { endYear: number }).endYear = 2032;
    const curved = structuredClone(base);
    (curved.input.household.employmentPeriods[0] as unknown as { salary: Record<string, unknown> }).salary.growth = { curve: "wageStats.default" };
    const y = (r: ReturnType<typeof run>, yy: number) => flowsOf(r, (f) => f.row === "cf.income.salary" && f.ym.startsWith(`${yy}`)).reduce((s, f) => s + f.amount, 0);
    const a = run(curved as Req, realPacks());
    const b = run(base as Req, realPacks());
    // 25歳→26歳は同じ階級（25〜29歳）なので、賃金上昇率だけの伸びと同じ
    expect(y(a, 2027) / y(a, 2026)).toBeCloseTo(y(b, 2027) / y(b, 2026), 4);
    // 29歳（2030年）→30歳（2031年）は階級が変わる
    expect((y(a, 2031) / y(a, 2030)) / (y(b, 2031) / y(b, 2030))).toBeCloseTo(18261 / 15989, 3);
  });

  it("統計の年齢カーブ（wageStats.curve.*。0116）: 性別・学歴・企業規模の表の係数の比で伸ばし、60歳以後は伸ばさない（賃金上昇率の分だけ）", () => {
    // 1997年6月生まれ: 2026年に29歳→2027年に30歳。1967年6月生まれ: 2026年に59歳→2027年に60歳
    const mk = (birth: string, curve: string | null) => {
      const req = household({ baseMonth: "2026-01", endYear: 2027, members: [member("h", "self", birth)], periods: [period("p", { member: "h", from: "2020-04", annual: 6000000, std: [300000, 300000], extra: {} })] });
      if (curve !== null) (req.input.household.employmentPeriods[0] as unknown as { salary: Record<string, unknown> }).salary.growth = { curve };
      return req;
    };
    const y = (r: ReturnType<typeof run>, yy: number) => flowsOf(r, (f) => f.row === "cf.income.salary" && f.ym.startsWith(`${yy}`)).reduce((s, f) => s + f.amount, 0);
    const id = "wageStats.curve.regular.male.university.large";
    const young = run(mk("1997-06", id), realPacks());
    const youngBase = run(mk("1997-06", null), realPacks());
    expect(y(young, 2026)).toBe(6000000);
    // 29歳（25〜29歳 1.3676）→30歳（30〜34歳 1.6699）
    expect((y(young, 2027) / y(young, 2026)) / (y(youngBase, 2027) / y(youngBase, 2026))).toBeCloseTo(16699 / 13676, 3);
    const old = run(mk("1967-06", id), realPacks());
    const oldBase = run(mk("1967-06", null), realPacks());
    // 59歳→60歳は係数が同じ（55〜59歳のまま）なので、賃金上昇率だけの伸びと同じ
    expect(y(old, 2027)).toBe(y(oldBase, 2027));
  });

  it("統計の年齢カーブはどれも部品が読める（params に並べた値ID と、マスタデータの値がそろう）", () => {
    const sexes = ["all", "male", "female"];
    const edus = ["all", "juniorHigh", "highSchool", "vocational", "juniorCollege", "university", "graduate"];
    const sizes = ["all", "large", "medium", "small"];
    const ids = [...sexes.flatMap((s) => edus.flatMap((e) => sizes.map((z) => `wageStats.curve.regular.${s}.${e}.${z}`))), ...sexes.flatMap((s) => sizes.map((z) => `wageStats.curve.nonRegular.${s}.all.${z}`))];
    expect(ids).toHaveLength(96);
    const packs = realPacks();
    for (const curve of ids) {
      const req = household({ baseMonth: "2026-01", endYear: 2027, members: [member("h", "self", "1990-06")], periods: [period("p", { member: "h", from: "2020-04", annual: 4000000, std: [300000, 300000], extra: {} })] });
      (req.input.household.employmentPeriods[0] as unknown as { salary: Record<string, unknown> }).salary.growth = { curve };
      const r = run(req, packs);
      const ns = (r.header as unknown as { notices: { code: string; ids: string[] }[] }).notices;
      expect(ns.some((n) => n.code === "N_PARAM_MISSING" && n.ids.includes(curve))).toBe(false);
      expect(flowsOf(r, (f) => f.row === "cf.income.salary" && f.ym.startsWith("2027")).length).toBe(12);
    }
  });
});

describe("根拠の記録の大きさ（決定9）", () => {
  it("100年分の計算ができ、none・summary・full で数字が同じ", () => {
    const req = household({ baseMonth: "2026-04", endYear: 2125, members: [member("h", "self", "2001-04")], periods: [period("p", { member: "h", from: "2023-04", to: { at: "2066-03" } as never, annual: 4000000, std: [300000, 300000] })] }) as EngineRequest;
    (req.input.household.employmentPeriods[0] as unknown as { to: unknown }).to = { at: "2066-03" };
    const none = runEngine({ ...req, trace: "none" }, fictionalPacks());
    const full = runEngine({ ...req, trace: "full" }, fictionalPacks());
    expect(JSON.stringify(full.flows)).toBe(JSON.stringify(none.flows));
    expect(none.annual.some((a) => a.year === 2125)).toBe(true);
  });
});

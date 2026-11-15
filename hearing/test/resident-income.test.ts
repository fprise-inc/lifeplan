// 住民税の推定の所得（0133 の追記 2026-11-15）: 所得の年は年度の前の年。その年に重なる働き方の月の分だけを数える（計算エンジンと同じ月割り）
import { describe, expect, it } from "vitest";
import { importAnswers, type Answer, type FilledSheet } from "../src/index.ts";
import { formatValue } from "../src/values.ts";
import { itemByKey } from "../src/definition.ts";
import { residentIncome, residentIncomeYear, residentTaxEstimate, residentTaxYear } from "../src/estimates.ts";
import { basic, idSeq } from "./helpers.ts";

const job = (from: string | null, to: string | null, salary = 4_800_000, bonus = 1_200_000) => ({ type: "regular", from, to, salary, bonus, business: 0 });

describe("所得の年に重なる月の分（residentIncome）", () => {
  it("1年を通して勤めた人は1年分（前の推定と同じ）", () => {
    expect(residentIncome([job("2010-04", null)], 2025)).toEqual({ salary: 6_000_000, business: 0, any: true, months: 12 });
  });

  it("10月から: 給与は3か月分、賞与は12月の分だけ。12月から: 1か月分と12月の賞与", () => {
    expect(residentIncome([job("2025-10", null)], 2025)).toMatchObject({ salary: 1_200_000 + 600_000, months: 3 });
    expect(residentIncome([job("2025-12", null)], 2025)).toMatchObject({ salary: 400_000 + 600_000, months: 1 });
    // 賞与の支給月を入れていればその月（7月・12月）
    expect(residentIncome([{ ...job("2025-08", null), bonusMonths: [7, 12] }], 2025)).toMatchObject({ salary: 2_000_000 + 600_000, months: 5 });
  });

  it("年の途中で辞めた人・転職の年（期間を足す。間の月は収入なし）", () => {
    expect(residentIncome([job("2010-04", "2025-03")], 2025)).toMatchObject({ salary: 1_200_000, months: 3 });
    const r = residentIncome([job("2010-04", "2025-06"), job("2025-08", null, 6_000_000, 0)], 2025);
    expect(r).toMatchObject({ salary: 2_400_000 + 600_000 + 2_500_000, months: 11 });
  });

  it("重ならない期間は any が false。給与の無い働き方は数えない。自営業は事業所得を月割り", () => {
    expect(residentIncome([job("2026-04", null)], 2025)).toEqual({ salary: 0, business: 0, any: false, months: 0 });
    expect(residentIncome([{ ...job("2020-01", null), type: "unemployed" }], 2025)).toMatchObject({ salary: 0, any: true });
    expect(residentIncome([{ type: "selfEmployed", from: "2025-07", to: null, salary: 0, bonus: 0, business: 2_400_000 }], 2025)).toMatchObject({ business: 1_200_000, months: 6 });
  });

  it("年度と所得の年: 1〜5月は前の年度で、所得は計算基準月の年の2年前", () => {
    expect(residentIncomeYear(residentTaxYear("2027-01"))).toBe(2025);
    expect(residentIncomeYear(residentTaxYear("2027-05"))).toBe(2025);
    expect(residentIncomeYear(residentTaxYear("2027-06"))).toBe(2026);
    expect(residentIncomeYear(residentTaxYear("2026-12"))).toBe(2025);
  });

  it("根拠の文: 6〜12月の1年分は前の文のまま。1〜5月は所得の年、月が足りない年は月数を書く", () => {
    const plain = residentTaxEstimate(6_000_000, 0, 2025, { baseMonth: "2026-10", months: 12 });
    expect(plain).toEqual(residentTaxEstimate(6_000_000, 0, 2025));
    expect(residentTaxEstimate(6_000_000, 0, 2025, { baseMonth: "2027-02", months: 12 }).basis).toBe("2025年（2026年度の住民税の元の年）の給与・事業の所得からの概算（住民税の決定通知書の年税額を入れると置き換わります）");
    expect(residentTaxEstimate(1_800_000, 0, 2025, { baseMonth: "2026-10", months: 3 }).basis).toContain("2025年（2026年度の住民税の元の年）の働いた3か月分の給与");
  });
});

describe("ヒアリングシートの取り込みの住民税の推定", () => {
  const def = basic();
  const items = itemByKey(def);
  const M = { format: "fprise-lifeplan-hearing" as const, formatVersion: "0.1", sheetId: "basic", sheetVersion: 1, requestId: "R-ABCDEF", customerNo: "", layoutDigest: "0".repeat(64), appVersion: "0.1.0", exportedOn: "2026-10-01" };
  const a = (key: string, value: string | number, index?: number): Answer => {
    const f = formatValue(items.get(key) as NonNullable<ReturnType<typeof items.get>>, value);
    return { key, ...(index !== undefined ? { index } : {}), status: "value", raw: f.raw, ...(f.raw2 !== undefined ? { raw2: f.raw2 } : {}) };
  };
  const na = (key: string, index?: number): Answer => ({ key, ...(index !== undefined ? { index } : {}), status: "notApplicable" });
  const run = (baseMonth: string, since: string) =>
    importAnswers(
      def,
      {
        management: M,
        answers: [a("hs.meta.filledOn", baseMonth), a("hs.family.adult.birthYearMonth", "1985-04", 1), a("hs.family.adult.sex", "female", 1), na("hs.family.adult.birthYearMonth", 2), a("hs.housing.type", "family"), a("hs.work.type", "regular", 1), a("hs.work.since", since, 1), a("hs.income.salary", 6_000_000, 1), a("hs.income.bonus", 1_200_000, 1)],
      } satisfies FilledSheet,
      { baseMonth, newId: idSeq("import") },
    ).request.input.household.residentTaxAssessments ?? [];

  it("前の年の10月から勤めた人は3か月分（入力の画面と同じ）", () => {
    const [t] = run("2026-10", "2025-10");
    // 年収 600万円（賞与 120万円を含む）→ 給与 480万円の3か月分＋12月の賞与 60万円
    expect(t?.amount.value).toBe(residentTaxEstimate(1_200_000 + 600_000, 0, 2025).value);
    expect((t?.amount as { estimate?: { basis?: string } }).estimate?.basis).toContain("働いた3か月分");
  });

  it("計算基準月が1〜5月なら2年前の年の所得: 前の年の4月から勤めた人は0円の推定（前は前の年の1年分）", () => {
    const [z] = run("2027-02", "2026-04");
    expect(z?.fiscalYear).toBe(2026);
    expect(z?.amount.value).toBe(0);
    expect((z?.amount as { estimate?: { basis?: string } }).estimate?.basis).toContain("2025年（2026年度の住民税の元の年）");
    // 所得の年にも前の年にも働いていない人（今年から）には入れない（計算エンジンが入れた期間から出す）
    expect(run("2027-02", "2027-01")).toEqual([]);
    const [t] = run("2027-02", "2025-04");
    expect(t?.fiscalYear).toBe(2026);
    expect(t?.amount.value).toBe(residentTaxEstimate(3_600_000 + 1_200_000, 0, 2025).value);
  });
});

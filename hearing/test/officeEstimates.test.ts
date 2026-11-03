// 0111: 事務所の推定の値（マスタデータの写しに重ねる事務所の値）と、推定で埋めない入力欄
import { afterEach, describe, expect, it } from "vitest";
import { importAnswers, type Answer, type FilledSheet } from "../src/index.ts";
import { formatValue } from "../src/values.ts";
import { itemByKey } from "../src/definition.ts";
import { businessEstimate, livingEstimate, NOT_FILLED_BASIS, salaryEstimate } from "../src/estimates.ts";
import { fillsByEstimate, isOfficeBasisText, masterValue, officialMasterValue, setOfficeEstimates, withOfficeEstimates, type BracketStep } from "../src/statistics.ts";
import { basic, idSeq } from "./helpers.ts";

afterEach(() => setOfficeEstimates({}));

const LIVING = "living.statistics.basicMonthly";
const officeLiving = (): BracketStep[] => (officialMasterValue(LIVING)?.value as BracketStep[]).map((s) => (s.upTo === 2 ? { upTo: 2, amount: 250000 } : s));
const BASIS = "当事務所のお客さまの平均（2026年調べ）";

describe("事務所の推定の値", () => {
  it("推定の目安は事務所の値を使い、根拠の文は事務所の文（原本での確かめ前の印は付けない）", () => {
    expect(livingEstimate(2).value).toBe(209000);
    setOfficeEstimates({ [LIVING]: { value: officeLiving(), basis: BASIS } });
    const e = livingEstimate(2);
    expect(e.value).toBe(250000);
    // 事務所の値から作った推定の根拠は、事務所の根拠の文そのもの（完全に同じ文で見分けるため、ほかの文を足さない）
    expect(e.basis).toBe(BASIS);
    // 変えていない段（3人）は公式の値のまま
    expect(livingEstimate(3).value).toBe(Math.round(((officialMasterValue(LIVING)?.value as BracketStep[])[2]?.amount as number) / 1000) * 1000);
    expect(masterValue(LIVING)?.office).toBe(true);
    expect(officialMasterValue(LIVING)?.office).toBeUndefined();
    expect(isOfficeBasisText(e.basis)).toBe(true);
    expect(isOfficeBasisText("家計調査（総務省）2025年")).toBe(false);
  });

  it("給与の推定も事務所の値（年齢計）を使う", () => {
    const id = "wageStats.contractualMonthly.regular.all";
    setOfficeEstimates({ [id]: { value: 500000, basis: "事務所の目安（2026年11月）" } });
    expect(salaryEstimate("regular")?.annual).toEqual({ value: 6000000, basis: "事務所の目安（2026年11月）" });
  });

  it("一時的に置き換えた値は、終わると元に戻る（代表の世帯で差を見るとき）", () => {
    setOfficeEstimates({ "wageStats.business.operatingProfit": { value: 3000000, basis: "事務所の目安（2026年11月）" } });
    const inside = withOfficeEstimates({}, [], () => businessEstimate().value);
    expect(inside).toBe(officialMasterValue("wageStats.business.operatingProfit")?.value);
    expect(businessEstimate().value).toBe(3000000);
  });

  it("写しに無い値ID は捨てる", () => {
    setOfficeEstimates({ "incomeTax.basicDeduction": { value: 0, basis: "x" } });
    expect(masterValue("incomeTax.basicDeduction")).toBeNull();
  });
});

describe("推定で埋めない入力欄（ヒアリングシートの取り込み）", () => {
  const def = basic();
  const items = itemByKey(def);
  const M = { format: "fprise-lifeplan-hearing" as const, formatVersion: "0.1", sheetId: "basic", sheetVersion: 1, requestId: "R-ABCDEF", customerNo: "", layoutDigest: "0".repeat(64), appVersion: "0.1.0", exportedOn: "2026-10-01" };
  const a = (key: string, value: string | number | "unknown", index?: number): Answer => {
    const at = { key, ...(index !== undefined ? { index } : {}) };
    if (value === "unknown") return { ...at, status: value };
    const f = formatValue(items.get(key) as NonNullable<ReturnType<typeof items.get>>, value);
    return { ...at, status: "value", raw: f.raw, ...(f.raw2 !== undefined ? { raw2: f.raw2 } : {}) };
  };
  const run = (...answers: Answer[]) => importAnswers(def, { management: M, answers } as FilledSheet, { baseMonth: "2026-10", newId: idSeq("import") });
  const minimal = [a("hs.meta.filledOn", "2026-10"), a("hs.family.adult.birthYearMonth", "1985-04", 1), a("hs.family.adult.sex", "female", 1), a("hs.housing.type", "family"), a("hs.work.type", "regular", 1)];

  it("選んでいない欄は今までどおり推定で埋める", () => {
    expect(fillsByEstimate("livingExpense.monthly")).toBe(true);
    const r = run(...minimal, a("hs.income.salary", "unknown", 1), a("hs.expense.living", "unknown"));
    expect(r.request.input.household.livingExpenses?.length).toBe(1);
    expect(r.request.input.household.employmentPeriods[0]?.salary?.annual).toMatchObject({ state: "estimated", estimate: { method: "statistic" } });
  });

  it("選んだ欄（基本生活費・給与）は空欄・「わからない」を推定で埋めない（給与は未入力の0円）", () => {
    setOfficeEstimates({}, ["livingExpense.monthly", "employment.salary.annual"]);
    const r = run(...minimal, a("hs.income.salary", "unknown", 1), a("hs.expense.living", "unknown"));
    expect(r.request.input.household.livingExpenses ?? []).toEqual([]);
    const s = r.request.input.household.employmentPeriods[0]?.salary;
    expect(s?.annual).toMatchObject({ value: 0, state: "estimated", estimate: { basis: NOT_FILLED_BASIS } });
    expect(s?.bonus).toMatchObject({ value: 0, estimate: { basis: NOT_FILLED_BASIS } });
    // 書いてある値はそのまま取り込む
    const r2 = run(...minimal, a("hs.income.salary", 4500000, 1), a("hs.income.bonus", 900000, 1), a("hs.expense.living", 250000));
    expect(r2.request.input.household.livingExpenses?.[0]?.monthly).toMatchObject({ value: 250000, state: "confirmed" });
  });
});

// 0111 の2回目: コードの中の目安（presets.ts）にも同じ重ね方が効く
describe("事務所の推定の値（コードの中の目安）", () => {
  it("目安の値と根拠の文が事務所の値になる。一覧に無い値ID は使わない", async () => {
    const { CAR_ESTIMATE, PART_TIME_HOURS, healthRateEstimate } = await import("../src/estimates.ts");
    const { presetValue, officialPreset } = await import("../src/presets.ts");
    expect(CAR_ESTIMATE.price.value).toBe(2500000);
    expect(PART_TIME_HOURS.weekly).toBe(15);
    expect(healthRateEstimate("mutualAid").value).toBe("0.0490");
    setOfficeEstimates({
      "preset.car.price": { value: 3200000, basis: BASIS },
      "preset.wage.partTime.weeklyHours": { value: 20, basis: BASIS },
      "preset.health.mutualAidRate": { value: "0.05", basis: BASIS },
      "preset.nothing": { value: 1, basis: BASIS },
    });
    expect(CAR_ESTIMATE.price).toEqual({ value: 3200000, basis: BASIS });
    expect(PART_TIME_HOURS.weekly).toBe(20);
    expect(healthRateEstimate("mutualAid")).toEqual({ value: "0.05", basis: BASIS });
    expect(isOfficeBasisText(CAR_ESTIMATE.price.basis)).toBe(true);
    expect(presetValue("preset.car.price")).toBe(3200000);
    expect(officialPreset("preset.car.price")).toBe(2500000);
    expect(() => presetValue("preset.nothing")).toThrow();
  });

  it("給与の仮の値（統計の無い働き方）も事務所の値になる", () => {
    expect(salaryEstimate("executive")?.annual.value).toBe(5400000);
    setOfficeEstimates({ "preset.wage.provisional.executive.salary": { value: 9000000, basis: BASIS } });
    expect(salaryEstimate("executive")?.annual).toEqual({ value: 9000000, basis: BASIS });
    expect(salaryEstimate("executive")?.bonus.value).toBe(0);
  });
});

// 0111 の 2026-11-02 の追記: 事務所の値から作った推定かは、根拠の文がまったく同じかで見分ける（文の一部では見分けない）
describe("事務所の値から作った推定の見分け方（完全に同じ文）", () => {
  it("「平均」「統計」のような短い文を書いても、出典の長い公式の根拠と取り違えない", () => {
    setOfficeEstimates({ [LIVING]: { value: officeLiving(), basis: "平均" }, "care.statistics.months": { value: 60, basis: "統計" } });
    const official = salaryEstimate("regular")?.annual.basis ?? "";
    expect(official).toContain("統計");
    expect(isOfficeBasisText(official)).toBe(false);
    expect(isOfficeBasisText("家計調査（総務省）の統計の平均")).toBe(false);
    // 事務所の文とまったく同じなら事務所の値（前後の空白はそろえる。ヒアリングシートの「わからない」の頭を付けた文も）
    expect(isOfficeBasisText("平均")).toBe(true);
    expect(isOfficeBasisText(" 統計 ")).toBe(true);
    expect(isOfficeBasisText("ヒアリングで「わからない」。平均")).toBe(true);
    expect(livingEstimate(2).basis).toBe("平均");
  });

  it("事務所の値が無ければ、どの文も事務所の値ではない", () => {
    expect(isOfficeBasisText("事務所の目安（2026年11月）")).toBe(false);
    expect(isOfficeBasisText("")).toBe(false);
  });
});

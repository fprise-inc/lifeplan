// 推定の目安（src/estimates.ts）: 数は正本の YAML（data/master・data/regulation）の写しから読む。入力の画面とヒアリングが同じ関数を使う
import { describe, expect, it } from "vitest";
import { businessEstimate, residentTaxEstimate, retirementLumpSumEstimate, retirementPrevalence, salaryEstimate, smrEstimate, wageCurve, wageSizeClass } from "../src/estimates.ts";
import { MASTER_VALUES } from "../src/statistics.generated.ts";

describe("推定の目安", () => {
  it("正社員・契約社員の給与は賃金構造基本統計調査の所定内給与額×12（年齢階級の表が無い間は年齢計）。賞与・ほかの働き方は仮の値", () => {
    const m = salaryEstimate("regular", "male", { age: 45 });
    expect(m?.annual.value).toBe(387400 * 12);
    expect(m?.annual.basis).toContain("賃金構造基本統計調査（厚生労働省）令和7年");
    expect(m?.annual.basis).toContain("原本での確かめ前");
    expect(m?.bonus.basis).toContain("仮の値");
    expect(salaryEstimate("contract", "female")?.annual.value).toBe(218400 * 12);
    expect(salaryEstimate("partTime", "female")?.annual).toMatchObject({ value: 1000000 });
    expect(salaryEstimate("selfEmployed", "male")).toBeNull();
    // 年齢を渡さなくても同じ（年齢階級の表が無い間）
    expect(salaryEstimate("regular", "male")?.annual.value).toBe(m?.annual.value);
  });

  it("年齢の賃金カーブは、年齢階級の表が無い間は作らない（既定にはしない）", () => {
    expect(wageCurve("regular", "male")).toBeNull();
    expect(Object.keys(MASTER_VALUES).some((id) => id.startsWith("wageStats.byAge."))).toBe(false);
  });

  it("勤め先の規模の区分", () => {
    expect([undefined, 5, 99, 100, 999, 1000].map(wageSizeClass)).toEqual(["all", "small", "small", "medium", "medium", "large"]);
  });

  it("事業所得は個人企業経済調査の営業利益", () => {
    expect(businessEstimate()).toMatchObject({ value: 2180000 });
    expect(businessEstimate().basis).toContain("個人企業経済調査");
  });

  it("標準報酬月額は等級表に当てる（厚生年金の下限 88,000円・上限は引き上げの日程どおり）", () => {
    const low = smrEstimate(600000, "2026-10");
    expect([low.health.value, low.pension.value]).toEqual([58000, 88000]);
    const mid = smrEstimate(4648800, "2026-10");
    expect([mid.health.value, mid.pension.value]).toEqual([380000, 380000]);
    const high = smrEstimate(12000000, "2026-10");
    expect([high.health.value, high.pension.value]).toEqual([980000, 650000]);
    expect(smrEstimate(12000000, "2029-10").pension.value).toBe(750000);
    expect(high.pension).toMatchObject({ state: "estimated", origin: { kind: "auto" } });
  });

  it("住民税の概算は、所得の年の給与所得控除（制度データ）を使う", () => {
    // 2025年分: 給与所得控除の最低 65万円。(180万−65万−43万−27万)×10%＋均等割5,000円
    expect(residentTaxEstimate(1800000, 0, 2025).value).toBe(50000);
    // 2026年分: 最低 74万円
    expect(residentTaxEstimate(1800000, 0, 2026).value).toBe(41000);
    expect(residentTaxEstimate(1000000, 0, 2025).value).toBe(0);
  });

  it("退職一時金の目安は、勤続20年以上かつ45歳以上の定年退職だけ（就労条件総合調査）", () => {
    expect(retirementLumpSumEstimate({ reason: "mandatory", yearsOfService: 38, ageAtRetirement: 60 })).toMatchObject({ value: 18960000 });
    expect(retirementLumpSumEstimate({ reason: "mandatory", yearsOfService: 38, ageAtRetirement: 60, education: "highSchoolManual" })?.value).toBe(11830000);
    expect(retirementLumpSumEstimate({ reason: "mandatory", yearsOfService: 15, ageAtRetirement: 60 })).toBeNull();
    expect(retirementLumpSumEstimate({ reason: "voluntary", yearsOfService: 30, ageAtRetirement: 55 })).toBeNull();
    expect(retirementPrevalence()?.value).toBe(749);
    expect(retirementPrevalence(500)?.value).toBe(888);
    // 30〜99人の段は値が無いので企業規模計
    expect(retirementPrevalence(50)).toMatchObject({ value: 749 });
  });
});

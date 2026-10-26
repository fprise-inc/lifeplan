// 推定の目安（src/estimates.ts）: 数は正本の YAML（data/master・data/regulation）の写しから読む。入力の画面とヒアリングが同じ関数を使う
import { describe, expect, it } from "vitest";
import { businessEstimate, healthRateEstimate, livingEstimate, residentTaxEstimate, retirementLumpSumEstimate, retirementPrevalence, salaryEstimate, smrEstimate, wageCurve, wageSizeClass } from "../src/estimates.ts";
import { masterValue } from "../src/statistics.ts";

describe("推定の目安", () => {
  it("正社員・契約社員は賃金構造基本統計調査の年齢階級別の「きまって支給する現金給与額」×12 と年間賞与", () => {
    const m = salaryEstimate("regular", "male", { age: 45 });
    expect(m?.annual.value).toBe(469000 * 12);
    expect(m?.bonus.value).toBe(1531000);
    expect(m?.annual.basis).toContain("賃金構造基本統計調査（厚生労働省）令和7年");
    expect(m?.annual.basis).toContain("45歳の階級×12");
    expect(m?.annual.basis).not.toContain("upTo");
    expect(m?.annual.basis).not.toContain("原本での確かめ前");
    // 年齢を渡さなければ年齢計
    expect(salaryEstimate("regular", "male")?.annual.value).toBe(425600 * 12);
    // 規模を渡せば規模別の表（1,000人以上）
    expect(salaryEstimate("regular", "male", { age: 27, size: 2000 })?.annual.value).toBe(371700 * 12);
    expect(salaryEstimate("contract", "female", { age: 40 })?.annual.value).toBe(230600 * 12);
    expect(salaryEstimate("selfEmployed", "male")).toBeNull();
  });

  it("公務員は行政職俸給表（一）の年齢階層別の平均給与月額×12（賞与は仮の値）", () => {
    expect(salaryEstimate("civilServant", "female", { age: 45 })?.annual.value).toBe(467753 * 12);
    expect(salaryEstimate("civilServant", "male")?.annual.value).toBe(414480 * 12);
    expect(salaryEstimate("civilServant", "male")?.bonus.basis).toContain("仮の値");
  });

  it("パートは短時間労働者の時給×週15時間×52週", () => {
    expect(salaryEstimate("partTime", "female")?.annual.value).toBe(1418 * 15 * 52);
    expect(salaryEstimate("partTime", "male")?.annual.value).toBe(1769 * 15 * 52);
    expect(salaryEstimate("partTime", "female")?.bonus.value).toBe(0);
  });

  it("昇給カーブ: エンジンの既定のカーブ（wageStats.default）があり、雇用形態・性別ごとの係数も作れる。どちらも既定では使わない", () => {
    const def = masterValue("wageStats.default")?.value as { upTo: number | null; rate: string }[];
    expect(def[0]).toEqual({ upTo: 19, rate: "1.0000" });
    expect(def).toHaveLength(12);
    const c = wageCurve("regular", "male");
    expect(c?.[0]).toEqual({ upTo: 19, rate: "1.0000" });
    expect(Number(c?.[8]?.rate)).toBeGreaterThan(2);
    expect(wageCurve("partTime", "male")).toBeNull();
  });

  it("勤め先の規模の区分", () => {
    expect([undefined, 5, 99, 100, 999, 1000].map(wageSizeClass)).toEqual(["all", "small", "small", "medium", "medium", "large"]);
  });

  it("基本生活費は家計調査（二人以上の世帯の世帯人員別）から住居・教育・自動車等関係費を除いた額。1人は仮の値", () => {
    expect([1, 2, 3, 4, 5, 6, 8].map((n) => livingEstimate(n).value)).toEqual([140000, 235225, 264456, 279695, 285353, 303204, 303204]);
    expect(livingEstimate(1).basis).toContain("仮の値");
    expect(livingEstimate(3).basis).toContain("家計調査（総務省）2025年");
  });

  it("事業所得は個人企業経済調査の営業利益", () => {
    expect(businessEstimate()).toMatchObject({ value: 2180000 });
    expect(businessEstimate().basis).toContain("個人企業経済調査");
  });

  it("健康保険組合の料率は協会けんぽの料率の半分（支部は省略で東京）。料率を入れるよう知らせる", () => {
    const e = healthRateEstimate("union", { month: "2026-10" });
    expect(e.value).toBe("0.04925");
    expect(e.basis).toContain("健康保険組合の料率を入れてください");
    expect(healthRateEstimate("union", { month: "2025-10" }).value).toBe("0.04955");
    expect(healthRateEstimate("mutualAid").basis).toContain("仮の値");
  });

  it("標準報酬月額は等級表に当てる（厚生年金の下限 88,000円・上限は引き上げの日程どおり）", () => {
    const low = smrEstimate(600000, "2026-10");
    expect([low.health.value, low.pension.value]).toEqual([58000, 88000]);
    const high = smrEstimate(12000000, "2026-10");
    expect([high.health.value, high.pension.value]).toEqual([980000, 650000]);
    expect(smrEstimate(12000000, "2029-10").pension.value).toBe(750000);
  });

  it("住民税の概算は、所得の年の給与所得控除（制度データ）を使う", () => {
    expect(residentTaxEstimate(1800000, 0, 2025).value).toBe(50000);
    expect(residentTaxEstimate(1800000, 0, 2026).value).toBe(41000);
  });

  it("退職一時金の目安: 勤続20年以上かつ45歳以上は就労条件総合調査、それより短いと東京都の中小企業のモデル退職金", () => {
    expect(retirementLumpSumEstimate({ reason: "mandatory", yearsOfService: 38, ageAtRetirement: 60 })?.value).toBe(20370000);
    expect(retirementLumpSumEstimate({ reason: "mandatory", yearsOfService: 22, ageAtRetirement: 60, education: "highSchoolManual" })?.value).toBe(4060000);
    expect(retirementLumpSumEstimate({ reason: "company", yearsOfService: 25, ageAtRetirement: 50, education: "highSchoolOffice" })?.value).toBe(13850000);
    expect(retirementLumpSumEstimate({ reason: "voluntary", yearsOfService: 10, ageAtRetirement: 35 })?.value).toBe(1125000);
    expect(retirementLumpSumEstimate({ reason: "company", yearsOfService: 4, ageAtRetirement: 27, education: "highSchoolOffice" })?.value).toBe(266000);
    expect(retirementLumpSumEstimate({ reason: "mandatory", yearsOfService: 0, ageAtRetirement: 23 })).toBeNull();
    expect(retirementPrevalence()?.value).toBe(749);
    expect(retirementPrevalence(50)?.value).toBe(701);
    expect(retirementPrevalence(5000)?.value).toBe(901);
  });
});

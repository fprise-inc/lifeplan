// 推定の目安（src/estimates.ts）: 数は正本の YAML（data/master・data/regulation）の写しから読む。入力の画面とヒアリングが同じ関数を使う
import { describe, expect, it } from "vitest";
import { businessEstimate, healthRateEstimate, isLegacyLivingEstimate, LIVING_SPLIT_CATEGORIES, livingCategoryAverages, livingEstimate, livingStatistic, splitLiving, splitTransport, SPLIT_STEP, residentTaxEstimate, retirementLumpSumEstimate, retirementPrevalence, salaryEstimate, smrEstimate, neutralWageCurveId, parseWageCurveId, reemploymentRatio, wageCurve, wageCurveId, wageCurveRate, wageCurveTable, wageSizeClass } from "../src/estimates.ts";
import { masterValue } from "../src/statistics.ts";
import { MASTER_VALUES } from "../src/statistics.generated.ts";

describe("推定の目安", () => {
  it("正社員・契約社員は賃金構造基本統計調査の年齢階級別の「きまって支給する現金給与額」×12 と年間賞与（男女計）", () => {
    const m = salaryEstimate("regular", { age: 45 });
    expect(m?.annual.value).toBe(428900 * 12);
    expect(m?.bonus.value).toBe(1352900);
    expect(m?.annual.basis).toContain("賃金構造基本統計調査（厚生労働省）令和7年");
    expect(m?.annual.basis).toContain("男女計");
    expect(m?.annual.basis).toContain("45歳の階級×12");
    expect(m?.annual.basis).not.toContain("upTo");
    expect(m?.annual.basis).not.toContain("原本での確かめ前");
    // 年齢を渡さなければ年齢計
    expect(salaryEstimate("regular")?.annual.value).toBe(390900 * 12);
    // 規模を渡せば規模別の表（1,000人以上）
    expect(salaryEstimate("regular", { age: 27, size: 2000 })?.annual.value).toBe(355700 * 12);
    expect(salaryEstimate("contract", { age: 40 })?.annual.value).toBe(247100 * 12);
    expect(salaryEstimate("selfEmployed")).toBeNull();
  });

  it("推定の数字を人の属性（性別・学歴）で分けない（0117）: 給与・賞与・パートの時給の目安の根拠の文に男性・女性・学歴の表の名前が出ない", () => {
    for (const type of ["regular", "contract", "civilServant", "partTime", "executive"])
      for (const age of [undefined, 25, 45, 62]) {
        const e = salaryEstimate(type, age === undefined ? {} : { age });
        expect(e).not.toBeNull();
        for (const basis of [e?.annual.basis ?? "", e?.bonus.basis ?? ""]) expect(basis).not.toMatch(/男性|女性|・男・|・女・|大学|高校|中学|専門学校|高専|短大/);
      }
    // 男女別の表・性別と学歴で分けた昇給カーブ・学歴で分けた退職給付は、マスタデータに無い
    const ids = Object.keys(MASTER_VALUES);
    expect(ids.filter((id) => /^wageStats\.(?!civilServant).*\.(male|female)(\.|$)/.test(id))).toEqual([]);
    expect(ids.filter((id) => /^retirementBenefit\..*(university|highSchool|juniorCollege)/.test(id))).toEqual([]);
  });

  it("公務員は行政職俸給表（一）の年齢階層別の平均給与月額×12（賞与は仮の値）", () => {
    expect(salaryEstimate("civilServant", { age: 45 })?.annual.value).toBe(467753 * 12);
    expect(salaryEstimate("civilServant")?.annual.value).toBe(414480 * 12);
    expect(salaryEstimate("civilServant")?.bonus).toEqual({ value: 1500000, basis: "賞与の目安（仮の値。出典の統計の値が無い）" });
  });

  it("パートは短時間労働者の時給（男女計）×週15時間×52週", () => {
    expect(salaryEstimate("partTime")?.annual.value).toBe(1518 * 15 * 52);
    expect(salaryEstimate("partTime")?.annual.basis).toContain("男女計");
    expect(salaryEstimate("partTime")?.bonus.value).toBe(0);
  });

  it("役員は仮の値（性別で分けない）", () => {
    expect(salaryEstimate("executive")?.annual.value).toBe(5400000);
    expect(salaryEstimate("executive")?.bonus.value).toBe(0);
  });

  it("定年後の再雇用の比は、同じ働き方の男女計の60〜64歳÷55〜59歳", () => {
    expect(reemploymentRatio("regular")).toBeCloseTo(388500 / 453700, 10);
    expect(reemploymentRatio("contract")).toBeCloseTo(298600 / 248000, 10);
    expect(reemploymentRatio("selfEmployed")).toBeNull();
  });

  it("昇給カーブ: エンジンの既定のカーブ（wageStats.default）と、統計の年齢カーブ（男女計・学歴計・企業規模。0116・0117）の表がある。どちらも既定では使わない", () => {
    const def = masterValue("wageStats.default")?.value as { upTo: number | null; rate: string }[];
    expect(def[0]).toEqual({ upTo: 19, rate: "1.0000" });
    expect(def).toHaveLength(12);
    // 企業規模計の統計の年齢カーブは、59歳までは wageStats.default と同じで、60歳以後は55〜59歳の係数のまま
    const all = wageCurve("regular");
    expect(all?.slice(0, 9)).toEqual(def.slice(0, 9));
    expect(all?.slice(9).map((b) => b.rate)).toEqual(["2.4116", "2.4116", "2.4116"]);
    const large = wageCurve("regular", 2000);
    expect(large).toEqual(wageCurveTable("wageStats.curve.regular.all.all.large"));
    expect(wageCurveRate(large ?? [], 30)).toBe(Number(large?.[3]?.rate));
    // 契約・嘱託は正社員・正職員以外の表
    expect(wageCurveId({ employment: "nonRegular", size: "small" })).toBe("wageStats.curve.nonRegular.all.all.small");
    expect(wageCurve("contract", 50)).not.toBeNull();
    expect(wageCurve("partTime")).toBeNull();
    expect(parseWageCurveId("wageStats.curve.regular.all.all.medium")).toEqual({ employment: "regular", size: "medium" });
    expect(parseWageCurveId("wageStats.default")).toBeNull();
    expect(parseWageCurveId("wageStats.curve.regular.female.graduate.medium")).toBeNull();
    // 前の版の性別・学歴で分けた値ID は、同じ雇用形態・企業規模の男女計・学歴計に直す
    expect(neutralWageCurveId("wageStats.curve.regular.female.graduate.medium")).toBe("wageStats.curve.regular.all.all.medium");
    expect(neutralWageCurveId("wageStats.curve.nonRegular.male.all.small")).toBe("wageStats.curve.nonRegular.all.all.small");
    expect(neutralWageCurveId("wageStats.default")).toBe("wageStats.default");
    // 統計の年齢カーブの値は8（雇用形態2×企業規模4）。どの値ID も表がある
    const ids = Object.keys(MASTER_VALUES).filter((id) => id.startsWith("wageStats.curve."));
    expect(ids).toHaveLength(8);
    for (const id of ids) {
      expect(parseWageCurveId(id)).not.toBeNull();
      expect(wageCurveId(parseWageCurveId(id)!)).toBe(id);
      expect(neutralWageCurveId(id)).toBe(id);
      expect(wageCurveTable(id)).toHaveLength(12);
    }
  });

  it("勤め先の規模の区分", () => {
    expect([undefined, 5, 99, 100, 999, 1000].map(wageSizeClass)).toEqual(["all", "small", "small", "medium", "medium", "large"]);
  });

  it("基本生活費は家計調査（二人以上の世帯の世帯人員別）から住居・教育・自動車等関係費・家庭用耐久財・仕送り金と、ほかの入力項目で入れる物を除いた額。1人は仮の値", () => {
    // 表の額のまま（人数ごとの比に使う）
    expect([1, 2, 3, 4, 5, 6, 8].map((n) => livingStatistic(n).value)).toEqual([140000, 208847, 231261, 245354, 250637, 272579, 272579]);
    // 欄に入れる推定は千円単位
    expect([1, 2, 3, 4, 5, 6, 8].map((n) => livingEstimate(n).value)).toEqual([140000, 209000, 231000, 245000, 251000, 273000, 273000]);
    expect(livingEstimate(3).basis).toBe(livingStatistic(3).basis);
    // 前の版の推定（丸める前の額）を見分ける（人数が同じときだけ。千円ちょうどの額は見分けなくてよい）
    expect(isLegacyLivingEstimate(231261, 3)).toBe(true);
    expect(isLegacyLivingEstimate(231000, 3)).toBe(false);
    expect(isLegacyLivingEstimate(231261, 2)).toBe(false);
    expect(isLegacyLivingEstimate(140000, 1)).toBe(false);
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

  it("退職一時金の目安: 勤続20年以上かつ45歳以上は就労条件総合調査、それより短いと東京都の中小企業のモデル退職金（どちらも学歴を分けない値。0117）", () => {
    expect(retirementLumpSumEstimate({ reason: "mandatory", yearsOfService: 38, ageAtRetirement: 60 })?.value).toBe(18060000);
    expect(retirementLumpSumEstimate({ reason: "mandatory", yearsOfService: 22, ageAtRetirement: 60 })?.value).toBe(6610000);
    expect(retirementLumpSumEstimate({ reason: "company", yearsOfService: 25, ageAtRetirement: 50 })?.value).toBe(12870000);
    expect(retirementLumpSumEstimate({ reason: "earlyIncentive", yearsOfService: 25, ageAtRetirement: 50 })?.value).toBe(22810000);
    expect(retirementLumpSumEstimate({ reason: "voluntary", yearsOfService: 10, ageAtRetirement: 35 })?.value).toBe(1048000);
    expect(retirementLumpSumEstimate({ reason: "company", yearsOfService: 4, ageAtRetirement: 27 })?.value).toBe(285000);
    expect(retirementLumpSumEstimate({ reason: "mandatory", yearsOfService: 0, ageAtRetirement: 23 })).toBeNull();
    for (const [reason, years, age] of [["mandatory", 38, 60], ["company", 25, 50], ["voluntary", 10, 35], ["company", 4, 27]] as const) {
      const basis = retirementLumpSumEstimate({ reason, yearsOfService: years, ageAtRetirement: age })?.basis ?? "";
      expect(basis).toContain("学歴を分けない値");
      expect(basis).not.toMatch(/大学|高校|高専|短大|現業/);
    }
    expect(retirementPrevalence()?.value).toBe(749);
    expect(retirementPrevalence(50)?.value).toBe(701);
    expect(retirementPrevalence(5000)?.value).toBe(901);
  });
});

describe("総額を費目に分ける（千円単位）", () => {
  it.each([140000, 264456, 300000, 12345])("総額 %i 円: 端を置く「その他」のほかは千円単位で、合計は総額のまま", (total) => {
    for (const size of [1, 2, 3, 4]) {
      const sp = splitLiving(total, size);
      expect(sp).not.toBeNull();
      const parts = sp!.parts;
      expect(LIVING_SPLIT_CATEGORIES.reduce((s, c) => s + parts[c], 0)).toBe(total);
      for (const c of LIVING_SPLIT_CATEGORIES) {
        expect(parts[c]).toBeGreaterThanOrEqual(0);
        if (c !== "other") expect(parts[c] % SPLIT_STEP, c).toBe(0);
      }
    }
  });
  it("丸めた額の合計が総額を超えるほど小さい総額は、1円単位で分ける", () => {
    const sp = splitLiving(3000, 3)!;
    expect(LIVING_SPLIT_CATEGORIES.reduce((s, c) => s + sp.parts[c], 0)).toBe(3000);
    for (const c of LIVING_SPLIT_CATEGORIES) expect(sp.parts[c]).toBeGreaterThanOrEqual(0);
  });
});

describe("基本生活費の10費目（0100）", () => {
  it("基本生活費の目安は消費支出から住居・教育・自動車等関係費・家庭用耐久財・仕送り金と、ほかの入力項目で入れる物を除いた額で、10費目の合計と一致する（表の丸めの1円の差を除く）", () => {
    expect([2, 3, 4, 5, 6].map((n) => livingStatistic(n).value)).toEqual([208847, 231261, 245354, 250637, 272579]);
    for (const n of [2, 3, 4, 5, 6]) {
      const avg = livingCategoryAverages(n)!;
      const sum = LIVING_SPLIT_CATEGORIES.reduce((s, c) => s + avg.amounts[c], 0);
      expect(Math.abs(sum - livingStatistic(n).value), `${n}人`).toBeLessThanOrEqual(1);
    }
    expect(livingCategoryAverages(2)!.amounts).toMatchObject({ food: 79331, utilities: 22691, communication: 12311, transit: 4049, furniture: 7503, clothing: 15125, health: 16280, recreation: 21688, pocketAndSocial: 24303, other: 5565 });
    // インターネット接続料（品目分類の全国の月平均 2,954円）を、どの世帯人員も教養娯楽から通信へ移した（合計は同じ）。
    // ほかの入力項目で入れる物を除いた（0106）: 食料−学校給食、通信−携帯電話機 744円、交通−有料道路料 732円、
    // 教養娯楽−月謝類−テレビ・レコーダー・パソコン 1,792円−動物病院代 837円、その他−保険料・保育・介護サービス・婚礼・葬儀・祭具と墓石 11,223円
    expect([2, 3, 4, 5, 6].map((n) => livingCategoryAverages(n)!.amounts.food)).toEqual([79340 - 9, 92240 - 362, 103384 - 1655, 112019 - 2538, 123241 - 2723]);
    expect([2, 3, 4, 5, 6].map((n) => livingCategoryAverages(n)!.amounts.communication)).toEqual([13055, 15392, 16282, 17276, 20017].map((x) => x - 744));
    expect([2, 3, 4, 5, 6].map((n) => livingCategoryAverages(n)!.amounts.transit)).toEqual([4781, 6239, 7099, 4927, 4007].map((x) => x - 732));
    expect([2, 3, 4, 5, 6].map((n) => livingCategoryAverages(n)!.amounts.recreation)).toEqual([25457 - 1140, 26479 - 2104, 33756 - 5877, 32905 - 6028, 33436 - 5849].map((x) => x - 1792 - 837));
    expect([2, 3, 4, 5, 6].map((n) => livingCategoryAverages(n)!.amounts.other)).toEqual([16788, 19157, 18167, 16492, 17230].map((x) => x - 11223));
    // こづかい・交際費から住宅関係負担費（品目 973。共益費・住宅組合費など。品目分類の全国の月平均 1,756円）を除いた（住まい・ローンで入れる）
    expect([2, 3, 4, 5, 6].map((n) => livingCategoryAverages(n)!.amounts.pocketAndSocial)).toEqual([26059, 21337, 17597, 15110, 18288].map((x) => x - 1756));
  });
  it("前の分け方の交通・通信とその他の消費支出の平均も添える（前の世帯の内訳の目安）", () => {
    expect(livingCategoryAverages(2)!.amounts).toMatchObject({ transport: 14883 });
    expect(livingCategoryAverages(2)!.amounts.otherConsumption).toBeGreaterThan(0);
  });
  it("交通・通信を交通と通信に分ける: 交通は千円単位、合計は元の額のまま", () => {
    const sp = splitTransport(30000, 2)!;
    expect(sp.transit + sp.communication).toBe(30000);
    expect(sp.transit % SPLIT_STEP).toBe(0);
    expect(sp.transit).toBe(Math.round((30000 * 4049) / (4049 + 12311) / 1000) * 1000);
    const tiny = splitTransport(400, 2)!;
    expect(tiny.transit + tiny.communication).toBe(400);
    expect(tiny.transit).toBeGreaterThanOrEqual(0);
  });
});

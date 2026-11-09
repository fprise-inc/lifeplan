// 持ち家の入力項目の続き（0176 の追記・0181）: 標準を「買った年月・買った値段・うち土地の値段」の3欄にし、土地の欄の下に建物の値段と
// 固定資産税の目安を読みとして出す。固定資産税の目安の建物の下がり方を固定資産評価基準（経年減点補正率・再建築費評点補正率）に寄せる。
// 直した所が戻ってこないことを確かめる
import { describe, expect, it } from "vitest";
import type { Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef, type GroupDef } from "../src/workspace/input/form.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { buildingValueRatio, keinenRate, propertyTaxPlan } from "../src/workspace/input/propertyTax.ts";
import { ownedHomeTaxPlan } from "../src/workspace/input/ownedHomeTax.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";

const BASE = "2026-10";
const stageOf = (wh: WorkingHousehold) => buildStage("housing", wh);
const groups = (wh: WorkingHousehold): GroupDef[] => stageOf(wh).sections.flatMap((s) => s.groups);
const settle = (wh: WorkingHousehold) => withProvisionalHousing(withRefreshedEstimates(wh));
function action(wh: WorkingHousehold, key: string): WorkingHousehold {
  const a = stageOf(wh)
    .sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)])
    .find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return settle(a.run(wh));
}
function fieldOf(wh: WorkingHousehold, suffix: string): FieldDef {
  const f = allFields(stageOf(wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1]): WorkingHousehold => settle(fieldOf(wh, suffix).set(wh, v));
const owned = (wh: WorkingHousehold): Residence => (wh.request.input.household.residences ?? []).find((r) => r.kind === "own" && r.purchase === undefined)!;
const fresh = (): WorkingHousehold => action(blankHousehold(BASE), "housing/addOwn");
/** 0176 の例の家: 2015年4月に4,000万円（うち土地1,500万円）で買った木造（建った年は空欄＝買った年の新築） */
const example = (): WorkingHousehold => set(set(set(fresh(), "/from", { at: "2015-04" }), "/valuation/value", 40_000_000), "/valuation/land", 15_000_000);
const stagesOf = (r: Residence): Map<number, number> => new Map((r.propertyTax?.stages ?? []).map((s) => [Number((s.at.at ?? "").slice(0, 4)), Number(s.ratio)]));

describe("固定資産評価基準の経年減点補正率（別表第9・第13。令和6基準年度）", () => {
  it("木造の住宅（専用住宅・共同住宅。再建築費評点数 1㎡あたり95,820〜147,770点の区分）は築25年で0.20", () => {
    expect([1, 2, 3, 4, 9, 10, 15, 20, 24, 25, 40].map((a) => keinenRate("wood", a))).toEqual([0.8, 0.75, 0.7, 0.68, 0.56, 0.54, 0.43, 0.31, 0.22, 0.2, 0.2]);
    // 新築（経過年数0）は1年の値
    expect(keinenRate("wood", 0)).toBe(0.8);
  });
  it("非木造の住宅・アパート: 鉄筋コンクリート造は築60年、重量鉄骨（肉厚4mm超）は40年、軽量鉄骨（3mm超4mm以下）は30年で0.20", () => {
    expect([4, 10, 30, 59, 60].map((a) => keinenRate("rc", a))).toEqual([0.6912, 0.6386, 0.4632, 0.2088, 0.2]);
    expect([4, 20, 39, 40].map((a) => keinenRate("steel", a))).toEqual([0.6865, 0.4703, 0.2135, 0.2]);
    expect([4, 20, 29, 30].map((a) => keinenRate("lightSteel", a))).toEqual([0.6815, 0.3852, 0.2185, 0.2]);
  });
  it("評価替えの年ごとに下げ、2024年度は再建築費評点補正率（木造1.11・非木造1.07）を掛け、上がる年は前の額のまま（据え置き）", () => {
    // 2015年に建った木造: 2018年 築3年 0.70、2021年 築6年 0.63、2024年 築9年 0.56×1.11＝0.6216（0.63より低いので下がる）
    expect(buildingValueRatio("wood", 2015, 2015, 2026)).toBeCloseTo(0.6216 / 0.8, 10);
    expect(buildingValueRatio("wood", 2015, 2015, 2027)).toBeCloseTo((0.5 * 1.11) / 0.8, 10);
    // 2022年に建った木造: 2024年 築2年 0.75×1.11＝0.8325 は新築の0.80より高いので据え置き
    expect(buildingValueRatio("wood", 2022, 2022, 2026)).toBe(1);
    expect(buildingValueRatio("wood", 2022, 2022, 2027)).toBeCloseTo((0.65 * 1.11) / 0.8, 10);
    // 時点の年からの比（中古で買った家: その額の時点〔2018年度 築18年〕の評価額から下げる）。2021年度 築21年に下がり、
    // 2024年度 築24年×1.07 は2021年度より高いので据え置き
    expect(keinenRate("rc", 24) * 1.07).toBeGreaterThan(keinenRate("rc", 21));
    expect(buildingValueRatio("rc", 2000, 2020, 2026)).toBeCloseTo(keinenRate("rc", 21) / keinenRate("rc", 18), 10);
    expect(buildingValueRatio("rc", 2000, 2020, 2027)).toBeCloseTo((keinenRate("rc", 27) * 1.07) / keinenRate("rc", 18), 10);
  });
});

describe("固定資産税の目安（0181）", () => {
  it("0176 の例の家（2015年4月・4,000万円・うち土地1,500万円・木造）: 2026年 年16.71万円（前は年22.88万円）", () => {
    const wh = example();
    const r = owned(wh);
    // 土地: 1,500万円×70%＝1,050万円 → 1/6×1.4%＋1/3×0.3%＝35,000円
    // 建物: 2,500万円×40%＝1,000万円（新築の評価額）× 0.6216÷0.80＝777万円 → ×(1.4%＋0.3%)＝132,090円
    expect(r.propertyTax?.annual.value).toBe(167_100);
    const basis = (r.propertyTax?.annual as { estimate?: { basis?: string } }).estimate?.basis ?? "";
    expect(basis).toContain("経年減点補正率");
    expect(basis).toContain("建物が価格の40%");
    expect(basis).toContain("再建築費評点補正率");
    const st = stagesOf(r);
    expect([...st.keys()]).toEqual([2027, 2030, 2033, 2036, 2039, 2042]);
    expect(st.get(2027)).toBe(0.915);
  });

  it("式（純粋な関数）: 今住んでいる持ち家と購入の予定は同じ下がり方", () => {
    const own = ownedHomeTaxPlan({ value: 40_000_000, valueYear: 2015, landShare: "0.375", structure: "wood", condo: false, longLife: false, baseYear: 2026, lastYear: 2060 });
    expect(own.first).toBe(167_100);
    // 購入の予定（2030年に新築の木造の戸建て4,000万円・土地30%）: 最初の年 2031年は新築の評価額（価格×40%）に軽減、2033年から元に戻る
    const buy = propertyTaxPlan({ price: 40_000_000, landShare: 0.3, structure: "wood", condo: false, newBuild: true, purchaseYear: 2030, longLife: false, lastYear: 2060 });
    const land = 40_000_000 * 0.3 * 0.7;
    const landTax = (land / 6) * 0.014 + (land / 3) * 0.003;
    const b = 40_000_000 * 0.7 * 0.4;
    expect(buy.first).toBe(Math.round((landTax + b * 0.007 + b * 0.003) / 100) * 100);
    // 2033年度の評価替え: 築3年 0.70÷0.80（軽減は2033年まで）。2034年に軽減が終わる
    const s2033 = buy.stages.find((s) => s.year === 2033)!;
    expect(Number(s2033.ratio)).toBeCloseTo(Math.round((landTax + b * 0.875 * 0.01) / 100) * 100 / buy.first, 3);
    expect(s2033.basis).toContain("2033年度の評価替え");
    const s2034 = buy.stages.find((s) => s.year === 2034)!;
    expect(Number(s2034.ratio)).toBeCloseTo(Math.round((landTax + b * 0.875 * 0.017) / 100) * 100 / buy.first, 3);
  });
});

describe("持ち家（今住んでいる）の標準の3欄と、土地の欄の下の読み", () => {
  it("標準は買った年月・買った値段・うち土地の値段。うち建物の値段は中枠「持ち家の評価」（詳細）", () => {
    const wh = example();
    expect(fieldOf(wh, "/from").level).toBe("simple");
    expect(fieldOf(wh, "/valuation/value").level).toBe("simple");
    expect(fieldOf(wh, "/valuation/land").level).toBe("simple");
    expect(fieldOf(wh, "/valuation/building").level).toBe("detail");
    const val = groups(wh).find((g) => g.title === "持ち家の評価")!;
    expect(val.fields.map((f) => f.label)).toContain("うち建物の値段");
    const main = groups(wh).find((g) => g.title?.startsWith("住まい 1"))!;
    expect(main.fields.some((f) => f.key.endsWith("/valuation/building"))).toBe(false);
  });

  it("土地の欄の下に建物の値段（合計−土地）と固定資産税の目安（推定）を出す", () => {
    const wh = example();
    const hint = fieldOf(wh, "/valuation/land").get(wh).hint ?? "";
    expect(hint).toContain("建物の値段 約2,500万円（合計−土地）");
    expect(hint).toContain("固定資産税の目安（推定） 年 約16.7万円");
    expect(hint).not.toContain("納税通知書");
  });

  it("土地が空欄なら、目安の割合で分けた建物の値段を出す", () => {
    const wh = set(set(fresh(), "/from", { at: "2015-04" }), "/valuation/value", 40_000_000);
    const hint = fieldOf(wh, "/valuation/land").get(wh).hint ?? "";
    expect(hint).toContain("空欄なら合計の30%（約1,200万円）で計算します");
    expect(hint).toContain("建物の値段 約2,800万円");
    expect(hint).toContain("固定資産税の目安（推定） 年 約");
  });

  it("FP が固定資産税の額を入れていれば、その額を推定の印なしで出す", () => {
    let wh = example();
    wh = set(wh, "/tax", 152_300);
    const hint = fieldOf(wh, "/valuation/land").get(wh).hint ?? "";
    expect(hint).toContain("固定資産税 年 15.23万円");
    expect(hint).not.toContain("推定");
  });

  it("詳細の建物の欄から入れても、0176 の組み合わせの決まり（土地と建物 → 合計＝土地＋建物）のまま", () => {
    let wh = set(fresh(), "/valuation/land", 15_000_000);
    wh = set(wh, "/valuation/building", 25_000_000);
    expect(fieldOf(wh, "/valuation/value").get(wh).value).toBe(40_000_000);
    expect(fieldOf(wh, "/valuation/land").get(wh).value).toBe(15_000_000);
  });
});

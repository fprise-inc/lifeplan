// 住宅の購入の種類（0052 の追記 2026-11-03）と固定資産税の推定（0112）
import { afterEach, describe, expect, it } from "vitest";
import type { Debt, PreviewResult, Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { purchaseTypeOf } from "../src/workspace/input/stages/housing.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { isAutoTaxStage, propertyTaxPlan, PROPERTY_TAX_BASIS, taxStageId } from "../src/workspace/input/propertyTax.ts";
import { setOfficeEstimates } from "../../hearing/src/statistics.ts";
import { preview } from "./helpers.ts";

const BASE = "2026-10";

const stage = (wh: WorkingHousehold) => buildStage("housing", wh);
/** 画面の編集と同じ順（推定の入れ直し → 住宅ローンの仮の値） */
const settle = (wh: WorkingHousehold) => withProvisionalHousing(withRefreshedEstimates(wh));
function action(wh: WorkingHousehold, key: string): WorkingHousehold {
  const s = stage(wh);
  const a = s.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return settle(a.run(wh));
}
const fieldMaybe = (wh: WorkingHousehold, suffix: string): FieldDef | undefined => allFields(stage(wh)).find((x) => x.key.endsWith(suffix));
function fieldOf(wh: WorkingHousehold, suffix: string): FieldDef {
  const f = fieldMaybe(wh, suffix);
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1]): WorkingHousehold => settle(fieldOf(wh, suffix).set(wh, v));

function salaried(): WorkingHousehold {
  let wh = blankHousehold(BASE);
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!;
  return annual.set(wh, 6000000);
}
const bought = (wh: WorkingHousehold): Residence => (wh.request.input.household.residences ?? []).find((r) => r.purchase !== undefined)!;
const loanOf = (wh: WorkingHousehold): Debt => (wh.request.input.household.debts ?? []).find((d) => d.kind === "mortgage")!;
const sum = (r: PreviewResult, row: string, year: number) => r.table.filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year).reduce((s, c) => s + c.amount, 0);
/** 段の年 → 割合 */
const stagesOf = (r: Residence): Map<number, number> => new Map((r.propertyTax?.stages ?? []).map((s) => [Number((s.at.at ?? "").slice(0, 4)), Number(s.ratio)]));

afterEach(() => setOfficeEstimates({}));

describe("住宅の購入の種類（0052 の追記 2026-11-03）", () => {
  it("住宅の購入の頭に種類の欄が1つ。足した直後は空（選ぶ前は新築の戸建てとして目安を出す）", () => {
    const wh = action(salaried(), "housing/addPurchase");
    const f = fieldOf(wh, "/purchase/type");
    expect(f.level).toBe("simple");
    expect(f.get(wh).value).toBeNull();
    // 建て方の欄は購入の予定では出さない（種類で決まる）
    expect(fieldMaybe(wh, `${bought(wh).id}/style`)).toBeUndefined();
    expect(bought(wh).purchase).toMatchObject({ price: 40000000, costs: 2000000 });
  });

  const cases = [
    { t: "newCondo", style: "condo", newBuild: true, structure: "rc", costs: 2000000, maint: 25000, label: "管理費・修繕積立金（毎月）" },
    { t: "usedCondo", style: "condo", newBuild: false, structure: "rc", costs: 3200000, maint: 25000, label: "管理費・修繕積立金（毎月）" },
    { t: "newHouse", style: "house", newBuild: true, structure: "wood", costs: 2000000, maint: 15000, label: "修繕の積み立て（毎月）" },
    { t: "usedHouse", style: "house", newBuild: false, structure: "wood", costs: 3200000, maint: 15000, label: "修繕の積み立て（毎月）" },
  ] as const;
  for (const c of cases) {
    it(`${c.t}: 建て方・構造・諸費用（新築5%・中古8%）・修繕費の呼び方と目安を種類から決める（どれも推定）`, () => {
      let wh = action(salaried(), "housing/addPurchase");
      wh = set(wh, "/purchase/type", c.t);
      const r = bought(wh);
      expect(r.style).toBe(c.style);
      expect(r.purchase?.newBuild).toBe(c.newBuild);
      expect(r.valuation?.structure).toBe(c.structure);
      expect(r.purchase?.costs).toBe(c.costs);
      expect(r.maintenance?.monthly).toMatchObject({ value: c.maint, state: "estimated" });
      expect(fieldOf(wh, `${r.id}/maint`).label).toBe(c.label);
      expect(fieldStatus(fieldOf(wh, "/purchase/costs"), wh).status).toBe("estimated");
      expect(fieldOf(wh, "/purchase/type").get(wh)).toMatchObject({ value: c.t });
      // 中古は建った年の欄が標準（頭）に出る。新築は持ち家の評価の詳細のまま
      expect(fieldOf(wh, "/valuation/builtYear").level).toBe(c.newBuild ? "detail" : "simple");
      expect(() => preview(wh.request)).not.toThrow();
    });
  }

  it("FP が入れた諸費用・修繕費・構造は、種類を変えても上書きしない", () => {
    let wh = action(salaried(), "housing/addPurchase");
    wh = set(wh, "/purchase/costs", 1500000);
    wh = set(wh, `${bought(wh).id}/maint`, 18000);
    wh = set(wh, "/valuation/structure", "steel");
    wh = set(wh, "/purchase/type", "usedCondo");
    const r = bought(wh);
    expect(r.purchase?.costs).toBe(1500000);
    expect(r.maintenance?.monthly.value).toBe(18000);
    expect(r.valuation?.structure).toBe("steel");
  });

  it("中古の諸費用の推定は価格を直すと中古の割合でついていく", () => {
    let wh = action(salaried(), "housing/addPurchase");
    wh = set(wh, "/purchase/type", "usedHouse");
    wh = set(wh, "/purchase/price", 25000000);
    expect(bought(wh).purchase?.costs).toBe(2000000);
  });

  it("購入の予定とつながる住宅ローンは、控除の新築か中古かを種類から読み、ローンの側では聞かない", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const id = loanOf(wh).id;
    // 種類を選ぶ前は今のまま控除の側で聞く
    expect(fieldMaybe(wh, `${id}/credit/newBuild`)).toBeDefined();
    wh = set(wh, "/purchase/type", "usedCondo");
    expect(loanOf(wh).housing).toMatchObject({ newBuild: false, propertyType: "other" });
    expect(fieldMaybe(wh, `${id}/credit/newBuild`)).toBeUndefined();
    wh = set(wh, "/purchase/type", "newCondo");
    // 2028年の入居の新築は、控除のある最も控えめな ZEH水準省エネ住宅（2026-11-05 の追記）
    expect(loanOf(wh).housing).toMatchObject({ newBuild: true, propertyType: "zeh" });
    // FP が控除の住宅の種類を確定にしても、新築か中古かは種類に合わせる
    wh = set(wh, `${id}/credit`, "certified");
    wh = set(wh, "/purchase/type", "usedHouse");
    expect(loanOf(wh).housing).toMatchObject({ newBuild: false, propertyType: "certified" });
  });

  it("今住んでいる家のローン（購入の予定とつながらない）は、今のまま控除の側で新築か中古かを聞く", () => {
    let wh = action(action(salaried(), "housing/addOwn"), "housing/addMortgage");
    wh = set(wh, `${loanOf(wh).id}/credit/moveIn`, "2020-04");
    expect(fieldMaybe(wh, `${loanOf(wh).id}/credit/newBuild`)).toBeDefined();
    // 今住んでいる持ち家は建て方の欄のまま
    expect(fieldMaybe(wh, "/style")).toBeDefined();
  });

  it("ローンを組まない人にも新築か中古かが入る（控除が無くても種類を持つ）", () => {
    let wh = action(salaried(), "housing/addPurchase");
    wh = set(wh, "/purchase/type", "usedHouse");
    expect(bought(wh).purchase?.newBuild).toBe(false);
    expect(wh.request.input.household.debts ?? []).toHaveLength(0);
  });

  it("前の版の購入の予定（種類を持たない）: 建て方と建った年・確定の控除から読める範囲で種類を見せ、読めなければ空。世帯は書き換えない", () => {
    let wh = action(salaried(), "housing/addPurchase");
    const legacy = (fn: (r: Residence) => void): WorkingHousehold => {
      const req = structuredClone(wh.request);
      const r = (req.input.household.residences ?? []).find((x) => x.purchase !== undefined)!;
      delete r.purchase?.newBuild;
      delete r.style;
      // 前の版の固定資産税は目安のボタンの値（推定の段は無い）
      r.propertyTax = { annual: { value: 120000, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "目安のボタンの値（固定資産税・都市計画税 年12万円。この世帯に合わせて直してください）" } } as never };
      const vs = (r as { valueStates?: Record<string, unknown> }).valueStates ?? {};
      for (const key of Object.keys(vs)) if (key.startsWith("residence.propertyTax")) delete vs[key];
      fn(r);
      return { ...wh, request: req };
    };
    // 何も読めない
    const none = legacy(() => undefined);
    expect(purchaseTypeOf(none, bought(none))).toBeNull();
    expect(fieldOf(none, "/purchase/type").get(none).value).toBeNull();
    // 建て方と古い建った年 → 中古（暗に見せるだけ）
    const used = legacy((r) => {
      r.style = "condo";
      r.valuation = { builtYear: 2005 };
    });
    expect(fieldOf(used, "/purchase/type").get(used)).toMatchObject({ value: "usedCondo", implicit: true });
    // 建て方だけ（新築か中古か分からない）→ 空
    const styleOnly = legacy((r) => void (r.style = "house"));
    expect(fieldOf(styleOnly, "/purchase/type").get(styleOnly).value).toBeNull();
    // 開いても（仮の値・推定の入れ直しを通しても）世帯は変わらない
    for (const x of [none, used, styleOnly]) expect(settle(x).request).toEqual(x.request);
    // FP が確定にした控除の新築か中古か（中古）と、FP が入れた構造（鉄筋コンクリート造）→ 中古マンション
    wh = action(wh, "housing/addMortgage");
    wh = set(wh, `${loanOf(wh).id}/credit/newBuild`, "used");
    const viaCredit = legacy((r) => void (r.valuation = { structure: "rc" }));
    expect(fieldOf(viaCredit, "/purchase/type").get(viaCredit).value).toBe("usedCondo");
  });
});

describe("固定資産税の推定（0112）", () => {
  it("新築の戸建て: 最初の年は新築の軽減つき、軽減が終わる年（3年）に上がり、評価替えの年に下がる。土地は横ばい", () => {
    let wh = action(salaried(), "housing/addPurchase");
    wh = set(wh, "/purchase/type", "newHouse");
    const r = bought(wh);
    // 土地 4000万×30%×70%＝840万（課税標準 1/6・都市計画 1/3）、建物 4000万×70%×40%＝1120万（新築の評価額。0181。軽減で半分）
    // 28,000 + 1120万×1.4%×1/2 + 1120万×0.3% = 140,000
    expect(r.propertyTax?.annual).toMatchObject({ value: 140000, state: "estimated", estimate: { method: "derived" } });
    expect((r.propertyTax?.annual as { estimate?: { basis?: string } }).estimate?.basis).toContain(PROPERTY_TAX_BASIS);
    const st = stagesOf(r);
    // 割合は小数1桁の％（0.001 刻み）にそろえる
    for (const s of r.propertyTax?.stages ?? []) expect(s.ratio).toMatch(/^\d+(\.\d{1,3})?$/u);
    // 2030年度の評価替え（築2年。経年減点補正率 0.75÷0.80）で下がる → 133,000（95%）
    expect(st.get(2030)).toBe(0.95);
    // 軽減は 2029〜2031 年。2032 年に建物の分が元に戻る → 206,500（147.5%）
    expect(st.get(2032)).toBe(1.475);
    expect(st.has(2031)).toBe(false);
    // 2033年度の評価替え（築5年。0.65÷0.80）→ 182,700（130.5%）
    expect(st.get(2033)).toBe(1.305);
    // 根拠の文の割合も同じ値
    const row = (wh.request.input.household.residences ?? []).find((x) => x.id === r.id) as { valueStates?: Record<string, { estimate?: { basis?: string } }> };
    expect(row.valueStates?.[`residence.propertyTax/stages/${taxStageId(r.id, 2032)}/ratio`]?.estimate?.basis).toContain("147.5%");
    // 段は推定（値の状態の行）
    expect(isAutoTaxStage(wh.request.input.household, r.id, taxStageId(r.id, 2032))).toBe(true);
    // 計算エンジンの固定資産税の行に入る
    const p = preview(wh.request);
    expect(sum(p, "cf.expense.housing.propertyTax", 2029)).toBe(140000);
    // 年額を4月・7月・12月・翌年2月に分けて払うので、2032年の支出は2032年分の3回と2031年分の1回
    expect(Math.abs(sum(p, "cf.expense.housing.propertyTax", 2032) - (140000 * 1.475 * 0.75 + 140000 * 0.95 * 0.25))).toBeLessThanOrEqual(4);
  });

  it("新築のマンションは軽減が5年、長期優良住宅は戸建て5年・マンション7年（ローンを組まないときは住宅の購入の詳細で選ぶ）", () => {
    const reliefEnd = (r: Residence): number => [...stagesOf(r).entries()].find(([, v]) => v > 1.3)?.[0] ?? 0;
    let wh = action(salaried(), "housing/addPurchase");
    wh = set(wh, "/purchase/type", "newCondo");
    expect(reliefEnd(bought(wh))).toBe(2034);
    wh = set(wh, "/purchase/longLife", true);
    expect(reliefEnd(bought(wh))).toBe(2036);
    wh = set(wh, "/purchase/type", "newHouse");
    expect(reliefEnd(bought(wh))).toBe(2034);
  });

  it("長期優良住宅かは、つながる住宅ローンの控除の住宅の種類（認定住宅）から読み、住宅の購入の欄は出さない", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    wh = set(wh, "/purchase/type", "newHouse");
    expect(fieldMaybe(wh, "/purchase/longLife")).toBeUndefined();
    const reliefEnd = (r: Residence): number => [...stagesOf(r).entries()].find(([, v]) => v > 1.3)?.[0] ?? 0;
    expect(reliefEnd(bought(wh))).toBe(2032);
    wh = set(wh, `${loanOf(wh).id}/credit`, "certified");
    expect(reliefEnd(bought(wh))).toBe(2034);
  });

  it("中古: 新築の軽減は当てず（建った年が分からないとき）、建った年を入れると古くなった分から下げる（経年減点補正率の下限で止まる）", () => {
    let wh = action(salaried(), "housing/addPurchase");
    wh = set(wh, "/purchase/type", "usedHouse");
    const a = bought(wh).propertyTax!.annual.value!;
    // 軽減なし: 28,000 + 1120万×1.7% = 218,400
    expect(a).toBe(218400);
    expect((bought(wh).propertyTax?.annual as { estimate?: { basis?: string } }).estimate?.basis).toContain("建った年が分からない");
    wh = set(wh, "/valuation/builtYear", 2010);
    const r = bought(wh);
    // 最初の年（2029年）は2027年度の築17年（0.38）。2030年度 築20年（0.31）・2033年度 築23年（0.25）と下がり、2036年度 築26年で下限（0.20）に止まる
    const st = stagesOf(r);
    expect([...st.keys()]).toEqual([2030, 2033, 2036]);
    expect(st.get(2030)).toBeLessThan(1);
    expect(st.get(2036)).toBeLessThan(st.get(2033)!);
    // 建った年がすでに下限を過ぎた家（2000年築。2027年度 築27年）は段が付かない
    wh = set(wh, "/valuation/builtYear", 2000);
    expect(stagesOf(bought(wh)).size).toBe(0);
  });

  it("FP が納税通知書の額を入れたら、その額が優先。推定の段（割合）は入れ直し続け、その額を元に動く", () => {
    let wh = action(salaried(), "housing/addPurchase");
    wh = set(wh, "/purchase/type", "newHouse");
    const k = `housing/res/${bought(wh).id}/tax`;
    wh = set(wh, k, 150000);
    const r = bought(wh);
    expect(r.propertyTax?.annual).toMatchObject({ value: 150000 });
    expect(fieldStatus(fieldOf(wh, k), wh).status).toBe("confirmed");
    const ratio = stagesOf(r).get(2032)!;
    // 価格を直しても FP の額は変わらず、段は入れ直す（割合は同じ形）
    wh = set(wh, "/purchase/price", 50000000);
    expect(bought(wh).propertyTax?.annual.value).toBe(150000);
    expect(stagesOf(bought(wh)).get(2032)).toBe(ratio);
    const p = preview(wh.request);
    const r31 = stagesOf(bought(wh)).get(2030)!;
    expect(Math.abs(sum(p, "cf.expense.housing.propertyTax", 2032) - (150000 * ratio * 0.75 + 150000 * r31 * 0.25))).toBeLessThanOrEqual(4);
  });

  it("推定の段があるときは、変動率の欄に段との関係を書く（変動率は空のまま。入れると段の額にさらに毎年掛かる）", () => {
    let wh = action(salaried(), "housing/addPurchase");
    const k = `housing/res/${bought(wh).id}/taxGrowth`;
    expect(bought(wh).propertyTax?.growth).toBeUndefined();
    const f = fieldOf(wh, k);
    expect(f.help).toContain("段の額にさらに毎年この率を掛けます");
    expect(f.get(wh).hint).toContain("推定の段で動かしています");
    // 変動率を入れると、段の額に計算の基準の年からの年数分を掛ける（今の計算の決まり）
    const before = preview(wh.request);
    wh = set(wh, k, "0.01");
    expect(fieldOf(wh, k).get(wh).hint ?? null).toBeNull();
    const after = preview(wh.request);
    const y = 2033;
    expect(sum(after, "cf.expense.housing.propertyTax", y) / sum(before, "cf.expense.housing.propertyTax", y)).toBeGreaterThan(1.05);
    // 今住んでいる持ち家（推定の段なし）は前の説明のまま
    const own = action(salaried(), "housing/addOwn");
    expect(fieldOf(own, "/taxGrowth").help).toContain("入れなければ変えません");
  });

  it("推定の段を外すと、入れ直しで足し直さない（推定の段は1つの表に畳み、表の「推定の変化を外す」で外す）", () => {
    let wh = action(salaried(), "housing/addPurchase");
    const r = bought(wh);
    expect(stagesOf(r).size).toBeGreaterThan(3);
    wh = action(wh, `/propertyTax/autoStages/remove`);
    expect(bought(wh).propertyTax?.stages).toBeUndefined();
    wh = set(wh, "/purchase/price", 45000000);
    expect(bought(wh).propertyTax?.stages).toBeUndefined();
    expect(taxStageId(r.id, 2032)).not.toBe("");
  });

  it("目安の割合を事務所の推定の値で変えると、推定に効く（法令の値は変えられない）", () => {
    let wh = action(salaried(), "housing/addPurchase");
    wh = set(wh, "/purchase/type", "newHouse");
    expect(bought(wh).propertyTax?.annual.value).toBe(140000);
    setOfficeEstimates({ "preset.housing.propertyTax.buildingRatio": { value: "0.5", basis: "事務所の目安" }, "preset.housing.propertyTax.cityPlanningRate": { value: "0.01", basis: "事務所の目安" } });
    wh = set(wh, "/purchase/price", 40000000);
    // 建物 4000万×70%×50%＝1400万。都市計画税は上限 0.3% で止まる: 28,000 + 98,000 + 42,000 = 168,000
    expect(bought(wh).propertyTax?.annual.value).toBe(168000);
  });

  it("推定の式（純粋な関数）: 下限で止まると段は増えない", () => {
    const p = propertyTaxPlan({ price: 30000000, landShare: 0.3, structure: "wood", condo: false, newBuild: true, purchaseYear: 2028, longLife: false, lastYear: 2100 });
    const last = p.stages.at(-1)!;
    expect(last.year).toBeLessThanOrEqual(2060);
    expect(last.basis).toContain("下限");
  });

  it("今住んでいる持ち家（購入の予定でない）の固定資産税は推定で入れ直さない（目安のボタンの値のまま）", () => {
    const wh = action(salaried(), "housing/addOwn");
    const r = (wh.request.input.household.residences ?? [])[0]!;
    expect(r.propertyTax?.annual.value).toBe(120000);
    expect(r.propertyTax?.stages).toBeUndefined();
  });
});

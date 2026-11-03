// 今住んでいる持ち家の固定資産税・都市計画税の推定（0112 の追記 2026-11-03）
import { afterEach, describe, expect, it } from "vitest";
import type { PreviewResult, Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { isAutoTaxStage, PROPERTY_TAX_BASIS, taxStageId } from "../src/workspace/input/propertyTax.ts";
import { ownedHomeTaxPlan } from "../src/workspace/input/ownedHomeTax.ts";
import { setOfficeEstimates } from "../../hearing/src/statistics.ts";
import { preview } from "./helpers.ts";

const BASE = "2026-10";

const stage = (wh: WorkingHousehold) => buildStage("housing", wh);
const settle = (wh: WorkingHousehold) => withProvisionalHousing(withRefreshedEstimates(wh));
function action(wh: WorkingHousehold, key: string): WorkingHousehold {
  const s = stage(wh);
  const a = s.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return settle(a.run(wh));
}
function fieldOf(wh: WorkingHousehold, suffix: string): FieldDef {
  const f = allFields(stage(wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1]): WorkingHousehold => settle(fieldOf(wh, suffix).set(wh, v));
const own = (wh: WorkingHousehold): Residence => (wh.request.input.household.residences ?? []).find((r) => r.kind === "own" && r.purchase === undefined)!;
const basisOf = (r: Residence): string => (r.propertyTax?.annual as { estimate?: { basis?: string } } | undefined)?.estimate?.basis ?? "";
const stagesOf = (r: Residence): Map<number, number> => new Map((r.propertyTax?.stages ?? []).map((s) => [Number((s.at.at ?? "").slice(0, 4)), Number(s.ratio)]));
const sum = (r: PreviewResult, row: string, year: number) => r.table.filter((c) => c.row === row && c.year === year).reduce((s, c) => s + c.amount, 0);

/** 今住んでいる持ち家に評価の欄を入れた世帯（評価額 → 時点 → 建った年 → 構造の順。画面の編集と同じ） */
function home(o: { value?: number; asOf?: string; built?: number; structure?: string; style?: string } = {}): WorkingHousehold {
  let wh = action(blankHousehold(BASE), "housing/addOwn");
  const id = own(wh).id;
  if (o.style !== undefined) wh = set(wh, `${id}/style`, o.style);
  wh = set(wh, `${id}/valuation/value`, o.value ?? 40000000);
  if (o.asOf !== undefined) wh = set(wh, `${id}/valuation/asOf`, o.asOf);
  if (o.built !== undefined) wh = set(wh, `${id}/valuation/builtYear`, o.built);
  if (o.structure !== undefined) wh = set(wh, `${id}/valuation/structure`, o.structure);
  return wh;
}

/** 別に書いた式（0112 の2。土地は時点の価格のまま、建物は評価替えごとに下げる。木造30年で下限20%） */
function expected(value: number, valueYear: number, built: number, y: number, relief = false): number {
  const reassess = (x: number) => 2024 + Math.floor((x - 2024) / 3) * 3;
  const g = (a: number) => Math.max(0.2, 1 - (0.8 * Math.max(0, a)) / 30);
  const land = value * 0.3 * 0.7;
  const b = (value * 0.7 * 0.6 * g(reassess(y) - built)) / g(reassess(valueYear) - built);
  return Math.round((land / 6 * 0.014 + (land / 3) * 0.003 + b * 0.014 * (relief ? 0.5 : 1) + b * 0.003) / 100) * 100;
}

afterEach(() => setOfficeEstimates({}));

describe("今住んでいる持ち家の固定資産税の推定（0112 の追記 2026-11-03）", () => {
  it("評価額を入れると、目安のボタンの値（年12万円）を評価の欄からの推定に変える", () => {
    let wh = action(blankHousehold(BASE), "housing/addOwn");
    expect(own(wh).propertyTax?.annual.value).toBe(120000);
    wh = set(wh, `${own(wh).id}/valuation/value`, 40000000);
    const r = own(wh);
    // 時点が空欄（計算の基準の年の評価額）・建った年が空欄（その年に建ったとみなす。軽減なし）
    expect(r.propertyTax?.annual).toMatchObject({ value: expected(40000000, 2026, 2026, 2026), state: "estimated", origin: { kind: "auto" } });
    expect(basisOf(r).startsWith(PROPERTY_TAX_BASIS)).toBe(true);
    expect(basisOf(r)).toContain("建った年が分からないので、2026年に建ったとみなし、新築の軽減は当てない");
    expect(fieldStatus(fieldOf(wh, `${r.id}/tax`), wh).status).toBe("estimated");
  });

  it("購入の価格と年月・建った年から、計算の基準の年の額と評価替えの段を出す（別に書いた式と同じ）", () => {
    const wh = home({ value: 40000000, asOf: "2010-04", built: 2010 });
    const r = own(wh);
    const first = expected(40000000, 2010, 2010, 2026);
    expect(r.propertyTax?.annual.value).toBe(first);
    expect(basisOf(r)).toContain("2026年の額");
    expect(basisOf(r)).toContain("2010年に建った（築16年）");
    expect(basisOf(r)).toContain("土地は2010年の価格のまま");
    const st = stagesOf(r);
    // 評価替えの年（2027年から3年ごと）に下がり、木造は築30年を超えると下限で止まる
    expect([...st.keys()]).toEqual([2027, 2030, 2033, 2036, 2039, 2042]);
    for (const [y, ratio] of st) expect(ratio).toBeCloseTo(expected(40000000, 2010, 2010, y) / first, 3);
    const last = (r.propertyTax?.stages ?? []).at(-1)!;
    expect(isAutoTaxStage(wh.request.input.household, r.id, last.id!)).toBe(true);
  });

  it("計算の結果: 計算の基準の年は欄の額、評価替えの年から段の割合の額", () => {
    const wh = home({ value: 40000000, asOf: "2010-04", built: 2010 });
    const r = own(wh);
    const p = preview(wh.request);
    const first = r.propertyTax!.annual.value!;
    expect(sum(p, "cf.expense.housing.propertyTax", 2026)).toBeGreaterThan(0);
    // 年4回の納付のうち、年の初めの1回は前の年度の額（購入の予定の推定と同じ）
    const st = stagesOf(r);
    expect(Math.abs(sum(p, "cf.expense.housing.propertyTax", 2027) - first * (0.25 + 0.75 * st.get(2027)!))).toBeLessThanOrEqual(4);
    expect(Math.abs(sum(p, "cf.expense.housing.propertyTax", 2045) - first * st.get(2042)!)).toBeLessThanOrEqual(4);
  });

  it("新築の軽減の間（建った年の翌年から戸建て3年）は建物の分が半分で、終わる年に上がる", () => {
    const wh = home({ value: 40000000, asOf: "2025-03", built: 2025 });
    const r = own(wh);
    expect(r.propertyTax?.annual.value).toBe(expected(40000000, 2025, 2025, 2026, true));
    expect(basisOf(r)).toContain("新築の軽減（建物の分が半分。2028年まで）");
    const st = stagesOf(r);
    expect(st.get(2027)).toBeLessThan(1);
    expect(st.get(2029)).toBeGreaterThan(st.get(2027)!);
    const row = (r.propertyTax?.stages ?? []).find((s) => s.at.at === "2029-01")!;
    expect(isAutoTaxStage(wh.request.input.household, r.id, row.id!)).toBe(true);
  });

  it("マンション（建て方）は鉄筋コンクリート造の年数で下げ、軽減は5年。この家の住宅ローンの控除が認定住宅なら長期優良住宅（7年）", () => {
    let wh = home({ style: "condo", value: 50000000, asOf: "2024-03", built: 2024 });
    expect(basisOf(own(wh))).toContain("マンション（鉄筋コンクリート造）");
    expect(basisOf(own(wh))).toContain("2029年まで");
    wh = action(wh, "housing/addMortgage");
    const req = structuredClone(wh.request);
    const d = (req.input.household.debts ?? [])[0]!;
    d.housing = { residence: own(wh).id, moveIn: "2024-03", propertyType: "certified", newBuild: true };
    wh = set({ ...wh, request: req }, `${own(wh).id}/valuation/builtYear`, 2024);
    wh = settle(fieldOf(wh, `${own(wh).id}/valuation/value`).set(wh, 50000001));
    expect(basisOf(own(wh))).toContain("長期優良住宅");
    expect(basisOf(own(wh))).toContain("2031年まで");
  });

  it("目安のボタンの値は、評価の欄でないほかの入力を直しても変えない（ひな形）", () => {
    let wh = action(blankHousehold(BASE), "housing/addOwn");
    const req = structuredClone(wh.request);
    own({ ...wh, request: req }).valuation = { value: { value: 30000000, state: "confirmed", origin: { kind: "manual" } }, asOf: "2015-01" };
    wh = settle({ ...wh, request: req });
    expect(own(wh).propertyTax?.annual.value).toBe(120000);
    wh = set(wh, `${own(wh).id}/maint`, 20000);
    expect(own(wh).propertyTax?.annual.value).toBe(120000);
    // 評価の欄を直したら推定に変える
    wh = set(wh, `${own(wh).id}/valuation/landShare`, "0.4");
    expect(basisOf(own(wh)).startsWith(PROPERTY_TAX_BASIS)).toBe(true);
  });

  it("推定のままの欄は、評価の欄を直すたびに入れ直す", () => {
    let wh = home({ value: 40000000, asOf: "2010-04", built: 2010 });
    const before = own(wh).propertyTax!.annual.value!;
    wh = set(wh, `${own(wh).id}/valuation/value`, 30000000);
    expect(own(wh).propertyTax?.annual.value).toBe(expected(30000000, 2010, 2010, 2026));
    expect(own(wh).propertyTax!.annual.value!).toBeLessThan(before);
  });

  it("FP が納税通知書の額を入れたら、その額が優先。推定の段（割合）は入れ直し続ける", () => {
    let wh = home({ value: 40000000, asOf: "2010-04", built: 2010 });
    const k = `${own(wh).id}/tax`;
    wh = set(wh, k, 150000);
    const ratio = stagesOf(own(wh)).get(2027)!;
    wh = set(wh, `${own(wh).id}/valuation/value`, 45000000);
    expect(own(wh).propertyTax?.annual).toMatchObject({ value: 150000, state: "confirmed" });
    // 割合は推定の最初の年の額（100円に丸めた額）に対する割合なので、価格を直すと丸めの分だけ動く
    expect(stagesOf(own(wh)).get(2027)).toBeCloseTo(ratio, 2);
    // 先に額を入れていた家に、評価の欄を入れても額は変えず、段も足さない
    let w2 = action(blankHousehold(BASE), "housing/addOwn");
    w2 = set(w2, `${own(w2).id}/tax`, 98000);
    w2 = set(w2, `${own(w2).id}/valuation/value`, 40000000);
    expect(own(w2).propertyTax?.annual.value).toBe(98000);
    expect(own(w2).propertyTax?.stages).toBeUndefined();
  });

  it("欄を空にすると評価の欄からの推定（評価額が無ければ目安のボタンの値）。「わからない」は推定を代わりの値にする", () => {
    let wh = home({ value: 40000000, asOf: "2010-04", built: 2010 });
    const k = `${own(wh).id}/tax`;
    wh = set(wh, k, 150000);
    wh = set(wh, k, null);
    expect(own(wh).propertyTax?.annual.value).toBe(expected(40000000, 2010, 2010, 2026));
    expect(basisOf(own(wh)).startsWith(PROPERTY_TAX_BASIS)).toBe(true);
    // 書類待ちで代わりの値がこの推定のままなら、評価の欄を直すと代わりの値を入れ直す
    const req = structuredClone(wh.request);
    const x = own({ ...wh, request: req });
    x.propertyTax!.annual = { state: "unknown", origin: { kind: "manual" }, substitute: x.propertyTax!.annual } as never;
    wh = set({ ...wh, request: req }, `${own(wh).id}/valuation/value`, 30000000);
    expect(own(wh).propertyTax?.annual.state).toBe("unknown");
    expect((own(wh).propertyTax?.annual as { substitute?: { value?: number } }).substitute?.value).toBe(expected(30000000, 2010, 2010, 2026));
    // 評価額の無い家は目安のボタンの値
    let w2 = action(blankHousehold(BASE), "housing/addOwn");
    w2 = set(w2, `${own(w2).id}/tax`, 50000);
    w2 = set(w2, `${own(w2).id}/tax`, null);
    expect(own(w2).propertyTax?.annual.value).toBe(120000);
  });

  it("固定資産税の欄が無い家（ヒアリングシートで空欄・「わからない」）は、評価の欄を入れたときに推定で埋める", () => {
    let wh = action(blankHousehold(BASE), "housing/addOwn");
    const req = structuredClone(wh.request);
    delete own({ ...wh, request: req }).propertyTax;
    wh = settle({ ...wh, request: req });
    expect(own(wh).propertyTax).toBeUndefined();
    wh = set(wh, `${own(wh).id}/valuation/value`, 40000000);
    expect(own(wh).propertyTax?.annual).toMatchObject({ value: expected(40000000, 2026, 2026, 2026), state: "estimated" });
  });

  it("評価額を消すと、推定のままの欄は目安のボタンの値に戻り、推定の段は外れる", () => {
    let wh = home({ value: 40000000, asOf: "2010-04", built: 2010 });
    wh = set(wh, `${own(wh).id}/valuation/value`, null);
    expect(own(wh).propertyTax?.annual.value).toBe(120000);
    expect(own(wh).propertyTax?.stages).toBeUndefined();
  });

  it("推定の段を外すと、入れ直しで足し直さない", () => {
    let wh = home({ value: 40000000, asOf: "2010-04", built: 2010 });
    const sid = taxStageId(own(wh).id, 2030);
    wh = action(wh, `/propertyTax/stage/${sid}/remove`);
    expect(stagesOf(own(wh)).has(2030)).toBe(false);
    wh = set(wh, `${own(wh).id}/valuation/value`, 42000000);
    expect(stagesOf(own(wh)).has(2030)).toBe(false);
    expect(stagesOf(own(wh)).has(2033)).toBe(true);
  });

  it("目安の割合は事務所の推定の値で変えられる", () => {
    setOfficeEstimates({ "preset.housing.propertyTax.cityPlanningRate": { value: "0", basis: "事務所の目安" } });
    const wh = home({ value: 40000000, asOf: "2010-04", built: 2010 });
    // 都市計画税がかからない所: 土地 840万×1/6×1.4%＝19,600、建物 1680万×(1−0.8×14/30)×1.4%
    const b = 16800000 * (1 - (0.8 * 14) / 30);
    expect(own(wh).propertyTax?.annual.value).toBe(Math.round((19600 + b * 0.014) / 100) * 100);
    expect(basisOf(own(wh))).toContain("都市計画税0%");
  });

  it("推定の式（純粋な関数）: 住み終わりの年までしか段を作らない", () => {
    const p = ownedHomeTaxPlan({ value: 40000000, valueYear: 2010, landShare: "0.3", structure: "wood", condo: false, builtYear: 2010, longLife: false, baseYear: 2026, lastYear: 2032 });
    expect(p.stages.map((s) => s.year)).toEqual([2027, 2030]);
    expect(p.firstYear).toBe(2026);
  });

  it("購入の予定の持ち家は今までどおり購入の推定（この推定は当てない）", () => {
    let wh = action(blankHousehold(BASE), "housing/addPurchase");
    const r = (wh.request.input.household.residences ?? []).find((x) => x.purchase !== undefined)!;
    expect((r.propertyTax?.annual as { estimate?: { basis?: string } }).estimate?.basis).toContain("物件の価格");
    wh = set(wh, `${r.id}/valuation/landShare`, "0.4");
    const r2 = (wh.request.input.household.residences ?? []).find((x) => x.purchase !== undefined)!;
    expect((r2.propertyTax?.annual as { estimate?: { basis?: string } }).estimate?.basis).toContain("物件の価格");
  });
});

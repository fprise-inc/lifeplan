// 注文住宅（土地を買って建てる。0115）: 住宅の購入の種類の「注文住宅」、土地の代金・土地の決済の時期・頭金と諸費用の内訳の推定、
// つなぎ融資の利息と手数料、土地の分のローン（土地先行融資）と住宅ローン控除の条件、引き渡しの前の支払い、固定資産税の推定、計算の結果
import { afterEach, describe, expect, it } from "vitest";
import type { Debt, PreviewResult, Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { purchaseTypeOf } from "../src/workspace/input/stages/housing.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { customBuildNotes } from "../src/workspace/input/customBuild.ts";
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
const hasAction = (wh: WorkingHousehold, key: string): boolean => stage(wh).sections.some((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)].some((a) => a.key.endsWith(key)));
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
const loans = (wh: WorkingHousehold): Debt[] => (wh.request.input.household.debts ?? []).filter((d) => d.kind === "mortgage");
const sum = (r: PreviewResult, row: string, year: number) => r.table.filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year).reduce((s, c) => s + c.amount, 0);

/** 住宅の購入を足し、引き渡しを 2029年3月（住み始めも）にして注文住宅を選ぶ（4,000万円・頭金400万円の既定のまま） */
function customHouse(): WorkingHousehold {
  let wh = action(salaried(), "housing/addPurchase");
  // 住み始めは購入の時期（引き渡し）についてくる（購入の1件に住み始めの欄は無い）
  wh = set(wh, "/purchase/at", "2029-03");
  return set(wh, "/purchase/type", "custom");
}

afterEach(() => setOfficeEstimates({}));

describe("注文住宅の種類と推定（0115）", () => {
  it("選ぶと土地を推定で足す: 土地の代金は合計の3割、土地の決済は引き渡しの9か月前、頭金は土地の代金まで土地の決済で、土地の諸費用は6%", () => {
    const wh = customHouse();
    const r = bought(wh);
    expect(r.style).toBe("house");
    expect(r.purchase?.newBuild).toBe(true);
    expect(r.purchase?.land).toMatchObject({ at: { at: "2028-06" }, price: 12000000, downPayment: 4000000, costs: 720000 });
    // 諸費用（合計）＝ 土地の諸費用 72万円 ＋ 建物の諸費用（2,800万円の5%）140万円（ローンを組まないので、つなぎ融資は無し）
    expect(r.purchase?.costs).toBe(2120000);
    expect(purchaseTypeOf(wh, r)).toEqual({ type: "custom", stored: true });
    // 標準の欄: 種類・引き渡しの時期・合計・土地の決済の時期・土地の代金・頭金・諸費用。建物の代金と内訳は詳細
    expect(fieldOf(wh, "/purchase/at").label).toBe("建物の引き渡しの時期");
    expect(fieldOf(wh, "/purchase/price").label).toBe("土地と建物の合計");
    expect(fieldOf(wh, "/purchase/land/at").level).toBe("simple");
    expect(fieldOf(wh, "/purchase/land/price").level).toBe("simple");
    expect(fieldOf(wh, "/purchase/building").level).toBe("detail");
    expect(fieldOf(wh, "/purchase/land/down").level).toBe("detail");
    expect(fieldOf(wh, "/purchase/land/costs").level).toBe("detail");
    for (const k of ["/purchase/land/price", "/purchase/land/at", "/purchase/costs"]) expect(fieldStatus(fieldOf(wh, k), wh).status, k).toBe("estimated");
    // 土地の割合の欄は出さない（土地の代金で分ける）
    expect(fieldMaybe(wh, "/valuation/landShare")).toBeUndefined();
  });

  it("合計・引き渡しを直すと推定のままの土地の代金・決済の時期・内訳がついていく。FP が入れた土地の代金は変えず、建物の代金を直すと合計が変わる", () => {
    let wh = customHouse();
    wh = set(wh, "/purchase/price", 50000000);
    expect(bought(wh).purchase?.land).toMatchObject({ price: 15000000, costs: 900000 });
    wh = set(wh, "/purchase/at", "2029-06");
    expect(bought(wh).purchase?.land?.at).toEqual({ at: "2028-09" });
    wh = set(wh, "/purchase/land/price", 20000000);
    wh = set(wh, "/purchase/price", 55000000);
    expect(bought(wh).purchase?.land?.price).toBe(20000000);
    expect(fieldOf(wh, "/purchase/building").get(wh).value).toBe(35000000);
    wh = set(wh, "/purchase/building", 30000000);
    expect(bought(wh).purchase?.price).toBe(50000000);
    expect(bought(wh).purchase?.land?.price).toBe(20000000);
    // 推定のままの諸費用は、土地 6%（120万円）＋建物 5%（150万円）
    expect(bought(wh).purchase?.costs).toBe(2700000);
  });

  it("住宅ローンを組むと、引き渡しまでの支払いはつなぎ融資とみなし、利息と手数料を諸費用に入れる。借入額は合計−頭金の1本", () => {
    const wh = action(customHouse(), "housing/addMortgage");
    const [main] = loans(wh);
    expect(main?.start).toEqual({ at: "2029-03" });
    expect(main?.principal).toBe(36000000);
    // つなぎ融資: 土地の借りる分 800万円×3%×9か月 ＝ 18万円、着工金・中間金 1,680万円（2,800万円の6割）×3%×3か月 ＝ 12.6万円、手数料 10万円 → 41万円
    expect(bought(wh).purchase?.costs).toBe(720000 + 1400000 + 410000);
    const states = (bought(wh).valueStates ?? {}) as Record<string, { estimate?: { basis?: string } }>;
    expect(states["residence.purchase/costs"]?.estimate?.basis).toContain("つなぎ融資");
    // 控除の仮の条件: 入居は引き渡し、取得対価は合計
    expect(main?.housing).toMatchObject({ residence: bought(wh).id, newBuild: true, acquisitionCost: 40000000 });
  });

  it("土地の分のローン（土地先行融資）: 土地の決済の月に借り、借入額は土地の代金−土地の決済の頭金。引き渡しのローンは残り。控除は2本とも入居（引き渡し）から", () => {
    let wh = action(customHouse(), "housing/addMortgage");
    expect(hasAction(wh, "/purchase/addLandLoan")).toBe(true);
    wh = action(wh, "/purchase/addLandLoan");
    expect(hasAction(wh, "/purchase/addLandLoan")).toBe(false);
    const land = loans(wh).find((d) => d.start.at === "2028-06")!;
    const main = loans(wh).find((d) => d.start.at === "2029-03")!;
    expect(land.principal).toBe(8000000);
    expect(main.principal).toBe(28000000);
    const events = wh.request.input.household.events ?? [];
    const moveIn = (d: Debt) => events.find((e) => e.id === d.housing?.moveIn)?.at;
    expect(moveIn(land)).toEqual({ at: "2029-03" });
    expect(moveIn(main)).toEqual({ at: "2029-03" });
    expect(land.housing).toMatchObject({ residence: bought(wh).id, acquisitionCost: 12000000 });
    expect(land.housing?.creditDisabled).toBeUndefined();
    expect(main.housing).toMatchObject({ acquisitionCost: 28000000 });
    // つなぎ融資は着工金・中間金の分だけ（12.6万円＋手数料10万円 → 23万円）
    expect(bought(wh).purchase?.costs).toBe(720000 + 1400000 + 230000);
    const p = preview(wh.request);
    // 土地の決済の年（2028年）から土地のローンを返し、資産に土地が載る
    expect(sum(p, "cf.balance.account.realEstate", 2028)).toBe(12000000);
    expect(sum(p, "cf.balance.debt", 2028)).toBeGreaterThan(7500000);
    expect(sum(p, "cf.balance.account.realEstate", 2029)).toBeGreaterThanOrEqual(39000000);
  });

  it("土地の決済から引き渡しまで2年を超えると、土地の分のローンは控除の対象にしない（知らせも出す）", () => {
    let wh = action(customHouse(), "housing/addMortgage");
    wh = set(wh, "/purchase/land/at", "2026-12");
    wh = action(wh, "/purchase/addLandLoan");
    const land = loans(wh).find((d) => d.start.at === "2026-12")!;
    expect(land.housing?.creditDisabled).toBe(true);
    expect(customBuildNotes(wh.request.input.household, bought(wh)).join("")).toContain("2年を超える");
    expect(customBuildNotes(wh.request.input.household, bought(wh)).join("")).toContain("土地の固定資産税");
  });

  it("頭金と諸費用は土地の決済の月と引き渡しの月に分けて払う。建物の代金の支払いを足すと、その月に頭金から払う（合計は変わらない）", () => {
    let wh = customHouse();
    wh = set(wh, "/purchase/down", 6000000);
    wh = set(wh, "/purchase/land/down", 3000000);
    wh = action(wh, "/purchase/addPayment");
    const pid = bought(wh).purchase?.payments?.[0]?.id as string;
    expect(bought(wh).purchase?.payments?.[0]).toMatchObject({ at: { at: "2028-09" }, kind: "start" });
    wh = set(wh, `/purchase/payment/${pid}/at`, "2028-11");
    wh = set(wh, `/purchase/payment/${pid}/amount`, 1000000);
    const p = preview(wh.request);
    expect(sum(p, "cf.expense.housing.purchase.downPayment", 2028)).toBe(4000000);
    expect(sum(p, "cf.expense.housing.purchase.downPayment", 2029)).toBe(2000000);
    expect(sum(p, "cf.expense.housing.purchase.costs", 2028)).toBe(720000);
    expect(sum(p, "cf.expense.housing.purchase.costs", 2029)).toBe(1400000);
    // 2028年の年末は土地だけ（建物は引き渡しの年から）
    expect(sum(p, "cf.balance.account.realEstate", 2028)).toBe(12000000);
  });

  it("固定資産税の推定は土地と建物の代金から（新築の戸建ての軽減）", () => {
    const wh = customHouse();
    const box = bought(wh).propertyTax?.annual as { value: number; estimate?: { basis: string } };
    expect(box.estimate?.basis).toContain("注文住宅");
    expect(box.estimate?.basis).toContain("土地の代金1,200万円");
    // 土地 1,200万円×70%×1/6×1.4% ＋ ×1/3×0.3%、建物 2,800万円×40%（新築の評価額。0181）×1.4%×1/2 ＋ ×0.3%
    const L = 12000000 * 0.7;
    const B = 28000000 * 0.4;
    expect(box.value).toBe(Math.round((L / 6 * 0.014 + L / 3 * 0.003 + B * 0.014 * 0.5 + B * 0.003) / 100) * 100);
  });

  it("ほかの種類にすると土地と引き渡しの前の支払いを外し、前の購入の形に戻る", () => {
    let wh = action(customHouse(), "/purchase/addPayment");
    wh = set(wh, "/purchase/type", "newHouse");
    const r = bought(wh);
    expect(r.purchase?.land).toBeUndefined();
    expect(r.purchase?.payments).toBeUndefined();
    expect(Object.keys(r.valueStates ?? {}).some((k) => k.startsWith("residence.purchase/land/"))).toBe(false);
    expect(r.purchase?.costs).toBe(2000000);
    expect(fieldMaybe(wh, "/purchase/land/price")).toBeUndefined();
  });
});

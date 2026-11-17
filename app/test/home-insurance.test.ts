// 住宅購入の予定の火災保険・地震保険（0221）: 目安（建物の種類・構造・都道府県・年数）、推定で足す・入れ直す、FP が入れた額を変えない、
// 前に買った家・今の持ち家には足さない、保険の入力項目の損害保険との二重の計上の注意、計算の表と地震保険料控除、見本の世帯
import { afterEach, describe, expect, it } from "vitest";
import type { PreviewResult, Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { checkList, ackedRows } from "../src/workspace/input/checkRows.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { FIRE_BASIS, homeInsuranceEstimate, QUAKE_BASIS, QUAKE_LAW } from "../src/workspace/input/homeInsurance.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { setOfficeEstimates } from "../../hearing/src/statistics.ts";
import { modelHousehold, preview } from "./helpers.ts";

const settle = (wh: WorkingHousehold) => withProvisionalHousing(withRefreshedEstimates(wh));
function action(wh: WorkingHousehold, stageId: StageId, key: string): WorkingHousehold {
  const s = buildStage(stageId, wh);
  const a = s.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return settle(a.run(wh));
}
const fieldMaybe = (wh: WorkingHousehold, suffix: string): FieldDef | undefined => allFields(buildStage("housing", wh)).find((x) => x.key.endsWith(suffix));
function fieldOf(wh: WorkingHousehold, suffix: string): FieldDef {
  const f = fieldMaybe(wh, suffix);
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1]): WorkingHousehold => settle(fieldOf(wh, suffix).set(wh, v));
function salaried(base = "2026-10"): WorkingHousehold {
  let wh = blankHousehold(base);
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!;
  return annual.set(wh, 6000000);
}
const bought = (wh: WorkingHousehold): Residence => (wh.request.input.household.residences ?? []).find((r) => r.purchase !== undefined)!;
const ins = (wh: WorkingHousehold) => bought(wh).purchase?.homeInsurance;
const sum = (r: PreviewResult, row: string, year: number) => r.table.filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year).reduce((s, c) => s + c.amount, 0);
const run = (wh: WorkingHousehold) => preview(forEngine(wh.request));

afterEach(() => setOfficeEstimates({}));

describe("目安の式（建物の種類ごと）", () => {
  const base = { building: 28000000, newBuild: true, years: 5 } as const;
  it("新築の木造の戸建て（4,000万円・土地3割）: 火災保険 H構造 91,000円・地震保険 ロ構造（都道府県が分からない＝いちばん高い区分）243,400円", () => {
    const e = homeInsuranceEstimate({ ...base, condo: false, structure: "wood" });
    expect(e).toMatchObject({ insured: 28000000, quakeInsured: 14000000, fire: 91000, earthquake: 243400 });
    expect(e.fireBasis.startsWith(FIRE_BASIS)).toBe(true);
    expect(e.earthquakeBasis.startsWith(QUAKE_BASIS)).toBe(true);
    expect(e.earthquakeBasis).toContain("いちばん高い区分");
  });
  it("新築マンション: 専有部分（建物の分の50%）1,400万円・M構造 25,100円、地震保険 イ構造 700万円 81,400円", () => {
    expect(homeInsuranceEstimate({ ...base, condo: true, structure: "rc" })).toMatchObject({ insured: 14000000, fire: 25100, quakeInsured: 7000000, earthquake: 81400 });
  });
  it("鉄骨造の戸建ては T構造・イ構造", () => {
    expect(homeInsuranceEstimate({ ...base, condo: false, structure: "steel" })).toMatchObject({ fire: 61600, earthquake: 162900 });
  });
  it("中古: 建った年が1982年から後は建築年割引10%、分からないか1981年までは割引なし。保険金額は築年数で下げない", () => {
    const used = { building: 21000000, condo: false, structure: "wood", newBuild: false, years: 5 } as const;
    expect(homeInsuranceEstimate({ ...used, builtYear: 1995 })).toMatchObject({ insured: 21000000, fire: 68300, earthquake: 182500 });
    expect(homeInsuranceEstimate({ ...used, builtYear: 1980 }).earthquake).toBe(202800);
    expect(homeInsuranceEstimate(used).earthquakeBasis).toContain("割引なし");
  });
  it("都道府県で地震保険の料率が変わる（北海道 ロ構造 11,200円・大阪府 19,500円）", () => {
    const wood = { ...base, condo: false, structure: "wood" } as const;
    expect(homeInsuranceEstimate({ ...wood, prefecture: "01" }).earthquake).toBe(66300);
    expect(homeInsuranceEstimate({ ...wood, prefecture: "27" }).earthquake).toBe(115500);
    expect(homeInsuranceEstimate({ ...wood, prefecture: "13" }).earthquake).toBe(243400);
    expect(Object.keys(QUAKE_LAW.rates)).toHaveLength(47);
  });
  it("契約の年数1年: 火災保険は5年分÷4.70、地震保険は長期係数なし", () => {
    expect(homeInsuranceEstimate({ ...base, condo: false, structure: "wood", years: 1 })).toMatchObject({ fire: 19400, earthquake: 51800 });
  });
  it("地震保険の保険金額は5,000万円で止める", () => {
    expect(homeInsuranceEstimate({ ...base, building: 150000000, condo: false, structure: "wood" }).quakeInsured).toBe(50000000);
  });
  it("事務所の推定の値で火災保険の率を変えられる", () => {
    setOfficeEstimates({ "preset.housing.homeInsurance.fire.h": { value: 50000, basis: "事務所の目安" } });
    expect(homeInsuranceEstimate({ ...base, condo: false, structure: "wood" }).fire).toBe(140000);
  });
});

describe("住宅購入の予定の欄（0221）", () => {
  it("住宅購入の予定を足すと、5年分の火災保険・地震保険を推定で入れる。保険料の欄は標準、年数・都道府県・印は詳細", () => {
    const wh = action(salaried(), "housing", "housing/addPurchase");
    expect(ins(wh)).toMatchObject({ years: 5, fire: { state: "estimated", value: 91000 }, earthquake: { state: "estimated", value: 243400 } });
    expect(fieldOf(wh, "/purchase/insurance/fire")).toMatchObject({ level: "simple", label: "火災保険料（5年分）" });
    expect(fieldOf(wh, "/purchase/insurance/earthquake")).toMatchObject({ level: "simple", label: "地震保険料（5年分）" });
    for (const k of ["years", "prefecture", "counted"]) expect(fieldOf(wh, `/purchase/insurance/${k}`).level).toBe("detail");
    expect(fieldStatus(fieldOf(wh, "/purchase/insurance/fire"), wh).status).toBe("estimated");
    // 諸費用の説明文: 火災保険・地震保険は別の欄
    expect(fieldOf(wh, "/purchase/costs").help).toContain("火災保険・地震保険は下の別の欄");
    expect(fieldOf(wh, "/purchase/costs").help).not.toContain("保険料・税");
  });

  it("購入の種類・都道府県・年数を変えると推定のままの保険料を出し直す。FP が入れた額は変えない。空にすると推定に戻る", () => {
    let wh = action(salaried(), "housing", "housing/addPurchase");
    wh = set(wh, "/purchase/type", "newCondo");
    expect(ins(wh)).toMatchObject({ fire: { value: 25100 }, earthquake: { value: 81400 } });
    wh = set(wh, "/purchase/insurance/prefecture", "01");
    expect(ins(wh)?.earthquake.value).toBe(Math.round((0.7 * 7300 * 0.9 * 4.7) / 100) * 100);
    wh = set(wh, "/purchase/insurance/years", 1);
    expect(fieldOf(wh, "/purchase/insurance/fire").label).toBe("火災保険料（1年分）");
    expect(ins(wh)?.fire.value).toBe(5300);
    wh = set(wh, "/purchase/insurance/fire", 120000);
    expect(ins(wh)?.fire).toMatchObject({ value: 120000, state: "confirmed" });
    wh = set(wh, "/purchase/type", "usedCondo");
    expect(ins(wh)?.fire.value).toBe(120000);
    wh = set(wh, "/purchase/insurance/fire", null);
    expect(ins(wh)?.fire.state).toBe("estimated");
    // 地震保険を付けないなら0円
    wh = set(wh, "/purchase/insurance/earthquake", 0);
    expect(ins(wh)?.earthquake).toMatchObject({ value: 0, state: "confirmed" });
  });

  it("注文住宅: 土地と建物の合計から土地の代金を引いた建物の分で見る", () => {
    let wh = action(salaried(), "housing", "housing/addPurchase");
    wh = set(wh, "/purchase/type", "custom");
    const r = bought(wh);
    const building = r.purchase!.price - r.purchase!.land!.price;
    expect(ins(wh)?.fire.value).toBe(Math.round(((Math.round(building / 100000) * 100000) / 10000000) * 32500 / 100) * 100);
  });

  it("今住んでいる持ち家（購入の予定ではない）・賃貸には足さない。前に買った家（購入の月が計算基準月より前）にも足さない", () => {
    const own = action(salaried(), "housing", "housing/addOwn");
    expect((own.request.input.household.residences ?? []).some((r) => r.purchase?.homeInsurance !== undefined)).toBe(false);
    let wh = action(salaried(), "housing", "housing/addPurchase");
    const req = structuredClone(wh.request);
    const r = (req.input.household.residences ?? []).find((x) => x.purchase !== undefined)!;
    delete r.purchase!.homeInsurance;
    r.purchase!.at = { at: "2025-04" };
    r.from = { at: "2025-04" };
    wh = settle({ ...wh, request: req });
    expect(ins(wh)).toBeUndefined();
    // 欄も出さない（本当の契約は保険の入力項目で入れる）
    expect(fieldMaybe(wh, "/purchase/insurance/fire")).toBeUndefined();
  });
});

describe("保険の入力項目の損害保険と二重に数えない（0221）", () => {
  const withNonLife = () => action(action(salaried(), "housing", "housing/addPurchase"), "insurance", "ins/addNonLife");
  const notice = (wh: WorkingHousehold) => checkList(wh).find((r) => r.id.startsWith("notice:housing/homeInsurance/"));

  it("損害保険が無ければ注意は出ない", () => {
    expect(notice(action(salaried(), "housing", "housing/addPurchase"))).toBeUndefined();
  });

  it("損害保険があれば確かめの注意と欄の横の文。「保険の入力項目で入れた」で数えなくなり、計算からも外れる", () => {
    const wh = withNonLife();
    const n = notice(wh)!;
    expect(n.detail).toContain("二重に数えています");
    expect(fieldOf(wh, "/purchase/insurance/fire").get(wh).hint).toContain("損害保険が1件");
    const before = run(wh);
    const year = Number(wh.request.input.baseMonth.slice(0, 4)) + 2;
    expect(sum(before, "cf.expense.housing.insurance", year)).toBe(91000 + 243400);
    const fixed = settle(n.actions.find((a) => a.key === "fix")!.run(wh));
    expect(ins(fixed)?.countedInInsurance).toBe(true);
    expect(notice(fixed)).toBeUndefined();
    expect(fieldOf(fixed, "/purchase/insurance/counted").level).toBe("simple");
    expect(fieldOf(fixed, "/purchase/insurance/fire").get(fixed).hint).toContain("数えていません");
    expect(run(fixed).table.some((c) => c.row === "cf.expense.housing.insurance")).toBe(false);
  });

  it("「確認した」で出さなくなり、損害保険を足すとまた出る", () => {
    const wh = withNonLife();
    const acked = notice(wh)!.actions.find((a) => a.key === "ack")!.run(wh);
    expect(notice(acked)).toBeUndefined();
    expect(ackedRows(acked).some((r) => r.id.startsWith("notice:housing/homeInsurance/"))).toBe(true);
    expect(notice(action(acked, "insurance", "ins/addNonLife"))).toBeDefined();
  });
});

describe("計算（表と地震保険料控除）", () => {
  it("計算基準月が1〜3月・買う月が12月: 買った月の年と5年後に払い、地震保険料控除で税が下がる", () => {
    let wh = action(salaried("2027-02"), "housing", "housing/addPurchase");
    wh = set(wh, "/purchase/at", "2028-12");
    expect(wh.request.input.household.residences?.find((r) => r.purchase)?.purchase?.homeInsurance).toBeDefined();
    const r = run(wh);
    expect(sum(r, "cf.expense.housing.insurance", 2028)).toBe(91000 + 243400);
    expect(sum(r, "cf.expense.housing.insurance", 2029)).toBe(0);
    expect(sum(r, "cf.expense.housing.insurance", 2033)).toBe(91000 + 243400);
    // 地震保険を0円にすると、2030年の所得税が増える（2028年に払った5年分の5分の1の控除が無くなる）
    const noQuake = run(set(wh, "/purchase/insurance/earthquake", 0));
    const tax = (x: PreviewResult, y: number) => sum(x, "cf.taxSi.incomeTax", y);
    expect(tax(noQuake, 2030)).toBeGreaterThan(tax(r, 2030));
  });

  it("買う月が1月でも同じ（その月から5年ごと）", () => {
    let wh = action(salaried("2027-01"), "housing", "housing/addPurchase");
    wh = set(wh, "/purchase/at", "2029-01");
    const r = run(wh);
    expect(sum(r, "cf.expense.housing.insurance", 2029)).toBeGreaterThan(0);
    expect(sum(r, "cf.expense.housing.insurance", 2034)).toBeGreaterThan(0);
    expect(sum(r, "cf.expense.housing.insurance", 2033)).toBe(0);
  });
});

describe("見本の世帯", () => {
  it.each(["housingPurchase", "housingGiftFromParents", "lifetime100Assets", "lifetime100Plan"])("%s は画面と同じ推定の火災保険・地震保険を持ち、開いても変わらない", (id) => {
    const req = modelHousehold(id);
    const wh = { ...blankHousehold(req.input.baseMonth), request: req } as WorkingHousehold;
    expect((req.input.household.residences ?? []).some((r) => r.purchase?.homeInsurance?.fire.state === "estimated")).toBe(true);
    expect(withRefreshedEstimates(wh).request).toEqual(req);
  });

  it("住宅購入の予定の無い見本の世帯には足さない", () => {
    for (const id of ["salariedCoupleTwoKids", "sampleSeniorCouple", "rentalSample"]) {
      const req = modelHousehold(id);
      const wh = { ...blankHousehold(req.input.baseMonth), request: req } as WorkingHousehold;
      expect(JSON.stringify(withRefreshedEstimates(wh).request)).not.toContain("homeInsurance");
    }
  });
});

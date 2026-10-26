// 住まい・ローンと保険の入力の不具合の直し: 住宅ローン控除の仮の条件・購入の予定とつながる借入額・保険の種類を変えたときの保障・持ち家の建った年
import { describe, expect, it } from "vitest";
import type { Debt, EngineRequest, InsuranceContract, PreviewResult } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { valuationHint } from "../src/workspace/input/stages/housing.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";

function action(wh: WorkingHousehold, key: string): WorkingHousehold {
  const stage = buildStage(key.startsWith("ins/") ? "insurance" : "housing", wh);
  const a = stage.sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return a.run(wh);
}

function fieldOf(wh: WorkingHousehold, stage: "housing" | "insurance", suffix: string): FieldDef {
  const f = allFields(buildStage(stage, wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}

/** 本人の所得税の合計（年ごと） */
function incomeTax(r: PreviewResult, year: number): number {
  return r.table.filter((c) => c.row === "cf.taxSi.incomeTax" && c.year === year).reduce((s, c) => s + c.amount, 0);
}

/** 会社員の本人（年収600万円）の空の世帯 */
function salaried(): WorkingHousehold {
  let wh = blankHousehold(BASE);
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!;
  return annual.set(wh, 6000000);
}

const loans = (wh: WorkingHousehold): Debt[] => (wh.request.input.household.debts ?? []).filter((d) => d.kind === "mortgage");
const withoutHousing = (req: EngineRequest): EngineRequest => {
  const r = structuredClone(req);
  for (const d of r.input.household.debts ?? []) delete d.housing;
  return r;
};

/** 今住んでいる持ち家の住宅ローンを「借入額から」で入れる（今の残高からのローンには控除の仮の条件を置かないため） */
const ownLoanByPrincipal = (wh0: WorkingHousehold): WorkingHousehold => {
  const wh = action(action(wh0, "housing/addOwn"), "housing/addMortgage");
  const d = loans(wh)[0]!;
  return withProvisionalHousing(fieldOf(wh, "housing", `${d.id}/entry`).set(wh, "principal"));
};

describe("住宅ローン控除の仮の条件", () => {
  it("「借入額から」入れたローンは、仮の条件で住宅ローン控除を計算し、「仮」の印を出す", () => {
    const wh = ownLoanByPrincipal(salaried());
    const d = loans(wh)[0]!;
    expect(d.housing).toMatchObject({ propertyType: "energySaving", newBuild: true });
    const ev = wh.request.input.household.events?.find((e) => e.id === d.housing?.moveIn);
    expect(ev).toMatchObject({ kind: "moveIn", at: { at: BASE } });
    const summary = fieldOf(wh, "housing", `${d.id}/creditSummary`);
    expect(summary.readOnly).toBeDefined();
    expect(summary.get(wh).assumed).toContain("仮の条件");
    expect(String(summary.get(wh).value)).toContain("入居 2026年10月");
    // 印は住宅の種類の欄（簡易）が持つ
    const credit = fieldOf(wh, "housing", `${d.id}/credit`);
    expect(credit.get(wh)).toMatchObject({ value: "energySaving" });
    expect(credit.get(wh).assumed).toContain("仮の条件");
    // 今の持ち家の評価額は未入力の警告（0円で数えている）。入れるとカードは「推定あり」
    expect(inputItems(wh).find((i) => i.id === "housing")?.status).toBe("missing");
    const valued = fieldOf(wh, "housing", "/valuation/value").set(wh, 35000000);
    expect(inputItems(valued).find((i) => i.id === "housing")?.status).toBe("est");
    // 控除の分だけ所得税が下がる（2027年分。年末残高×0.7%）
    const r = preview(wh.request);
    const none = preview(withoutHousing(wh.request));
    expect(incomeTax(none, 2027) - incomeTax(r, 2027)).toBeGreaterThan(100000);
  });

  it("借入の年月を直すと、仮の条件の入居の年月もついていく。直すまでは印が残る", () => {
    let wh = ownLoanByPrincipal(salaried());
    const d = loans(wh)[0]!;
    wh = withProvisionalHousing(fieldOf(wh, "housing", `${d.id}/start`).set(wh, "2026-04"));
    const d2 = loans(wh)[0]!;
    expect(wh.request.input.household.events?.find((e) => e.id === d2.housing?.moveIn)?.at).toEqual({ at: "2026-04" });
    expect(wh.request.input.household.events?.filter((e) => e.kind === "moveIn")).toHaveLength(1);
  });

  it("持ち家の建った年が入居より前なら中古の一般の住宅、購入の予定なら物件の価格を取得対価にする", () => {
    let wh = ownLoanByPrincipal(salaried());
    wh = withProvisionalHousing(fieldOf(wh, "housing", "/valuation/builtYear").set(wh, 2005));
    expect(loans(wh)[0]!.housing).toMatchObject({ propertyType: "other", newBuild: false });
    const p = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const own = p.request.input.household.residences!.find((r) => r.purchase !== undefined)!;
    expect(loans(p)[0]!.housing).toMatchObject({ residence: own.id, acquisitionCost: 40000000, newBuild: true });
  });

  it("ローンを外すと、仮の条件のために置いた入居のイベントと印も外れる", () => {
    const wh = ownLoanByPrincipal(salaried());
    const d = loans(wh)[0]!;
    const w = action(wh, `housing/debt/${d.id}/remove`);
    expect(w.request.input.household.events ?? []).toEqual([]);
    expect(Object.keys(w.assumed).filter((k) => k.includes(d.id))).toEqual([]);
    expect(() => preview(w.request)).not.toThrow();
  });

  it("開いた世帯の、控除の条件の無いローンにも仮の条件を置く（平成25年以前に借りたローンには置かない）", () => {
    const req = modelHousehold("housingPurchase");
    const d = req.input.household.debts![0]!;
    delete d.housing;
    const wh = withProvisionalHousing(fromRequest(req));
    expect(loans(wh)[0]!.housing).toMatchObject({ propertyType: "energySaving", newBuild: true, acquisitionCost: 45000000 });
    expect(wh.assumed[`housing/debt/${d.id}/credit`]).toContain("仮の条件");
    expect(() => preview(wh.request)).not.toThrow();
    // 条件の入っているローンは変えない
    const kept = fromRequest(modelHousehold("housingPurchase"));
    expect(withProvisionalHousing(kept)).toBe(kept);
    // 2013年3月に借りたローン（制度データの前）は置かない
    const early = modelHousehold("protectionNeed");
    early.input.household.debts![0]!.start = { at: "2013-03" };
    const old = fromRequest(early);
    expect(withProvisionalHousing(old)).toBe(old);
    expect(String(fieldOf(old, "housing", "/creditSummary").get(old).value)).toContain("2013年以前");
    // 2021年3月に借りたローン（平成26〜令和3年の制度データ）には置く
    const r3 = withProvisionalHousing(fromRequest(modelHousehold("protectionNeed")));
    expect(loans(r3)[0]!.housing).toMatchObject({ propertyType: "energySaving", newBuild: true });
    expect(() => preview(r3.request)).not.toThrow();
  });
});

describe("住宅ローンの借入額と購入の予定", () => {
  it("購入の予定があれば、借入額は物件の価格−頭金（推定）で、購入の月に借りる", () => {
    const wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const d = loans(wh)[0]!;
    expect(d.principal).toBe(36000000);
    expect(d.start).toEqual({ at: "2028-10" });
    const f = fieldOf(wh, "housing", `${d.id}/principal`);
    expect(f.get(wh)).toMatchObject({ value: 36000000, warn: null });
    expect(f.get(wh).estimated).toContain("物件の価格から頭金");
  });

  it("推定の間は価格・頭金に合わせて入れ直し、FP が入れると確定になって、合わなければ知らせる", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const id = loans(wh)[0]!.id;
    // 頭金も推定（物件の価格の1割）なので、価格に合わせて入れ直る
    wh = withProvisionalHousing(fieldOf(wh, "housing", "/purchase/price").set(wh, 50000000));
    expect(wh.request.input.household.residences!.find((r) => r.purchase !== undefined)!.purchase!.downPayment).toBe(5000000);
    expect(loans(wh)[0]!.principal).toBe(45000000);
    const f = fieldOf(wh, "housing", `${id}/principal`);
    wh = f.set(wh, 30000000);
    expect(f.get(wh).estimated).toBeNull();
    expect(f.get(wh).warn).toContain("1,500万円ずれています");
    wh = withProvisionalHousing(fieldOf(wh, "housing", "/purchase/price").set(wh, 45000000));
    expect(loans(wh)[0]!.principal).toBe(30000000);
    // 空にすると推定に戻る
    wh = f.set(wh, null);
    expect(loans(wh)[0]!.principal).toBe(40500000);
    expect(f.get(wh).estimated).toContain("物件の価格から頭金");
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("今住んでいる持ち家の住宅ローンは「今の残高から」: 今の残高3,000万円（目安）で、借りた年と借入額は仮、控除の仮の条件は置かない", () => {
    const wh = withProvisionalHousing(action(action(salaried(), "housing/addOwn"), "housing/addMortgage"));
    const d = loans(wh)[0]!;
    expect(wh.loanEntry?.[d.id]).toBe("balance");
    expect(d).toMatchObject({ principal: 30000000, start: { at: BASE }, balance: { value: 30000000, state: "estimated" }, balanceAsOf: BASE });
    expect(d.housing).toBeUndefined();
    expect(fieldOf(wh, "housing", `${d.id}/principal`).get(wh)).toMatchObject({ estimated: null, warn: null });
    expect(String(fieldOf(wh, "housing", `${d.id}/creditSummary`).get(wh).value)).toContain("借りた年が分からない");
  });
});

describe("保険の種類を変えたときの保障（0055 のひな形）", () => {
  const added = () => action(salaried(), "ins/add");
  const contract = (wh: WorkingHousehold): InsuranceContract => wh.request.input.household.insuranceContracts![0]!;

  it("医療保険に変えると、主契約の死亡保険金を外し、入院日額の主契約（未入力）と手術の特約を置く（万一の計算に入らない死亡保険金を残さない）", () => {
    const wh = added();
    const w = fieldOf(wh, "insurance", "/template").set(wh, "medical");
    expect(contract(w).coverages?.map((x) => `${x.role}:${x.benefit}:${x.amount}`)).toEqual(["main:hospitalDaily:0", "rider:surgery:0"]);
    expect(contract(w)).toMatchObject({ template: "insurance.medical", subtype: "medical" });
    expect(fieldOf(w, "insurance", "/main").label).toBe("入院日額（1日）");
    expect(() => preview(w.request)).not.toThrow();
  });

  it("医療の給付は特約に回して残し、死亡保障の種類に戻すと死亡保険金0円の主契約を置く", () => {
    let wh = added();
    wh = fieldOf(wh, "insurance", "/template").set(wh, "medical");
    wh = fieldOf(wh, "insurance", "/main").set(wh, 5000);
    wh = fieldOf(wh, "insurance", "/template").set(wh, "wholeLife");
    expect(contract(wh).coverages?.map((x) => `${x.role}:${x.benefit}:${x.amount}`)).toEqual(["main:death:0", "rider:hospitalDaily:5000", "rider:surgery:50000"]);
    expect(fieldOf(wh, "insurance", "/main").get(wh).value).toBe(0);
  });

  it("定期保険と終身保険のあいだは、死亡保険金をそのまま持つ", () => {
    let wh = added();
    wh = fieldOf(wh, "insurance", "/main").set(wh, 10000000);
    const w = fieldOf(wh, "insurance", "/template").set(wh, "wholeLife");
    expect(contract(w).coverages?.map((x) => `${x.benefit}:${x.amount}`)).toEqual(["death:10000000"]);
  });
});

describe("持ち家の建った年", () => {
  it("今住んでいる持ち家は、建った年を空欄で見せる（今年を出さない）", () => {
    const wh = action(blankHousehold(BASE), "housing/addOwn");
    const f = fieldOf(wh, "housing", "/valuation/builtYear");
    expect(f.get(wh).value).toBeNull();
    expect(f.help).toContain("2026年");
  });

  it("購入の予定の持ち家は、購入の年の新築として見せる", () => {
    const wh = action(blankHousehold(BASE), "housing/addPurchase");
    expect(fieldOf(wh, "housing", "/valuation/builtYear").get(wh)).toMatchObject({ value: 2028, implicit: true });
  });

  it("前の時点の額（購入の価格など）を入れたら、今年の評価額の目安を出す", () => {
    let wh = action(blankHousehold(BASE), "housing/addOwn");
    wh = fieldOf(wh, "housing", "/valuation/value").set(wh, 30000000);
    expect(fieldOf(wh, "housing", "/valuation/value").get(wh).hint).toBeNull();
    wh = fieldOf(wh, "housing", "/valuation/asOf").set(wh, "2016-04");
    wh = fieldOf(wh, "housing", "/valuation/builtYear").set(wh, 2016);
    // 土地 900万円を物価上昇率1%で10年、建物 2,100万円は木造22年のうち10年で (1−10/22) → 約1,145万円
    const hint = String(fieldOf(wh, "housing", "/valuation/value").get(wh).hint);
    expect(hint).toContain("2026年の評価額の目安");
    expect(hint).toContain("建物 1,145万円");
    expect(hint).toContain("土地 994万円");
  });

  it("評価額の目安は、計算エンジンの評価額（計算基準年の土地と建物）と万円の単位で合う（モデル世帯）", () => {
    let checked = 0;
    for (const id of ["dualAssetsTwoKids", "investmentCouple", "salariedCoupleTwoKids", "sampleExecutive", "sampleSelfEmployedFamily", "sampleSeniorCouple", "sampleSingle40s"]) {
      const wh = fromRequest(modelHousehold(id));
      const r = preview(wh.request);
      const year = Number(wh.request.input.baseMonth.slice(0, 4));
      for (const res of wh.request.input.household.residences ?? []) {
        const hint = valuationHint(wh, res);
        if (hint === null) continue;
        const cell = (row: string) => r.table.filter((c) => c.row === row && c.year === year && c.object === res.id).reduce((s, c) => s + c.amount, 0);
        const man = (v: number) => (Math.round(v / 10000) * 10000) / 10000;
        expect(hint, id).toContain(`土地 ${man(cell("cf.balance.account.realEstate.land")).toLocaleString("ja-JP")}万円`);
        expect(hint, id).toContain(`建物 ${man(cell("cf.balance.account.realEstate.building")).toLocaleString("ja-JP")}万円`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});

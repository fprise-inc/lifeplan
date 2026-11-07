// 入力の効き目の見張り（0164）: 欄に見せている値と、計算に使う値をそろえる。
// - 配偶者の働く最後の年齢を直しても、世帯の「退職後」の生活費の節目（ご本人の退職。0049）は動かない
// - 空欄のときに見せる既定の値（plain の fallback）＝エンジンが省略のときに使う値（建物附属設備の耐用年数・併用の一時金の割合・介護の在宅か施設か・持ち家の評価の時点と建った年）
// - 保障の給付の種類を年金に変えたら、受け取りの始まり・年数・額を年金のものに直す（契約の月から一生分を確定で入れない）
import { describe, expect, it } from "vitest";
import type { Account, EngineRequest } from "../src/engine/types.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { equipmentLifeDefault, usedLife } from "../src/workspace/input/stages/rental.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { ageReachedMonth, applyLevers } from "../src/workspace/levers.ts";
import { usedLife as engineUsedLife } from "../../engine/src/components/asset.realEstate/index.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string): WorkingHousehold => {
  const demo = demoHousehold(id);
  const req = modelHousehold(id);
  const self = req.input.household.members.find((m) => m.kind === "self")!;
  return fromRequest(req, demo?.reemployment !== undefined ? { postRetirement: { [self.id]: { ...demo.reemployment, type: demo.reemployment.type as "contract" } } } : {});
};
const fields = (wh: WorkingHousehold, stage: StageId): FieldDef[] => allFields(buildStage(stage, wh));
const fieldOf = (wh: WorkingHousehold, stage: StageId, test: (f: FieldDef) => boolean): FieldDef => {
  const f = fields(wh, stage).find(test);
  if (f === undefined) throw new Error("欄が無い");
  return f;
};
const table = (req: EngineRequest) => preview(req).table;
const rowSum = (req: EngineRequest, prefix: string, toYear = 9999) => table(req).filter((c) => c.row.startsWith(prefix) && c.year <= toYear).reduce((s, c) => s + c.amount, 0);
const sig = (req: EngineRequest) => JSON.stringify(table(req).map((c) => [c.row, c.year, c.member ?? "", c.amount]));
const retirementStages = (wh: WorkingHousehold) => (wh.request.input.household.livingExpenses ?? []).flatMap((l) => (l.stages ?? []).filter((s) => s.label === "retirement").map((s) => s.at));

describe("退職後の生活費の節目は、ご本人の退職だけで動く（H3-001・0049）", () => {
  const wh = open("salariedCoupleTwoKids");
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self")!;
  const spouse = h.members.find((m) => m.kind === "spouse")!;
  const retireField = (w: WorkingHousehold, id: string) => fieldOf(w, "work", (f) => f.key === `work/${id}/retireAge`);

  it("配偶者の働く最後の年齢を早めても遅らせても、節目はご本人の退職（2041-07）のまま・生活費も変わらない", () => {
    expect(retirementStages(wh)).toEqual([{ at: "2041-07" }]);
    for (const age of [59, 61]) {
      const w1 = retireField(wh, spouse.id).set(wh, age);
      expect(retirementStages(w1)).toEqual([{ at: "2041-07" }]);
      expect(rowSum(w1.request, "cf.expense.living")).toBe(rowSum(wh.request, "cf.expense.living"));
    }
  });

  it("配偶者の欄の説明は NISA の積立の終わりだけ。ご本人の欄は生活費の節目も合わせると書く", () => {
    expect(retireField(wh, spouse.id).sideEffects).not.toMatch(/生活費/);
    expect(retireField(wh, self.id).sideEffects).toMatch(/生活費の節目/);
  });

  it("ご本人の働く最後の年齢を直すと、節目はご本人の退職の月に動く（前と同じ）", () => {
    const w1 = retireField(wh, self.id).set(wh, 62);
    expect(retirementStages(w1)).toEqual([{ at: ageReachedMonth(self, 62) }]);
  });

  it("打ち手を配偶者に当てても節目は動かない（結果の画面の対策はご本人に当てる）", () => {
    expect(retirementStages({ ...wh, request: applyLevers(wh.request, spouse.id, { retireAge: 63 }) })).toEqual([{ at: "2041-07" }]);
    expect(retirementStages({ ...wh, request: applyLevers(wh.request, self.id, { retireAge: 63 }) })).toEqual([{ at: ageReachedMonth(self, 63) }]);
  });
});

describe("建物附属設備の耐用年数: 空欄に見せる年数＝計算の年数（H3-002）", () => {
  const wh = open("rentalSample");
  const f = () => fieldOf(wh, "rental", (x) => x.key.endsWith("/property/equipmentLife"));
  const acc = (w: WorkingHousehold) => (w.request.input.household.accounts ?? []).find((a) => (a.property?.acquisition?.parts?.equipment ?? 0) > 0)!;
  const withLife = (life: number | undefined): EngineRequest => {
    const req = structuredClone(wh.request);
    const a = (req.input.household.accounts ?? []).find((x) => x.id === acc(wh).id)!;
    if (life === undefined) delete a.property!.acquisition!.equipmentLife;
    else a.property!.acquisition!.equipmentLife = life;
    return req;
  };

  it("簡便法の年数はエンジンと同じ", () => {
    for (const life of [15, 6, 3])
      for (let e = -1; e <= 20; e++) expect(usedLife(life, e)).toBe(engineUsedLife(life, e));
  });

  it("中古（2008年築を2016年に取得）は、空欄に簡便法の8年を見せ、計算も8年。15年と打てば15年で計算する", () => {
    expect(equipmentLifeDefault(acc(wh).property!)).toBe(8);
    const st = f().get(wh);
    expect(st.value).toBe(8);
    expect(st.implicit).toBe(true);
    expect(sig(withLife(8))).toBe(sig(wh.request));
    const w15 = f().set(wh, 15);
    expect(acc(w15).property!.acquisition!.equipmentLife).toBe(15);
    expect(rowSum(w15.request, "cf.taxSi.incomeTax", 2032)).toBe(rowSum(withLife(15), "cf.taxSi.incomeTax", 2032));
    expect(rowSum(w15.request, "cf.taxSi.incomeTax", 2032)).not.toBe(rowSum(wh.request, "cf.taxSi.incomeTax", 2032));
    // 見せている8年を打っても空欄（省略）のまま
    expect(acc(f().set(w15, 8)).property!.acquisition!.equipmentLife).toBeUndefined();
  });

  it("新築（取得の年に建った）は15年", () => {
    const p = structuredClone(acc(wh).property!);
    p.builtYear = Number(p.acquisition!.at.slice(0, 4));
    expect(equipmentLifeDefault(p)).toBe(15);
  });
});

describe("併用の一時金の割合: 空欄は半分（0050）。見せている50%を打っても計算は変わらない", () => {
  for (const [id, kind] of [
    ["dualAssetsTwoKids", "ideco"],
    ["sampleExecutive", "smallBusinessMutualAid"],
  ] as const)
    it(`${id}（${kind}）`, () => {
      const wh = open(id);
      const a = (wh.request.input.household.accounts ?? []).find((x) => x.kind === kind && x.payout?.method === "mixed")!;
      const f = fieldOf(wh, "savings", (x) => x.key === `sav/${a.id}/lumpShare`);
      const w1 = f.set(wh, "0.5");
      expect(sig(w1.request)).toBe(sig(wh.request));
      const req = structuredClone(wh.request);
      delete ((req.input.household.accounts ?? []).find((x) => x.id === a.id) as Account).payout!.lumpShare;
      expect(sig(req)).toBe(sig(wh.request));
    });
});

describe("介護の在宅か施設か: 空欄は在宅（欄の既定）として計算する", () => {
  it("parentCare: 在宅の介護（額は空欄＝統計の目安）の place を外しても、計算は在宅のまま", () => {
    const wh = open("parentCare");
    const c = (wh.request.input.household.careExpenses ?? []).find((x) => x.place === "home" && x.otherMonthly === undefined)!;
    const f = fieldOf(wh, "care", (x) => x.key.endsWith(`${c.id}/place`));
    expect(f.get(wh).value).toBe("home");
    const req = structuredClone(wh.request);
    delete (req.input.household.careExpenses ?? []).find((x) => x.id === c.id)!.place;
    expect(sig(req)).toBe(sig(wh.request));
  });
});

describe("持ち家の評価の時点・建った年: 購入の時点が空（住み始め）のとき、空欄に見せる年月はエンジンと同じ購入の月", () => {
  for (const id of ["housingPurchase", "housingGiftFromParents"])
    it(id, () => {
      const wh = open(id);
      const r = (wh.request.input.household.residences ?? []).find((x) => x.kind === "own" && x.purchase !== undefined && x.purchase.at === undefined)!;
      const fs = fields(wh, "housing");
      const asOf = fs.find((x) => x.key.endsWith(`${r.id}/valuation/asOf`))!;
      const built = fs.find((x) => x.key.endsWith(`${r.id}/valuation/builtYear`))!;
      const shownAsOf = asOf.get(wh).value as string;
      const shownBuilt = built.get(wh).value as number;
      expect(shownAsOf > wh.request.input.baseMonth).toBe(true);
      const req = structuredClone(wh.request);
      const rr = (req.input.household.residences ?? []).find((x) => x.id === r.id)!;
      rr.valuation = { ...(rr.valuation ?? {}), asOf: shownAsOf, builtYear: shownBuilt };
      expect(sig(req)).toBe(sig(wh.request));
    });
});

describe("保障の給付の種類を年金に変える（H3-005）", () => {
  const ins = (w: WorkingHousehold) => fields(w, "insurance");
  const actions = (w: WorkingHousehold) => buildStage("insurance", w).sections.flatMap((s) => [...(s.actions ?? []), ...s.groups.flatMap((g) => g.actions ?? [])]);
  const wh = open("salariedCoupleTwoKids");
  const contract = wh.request.input.household.insuranceContracts!.find((c) => c.coverages?.some((x) => x.benefit === "death") && c.contractDate < wh.request.input.baseMonth)!;
  const insured = wh.request.input.household.members.find((m) => m.id === contract.insured)!;
  const annuity = (w: WorkingHousehold) => rowSum(w.request, "cf.income.corporatePension.privateAnnuity");

  it("「＋ 保障」で足した保障を年金にすると、受け取りの始まりは被保険者の65歳（推定）・年数は10年（推定）・額は未入力", () => {
    const add = actions(wh).find((a) => a.key.endsWith(`${contract.id}/addCoverage`))!;
    const w1 = add.run(wh);
    const ben = ins(w1).filter((x) => x.key.includes(contract.id) && x.key.endsWith("/benefit")).at(-1)!;
    const w2 = ben.set(w1, "annuity");
    const cov = w2.request.input.household.insuranceContracts!.find((c) => c.id === contract.id)!.coverages!.at(-1)!;
    expect(cov.from).toEqual({ memberAge: { member: insured.id, years: 65, months: 0 } });
    expect(cov.years).toBe(10);
    const start = ins(w2).find((x) => x.key.endsWith(`${cov.id}/from`))!;
    expect(fieldStatus(start, w2).status).toBe("estimated");
    const amount = ins(w2).find((x) => x.key.endsWith(`${cov.id}/amount`))!;
    expect(fieldStatus(amount, w2).status).toBe("missing");
    const w3 = amount.set(w2, 600_000);
    // 65歳から10年だけ（今年から一生分ではない）
    expect(annuity(w3)).toBe(6_000_000);
    const first = table(w3.request).filter((c) => c.row.startsWith("cf.income.corporatePension.privateAnnuity") && c.amount > 0).map((c) => c.year).sort()[0];
    expect(first).toBe(Number(ageReachedMonth(insured, 65).slice(0, 4)));
  });

  it("主契約の死亡保険金を年金に変えると、死亡保険金の額を年額にしない（未入力の0円）", () => {
    const main = contract.coverages!.find((x) => x.benefit === "death")!;
    const ben = ins(wh).find((x) => x.key.endsWith(`${main.id}/benefit`))!;
    const w1 = ben.set(wh, "annuity");
    const cov = w1.request.input.household.insuranceContracts!.find((c) => c.id === contract.id)!.coverages!.find((x) => x.id === main.id)!;
    expect(cov.amount).toBe(0);
    expect(annuity(w1)).toBe(0);
    // 年金から死亡に戻すと、保障の始まりは契約の月（推定の印は外す）
    const w2 = ins(w1).find((x) => x.key.endsWith(`${main.id}/benefit`))!.set(w1, "death");
    const back = w2.request.input.household.insuranceContracts!.find((c) => c.id === contract.id)!.coverages!.find((x) => x.id === main.id)!;
    expect(back.from).toEqual({ at: contract.contractDate });
    expect(fieldStatus(ins(w2).find((x) => x.key.endsWith(`${main.id}/from`))!, w2).status).not.toBe("estimated");
  });

  it("額の意味が同じ種類どうし（死亡保険金→がん一時金）なら額は残す", () => {
    const main = contract.coverages!.find((x) => x.benefit === "death")!;
    const w1 = ins(wh).find((x) => x.key.endsWith(`${main.id}/benefit`))!.set(wh, "cancerLump");
    expect(w1.request.input.household.insuranceContracts!.find((c) => c.id === contract.id)!.coverages!.find((x) => x.id === main.id)!.amount).toBe(main.amount);
  });
});

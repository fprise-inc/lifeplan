// 収益不動産の建てる・買う予定（0232）: 入力の画面（「＋ 建てる・買う予定」「＋ この土地に建てる予定」・予定のまとまりの欄・予定の物件で出さない欄）、
// 自己資金の空欄の額、建物の固定資産税評価額の推定と入れ直し、経年減点補正率が計算エンジンと同じ、表の「不動産の取得」の行、予定の月から借りるローン
import { describe, expect, it } from "vitest";
import { keinenRateText } from "../../engine/src/sdk/index.ts";
import type { BuildingStructure } from "../../engine/src/engine/types.ts";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { refreshEstimates } from "../src/workspace/input/estimates.ts";
import { rowAt } from "../src/workspace/input/rows.ts";
import { keinenRate } from "../src/workspace/input/propertyTax.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addPropertyLoan, rentalOverview, rentalProperties } from "../src/workspace/input/stages/rental.ts";
import { addBuildPlan, addPlannedProperty, isEstimatedAssessed, PLAN_INHERITANCE_NOTE, planAssessedEstimate, planEquityDefault } from "../src/workspace/input/stages/rentalPlan.ts";
import { rowDefs } from "../src/workspace/present.ts";
import { modelHousehold, preview } from "./helpers.ts";

let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const stageOf = (wh: WorkingHousehold): StageDef => buildStage("rental", wh);
const fields = (wh: WorkingHousehold): FieldDef[] => allFields(stageOf(wh));
const keys = (wh: WorkingHousehold) => fields(wh).map((f) => f.key);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = fields(wh).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const planned = (wh: WorkingHousehold) => rentalProperties(wh.request.input.household).find((a) => a.property?.planned !== undefined)!;
const groupsOf = (wh: WorkingHousehold) => stageOf(wh).sections.flatMap((s) => s.groups);

/** 白紙の世帯（2026年10月）に「＋ 建てる・買う予定」を押し、代金を入れた物件 */
const buyHousehold = (): WorkingHousehold => {
  const wh = addPlannedProperty(blankHousehold("2026-10", id), id);
  return mutate(wh, (h) => {
    const p = h.accounts!.find((a) => a.property?.planned !== undefined)!.property!;
    p.planned = { ...p.planned!, at: { at: "2027-10" }, parts: { land: 20000000, building: 30000000 }, costs: 2500000 };
    p.rental = { monthly: { value: 350000, state: "confirmed", origin: { kind: "manual" } }, vacancyRate: "0.1" };
  });
};

describe("入力の画面", () => {
  it("区画に「＋ 建てる・買う予定」があり、押すと土地ごと買う予定の物件ができる（時期は今から1年後の目安の印）", () => {
    const wh0 = blankHousehold("2026-10", id);
    const add = stageOf(wh0).sections[0]!.actions.find((a) => a.label === "＋ 建てる・買う予定");
    expect(add).toBeDefined();
    const wh = add!.run(wh0);
    const a = planned(wh);
    expect(a.property?.planned).toEqual({ type: "buy", at: { at: "2027-10" } });
    expect(a.property?.kind).toBe("apartment");
    const row = rowAt(wh.request.input as unknown as Record<string, unknown>, { target: { object: a.id }, item: "account.property", at: ["planned", "at"] });
    expect(row?.state).toBe("estimated");
  });

  it("予定のまとまり: 標準は予定の形・時期・代金（土地・建物）・取得の諸費用・自己資金、詳細は設備と固定資産税評価額。控えめな注意を添える", () => {
    const wh = buyHousehold();
    const a = planned(wh);
    const kp = `sav/${a.id}/property/plan`;
    const g = groupsOf(wh).find((x) => x.key === kp)!;
    expect(g.title).toBe("建てる・買う予定（2027年10月に買う予定・5,000万円）");
    expect(g.note).toBe(PLAN_INHERITANCE_NOTE);
    expect(g.note).toContain("令和4年4月19日の最高裁判決");
    const simple = g.fields.filter((f) => f.level === "simple").map((f) => f.label);
    expect(simple).toEqual(["予定の形", "買う時期", "購入代金: 土地", "購入代金: 建物", "取得の諸費用", "自己資金"]);
    expect(g.fields.filter((f) => f.level === "detail").map((f) => f.label)).toEqual(["購入代金: 建物附属設備", "建物の固定資産税評価額"]);
  });

  it("土地ごと買う予定の物件は、評価額・評価額の時点・持ち始める時点・取得の欄・減価償却の引き継ぎを出さない", () => {
    const wh = buyHousehold();
    const a = planned(wh);
    const ks = keys(wh);
    for (const k of [`sav/${a.id}/value`, `sav/${a.id}/asOf`, `sav/${a.id}/property/holdFrom`, `sav/${a.id}/property/acqPrice`, `sav/${a.id}/property/acqAt`, `sav/${a.id}/property/landShare`, `sav/${a.id}/property/carry/year`]) expect(ks, k).not.toContain(k);
    expect(ks).toContain(`sav/${a.id}/property/structure`);
    expect(fieldOf(wh, `sav/${a.id}/property/builtYear`).get(wh).value).toBe(2027);
  });

  it("予定の形を「持っている土地に建てる」にすると、評価額は「今の土地の評価額」（未入力の印）、取得は土地の取得、代金は建築費", () => {
    const wh0 = buyHousehold();
    const a = planned(wh0);
    const wh = fieldOf(wh0, `sav/${a.id}/property/plan/type`).set(wh0, "build");
    const b = planned(wh);
    expect(b.property?.planned?.type).toBe("build");
    expect(b.marketValue?.state).toBe("estimated");
    const value = fieldOf(wh, `sav/${b.id}/value`);
    expect(value.label).toBe("今の土地の評価額");
    expect(fieldOf(wh, `sav/${b.id}/property/acqPrice`).label).toBe("土地の取得価額");
    expect(fieldOf(wh, `sav/${b.id}/property/acqAt`).label).toBe("土地の取得の年月");
    expect(keys(wh)).not.toContain(`sav/${b.id}/property/plan/land`);
    expect(fieldOf(wh, `sav/${b.id}/property/plan/building`).label).toBe("建築費: 建物");
    expect(fieldOf(wh, `sav/${b.id}/property/plan/at`).label).toBe("建物の引き渡しの時期");
    expect(keys(wh)).not.toContain(`sav/${b.id}/property/builtYear`);
  });

  it("まだ貸していない物件には「＋ この土地に建てる予定」。押すと建てる予定と家賃の欄（未入力）ができる", () => {
    let wh = blankHousehold("2026-10", id);
    wh = mutate(wh, (h) => {
      (h.accounts ??= []).push({ id: id(), kind: "realEstate", owner: h.members[0]!.id, marketValue: { value: 30000000, state: "confirmed", origin: { kind: "manual" } }, asOf: "2026-10", contributions: [], property: { kind: "land" } });
    });
    const a = rentalProperties(wh.request.input.household)[0]!;
    const action = groupsOf(wh).flatMap((g) => g.actions).find((x) => x.label === "＋ この土地に建てる予定");
    expect(action).toBeDefined();
    const next = action!.run(wh);
    const b = rentalProperties(next.request.input.household).find((x) => x.id === a.id)!;
    expect(b.property?.planned?.type).toBe("build");
    expect(b.property?.kind).toBe("apartment");
    expect(b.property?.rental?.monthly.value).toBe(0);
    expect(addBuildPlan(next, a.id).request.input.household).toEqual(next.request.input.household);
    // 貸している物件には出さない
    expect(groupsOf(next).flatMap((g) => g.actions).some((x) => x.label === "＋ この土地に建てる予定")).toBe(false);
  });

  it("自己資金の空欄は、代金＋諸費用−これから借りるこの物件のローン（ローンは予定の月から借りる形で足す）", () => {
    let wh = buyHousehold();
    const a = planned(wh);
    expect(planEquityDefault(wh.request.input.household, a, "2026-10")).toBe(52500000);
    expect(fieldOf(wh, `sav/${a.id}/property/plan/equity`).get(wh).value).toBe(52500000);
    wh = addPropertyLoan(wh, a.id, id);
    const d = wh.request.input.household.debts!.find((x) => x.property === a.id)!;
    expect(d.start).toEqual({ at: "2027-10" });
    expect(fieldOf(wh, `sav/${a.id}/property/plan/equity`).get(wh).value).toBe(Math.max(0, 52500000 - d.principal));
  });

  it("物件の一覧表: 予定の月が後なら、土地ごと買う予定の評価額と月の収入は0。種類の横に予定を書く", () => {
    const o = rentalOverview(buyHousehold())!;
    expect(o.rows[0]).toMatchObject({ kind: "一棟アパート・2027年10月に買う予定", value: 0, income: 0 });
  });
});

describe("建物の固定資産税評価額の推定", () => {
  it("建物の価格×新築の評価額の割合（40%）を推定で入れ、推定のままなら建築費に合わせて入れ直す。FP が入れた額は変えない", () => {
    const wh = buyHousehold();
    const h = structuredClone(wh.request.input.household);
    refreshEstimates(h, "2026-10");
    const p = h.accounts!.find((a) => a.property?.planned !== undefined)!.property!.planned!;
    expect(p.assessed?.value).toBe(12000000);
    expect(isEstimatedAssessed(p.assessed)).toBe(true);
    p.parts = { land: 20000000, building: 40000000 };
    refreshEstimates(h, "2026-10");
    expect(p.assessed?.value).toBe(16000000);
    p.assessed = { value: 15000000, state: "confirmed", origin: { kind: "manual" } };
    refreshEstimates(h, "2026-10");
    expect(p.assessed.value).toBe(15000000);
    expect(planAssessedEstimate({ type: "build", at: { at: "2028-04" } })).toBeNull();
  });

  it("経年減点補正率は、計算エンジン（sdk の keinenRateText）と画面（propertyTax.ts の keinenRate）で同じ値", () => {
    for (const s of ["wood", "lightSteel", "steel", "rc"] as BuildingStructure[]) for (let age = 1; age <= 70; age++) expect(Number(keinenRateText(s, age)), `${s} ${age}`).toBe(keinenRate(s, age));
  });
});

describe("結果の表", () => {
  it("予定のある物件があるときだけ「不動産の取得」の行を出し、自己資金をその行に（一時的支出には入れない）", () => {
    const req = structuredClone(modelHousehold("dualAssetsTwoKids"));
    expect(rowDefs(req).some((d) => d.key === "realEstatePurchase")).toBe(false);
    const wh = buyHousehold();
    const a = planned(wh);
    const base = fromRequest(req);
    const h = base.request.input.household;
    (h.accounts ??= []).push({ ...a, owner: h.members[0]!.id });
    const r = preview(base.request);
    const defs = rowDefs(base.request);
    const purchase = defs.find((d) => d.key === "realEstatePurchase")!;
    expect(purchase.label).toBe("不動産の取得");
    const lump = defs.find((d) => d.key === "lumpSum")!;
    const cells = r.table.filter((c) => c.row === "cf.expense.lumpSum.realEstatePurchase");
    expect(cells.map((c) => [c.year, c.amount])).toEqual([[2027, 52500000]]);
    expect(cells.every((c) => purchase.match(c) && !lump.match(c))).toBe(true);
  });
});

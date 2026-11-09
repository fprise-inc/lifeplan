// 段階と例外の年・働き方の期間ごとの伸びの欄（0040。形式 0.18）: カードの中で段・例外の年を足す・直す・外す、時点の部品で「いつから」を入れる、
// 少しずつ移す段、器の利回りと資産配分の段階、給与・事業所得の増減率。書いた形がエンジンでそのまま計算でき、当て先（0036 の2）が付くこと
import { describe, expect, it } from "vitest";
import type { Account, EngineRequest } from "../src/engine/types.ts";
import { allFields, type ActionDef, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldAddress, fieldStatus } from "../src/workspace/input/valueState.ts";
import { full, modelHousehold } from "./helpers.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const actionsOf = (st: StageDef): ActionDef[] => st.sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
const act = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], suffix: string): WorkingHousehold => {
  const a = actionsOf(buildStage(stage, wh)).find((x) => x.key.endsWith(suffix));
  if (a === undefined) throw new Error(`ボタンが無い: ${suffix}`);
  return a.run(wh);
};
const fieldOf = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], pred: (f: FieldDef) => boolean): FieldDef => {
  const f = allFields(buildStage(stage, wh)).find(pred);
  if (f === undefined) throw new Error("欄が無い");
  return f;
};
const flowSum = (req: EngineRequest, row: string, year: number) =>
  (full(req).flows as { row: string; ym: string; amount: number }[]).filter((f) => f.row === row && f.ym.startsWith(`${year}-`)).reduce((s, f) => s + f.amount, 0);

describe("住まいの段階と例外の年（修繕費・固定資産税・家賃）", () => {
  it("修繕費の段を足すと ID つきの段（元の額の推定）が入り、額・時点（年齢）・割合・少しずつ移す・外すを欄で直せる。エンジンでそのまま計算できる", () => {
    const wh0 = open("dualAssetsTwoKids");
    const res = wh0.request.input.household.residences![0]!;
    let wh = act(wh0, "housing", `${res.id}/maintenance/addStage`);
    expect(wh0.request.input.household.residences![0]!.maintenance!.stages).toBeUndefined();
    const st = wh.request.input.household.residences![0]!.maintenance!.stages!;
    expect(st).toHaveLength(1);
    expect(st[0]!.id).toMatch(UUID);
    const sid = st[0]!.id;
    // 足した段の額は推定（元の額のまま）。確定は明示の操作だけ（0041）
    const amount = fieldOf(wh, "housing", (f) => f.key.endsWith(`/maintenance/stage/${sid}/amount`));
    expect(fieldStatus(amount, wh).status).toBe("estimated");
    expect(amount.set(wh, amount.get(wh).value)).toBe(wh);
    expect(fieldAddress(amount, wh)).toEqual({ target: { object: res.id }, item: "residence.maintenance", at: ["stages", sid, "amount"] });
    wh = amount.set(wh, 30000);
    expect(wh.request.input.household.residences![0]!.maintenance!.stages![0]!.amount).toEqual({ value: 30000, state: "confirmed", origin: { kind: "manual" } });
    // いつから: 時点の部品（本人の年齢のまま持つ）
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const at = fieldOf(wh, "housing", (f) => f.key.endsWith(`/maintenance/stage/${sid}/at`));
    expect(at.time).toBeDefined();
    wh = at.time!.setWhen(wh, { memberAge: { member: self.id, years: 60 } }, "auto");
    expect(wh.request.input.household.residences![0]!.maintenance!.stages![0]!.at).toEqual({ memberAge: { member: self.id, years: 60 } });
    const before = flowSum(wh0.request, "cf.expense.housing.maintenance", 2060);
    expect(flowSum(wh.request, "cf.expense.housing.maintenance", 2060)).toBeGreaterThan(before);
    // 2つ目の段を足すと、1つ目に「ここから何年かけて移すか」が出る
    wh = act(wh, "housing", `${res.id}/maintenance/addStage`);
    const ramp = fieldOf(wh, "housing", (f) => f.key.endsWith(`/maintenance/stage/${sid}/ramp`));
    wh = ramp.set(wh, 5);
    expect(wh.request.input.household.residences![0]!.maintenance!.stages![0]!.rampYears).toBe(5);
    // 入れ方を割合にする
    const sid2 = wh.request.input.household.residences![0]!.maintenance!.stages![1]!.id;
    wh = fieldOf(wh, "housing", (f) => f.key.endsWith(`/maintenance/stage/${sid2}/mode`)).set(wh, "ratio");
    expect(wh.request.input.household.residences![0]!.maintenance!.stages![1]).toMatchObject({ ratio: "1" });
    expect(wh.request.input.household.residences![0]!.maintenance!.stages![1]!.amount).toBeUndefined();
    expect(() => full(wh.request)).not.toThrow();
    // 外す（最後の段を外すと並びも外す）
    wh = act(wh, "housing", `/maintenance/stage/${sid2}/remove`);
    wh = act(wh, "housing", `/maintenance/stage/${sid}/remove`);
    expect(wh.request.input.household.residences![0]!.maintenance!.stages).toBeUndefined();
  });

  it("固定資産税の例外の年: 年と額（0円はその年に払わない）。年ごとの段は「その年から」", () => {
    const wh0 = open("dualAssetsTwoKids");
    const res = wh0.request.input.household.residences![0]!;
    let wh = act(wh0, "housing", `${res.id}/propertyTax/addException`);
    const ex = wh.request.input.household.residences![0]!.propertyTax!.exceptions![0]!;
    expect(ex.id).toMatch(UUID);
    expect(ex.amount.value).toBe(0);
    wh = fieldOf(wh, "housing", (f) => f.key.endsWith(`/propertyTax/except/${ex.id}/year`)).set(wh, 2030);
    const taxIn = (r: EngineRequest, y: number) => (full(r).flows as { row: string; accrualYear: number; amount: number }[]).filter((f) => f.row === "cf.expense.housing.propertyTax" && f.accrualYear === y).reduce((s, f) => s + f.amount, 0);
    expect(taxIn(wh0.request, 2030)).toBeGreaterThan(0);
    expect(taxIn(wh.request, 2030)).toBe(0);
    expect(taxIn(wh.request, 2031)).toBe(taxIn(wh0.request, 2031));
    wh = act(wh, "housing", `${res.id}/propertyTax/addStage`);
    const sid = wh.request.input.household.residences![0]!.propertyTax!.stages![0]!.id;
    expect(fieldOf(wh, "housing", (f) => f.key.endsWith(`/propertyTax/stage/${sid}/at`)).label).toBe("いつから（その年から）");
  });

  it("賃貸の家賃にも段階と例外の年。変化の数は簡易のまとまりの札に出る", () => {
    let wh = open("sampleSingle20s");
    const r = wh.request.input.household.residences?.find((x) => x.kind === "rent");
    expect(r).toBeDefined();
    wh = act(wh, "housing", `${r!.id}/rent/addStage`);
    wh = act(wh, "housing", `${r!.id}/rent/addException`);
    const group = buildStage("housing", wh).sections.flatMap((s) => s.groups).find((g) => g.key === `housing/res/${r!.id}`);
    expect(group?.note).toContain("家賃の変化 2件");
    expect(() => full(wh.request)).not.toThrow();
  });
});

describe("周期的な支出・不動産の段階と例外の年", () => {
  it("何年かごとの支出の1回の額の段と例外の年（当て先は周期的な支出の入力項目ID）", () => {
    const wh0 = open("dualAssetsTwoKids");
    const pe = wh0.request.input.household.periodicExpenses![0]!;
    let wh = act(wh0, "events", `ev/${pe.id}/addStage`);
    wh = act(wh, "events", `ev/${pe.id}/addException`);
    const p1 = wh.request.input.household.periodicExpenses![0]!;
    const sid = p1.stages![0]!.id;
    const eid = p1.exceptions![0]!.id;
    const amount = fieldOf(wh, "events", (f) => f.key === `ev/${pe.id}/stage/${sid}/amount`);
    expect(fieldAddress(amount, wh)).toEqual({ target: { object: pe.id }, item: "periodicExpense.stages", at: [sid, "amount"] });
    expect(fieldAddress(fieldOf(wh, "events", (f) => f.key === `ev/${pe.id}/except/${eid}/amount`), wh)).toEqual({ target: { object: pe.id }, item: "periodicExpense.exceptions", at: [eid, "amount"] });
    wh = amount.set(wh, 0);
    expect(() => full(wh.request)).not.toThrow();
  });

  it("収益不動産の家賃の段（割合）と経費の年額の例外の年", () => {
    const wh0 = open("dualAssetsTwoKids");
    const a = wh0.request.input.household.accounts!.find((x) => x.property?.rental !== undefined)!;
    let wh = act(wh0, "rental", `${a.id}/property/rental/addStage`);
    const sid = wh.request.input.household.accounts!.find((x) => x.id === a.id)!.property!.rental!.stages![0]!.id;
    wh = fieldOf(wh, "rental", (f) => f.key.endsWith(`/property/rental/stage/${sid}/mode`)).set(wh, "ratio");
    wh = fieldOf(wh, "rental", (f) => f.key.endsWith(`/property/rental/stage/${sid}/ratio`)).set(wh, "0.5");
    const f = fieldOf(wh, "rental", (x) => x.key.endsWith(`/property/rental/stage/${sid}/ratio`));
    expect(fieldAddress(f, wh)).toEqual({ target: { object: a.id }, item: "account.property", at: ["rental", "stages", sid, "ratio"] });
    wh = act(wh, "rental", `${a.id}/property/expenses/addException`);
    const year = Number(wh.request.input.baseMonth.slice(0, 4)) + 3;
    const s0 = (wh.request.input.household.accounts!.find((x) => x.id === a.id)!.property!.rental!.stages![0]!.at as { at: string }).at;
    expect(flowSum(wh.request, "cf.income.other.rental", Number(s0.slice(0, 4)) + 1)).toBeLessThan(flowSum(wh0.request, "cf.income.other.rental", Number(s0.slice(0, 4)) + 1));
    expect(flowSum(wh.request, "cf.expense.other.realEstate", year)).toBeGreaterThan(0);
  });
});

describe("器の利回りと資産配分の段階（貯蓄・運用の詳細）", () => {
  it("口座の利回りの段（利回り・資産の配分）と例外の年を足す・直す。計算できる", () => {
    const wh0 = open("dualAssetsTwoKids");
    const nisa = wh0.request.input.household.accounts!.find((x) => x.kind === "nisa")!;
    let wh = act(wh0, "savings", `sav/${nisa.id}/addReturnStage`);
    wh = act(wh, "savings", `sav/${nisa.id}/addReturnStage`);
    wh = act(wh, "savings", `sav/${nisa.id}/addReturnException`);
    const acc = () => wh.request.input.household.accounts!.find((x) => x.id === nisa.id) as Account;
    const [s1, s2] = acc().returnStages!;
    expect(s1!.id).toMatch(UUID);
    wh = fieldOf(wh, "savings", (f) => f.key === `sav/${nisa.id}/rstage/${s1!.id}/rate`).set(wh, "0.02");
    wh = fieldOf(wh, "savings", (f) => f.key === `sav/${nisa.id}/rstage/${s1!.id}/ramp`).set(wh, 3);
    wh = fieldOf(wh, "savings", (f) => f.key === `sav/${nisa.id}/rstage/${s2!.id}/mode`).set(wh, "mix");
    expect(acc().returnStages![1]).toMatchObject({ assetMix: [{ assetClass: "equity.global", share: "0.5" }, { assetClass: "bond.global", share: "0.5" }] });
    expect(acc().returnStages![1]!.expectedReturn).toBeUndefined();
    wh = fieldOf(wh, "savings", (f) => f.key === `sav/${nisa.id}/rstage/${s2!.id}/mix/0/share`).set(wh, "0.7");
    wh = fieldOf(wh, "savings", (f) => f.key === `sav/${nisa.id}/rstage/${s2!.id}/mix/1/share`).set(wh, "0.3");
    const ex = acc().returnExceptions![0]!;
    wh = fieldOf(wh, "savings", (f) => f.key === `sav/${nisa.id}/rexcept/${ex.id}/rate`).set(wh, "-0.2");
    const rate = fieldOf(wh, "savings", (f) => f.key === `sav/${nisa.id}/rexcept/${ex.id}/rate`);
    expect(fieldAddress(rate, wh)).toEqual({ target: { object: nisa.id }, item: "account.returnExceptions", at: [ex.id, "expectedReturn"] });
    expect(() => full(wh.request)).not.toThrow();
  });

  it("資産配分の入れ方の段階は前提に書く（現状の要求を書き換えない）。運用する口座の段は出さない", () => {
    const wh0 = open("dualAssetsTwoKids");
    const req = structuredClone(wh0.request);
    req.input.assumptions!.investment = { ...(req.input.assumptions!.investment ?? {}), method: "allocation", allocation: { mix: [{ assetClass: "equity.global", share: "1" }] } };
    const wa = fromRequest(req);
    const keep = structuredClone(wa.request);
    const wh = act(wa, "savings", "sav/alloc/addStage");
    expect(wa.request).toEqual(keep);
    const stages = wh.request.input.assumptions!.investment!.allocation!.stages!;
    expect(stages[0]!.id).toMatch(UUID);
    expect(stages[0]!.mix).toEqual([{ assetClass: "equity.global", share: "1" }]);
    const share = fieldOf(wh, "savings", (f) => f.key === `sav/alloc/stage/${stages[0]!.id}/mix/0/share`);
    expect(fieldAddress(share, wh)).toEqual({ target: { plan: "assumptions" }, item: "assumptions.investment", at: ["allocation", "stages", stages[0]!.id, "mix"] });
    const w2 = act(wh, "savings", `sav/alloc/stage/${stages[0]!.id}/mix/addRow`);
    expect(wh.request.input.assumptions!.investment!.allocation!.stages![0]!.mix).toHaveLength(1);
    expect(w2.request.input.assumptions!.investment!.allocation!.stages![0]!.mix).toHaveLength(2);
    const nisa = wh.request.input.household.accounts!.find((x) => x.kind === "nisa")!;
    expect(actionsOf(buildStage("savings", wh)).some((a) => a.key === `sav/${nisa.id}/addReturnStage`)).toBe(false);
    expect(() => full(w2.request)).not.toThrow();
  });
});

describe("働き方の期間ごとの伸び（年率）", () => {
  it("給与: 率を入れると salary.growth は率に（昇給カーブの代わり）、空にすると前提の賃金上昇率に戻る。当て先は growth の rate", () => {
    let wh = open("salariedCoupleTwoKids");
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const p = wh.request.input.household.employmentPeriods!.find((x) => x.member === self.id && x.salary !== undefined)!;
    const f = fieldOf(wh, "work", (x) => x.key.endsWith("/salaryGrowth") && fieldAddress(x, wh)?.target !== undefined && (fieldAddress(x, wh)!.target as { object: string }).object === p.id);
    expect(f.get(wh).hint).toContain("賃金上昇率");
    const before = flowSum(wh.request, "cf.income.salary", 2035);
    wh = f.set(wh, "0.03");
    expect(wh.request.input.household.employmentPeriods!.find((x) => x.id === p.id)!.salary!.growth).toEqual({ rate: "0.03" });
    expect(fieldAddress(f, wh)).toEqual({ target: { object: p.id }, item: "employment.salary.growth", at: ["rate"] });
    expect(flowSum(wh.request, "cf.income.salary", 2035)).not.toBe(before);
    wh = f.set(wh, null);
    expect(wh.request.input.household.employmentPeriods!.find((x) => x.id === p.id)!.salary!.growth).toBeUndefined();
  });

  it("事業所得の増減率（空欄は前提の賃金上昇率）", () => {
    let wh = open("selfEmployed");
    const p = wh.request.input.household.employmentPeriods!.find((x) => x.type === "selfEmployed")!;
    const f = fieldOf(wh, "work", (x) => x.key.endsWith("/businessGrowth") && (fieldAddress(x, wh)?.target as { object?: string } | undefined)?.object === p.id);
    wh = f.set(wh, "-0.02");
    expect(wh.request.input.household.employmentPeriods!.find((x) => x.id === p.id)!.business!.growth).toEqual({ rate: "-0.02" });
    expect(() => full(wh.request)).not.toThrow();
  });
});

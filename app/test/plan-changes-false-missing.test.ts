// プランの重なりの2つの直し（0036 の追記 2026-11-15）
// - 土台のプランで種類を変えて置き換えた物の、今の種類の欄を上のプランで直しても、結果のタブの「変えたこと」に要確認を出さない
//   （動かす項目の一覧は現状の世帯から作るので、今の種類の欄の鍵が一覧に無い）。現状の世帯で無くなった欄は、これまでどおり要確認
// - 1件だけ置く物（住民税の決定額など）を上のプランと土台のプランの両方で足したら、上のプランの物を1件だけ当てる（後のプランが勝つ）
import { describe, expect, it } from "vitest";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { diffRows, planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { applyPlan, changesOf, changesOfValues, effectiveValues, reviewCount, type Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview, screenTotals } from "./helpers.ts";

const plan = (id: string, base: string | null = null): Proposal => ({ id, name: `プラン${id}`, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base, tags: [], diffs: [] });
const fieldOf = (wh: WorkingHousehold, key: string) => {
  const f = buildStages(wh)
    .flatMap((s) => allFields(s))
    .find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
function setup(model: string): { wh: WorkingHousehold; cat: Catalog } {
  const req = modelHousehold(model);
  const self = roles(req).find((r) => r.key === "self")?.member;
  if (self === undefined) throw new Error("本人がいない");
  const wh: WorkingHousehold = { ...fromRequest(req, {}), proposals: [plan("B"), plan("C", "B")] };
  return { wh, cat: buildCatalog(wh, self.id, null) };
}
/** 欄を直して、そのプランの差分にする */
function edit(wh: WorkingHousehold, cat: Catalog, pid: string, key: string, value: (now: unknown) => unknown): { wh: WorkingHousehold; screen: WorkingHousehold } {
  const v = planView(wh, cat, pid);
  const f = fieldOf(v, key);
  const screen = f.set(v, value(f.get(v).value) as never);
  return { wh: recordPlanEdit(wh, cat, pid, v, screen), screen };
}
/** 現状の欄を直す（動かす項目の一覧も作り直す） */
function editNow(wh: WorkingHousehold, cat: Catalog, key: string, value: unknown): { wh: WorkingHousehold; cat: Catalog } {
  const next = { ...fieldOf(wh, key).set(wh, value as never), proposals: wh.proposals };
  return { wh: next, cat: buildCatalog(next, cat.selfId, null) };
}
const plus = (n: number) => (now: unknown) => (now as number) + n;
const to = (x: unknown) => () => x;
const totals = (req: EngineRequest) => screenTotals(preview(forEngine(req)), req);
/** 住民税の決定額（世帯の入力の residentTaxAssessments） */
interface Assessment {
  member: string;
  fiscalYear: number;
  amount: { value: number; state: string; origin: { kind: string } };
}
const assessmentsOf = (req: EngineRequest): Assessment[] => (req.input.household.residentTaxAssessments ?? []) as unknown as Assessment[];

// 見本の世帯「住宅購入」の本人（会社員）
const WORKER = "dc9e7d37-44c1-490e-b7b5-2a6e49ee08a9";
// 見本の世帯「投資をする夫婦」の配偶者（パート。現状に住民税の決定額が無い）
const SPOUSE = "1ec032cb-73ee-4aca-8c6e-1da62c7c9c08";

describe("土台で種類を変えた物の、今の種類の欄を上のプランで直す（結果のタブの「変えたこと」）", () => {
  it("土台で働き方を自営業に → 上のプランで事業所得を直す: 「変えたこと」に要確認を出さず、入力のホームの違いの一覧と同じ文で出す", () => {
    const { wh, cat } = setup("housingPurchase");
    const b = edit(wh, cat, "B", `work/${WORKER}/now/type`, to("selfEmployed"));
    const c = edit(b.wh, cat, "C", `work/${WORKER}/now/business`, plus(1_000_000));
    // 計算は正しい（上のプランの画面で直した世帯と同じ）
    expect(totals(applyPlan(c.wh, "C", cat).request as EngineRequest)).toEqual(totals(c.screen.request as EngineRequest));
    const rows = changesOf(c.wh.proposals, "C", c.wh, cat);
    expect(rows.filter((r) => r.state !== "ok")).toEqual([]);
    expect(reviewCount(c.wh.proposals, "C", c.wh, cat)).toBe(0);
    const listed = diffRows(c.wh, cat, "C").find((r) => !r.inherited);
    expect(listed?.label).toBe("ご本人の今の働き方: 事業所得（年額）");
    const own = rows.find((r) => !r.inherited);
    expect([own?.label, own?.from, own?.to]).toEqual([listed?.label, listed?.from, listed?.to]);
    // 保存する前（結果のタブで動かしている間）の「変えたこと」と、提案書の変更点にも、事業所得の行が出る
    const moved = changesOfValues(effectiveValues(c.wh, "C"), c.wh, cat);
    expect(moved.map((r) => [r.label, r.inherited])).toEqual([
      ["置き換え: 働き方", true],
      ["ご本人の今の働き方: 事業所得（年額）", false],
    ]);
  });

  it("現状の働き方を自営業に変えて無くなった給与の欄を指す差分は、これまでどおり「変えたこと」で要確認にする", () => {
    const { wh, cat } = setup("housingPurchase");
    const c = edit(wh, cat, "C", `work/${WORKER}/now/total`, plus(1_000_000));
    const now = editNow(c.wh, cat, `work/${WORKER}/now/type`, "selfEmployed");
    const rows = changesOf(now.wh.proposals, "C", now.wh, now.cat);
    expect(rows.map((r) => [r.state, r.reviewNote])).toEqual([["missing", "現状のプランから、この物が無くなりました"]]);
    // 保存する前の「変えたこと」には、今の世帯に無い欄の差分を変えたこととして出さない
    expect(changesOfValues(effectiveValues(now.wh, "C"), now.wh, now.cat).filter((r) => r.label.includes("給与"))).toEqual([]);
  });
});

describe("1件だけ置く物（住民税の決定額）を、上のプランと土台のプランの両方で足す", () => {
  const assessments = (req: EngineRequest) => assessmentsOf(req).filter((a) => a.member === SPOUSE);
  const amounts = (req: EngineRequest) => assessments(req).map((a) => a.amount.value);

  it("上のプランで決定額を入れたあと、土台で働き方を変えて（決定額の推定が足される）決定額を入れても、上のプランは自分の決定額1件で計算する", () => {
    const { wh, cat } = setup("investmentCouple");
    const c = edit(wh, cat, "C", `work/${SPOUSE}/residentTax`, to(50_000));
    const b1 = edit(c.wh, cat, "B", `work/${SPOUSE}/now/type`, to("regular"));
    // 働き方を変えると、土台のプランに配偶者の決定額（推定）を足す差分ができる
    expect(b1.wh.proposals.find((p) => p.id === "B")?.diffs.filter((d) => "collection" in d.target && d.target.collection === "residentTaxAssessment")).toHaveLength(1);
    const b = edit(b1.wh, cat, "B", `work/${SPOUSE}/residentTax`, to(120_000));
    const got = applyPlan(b.wh, "C", cat).request as EngineRequest;
    expect(amounts(got)).toEqual([50_000]);
    expect(amounts(planView(b.wh, cat, "C").request as EngineRequest)).toEqual([50_000]);
    // 土台のプランは自分の決定額のまま
    const base = applyPlan(b.wh, "B", cat).request as EngineRequest;
    expect(amounts(base)).toEqual([120_000]);
    // 計算は、土台のプランの決定額を上のプランの値にしたのと同じ（決定額1件で計算する）
    const one = structuredClone(base);
    for (const a of assessments(one)) a.amount = { value: 50_000, state: "confirmed", origin: { kind: "manual" } };
    expect(totals(got)).toEqual(totals(one));
    expect(totals(got)).not.toEqual(totals(base));
    // 違いの一覧・「変えたこと」に、決定額を足す行は上のプランの1行だけ
    const adds = diffRows(b.wh, cat, "C").filter((r) => r.label === "足す: 住民税の決定額（配偶者）");
    expect(adds.map((r) => r.inherited)).toEqual([false]);
    expect(changesOf(b.wh.proposals, "C", b.wh, cat).filter((r) => r.label === "足す: 住民税の決定額（配偶者）").map((r) => [r.inherited, r.state])).toEqual([[false, "ok"]]);
    expect(reviewCount(b.wh.proposals, "C", b.wh, cat)).toBe(0);
  });

  it("土台で先に決定額を足していれば、上のプランはその決定額を直す（2件にならない。これまでどおり）", () => {
    const { wh, cat } = setup("investmentCouple");
    const b = edit(wh, cat, "B", `work/${SPOUSE}/residentTax`, to(120_000));
    const c = edit(b.wh, cat, "C", `work/${SPOUSE}/residentTax`, to(50_000));
    expect(c.wh.proposals.find((p) => p.id === "C")?.diffs.map((d) => d.op)).toEqual(["set"]);
    expect(amounts(applyPlan(c.wh, "C", cat).request as EngineRequest)).toEqual([50_000]);
    expect(amounts(applyPlan(c.wh, "B", cat).request as EngineRequest)).toEqual([120_000]);
  });

  it("上のプランで決定額を足したあとに現状でも決定額を入れたら、上のプランは自分の決定額1件で計算する", () => {
    const { wh, cat } = setup("investmentCouple");
    const c = edit(wh, cat, "C", `work/${SPOUSE}/residentTax`, to(50_000));
    const now = editNow(c.wh, cat, `work/${SPOUSE}/residentTax`, 90_000);
    expect(amounts(now.wh.request)).toEqual([90_000]);
    expect(amounts(applyPlan(now.wh, "C", now.cat).request as EngineRequest)).toEqual([50_000]);
    expect(amounts(applyPlan(now.wh, "B", now.cat).request as EngineRequest)).toEqual([90_000]);
    // 現状の決定額があった所に入れる（並びの順を変えない）
    const list = (r: EngineRequest) => assessmentsOf(r).map((a) => a.member);
    expect(list(applyPlan(now.wh, "C", now.cat).request as EngineRequest)).toEqual(list(now.wh.request));
  });
});

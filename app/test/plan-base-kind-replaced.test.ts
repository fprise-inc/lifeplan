// 土台のプランで直した欄と、上のプランで種類を変えた（置き換えた）物（0036 の追記 2026-11-14）
// - 上のプランが物の種類を変えて置き換えたら、その物を指す土台の値を変える差分は上のプランに当てない（置き換えたプランが勝つ）。
//   上のプランの中身は、種類を変えた直後に画面で見た世帯と同じ。違いの一覧にも土台のその行を出さない。種類が同じでも、置き換えで欄の入れ物が
//   無くなる形（車の払い方を現金にする）は同じ扱い
// - 土台のプランが種類を変えて置き換えた物に、上のプランの直した欄が今の種類に無いときは当てずに要確認にする（計算できない形にしない）
import { describe, expect, it } from "vitest";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { fromRequest, newId, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { supersededByReplacement, type PlanDiff } from "../src/workspace/plans/diffs.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { diffRows, planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { applyDiffs, applyPlan, changesOf, dropChange, effectiveValues, type Proposal } from "../src/workspace/plans/plans.ts";
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
/** 収入の合計（計算できなければその理由） */
const income = (req: EngineRequest): string => {
  try {
    return `収入の合計 ${screenTotals(preview(forEngine(req)), req).income}円`;
  } catch (e) {
    return `計算できない: ${String(e).slice(0, 160)}`;
  }
};
/** 欄を直して、そのプランの差分にする */
function edit(wh: WorkingHousehold, cat: Catalog, pid: string, key: string, value: (now: unknown) => unknown): { wh: WorkingHousehold; screen: WorkingHousehold } {
  const v = planView(wh, cat, pid);
  const f = fieldOf(v, key);
  const screen = f.set(v, value(f.get(v).value) as never);
  return { wh: recordPlanEdit(wh, cat, pid, v, screen), screen };
}
const plus = (n: number) => (now: unknown) => (now as number) + n;
const to = (x: unknown) => () => x;

// 見本の世帯「住宅購入」の本人（会社員）と、見本の世帯「会社の役員」の役員退職慰労金
const WORKER = "dc9e7d37-44c1-490e-b7b5-2a6e49ee08a9";
const BENEFIT = "37ecfa8f-7c8d-4959-82f9-2ac760d1bdab";

describe("土台のプランで欄を直し、上のプランでその物の種類を変える", () => {
  it("働き方: 土台で年収を+100万円 → 上のプランで働き方を自営業に。上のプランは種類を変えた直後の画面の世帯と同じに計算する", () => {
    const { wh, cat } = setup("housingPurchase");
    const b = edit(wh, cat, "B", `work/${WORKER}/now/total`, plus(1_000_000));
    const c = edit(b.wh, cat, "C", `work/${WORKER}/now/type`, to("selfEmployed"));
    const got = applyPlan(c.wh, "C", cat).request as EngineRequest;
    expect(income(got)).toBe(income(c.screen.request as EngineRequest));
    expect(income(got)).not.toMatch(/計算できない/);
    // 自営業の期間に給与の欄を書かない
    const period = (got.input.household.employmentPeriods ?? []).find((p) => p.member === WORKER && p.type === "selfEmployed") as unknown as Record<string, unknown>;
    expect(period.salary).toBeUndefined();
    // 上のプランの違いの一覧は「置き換え: 働き方」だけ。土台の年収の行は出さない（土台のプランの一覧には残る）
    expect(diffRows(c.wh, cat, "C").map((r) => `${r.kind} ${r.inherited ? "土台" : "自分"}`)).toEqual(["replace 自分"]);
    expect(changesOf(c.wh.proposals, "C", c.wh, cat).every((r) => !r.inherited)).toBe(true);
    expect(diffRows(c.wh, cat, "B")).toHaveLength(1);
    // 結果のタブで動かす値にも、土台の年収を入れない（入れると、結果のタブの計算でまた当たる）
    const values = effectiveValues(c.wh, "C");
    expect(Object.keys(values).every((k) => !k.includes(WORKER) || k === "@plan")).toBe(true);
    // 土台のプランは年収を直したまま
    expect(income(applyPlan(c.wh, "B", cat).request as EngineRequest)).toBe(income(b.screen.request as EngineRequest));
  });

  it("順番が逆でも同じ: 先に上のプランで働き方を自営業にしてから土台の年収を直しても、触っていない上のプランの計算は変わらない", () => {
    const { wh, cat } = setup("housingPurchase");
    const c = edit(wh, cat, "C", `work/${WORKER}/now/type`, to("selfEmployed"));
    const before = income(applyPlan(c.wh, "C", cat).request as EngineRequest);
    expect(before).toBe(income(c.screen.request as EngineRequest));
    const b = edit(c.wh, cat, "B", `work/${WORKER}/now/total`, plus(1_000_000));
    expect(income(applyPlan(b.wh, "C", cat).request as EngineRequest)).toBe(before);
    expect(changesOf(b.wh.proposals, "C", b.wh, cat).filter((r) => r.state !== "ok")).toEqual([]);
  });

  it("退職金: 土台で最終報酬月額を+10万円 → 上のプランで種類を「公務員の退職手当」に。上のプランは推定の最終の月給のまま（土台の値で黙って増えない）", () => {
    const { wh, cat } = setup("executiveOwner");
    const b = edit(wh, cat, "B", `retirement/${BENEFIT}/finalMonthly`, plus(100_000));
    const c = edit(b.wh, cat, "C", `retirement/${BENEFIT}/kind`, to("civilServantAllowance"));
    const got = applyPlan(c.wh, "C", cat).request as EngineRequest;
    expect(income(got)).toBe(income(c.screen.request as EngineRequest));
    const rb = (r: EngineRequest) => (r.input.household.retirementBenefits ?? []).find((x) => x.id === BENEFIT);
    expect(rb(got)).toEqual(rb(c.screen.request as EngineRequest));
  });

  it("事業所得: 土台で事業所得を直す → 上のプランで働き方を正社員に。会社員の期間に事業所得を残さない", () => {
    const { wh, cat } = setup("survivorSelfEmployed");
    const who = "0bb1d50e-9c28-463f-ac50-4b270b02b771";
    const b = edit(wh, cat, "B", `work/${who}/now/business`, to(6_000_000));
    const c = edit(b.wh, cat, "C", `work/${who}/now/type`, to("regular"));
    const view = planView(c.wh, cat, "C");
    const period = (w: WorkingHousehold) => (w.request.input.household.employmentPeriods ?? []).find((p) => p.member === who && p.type === "regular") as unknown as Record<string, unknown>;
    expect(period(view).business).toBeUndefined();
    expect(period(view)).toEqual(period(c.screen));
    expect(income(view.request as EngineRequest)).toBe(income(c.screen.request as EngineRequest));
    expect(diffRows(c.wh, cat, "C").some((r) => r.inherited)).toBe(false);
  });

  it("車: 土台でローンの金利を直す → 上のプランで払い方を現金に（種類は同じで、ローンの欄が無くなる置き換え）。現金で払う車にローンの欄を書かない", () => {
    const { wh, cat } = setup("unexplainedSpending");
    const car = "2508e050-74e9-471f-a10a-6b49b44adb91";
    const b = edit(wh, cat, "B", `ev/car/${car}/rate`, to("0.025"));
    const c = edit(b.wh, cat, "C", `ev/car/${car}/pay`, to("cash"));
    const got = applyPlan(c.wh, "C", cat).request as EngineRequest;
    expect(income(got)).not.toMatch(/計算できない/);
    const cars = (r: EngineRequest) => (r.input.household as unknown as { cars?: { id: string }[] }).cars?.find((x) => x.id === car);
    expect(cars(got)).toEqual(cars(c.screen.request as EngineRequest));
    expect(diffRows(c.wh, cat, "C").some((r) => r.inherited)).toBe(false);
  });

  it("同じ1つのプランの中で年収を直してから働き方を自営業にしても、計算できる（これまでどおり）", () => {
    const { wh, cat } = setup("housingPurchase");
    const b1 = edit(wh, cat, "B", `work/${WORKER}/now/total`, plus(1_000_000));
    const b2 = edit(b1.wh, cat, "B", `work/${WORKER}/now/type`, to("selfEmployed"));
    expect(income(applyPlan(b2.wh, "B", cat).request as EngineRequest)).toBe(income(b2.screen.request as EngineRequest));
    expect(diffRows(b2.wh, cat, "B").map((r) => r.kind)).toEqual(["replace"]);
  });
});

describe("土台のプランで種類を変え、上のプランでその物の欄を直す", () => {
  it("上のプランで年収を直したあとに土台で働き方を自営業にすると、上のプランの年収は当てずに要確認にする（計算できない形にしない）", () => {
    const { wh, cat } = setup("housingPurchase");
    const c = edit(wh, cat, "C", `work/${WORKER}/now/total`, plus(1_000_000));
    const b = edit(c.wh, cat, "B", `work/${WORKER}/now/type`, to("selfEmployed"));
    const got = applyPlan(b.wh, "C", cat).request as EngineRequest;
    // 上のプランの中身は土台のプランと同じ（年収の直しは自営業の期間に無い欄なので当てない）
    expect(income(got)).toBe(income(applyPlan(b.wh, "B", cat).request as EngineRequest));
    expect(income(got)).not.toMatch(/計算できない/);
    const review = changesOf(b.wh.proposals, "C", b.wh, cat).filter((r) => r.state !== "ok");
    expect(review.map((r) => [r.state, r.inherited, r.reviewNote])).toEqual([["missing", false, "プランでこの物の種類や形が変わり、この欄が無くなりました"]]);
    // 「この差分を外す」で消せる（上のプランの差分が無くなる）
    const key = review[0]?.key as string;
    const dropped = dropChange(b.wh, cat, "C", key);
    expect(dropped.proposals.find((p) => p.id === "C")?.diffs).toEqual([]);
    expect(changesOf(dropped.proposals, "C", dropped, cat).map((r) => [r.inherited, r.state])).toEqual([[true, "ok"]]);
  });

  it("土台で働き方を自営業にしたあとに、上のプランで自営業の事業所得を直すと当てる（今の種類にある欄）", () => {
    const { wh, cat } = setup("housingPurchase");
    const b = edit(wh, cat, "B", `work/${WORKER}/now/type`, to("selfEmployed"));
    const c = edit(b.wh, cat, "C", `work/${WORKER}/now/business`, plus(1_000_000));
    const got = applyPlan(c.wh, "C", cat).request as EngineRequest;
    expect(income(got)).toBe(income(c.screen.request as EngineRequest));
    expect(income(got)).not.toBe(income(applyPlan(c.wh, "B", cat).request as EngineRequest));
    // 違いの一覧（入力のホーム）に要確認は出ない
    expect(diffRows(c.wh, cat, "C").map((r) => [r.kind, r.inherited, r.review?.state ?? "ok"])).toEqual([
      ["replace", true, "ok"],
      ["set", false, "ok"],
    ]);
  });
});

describe("土台のプランで種類を変え、上のプランで新しい種類の欄を直す（空の欄に値を入れる）", () => {
  it("年金: 土台で種類を公務員の年金に → 上のプランで年金の年額を入れると当てる（置き換えた物で空の欄でも、今の種類の欄なら当てる）", () => {
    const { wh, cat } = setup("sampleSeniorRental");
    const pension = "e5254516-4271-467f-be92-059442a54adb";
    const b = edit(wh, cat, "B", `retirement/${pension}/kind`, to("civilServantPension"));
    const c = edit(b.wh, cat, "C", `retirement/${pension}/annual`, plus(1_000_000));
    const got = applyPlan(c.wh, "C", cat).request as EngineRequest;
    expect(income(got)).toBe(income(c.screen.request as EngineRequest));
    expect(income(got)).not.toBe(income(applyPlan(c.wh, "B", cat).request as EngineRequest));
  });
});

describe("種類を変えた置き換えに負ける差分（supersededByReplacement）", () => {
  const { wh, cat } = setup("housingPurchase");
  const input = wh.request.input as unknown as { household: { employmentPeriods: Record<string, unknown>[] } };
  const period = input.household.employmentPeriods.find((p) => p.member === WORKER) as Record<string, unknown>;
  const id = period.id as string;
  const set = (value: number): PlanDiff => ({ id: newId(), op: "set", target: { object: id }, item: "employment.salary.annual", at: [], value: { value, state: "confirmed", origin: { kind: "manual" } }, before: null, enabled: true, origin: { kind: "manual" }, note: null });
  const replace = (obj: Record<string, unknown>): PlanDiff[] => {
    const pair = newId();
    return [
      { id: newId(), op: "remove", target: { object: id }, item: null, at: [], value: null, before: structuredClone(period), pair, enabled: true, origin: { kind: "manual" }, note: null },
      { id: newId(), op: "add", target: { collection: "employment" }, item: null, at: [], value: obj, before: null, pair, enabled: true, origin: { kind: "manual" }, note: null },
    ];
  };

  it("後のプランが種類を変えた物を指す、前のプランの値を変える差分だけ。同じプランの差分・後のプランの差分は負けない", () => {
    const early = set(9_000_000);
    const own = set(8_000_000);
    const later = set(7_000_000);
    const swap = replace({ ...structuredClone(period), type: "selfEmployed" });
    const got = supersededByReplacement(input, [{ diffs: [early] }, { diffs: [...swap, own] }, { diffs: [later] }]);
    expect([...got]).toEqual([early.id]);
  });

  it("種類が同じ置き換え（値を省いただけなど）は、これまでどおり土台の差分を当てる", () => {
    const early = set(9_000_000);
    const same = replace({ ...structuredClone(period), note: "置き換え" });
    expect(supersededByReplacement(input, [{ diffs: [early] }, { diffs: same }]).size).toBe(0);
    const req = applyDiffs(wh, [{ id: "B", diffs: [early] }, { id: "C", diffs: same }], cat).request;
    const p = (req.input.household.employmentPeriods ?? []).find((x) => x.id === id) as unknown as { salary: { annual: { value: number } | number } };
    const annual = p.salary.annual;
    expect(typeof annual === "number" ? annual : annual.value).toBe(9_000_000);
  });

  it("オフにした置き換えには負けない", () => {
    const early = set(9_000_000);
    const off = replace({ ...structuredClone(period), type: "selfEmployed" }).map((d) => ({ ...d, enabled: false }));
    expect(supersededByReplacement(input, [{ diffs: [early] }, { diffs: off }]).size).toBe(0);
  });
});

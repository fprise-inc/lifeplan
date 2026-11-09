// 相続・贈与のカード（0060）: 受け取る相続の時期の推定（相手の亡くなる見込みの10か月後）、不確かな行の「計算に入れる」、贈与する人は読むだけ、
// 遺したい額（表示だけ。表の最後の年の金融資産と比べる）、相続税の目安の設定（世帯に保存し、計算の要求からは外れる）と時点ごとの見せ方
import { describe, expect, it } from "vitest";
import type { PreviewResult } from "../src/engine/types.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { chartRequests } from "../src/workspace/contingency/requests.ts";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { CAUTION_TEXT, inheritanceRequest, inheritanceView, legacyLine, NOT_INCLUDED_TEXT } from "../src/workspace/input/inheritanceLine.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { addOutside } from "../src/workspace/input/stages/care.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { INHERIT_AFTER_MONTHS } from "../src/workspace/input/stages/inheritance.ts";
import { fieldAddress, fieldStatus } from "../src/workspace/input/valueState.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { roles } from "../src/workspace/roles.ts";
import { resolveTimepoint } from "../src/workspace/timepoint.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const stage = (wh: WorkingHousehold): StageDef => buildStage("inheritance", wh);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
const actionOf = (wh: WorkingHousehold, key: string, s: StageDef = stage(wh)) => {
  const a = s.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((x) => x.key === key);
  if (a === undefined) throw new Error(`no action ${key}`);
  return a;
};
const estimate = (wh: WorkingHousehold): PreviewResult => preview(forEngine(inheritanceRequest(wh.request)));

describe("相続・贈与のカード: 受け取る予定（区画A）", () => {
  it("「＋ 相続・遺贈」: 相手は世帯の外の親、受け取る時期は親の亡くなる見込みの10か月後（年齢の時点・仮の印）、額は未入力", () => {
    const w0 = addOutside(blankHousehold(BASE, seq()), "parent");
    const parent = w0.request.input.household.members.find((m) => m.kind === "parent")!;
    const wh = actionOf(w0, "money/inherit/in/add/inheritance").run(w0);
    const f = wh.request.input.household.incomeFlows![0]!;
    expect(f.counterparty).toBe(parent.id);
    const h = wh.request.input.household;
    const death = resolveTimepoint(h, parent.leaves!)!;
    const at = resolveTimepoint(h, f.from)!;
    expect((Number(at.slice(0, 4)) - Number(death.slice(0, 4))) * 12 + (Number(at.slice(5)) - Number(death.slice(5)))).toBe(INHERIT_AFTER_MONTHS);
    expect(f.from.memberAge?.member).toBe(parent.id);
    expect(f.to).toEqual(f.from);
    expect(fieldStatus(fieldOf(wh, `in/${f.id}/from`), wh).status).toBe("estimated");
    expect(fieldStatus(fieldOf(wh, `in/${f.id}/amount`), wh).status).toBe("missing");
    // 見込みは簡易（札）
    expect(fieldOf(wh, `in/${f.id}/likelihood`).level).toBe("simple");
  });

  it("「不確か」の行は基本の計算に入れず、「この行を計算に入れる」の1押しで入れる（プランでは差分になる）", () => {
    const req = modelHousehold("parentCare");
    const w0 = fromRequest(req);
    const parent = w0.request.input.household.members.find((m) => m.kind === "parent")!;
    let wh = actionOf(w0, "money/inherit/in/add/inheritance").run(w0);
    const id = wh.request.input.household.incomeFlows![0]!.id;
    wh = fieldOf(wh, `in/${id}/amount`).set(wh, 10000000);
    wh = fieldOf(wh, `in/${id}/likelihood`).set(wh, "uncertain");
    expect(wh.request.input.household.incomeFlows![0]!.counterparty).toBe(parent.id);
    expect(forEngine(wh.request).input.household.incomeFlows ?? []).toEqual([]);
    const g = stage(wh).sections.find((s) => s.key === "inherit/receive")!.groups.find((x) => x.key === `in/${id}`)!;
    expect(g.note).toContain("計算に入れていません");
    const included = actionOf(wh, `in/${id}/includeInBase`).run(wh);
    expect(forEngine(included.request).input.household.incomeFlows).toHaveLength(1);
    expect(() => actionOf(included, `in/${id}/includeInBase`)).toThrow();
    // プランで押すと、そのプランの差分（includeInBase の set）。現状は変わらない
    const withPlan: WorkingHousehold = { ...wh, proposals: [{ id: "B", name: "プランB", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] }] };
    const cat = buildCatalog(withPlan, roles(req).find((r) => r.key === "self")!.member.id, null);
    const view = planView(withPlan, cat, "B");
    const w = recordPlanEdit(withPlan, cat, "B", view, actionOf(view, `in/${id}/includeInBase`).run(view));
    expect(w.request).toEqual(withPlan.request);
    expect(w.proposals[0]!.diffs.map((d) => [d.op, d.item])).toEqual([["set", "incomeFlow.includeInBase"]]);
  });

  it("贈与する人は読むだけの1行（物と欄は介護・親のカードの世帯の外の家族）。「＋ 足す」はこのカードに残る", () => {
    const w0 = blankHousehold(BASE, seq());
    const wh = actionOf(w0, "family/add/donor-parent").run(w0);
    const d = wh.request.input.household.donors![0]!;
    const sec = stage(wh).sections.find((s) => s.key === "family/donors")!;
    expect(sec.groups.flatMap((g) => g.fields).every((f) => f.readOnly !== undefined)).toBe(true);
    expect(buildStage("care", wh).sections.find((s) => s.key === "care/outside")!.groups.some((g) => g.key === `family/donor/${d.id}`)).toBe(true);
  });
});

describe("相続・贈与のカード: 遺したい額（区画C）", () => {
  it("要求の入力の legacy に値の箱で持ち（当て先は plan.legacy）、空にすると入れ物ごと消える。計算の要求からは外れる", () => {
    const wh0 = fromRequest(modelHousehold("lifetime100Assets"));
    const f = fieldOf(wh0, "inherit/legacy/amount");
    expect(f.level).toBe("simple");
    expect(fieldAddress(f, wh0)).toEqual({ target: { plan: "input" }, item: "plan.legacy", at: ["amount"] });
    const wh = f.set(wh0, 30000000);
    expect(wh.request.input.legacy?.amount).toMatchObject({ value: 30000000, state: "confirmed" });
    expect(forEngine(wh.request).input.legacy).toBeUndefined();
    expect(preview(forEngine(wh.request)).table).toEqual(preview(forEngine(wh0.request)).table);
    const cleared = fieldOf(wh, "inherit/legacy/amount").set(wh, null);
    expect(cleared.request.input.legacy).toBeUndefined();
  });

  it("表の最後の年の金融資産と、物価上昇率で表の最後の年の値段にした遺したい額を比べる", () => {
    const wh0 = fromRequest(modelHousehold("lifetime100Assets"));
    const r = estimate(wh0);
    expect(legacyLine(wh0, r)).toBeNull();
    const small = fieldOf(wh0, "inherit/legacy/amount").set(wh0, 1);
    expect(legacyLine(small, r)).toContain("足ります");
    const big = fieldOf(wh0, "inherit/legacy/amount").set(wh0, 9_000_000_000);
    expect(legacyLine(big, r)).toContain("足りません");
    expect(legacyLine(big, r)).toContain(`${String(wh0.request.input.endYear)}年`);
  });

  it("プランで直すと、要求の入力の差分（plan.legacy・amount）になる", () => {
    const req = modelHousehold("lifetime100Assets");
    const wh: WorkingHousehold = { ...fromRequest(req), proposals: [{ id: "B", name: "プランB", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] }] };
    const cat = buildCatalog(wh, roles(req).find((r) => r.key === "self")!.member.id, null);
    const view = planView(wh, cat, "B");
    const w = recordPlanEdit(wh, cat, "B", view, fieldOf(view, "inherit/legacy/amount").set(view, 20000000));
    expect(w.request).toEqual(wh.request);
    expect(w.proposals[0]!.diffs.map((d) => [d.op, d.target, d.item])).toEqual([["set", { plan: "input" }, "plan.legacy"]]);
    expect(planView(w, cat, "B").request.input.legacy?.amount?.value).toBe(20000000);
  });
});

describe("相続・贈与のカード: 相続税の目安（区画D）", () => {
  it("設定は要求の入力の inheritanceTax に時点なしで持ち、計算の要求からは外れる。目安を求める要求はその設定を使う", () => {
    const wh0 = fromRequest(modelHousehold("housingPurchase"));
    const before = estimate(wh0).inheritanceTax!.points.find((p) => p.point === "now")!;
    let wh = fieldOf(wh0, "inherit/tax/realEstateRatio").set(wh0, "0.5");
    wh = fieldOf(wh, "inherit/tax/funeral").set(wh, 2000000);
    expect(wh.request.input.inheritanceTax).toEqual({ realEstateRatio: "0.5", funeral: 2000000 });
    expect(forEngine(wh.request).input.inheritanceTax).toBeUndefined();
    expect(fieldAddress(fieldOf(wh, "inherit/tax/funeral"), wh)).toEqual({ target: { plan: "input" }, item: "plan.inheritanceTax", at: ["funeral"] });
    const after = estimate(wh).inheritanceTax!.points.find((p) => p.point === "now" && p.decedent === before.decedent)!;
    expect(after.assets.taxablePrice).toBeLessThan(before.assets.taxablePrice);
    // 空にすると設定ごと消える
    let back = fieldOf(wh, "inherit/tax/realEstateRatio").set(wh, null);
    back = fieldOf(back, "inherit/tax/funeral").set(back, null);
    expect(back.request.input.inheritanceTax).toBeUndefined();
  });

  it("FP が入れた額（時点・亡くなる人ごと）は目安より優先し、目安は内訳に残る。法定相続人の数を直す口・養子の印", () => {
    const wh0 = fromRequest(modelHousehold("housingPurchase"));
    const self = wh0.request.input.household.members.find((m) => m.kind === "self")!;
    const child = wh0.request.input.household.members.find((m) => m.kind === "child")!;
    let wh = fieldOf(wh0, "inherit/tax/override/bothAfter").set(wh0, 5000000);
    wh = fieldOf(wh, `inherit/tax/heirs/${self.id}`).set(wh, 4);
    wh = fieldOf(wh, `inherit/tax/adopted/${child.id}`).set(wh, true);
    expect(wh.request.input.inheritanceTax).toMatchObject({ overrides: [{ point: "bothAfter", amount: 5000000 }], heirCounts: [{ decedent: self.id, count: 4 }], adopted: [child.id] });
    const r = estimate(wh);
    const both = r.inheritanceTax!.points.find((p) => p.point === "bothAfter")!;
    expect(both).toMatchObject({ state: "confirmed", amount: 5000000 });
    const now = r.inheritanceTax!.points.find((p) => p.point === "now" && p.decedent === self.id)!;
    expect(now.heirCount).toBe(4);
    const view = inheritanceView(wh, r);
    const v = view.points.find((p) => p.title.startsWith("二人とも亡くなった後"))!;
    expect(v.answer).toContain("FP が入れた額");
    expect(v.details.some((d) => d.includes("FP が入れた額を使っています"))).toBe(true);
    expect(view.points.find((p) => p.title === `いま${"ご本人"}が亡くなったら` || p.title.startsWith("いま"))!.details.some((d) => d.includes("（直した数）"))).toBe(true);
    // 養子の印を外すと配列から消え、ほかの設定は残る
    const un = fieldOf(wh, `inherit/tax/adopted/${child.id}`).set(wh, false);
    expect(un.request.input.inheritanceTax?.adopted).toBeUndefined();
    expect(un.request.input.inheritanceTax?.overrides).toHaveLength(1);
  });

  it("時点ごとの見せ方: 財産の内訳・法定相続人と基礎控除・当たりそうな注意・含めていないもの", () => {
    const wh = fromRequest(modelHousehold("housingPurchase"));
    const r = estimate(wh);
    const view = inheritanceView(wh, r);
    expect(view.points.length).toBeGreaterThanOrEqual(2);
    const p = view.points[0]!;
    expect(p.details[0]).toMatch(/^財産（\d{4}年末）: 金融資産 /);
    expect(p.details[1]).toMatch(/^法定相続人 \d+人.*基礎控除 /);
    // 持ち家があるので小規模宅地等の特例の注意
    expect(view.points.some((x) => x.cautions.includes(CAUTION_TEXT.smallLandSpecial!))).toBe(true);
    expect(view.notIncluded).toContain(NOT_INCLUDED_TEXT.twentyPercentSurcharge);
    expect(inheritanceView(wh, null).points).toEqual([]);
  });

  it("債務の内訳に、亡くなった人がまだ払っていない税を添える（salariedCoupleTwoKids のいま本人が亡くなったら。0039 の追記）", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const view = inheritanceView(wh, estimate(wh));
    const p = view.points.find((x) => x.title === "いまご本人が亡くなったら");
    expect(p?.details[0]).toContain("（うち まだ払っていない税 22.1万円）");
  });

  it("万一のタブの死亡の想定の要求も、世帯の設定（FP が入れた額など）を使う", () => {
    const wh0 = fromRequest(modelHousehold("housingPurchase"));
    const self = wh0.request.input.household.members.find((m) => m.kind === "self")!;
    const wh = fieldOf(wh0, `inherit/tax/override/contingency/${self.id}`).set(wh0, 3000000);
    const reqs = chartRequests(wh, "current", [], { key: "death:self", kind: "death", member: self.id, label: "ご本人の死亡", who: "ご本人" }, 2030);
    const sc = Object.entries(reqs).find(([k]) => k.endsWith("sc"))![1];
    expect(sc.input.inheritanceTax).toMatchObject({ points: ["contingency"], overrides: [{ point: "contingency", decedent: self.id, amount: 3000000 }] });
    const r = preview(forEngine(sc));
    expect(r.inheritanceTax!.points[0]).toMatchObject({ point: "contingency", state: "confirmed", amount: 3000000 });
  });

  it("配偶者がいなければ名義の無い財産の分け方の欄は出さない", () => {
    const one = blankHousehold(BASE, seq());
    expect(allFields(stage(one)).some((f) => f.key === "inherit/tax/unassignedShare")).toBe(false);
    expect(allFields(stage(addMember(one, "spouse"))).some((f) => f.key === "inherit/tax/unassignedShare")).toBe(true);
  });
});

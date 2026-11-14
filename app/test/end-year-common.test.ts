// 表の最後の年はどのプランにも共通（世帯で1つ。0043・0070・0073 の追記 2026-11-05）:
// - 何歳まで見るかは標準の1つの欄「表を何歳まで見るか」（人と年齢・年で決める。0070 の追記 2026-11-13）。選んだ人と年齢は家族を直しても付いていく
// - プランを直している間に表の最後の年の欄を変えると、プランの差分にせず現状に書く。欄の下に「どのプランにも共通」の一言
// - プランの計算はいつも現状の表の最後の年で終わる。前の版で作ったプランの差分は読むときに外して知らせる
// - 事務所の既定値で「標準は何歳まで」を選べる（新しい世帯に写し、欄の「既定」もその年齢）
import { afterEach, describe, expect, it } from "vitest";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, endYearForAge, endYearRuleOf, followStandards, fromRequest, mutate, standardEndYear, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { END_YEAR_SHARED, endYearNotice, endYearToStandard } from "../src/workspace/input/stages/assumptions.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus, planStateOp } from "../src/workspace/input/valueState.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { applyPlan, type Proposal } from "../src/workspace/plans/plans.ts";
import type { PlanDiff } from "../src/workspace/plans/diffs.ts";
import { withoutSharedPlanDiffs } from "../src/workspace/plans/sharedItems.ts";
import { householdNoticeText } from "../src/workspace/header/status.ts";
import { applyOfficeDefaults, DEFAULT_OFFICE_SETTINGS, isDefaultSettings, publishOfficeSettings, readOfficeSettings } from "../src/workspace/office/settings.ts";
import { setOfficeNow, STANDARD_OFFICE_NOW } from "../src/workspace/office/current.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

afterEach(() => setOfficeNow(STANDARD_OFFICE_NOW));

/** モデル世帯（表の最後の年は標準にそろえる） */
const open = (id = "salariedCoupleTwoKids"): WorkingHousehold => mutate(fromRequest(modelHousehold(id)), (h, req) => void (req.input.endYear = standardEndYear(h)));
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(buildStage("assumptions", wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const PLAN_ID = "00000000-0000-4000-8000-00000000e701";
const withPlan = (wh: WorkingHousehold, diffs: PlanDiff[] = []): WorkingHousehold => ({
  ...wh,
  proposals: [{ id: PLAN_ID, name: "プランB 定年を延ばす", base: null, diffs, tags: [], createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z" } as Proposal],
});
const catOf = (wh: WorkingHousehold) => buildCatalog(wh, roles(wh.request).find((r) => r.key === "self")!.member.id, null);
/** 前の版の画面で作った、表の最後の年を変えるプランの差分 */
const oldEndYearDiff = (year: number, before: number): PlanDiff => ({
  id: "00000000-0000-4000-8000-00000000e702",
  op: "set",
  target: { plan: "input" },
  item: "plan.endYear",
  at: [],
  value: { value: year, state: "confirmed", origin: { kind: "manual" } },
  before: { value: before, state: "confirmed", origin: { kind: "manual" } },
  enabled: true,
  origin: { kind: "manual" },
  note: null,
});
const younger = (w: WorkingHousehold) =>
  mutate(w, (h) => {
    for (const m of h.members) if (m.kind === "self" || m.kind === "spouse") m.birth = { ...m.birth, birthYearMonth: "1995-04" };
  });

describe("表を何歳まで見るか（標準の1つの欄）", () => {
  it("人と年齢で選ぶ。既定は若い方が100歳になる年で、選ぶとその人がその年齢になる年になる", () => {
    const wh = open();
    const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const f = fieldOf(wh, "assume/endYear");
    expect(f.level).toBe("simple");
    expect(f.get(wh).value).toBe("default");
    const w95 = f.set(wh, `m:${spouse.id}:95`);
    expect(w95.request.input.endYear).toBe(1983 + 95);
    expect(fieldOf(w95, "assume/endYear").get(w95).value).toBe(`m:${spouse.id}:95`);
    expect(endYearRuleOf(w95)).toEqual({ kind: "member", member: spouse.id, age: 95 });
    // 既定と違う年は推定ではない。範囲の知らせ（85〜105歳の外）は出ない
    expect(fieldStatus(fieldOf(w95, "assume/endYear"), w95).status).toBe("confirmed");
    expect(endYearNotice(w95)).toBeNull();
    for (const o of f.kind === "select" ? f.options.filter((x) => x.value !== "year") : []) expect(endYearNotice(f.set(wh, o.value)), o.label).toBeNull();
  });

  it("選んだ人と年齢は、家族の生年月を直しても同じ年齢のまま付いていく。「年で決める…」の年・確定した年は付いていかない", () => {
    const wh = open();
    const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const f = fieldOf(wh, "assume/endYear");
    const w95 = f.set(wh, `m:${spouse.id}:95`);
    expect(endYearRuleOf(w95)).toEqual({ kind: "member", member: spouse.id, age: 95 });
    expect(followStandards(w95, younger(w95)).request.input.endYear).toBe(2090);
    // 「年で決める…」で入れた年は付いていかない（選択肢と同じ年でも、年で決めた年のまま）
    const byYear = f.set(wh, "year");
    expect(byYear.request.input.endYear).toBe(wh.request.input.endYear);
    expect(fieldOf(byYear, "assume/endYear").get(byYear).value).toBe("year");
    const typed = fieldOf(byYear, "assume/endYear/year").set(byYear, 2093);
    expect(fieldOf(typed, "assume/endYear").get(typed).value).toBe("year");
    expect(followStandards(typed, younger(typed)).request.input.endYear).toBe(2093);
    const same = fieldOf(byYear, "assume/endYear/year").set(byYear, 1983 + 95);
    expect(fieldOf(same, "assume/endYear").get(same).value).toBe("year");
    expect(followStandards(same, younger(same)).request.input.endYear).toBe(1983 + 95);
    // 「年で決める…」を選び直しても世帯は変わらない
    expect(fieldOf(typed, "assume/endYear").set(typed, "year")).toBe(typed);
  });

  it("前提と推定の一覧には「表を何歳まで見るか」の行だけを出す（年で決める欄の行は出さない）", async () => {
    const { assumptionRows } = await import("../src/workspace/input/assumptionList.ts");
    const rows = assumptionRows(open());
    expect(rows.find((r) => r.id === "field:assume/endYear")).toMatchObject({ label: "表を何歳まで見るか", value: `${standardEndYear(open().request.input.household)}年（配偶者が100歳まで）` });
    const wh = fieldOf(open(), "assume/endYear").set(open(), "year");
    const yearRows = assumptionRows(wh);
    expect(yearRows.some((r) => r.id === "field:assume/endYear/year")).toBe(false);
    expect(yearRows.find((r) => r.id === "field:assume/endYear")?.value).toBe(`${wh.request.input.endYear}年`);
  });
});

describe("プランを直している間の表の最後の年", () => {
  it("表を何歳まで見るかの欄と「年で決める」の年の欄に「どのプランにも共通」の一言があり、結果のタブの動かす項目には出ない", () => {
    const wh0 = open();
    const wh = fieldOf(wh0, "assume/endYear").set(wh0, "year");
    const keys = allFields(buildStage("assumptions", wh))
      .filter((f) => f.key.startsWith("assume/endYear"))
      .map((f) => [f.key, f.planShared]);
    expect(keys.map(([k]) => k)).toEqual(["assume/endYear", "assume/endYear/year"]);
    expect(keys.every(([, s]) => s === END_YEAR_SHARED)).toBe(true);
    expect(catOf(wh).items.some((i) => i.key.startsWith("field:assume/endYear"))).toBe(false);
  });

  it("表を何歳まで見るかの欄を直すと、プランの差分にせず現状の表の最後の年と決め方が変わる（全部のプランが同じ年で終わる）", () => {
    const wh = withPlan(open());
    const cat = catOf(wh);
    const view = planView(wh, cat, PLAN_ID);
    const self = view.request.input.household.members.find((m) => m.kind === "self")!;
    const edited = fieldOf(view, "assume/endYear").set(view, `m:${self.id}:90`);
    const n = recordPlanEdit(wh, cat, PLAN_ID, view, edited);
    expect(n.proposals[0]!.diffs).toEqual([]);
    expect(n.request.input.endYear).toBe(1981 + 90);
    expect(endYearRuleOf(n)).toEqual({ kind: "member", member: self.id, age: 90 });
    expect(fieldOf(planView(n, cat, PLAN_ID), "assume/endYear").get(planView(n, cat, PLAN_ID)).value).toBe(`m:${self.id}:90`);
    expect(planView(n, cat, PLAN_ID).request.input.endYear).toBe(n.request.input.endYear);
    // 年の欄の「この値にする」も現状の値の状態にする
    const confirmed = planStateOp(wh, cat, PLAN_ID, fieldOf(view, "assume/endYear"), "confirm");
    expect(confirmed.proposals[0]!.diffs).toEqual([]);
    expect((confirmed.request.input as { valueStates?: Record<string, { state: string }> }).valueStates?.["plan.endYear"]?.state).toBe("confirmed");
    // 範囲の知らせの「既定にする」も現状に当たる
    const off = withPlan(mutate(open(), (_h, req) => void (req.input.endYear = 2125)));
    const offView = planView(off, cat, PLAN_ID);
    const fixed = recordPlanEdit(off, cat, PLAN_ID, offView, endYearToStandard(offView));
    expect(fixed.request.input.endYear).toBe(standardEndYear(off.request.input.household));
    expect(fixed.proposals[0]!.diffs).toEqual([]);
  });

  it("プランで大人の生年月を直しても、現状の表の最後の年は変わらず、プランの表も現状と同じ年で終わる", () => {
    const wh = withPlan(open());
    const cat = catOf(wh);
    const view = planView(wh, cat, PLAN_ID);
    const spouse = view.request.input.household.members.find((m) => m.kind === "spouse")!;
    const birth = allFields(buildStage("family", view)).find((f) => f.key === `family/${spouse.id}/birth`)!;
    const edited = birth.set(view, "2000-04");
    expect(edited.request.input.endYear).not.toBe(wh.request.input.endYear);
    const n = recordPlanEdit(wh, cat, PLAN_ID, view, edited);
    expect(n.request.input.endYear).toBe(wh.request.input.endYear);
    expect(n.proposals[0]!.diffs.some((d) => d.item === "plan.endYear")).toBe(false);
    expect(n.proposals[0]!.diffs.length).toBeGreaterThan(0);
    expect(planView(n, cat, PLAN_ID).request.input.endYear).toBe(wh.request.input.endYear);
  });

  it("差分が残っていても計算には当てず、プランの要求はいつも現状の表の最後の年で終わる", () => {
    const base = open();
    const wh = withPlan(base, [oldEndYearDiff(2070, base.request.input.endYear)]);
    const applied = applyPlan(wh, PLAN_ID, catOf(wh));
    expect(applied.request.input.endYear).toBe(base.request.input.endYear);
    expect(applied.reviews.get("00000000-0000-4000-8000-00000000e702")?.state).toBe("retired");
    const years = preview(applied.request).table.map((c) => c.year);
    expect(Math.max(...years)).toBe(base.request.input.endYear);
  });
});

describe("前の版で作ったプランの表の最後の年の差分", () => {
  it("読むときに外し、どのプランも現状の年で終わると知らせる（黙って捨てない）。外す物が無ければ同じ世帯", () => {
    const base = open();
    const wh = withPlan(base, [oldEndYearDiff(2070, base.request.input.endYear)]);
    const read = withoutSharedPlanDiffs(wh);
    expect(read.proposals[0]!.diffs).toEqual([]);
    const n = read.notices?.find((x) => x.kind === "planEndYearShared");
    expect(n).toMatchObject({ plans: 1, names: ["プランB 定年を延ばす"], years: [2070], endYear: base.request.input.endYear });
    const text = householdNoticeText(n!);
    expect(text?.title).toBe("表の最後の年をどのプランにも共通にしました");
    expect(text?.text).toContain("プラン「プランB 定年を延ばす」で変えていた表の最後の年（2070年）は外し");
    expect(text?.text).toContain(`現状と同じ年（${base.request.input.endYear}年）で終わる`);
    // 同じ世帯をもう一度読んでも、知らせは1つ
    expect(withoutSharedPlanDiffs({ ...wh, notices: read.notices ?? [] }).notices?.filter((x) => x.kind === "planEndYearShared")).toHaveLength(1);
    expect(withoutSharedPlanDiffs(base)).toBe(base);
  });
});

describe("事務所の既定値の「標準は何歳まで」（0073 の追記 2026-11-05）", () => {
  it("選び方の年齢だけを読む（100歳は既定と同じなので持たない）。選べば既定値の設定ではなくなる", () => {
    expect(readOfficeSettings({ version: 1, endAge: 95 }).endAge).toBe(95);
    expect(readOfficeSettings({ version: 1, endAge: 100 }).endAge).toBeUndefined();
    expect(readOfficeSettings({ version: 1, endAge: 98 }).endAge).toBeUndefined();
    expect(isDefaultSettings({ ...DEFAULT_OFFICE_SETTINGS, endAge: 95 })).toBe(false);
  });

  it("新しい世帯の表の最後の年に写し、欄の「既定」・範囲の知らせの「既定にする」もその年齢にする。作った世帯は変えない", () => {
    const s = { ...DEFAULT_OFFICE_SETTINGS, endAge: 95 };
    publishOfficeSettings(s);
    const fresh = applyOfficeDefaults(blankHousehold("2026-10"), s);
    const h = fresh.request.input.household;
    expect(fresh.request.input.endYear).toBe(endYearForAge(h, 95));
    expect(standardEndYear(h)).toBe(endYearForAge(h, 95));
    expect(fieldStatus(fieldOf(fresh, "assume/endYear"), fresh).status).toBe("estimated");
    const choice = fieldOf(fresh, "assume/endYear");
    expect(choice.get(fresh).value).toBe("default");
    expect(choice.kind === "select" ? choice.options.find((o) => o.value === "default")?.label : "").toBe("ご本人が95歳まで（既定）");
    // 前に作った世帯（100歳の年のまま）は、事務所の年齢を変えても100歳のまま家族の生年月に付いていく
    const kept = mutate(open(), (hh, req) => void (req.input.endYear = endYearForAge(hh, 100)));
    expect(followStandards(kept, younger(kept)).request.input.endYear).toBe(2095);
    // 外れた年の「既定にする」は事務所の年齢の年
    const off = mutate(open(), (_h, req) => void (req.input.endYear = 2125));
    expect(endYearToStandard(off).request.input.endYear).toBe(endYearForAge(off.request.input.household, 95));
  });
});

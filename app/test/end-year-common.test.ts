// 表の最後の年はどのプランにも共通（世帯で1つ。0043・0070・0073 の追記 2026-11-05）:
// - 何歳まで見るかの選び方（若い方が［90・95・100・105］歳になる年まで）は標準の欄。選んだ年齢は家族を直しても付いていく
// - プランを直している間に表の最後の年の欄を変えると、プランの差分にせず現状に書く。欄の下に「どのプランにも共通」の一言
// - プランの計算はいつも現状の表の最後の年で終わる。前の版で作ったプランの差分は読むときに外して知らせる
// - 事務所の既定値で「標準は何歳まで」を選べる（新しい世帯に写し、欄の「既定」もその年齢）
import { afterEach, describe, expect, it } from "vitest";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, endYearForAge, followedEndAge, followStandards, fromRequest, mutate, standardEndYear, type WorkingHousehold } from "../src/workspace/input/household.ts";
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

describe("何歳まで見るかの選び方（標準の欄）", () => {
  it("若い方が90・95・100・105歳になる年まで。既定は100歳で、選ぶとその年齢の年になる", () => {
    const wh = open();
    const f = fieldOf(wh, "assume/endYear/choice");
    expect(f.level).toBe("simple");
    expect(f.kind === "select" ? f.options.map((o) => o.value) : []).toEqual(["90", "95", "100", "105"]);
    expect(f.kind === "select" ? f.options.find((o) => o.value === "100")?.label : "").toContain("既定");
    expect(f.get(wh).value).toBe("100");
    const w95 = f.set(wh, "95");
    expect(w95.request.input.endYear).toBe(endYearForAge(wh.request.input.household, 95));
    expect(fieldOf(w95, "assume/endYear/choice").get(w95).value).toBe("95");
    // 年の欄は推定ではない（既定と違う年）。範囲の知らせ（85〜105歳の外）は出ない
    expect(fieldStatus(fieldOf(w95, "assume/endYear"), w95).status).toBe("confirmed");
    expect(endYearNotice(w95)).toBeNull();
    expect(endYearNotice(f.set(wh, "105"))).toBeNull();
    expect(endYearNotice(f.set(wh, "90"))).toBeNull();
  });

  it("選んだ年齢は、家族の生年月を直しても同じ年齢のまま付いていく。選び方の外の年・確定した年は付いていかない", () => {
    const wh = open();
    const f = fieldOf(wh, "assume/endYear/choice");
    const w95 = f.set(wh, "95");
    expect(followedEndAge(w95.request)).toBe(95);
    expect(followStandards(w95, younger(w95)).request.input.endYear).toBe(2090);
    // 年で入れた年（選び方の外）は「その他」で、付いていかない
    const typed = fieldOf(wh, "assume/endYear").set(wh, 2093);
    const st = fieldOf(typed, "assume/endYear/choice").get(typed);
    expect(st.value).toBe("other");
    expect(st.derived).toContain("選び方の年齢の外");
    expect(followedEndAge(typed.request)).toBeNull();
    expect(followStandards(typed, younger(typed)).request.input.endYear).toBe(2093);
    // 「その他」を選び直しても世帯は変わらない
    expect(fieldOf(typed, "assume/endYear/choice").set(typed, "other")).toBe(typed);
  });

  it("前提と推定の一覧には年の欄の行だけを出す（選び方の行は出さない）", async () => {
    const { assumptionRows } = await import("../src/workspace/input/assumptionList.ts");
    const rows = assumptionRows(open());
    expect(rows.some((r) => r.id === "field:assume/endYear")).toBe(true);
    expect(rows.some((r) => r.id === "field:assume/endYear/choice")).toBe(false);
  });
});

describe("プランを直している間の表の最後の年", () => {
  it("3つの欄（選び方・年・年齢）に「どのプランにも共通」の一言があり、結果のタブの動かす項目には出ない", () => {
    const wh = open();
    const keys = allFields(buildStage("assumptions", wh))
      .filter((f) => f.key.startsWith("assume/endYear"))
      .map((f) => [f.key, f.planShared]);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(keys.every(([, s]) => s === END_YEAR_SHARED)).toBe(true);
    expect(catOf(wh).items.some((i) => i.key.startsWith("field:assume/endYear"))).toBe(false);
  });

  it("選び方・年の欄を直すと、プランの差分にせず現状の表の最後の年が変わる（全部のプランが同じ年で終わる）", () => {
    const wh = withPlan(open());
    const cat = catOf(wh);
    const view = planView(wh, cat, PLAN_ID);
    const edited = fieldOf(view, "assume/endYear/choice").set(view, "90");
    const n = recordPlanEdit(wh, cat, PLAN_ID, view, edited);
    expect(n.proposals[0]!.diffs).toEqual([]);
    expect(n.request.input.endYear).toBe(endYearForAge(wh.request.input.household, 90));
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
    expect(fieldOf(fresh, "assume/endYear/choice").get(fresh).value).toBe("95");
    const choice = fieldOf(fresh, "assume/endYear/choice");
    expect(choice.kind === "select" ? choice.options.find((o) => o.value === "95")?.label : "").toContain("既定");
    // 前に作った世帯（100歳の年のまま）は、事務所の年齢を変えても100歳のまま家族の生年月に付いていく
    const kept = mutate(open(), (hh, req) => void (req.input.endYear = endYearForAge(hh, 100)));
    expect(followStandards(kept, younger(kept)).request.input.endYear).toBe(2095);
    // 外れた年の「既定にする」は事務所の年齢の年
    const off = mutate(open(), (_h, req) => void (req.input.endYear = 2125));
    expect(endYearToStandard(off).request.input.endYear).toBe(endYearForAge(off.request.input.household, 95));
  });
});

// 子ども・教育の入力項目の見直し（2026-11-14。0062・0063・0134 の追記）: 進路の型と「高校のあとの進路」を入力から外し、大学などの行の先頭で
// 「大学（4年）／短大／専門学校／大学などに行かない」を選ぶ・児童手当と就学支援金は詳細だけ・学校外の費用の4つの選び方（学校ごとの月額・
// 塾・習い事のまとまり）・保育園・幼稚園の言葉・段の見出しの額を月で数える・保育園の既定（共働き・働くひとり親）・保育園の詳細の欄
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { EngineRequest, Goal } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { EDUCATION_BASIS, educationStagesAddress } from "../src/workspace/input/fill.ts";
import { allFields, type FieldDef, type GroupDef, type StageDef } from "../src/workspace/input/form.ts";
import { groupUnits } from "../src/workspace/input/FieldViews.tsx";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { rowAt } from "../src/workspace/input/rows.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { COURSE_PRESETS, courseField, nurseryByDefault, outOfSchoolChoiceOf, periodText, stageCostLine, stageRemainingCost } from "../src/workspace/input/stages/education.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const noop = () => undefined;
const stage = (wh: WorkingHousehold): StageDef => buildStage("education", wh);
const fields = (wh: WorkingHousehold) => allFields(stage(wh));
const fieldOf = (wh: WorkingHousehold, suffix: string): FieldDef => {
  const f = fields(wh).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const groups = (wh: WorkingHousehold): GroupDef[] => stage(wh).sections.flatMap((s) => s.groups);
const actions = (wh: WorkingHousehold) => stage(wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
const goalOf = (wh: WorkingHousehold): Goal => (wh.request.input.household.goals ?? []).find((g) => g.kind === "education")!;
const stageIndex = (wh: WorkingHousehold, st: string) => goalOf(wh).education!.stages.findIndex((s) => s.stage === st);
const eduSum = (req: EngineRequest, row: string) => preview(req).table.filter((c) => c.row === row).reduce((s, c) => s + c.amount, 0);
const panel = (wh: WorkingHousehold, level: "simple" | "detail") => renderToString(h(InputPanel, { wh, itemId: "education", level, onLevel: noop, onSave: noop, onClose: noop }));

/** 本人40歳・配偶者・子（2016年5月生まれ。計算基準月に小学4年） */
function fresh(birth = "2016-05"): WorkingHousehold {
  const id = seq();
  let wh = blankHousehold(BASE, id);
  wh = mutate(wh, (hh) => void (hh.members[0]!.birth.birthYearMonth = "1986-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse", id));
  wh = withRefreshedEstimates(addChildWithEducation(wh, id));
  return withRefreshedEstimates(mutate(wh, (hh) => void (hh.members.find((m) => m.kind === "child")!.birth.birthYearMonth = birth)));
}

describe("進路の型・高校のあとの進路を入力から外し、大学などの行で選ぶ", () => {
  it("入力に「進路の型」「高校のあとの進路」は無い。大学の行の先頭に「大学・短大・専門学校」。結果のタブの進路の型（courseField）は今のまま", () => {
    const wh = fresh();
    const g = goalOf(wh);
    expect(fields(wh).some((f) => f.label === "進路の型" || f.label === "高校のあとの進路")).toBe(false);
    const uni = stageIndex(wh, "university");
    const row = groups(wh).find((x) => x.key === `edu/${g.id}/stage/${uni}`)!;
    expect(row.fields[0]!.key).toBe(`edu/${g.id}/higher`);
    expect(row.fields[0]!.kind === "select" && row.fields[0]!.options.map((o) => o.label)).toEqual(["大学（4年）", "短大", "専門学校", "大学などに行かない"]);
    expect(row.fields[0]!.level).toBe("simple");
    // 外すボタンは出さない（「大学などに行かない」で外す）
    expect(row.actions.some((a) => a.key.endsWith("/remove"))).toBe(false);
    // 結果のタブの進路の型は同じ型の一覧・同じ読み書き
    const course = courseField(g.id);
    expect(course.kind === "select" && course.options.length).toBe(COURSE_PRESETS.length + 1);
    expect(courseField(g.id).get(wh).value).toBe("univPrivate");
  });

  it("「大学などに行かない」は大学などの段を外し、「大学など」の行を欄だけで残す。選び直すと通い方・浪人・入れた年額を引き継ぐ", () => {
    let wh = fresh();
    const g = goalOf(wh);
    wh = mutate(wh, (hh) => {
      const st = (hh.goals ?? []).find((x) => x.id === g.id)!.education!.stages.find((s) => s.stage === "university")!;
      Object.assign(st, { living: "away", delayYears: 1, annualOverride: 1200000 });
    });
    const none = fieldOf(wh, `edu/${g.id}/higher`).set(wh, "none");
    expect(goalOf(none).education!.stages.some((s) => s.stage === "university")).toBe(false);
    const ph = groups(none).find((x) => x.key === `edu/${g.id}/higherNone`)!;
    expect(ph.title).toBe("大学など（18歳から）");
    expect(ph.fields.map((f) => [f.key, f.get(none).value])).toEqual([[`edu/${g.id}/higher`, "none"]]);
    // 高校の行の直後に置く。大学・短大・専門学校を足すボタンは出さない
    const keys = groups(none).map((x) => x.key);
    expect(keys.indexOf(`edu/${g.id}/higherNone`)).toBe(keys.indexOf(`edu/${g.id}/stage/${stageIndex(none, "highSchool")}`) + 1);
    expect(actions(none).some((a) => /\/addStage\/(university|juniorCollege|vocational)$/.test(a.key))).toBe(false);
    // 前の段のまま（replaceHigher）なので「大学などに行かない」の後に選び直すと、新しい段になる。同じ世帯で別の学校に選び直すと引き継ぐ
    const voc = fieldOf(wh, `edu/${g.id}/higher`).set(wh, "vocational");
    expect(goalOf(voc).education!.stages.find((s) => s.stage === "vocational")).toMatchObject({ living: "away", delayYears: 1, annualOverride: 1200000 });
    const back = fieldOf(none, `edu/${g.id}/higher`).set(none, "university");
    expect(goalOf(back).education!.stages.find((s) => s.stage === "university")).toMatchObject({ sector: "private", field: "humanities", living: "home" });
  });

  it("該当なし（この子の教育費を入れない）のときは「大学など」の行を出さない", () => {
    const wh = fresh();
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    const na = actions(wh).find((a) => a.key === `edu/${child.id}/none`)!.run(wh);
    expect(rowAt(na.request.input as never, educationStagesAddress(goalOf(na).id))?.state).toBe("notApplicable");
    expect(groups(na).some((x) => x.key.endsWith("/higherNone"))).toBe(false);
    expect(fields(na).some((f) => f.key.endsWith("/higher"))).toBe(false);
  });

  it("推定のままの進路の印と「この値にする」は「大学・短大・専門学校」の欄に出す（子ごとに1つ）", () => {
    const wh = fresh();
    const f = fieldOf(wh, `edu/${goalOf(wh).id}/higher`);
    expect(f.address?.(wh)).toEqual(educationStagesAddress(goalOf(wh).id));
    expect(rowAt(wh.request.input as never, educationStagesAddress(goalOf(wh).id))).toMatchObject({ state: "estimated", estimate: { basis: EDUCATION_BASIS } });
  });
});

describe("児童手当・就学支援金は詳細だけ", () => {
  it("標準では「▸」を開いても出ない（頭のまとまりの単位に入らない）。詳細では進路の枠の中に出る", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    const sec = stage(wh).sections.find((s) => s.key === `edu/${child.id}`)!;
    const b = sec.groups.find((x) => x.key === `edu/${child.id}/benefits`)!;
    expect(b).toMatchObject({ level: "detail", partOf: `edu/${g.id}` });
    expect(b.fields.map((f) => f.label)).toEqual(["児童手当を計算する", "高校の就学支援金"]);
    expect(groupUnits(sec.groups).has(b.key)).toBe(false);
    const head = sec.groups.find((x) => x.key === `edu/${g.id}`)!;
    expect(head.fields.map((f) => f.label)).toEqual(["学校外の費用（塾・習い事など）"]);
    expect(head.moreLabel).toBe("奨学金・教育ローン・子への援助などを入れる");
    expect(panel(wh, "simple")).not.toContain("児童手当を計算する");
    expect(panel(wh, "detail")).toContain("児童手当を計算する");
    // 計算は今のまま（児童手当は既定で計算する。就学支援金は制度どおり）
    expect(b.fields[0]!.get(wh).value).toBe(true);
    expect(b.fields[1]!.get(wh).value).toBe("");
  });
});

describe("学校外の費用の4つの選び方", () => {
  it("学校ごとに入れる: 幼稚園〜高校は統計の平均（推定）から、大学は空欄（0円）。大学に入れた月額は計算に入る", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const custom = fieldOf(wh, `edu/${g.id}/outUniform`).set(wh, "custom");
    expect(outOfSchoolChoiceOf(goalOf(custom))).toBe("custom");
    const uni = stageIndex(custom, "university");
    const before = eduSum(custom.request, "cf.expense.education.outOfSchool");
    const withUni = fieldOf(custom, `edu/${g.id}/stage/${uni}/outOfSchool`).set(custom, 10000);
    expect(goalOf(withUni).education!.stages[uni]!.outOfSchool).toEqual({ monthly: 10000 });
    expect(eduSum(withUni.request, "cf.expense.education.outOfSchool") - before).toBeGreaterThanOrEqual(10000 * 48);
    // 見出しの額にも入る
    const c = withUni.request.input.household.members.find((m) => m.kind === "child")!;
    const st = goalOf(withUni).education!.stages[uni]!;
    expect(stageRemainingCost(c, st, BASE, "")!.total - stageRemainingCost(c, { ...st, outOfSchool: undefined } as never, BASE, "")!.total).toBe(480000);
    // すべて統計の平均に戻すと、大学の額も外す
    const stat = fieldOf(withUni, `edu/${g.id}/outUniform`).set(withUni, "statistics");
    expect(goalOf(stat).education!.stages[uni]!.outOfSchool).toBeUndefined();
  });

  it("幼稚園〜高校が無い子（大学だけ）でも、学校ごとに入れるを選んだことが残る", () => {
    const wh = fresh("2007-06");
    const g = goalOf(wh);
    expect(goalOf(wh).education!.stages.map((s) => s.stage)).toEqual(["university"]);
    const custom = fieldOf(wh, `edu/${g.id}/outUniform`).set(wh, "custom");
    expect(fieldOf(custom, `edu/${g.id}/outUniform`).get(custom).value).toBe("custom");
    const none = fieldOf(wh, `edu/${g.id}/outUniform`).set(wh, "none");
    expect(fieldOf(none, `edu/${g.id}/outUniform`).get(none).value).toBe("none");
  });

  it("前の世帯: 入れ方の無い行のある世帯は前の形、幼稚園〜高校に額を入れた世帯は学校ごとに入れる、で読む（書き換えない）", () => {
    const legacy = fromRequest(modelHousehold("educationTwoKids"));
    const g = (legacy.request.input.household.goals ?? []).find((x) => (x.education?.lessons ?? []).length > 0)!;
    expect(fieldOf(legacy, `edu/${g.id}/outUniform`).get(legacy).value).toBe("legacy");
    // 前の形でも、塾・習い事の行は標準で入れられる
    expect(fields(legacy).filter((f) => f.key.startsWith(`edu/${g.id}/lesson/0/`)).every((f) => f.level === "simple")).toBe(true);
    const wh = fresh();
    const gg = goalOf(wh);
    const typed = mutate(wh, (hh) => void ((hh.goals ?? []).find((x) => x.id === gg.id)!.education!.stages[0]!.outOfSchool = { monthly: 30000 }));
    const before = JSON.stringify(typed.request);
    expect(fieldOf(typed, `edu/${gg.id}/outUniform`).get(typed).value).toBe("custom");
    expect(JSON.stringify(typed.request)).toBe(before);
    // 前に「入れない」にした世帯（大学は省略のまま）は「すべて入れない」
    const none = mutate(wh, (hh) => {
      for (const s of (hh.goals ?? []).find((x) => x.id === gg.id)!.education!.stages) if (s.stage !== "university") s.outOfSchool = "none";
    });
    expect(fieldOf(none, `edu/${gg.id}/outUniform`).get(none).value).toBe("none");
  });

  it("言葉に「段階」を使わない", () => {
    const wh = fresh();
    const f = fieldOf(wh, `edu/${goalOf(wh).id}/outUniform`);
    expect(`${f.help}${f.sideEffects}${f.kind === "select" ? f.options.map((o) => o.label).join("") : ""}`).not.toContain("段階");
  });
});

describe("保育園・幼稚園（3歳から）の言葉", () => {
  it("「園の外の費用（習い事など・月額）」「通う年数」。ほかの学校は「学校外の費用（月額）」「在学年数」", () => {
    const wh = fresh("2023-06");
    const g = goalOf(wh);
    const k = stageIndex(wh, "kindergarten");
    const e = stageIndex(wh, "elementary");
    expect(fieldOf(wh, `edu/${g.id}/stage/${k}/outOfSchool`).label).toBe("園の外の費用（習い事など・月額）");
    expect(fieldOf(wh, `edu/${g.id}/stage/${k}/years`).label).toBe("通う年数");
    expect(fieldOf(wh, `edu/${g.id}/stage/${e}/outOfSchool`).label).toBe("学校外の費用（月額）");
    expect(fieldOf(wh, `edu/${g.id}/stage/${e}/years`).label).toBe("在学年数");
    expect(groups(wh).find((x) => x.key === `edu/${g.id}/stage/${k}`)!.note).toContain("園の外 年約");
  });
});

describe("段の見出しの額は、計算の基準の月から月で数える（今の値段）", () => {
  it("入学している段は「残り○年（○年○月まで）」、まだの段は「○年」。額は計算エンジンが払う月と同じ（教育費の上昇率を0にして比較）", () => {
    const wh = fresh();
    const c = wh.request.input.household.members.find((m) => m.kind === "child")!;
    const g = goalOf(wh);
    const el = goalOf(wh).education!.stages[stageIndex(wh, "elementary")]!;
    const cost = stageRemainingCost(c, el, BASE, "")!;
    expect(stageCostLine(cost)).toMatch(/^残り2年半（2029年3月まで）で約[\d,.]+万円（今の値段）$/);
    const jh = goalOf(wh).education!.stages[stageIndex(wh, "juniorHigh")]!;
    expect(stageCostLine(stageRemainingCost(c, jh, BASE, "")!)).toMatch(/^3年で約[\d,.]+万円（今の値段）$/);
    expect([periodText(54), periodText(36), periodText(5), periodText(14)]).toEqual(["4年半", "3年", "5か月", "1年2か月"]);
    // 教育費の上昇率を0（今の値段のまま）にすると、子の段の額の合計は、計算エンジンが払う教育費（学校の費用・学校外活動費・学費・入学金）の合計と同じ
    const flat = structuredClone(wh);
    flat.request.input.assumptions = { ...flat.request.input.assumptions, educationInflation: { default: "0" } } as never;
    const engine = preview(flat.request).table.filter((x) => x.row.startsWith("cf.expense.education.") && x.row !== "cf.expense.education.nursery").reduce((s, x) => s + x.amount, 0);
    const shown = g.education!.stages.reduce((s, st) => s + (stageRemainingCost(c, st, BASE, "")?.total ?? 0), 0);
    expect(Math.abs(shown - engine) / engine).toBeLessThan(0.002);
  });
});

describe("保育園（2歳まで）の既定と詳細の欄", () => {
  /** 本人・配偶者とこれから生まれる子。working は働いている人 */
  function expecting(working: ("self" | "spouse")[]): WorkingHousehold {
    const id = seq();
    let wh = blankHousehold(BASE, id);
    wh = mutate(wh, (hh) => void (hh.members[0]!.birth.birthYearMonth = "1994-06"));
    wh = withRefreshedEstimates(addMember(wh, "spouse", id));
    wh = mutate(wh, (hh) => {
      hh.employmentPeriods = hh.members
        .filter((m) => (working as string[]).includes(m.kind))
        .map((m, i) => ({ id: `00000000-0000-4000-9000-00000000000${i}`, member: m.id, from: { at: "2016-04" }, to: null, type: "regular" }) as never);
    });
    return withRefreshedEstimates(addChildWithEducation(wh, id, true));
  }

  it("共働きの世帯でこれから生まれる子は、保育園に通う（推定）。片働きは通わない", () => {
    const dual = expecting(["self", "spouse"]);
    expect(goalOf(dual).education!.stages[0]!.stage).toBe("nursery");
    const child = dual.request.input.household.members.find((m) => m.kind === "child")!;
    expect(nurseryByDefault(dual.request.input.household, child, BASE)).toBe(true);
    const toggle = fieldOf(dual, `edu/${goalOf(dual).id}/nursery`);
    expect(toggle.get(dual)).toMatchObject({ value: true, hint: expect.stringContaining("共働き") });
    const single = expecting(["self"]);
    expect(goalOf(single).education!.stages.some((s) => s.stage === "nursery")).toBe(false);
    // FP が「通わない」にした進路は、推定の入れ直しで戻さない
    const off = withRefreshedEstimates(toggle.set(dual, false));
    expect(goalOf(off).education!.stages.some((s) => s.stage === "nursery")).toBe(false);
    expect(rowAt(off.request.input as never, educationStagesAddress(goalOf(off).id))).toBeUndefined();
  });

  it("働くひとり親の世帯も通う（推定）", () => {
    const id = seq();
    let wh = blankHousehold(BASE, id);
    wh = mutate(wh, (hh) => {
      hh.members[0]!.birth.birthYearMonth = "1994-06";
      hh.employmentPeriods = [{ id: "00000000-0000-4000-9000-000000000001", member: hh.members[0]!.id, from: { at: "2016-04" }, to: null, type: "regular" } as never];
    });
    wh = withRefreshedEstimates(addChildWithEducation(wh, id, true));
    expect(goalOf(wh).education!.stages[0]!.stage).toBe("nursery");
  });

  it("詳細: 通い始める時期の決め方・施設の種類・自治体の独自の無償化・延長保育。認可外は月額を標準に出し、入れるまで0円", () => {
    let wh = fresh("2026-06");
    const g = goalOf(wh);
    wh = fieldOf(wh, `edu/${g.id}/nursery`).set(wh, true);
    const n = stageIndex(wh, "nursery");
    const labels = groups(wh).find((x) => x.key === `edu/${g.id}/stage/${n}`)!.fields.map((f) => [f.label, f.level]);
    expect(labels).toEqual(
      expect.arrayContaining([
        ["通い始める時期", "simple"],
        ["通い始める時期の決め方", "detail"],
        ["施設の種類", "detail"],
        ["保育料（月額）", "detail"],
        ["自治体の独自の無償化", "detail"],
        ["延長保育（月額）", "detail"],
      ]),
    );
    // 入力例は推定の通い始めの年月（決まった例「2041-06」にしない）。学校の行は欄が少なくても見出しを幅いっぱいに
    const from = fieldOf(wh, `edu/${g.id}/stage/${n}/from`);
    expect(from.example).toMatch(/^例: 20\d\d-04$/);
    expect(from.example).not.toBe("例: 2041-06");
    expect(groups(wh).filter((x) => /\/stage\/\d+$/.test(x.key)).every((x) => x.wideHead === true)).toBe(true);
    const age0 = fieldOf(wh, `edu/${g.id}/stage/${n}/startKind`).set(wh, "age0");
    const child = age0.request.input.household.members.find((m) => m.kind === "child")!;
    expect(goalOf(age0).education!.stages[n]!.from).toEqual({ memberAge: { member: child.id, years: 0, ageSwitch: "schoolYear" } });
    expect(fieldOf(age0, `edu/${g.id}/stage/${n}/startKind`).get(age0).value).toBe("age0");
    const un = fieldOf(wh, `edu/${g.id}/stage/${n}/facility`).set(wh, "unlicensed");
    expect(fieldOf(un, `edu/${g.id}/stage/${n}/monthly`).level).toBe("simple");
    expect(groups(un).find((x) => x.key === `edu/${g.id}/stage/${n}`)!.note).toContain("認可外");
    expect(eduSum(un.request, "cf.expense.education.nursery")).toBe(0);
    const free = fieldOf(wh, `edu/${g.id}/stage/${n}/localFree`).set(wh, "first");
    expect(eduSum(free.request, "cf.expense.education.nursery")).toBe(0);
    const ext = fieldOf(free, `edu/${g.id}/stage/${n}/extended`).set(free, 5000);
    expect(eduSum(ext.request, "cf.expense.education.nursery")).toBeGreaterThan(0);
  });
});

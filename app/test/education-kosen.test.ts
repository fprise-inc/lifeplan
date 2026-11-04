// 高専・専門職大学院（0090）・留学は「探して開く」で子ども・教育のその子の留学へ（前の「＋ 項目を追加」の留学。0045 の 2026-11-04 の追記）
import { describe, expect, it } from "vitest";
import type { Goal } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { KOSEN_MISSING, stageStatistic } from "../src/workspace/input/educationCost.ts";
import { schoolEndAge } from "../src/workspace/input/fill.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { findEntries, findInInput } from "../src/workspace/input/inputSearch.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { preview } from "./helpers.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const stage = (wh: WorkingHousehold) => buildStage("education", wh);
const fields = (wh: WorkingHousehold) => allFields(stage(wh));
const fieldOf = (wh: WorkingHousehold, suffix: string): FieldDef => {
  const f = fields(wh).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const goalOf = (wh: WorkingHousehold): Goal => (wh.request.input.household.goals ?? []).find((g) => g.kind === "education")!;
const actions = (wh: WorkingHousehold) => stage(wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);

function fresh(): WorkingHousehold {
  const id = seq();
  let wh = blankHousehold("2026-10", id);
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1986-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse", id));
  wh = withRefreshedEstimates(addChildWithEducation(wh, id));
  return withRefreshedEstimates(mutate(wh, (h) => void (h.members.find((m) => m.kind === "child")!.birth.birthYearMonth = "2016-05")));
}

describe("高専", () => {
  it("高校の段の「高校・高専」で高専（国立・5年）にでき、学費は国立高専機構の額。大学（編入）は高専を出た後から、独立もその後", () => {
    let wh = fresh();
    const g = goalOf(wh);
    const hs = g.education!.stages.findIndex((s) => s.stage === "highSchool");
    wh = fieldOf(wh, `/stage/${hs}/highKind`).set(wh, "kosen");
    const k = goalOf(wh).education!.stages[hs]!;
    expect(k).toMatchObject({ stage: "kosen", sector: "national" });
    expect(stageStatistic(k)).toMatchObject({ annual: 234600, entrance: 84600 });
    expect(fieldOf(wh, `/stage/${hs}/years`).get(wh).value).toBe(5);
    // 高校の段は足すボタンに出さない（高校か高専のどちらか）
    expect(actions(wh).some((a) => a.key.endsWith("/addStage/highSchool"))).toBe(false);
    // 大学4年は高専（15〜20歳）の後: 独立は24歳。編入で2年にすると22歳
    expect(schoolEndAge(wh.request.input.household, goalOf(wh).owner!)).toBe(24);
    const u = goalOf(wh).education!.stages.findIndex((s) => s.stage === "university");
    wh = fieldOf(wh, `/stage/${u}/years`).set(wh, 2);
    expect(schoolEndAge(wh.request.input.household, goalOf(wh).owner!)).toBe(22);
    const r = preview(wh.request);
    expect(r.table.filter((c) => c.row === "cf.expense.education.school" && c.year === 2033).reduce((a, c) => a + c.amount, 0)).toBeGreaterThan(0);
    // 私立の高専は学費を入れるまで未入力
    wh = fieldOf(wh, `/stage/${hs}/sector`).set(wh, "private");
    expect(fieldOf(wh, `/stage/${hs}/annual`).get(wh).estimated).toBe(KOSEN_MISSING);
  });
});

describe("専門職大学院", () => {
  it("大学がある進路に「＋ 専門職大学院」。種類で法科大学院（3年・私立の法科大学院の平均）にできる", () => {
    let wh = fresh();
    wh = actions(wh).find((a) => a.label === "＋ 専門職大学院")!.run(wh);
    const i = goalOf(wh).education!.stages.findIndex((s) => s.stage === "graduateProfessional");
    expect(fieldOf(wh, `/stage/${i}/years`).get(wh).value).toBe(2);
    wh = fieldOf(wh, `/stage/${i}/field`).set(wh, "law");
    const st = goalOf(wh).education!.stages[i]!;
    expect(stageStatistic(st)).toMatchObject({ annual: 1194241 + 134172, entrance: 203311 });
    expect(fieldOf(wh, `/stage/${i}/years`).get(wh).value).toBe(3);
    expect(schoolEndAge(wh.request.input.household, goalOf(wh).owner!)).toBe(25);
  });
});

describe("留学は「探して開く」で子ども・教育へ", () => {
  it("「留学」で探すと、子ども・教育のその子の「＋ 留学」へ案内する（足すのはそのボタン。1回ずつの留学を足し、ほかの行は変えない）", () => {
    const wh = fresh();
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    const hit = findInInput(findEntries(wh, inputItems(wh)), "留学")[0]!;
    expect(hit).toMatchObject({ card: "education", label: "＋ 留学", target: { kind: "action", key: `edu/${child.id}/money/out/abroad` } });
    const add = actions(wh).find((a) => a.key === hit.target.key)!;
    const w = add.run(wh);
    expect(goalOf(w).education!.abroad?.length).toBe(1);
    expect(w.request.input.household.periodicExpenses ?? []).toEqual(wh.request.input.household.periodicExpenses ?? []);
  });
});

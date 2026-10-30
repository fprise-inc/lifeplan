// 大学院（修士・博士。国立・公立・私立）とインターナショナルスクール（0089）
import { describe, expect, it } from "vitest";
import type { Goal } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { schoolEndAge } from "../src/workspace/input/fill.ts";
import { INTERNATIONAL_MISSING, stageStatistic } from "../src/workspace/input/educationCost.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
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

describe("大学院", () => {
  it("大学がある進路に「＋ 大学院（修士）」「＋ 大学院（博士）」。足すと大学の公立・私立を引き継ぎ、学費は統計の平均の推定、独立は修了の後", () => {
    let wh = fresh();
    expect(actions(wh).map((a) => a.label)).toEqual(expect.arrayContaining(["＋ 大学院（修士）", "＋ 大学院（博士）"]));
    // 画面は保存のときに変わった物の推定の印を外してから推定を入れ直す（InputPanel の dropStaleRows）。ここでは段を足しただけで比べる
    wh = actions(wh).find((a) => a.label === "＋ 大学院（修士）")!.run(wh);
    const st = goalOf(wh).education!.stages.find((s) => s.stage === "graduateMaster")!;
    expect(st).toMatchObject({ sector: "private", living: "home" });
    const stat = stageStatistic(st)!;
    expect(stat.annual).toBe(811006 + 70721);
    expect(stat.entrance).toBe(208987);
    const i = goalOf(wh).education!.stages.indexOf(st);
    expect(fieldOf(wh, `/stage/${i}/annual`).get(wh).estimated).toBe("統計の平均。授業料と施設設備費を足したもの（私立大学の大学院・修士・令和7年度入学者）");
    expect(fieldOf(wh, `/stage/${i}/years`).get(wh).value).toBe(2);
    // 大学4年（22歳）の後に修士2年: 独立は24歳の後の4月
    expect(schoolEndAge(wh.request.input.household, goalOf(wh).owner!)).toBe(24);
    wh = fieldOf(wh, `/stage/${i}/sector`).set(wh, "national");
    expect(stageStatistic(goalOf(wh).education!.stages[i]!)).toMatchObject({ annual: 535800, entrance: 282000 });
    const r = preview(wh.request);
    expect(r.table.filter((c) => c.row === "cf.expense.education.school" && c.year === 2039).reduce((a, c) => a + c.amount, 0)).toBeGreaterThan(0);
  });
});

describe("インターナショナルスクール", () => {
  it("幼稚園〜高校の公立・私立で選べ、学費は未入力の警告（統計の目安なし）。年額は簡易に出す", () => {
    let wh = fresh();
    const hs = goalOf(wh).education!.stages.findIndex((s) => s.stage === "highSchool");
    const sector = fieldOf(wh, `/stage/${hs}/sector`);
    expect(sector.kind === "select" ? sector.options.map((o) => o.value) : []).toContain("international");
    wh = sector.set(wh, "international");
    const annual = fieldOf(wh, `/stage/${hs}/annual`);
    expect(annual.level).toBe("simple");
    expect(annual.get(wh).estimated).toBe(INTERNATIONAL_MISSING);
    const note = stage(wh).sections.flatMap((s) => s.groups).find((g) => g.key.endsWith(`/stage/${hs}`))?.note ?? "";
    expect(note).toContain("⚠ 学費が未入力です");
    expect(note).toContain("就学支援金は計算しません");
    // 年額を入れると、就学支援金は計算しない
    wh = annual.set(wh, 2400000);
    const r = preview(wh.request);
    // 高校（2032年4月〜2035年3月）の年に就学支援金が入らない（大学の修学支援は別の年）
    expect(r.table.filter((c) => c.row === "cf.income.benefit.education" && c.year === 2033).reduce((a, c) => a + c.amount, 0)).toBe(0);
  });
});

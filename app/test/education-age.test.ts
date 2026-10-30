// 子の年齢（生年月）を直したとき、進路の段が新しい年齢に合うこと（推定のままの進路は入れ直し、FP が直した進路は終わった段を外し前の年齢で
// 終わっていた段を足す。0062 の追記 2026-10-30）
import { describe, expect, it } from "vitest";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { educationStagesAddress } from "../src/workspace/input/fill.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { rowAt } from "../src/workspace/input/rows.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const fieldOf = (wh: WorkingHousehold, stage: "family" | "education", suffix: string): FieldDef => {
  const f = allFields(buildStage(stage, wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const goal = (wh: WorkingHousehold) => (wh.request.input.household.goals ?? []).find((g) => g.kind === "education")!;
const childId = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "child")!.id;
const stages = (wh: WorkingHousehold) => goal(wh).education!.stages.map((s) => `${s.stage}:${s.sector ?? "-"}`);
const setBirth = (wh: WorkingHousehold, ym: string) => withRefreshedEstimates(fieldOf(wh, "family", `family/${childId(wh)}/birth`).set(wh, ym));

function fresh(): WorkingHousehold {
  const id = seq();
  let wh = blankHousehold("2026-10", id);
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1986-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse", id));
  return withRefreshedEstimates(addChildWithEducation(wh, id));
}

describe("子の年齢を直すと、学校の段が年齢に合わせて変わる", () => {
  it("推定のままの進路は、新しい年齢の標準の進路に入れ直す", () => {
    let wh = setBirth(fresh(), "2025-05");
    expect(stages(wh)).toEqual(["kindergarten:public", "elementary:public", "juniorHigh:public", "highSchool:public", "university:private"]);
    wh = setBirth(wh, "2010-05");
    expect(stages(wh)).toEqual(["highSchool:public", "university:private"]);
  });

  it("進路の型を選んだ（推定でなくなった）進路でも、年下にすると前に足りない段を型の値で足し、年上にすると終わった段を外す", () => {
    let wh = setBirth(fresh(), "2016-05");
    wh = withRefreshedEstimates(fieldOf(wh, "education", "/preset").set(wh, "allPrivate"));
    expect(rowAt(wh.request.input as never, educationStagesAddress(goal(wh).id))).toBeUndefined();
    expect(stages(wh)).toEqual(["elementary:private", "juniorHigh:private", "highSchool:private", "university:private"]);
    wh = setBirth(wh, "2024-05");
    expect(stages(wh)).toEqual(["kindergarten:private", "elementary:private", "juniorHigh:private", "highSchool:private", "university:private"]);
    wh = setBirth(wh, "2009-05");
    expect(stages(wh)).toEqual(["highSchool:private", "university:private"]);
  });

  it("FP が自分で外した段（前の年齢でもこれからだった段）は足さない。3歳の4月を過ぎた保育園は外す", () => {
    let wh = setBirth(fresh(), "2025-05");
    const g = goal(wh);
    wh = withRefreshedEstimates(fieldOf(wh, "education", `edu/${g.id}/nursery`).set(wh, true));
    wh = withRefreshedEstimates(mutate(wh, (h) => {
      const e = (h.goals ?? []).find((x) => x.id === g.id)!.education!;
      e.stages = e.stages.filter((s) => s.stage !== "kindergarten");
    }));
    expect(stages(wh)[0]).toBe("nursery:-");
    wh = setBirth(wh, "2022-05");
    expect(stages(wh)).toEqual(["elementary:public", "juniorHigh:public", "highSchool:public", "university:private"]);
  });
});

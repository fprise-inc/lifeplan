// 留学（0088）: 「＋ 留学」で1回ずつ足す・何年生のとき・留学の形（延びる／延びない／短期）と推定の額・表の行は教育費で決め打ち・払う人と伸び率の欄は無い・
// 万一のときの扱いは続ける／やめるの2択・同じ項目の中に置く・休学の年で独立もずれる
import { describe, expect, it } from "vitest";
import type { Goal } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { rowAt } from "../src/workspace/input/rows.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { abroadEstimate } from "../src/workspace/input/stages/education.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
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
const addOne = (wh: WorkingHousehold) => withRefreshedEstimates(actions(wh).find((a) => a.key.endsWith("/out/abroad"))!.run(wh));

describe("留学", () => {
  it("「＋ 留学」で1回ずつ足し、押すたびに増える。大学3年・単位が認められる1年・推定の額で入る", () => {
    let wh = addOne(fresh());
    wh = addOne(wh);
    const a = goalOf(wh).education!.abroad!;
    expect(a.length).toBe(2);
    expect(a[0]).toMatchObject({ stage: "university", grade: 3, kind: "credit", amount: abroadEstimate("university", "credit").value });
    // 大学などの1年は文部科学省の委託調査のひと月あたりの費用（0088 の追記 2026-10-31）
    expect(abroadEstimate("university", "credit").value).toBe(170000 * 12);
    expect(abroadEstimate("university", "leave").value).toBe(240000 * 12);
    expect(abroadEstimate("highSchool", "credit").value).toBe(160000 * 12 + 350000);
    expect(abroadEstimate("highSchool", "short").value).toBe(160000 + 350000);
    const amount = fieldOf(wh, `/abroad/${a[0]!.id}/amount`);
    expect(fieldStatus(amount, wh).status).toBe("estimated");
  });

  it("同じ項目の中に、学校・何年生・留学の形・1回の額・万一のときの扱い（続ける／やめる）。払う人・伸び方・表の行・該当する万一は出さない", () => {
    const wh = addOne(fresh());
    const id = goalOf(wh).education!.abroad![0]!.id!;
    const group = stage(wh).sections.flatMap((s) => s.groups).find((g) => g.key.endsWith(`/abroad/${id}`))!;
    expect(group.fields.map((f) => f.label)).toEqual(["学校", "何年生のとき", "留学の形", "1回の額", "万一のときの扱い"]);
    const on = fieldOf(wh, `/abroad/${id}/on`);
    expect(on.kind === "select" ? on.options.map((o) => o.label) : []).toEqual(["続ける", "やめる"]);
    expect(fields(wh).some((f) => f.key.includes(`/abroad/${id}/`) && /払う人|伸び|行|該当する万一/.test(f.label))).toBe(false);
  });

  it("留学の形を休学（延びる）にすると、推定の額が入れ直り、卒業と独立が1年うしろ。入れた額は変えない", () => {
    let wh = addOne(fresh());
    const id = goalOf(wh).education!.abroad![0]!.id!;
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    expect(child.leaves?.memberAge?.years).toBe(22);
    wh = withRefreshedEstimates(fieldOf(wh, `/abroad/${id}/kind`).set(wh, "leave"));
    expect(goalOf(wh).education!.abroad![0]!.amount).toBe(abroadEstimate("university", "leave").value);
    expect(wh.request.input.household.members.find((m) => m.kind === "child")!.leaves?.memberAge?.years).toBe(23);
    const r = preview(wh.request);
    expect(r.table.filter((c) => c.row === "cf.expense.education" && c.object === goalOf(wh).id).reduce((s, c) => s + c.amount, 0)).toBeGreaterThan(0);
    // 入れた額は留学の形を変えても変えない
    wh = fieldOf(wh, `/abroad/${id}/amount`).set(wh, 3000000);
    expect(rowAt(wh.request.input as never, { target: { object: goalOf(wh).id }, item: "goal.education", at: ["abroad", id, "amount"] })?.state).not.toBe("estimated");
    wh = fieldOf(wh, `/abroad/${id}/kind`).set(wh, "short");
    expect(goalOf(wh).education!.abroad![0]!.amount).toBe(3000000);
  });
});

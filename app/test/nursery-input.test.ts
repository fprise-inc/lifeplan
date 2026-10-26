// 子ども・教育の入力: 保育園に通う（はい／いいえ）・通い始めの既定・給食費の欄（0029）
import { describe, expect, it } from "vitest";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { nurseryDefaultStart, nurseryFreeMonth } from "../src/workspace/input/stages/education.ts";
import { modelHousehold } from "./helpers.ts";

const fieldOf = (wh: WorkingHousehold, suffix: string): FieldDef => {
  const f = allFields(buildStage("education", wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(suffix);
  return f;
};
const nurseryStages = (wh: WorkingHousehold) => (wh.request.input.household.goals ?? []).flatMap((g) => g.education?.stages ?? []).filter((s) => s.stage === "nursery");

describe("保育園の入力（簡易）", () => {
  it("保育園に通う: いいえで保育所の段を外し、はいで月額なし（収入から自動で計算）の段を足す", () => {
    let wh = fromRequest(modelHousehold("lifetime100Plan"));
    const toggle = fieldOf(wh, "/nursery");
    expect(toggle.level).toBe("simple");
    expect(toggle.get(wh).value).toBe(true);
    wh = toggle.set(wh, false);
    expect(nurseryStages(wh)).toEqual([]);
    wh = fieldOf(wh, "/nursery").set(wh, true);
    // 新しく足す段は要素の ID を持つ（0035 の5）
    expect(nurseryStages(wh)).toEqual([{ id: expect.any(String), stage: "nursery" }]);
  });

  it("通い始めの既定は、その子の育児休業の終わりの翌月（無ければ1歳の学年の4月）", () => {
    const leave = fromRequest(modelHousehold("parentalLeave")).request.input.household;
    const child = leave.members.find((m) => m.kind === "child")!;
    expect(nurseryDefaultStart(leave, child)).toEqual({ ym: "2028-05", reason: "育児休業の終わりの翌月" });
    const plan = fromRequest(modelHousehold("lifetime100Plan")).request.input.household;
    const c2 = plan.members.find((m) => m.kind === "child")!;
    expect(nurseryDefaultStart(plan, c2)).toEqual({ ym: "2028-04", reason: "1歳の4月" });
    expect(nurseryFreeMonth(c2)).toBe("2030-04");
  });

  it("給食費の欄（詳細）: 省略は制度どおり、なし・ありを選べる", () => {
    let wh = fromRequest(modelHousehold("lifetime100Plan"));
    const lunch = fieldOf(wh, "/lunch");
    expect(lunch.level).toBe("detail");
    wh = lunch.set(wh, "free");
    expect((wh.request.input.household.goals ?? [])[0]?.education?.schoolLunch).toBe("free");
    wh = fieldOf(wh, "/lunch").set(wh, "");
    expect((wh.request.input.household.goals ?? [])[0]?.education?.schoolLunch).toBeUndefined();
  });
});

// 子ども・教育の入力: 保育園に通う（はい／いいえ）・通い始めの既定・給食費の欄（0029）
import { describe, expect, it } from "vitest";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
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

  it("給食費の欄（詳細）: 公立の小学校・中学校の段ごとに出し、省略は制度どおり。前に目標に入れた選び方は段に写してから直す（0062 の追記 2026-10-30）", () => {
    let wh = fromRequest(modelHousehold("lifetime100Plan"));
    const g = () => (wh.request.input.household.goals ?? []).find((x) => x.kind === "education")!;
    const lunches = () => allFields(buildStage("education", wh)).filter((f) => f.key.endsWith("/lunch"));
    expect(lunches().length).toBeGreaterThan(0);
    const lunch = lunches()[0]!;
    expect(lunch.level).toBe("detail");
    expect(lunch.get(wh)).toMatchObject({ value: "", implicit: true });
    wh = lunch.set(wh, "free");
    const i = Number(/\/stage\/(\d+)\/lunch$/.exec(lunch.key)![1]);
    expect(g().education!.stages[i]!.schoolLunch).toBe("free");
    wh = lunches()[0]!.set(wh, "");
    expect(g().education!.stages[i]!.schoolLunch).toBeUndefined();
    // 前の版で目標に入れた選び方（自治体の無償化）は、段の欄で見え、段を直すと残りの段に写して目標からは外す
    wh = mutate(wh, (h) => void ((h.goals ?? []).find((x) => x.kind === "education")!.education!.schoolLunch = "free"));
    expect(lunches().every((f) => f.get(wh).value === "free")).toBe(true);
    wh = lunches()[0]!.set(wh, "");
    expect(g().education!.schoolLunch).toBeUndefined();
    expect(lunches()[0]!.get(wh).value).toBe("");
    if (lunches().length > 1) expect(lunches()[1]!.get(wh).value).toBe("free");
  });
});

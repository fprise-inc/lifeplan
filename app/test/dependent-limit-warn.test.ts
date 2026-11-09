// 期間に健康保険を「扶養」と書いた人の給与が扶養の基準を超えるときの知らせ（0174 の追記）: 計算は扶養のまま（入力を書き換えない）、
// 健康保険の欄の下と確かめの一覧に出す
import { describe, expect, it } from "vitest";
import type { EmploymentPeriod } from "../src/engine/types.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { declaredDependentOverLimit } from "../src/workspace/input/dependentLimit.ts";
import { modelHousehold } from "./helpers.ts";

const open = (m: string): WorkingHousehold => fromRequest(modelHousehold(m), {});
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(buildStage("work", wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const spouseParts = (wh: WorkingHousehold): EmploymentPeriod[] => {
  const sp = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
  return (wh.request.input.household.employmentPeriods ?? []).filter((p) => p.member === sp.id && p.healthInsurance?.kind === "dependent");
};
const warnOf = (wh: WorkingHousehold, p: EmploymentPeriod) => fieldOf(wh, `work/period/${p.id}/hi`).get(wh).warn ?? null;
const listed = (wh: WorkingHousehold, p: EmploymentPeriod) => checkList(wh).some((r) => r.fieldKey === `work/period/${p.id}/hi` && r.kind === "notice");

describe("扶養と書いた期間の給与が扶養の基準を超えるときの知らせ", () => {
  it("年120万円のパート（賃金上昇率1%）は、2035年に130万円を超えると知らせる（欄の下と確かめの一覧）。健康保険の種類は書き換えない", () => {
    const wh = open("educationTwoKids");
    const p = spouseParts(wh)[0]!;
    const sp = wh.request.input.household.members.find((m) => m.id === p.member)!;
    expect(declaredDependentOverLimit(wh, sp, p)).toMatchObject({ year: 2035, limit: 1300000 });
    expect(warnOf(wh, p)).toBe(
      "2035年に、賃金の伸びで収入が健康保険の扶養の基準（年130万円未満）を超えます（この期間の給与 年131.2万円）。扶養（配偶者が厚生年金に入っていれば国民年金の第3号）のまま計算しています。扶養から外れるなら、健康保険の欄を国民健康保険などにしてください",
    );
    expect(listed(wh, p)).toBe(true);
    expect(p.healthInsurance?.kind).toBe("dependent");
  });

  it("今の給与が基準以上なら、年を言わずに知らせる", () => {
    const wh0 = open("educationTwoKids");
    const id = spouseParts(wh0)[0]!.id;
    const wh = mutate(wh0, (h) => {
      const p = (h.employmentPeriods ?? []).find((x) => x.id === id)!;
      (p.salary!.annual as { value: number }).value = 1400000;
    });
    expect(warnOf(wh, spouseParts(wh)[0]!)).toMatch(/^収入が健康保険の扶養の基準（年130万円未満）を超えます（この期間の給与 年140万円）/);
  });

  it("期間の終わりまで基準の未満なら知らせない（年100万円・2043年まで）", () => {
    const wh = open("salariedCoupleTwoKids");
    const p = spouseParts(wh)[0]!;
    expect(warnOf(wh, p)).toBeNull();
    expect(listed(wh, p)).toBe(false);
  });

  it("扶養と書いていない期間には知らせない", () => {
    const wh0 = open("educationTwoKids");
    const id = spouseParts(wh0)[0]!.id;
    const wh = mutate(wh0, (h) => {
      const p = (h.employmentPeriods ?? []).find((x) => x.id === id)!;
      p.healthInsurance = { kind: "national" };
    });
    const p = (wh.request.input.household.employmentPeriods ?? []).find((x) => x.id === id)!;
    expect(warnOf(wh, p)).toBeNull();
  });
});

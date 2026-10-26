// 推定の目安（入力の画面）: 数と純粋な計算はヒアリングシートと同じ hearing/src/estimates.ts。世帯に当てる部分と入れ直しを確かめる
import { describe, expect, it } from "vitest";
import type { EmploymentPeriod } from "../src/engine/types.ts";
import { blankHousehold, estimatedBox } from "../src/workspace/input/household.ts";
import { refreshEstimates, salaryEstimate, smrEstimate } from "../src/workspace/input/estimates.ts";
import { convertPeriod } from "../src/workspace/input/stages/work.ts";
import { salaryEstimate as hearingSalary } from "../../hearing/src/estimates.ts";

const BASE = "2026-10";

describe("推定の目安（入力の画面）", () => {
  it("入力の画面とヒアリングシートは同じ目安を使う", () => {
    expect(salaryEstimate("regular", "female", { age: 40 })).toEqual(hearingSalary("regular", "female", { age: 40 }));
  });

  it("給与の種類の推定は年齢を渡し、標準報酬月額は等級表に当てる（厚生年金の下限 88,000円）", () => {
    const wh = blankHousehold(BASE, () => "self-1");
    const self = wh.request.input.household.members[0]!;
    const p = convertPeriod({ id: "p1", member: self.id, from: { at: "2008-04" }, to: null, type: "regular" } as EmploymentPeriod, "partTime", self, BASE);
    expect(p.salary?.annual).toMatchObject({ value: 1500000, state: "estimated", origin: { kind: "auto" } });
    expect(p.standardMonthlyRemuneration?.health.value).toBe(126000);
    expect(smrEstimate(600000, BASE).pension.value).toBe(88000);
  });

  it("推定のままの給与は、統計の目安が変わったら入れ直す（人が入れた値は変えない）", () => {
    const wh = blankHousehold(BASE, () => "self-1");
    const h = structuredClone(wh.request.input.household);
    const self = h.members[0]!;
    h.employmentPeriods = [
      { id: "p1", member: self.id, from: { at: "2008-04" }, to: null, type: "regular", salary: { annual: estimatedBox(4300000, "古い目安"), bonus: estimatedBox(1000000, "古い目安") } } as EmploymentPeriod,
      { id: "p2", member: self.id, from: { at: "2040-04" }, to: null, type: "contract", salary: { annual: { value: 2000000, state: "confirmed", origin: { kind: "manual" } } } } as EmploymentPeriod,
    ];
    refreshEstimates(h, BASE);
    const [p1, p2] = h.employmentPeriods;
    expect(p1?.salary?.annual.value).toBe(387400 * 12);
    expect((p1?.salary?.annual as { estimate?: { basis: string } }).estimate?.basis).toContain("賃金構造基本統計調査");
    expect(p1?.salary?.bonus?.value).toBe(1000000);
    expect(p2?.salary?.annual.value).toBe(2000000);
  });
});

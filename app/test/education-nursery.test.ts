// 保育園（2歳まで）と保育園・幼稚園（3歳から）・保育料の自動の計算の注記と結果・保育料とは別にかかるお金・学校ごとの学校外の費用・部活動の費用
// （0029・0062 の追記 2026-10-30）
import { describe, expect, it } from "vitest";
import type { Goal } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { stageStatistic } from "../src/workspace/input/educationCost.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { nurseryFeeLines } from "../src/workspace/input/nurseryFeeView.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { annualEstimate, nurseryMethodNote } from "../src/workspace/input/stages/education.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp } from "../src/workspace/input/valueState.ts";
import { masterAmount } from "../../hearing/src/statistics.ts";
import { modelHousehold, preview } from "./helpers.ts";

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
const sum = (wh: WorkingHousehold, row: string) => preview(wh.request).table.filter((c) => c.row === row).reduce((s, c) => s + c.amount, 0);

/** 本人・配偶者（会社員）と子（birth 生まれ） */
function fresh(birth: string): WorkingHousehold {
  const id = seq();
  let wh = blankHousehold("2026-10", id);
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1990-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse", id));
  wh = withRefreshedEstimates(addChildWithEducation(wh, id));
  return withRefreshedEstimates(mutate(wh, (h) => void (h.members.find((m) => m.kind === "child")!.birth.birthYearMonth = birth)));
}

describe("保育園（2歳まで）・保育園・幼稚園（3歳から）", () => {
  it("段の名前と、通い始める時期は年月だけ（推定は1歳の4月）。保育料の自動の計算のしかたを注記に出す", () => {
    let wh = fresh("2026-01");
    const g = goalOf(wh);
    expect(fieldOf(wh, `edu/${g.id}/nursery`).label).toBe("保育園（2歳まで）に通う");
    wh = fieldOf(wh, `edu/${g.id}/nursery`).set(wh, true);
    const groups = stage(wh).sections.flatMap((s) => s.groups);
    expect(groups.map((x) => x.title)).toContain("保育園（2歳まで）");
    expect(groups.map((x) => x.title)).toContain("保育園・幼稚園（3歳から）");
    const from = fieldOf(wh, "/stage/0/from");
    expect(from.time?.when.modes).toEqual(["ym"]);
    expect(from.time?.when.nullText).toContain("2027-04（1歳の4月）");
    const note = groups.find((x) => x.title === "保育園（2歳まで）")?.note ?? "";
    expect(note).toBe(`${nurseryMethodNote()}2029年4月からは無償化で0円。月額が分かれば「詳細」で入れられます`);
    expect(note).toContain("国の基準（月19,500円〜104,000円）");
  });

  it("保育料とは別にかかるお金は推定（統計の目安）で入り、計算に入る。計算の結果から年ごとの保育料の目安を出す", () => {
    let wh = fresh("2026-01");
    const g = goalOf(wh);
    wh = withRefreshedEstimates(fieldOf(wh, `edu/${g.id}/nursery`).set(wh, true));
    const extra = fieldOf(wh, "/stage/0/extra");
    const v = masterAmount("education.statistics.nursery.extra")!;
    expect(extra.get(wh)).toMatchObject({ value: null, hint: `年${(Math.round(v / 1000) / 10).toLocaleString("ja-JP")}万円（推定）` });
    expect(extra.blankEstimate?.(wh)).toBe(v);
    const r = preview(wh.request);
    const extraFlows = r.table.filter((c) => c.object === g.id && c.row === "cf.expense.education.school" && c.year === 2028);
    expect(extraFlows.reduce((a, c) => a + c.amount, 0)).toBeGreaterThan(0);
    // 収入の無い世帯（住民税がかからない）は0円
    expect(nurseryFeeLines(wh, r)[0]!.text).toMatch(/2027年 0円/);
    // 共働きの見本の世帯は、年ごとの月の平均が出る
    const pl = fromRequest(modelHousehold("parentalLeave"));
    const lines = nurseryFeeLines(pl, preview(pl.request));
    expect(lines.length).toBe(1);
    expect(lines[0]!.text).toMatch(/年 月平均[\d.]+万円/);
    // 月額を入れた段は目安を出さない
    const w2 = fieldOf(wh, "/stage/0/monthly").set(wh, 30000);
    expect(nurseryFeeLines(w2, preview(w2.request))).toEqual([]);
  });
});

describe("学校ごとの学校外の費用・部活動の費用", () => {
  it("標準は一律（統計の平均・入れない）、詳細は各段の月額（推定は統計の平均÷12）", () => {
    let wh = fresh("2016-05");
    const g = goalOf(wh);
    const uni = fieldOf(wh, `edu/${g.id}/outUniform`);
    expect(uni.level).toBe("simple");
    expect(uni.get(wh)).toMatchObject({ value: "statistics" });
    const before = sum(wh, "cf.expense.education.outOfSchool");
    expect(before).toBeGreaterThan(0);
    wh = uni.set(wh, "none");
    expect(sum(wh, "cf.expense.education.outOfSchool")).toBe(0);
    wh = fieldOf(wh, `edu/${g.id}/outUniform`).set(wh, "statistics");
    const el = fieldOf(wh, `edu/${g.id}/stage/0/outOfSchool`);
    expect(el.level).toBe("detail");
    expect(el.blankEstimate?.(wh)).toBe(Math.round(stageStatistic(goalOf(wh).education!.stages[0]!)!.outOfSchool! / 12));
    wh = el.set(wh, 30000);
    expect(goalOf(wh).education!.stages[0]!.outOfSchool).toEqual({ monthly: 30000 });
    expect(fieldOf(wh, `edu/${g.id}/outUniform`).get(wh).value).toBe("custom");
  });

  it("部活動の費用は中学校・高校だけに出し、推定は統計の教科外活動費（学校の費用に含む）。入れると入れ替わる", () => {
    const wh = fresh("2016-05");
    const g = goalOf(wh);
    expect(fields(wh).some((f) => f.key === `edu/${g.id}/stage/0/club`)).toBe(false);
    const jh = goalOf(wh).education!.stages.findIndex((s) => s.stage === "juniorHigh");
    const club = fieldOf(wh, `edu/${g.id}/stage/${jh}/club`);
    const stat = masterAmount("education.statistics.juniorHigh.public.extracurricular")!;
    expect(club.blankEstimate?.(wh)).toBe(stat);
    const school = sum(wh, "cf.expense.education.school");
    // 推定の値を「この値にする」で入れても計算は同じ
    const same = applyStateOp(wh, club, "confirm");
    expect(Math.abs(sum(same, "cf.expense.education.school") - school)).toBeLessThan(10);
    const w2 = club.set(wh, 84000);
    expect(sum(w2, "cf.expense.education.school")).toBeGreaterThan(school);
    // 部活動の費用を入れた段の学校の費用の推定は、統計の教科外活動費を除く
    const st = goalOf(w2).education!.stages[jh]!;
    expect(annualEstimate(st, "")!.value).toBe(stageStatistic(st)!.annual! - stat);
  });
});

// 教育費の推定の直し（0010 の追記 2026-11-14・0041 の追記 2026-11-14）: 高校の学校の費用の推定は就学支援金を引く前の額（「この値にする」で結果を変えない）・
// 幼稚園〜高校の入学金等は入学金の欄の推定に・受験・併願の費用の推定・欄に入れる推定は千円単位・学校の種類を変えたときの前の推定の外し方
import { describe, expect, it } from "vitest";
import type { EngineRequest, EducationStage, Goal } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { estimateYen, examStatistic, stageStatistic } from "../src/workspace/input/educationCost.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { annualEstimate, dropStaleEstimates } from "../src/workspace/input/stages/education.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp } from "../src/workspace/input/valueState.ts";
import { masterAmount, regulationValue } from "../../hearing/src/statistics.ts";
import { modelHousehold, preview } from "./helpers.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const fields = (wh: WorkingHousehold) => allFields(buildStage("education", wh));
const fieldOf = (wh: WorkingHousehold, suffix: string): FieldDef => {
  const f = fields(wh).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const goalOf = (wh: WorkingHousehold): Goal => (wh.request.input.household.goals ?? []).find((g) => g.kind === "education")!;
const total = (req: EngineRequest, pred: (row: string) => boolean) => preview(req).table.filter((c) => pred(c.row)).reduce((s, c) => s + c.amount, 0);
/** 教育費の出るお金から、就学支援金・修学支援の入るお金を引いた額（表の期間の合計） */
const net = (req: EngineRequest) => total(req, (r) => r.startsWith("cf.expense.education")) - total(req, (r) => r === "cf.income.benefit.education");

/** 本人40歳・配偶者・子（birth 生まれ）。進路は既定（幼稚園〜高校は公立・大学は私立文系の自宅） */
function fresh(birth: string, stages?: EducationStage[]): WorkingHousehold {
  const id = seq();
  let wh = blankHousehold("2026-10", id);
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1986-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse", id));
  wh = withRefreshedEstimates(addChildWithEducation(wh, id));
  wh = withRefreshedEstimates(mutate(wh, (h) => void (h.members.find((m) => m.kind === "child")!.birth.birthYearMonth = birth)));
  // 進路は推定の入れ直しの後に書く（推定のままの進路は生年月から作り直されるため）
  return stages === undefined
    ? wh
    : mutate(wh, (h) => {
        const g = (h.goals ?? []).find((x) => x.kind === "education")!;
        g.education!.stages = stages.map((s, i) => ({ id: `00000000-0000-4000-8000-0000000e${String(i).padStart(4, "0")}`, ...s }));
      });
}
const stageIndex = (wh: WorkingHousehold, stage: string) => goalOf(wh).education!.stages.findIndex((s) => s.stage === stage);

describe("高校の学校の費用の推定は、就学支援金を引く前の額（0010 の追記 2026-11-14）", () => {
  for (const sector of ["public", "private"] as const) {
    it(`${sector === "public" ? "公立" : "私立"}: 推定＝統計の学校の費用（入学金等を除く）−統計の授業料＋支援金の上限。「この値にする」で入れても教育費（支援金を引いた額）は変わらない`, () => {
      // 2013年6月生まれ: 高校は2029年4月から（まだ入学していない）
      const wh = fresh("2013-06", [{ stage: "highSchool", sector }]);
      const i = stageIndex(wh, "highSchool");
      const stat = stageStatistic(goalOf(wh).education!.stages[i]!)!;
      const cap = regulationValue(`educationSupport.highSchool.${sector}Annual`, null) as number;
      expect(stat.hsTuition).toBe(masterAmount(`education.statistics.highSchool.${sector}.tuition`));
      const est = annualEstimate(goalOf(wh).education!.stages[i]!, "")!;
      expect(est.value).toBe(stat.annual! - stat.hsTuition! + cap);
      expect(est.basis).toContain("就学支援金を引く前の額");
      const f = fieldOf(wh, `/stage/${i}/annual`);
      expect(f.blankEstimate?.(wh)).toBe(estimateYen(est.value));
      const before = net(wh.request);
      const after = applyStateOp(wh, f, "confirm");
      expect(goalOf(after).education!.stages[i]!.annualOverride).toBe(estimateYen(est.value));
      // 計算の基準の年の値段では同じ。差は、千円単位に丸めた差（年500円まで×3年）と、入れた年額は教育費の上昇率で伸び支援金の上限は伸びない差
      // （（上限−統計の授業料）×上昇率の分。入学は3年後なので3年分で1割5分まで）だけ。前の二重の差し引き（（上限−統計の授業料）×3年）よりずっと小さい
      expect(Math.abs(net(after.request) - before)).toBeLessThan((cap - stat.hsTuition!) * 3 * 0.15 + 1500);
    });
  }
});

describe("幼稚園〜高校の入学金の欄は、統計の入学金等の推定（0010 の追記 2026-11-14）", () => {
  it("まだ入学していない段: 推定＝入学金等×在学年数の標準。空欄のまま計算に入り（入学の前の2月）、「この値にする」で入れても同じ", () => {
    const wh = fresh("2013-06", [{ stage: "juniorHigh", sector: "private" }, { stage: "highSchool", sector: "private" }]);
    const i = stageIndex(wh, "highSchool");
    const f = fieldOf(wh, `/stage/${i}/entrance`);
    const per = masterAmount("education.statistics.highSchool.private.entrance")!;
    expect(stageStatistic(goalOf(wh).education!.stages[i]!)!.entrance).toBe(per * 3);
    expect(f.blankEstimate?.(wh)).toBe(estimateYen(per * 3));
    expect(f.get(wh).estimated).toContain("入学金等");
    expect(f.help).toContain("入学した後の子にはかかりません");
    const entrance = preview(wh.request).table.filter((c) => c.row === "cf.expense.education.entrance" && c.year === 2029);
    expect(entrance.reduce((s, c) => s + c.amount, 0)).toBeGreaterThanOrEqual(per * 3);
    const before = total(wh.request, (r) => r === "cf.expense.education.entrance");
    const after = applyStateOp(wh, f, "confirm");
    expect(Math.abs(total(after.request, (r) => r === "cf.expense.education.entrance") - before)).toBeLessThan(1000);
  });

  it("学校の費用の推定は入学金等を除いた額", () => {
    const s = { stage: "elementary", sector: "private" } as EducationStage;
    const stat = stageStatistic(s)!;
    const totalStat = masterAmount("education.statistics.elementary.private.total")!;
    const out = masterAmount("education.statistics.elementary.private.outOfSchool")!;
    expect(stat.annual).toBe(totalStat - out - masterAmount("education.statistics.elementary.private.entrance")!);
    expect(stat.annualBasis).toContain("入学金等を除く");
  });
});

describe("受験・併願の費用の推定（0010 の追記 2026-11-14）", () => {
  it("大学・短大・専門学校は日本政策金融公庫の調査の平均、中学・高校・大学院は推定なし", () => {
    expect(examStatistic({ stage: "university", sector: "national" })?.value).toBe(385000);
    expect(examStatistic({ stage: "university", sector: "public" })?.value).toBe(385000);
    expect(examStatistic({ stage: "university", sector: "private", field: "humanities" })?.value).toBe(412000);
    expect(examStatistic({ stage: "university", sector: "private", field: "science" })?.value).toBe(422000);
    expect(examStatistic({ stage: "university", sector: "private", field: "medical" })?.value).toBe(422000);
    expect(examStatistic({ stage: "university", sector: "private", field: "other" })?.value).toBe(408000);
    expect(examStatistic({ stage: "juniorCollege", sector: "private" })?.value).toBe(349000);
    expect(examStatistic({ stage: "vocational" })?.value).toBe(223000);
    expect(examStatistic({ stage: "highSchool", sector: "private" })).toBeNull();
    expect(examStatistic({ stage: "graduateMaster", sector: "national" })).toBeNull();
    expect(examStatistic({ stage: "university", sector: "private", field: "humanities" })?.basis).toContain("教育費負担の実態調査");
  });

  it("空欄は推定の印と値で見せ、計算に入る（入学の前の1月）。「この値にする」で入れても同じ。大学院の欄は0円のまま", () => {
    const wh = fresh("2010-06", [{ stage: "highSchool", sector: "public" }, { stage: "university", sector: "private", field: "humanities" }, { stage: "graduateMaster", sector: "national" }]);
    const u = stageIndex(wh, "university");
    const f = fieldOf(wh, `/stage/${u}/exam`);
    expect(f.get(wh)).toMatchObject({ value: null, hint: "41.2万円（推定）" });
    expect(f.blankEstimate?.(wh)).toBe(412000);
    expect(f.help).toContain("入れなければ推定");
    const exam = preview(wh.request).table.filter((c) => c.row === "cf.expense.education.exam");
    expect(exam.map((c) => c.year)).toEqual([2029]);
    expect(exam[0]!.amount).toBeGreaterThanOrEqual(412000);
    const after = applyStateOp(wh, f, "confirm");
    expect(goalOf(after).education!.stages[u]!.exam).toEqual({ amount: 412000 });
    expect(total(after.request, (r) => r === "cf.expense.education.exam")).toBe(total(wh.request, (r) => r === "cf.expense.education.exam"));
    const g = fieldOf(wh, `/stage/${stageIndex(wh, "graduateMaster")}/exam`);
    expect(g.blankEstimate?.(wh) ?? null).toBeNull();
    expect(g.help).toContain("0円");
  });
});

describe("欄に入れる推定は千円単位（0041 の追記 2026-11-14）", () => {
  it("見本の世帯の子ども・教育の円の欄の推定の値（灰色の値・「この値にする」で入る値）は、どれも千円の倍数", () => {
    const odd: string[] = [];
    for (const id of ["educationTwoKids", "sampleFamilyDreams", "dualAssetsTwoKids", "salariedCoupleTwoKids", "parentalLeave"]) {
      const wh = fromRequest(modelHousehold(id));
      for (const f of fields(wh)) {
        if (f.kind !== "yen" || f.blankEstimate === undefined) continue;
        const v = f.blankEstimate(wh);
        if (typeof v === "number" && v % 1000 !== 0) odd.push(`${id} ${f.key} ${v}`);
      }
    }
    expect(odd).toEqual([]);
  });

  it("学校の種類を変えたとき、前の推定（千円単位の値も、丸める前に入れた前の版の値も）を外し、FP が入れた額は残す", () => {
    const prev = { stage: "highSchool", sector: "public" } as EducationStage;
    const est = annualEstimate(prev, "")!.value;
    const entrance = stageStatistic(prev)!.entrance!;
    for (const [annual, gone] of [[estimateYen(est), true], [est, true], [500000, false]] as const) {
      const next = { ...prev, sector: "private", annualOverride: annual, entranceOverride: estimateYen(entrance) } as EducationStage;
      dropStaleEstimates(prev, next, "");
      expect(next.annualOverride === undefined).toBe(gone);
      expect(next.entranceOverride).toBeUndefined();
    }
  });
});

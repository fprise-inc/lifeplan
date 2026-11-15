// 国立大学の学費の実データ（0010 の3・7・9、0219）: データの検査（全校・省令の上限・区間の形・出典・行の全年次・学部・学科）、入学年度ごとの額
// （新入生からの改定・在学生も対象の改定）、学校名の欄で選ぶと行を写して大学の額で計算すること、学部・学科の欄（修業年数・夜間主）、
// 先の入学年度は最新の年度の額を教育費の上昇率で伸ばすこと、見本の世帯（educationTwoKids）で平均から実データに変わる所
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineRequest, EducationStage, Goal } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import "../src/workspace/input/schoolLoader.ts";
import { schoolRowsInfo } from "../src/workspace/input/schoolField.ts";
import { departmentsOf, loadSchoolList, schoolOfStage, type SchoolList } from "../src/workspace/input/schools.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { stageRemainingCost } from "../src/workspace/input/stages/education.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { annualFor, PLAN_GRADES, planOf, tuitionRows, type TuitionRow } from "../src/workspace/input/tuition.ts";
import { readSchoolPack } from "../scripts/schoolList.ts";
import { checkTuition, readDepartments, readTuitionPack } from "../scripts/tuitionData.ts";
import { modelHousehold, preview } from "./helpers.ts";

const DATA = join(import.meta.dirname, "..", "..", "data");
const STD = 535800;
const CAP = 642960;

let list: SchoolList;
beforeAll(async () => {
  list = await loadSchoolList();
});
const codeOf = (name: string) => {
  const s = [...list.byCode.values()].find((x) => x.name === name && x.kind === "F1" && x.abolishedOn === "");
  if (s === undefined) throw new Error(`no school ${name}`);
  return s.code;
};

describe("国立大学の学費のデータ（data/tuition・data/schools/departments.yaml）", () => {
  const { rows } = readSchoolPack(join(DATA, "schools"));
  const { pack, schools } = readTuitionPack(join(DATA, "tuition"));
  const departments = readDepartments(join(DATA, "schools"));
  it("誤りが無い（省令の上限の外の額・区間の形・在学生の扱い・出典・全年次の行・部局ID）", () => {
    expect(checkTuition(schools, departments, rows, pack).errors).toEqual([]);
  });
  it("国立大学の全校（廃止していない85校）が入り、学部のある81校は学部の額が確かめ済み", () => {
    const national = rows.filter((r) => r.kind === "F1" && r.sector === "1" && r.abolishedOn === "").map((r) => r.code).sort();
    expect(national.length).toBe(85);
    expect(schools.map((s) => s.school).sort()).toEqual(national);
    const day = schools.map((s) => planOf(s, "day")).filter((p) => p !== null);
    expect(day.length).toBe(81);
    expect(day.every((p) => p.status === "reviewed")).toBe(true);
  });
  it("省令の上限を超える額を入れると止める（読み違いとして）", () => {
    const bad = schools.map((s) => (s.school === codeOf("東京大学") ? { ...s, plans: s.plans.map((p) => (p.plan === "day" ? { ...p, revisions: [{ ...p.revisions[0]!, annual: 643000 }] } : p)) } : s));
    expect(checkTuition(bad, departments, rows, pack).errors.join("\n")).toContain("省令の上限");
  });
  it("標準額から上げている大学がある（2026年度入学か、発表済みの2027年度入学で）。額は上限の中", () => {
    const raised = schools.filter((s) => {
      const p = planOf(s, "day");
      return p !== null && annualFor(p, p.latestEntryYear, p.latestEntryYear) > STD;
    });
    expect(raised.length).toBeGreaterThanOrEqual(10);
    for (const s of raised) expect(annualFor(planOf(s, "day")!, planOf(s, "day")!.latestEntryYear, planOf(s, "day")!.latestEntryYear)).toBeLessThanOrEqual(CAP);
  });
  it("学部・学科の一覧: 部局ID は学校の中で重ならず、医学科は6年", () => {
    for (const d of departments) expect(new Set(d.units.map((u) => u.id)).size).toBe(d.units.length);
    const tokyo = departments.find((d) => d.school === codeOf("東京大学"))!;
    expect(tokyo.units.find((u) => u.name === "医学部医学科")?.years).toBe(6);
  });
});

describe("入学年度ごとの額", () => {
  const { schools } = readTuitionPack(join(DATA, "tuition"));
  const plan = (name: string, p: "day" | "evening" = "day") => planOf(schools.find((s) => s.school === codeOf(name)), p)!;
  const annualOf = (rows: TuitionRow[], entry: number, grade: number) => rows.filter((r) => r.entryYear === entry && r.grade === grade && r.item === "tuition.annual").reduce((t, r) => t + r.amount, 0);
  it("新入生からの改定（東京大学 2025年度入学から）: 2024年度入学の人は卒業まで据え置き", () => {
    const rows = tuitionRows(plan("東京大学"));
    expect(annualOf(rows, 2024, 1)).toBe(STD);
    expect(annualOf(rows, 2024, 4)).toBe(STD);
    expect(annualOf(rows, 2025, 1)).toBe(CAP);
    expect(rows.find((r) => r.entryYear === 2025 && r.item === "tuition.admission")).toEqual({ entryYear: 2025, grade: 1, item: "tuition.admission", monthOffset: -1, amount: 282000 });
    // 授業料は4月と10月に半分ずつ
    expect(rows.filter((r) => r.entryYear === 2025 && r.grade === 1 && r.item === "tuition.annual").map((r) => [r.monthOffset, r.amount])).toEqual([
      [0, 321480],
      [6, 321480],
    ]);
  });
  it("在学生も対象の改定（熊本大学 2027年度から全学年）: 2025年度入学の人も3年次（2027年度）から改定の後の額", () => {
    const rows = tuitionRows(plan("熊本大学"));
    expect(annualOf(rows, 2025, 2)).toBe(STD);
    expect(annualOf(rows, 2025, 3)).toBe(594600);
    expect(annualOf(rows, 2027, 1)).toBe(594600);
  });
  it("行は2021年度入学から額の出ている最も先の入学年度まで、区分の年次の数だけそろう", () => {
    const p = plan("北海道大学");
    const rows = tuitionRows(p);
    const years = [...new Set(rows.map((r) => r.entryYear))];
    expect(years[0]).toBe(2021);
    expect(years.at(-1)).toBe(p.latestEntryYear);
    for (const e of years) expect(new Set(rows.filter((r) => r.entryYear === e && r.item === "tuition.annual").map((r) => r.grade)).size).toBe(PLAN_GRADES.day);
  });
});

// ---- 画面と計算 ----

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
/** 本人・配偶者・子（birth 生まれ。推定の進路: 大学だけ私立） */
function fresh(birth: string): WorkingHousehold {
  const id = seq();
  let wh = blankHousehold("2026-10", id);
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1976-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse", id));
  wh = withRefreshedEstimates(addChildWithEducation(wh, id));
  return withRefreshedEstimates(mutate(wh, (h) => void (h.members.find((m) => m.kind === "child")!.birth.birthYearMonth = birth)));
}
const goalOf = (wh: WorkingHousehold): Goal => (wh.request.input.household.goals ?? []).find((g) => g.kind === "education")!;
const stageAt = (wh: WorkingHousehold, stage: string) => goalOf(wh).education!.stages.findIndex((s) => s.stage === stage);
const fieldAt = (wh: WorkingHousehold, stage: string, part = "school"): FieldDef => {
  const key = `edu/${goalOf(wh).id}/stage/${stageAt(wh, stage)}/${part}`;
  const f = allFields(buildStage("education", wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
const uni = (wh: WorkingHousehold) => goalOf(wh).education!.stages[stageAt(wh, "university")]!;
const childOf = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "child")!;
const eduTotal = (req: EngineRequest) => preview(req).table.filter((c) => c.row === "cf.expense.education.school" || c.row === "cf.expense.education.entrance").reduce((s, c) => s + c.amount, 0);
const asNational = (wh: WorkingHousehold) => mutate(wh, (h) => void ((h.goals ?? []).find((g) => g.kind === "education")!.education!.stages.find((s) => s.stage === "university")!.sector = "national"));

describe("学校名の欄で国立大学を選ぶ", () => {
  it("行を段に写し、出どころ（大学の公式の学費の案内・入学年度）を欄の横に出す", () => {
    const wh = fresh("2016-05");
    const next = fieldAt(wh, "university").set(wh, codeOf("東京大学"));
    const sc = uni(next).school as unknown as { source: { pack: string }; rows: TuitionRow[]; unit: string };
    expect(sc.source.pack).toBe("master.education.tuition");
    expect(sc.rows.length).toBeGreaterThan(0);
    const hint = fieldAt(next, "university").get(next).hint ?? "";
    expect(hint).toContain("東京大学の公式の学費の案内");
    // 2016年5月生まれは2035年度入学。額の出ている最も先の入学年度の額を教育費の上昇率で伸ばす
    expect(hint).toContain("2035年度入学の額はまだ出ていないので");
    expect(hint).toContain("授業料 年64.3万円・入学料 28.2万円");
  });
  it("標準額のままの大学（京都大学。2026年度入学まで出ている）は、標準額の計算と端数の数十円のほかは同じ", () => {
    const wh = fresh("2016-05");
    const next = fieldAt(wh, "university").set(wh, codeOf("京都大学"));
    expect((uni(next).school as unknown as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
    expect(Math.abs(eduTotal(next.request) - eduTotal(asNational(wh).request))).toBeLessThanOrEqual(50);
  });
  it("2027年度入学の額まで出ている標準額の大学（北海道大学）は、2027年度からの上昇率で伸ばすので、標準額の計算（計算基準年から伸ばす）より1年分少ない", () => {
    const wh = fresh("2016-05");
    const next = fieldAt(wh, "university").set(wh, codeOf("北海道大学"));
    const std = eduTotal(asNational(wh).request);
    const d = std - eduTotal(next.request);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(std * 0.03);
  });
  it("上げている大学（東京大学）は、平均（標準額）より4年分の差額（教育費の上昇率で伸ばした額）だけ多い", () => {
    const wh = fresh("2016-05");
    const next = fieldAt(wh, "university").set(wh, codeOf("東京大学"));
    const diff = eduTotal(next.request) - eduTotal(asNational(wh).request);
    expect(diff).toBeGreaterThan((CAP - STD) * 4);
    expect(diff).toBeLessThan((CAP - STD) * 4 * 1.6);
  });
  it("入学年度の額が出ている子（2008年5月生まれ・2027年度入学・熊本大学）は、その額のとおり（上昇率で伸ばさない）", () => {
    const wh = fresh("2008-05");
    const next = fieldAt(wh, "university").set(wh, codeOf("熊本大学"));
    // 2027年度入学の額まで出ている標準額の大学（北海道大学）と比較すると、2027年の授業料は改定の差額（年58,800円）だけ多く、上昇率で伸ばさない
    const school2027 = (w: WorkingHousehold) => preview(w.request).table.filter((c) => c.row === "cf.expense.education.school" && c.year === 2027).reduce((s, c) => s + c.amount, 0);
    const hokudai = fieldAt(wh, "university").set(wh, codeOf("北海道大学"));
    expect(school2027(next) - school2027(hokudai)).toBe(594600 - STD);
    expect(preview(next.request).table.filter((c) => c.row === "cf.expense.education.entrance" && c.year === 2027).reduce((s, c) => s + c.amount, 0)).toBe(282000);
    const info = schoolRowsInfo(uni(next), childOf(next))!;
    expect(info.estimated).toBe(false);
    expect(info.ref).toBe(2027);
    // 見出しの目安（今の値段）も学校の額: 4年分の授業料と入学料
    const cost = stageRemainingCost(childOf(next), uni(next), "2026-10", "")!;
    expect(cost.total).toBeGreaterThanOrEqual(594600 * 4 + 282000);
  });
  it("年額の欄は学校の学費データを出し、入れてあれば使っていないことを知らせる", () => {
    const wh = fresh("2016-05");
    const next = fieldAt(wh, "university").set(wh, codeOf("東京大学"));
    expect(fieldAt(next, "university", "annual").get(next).hint).toContain("学校の学費データ");
    const withOverride = mutate(next, (h) => void ((h.goals ?? []).find((g) => g.kind === "education")!.education!.stages.find((s) => s.stage === "university")!.annualOverride = 1000000));
    expect(fieldAt(withOverride, "university", "annual").get(withOverride).warn).toContain("使っていません");
  });
});

describe("学部・学科の欄", () => {
  it("学部・学科の一覧のある大学に出し、医学科を選ぶと在学年数を6年にする", () => {
    const wh = fresh("2016-05");
    const picked = fieldAt(wh, "university").set(wh, codeOf("東京大学"));
    const f = fieldAt(picked, "university", "unit");
    const med = departmentsOf(list, codeOf("東京大学")).find((d) => d.name === "医学部医学科")!;
    const next = f.set(picked, `${codeOf("東京大学")}/${med.id}`);
    expect((uni(next).school as unknown as { unit: string }).unit).toBe(`${codeOf("東京大学")}/${med.id}`);
    expect(uni(next).years).toBe(6);
    // 6年分の授業料を払う
    const yrs = new Set(preview(next.request).table.filter((c) => c.row === "cf.expense.education.school" && c.object === goalOf(next).id).map((c) => c.year));
    expect(yrs.size).toBeGreaterThanOrEqual(6);
  });
  it("夜間主コースを選ぶと夜間主の額の行にする", () => {
    const wh = fresh("2016-05");
    const code = codeOf("広島大学");
    const picked = fieldAt(wh, "university").set(wh, code);
    const ev = departmentsOf(list, code).find((d) => d.plan === "evening")!;
    const next = fieldAt(picked, "university", "unit").set(picked, `${code}/${ev.id}`);
    const rows = (uni(next).school as unknown as { rows: TuitionRow[] }).rows;
    expect(rows.filter((r) => r.entryYear === 2026 && r.grade === 1 && r.item === "tuition.annual").reduce((t, r) => t + r.amount, 0)).toBe(267900);
  });
  it("学費データが新しくなったか課程を変えて写した行が違えば知らせ、入れ直せる", () => {
    const wh = fresh("2016-05");
    const picked = fieldAt(wh, "university").set(wh, codeOf("東京大学"));
    const stale = mutate(picked, (h) => {
      const st = (h.goals ?? []).find((g) => g.kind === "education")!.education!.stages.find((s) => s.stage === "university")!;
      (st.school as unknown as { rows: TuitionRow[] }).rows[0]!.amount = 1;
    });
    const g = fieldAt(stale, "university").get(stale);
    expect(g.warn).toContain("写した学費の行が今の学費データと違います");
    const fixed = g.warnFix!.run(stale);
    expect(fieldAt(fixed, "university").get(fixed).warn ?? null).toBeNull();
  });
});

describe("見本の世帯（educationTwoKids）の第2子の国立大学を、学校で選ぶ", () => {
  // 第2子は公立中学・高校 → 国立大学（自宅）。2033年度入学で、額の出ている入学年度より先なので、最新の年度の額を教育費の上昇率で伸ばす
  const withSchool = (name: string): EngineRequest => {
    const req = modelHousehold("educationTwoKids");
    const wh = fromRequest(req);
    return mutate(wh, (h) => {
      const g = (h.goals ?? []).find((x) => x.kind === "education" && x.education!.stages.some((s) => s.stage === "university" && s.sector === "national"))!;
      const st = g.education!.stages.find((s) => s.stage === "university")! as EducationStage;
      st.school = schoolOfStage(codeOf(name), list, undefined, st);
    }).request;
  };
  it("標準額の大学（京都大学）なら結果は端数の数十円のほかは変わらず、上げている大学（東京大学）なら4年分の差額だけ増える", () => {
    const base = eduTotal(modelHousehold("educationTwoKids"));
    expect(Math.abs(eduTotal(withSchool("京都大学")) - base)).toBeLessThanOrEqual(50);
    const diff = eduTotal(withSchool("東京大学")) - base;
    expect(diff).toBeGreaterThan((CAP - STD) * 4);
    expect(diff).toBeLessThan((CAP - STD) * 4 * 1.3);
  });
});

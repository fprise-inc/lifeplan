// 子ども・教育のカード（0062・0063）: 新しい世帯の推定の進路・古い世帯は「推定の進路で埋める」だけ・学校外の費用の入れ方（統計の平均で／行で入れる。
// 行で入れるときは統計を足さない）・段の統計の平均の表示と年額の上書き・専門学校の未入力の警告・短大と専門学校の修学支援の知らせ・高校のあとの進路の
// 置き換え・奨学金と教育ローン・この子の入るお金と出るお金・留学のピン・欄の往復
import { describe, expect, it } from "vitest";
import type { EngineRequest, Goal, Household } from "../src/engine/types.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { boardingStatistic, stagePeriod, stageStatistic } from "../src/workspace/input/educationCost.ts";
import { EDUCATION_BASIS, educationStagesAddress, gapsOf } from "../src/workspace/input/fill.ts";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addItem } from "../src/workspace/input/items.ts";
import { addIncome } from "../src/workspace/input/moneyRows.ts";
import { rowAt } from "../src/workspace/input/rows.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { addChildExpense, addChildIncome, addEducationLoan, addScholarship, educationRowChild, HIGHER_SUPPORT_NOTE, outOfSchoolModeOf, replaceHigher, VOCATIONAL_MISSING } from "../src/workspace/input/stages/education.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const stage = (wh: WorkingHousehold): StageDef => buildStage("education", wh);
const fields = (wh: WorkingHousehold) => allFields(stage(wh));
const fieldOf = (wh: WorkingHousehold, suffix: string): FieldDef => {
  const f = fields(wh).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const actions = (wh: WorkingHousehold) => stage(wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
const actionOf = (wh: WorkingHousehold, suffix: string) => {
  const a = actions(wh).find((x) => x.key.endsWith(suffix));
  if (a === undefined) throw new Error(`no action ${suffix}`);
  return a;
};
const groups = (wh: WorkingHousehold) => stage(wh).sections.flatMap((s) => s.groups);
const goalOf = (wh: WorkingHousehold): Goal => (wh.request.input.household.goals ?? []).find((g) => g.kind === "education")!;
const child = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "child")!;
/** 表の行のうち、教育費（学校外の費用など）の合計 */
const eduSum = (req: EngineRequest, row: string) => preview(req).table.filter((c) => c.row === row).reduce((s, c) => s + c.amount, 0);

/** 本人40歳・配偶者・子（2016年5月生まれ。計算基準月に小学4年）の新しい世帯 */
function fresh(): WorkingHousehold {
  const id = seq();
  let wh = blankHousehold(BASE, id);
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1986-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse", id));
  wh = withRefreshedEstimates(addChildWithEducation(wh, id));
  return withRefreshedEstimates(mutate(wh, (h) => void (h.members.find((m) => m.kind === "child")!.birth.birthYearMonth = "2016-05")));
}

describe("公立・私立はどの段でも標準。進路の型で一度に変わる（0078 の 2026-10-29 の追記）", () => {
  it("小学校〜大学の公立・私立が標準に出て、型を選ぶと全部の段が変わる。段を型と違う値にすると型は「自分で選ぶ」になる", () => {
    let wh = fresh();
    const g = goalOf(wh);
    const sectors = fields(wh).filter((f) => /\/stage\/\d+\/sector$/.test(f.key));
    expect(sectors.map((f) => f.level)).toEqual(["simple", "simple", "simple", "simple"]);
    wh = fieldOf(wh, "/preset").set(wh, "allPrivate");
    expect(goalOf(wh).education!.stages.map((s) => s.sector)).toEqual(["private", "private", "private", "private"]);
    expect(fieldOf(wh, "/preset").get(wh).value).toBe("allPrivate");
    // 中学だけ公立に直すと、どの型にも当たらないので「自分で選ぶ」（値は ""）
    wh = fieldOf(wh, `edu/${g.id}/stage/1/sector`).set(wh, "public");
    expect(goalOf(wh).education!.stages.map((s) => s.sector ?? "public")).toEqual(["private", "public", "private", "private"]);
    expect(fieldOf(wh, "/preset").get(wh).value).toBe("");
    // 残りの段も型の値にそろえると、型の表示に戻る（欄で「公立」を選んで値が空になっても公立として当たる）
    for (const [i, v] of [[0, "public"], [2, "public"], [3, "national"]] as const) wh = fieldOf(wh, `edu/${g.id}/stage/${i}/sector`).set(wh, v);
    expect(fieldOf(wh, "/preset").get(wh).value).toBe("allPublic");
    // 型を選び直すと、直した段も型の値に戻る
    wh = fieldOf(wh, "/preset").set(wh, "highPrivate");
    expect(goalOf(wh).education!.stages.map((s) => s.sector)).toEqual(["public", "public", "private", "private"]);
  });
});

describe("推定の進路（新しい世帯は自動・古い世帯はボタンだけ）", () => {
  it("新しい世帯で子を足すと、標準の型「大学だけ私立〔文系・自宅〕」の推定の進路が入り、学校外の費用は統計の平均で始まる", () => {
    const wh = fresh();
    const g = goalOf(wh);
    expect(g.education!.stages.map((s) => [s.stage, s.sector])).toEqual([
      ["elementary", "public"],
      ["juniorHigh", "public"],
      ["highSchool", "public"],
      ["university", "private"],
    ]);
    expect(g.education!.stages.every((s) => typeof s.id === "string")).toBe(true);
    expect(g.education!.outOfSchoolMode).toBe("statistics");
    expect(rowAt(wh.request.input as unknown as Record<string, unknown>, educationStagesAddress(g.id))).toMatchObject({ state: "estimated", estimate: { basis: EDUCATION_BASIS } });
    expect(groups(wh).find((x) => x.key === `edu/${g.id}`)?.note).toContain("大学だけ私立〔文系・自宅〕");
    expect(preview(wh.request).table.some((c) => c.row.startsWith("cf.expense.education") && c.amount > 0)).toBe(true);
  });

  it("古い世帯（進路の無い子）は開いても書き換えず、未入力の印と「推定の進路で埋める」を出す。押すと推定で入る", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    req.input.household.goals = [];
    const wh = fromRequest(req);
    const before = JSON.stringify(wh.request);
    const kid = wh.request.input.household.members.filter((m) => m.kind === "child")[0]!;
    const sec = stage(wh).sections.find((s) => s.key === `edu/${kid.id}`)!;
    expect(sec.note).toContain("未入力（教育費0円で計算中）");
    expect(JSON.stringify(wh.request)).toBe(before);
    expect(gapsOf(wh).some((g) => g.id === `education/${kid.id}`)).toBe(true);
    const add = sec.actions.find((a) => a.key === `edu/${kid.id}/add`)!;
    expect(add.label).toMatch(/^推定の進路で埋める（/);
    const filled = add.run(wh);
    const goal = (filled.request.input.household.goals ?? []).find((g) => g.owner === kid.id)!;
    expect(rowAt(filled.request.input as unknown as Record<string, unknown>, educationStagesAddress(goal.id))?.state).toBe("estimated");
  });

  it("この子の教育費を入れない（該当なし）", () => {
    const wh = fresh();
    const w = actionOf(wh, `edu/${child(wh).id}/none`).run(wh);
    const g = goalOf(w);
    expect(g.education!.stages).toEqual([]);
    expect(rowAt(w.request.input as unknown as Record<string, unknown>, educationStagesAddress(g.id))?.state).toBe("notApplicable");
  });
});

describe("学校外の費用の入れ方（統計の平均で／行で入れる）", () => {
  it("統計の平均で: 行を足しても計算に入らない（行は残る）。行で入れる: 統計の平均を足さない", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const statOnly = eduSum(wh.request, "cf.expense.education.outOfSchool");
    expect(statOnly).toBeGreaterThan(0);
    // 行で入れる に切り替えると、段ごとに統計の平均の行（推定）を作る。結果はほぼ同じ（月額に丸めた分だけ違う）
    const rows = fieldOf(wh, `edu/${g.id}/outMode`).set(wh, "rows");
    const g2 = goalOf(rows);
    expect(g2.education!.outOfSchoolMode).toBe("rows");
    const lessons = g2.education!.lessons!;
    expect(lessons.map((l) => l.label)).toEqual(["学校外活動費（小学校・平均）", "学校外活動費（中学校・平均）", "学校外活動費（高校・平均）"]);
    const monthly = allFields(stage(rows)).find((f) => f.key === `edu/${g.id}/lesson/0/monthly`)!;
    expect(fieldStatus(monthly, rows).status).toBe("estimated");
    expect(fieldStatus(monthly, rows).basis).toContain("子供の学習費調査");
    const rowsSum = eduSum(rows.request, "cf.expense.education.outOfSchool");
    expect(Math.abs(rowsSum - statOnly) / statOnly).toBeLessThan(0.01);
    // 中学の行を塾の月額に直すと、その行だけ確定。統計の平均は足さない（二重にならない）
    const cram = allFields(stage(rows)).find((f) => f.key === `edu/${g.id}/lesson/1/monthly`)!.set(rows, 42000);
    expect(fieldStatus(allFields(stage(cram)).find((f) => f.key === `edu/${g.id}/lesson/1/monthly`)!, cram).status).toBe("confirmed");
    expect(eduSum(cram.request, "cf.expense.education.outOfSchool")).toBeGreaterThan(rowsSum);
    // 統計に戻すと行は消さずに残し、計算に使わない。もう一度「行で入れる」にしても行を作り直さない
    const back = fieldOf(cram, `edu/${g.id}/outMode`).set(cram, "statistics");
    expect(goalOf(back).education!.lessons).toHaveLength(3);
    expect(eduSum(back.request, "cf.expense.education.outOfSchool")).toBe(statOnly);
    expect(groups(back).some((x) => x.key.startsWith(`edu/${g.id}/lesson/`))).toBe(false);
    const again = fieldOf(back, `edu/${g.id}/outMode`).set(back, "rows");
    expect(goalOf(again).education!.lessons).toHaveLength(3);
    expect(goalOf(again).education!.lessons![1]!.monthly).toBe(42000);
  });

  it("行に種類（塾・習い事・その他）。行で入れるときの足すボタン", () => {
    let wh = fresh();
    const g = goalOf(wh);
    wh = fieldOf(wh, `edu/${g.id}/outMode`).set(wh, "rows");
    wh = actionOf(wh, `edu/${g.id}/addLesson/lesson`).run(wh);
    const l = goalOf(wh).education!.lessons!.at(-1)!;
    expect([l.kind, l.label, l.monthly]).toEqual(["lesson", "習い事", 8000]);
    const i = goalOf(wh).education!.lessons!.length - 1;
    expect(fieldOf(wh, `edu/${g.id}/lesson/${i}/kind`).get(wh).value).toBe("lesson");
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("入れ方の無い古い世帯で行がある物は、前の形（統計の平均に行を足す）のまま読み、切り替えを勧める（書き換えない）", () => {
    const wh = fromRequest(modelHousehold("educationTwoKids"));
    const g = (wh.request.input.household.goals ?? []).find((x) => (x.education?.lessons ?? []).length > 0)!;
    expect(outOfSchoolModeOf(g)).toBe("legacy");
    const f = fieldOf(wh, `edu/${g.id}/outMode`);
    expect(f.get(wh).value).toBe("legacy");
    expect(groups(wh).find((x) => x.key === `edu/${g.id}/out`)?.note).toContain("前の形");
    expect(f.kind === "select" && f.options.map((o) => o.value)).toEqual(["statistics", "rows", "legacy"]);
  });
});

describe("段ごとの費用", () => {
  it("段の見出しに統計の平均の年額を読むだけで出し、年額の上書きは段の ID の当て先で入る", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const uni = g.education!.stages.findIndex((s) => s.stage === "university");
    const note = groups(wh).find((x) => x.key === `edu/${g.id}/stage/${uni}`)?.note ?? "";
    const stat = stageStatistic(g.education!.stages[uni]!)!;
    expect(stat.annual).toBeGreaterThan(900000);
    expect(note).toContain("学費 年約");
    expect(note).toContain("統計の平均");
    const annual = fieldOf(wh, `edu/${g.id}/stage/${uni}/annual`);
    expect(annual.level).toBe("detail");
    // 空欄は統計の平均の推定（印「推定」・根拠は短く・「この値にする」で書ける）
    expect(annual.label).toBe("学費（年額）");
    expect(annual.get(wh)).toMatchObject({ value: null, estimated: "統計の平均。授業料と施設設備費を足したもの（私立大学・文科系・令和7年度入学者）", hint: `年${(Math.round(stat.annual! / 1000) / 10).toLocaleString("ja-JP")}万円（推定）` });
    expect(fieldStatus(annual, wh).status).toBe("estimated");
    expect(annual.blankEstimate?.(wh)).toBe(stat.annual);
    const w = annual.set(wh, 1300000);
    expect(goalOf(w).education!.stages[uni]!.annualOverride).toBe(1300000);
    expect(annual.address?.(w)?.at).toEqual(["stages", g.education!.stages[uni]!.id, "annualOverride"]);
  });

  it("自宅外にすると仕送りと初期費用の欄（空欄は統計の平均）と、見出しに「仕送り 月…（推定）」", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const uni = g.education!.stages.findIndex((s) => s.stage === "university");
    const w = fieldOf(wh, `edu/${g.id}/stage/${uni}/living`).set(wh, "away");
    expect(groups(w).find((x) => x.key === `edu/${g.id}/stage/${uni}`)?.note).toContain("仕送り 月");
    const m = fieldOf(w, `edu/${g.id}/stage/${uni}/boarding/monthly`);
    expect(m.get(w).hint).toContain(`月${(Math.round(boardingStatistic().annual! / 12 / 1000) / 10).toLocaleString("ja-JP")}万円`);
    expect(goalOf(m.set(w, 70000)).education!.stages[uni]!.boarding).toEqual({ monthly: 70000 });
  });

  it("専門学校: 年額の欄を簡易に出し、入れるまで未入力の警告（0円で計算中）。確かめの一覧にも出る。修学支援はまだ計算しないと知らせる", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const w = fieldOf(wh, `edu/${g.id}/higher`).set(wh, "vocational");
    const st = goalOf(w).education!.stages;
    expect(st.map((s) => s.stage)).toEqual(["elementary", "juniorHigh", "highSchool", "vocational"]);
    const i = st.findIndex((s) => s.stage === "vocational");
    const annual = fieldOf(w, `edu/${g.id}/stage/${i}/annual`);
    expect(annual.level).toBe("simple");
    expect(fieldStatus(annual, w)).toMatchObject({ status: "missing", basis: VOCATIONAL_MISSING });
    expect(checkList(w).some((r) => r.kind === "missing" && r.fieldKey === annual.key)).toBe(true);
    const note = groups(w).find((x) => x.key === `edu/${g.id}/stage/${i}`)?.note ?? "";
    expect(note).toContain("未入力");
    expect(note).toContain(HIGHER_SUPPORT_NOTE);
    const set = annual.set(w, 1100000);
    expect(fieldStatus(fieldOf(set, `edu/${g.id}/stage/${i}/annual`), set).status).toBe("confirmed");
    expect(eduSum(set.request, "cf.expense.education.school")).toBeGreaterThan(eduSum(w.request, "cf.expense.education.school"));
  });

  it("公立の短大は私立の短大の平均で仮に計算していると知らせ、年額の欄を簡易に出す", () => {
    const wh = fresh();
    const g = goalOf(wh);
    let w = fieldOf(wh, `edu/${g.id}/higher`).set(wh, "juniorCollege");
    const i = goalOf(w).education!.stages.findIndex((s) => s.stage === "juniorCollege");
    w = fieldOf(w, `edu/${g.id}/stage/${i}/sector`).set(w, "public");
    expect(groups(w).find((x) => x.key === `edu/${g.id}/stage/${i}`)?.note).toContain("私立の短大の平均で仮に計算");
    expect(fieldOf(w, `edu/${g.id}/stage/${i}/annual`).level).toBe("simple");
  });

  it("高校のあとの進路の置き換えは、通い方・浪人・仕送り・年額の上書きを引き継ぐ（系統は大学だけ）", () => {
    const stages = [
      { id: "00000000-0000-4000-8000-0000000000a1", stage: "highSchool", sector: "public" },
      { id: "00000000-0000-4000-8000-0000000000a2", stage: "university", sector: "private", field: "science", living: "away", delayYears: 1, annualOverride: 1500000, boarding: { monthly: 90000 } },
    ];
    const v = replaceHigher(stages, "vocational");
    expect(v[1]).toMatchObject({ stage: "vocational", sector: "private", living: "away", delayYears: 1, annualOverride: 1500000, boarding: { monthly: 90000 } });
    expect(v[1]!.field).toBeUndefined();
    expect(replaceHigher(v, "university")[1]).toMatchObject({ stage: "university", field: "humanities" });
    expect(replaceHigher(stages, "none").map((s) => s.stage)).toEqual(["highSchool"]);
  });

  it("在学の期間は計算エンジンと同じ（入学の年の4月〜卒業の年の3月。浪人を足す）", () => {
    const c = child(fresh());
    expect(stagePeriod(c, { stage: "university" })).toEqual({ from: "2035-04", to: "2039-03" });
    expect(stagePeriod(c, { stage: "university", delayYears: 1, field: "medical" })).toEqual({ from: "2036-04", to: "2042-03" });
  });
});

describe("奨学金・教育ローン", () => {
  it("貸与の奨学金を足すとひな形の値（推定）で入り、在学中に受け取る。返す年数は年で入れて月で持つ", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const w = addScholarship(wh, g.id, "00000000-0000-4000-8000-0000000000c1");
    const s = goalOf(w).education!.scholarships![0]!;
    // 日本学生支援機構: 第二種の利率固定方式の年3.0%、返す年数は返還年数算出表（貸与総額240万円は基礎額16万円で15年）
    expect(s).toMatchObject({ monthly: 50000, from: { at: "2035-04" }, to: { at: "2039-03" }, rate: "0.03", termMonths: 180, debtor: "child" });
    const k = `edu/${g.id}/scholar/${s.id}`;
    expect(fieldStatus(fieldOf(w, `${k}/monthly`), w).status).toBe("estimated");
    const term = fieldOf(w, `${k}/term`);
    expect(term.get(w).value).toBe(15);
    expect(goalOf(term.set(w, 20)).education!.scholarships![0]!.termMonths).toBe(240);
    expect(preview(w.request).table.filter((c) => c.row === "cf.income.other.scholarship").reduce((a, c) => a + c.amount, 0)).toBe(50000 * 48);
  });

  it("教育ローンを足すと入学の前の1月に本人が借り、借りた額が入金になる", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const w = addEducationLoan(wh, g.id, "00000000-0000-4000-8000-0000000000c2");
    const l = goalOf(w).education!.loans![0]!;
    // 国の教育ローン: 入学の年の学費（入学金と1年目の学費の統計の平均。上限350万円）・年4.05%・20年
    const uni = goalOf(w).education!.stages.find((x) => x.stage === "university")!;
    const st = stageStatistic(uni)!;
    const amount = Math.round((st.annual! + st.entrance!) / 10000) * 10000;
    expect(l).toMatchObject({ at: { at: "2035-01" }, amount, rate: "0.0405", termMonths: 240 });
    expect(fieldStatus(fieldOf(w, `edu/${g.id}/loan/${l.id}/amount`), w).status).toBe("estimated");
    expect(preview(w.request).table.filter((c) => c.row === "cf.income.other.scholarship" && c.year === 2035).reduce((a, c) => a + c.amount, 0)).toBe(amount);
    // 住まい・ローンのカードには読むだけの1行
    const line = allFields(buildStage("housing", w)).find((f) => f.key === "ro/housing/eduLoans");
    expect(line?.get(w).value).toBe("1件");
    expect(line?.readOnly).toContain("子ども・教育");
  });
});

describe("この子の入るお金・出るお金", () => {
  it("教育資金の援助・給付型の奨学金・子が払う分は、受け取る人がその子で、その子の区画に出る（額は未入力）", () => {
    const wh = fresh();
    const c = child(wh);
    const g = goalOf(wh);
    let w = addChildIncome(wh, c.id, "educationSupport", "00000000-0000-4000-8000-0000000000d1");
    w = addChildIncome(w, c.id, "childPays", "00000000-0000-4000-8000-0000000000d2");
    const h: Household = w.request.input.household;
    const [support, pays] = h.incomeFlows!;
    expect(support).toMatchObject({ recipient: c.id, from: { at: "2035-04" }, to: { at: "2038-04" }, everyYears: 1 });
    expect(pays).toMatchObject({ recipient: c.id, monthly: true, to: { at: "2039-03" } });
    const sec = stage(w).sections.find((s) => s.key === `edu/${c.id}`)!;
    expect(sec.groups.some((x) => x.key === `in/${support!.id}`)).toBe(true);
    expect(fieldStatus(fieldOf(w, `in/${support!.id}/amount`), w).status).toBe("missing");
    // 子を決めていない行は後ろの区画
    const loose = addIncome(w, "scholarshipGrant", "00000000-0000-4000-8000-0000000000d3");
    expect(educationRowChild(loose.request.input.household, { ...loose.request.input.household.incomeFlows!.at(-1)!, dir: "in" })).toBeNull();
    expect(stage(loose).sections.find((s) => s.key === "money/education/in")?.groups.some((x) => x.key === "in/00000000-0000-4000-8000-0000000000d3")).toBe(true);
    expect(stage(w).sections.some((s) => s.key === "money/education/in")).toBe(false);
    expect(g.id).toBeTruthy();
  });

  it("前の形の留学（その子の年齢の出るお金の行。種類は教育費）は子の区画に出る。＋ 項目を追加の留学で子を選ぶと、教育の目標の留学になる（0090）", () => {
    const wh = fresh();
    const c = child(wh);
    const w = addChildExpense(wh, c.id, "abroad", "00000000-0000-4000-8000-0000000000e1");
    const p = w.request.input.household.periodicExpenses!.at(-1)!;
    expect(p).toMatchObject({ kind: "education", row: "cf.expense.education", from: { memberAge: { member: c.id, years: 20 } } });
    expect(stage(w).sections.find((s) => s.key === `edu/${c.id}`)!.groups.some((x) => x.key === `ev/${p.id}`)).toBe(true);
    // 今の値段の 350万円を物価で伸ばした額（1回）
    const abroad = eduSum(w.request, "cf.expense.education");
    expect(abroad).toBeGreaterThanOrEqual(3500000);
    expect(abroad).toBeLessThan(4500000);
    const pin = addItem(wh, `abroad:${c.id}`, () => "00000000-0000-4000-8000-0000000000f1")!;
    expect(pin.itemId).toBe("education");
    expect(goalOf(pin.wh).education!.abroad).toMatchObject([{ id: "00000000-0000-4000-8000-0000000000f1", stage: "university", kind: "credit" }]);
    expect(stage(pin.wh).sections.find((s) => s.key === `edu/${c.id}`)!.groups.some((x) => x.key.endsWith("/abroad/00000000-0000-4000-8000-0000000000f1"))).toBe(true);
  });
});

describe("欄の往復と計算", () => {
  it("同じ値を入れ直しても世帯は変わらない。どの足す操作の後も要求はスキーマを通る", () => {
    let wh = fresh();
    const g = goalOf(wh);
    wh = fieldOf(wh, `edu/${g.id}/outMode`).set(wh, "rows");
    wh = addScholarship(wh, g.id);
    wh = addEducationLoan(wh, g.id);
    for (const f of fields(wh)) {
      if (f.readOnly !== undefined) continue;
      expect(JSON.stringify(f.set(wh, f.get(wh).value)), f.key).toBe(JSON.stringify(wh));
    }
    for (const a of actions(wh)) if (a.danger !== true) wh = a.run(wh);
    expect(() => preview(wh.request)).not.toThrow();
  });
});

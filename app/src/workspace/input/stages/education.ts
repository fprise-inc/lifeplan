// 6. 子ども・教育（0010・0029・0062）: 子ごとの区画に、進路・段ごとの費用・学校外の費用・奨学金と教育ローン・この子の入るお金と出るお金・子への援助。
// - 進路: 進路の型（段ごとの公立・私立を一度に）・高校のあとの進路（大学・短大・専門学校・行かない）・系統と通い方・保育園。学費は統計の平均
//   （文部科学省「子供の学習費調査」など）で、段の見出しに年額を読むだけで出し、詳細で年額・入学金・仕送りを上書きできる
// - 専門学校は統計の目安が無いので、年額を入れるまで未入力の警告（0円で計算中）。公立の短大は私立の短大の平均で仮に計算（知らせる）。
//   国の修学支援は大学だけを計算し、短大・専門学校はまだ計算しないことを段の1行で知らせる（計算エンジンの知らせは画面に出ないため）
// - 学校外の費用の入れ方（0062）: 統計の平均で／行で入れる。行で入れるときは統計の平均を足さない（塾の月謝が統計の平均の上に足されて二重に
//   なるのを防ぐ）。初めて行に切り替えたときは、段ごとに統計の平均の行（推定）を作る。統計に戻しても行は消さずに残す（使わない）。
//   入れ方の無い古い世帯で行がある物は、前の形（統計の平均に行を足す）のまま読み、切り替えを勧める
// - この子のお金の行（0044）: 入るお金は受け取る人がその子か、時期がその子の年齢の行。出るお金は時期がその子の年齢の行（留学など）。
//   子を決めていない教育のお金の行は、カードの後ろの区画
// - 保育園（0〜2歳）は「通う・通わない」と通い始めだけを簡易で聞き、保育料は月額を入れなければ収入から自動で計算する（目安。0029）。
// - 学校名から学費を出す検索は、学校のデータを同梱してから（今は「学校未定（平均で計算）」だけ）
import type { EducationLesson, EducationLoan, EducationScholarship, EducationStage, Goal, Household, IncomeFlow, IncomeFlowKind, Member, PeriodicExpense, Timepoint } from "../../../engine/types.ts";
import { schoolEntryYear } from "../../present.ts";
import { addMonths } from "../../levers.ts";
import { byId, field, getPath, plain, removeAction, resolveTimepoint, timepointField, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, presetBasis, standardBox, type WorkingHousehold } from "../household.ts";
import { formatYearMonth, formatYen } from "../units.ts";
import { EDUCATION_BASIS, educationStagesAddress, fillEducation } from "../fill.ts";
import { putRow, rowAt, type StateRow } from "../rows.ts";
import { addIncome, expenseCard, incomeCard, incomeGroups, moneySections, periodicGroups } from "../moneyRows.ts";
import { readGroup, readLine } from "../readLines.ts";
import { boardingStatistic, isHigher, isK12, manText, stagePeriod, stageStatistic } from "../educationCost.ts";
import { childOfPeriodic } from "./events.ts";
import { donorOptions, FIELDS, GIFT_PURPOSES, HOUSING_EXEMPTION, LIVING_PLACE, memberLabel, memberOptions, NURSERY_HOURS, SCHOOL_LUNCH, SCHOOL_STAGES, SECTORS, TAX_METHODS } from "../labels.ts";
import type { Address } from "../../store/readings.ts";

type Obj = Record<string, unknown>;
const goals = (h: Household) => h.goals;
const ORDER = ["nursery", "kindergarten", "elementary", "juniorHigh", "highSchool", "university", "juniorCollege", "vocational"];
const STAGE_AGE: Record<string, number> = { kindergarten: 3, elementary: 6, juniorHigh: 12, highSchool: 15, university: 18, juniorCollege: 18, vocational: 18 };
const stageLabel = (stage: string) => SCHOOL_STAGES.find((o) => o.value === stage)?.label ?? stage;

/** 保育料が無償になる月（3歳になった後の最初の4月）。この月より前なら保育園の年齢がある */
export function nurseryFreeMonth(child: Member): string | null {
  const entry = schoolEntryYear(child.birth.birthYearMonth, child.birth.bornOnFirst, "elementary");
  return entry === null ? null : `${entry - 3}-04`;
}

/** 保育園の通い始めの既定（エンジンの education.nurseryFee と同じ決まり）: その子の育児休業の終わりの翌月、無ければ1歳の学年の4月 */
export function nurseryDefaultStart(h: Household, child: Member): { ym: string; reason: string } {
  const children = h.members.filter((m) => m.kind === "child");
  let end: string | null = null;
  for (const p of h.employmentPeriods ?? []) {
    if (p.type !== "leave" || p.leaveKind !== "childcare" || p.to === null) continue;
    let target = p.leaveChild as string | undefined;
    if (target === undefined) {
      const start = resolveTimepoint(h, p.from);
      if (start === null) continue;
      target = children.filter((c) => c.birth.birthYearMonth <= addMonths(start, 2)).sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? 1 : -1))[0]?.id;
    }
    const to = resolveTimepoint(h, p.to);
    if (target === child.id && to !== null && (end === null || to > end)) end = to;
  }
  if (end !== null) return { ym: addMonths(end, 1), reason: "育児休業の終わりの翌月" };
  const [y, m] = child.birth.birthYearMonth.split("-").map(Number) as [number, number];
  const early = m < 4 || (m === 4 && child.birth.bornOnFirst);
  return { ym: `${y + (early ? 1 : 2)}-04`, reason: "1歳の4月" };
}

/** 進路の型（よく使う組み合わせ）。各段の公立・私立を一度に決める */
export const COURSE_PRESETS: { value: string; label: string; sectors: Record<string, string> }[] = [
  { value: "allPublic", label: "すべて公立（大学は国公立）", sectors: { kindergarten: "public", elementary: "public", juniorHigh: "public", highSchool: "public", university: "national" } },
  { value: "univPrivate", label: "大学だけ私立", sectors: { kindergarten: "public", elementary: "public", juniorHigh: "public", highSchool: "public", university: "private" } },
  { value: "highPrivate", label: "高校から私立", sectors: { kindergarten: "public", elementary: "public", juniorHigh: "public", highSchool: "private", university: "private" } },
  { value: "juniorPrivate", label: "中学から私立", sectors: { kindergarten: "private", elementary: "public", juniorHigh: "private", highSchool: "private", university: "private" } },
  { value: "allPrivate", label: "すべて私立", sectors: { kindergarten: "private", elementary: "private", juniorHigh: "private", highSchool: "private", university: "private" } },
];

export function presetOf(stages: readonly EducationStage[]): string {
  for (const p of COURSE_PRESETS) if (stages.length > 0 && stages.every((s) => p.sectors[s.stage] === undefined || p.sectors[s.stage] === s.sector)) return p.value;
  return "";
}

/** 今からの進路の初めの形: 子の年齢から、まだ終わっていない段だけ。進路の型の「大学だけ私立」（幼稚園〜高校は公立、大学は私立・文系・自宅。0010 の追記 2026-10-25） */
export function defaultStages(child: Member, baseMonth: string): EducationStage[] {
  const [by, bm] = baseMonth.split("-").map(Number) as [number, number];
  const schoolYear = bm >= 4 ? by : by - 1;
  const out: EducationStage[] = [];
  for (const stage of ["kindergarten", "elementary", "juniorHigh", "highSchool", "university"]) {
    const entry = schoolEntryYear(child.birth.birthYearMonth, child.birth.bornOnFirst, stage === "kindergarten" ? "elementary" : stage);
    if (entry === null) continue;
    const start = stage === "kindergarten" ? entry - 3 : entry;
    const years = stage === "kindergarten" ? 3 : stage === "elementary" ? 6 : stage === "university" ? 4 : 3;
    if (start + years <= schoolYear) continue;
    out.push(stage === "university" ? { stage, sector: "private", field: "humanities", living: "home" } : { stage, sector: "public" });
  }
  return out;
}

/** 標準の進路の型の名前（ボタンと推定の印に出す。入る型とずらさない） */
export function defaultCourseLabel(child: Member, baseMonth: string): string {
  const stages = defaultStages(child, baseMonth);
  const p = COURSE_PRESETS.find((x) => x.value === presetOf(stages));
  const univ = stages.some((s) => s.stage === "university");
  return p === undefined ? "公立・私立は後で選ぶ" : `${p.label}${univ ? "〔文系・自宅〕" : ""}`;
}

// ---- 学校外の費用（0062） ----

export const OUT_OF_SCHOOL_MODES = [
  { value: "statistics", label: "統計の平均で（塾・習い事・体験を含む平均）" },
  { value: "rows", label: "行で入れる（塾・習い事・その他）" },
];
const LEGACY_MODE = { value: "legacy", label: "統計の平均に行を足す（前の形）" };
export const LESSON_KINDS = [
  { value: "cram", label: "塾" },
  { value: "lesson", label: "習い事" },
  { value: "other", label: "その他" },
];

/** 学校外の費用の入れ方（入れ方の無い古い世帯で行があれば前の形 legacy） */
export function outOfSchoolModeOf(goal: Goal): "statistics" | "rows" | "legacy" {
  const e = goal.education;
  if (e?.outOfSchoolMode !== undefined) return e.outOfSchoolMode;
  return (e?.lessons ?? []).length > 0 ? "legacy" : "statistics";
}

/** 前の形の行の説明（統計の平均の上に足す） */
const LESSONS_HELP = "幼稚園〜高校の間は、統計の平均の学校外活動費（塾・習い事・家庭での学習などを含む）がすでに入っています。ここに入れた月謝は、その上に足されます";
const ROWS_HELP = "行で入れているので、この行だけで数えます（統計の平均の学校外活動費は足しません）";

const lessonAddress = (goalId: string, lessonId: string, ...rest: string[]): Address => ({ target: { object: goalId }, item: "goal.education", at: ["lessons", lessonId, ...rest] });
const statRow = (basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis } });
/** 統計の平均の行の名前（段ごと。同じ名前の行があれば作らない） */
const statLessonLabel = (stage: string) => `学校外活動費（${stageLabel(stage)}・平均）`;

/**
 * 「行で入れる」に初めて切り替えたとき: 幼稚園〜高校の段ごとに、統計の平均の学校外活動費を月額にした行（推定）を作る。
 * もう同じ名前の行がある段・学校外活動費を「無し」にした段・終わった段は作らない。段に月額を入れていればその額（確定）
 */
export function seedOutOfSchoolRows(wh: WorkingHousehold, goalId: string): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const g = (h.goals ?? []).find((x) => x.id === goalId);
    const child = h.members.find((m) => m.id === g?.owner);
    if (g?.education === undefined || child === undefined) return;
    const lessons = (g.education.lessons ??= []);
    for (const s of g.education.stages) {
      if (!isK12(s.stage) || s.outOfSchool === "none") continue;
      const label = statLessonLabel(s.stage);
      if (lessons.some((l) => l.label === label)) continue;
      const period = stagePeriod(child, s);
      const stat = stageStatistic(s);
      if (period === null || period.to < req.input.baseMonth) continue;
      const fixed = typeof s.outOfSchool === "object" ? s.outOfSchool.monthly : null;
      if (fixed === null && (stat === null || stat.outOfSchool === null)) continue;
      const id = newId();
      lessons.push({ id, from: { at: period.from }, to: { at: period.to }, monthly: fixed ?? Math.round((stat?.outOfSchool ?? 0) / 12), label, kind: "other" });
      if (fixed === null && stat !== null) putRow(req.input as unknown as Obj, lessonAddress(g.id, id, "monthly"), statRow(`${stat.basis}の学校外活動費を12で割った月額（${stageLabel(s.stage)}・${s.sector === "private" ? "私立" : "公立"}）`));
    }
    if (lessons.length === 0) delete g.education.lessons;
  });
}

function outOfSchoolGroups(wh: WorkingHousehold, goal: Goal, child: Member): GroupDef[] {
  const find = byId(goals, goal.id);
  const mode = outOfSchoolModeOf(goal);
  const lessons = goal.education?.lessons ?? [];
  const base = wh.request.input.baseMonth;
  // 今か次の幼稚園〜高校の段の統計の平均（簡易の1行）
  const now = (goal.education?.stages ?? []).filter((s) => isK12(s.stage)).find((s) => (stagePeriod(child, s)?.to ?? "") >= base);
  const nowStat = now === undefined ? null : stageStatistic(now);
  const statText = now !== undefined && nowStat?.outOfSchool != null ? `（${stageLabel(now.stage)} 年約${manText(nowStat.outOfSchool)}）` : "";
  const note =
    mode === "statistics"
      ? `学校外の費用は統計の平均${statText}で計算しています（子供の学習費調査の学校外活動費。塾・習い事・体験を含む平均）。${lessons.length > 0 ? `行 ${lessons.length}件は使っていません（「行で入れる」に戻すと使います）。` : "塾の月謝など実際の額で入れるときは「行で入れる」にします。"}`
      : mode === "rows"
        ? `学校外の費用は行 ${lessons.length}件で計算しています（統計の平均は足しません）`
        : `前の形: 統計の平均（塾・習い事を含む）に行 ${lessons.length}件を足しています。二重になっていないか確かめ、「統計の平均で」か「行で入れる」に切り替えてください`;
  const modeField: FieldDef = {
    ...field({
      key: `edu/${goal.id}/outMode`,
      item: "goal.education",
      label: "学校外の費用（塾・習い事など）の入れ方",
      level: "simple",
      kind: "select",
      options: [...OUT_OF_SCHOOL_MODES, ...(mode === "legacy" ? [LEGACY_MODE] : [])],
      structural: true,
      sideEffects: "初めて「行で入れる」にすると、段ごとに統計の平均の行（推定）を作ります。「統計の平均で」に戻しても行は残します（使いません）",
      help: "統計の平均は塾・習い事・家庭での学習などを含む平均です。塾の月謝などを実際の額で入れるときは「行で入れる」にすると、統計の平均は足しません（二重になりません）。初めて切り替えると、段ごとの統計の平均の行を作るので、塾の段だけ直せます",
      get: (w) => {
        const g = find(w.request.input.household, w) as Goal | undefined;
        const m = g === undefined ? "statistics" : outOfSchoolModeOf(g);
        return { value: m === "legacy" ? LEGACY_MODE.value : m, ...(g?.education?.outOfSchoolMode === undefined && m === "statistics" ? { implicit: true } : {}) };
      },
      set: (w, v) => {
        if (v === "rows") {
          const seeded = seedOutOfSchoolRows(w, goal.id);
          return mutate(seeded, (hh) => {
            const g = find(hh, seeded) as Goal | undefined;
            if (g?.education !== undefined) g.education.outOfSchoolMode = "rows";
          });
        }
        return mutate(w, (hh) => {
          const g = find(hh, w) as Goal | undefined;
          if (g?.education === undefined) return;
          if (v === "statistics") g.education.outOfSchoolMode = "statistics";
          else delete g.education.outOfSchoolMode;
        });
      },
    }),
    address: () => ({ target: { object: goal.id }, item: "goal.education", at: ["outOfSchoolMode"] }),
  };
  const out: GroupDef[] = [{ key: `edu/${goal.id}/out`, title: "学校外の費用（塾・習い事など）", note, level: "simple", fields: [modeField], actions: [] }];
  // 統計の平均で入れるときは、行を隠す（消さない）
  if (mode === "statistics") return out;
  const ageOf = (hh: Household) => hh.members.find((m) => m.id === child.id);
  lessons.forEach((l, i) => {
    const findL: Finder = (hh) => (getPath((hh.goals ?? []).find((g) => g.id === goal.id), ["education", "lessons", String(i)]) as Obj | undefined) ?? undefined;
    const k = `edu/${goal.id}/lesson/${i}`;
    const at = (...rest: string[]) => (l.id !== undefined ? { address: () => lessonAddress(goal.id, l.id as string, ...rest) } : {});
    const kindLabel = LESSON_KINDS.find((x) => x.value === l.kind)?.label;
    const range = [resolveTimepoint(wh.request.input.household, l.from), resolveTimepoint(wh.request.input.household, l.to)].map((x) => (x === null ? "" : formatYearMonth(x)));
    out.push({
      key: k,
      title: `${l.label ?? kindLabel ?? "塾・習い事"} 月${formatYen(l.monthly, "yen")}円（${range[0]}〜${range[1]}）`,
      ...(mode === "legacy" ? { note: "幼稚園〜高校の間は、統計の平均の学校外活動費（塾・習い事を含む）が既定で入っています。この月謝はその上に足すので、平均より多くかかる分だけを入れると二重になりません" } : {}),
      level: "detail",
      fields: [
        { ...plain({ key: `${k}/label`, item: "goal.education", label: "名前", level: "detail", kind: "text", find: findL, path: ["label"], optional: true }), ...at("label") },
        { ...plain({ key: `${k}/kind`, item: "goal.education", label: "種類", level: "detail", kind: "select", options: LESSON_KINDS, find: findL, path: ["kind"], optional: true, fallback: "cram" }), ...at("kind") },
        { ...plain({ key: `${k}/monthly`, item: "goal.education", label: "月額", level: "detail", kind: "yen", basis: "monthly", find: findL, path: ["monthly"], help: mode === "legacy" ? LESSONS_HELP : ROWS_HELP }), ...at("monthly") },
        timepointField({ key: `${k}/from`, item: "goal.education", label: "始まり", level: "detail", find: findL, path: ["from"], ageOf }),
        timepointField({ key: `${k}/to`, item: "goal.education", label: "終わり", level: "detail", find: findL, path: ["to"], startPath: ["from"], ageOf }),
      ],
      actions: [
        removeAction(`${k}/remove`, "外す", "detail", (hh) => {
          const g = find(hh, wh) as Goal | undefined;
          if (g?.education?.lessons !== undefined) {
            g.education.lessons = g.education.lessons.filter((_, j) => j !== i);
            if (g.education.lessons.length === 0) delete g.education.lessons;
          }
        }),
      ],
    });
  });
  const addLesson = (kind: "cram" | "lesson" | "other", label: string, monthly: number): ActionDef => ({
    key: `edu/${goal.id}/addLesson/${kind}`,
    label: `＋ ${label}`,
    level: "detail",
    title: mode === "legacy" ? LESSONS_HELP : ROWS_HELP,
    run: (w) =>
      mutate(w, (hh) => {
        const g = find(hh, w) as Goal | undefined;
        const b = w.request.input.baseMonth;
        if (g?.education === undefined) return;
        const lesson: EducationLesson = { id: newId(), from: { at: b }, to: { at: `${Number(b.slice(0, 4)) + 3}-03` }, monthly, label, kind };
        (g.education.lessons ??= []).push(lesson);
      }),
  });
  out.push({ key: `edu/${goal.id}/addLessons`, level: "detail", fields: [], actions: [addLesson("cram", "塾", 20000), addLesson("lesson", "習い事", 8000), addLesson("other", "その他（学校外）", 5000)] });
  return out;
}

// ---- 段ごとの費用 ----

const stageAddress = (goalId: string, stageId: string | undefined, ...rest: string[]): { address?: () => Address } =>
  stageId === undefined ? {} : { address: () => ({ target: { object: goalId }, item: "goal.education", at: ["stages", stageId, ...rest] }) };

/** 短大・専門学校の修学支援はまだ計算しない（計算エンジンの知らせは画面に出ないので、段の1行で知らせる） */
export const HIGHER_SUPPORT_NOTE = "国の修学支援（授業料等の減免・給付型奨学金）は、短大・専門学校ではまだ計算していません。受ける見込みなら、減免の後の額を年額に入れてください";
/** 専門学校の学費の未入力 */
export const VOCATIONAL_MISSING = "未入力（専門学校の学費の統計の目安はまだありません。年額を入れるまで0円で計算中）";

/** 段の見出しの下の1行（統計の平均か、入れた額） */
function stageNote(s: EducationStage): string | undefined {
  if (s.stage === "nursery") return undefined;
  const stat = stageStatistic(s);
  const parts: string[] = [];
  const school = isK12(s.stage) ? "学校の費用" : "学費";
  if (s.annualOverride !== undefined) parts.push(`${school} 年${manText(s.annualOverride)}（入れた額）`);
  else if (stat?.annual != null) parts.push(`${school} 年約${manText(stat.annual)}（統計の平均・今の値段）`);
  else if (s.stage === "vocational") parts.push("⚠ 学費が未入力です（0円で計算中）。年額を入れてください");
  if (isK12(s.stage) && stat?.outOfSchool != null && s.outOfSchool !== "none") parts.push(`学校外 年約${manText(stat.outOfSchool)}（入れ方は「学校外の費用」で）`);
  if (isHigher(s.stage) && s.stage !== "vocational") {
    const entrance = s.entranceOverride ?? stat?.entrance ?? null;
    if (entrance !== null) parts.push(`入学金 約${manText(entrance)}`);
  }
  if (isHigher(s.stage) && s.living === "away") {
    const b = boardingStatistic();
    const monthly = s.boarding?.monthly ?? (b.annual === null ? null : Math.round(b.annual / 12));
    if (monthly !== null) parts.push(`仕送り 月${manText(monthly)}${s.boarding?.monthly === undefined ? "（推定）" : ""}`);
  }
  const notes = [parts.join("・")];
  if (stat?.note != null) notes.push(stat.note);
  if (s.stage === "juniorCollege" || s.stage === "vocational") notes.push(HIGHER_SUPPORT_NOTE);
  return notes.filter((x) => x !== "").join("。");
}

function stageFields(goalId: string, i: number, s: EducationStage, nurseryStart: string): FieldDef[] {
  const find: Finder = (h) => (getPath((h.goals ?? []).find((g) => g.id === goalId), ["education", "stages", String(i)]) as Obj | undefined) ?? undefined;
  const key = `edu/${goalId}/stage/${i}`;
  const higher = isHigher(s.stage);
  const sid = typeof s.id === "string" ? s.id : undefined;
  const sectorOptions = s.stage === "nursery" ? [] : s.stage === "university" ? SECTORS : SECTORS.filter((o) => o.value !== "national" || s.stage === "elementary" || s.stage === "juniorHigh" || s.stage === "highSchool");
  const fields: FieldDef[] = [];
  if (s.stage === "nursery") {
    fields.push(
      timepointField({
        key: `${key}/from`,
        item: "goal.education",
        label: "通い始める時期",
        level: "simple",
        find,
        path: ["from"],
        ageOf: (h) => h.members.find((m) => m.id === (h.goals ?? []).find((g) => g.id === goalId)?.owner),
        optional: true,
        absentWhenEmpty: true,
        nullText: `空欄: ${nurseryStart}`,
        help: "空欄なら、その子の育児休業の終わりの翌月（育児休業を入れていなければ1歳の学年の4月）から。「1歳の4月」のように子の年齢でも入れられます",
      }),
      plain({
        key: `${key}/monthly`,
        item: "goal.education",
        label: "保育料（月額）",
        level: "detail",
        kind: "yen",
        basis: "monthly",
        find,
        path: ["monthly"],
        optional: true,
        hint: (v) => (v === null ? "推定あり: 世帯の収入（住民税の所得割）から自動で計算（国の基準 × 自治体の水準の割合。目安）" : v === 0 ? "保育料なし（自治体の無償化など）" : null),
        help: "自治体の保育料表の額が分かれば入れてください。0 なら保育料なし。3歳からの無償化は自動で計算します",
      }),
      plain({ key: `${key}/hours`, item: "goal.education", label: "保育の時間", level: "detail", kind: "select", options: NURSERY_HOURS, find, path: ["hours"], optional: true, fallback: "standard", help: "共働きなどのフルタイムは保育標準時間（11時間まで）、短時間勤務などは保育短時間（8時間まで）" }),
      plain({ key: `${key}/feeRatio`, item: "goal.education", label: "国の基準に対する自治体の水準", level: "detail", kind: "pct", find, path: ["feeRatio"], optional: true, fallback: "0.8", help: "自動の計算で国の基準の上限に掛ける割合（目安 80%）。多くの自治体は国の基準より低い保育料にしています。自治体の保育料表に合わせて変えられます" }),
    );
    return fields;
  }
  fields.push(plain({ key: `${key}/sector`, item: "goal.education", label: "公立・私立", level: "simple", kind: "select", options: sectorOptions, find, path: ["sector"], optional: true, fallback: "public" }));
  if (s.stage === "university") fields.push(plain({ key: `${key}/field`, item: "goal.education", label: "系統", level: "simple", kind: "select", options: FIELDS, find, path: ["field"], optional: true, fallback: "humanities" }));
  if (higher) fields.push(plain({ key: `${key}/living`, item: "goal.education", label: "通い方", level: "simple", kind: "select", options: LIVING_PLACE, find, path: ["living"], optional: true, fallback: "home" }));
  // 学費の年額（上書き）。専門学校は統計の目安が無いので簡易で未入力の警告、公立の短大も簡易（私立の短大の平均で仮に計算）
  const stat = stageStatistic(s);
  const simpleAnnual = s.stage === "vocational" || (s.stage === "juniorCollege" && (s.sector ?? "public") !== "private");
  const annual = plain({
    key: `${key}/annual`,
    item: "goal.education",
    label: isK12(s.stage) ? "学校の費用の年額（上書き）" : "学費の年額（授業料＋施設設備費。上書き）",
    level: simpleAnnual ? "simple" : "detail",
    kind: "yen",
    basis: "annual",
    find,
    path: ["annualOverride"],
    optional: true,
    hint: (v) =>
      v !== null
        ? "入れた年額で計算します（今の値段。将来は教育費の上昇率で伸びます）。学校の種類を変えたときは、前の学校の値のままでないか確かめてください"
        : stat?.annual != null
          ? `空欄: 統計の平均 年${manText(stat.annual)}（${stat.basis}）`
          : null,
    help: isK12(s.stage) ? "学校教育費（授業料・学用品・通学など）と学校給食費の年額。学校外活動費（塾・習い事）は含めません" : "授業料と施設設備費の年額（入学金は別）。志望校の学費が分かれば入れてください",
  });
  fields.push({
    ...annual,
    ...stageAddress(goalId, sid, "annualOverride"),
    ...(s.stage === "vocational"
      ? {
          get: (wh: WorkingHousehold) => {
            const st = annual.get(wh);
            return st.value === null ? { ...st, estimated: VOCATIONAL_MISSING } : st;
          },
        }
      : {}),
  });
  fields.push({
    ...plain({
      key: `${key}/entrance`,
      item: "goal.education",
      label: "入学金（上書き）",
      level: "detail",
      kind: "yen",
      basis: "once",
      find,
      path: ["entranceOverride"],
      optional: true,
      hint: (v) => (v === null && stat?.entrance != null ? `空欄: 統計の平均 ${manText(stat.entrance)}` : v === null && isK12(s.stage) ? "空欄: 入学金なし（統計の学習費総額に含めて数えています）" : null),
    }),
    ...stageAddress(goalId, sid, "entranceOverride"),
  });
  fields.push(
    field({
      key: `${key}/school`,
      item: "goal.education",
      label: "学校名",
      level: "detail",
      kind: "select",
      options: [{ value: "", label: "学校未定（平均で計算）" }],
      help: "学校名からの学費の検索は、学校のデータを同梱してから使えます。今は進路の型と統計の平均で計算します",
      readOnly: "学校のデータを同梱してから選べます",
      get: (w) => ({ value: "", hint: getPath(find(w.request.input.household, w), ["school"]) !== undefined ? "学費データの行が入っています" : null }),
      set: (w) => w,
    }),
    plain({ key: `${key}/years`, item: "goal.education", label: "在学年数", level: "detail", kind: "int", suffix: "年", min: 1, max: 6, find, path: ["years"], optional: true, help: "空欄なら学校の種類の標準" }),
  );
  if (higher) {
    fields.push(
      plain({ key: `${key}/delay`, item: "goal.education", label: "浪人の年数", level: "detail", kind: "int", suffix: "年", min: 0, max: 5, find, path: ["delayYears"], optional: true, fallback: 0 }),
      plain({ key: `${key}/exam`, item: "goal.education", label: "受験・併願の費用", level: "detail", kind: "yen", basis: "once", find, path: ["exam", "amount"], optional: true }),
    );
    if (s.living === "away") {
      const b = boardingStatistic();
      fields.push(
        {
          ...plain({ key: `${key}/boarding/monthly`, item: "goal.education", label: "自宅外の仕送り（月額）", level: "detail", kind: "yen", basis: "monthly", find, path: ["boarding", "monthly"], optional: true, hint: (v) => (v === null && b.annual !== null ? `空欄: 統計の平均 月${manText(Math.round(b.annual / 12))}（${b.basis}）` : null), help: "家賃・食費など、親が出す仕送りの月額。在学中は毎月かかります" }),
          ...stageAddress(goalId, sid, "boarding", "monthly"),
        },
        {
          ...plain({ key: `${key}/boarding/initial`, item: "goal.education", label: "自宅外の初期費用", level: "detail", kind: "yen", basis: "once", find, path: ["boarding", "initial"], optional: true, hint: (v) => (v === null && b.initial !== null ? `空欄: 統計の平均 ${manText(b.initial)}` : null), help: "敷金・家具など、自宅外で暮らし始める費用（入学の前の月）" }),
          ...stageAddress(goalId, sid, "boarding", "initial"),
        },
      );
    }
  }
  if (s.stage === "university")
    fields.push({
      ...plain({ key: `${key}/sciAgri`, item: "goal.education", label: "理工農系（修学支援の対象の学部）", level: "detail", kind: "bool", find, path: ["scienceAgriculture"], optional: true, fallback: false, help: "国の修学支援で、多子世帯でない第IV区分の授業料の減免は理工農系の学部だけが対象です。理系の多くは対象です" }),
      ...stageAddress(goalId, sid, "scienceAgriculture"),
    });
  return fields;
}

/** 高校のあとの進路（大学・短大・専門学校・行かない） */
const HIGHER_OPTIONS = [
  { value: "university", label: "大学" },
  { value: "juniorCollege", label: "短大" },
  { value: "vocational", label: "専門学校" },
  { value: "none", label: "大学などに行かない" },
];
/** 高校のあとの段を置き換える: 通い方・浪人・受験・仕送り・年額の上書きは同じ意味の欄なので引き継ぐ（系統は大学だけ。在学年数・学校は引き継がない） */
export function replaceHigher(stages: readonly EducationStage[], v: string): EducationStage[] {
  const cur = stages.find((s) => isHigher(s.stage));
  const rest = stages.filter((s) => !isHigher(s.stage));
  if (v === "none") return rest;
  if (cur?.stage === v) return [...stages];
  const { stage: _stage, field: f, sector, years: _years, school: _school, id: _id, ...carry } = cur ?? ({ stage: "university" } as EducationStage);
  const next: EducationStage = {
    ...carry,
    id: newId(),
    stage: v,
    sector: v === "university" ? (sector === "national" || sector === "public" || sector === "private" ? sector : "private") : sector === "public" && v === "juniorCollege" ? "public" : "private",
    ...(v === "university" ? { field: f ?? "humanities" } : {}),
    living: cur?.living ?? "home",
  };
  return [...rest, next].sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage));
}

// ---- 奨学金・教育ローン ----

const yearsField = (key: string, label: string, find: Finder, max: number, address?: () => Address): FieldDef => ({
  ...field({
    key,
    item: "goal.education",
    label,
    level: "detail",
    kind: "int",
    suffix: "年",
    min: 1,
    max,
    get: (w) => {
      const m = getPath(find(w.request.input.household, w), ["termMonths"]);
      return { value: typeof m === "number" ? Math.round((m / 12) * 10) / 10 : null };
    },
    set: (w, v) =>
      mutate(w, (h, req) => {
        const t = find(h, { ...w, request: req });
        if (t !== undefined && typeof v === "number") t.termMonths = Math.round(v * 12);
      }),
  }),
  ...(address !== undefined ? { address } : {}),
});

/** 足したときのひな形の値（推定）。日本学生支援機構・日本政策金融公庫の公表の条件は原本で確かめる前の目安 */
export const SCHOLARSHIP_BASIS = presetBasis("貸与の奨学金 月5万円・在学中・返す人は子・20年で返す・利率は仮の値");
export const LOAN_BASIS = presetBasis("教育ローン 200万円・入学の前の1月・15年で返す・金利は仮の値");

const estimatedRowAt = (input: Obj, goalId: string, list: string, id: string, keys: readonly string[], basis: string) => {
  for (const f of keys) putRow(input, { target: { object: goalId }, item: "goal.education", at: [list, id, f] }, { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis } });
};

function scholarshipGroups(goal: Goal, child: Member): GroupDef[] {
  const ageOf = (hh: Household) => hh.members.find((m) => m.id === child.id);
  return (goal.education?.scholarships ?? []).map((s, i) => {
    const sid = s.id ?? `n${i}`;
    const find: Finder = (hh) => (getPath((hh.goals ?? []).find((g) => g.id === goal.id), ["education", "scholarships", String(i)]) as Obj | undefined) ?? undefined;
    const k = `edu/${goal.id}/scholar/${sid}`;
    const addr = (f: string): (() => Address) | undefined => (s.id !== undefined ? () => ({ target: { object: goal.id }, item: "goal.education", at: ["scholarships", s.id as string, f] }) : undefined);
    const at = (f: string) => {
      const a = addr(f);
      return a !== undefined ? { address: a } : {};
    };
    return {
      key: k,
      title: `貸与の奨学金 月${formatYen(s.monthly, "yen")}円`,
      note: "在学中に受け取り（入るお金）、卒業の後に返します。返す人が子なら、子の返済は世帯の支出に入れません",
      level: "detail",
      fields: [
        { ...plain({ key: `${k}/monthly`, item: "goal.education", label: "月額", level: "detail", kind: "yen", basis: "monthly", find, path: ["monthly"] }), ...at("monthly") },
        timepointField({ key: `${k}/from`, item: "goal.education", label: "受け取る期間の始まり", level: "detail", find, path: ["from"], ageOf }),
        timepointField({ key: `${k}/to`, item: "goal.education", label: "受け取る期間の終わり", level: "detail", find, path: ["to"], startPath: ["from"], ageOf }),
        { ...plain({ key: `${k}/rate`, item: "goal.education", label: "利率（年）", level: "detail", kind: "pct", find, path: ["rate"] }), ...at("rate") },
        yearsField(`${k}/term`, "返す年数", find, 30, addr("termMonths")),
        timepointField({ key: `${k}/repay`, item: "goal.education", label: "返し始め", level: "detail", find, path: ["repaymentStart"], ageOf, optional: true, absentWhenEmpty: true, nullText: "空欄: 受け取りの終わりの7か月後" }),
        plain({ key: `${k}/debtor`, item: "goal.education", label: "返す人", level: "detail", kind: "select", options: [{ value: "child", label: "子" }, { value: "parent", label: "親" }], find, path: ["debtor"], optional: true, fallback: "child" }),
      ],
      actions: [
        removeAction(`${k}/remove`, "外す", "detail", (hh) => {
          const g = (hh.goals ?? []).find((x) => x.id === goal.id);
          if (g?.education?.scholarships !== undefined) {
            g.education.scholarships = g.education.scholarships.filter((_, j) => j !== i);
            if (g.education.scholarships.length === 0) delete g.education.scholarships;
          }
        }),
      ],
    };
  });
}

function loanGroups(wh: WorkingHousehold, goal: Goal): GroupDef[] {
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  const ageOf = (hh: Household) => hh.members.find((m) => m.id === self?.id);
  return (goal.education?.loans ?? []).map((l, i) => {
    const lid = l.id ?? `n${i}`;
    const find: Finder = (hh) => (getPath((hh.goals ?? []).find((g) => g.id === goal.id), ["education", "loans", String(i)]) as Obj | undefined) ?? undefined;
    const k = `edu/${goal.id}/loan/${lid}`;
    const addr = (f: string): (() => Address) | undefined => (l.id !== undefined ? () => ({ target: { object: goal.id }, item: "goal.education", at: ["loans", l.id as string, f] }) : undefined);
    const at = (f: string) => {
      const a = addr(f);
      return a !== undefined ? { address: a } : {};
    };
    return {
      key: k,
      title: `教育ローン ${manText(l.amount)}`,
      note: "借りた月に入金になり、翌月から返します",
      level: "detail",
      fields: [
        timepointField({ key: `${k}/at`, item: "goal.education", label: "借りる時期", level: "detail", find, path: ["at"], ageOf }),
        { ...plain({ key: `${k}/amount`, item: "goal.education", label: "借りる額", level: "detail", kind: "yen", basis: "once", find, path: ["amount"] }), ...at("amount") },
        { ...plain({ key: `${k}/rate`, item: "goal.education", label: "金利（年）", level: "detail", kind: "pct", find, path: ["rate"] }), ...at("rate") },
        yearsField(`${k}/term`, "返す年数", find, 25, addr("termMonths")),
        plain({ key: `${k}/borrower`, item: "goal.education", label: "借りる人", level: "detail", kind: "select", options: memberOptions(wh, (m) => m.kind === "self" || m.kind === "spouse"), find, path: ["borrower"] }),
      ],
      actions: [
        removeAction(`${k}/remove`, "外す", "detail", (hh) => {
          const g = (hh.goals ?? []).find((x) => x.id === goal.id);
          if (g?.education?.loans !== undefined) {
            g.education.loans = g.education.loans.filter((_, j) => j !== i);
            if (g.education.loans.length === 0) delete g.education.loans;
          }
        }),
      ],
    };
  });
}

/** 大学などの段の期間（無ければ子の18歳の学年の4月から4年） */
function higherPeriod(goal: Goal | undefined, child: Member): { from: string; to: string } {
  const st = (goal?.education?.stages ?? []).find((s) => isHigher(s.stage));
  const p = stagePeriod(child, st ?? { stage: "university" });
  const y = Number(child.birth.birthYearMonth.slice(0, 4));
  return p ?? { from: `${y + 19}-04`, to: `${y + 23}-03` };
}

/** 貸与の奨学金を足す（ひな形の値は推定） */
export function addScholarship(wh: WorkingHousehold, goalId: string, id: string = newId()): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const g = (h.goals ?? []).find((x) => x.id === goalId);
    const child = h.members.find((m) => m.id === g?.owner);
    if (g?.education === undefined || child === undefined) return;
    const p = higherPeriod(g, child);
    const s: EducationScholarship = { id, monthly: 50000, from: { at: p.from }, to: { at: p.to }, rate: "0.01", termMonths: 240, debtor: "child" };
    (g.education.scholarships ??= []).push(s);
    estimatedRowAt(req.input as unknown as Obj, g.id, "scholarships", id, ["monthly", "rate", "termMonths"], SCHOLARSHIP_BASIS);
  });
}

/** 教育ローンを足す（入学の前の1月に本人が借りる。ひな形の値は推定） */
export function addEducationLoan(wh: WorkingHousehold, goalId: string, id: string = newId()): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const g = (h.goals ?? []).find((x) => x.id === goalId);
    const child = h.members.find((m) => m.id === g?.owner);
    const self = h.members.find((m) => m.kind === "self");
    if (g?.education === undefined || child === undefined || self === undefined) return;
    const p = higherPeriod(g, child);
    const l: EducationLoan = { id, at: { at: addMonths(p.from, -3) }, amount: 2000000, rate: "0.025", termMonths: 180, borrower: self.id };
    (g.education.loans ??= []).push(l);
    estimatedRowAt(req.input as unknown as Obj, g.id, "loans", id, ["amount", "rate", "termMonths"], LOAN_BASIS);
  });
}

// ---- この子のお金の行（0044） ----

/** 教育のお金の行の子（入るお金は受け取る人か時期の年齢の子、出るお金は時期の年齢の子）。子を決めていなければ null */
export function educationRowChild(h: Household, r: { dir: "in" | "out"; kind?: string; from: Timepoint; recipient?: string; counterparty?: string }): string | null {
  const isChild = (id: string | undefined): id is string => id !== undefined && h.members.some((m) => m.id === id && m.kind === "child");
  const age = r.from.memberAge?.member;
  if (r.dir === "in") {
    if (incomeCard({ kind: r.kind as IncomeFlowKind }) !== "education") return null;
    return isChild(r.recipient) ? r.recipient : isChild(age) ? age : null;
  }
  const p = r as unknown as PeriodicExpense;
  if (expenseCard(h, p) === "education") return isChild(age) ? age : null;
  return childOfPeriodic(h, p);
}

const childIncomes = (h: Household, childId: string): IncomeFlow[] => (h.incomeFlows ?? []).filter((f) => educationRowChild(h, { ...f, dir: "in" }) === childId);
const childExpenses = (h: Household, childId: string): PeriodicExpense[] => (h.periodicExpenses ?? []).filter((p) => educationRowChild(h, { ...p, dir: "out" }) === childId);

/** この子の入るお金を足す（受け取る人はその子。時期は大学などの在学の期間。額は未入力） */
export function addChildIncome(wh: WorkingHousehold, childId: string, kind: "educationSupport" | "scholarshipGrant" | "childPays", id: string = newId()): WorkingHousehold {
  const next = addIncome(wh, kind, id);
  return mutate(next, (h) => {
    const f = (h.incomeFlows ?? []).find((x) => x.id === id);
    const child = h.members.find((m) => m.id === childId);
    if (f === undefined || child === undefined) return;
    const p = higherPeriod((h.goals ?? []).find((x) => x.kind === "education" && x.owner === childId), child);
    f.recipient = childId;
    f.from = { at: p.from };
    f.to = { at: kind === "childPays" ? p.to : addMonths(p.to, -11) };
    f.everyYears = 1;
    if (kind === "childPays") f.monthly = true;
    else delete f.monthly;
  });
}

/** この子の出るお金を足す: 留学（1回。20歳。目安の額は推定）か、その他の教育費（寮費・部活など。毎年） */
export function addChildExpense(wh: WorkingHousehold, childId: string, what: "abroad" | "other", id: string = newId()): WorkingHousehold {
  return mutate(wh, (h) => {
    const child = h.members.find((m) => m.id === childId);
    if (child === undefined) return;
    const base = wh.request.input.baseMonth;
    const ageNow = Number(base.slice(0, 4)) - Number(child.birth.birthYearMonth.slice(0, 4));
    const at20 = { memberAge: { member: childId, years: Math.max(20, ageNow + 1) } };
    const p: PeriodicExpense =
      what === "abroad"
        ? { id, label: "留学", kind: "education", row: "cf.expense.education", from: at20, to: structuredClone(at20), everyYears: 1, amount: standardBox(3500000, presetBasis("留学 350万円")) }
        : {
            id,
            label: "その他の教育費（寮費・部活など）",
            kind: "education",
            row: "cf.expense.education",
            from: { memberAge: { member: childId, years: Math.max(12, ageNow + 1) } },
            to: { memberAge: { member: childId, years: Math.max(18, ageNow + 2) } },
            everyYears: 1,
            amount: standardBox(100000, presetBasis("その他の教育費 年10万円")),
          };
    (h.periodicExpenses ??= []).push(p);
  });
}

function childMoneyGroups(wh: WorkingHousehold, child: Member): { groups: GroupDef[]; actions: ActionDef[] } {
  const h = wh.request.input.household;
  const groups: GroupDef[] = [...childIncomes(h, child.id).flatMap((f) => incomeGroups(wh, f, "education")), ...childExpenses(h, child.id).flatMap((p) => periodicGroups(wh, p))];
  const k = `edu/${child.id}/money`;
  const actions: ActionDef[] = [
    { key: `${k}/in/educationSupport`, label: "＋ 教育資金の援助を受ける（祖父母など）", level: "simple", run: (w) => addChildIncome(w, child.id, "educationSupport") },
    { key: `${k}/in/scholarshipGrant`, label: "＋ 給付型の奨学金・学費の助成（額で）", level: "detail", run: (w) => addChildIncome(w, child.id, "scholarshipGrant") },
    { key: `${k}/in/childPays`, label: "＋ 子が払う分（アルバイト・子の貯金から学費に）", level: "detail", run: (w) => addChildIncome(w, child.id, "childPays") },
    { key: `${k}/out/abroad`, label: "＋ 留学", level: "simple", run: (w) => addChildExpense(w, child.id, "abroad") },
    { key: `${k}/out/other`, label: "＋ その他の教育費（寮費・部活など）", level: "detail", run: (w) => addChildExpense(w, child.id, "other") },
  ];
  return { groups, actions };
}

/** この子の教育費を入れない（段の無い進路と、該当なしの行。前の進路の段は外す） */
export function educationNotApplicable(wh: WorkingHousehold, childId: string): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const goal = (h.goals ?? []).find((g) => g.kind === "education" && g.owner === childId);
    const id = goal?.id ?? newId();
    if (goal === undefined) (h.goals ??= []).push({ id, kind: "education", owner: childId, education: { stages: [] } });
    else if (goal.education !== undefined) goal.education.stages = [];
    else goal.education = { stages: [] };
    putRow(req.input as unknown as Obj, educationStagesAddress(id), { state: "notApplicable", origin: { kind: "manual" } });
  });
}

// ---- 子ごとの区画 ----

function leavesLine(wh: WorkingHousehold, child: Member): FieldDef[] {
  const ym = child.leaves === null ? null : resolveTimepoint(wh.request.input.household, child.leaves);
  if (ym === null) return [];
  const by = Number(child.birth.birthYearMonth.slice(0, 4));
  return [readLine(`edu/${child.id}/leaves`, "独立の時期", `${Number(ym.slice(0, 4)) - by}歳ごろ（${formatYearMonth(ym)}）`, "家族")];
}

function giftGroups(wh: WorkingHousehold, goal: Goal, child: Member, who: string): GroupDef[] {
  const find = byId(goals, goal.id);
  return (goal.education?.gifts ?? []).map((gift, i) => {
    const findG: Finder = (hh) => (getPath((hh.goals ?? []).find((g) => g.id === goal.id), ["education", "gifts", String(i)]) as Obj | undefined) ?? undefined;
    const k = `edu/${goal.id}/gift/${i}`;
    return {
      key: k,
      title: `${who}への援助 ${i + 1}（結婚・住宅資金など。相続・贈与のカードにも出ます）`,
      note: gift.donor !== undefined ? "贈与する人から出すので、援助の額を世帯から出しません" : undefined,
      level: "simple",
      fields: [
        plain({ key: `${k}/purpose`, item: "goal.education", label: "使い道", level: "simple", kind: "select", options: GIFT_PURPOSES, find: findG, path: ["purpose"] }),
        plain({ key: `${k}/amount`, item: "goal.education", label: "額", level: "simple", kind: "yen", basis: "once", find: findG, path: ["amount"] }),
        timepointField({ key: `${k}/at`, item: "goal.education", label: "時期", level: "simple", find: findG, path: ["at"], ageOf: (hh) => hh.members.find((m) => m.id === child.id) }),
        plain({ key: `${k}/donor`, item: "goal.education", label: "贈与する人", level: "simple", kind: "select", options: donorOptions(wh), find: findG, path: ["donor"], optional: true, fallback: "", help: "家族の段階で登録した親・祖父母から選びます" }),
        plain({ key: `${k}/payer`, item: "goal.education", label: "出す人（世帯の中）", level: "detail", kind: "select", options: [{ value: "", label: "指定しない" }, ...memberOptions(wh, (m) => m.kind === "self" || m.kind === "spouse")], find: findG, path: ["payer"], optional: true, fallback: "" }),
        plain({ key: `${k}/tax`, item: "goal.education", label: "贈与税の課税方法", level: "detail", kind: "select", options: TAX_METHODS, find: findG, path: ["taxMethod"], optional: true, fallback: "calendar" }),
        plain({ key: `${k}/exempt`, item: "goal.education", label: "住宅資金の非課税", level: "detail", kind: "select", options: HOUSING_EXEMPTION, find: findG, path: ["housingExemption"], optional: true, fallback: "none" }),
      ],
      actions: [
        removeAction(`${k}/remove`, "外す", "simple", (hh) => {
          const g = find(hh, wh) as Goal | undefined;
          if (g?.education?.gifts !== undefined) {
            g.education.gifts = g.education.gifts.filter((_, j) => j !== i);
            if (g.education.gifts.length === 0) delete g.education.gifts;
          }
        }),
      ],
    };
  });
}

function childSection(wh: WorkingHousehold, child: Member): SectionDef {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const goal = (h.goals ?? []).find((g) => g.kind === "education" && g.owner === child.id);
  const who = memberLabel(wh, child.id);
  const money = childMoneyGroups(wh, child);
  const noneAction: ActionDef = { key: `edu/${child.id}/none`, label: "この子の教育費を入れない（該当なし）", level: "detail", run: (w) => educationNotApplicable(w, child.id) };
  if (goal === undefined) {
    const course = defaultCourseLabel(child, base);
    const has = defaultStages(child, base).length > 0;
    const leaves = readGroup(`edu/${child.id}/read`, undefined, leavesLine(wh, child));
    return {
      key: `edu/${child.id}`,
      title: who,
      note: has ? `未入力（教育費0円で計算中）。進路が入っていません。「推定の進路で埋める」で標準の型「${course}」を推定で入れます` : "これからの学校の段が無い年齢です（教育費は計算していません）",
      level: "simple",
      groups: [...(leaves !== null ? [leaves] : []), ...money.groups],
      actions: [
        // ボタンの名前は、入る進路の型の名前から作る（名前と入る型をずらさない）
        ...(has ? [{ key: `edu/${child.id}/add`, label: `推定の進路で埋める（${course}）`, level: "simple" as const, run: (w: WorkingHousehold) => fillEducation(w, child.id) }] : []),
        noneAction,
        ...money.actions,
      ],
    };
  }
  const stages = goal.education?.stages ?? [];
  const find = byId(goals, goal.id);
  // 保育園の年齢（3歳になった後の最初の4月より前）が計算の期間にあれば、簡易でも「保育園に通う」を聞く
  const free = nurseryFreeMonth(child);
  const nurseryAge = stages.some((s) => s.stage === "nursery") || (free !== null && free > base);
  const nurseryToggle = field({
    key: `edu/${goal.id}/nursery`,
    item: "goal.education",
    label: "保育園に通う",
    level: "simple",
    kind: "bool",
    structural: true,
    help: "はいにすると、保育料（0〜2歳）を世帯の収入から自動で計算します（目安）。3歳からは無償化で0円",
    get: (w) => ({ value: (((find(w.request.input.household, w) as Goal | undefined)?.education?.stages ?? []) as EducationStage[]).some((s) => s.stage === "nursery") }),
    set: (w, v) =>
      mutate(w, (hh) => {
        const g = find(hh, w) as Goal | undefined;
        if (g?.education === undefined) return;
        const has = g.education.stages.some((s) => s.stage === "nursery");
        if (v === true && !has) g.education.stages = [{ id: newId(), stage: "nursery" }, ...g.education.stages];
        if (v !== true && has) g.education.stages = g.education.stages.filter((s) => s.stage !== "nursery");
      }),
  });
  const course = field({
    key: `edu/${goal.id}/preset`,
    item: "goal.education",
    label: "進路の型",
    level: "simple",
    kind: "select",
    options: [{ value: "", label: "自分で選ぶ（下の各段）" }, ...COURSE_PRESETS.map((p) => ({ value: p.value, label: p.label }))],
    structural: true,
    // 進路の推定・該当なしの印（値の状態の行）は、進路の段の並び全体に付く（fill.ts）
    address: () => educationStagesAddress(goal.id),
    get: (w) => ({ value: presetOf(((find(w.request.input.household, w) as Goal | undefined)?.education?.stages ?? []) as EducationStage[]) }),
    set: (w, v) =>
      mutate(w, (hh) => {
        const p = COURSE_PRESETS.find((x) => x.value === v);
        const g = find(hh, w) as Goal | undefined;
        if (p === undefined || g?.education === undefined) return;
        for (const s of g.education.stages) if (p.sectors[s.stage] !== undefined) s.sector = p.sectors[s.stage];
      }),
  });
  const higher = field({
    key: `edu/${goal.id}/higher`,
    item: "goal.education",
    label: "高校のあとの進路",
    level: "simple",
    kind: "select",
    options: HIGHER_OPTIONS,
    structural: true,
    help: "大学・短大・専門学校を選び直すと、通い方・浪人・仕送り・年額の上書きを引き継ぎます。専門学校は統計の目安が無いので、年額を入れてください",
    get: (w) => ({ value: (((find(w.request.input.household, w) as Goal | undefined)?.education?.stages ?? []) as EducationStage[]).find((s) => isHigher(s.stage))?.stage ?? "none" }),
    set: (w, v) =>
      mutate(w, (hh) => {
        const g = find(hh, w) as Goal | undefined;
        if (g?.education !== undefined && typeof v === "string") g.education.stages = replaceHigher(g.education.stages, v);
      }),
  });
  const row = rowAt(wh.request.input as unknown as Record<string, unknown>, educationStagesAddress(goal.id));
  const hasHigh = stages.some((s) => s.stage === "highSchool");
  const groups: GroupDef[] = [
    {
      key: `edu/${goal.id}`,
      title: `${who}の進路`,
      ...(row?.state === "notApplicable"
        ? { note: "教育費は「該当なし」にしています（段を足すと計算します）" }
        : row?.state === "estimated"
          ? { note: `進路は${row.estimate?.basis === EDUCATION_BASIS ? `標準の型「${defaultCourseLabel(child, base)}」` : "標準の型"}（推定）で入れています。直すか、このままでよければ「✓ この値で確定」を押します` }
          : {}),
      level: "simple",
      fields: [
        course,
        ...(row?.state === "notApplicable" ? [] : [higher]),
        ...(nurseryAge ? [nurseryToggle] : []),
        ...leavesLine(wh, child),
        plain({ key: `edu/${goal.id}/allowance`, item: "goal.education", label: "児童手当を計算する", level: "detail", kind: "bool", find, path: ["education", "childAllowance"], optional: true, fallback: true }),
        ...(hasHigh
          ? [
              plain({
                key: `edu/${goal.id}/highSchoolSupport`,
                item: "goal.education",
                label: "高校の就学支援金",
                level: "detail",
                kind: "select",
                options: [
                  { value: "", label: "対象（制度どおり）" },
                  { value: "ineligible", label: "対象外（国籍・在留資格の要件など）" },
                ],
                find,
                path: ["education", "highSchoolSupport"],
                optional: true,
                fallback: "",
                help: "高校の授業料の支援（2026年度から所得の制限なし）。対象外にすると支援を計算しません",
              }),
            ]
          : []),
        plain({ key: `edu/${goal.id}/lunch`, item: "goal.education", label: "公立の小学校・中学校の給食費", level: "detail", kind: "select", options: SCHOOL_LUNCH, find, path: ["education", "schoolLunch"], optional: true, fallback: "", help: "制度どおりは、令和8年度から公立小学校の給食費を国の負担軽減の基準額（月5,200円×11か月）まで差し引きます（中学校は国の制度が決まっていないので差し引きません）。お住まいの自治体が給食費を無償にしていれば「なし」" }),
      ],
      actions: [removeAction(`edu/${goal.id}/remove`, "進路を外す", "detail", (hh) => void (hh.goals = (hh.goals ?? []).filter((g) => g.id !== goal.id))), ...(row?.state === "notApplicable" ? [] : [noneAction])],
    },
  ];
  const start = nurseryDefaultStart(h, child);
  stages.forEach((s, i) => {
    const entryAge = STAGE_AGE[s.stage];
    const note =
      s.stage !== "nursery"
        ? stageNote(s)
        : s.monthly === undefined
          ? `保育料は世帯の収入（住民税の所得割）から自動で計算します（目安。推定あり）。月額・保育の時間・自治体の水準は「詳細」で変えられます。${free !== null ? `${free.slice(0, 4)}年4月からは無償化で0円。` : ""}`
          : s.monthly === 0
            ? "保育料なし（月額 0 円を入れています）"
            : `保育料は入力した月額（${formatYen(s.monthly, "yen")}円）で計算します。空欄にすると収入から自動で計算します`;
    groups.push({
      key: `edu/${goal.id}/stage/${i}`,
      title: `${stageLabel(s.stage)}${entryAge !== undefined ? `（${entryAge}歳から）` : ""}`,
      ...(note !== undefined && note !== "" ? { note } : {}),
      level: "simple",
      fields: stageFields(goal.id, i, s, `${start.ym}（${start.reason}）`),
      actions: [
        removeAction(`edu/${goal.id}/stage/${i}/remove`, s.stage === "university" ? "大学に行かない" : "この段を外す", "simple", (hh) => {
          const g = find(hh, wh) as Goal | undefined;
          if (g?.education !== undefined) g.education.stages = g.education.stages.filter((_, j) => j !== i);
        }),
      ],
    });
  });
  const have = new Set(stages.map((s) => s.stage));
  const addActions: ActionDef[] = SCHOOL_STAGES.filter((o) => !have.has(o.value) && !(isHigher(o.value) && stages.some((s) => isHigher(s.stage)))).map((o) => ({
    key: `edu/${goal.id}/addStage/${o.value}`,
    label: `＋ ${o.label}`,
    level: o.value === "university" || o.value === "highSchool" ? "simple" : "detail",
    run: (w) =>
      mutate(w, (hh) => {
        const g = find(hh, w) as Goal | undefined;
        if (g?.education === undefined) return;
        const st: EducationStage = o.value === "university" ? { stage: o.value, sector: "private", field: "humanities", living: "home" } : o.value === "nursery" ? { stage: o.value } : { stage: o.value, sector: o.value === "juniorCollege" || o.value === "vocational" ? "private" : "public" };
        g.education.stages = [...g.education.stages, { id: newId(), ...st }].sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage));
      }),
  }));
  groups.push({ key: `edu/${goal.id}/addStages`, level: "simple", fields: [], actions: addActions });

  // 学校外の費用（入れ方と行）
  groups.push(...outOfSchoolGroups(wh, goal, child));

  // 奨学金・教育ローン
  const scholar = scholarshipGroups(goal, child);
  const loans = loanGroups(wh, goal);
  groups.push(...scholar, ...loans, {
    key: `edu/${goal.id}/finance`,
    ...(scholar.length + loans.length === 0 ? { title: "奨学金・教育ローン（まだありません）" } : {}),
    level: "detail",
    fields: [],
    actions: [
      { key: `edu/${goal.id}/addScholarship`, label: "＋ 貸与の奨学金", level: "detail", run: (w) => addScholarship(w, goal.id) },
      { key: `edu/${goal.id}/addLoan`, label: "＋ 教育ローン", level: "detail", run: (w) => addEducationLoan(w, goal.id) },
    ],
  });

  // この子の入るお金・出るお金（0044）と、子への援助（あげる側。物は今の形のまま）
  groups.push(...money.groups, ...giftGroups(wh, goal, child, who));
  groups.push({
    key: `edu/${goal.id}/addMore`,
    level: "simple",
    fields: [],
    actions: [
      ...money.actions,
      {
        key: `edu/${goal.id}/addGift`,
        label: "＋ 子への援助（結婚・住宅資金など）",
        level: "detail",
        run: (w) =>
          mutate(w, (hh) => {
            const g = find(hh, w) as Goal | undefined;
            const donor = (hh.donors ?? [])[0]?.id;
            const at = `${Number(child.birth.birthYearMonth.slice(0, 4)) + 30}-04`;
            if (g?.education !== undefined) (g.education.gifts ??= []).push({ id: newId(), at: { at }, amount: 1000000, purpose: "housing", ...(donor !== undefined ? { donor } : {}) });
          }),
      },
    ],
  });
  return { key: `edu/${child.id}`, title: who, level: "simple", groups, actions: [] };
}

export function educationStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const children = h.members.filter((m) => m.kind === "child").sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? -1 : 1));
  const sections = children.map((c) => childSection(wh, c));
  if (sections.length === 0) sections.push({ key: "edu/none", title: "子ども", note: "子がいません（家族の段階で足せます）", level: "simple", groups: [], actions: [] });
  // 子を決めていない教育のお金の行（入るお金・出るお金）は後ろの区画。子ごとの区画に出した行は除く
  const claimed = new Set<string>([
    ...(h.incomeFlows ?? []).filter((f) => educationRowChild(h, { ...f, dir: "in" }) !== null).map((f) => f.id),
    ...(h.periodicExpenses ?? []).filter((p) => educationRowChild(h, { ...p, dir: "out" }) !== null).map((p) => p.id),
  ]);
  const money = moneySections(wh, "education", { claimed, level: "detail", inTitle: "入るお金（子を決めていない分）", outTitle: "出るお金（子を決めていない分）" }).filter((s) => s.groups.length > 0);
  return {
    id: "education",
    label: "子ども・教育",
    lead: "子ごとの進路。学費は統計の平均（文部科学省「子供の学習費調査」など）で、保育料は世帯の収入から（国の基準と自治体の水準の目安）計算します。",
    sections: [...sections, ...money],
  };
}

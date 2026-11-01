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
import type { EducationAbroad, EducationLesson, EducationLoan, EducationScholarship, EducationStage, Goal, Household, IncomeFlow, IncomeFlowKind, Member, PeriodicExpense, Timepoint } from "../../../engine/types.ts";
import { schoolEntryYear } from "../../present.ts";
import { addMonths } from "../../levers.ts";
import { byId, field, getPath, plain, removeAction, resolveTimepoint, timepointField, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { isSchoolLinkedLeaves, mutate, newId, presetBasis, standardBox, type WorkingHousehold } from "../household.ts";
import { formatYearMonth, formatYen } from "../units.ts";
import { EDUCATION_BASIS, educationStagesAddress, fillEducation, leavesToSchool, stageEnded } from "../fill.ts";
import { putRow, rowAt, type StateRow } from "../rows.ts";
import { addIncome, expenseCard, incomeCard, incomeGroups, moneySections, periodicGroups } from "../moneyRows.ts";
import { boardingStatistic, INTERNATIONAL_MISSING, KOSEN_MISSING, isGraduate, isHigher, isK12, isTertiary, manText, stagePeriod, stageStatistic, stageYears } from "../educationCost.ts";
import { masterAmount, regulationValue } from "../../../../../hearing/src/statistics.ts";
import { childOfPeriodic } from "./events.ts";
import { donorOptions, FIELDS, GIFT_PURPOSES, HOUSING_EXEMPTION, LIVING_PLACE, memberLabel, memberOptions, NURSERY_HOURS, SCHOOL_STAGES, SECTORS, TAX_METHODS } from "../labels.ts";
import type { Address } from "../../store/readings.ts";
import { scholarshipRateEstimate } from "../../../../../hearing/src/loanRates.ts";

type Obj = Record<string, unknown>;
const goals = (h: Household) => h.goals;
/** 段の並び（保育園から） */
export const STAGE_ORDER = ["nursery", "kindergarten", "elementary", "juniorHigh", "highSchool", "kosen", "university", "juniorCollege", "vocational", "graduateMaster", "graduateDoctor", "graduateProfessional"];
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
  // 公立・私立の欄で「公立」を選ぶと値が空になる（空は公立。計算も同じ）ので、空は公立として型と比べる
  for (const p of COURSE_PRESETS) if (stages.length > 0 && stages.every((s) => p.sectors[s.stage] === undefined || p.sectors[s.stage] === (s.sector ?? "public"))) return p.value;
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
  { value: "statistics", label: "学校ごとの額で（統計の平均か入れた額）" },
  { value: "rows", label: "塾・習い事を期間の行で入れる" },
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

/**
 * 学校外の費用（塾・習い事など）の一律の設定（標準）: 幼稚園〜高校のすべての段を、統計の平均か「入れない」にする。段ごとに入れた額は詳細の各段で。
 * 段ごとに違う値が入っていれば「学校ごとに入れた額」を見せる（選ぶと一律に戻す）
 */
function uniformOutOfSchool(goal: Goal): FieldDef {
  const find = byId(goals, goal.id);
  const k12 = (g: Goal | undefined) => (g?.education?.stages ?? []).filter((s) => isK12(s.stage));
  return field({
    key: `edu/${goal.id}/outUniform`,
    item: "goal.education",
    label: "学校外の費用（塾・習い事など）",
    level: "simple",
    kind: "select",
    options: [
      { value: "statistics", label: "統計の平均" },
      { value: "none", label: "入れない" },
      { value: "custom", label: "学校ごとに入れた額（詳細）" },
    ],
    structural: true,
    help: "幼稚園〜高校の塾・家庭教師・習い事・体験などの費用です。統計の平均（子供の学習費調査の学校外活動費）は、塾や習い事をしていない子も含めた平均です。学校ごとの月額は詳細の各段で入れられます",
    get: (w) => {
      const xs = k12(find(w.request.input.household, w) as Goal | undefined).map((s) => s.outOfSchool);
      if (xs.every((x) => x === undefined || x === "statistics")) return { value: "statistics", implicit: true };
      if (xs.every((x) => x === "none")) return { value: "none" };
      return { value: "custom" };
    },
    set: (w, v) =>
      v === "custom"
        ? w
        : mutate(w, (hh) => {
            for (const s of k12(find(hh, w) as Goal | undefined)) {
              if (v === "none") s.outOfSchool = "none";
              else delete s.outOfSchool;
            }
          }),
  });
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
      ? `学校外の費用は、学校ごとの額（推定は統計の平均${statText}）で計算しています。各段の「学校外の費用（月額）」で入れられます。${lessons.length > 0 ? `塾・習い事の行 ${lessons.length}件は使っていません（「期間の行で入れる」に戻すと使います）。` : "塾の期間と月謝で入れるときは「塾・習い事を期間の行で入れる」にします。"}`
      : mode === "rows"
        ? `学校外の費用は行 ${lessons.length}件で計算しています（統計の平均は足しません）`
        : `前の形: 統計の平均（塾・習い事を含む）に行 ${lessons.length}件を足しています。二重になっていないか確かめ、「学校ごとの額で」か「期間の行で入れる」に切り替えてください`;
  const modeField: FieldDef = {
    ...field({
      key: `edu/${goal.id}/outMode`,
      item: "goal.education",
      label: "学校外の費用の入れ方",
      // 統計の平均で十分なことが多いので詳細（塾の予定がはっきりしている人だけ行で入れる。0078）
      level: "detail",
      kind: "select",
      options: [...OUT_OF_SCHOOL_MODES, ...(mode === "legacy" ? [LEGACY_MODE] : [])],
      structural: true,
      sideEffects: "初めて「期間の行で入れる」にすると、段ごとに統計の平均の行（推定）を作ります。「学校ごとの額で」に戻しても行は残します（使いません）",
      help: "ふつうは学校ごとの額（各段の「学校外の費用（月額）」。推定は統計の平均）で入れます。塾の期間と月謝を行で入れるときは「期間の行で入れる」にすると、学校ごとの額は足しません（二重になりません）。初めて切り替えると、段ごとの統計の平均の行を作るので、塾の段だけ直せます",
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
  // 統計の平均のときは詳細だけに出す。行で入れている（前の形を含む）ときは、標準にも見出しと説明を出す（入れ方は詳細で切り替える）
  const out: GroupDef[] = [{ key: `edu/${goal.id}/out`, title: "学校外の費用の入れ方（塾・習い事の行）", note, level: mode === "statistics" ? "detail" : "simple", fields: [modeField], actions: [] }];
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
export const VOCATIONAL_MISSING = "未入力（専門学校の学費の統計はまだありません。年額を入れるまで0円で計算中）";

/** 段の見出しの下の1行（統計の平均か、入れた額） */
function stageNote(s: EducationStage, lunch: LunchChoice): string | undefined {
  if (s.stage === "nursery") return undefined;
  const stat = stageStatistic(s);
  const parts: string[] = [];
  const school = isK12(s.stage) ? "学校の費用" : "学費";
  const est = annualEstimate(s, lunch);
  if (s.annualOverride !== undefined) parts.push(`${school} 年${manText(s.annualOverride)}（入れた額）`);
  else if (est !== null) parts.push(`${school} 年約${manText(est.value)}（統計の平均・今の値段）`);
  else if (s.stage === "vocational" || s.stage === "kosen" || s.sector === "international") parts.push("⚠ 学費が未入力です（0円で計算中）。年額を入れてください");
  if (isK12(s.stage) && stat?.outOfSchool != null && s.outOfSchool !== "none") parts.push(`学校外 年約${manText(stat.outOfSchool)}（入れ方は「学校外の費用」で）`);
  if (isTertiary(s.stage) && s.stage !== "vocational") {
    const entrance = s.entranceOverride ?? stat?.entrance ?? null;
    if (entrance !== null) parts.push(`入学金 約${manText(entrance)}`);
  }
  if (isTertiary(s.stage) && s.living === "away") {
    const b = boardingStatistic();
    const monthly = s.boarding?.monthly ?? (b.annual === null ? null : Math.round(b.annual / 12));
    if (monthly !== null) parts.push(`仕送り 月${manText(monthly)}${s.boarding?.monthly === undefined ? "（推定）" : ""}`);
  }
  const notes = [parts.join("・")];
  if (stat?.note != null) notes.push(stat.note);
  if (s.stage === "juniorCollege" || s.stage === "vocational") notes.push(HIGHER_SUPPORT_NOTE);
  return notes.filter((x) => x !== "").join("。");
}

/** 公立の小学校・中学校の給食費の選び方（教育の目標の schoolLunch。"" は制度どおり） */
type LunchChoice = "" | "free" | "paid";
const lunchOf = (g: Goal | undefined): LunchChoice => (g?.education?.schoolLunch as LunchChoice | undefined) ?? "";

/**
 * 学校の費用・学費の年額の推定（計算エンジンと同じ額。今の値段）。公立の小学校・中学校は給食費の扱い（制度どおりは公立小学校で国の基準額まで、
 * 自治体が無償化は全額）を引いた額にする（「この値にする」で年額を入れると計算エンジンは給食費を引かないので、引いた後の額を入れる）。統計が無ければ null
 */
export function annualEstimate(s: EducationStage, lunch: LunchChoice): { value: number; basis: string } | null {
  const stat = stageStatistic(s);
  if (stat === null || stat.annual === null) return null;
  const pub = (s.sector ?? "public") === "public";
  const lunchStat = pub && (s.stage === "elementary" || s.stage === "juniorHigh") ? masterAmount(`education.statistics.${s.stage}.public.schoolLunch`) : null;
  const choice = (s.schoolLunch as LunchChoice | undefined) ?? lunch;
  const off = lunchStat === null || choice === "paid" ? 0 : choice === "free" ? lunchStat : stat.lunchRelief;
  // 部活動などの費用を入れた段は、学校の費用の推定から統計の教科外活動費を除く（計算エンジンは入れた部活動の費用を年額に足すので、二重にしない）
  const sec = (s.sector ?? "public") === "private" || s.sector === "international" ? "private" : "public";
  const club = s.clubAnnual === undefined ? 0 : (masterAmount(`education.statistics.${s.stage}.${sec}.extracurricular`) ?? 0);
  const notes = [
    ...(off > 0 ? [`${choice === "free" ? "自治体が給食費を無償にしている分" : "公立小学校の給食費の国の負担軽減の分"}（年${manText(off)}）`] : []),
    ...(club > 0 ? [`部活動などの費用（統計の教科外活動費 年${manText(club)}。入れた額を別に足します）`] : []),
  ];
  if (notes.length === 0) return { value: stat.annual, basis: stat.annualBasis };
  return { value: stat.annual - off - club, basis: `${stat.annualBasis}から、${notes.join("と")}を引いた額` };
}

/**
 * 学校の種類（公立・私立・系統）を変えたとき、前の推定の値をそのまま入れた年額・入学金（「この値にする」で書いた額）は外して、新しい推定に入れ直す
 * （前の学校の額のまま残ると、私立にしても公立の額で計算する）。FP が自分で入れた額（推定と違う額）は残す。next をそのまま書き換える
 */
export function dropStaleEstimates(prev: EducationStage, next: EducationStage, lunch: LunchChoice): void {
  if (next.annualOverride !== undefined && next.annualOverride === annualEstimate(prev, lunch)?.value) delete next.annualOverride;
  const entrance = stageStatistic(prev)?.entrance ?? null;
  if (next.entranceOverride !== undefined && isTertiary(prev.stage) && next.entranceOverride === entrance) delete next.entranceOverride;
}

/** 数えない推定の理由（学校の種類で決まる統計の平均） */
const QUIET_STAT = "学校の種類で決まる統計の平均（進路を確かめれば、ここは数えない）";

/** 空欄のとき推定の値を見せる（印「推定」・根拠・「この値にする」で書ける。0041）。est が null なら元の欄のまま */
function withEstimate(f: FieldDef, est: (wh: WorkingHousehold) => { value: number; basis: string; hint: string } | null): FieldDef {
  return {
    ...f,
    // 学校の種類（進路）を選べば決まる統計の平均なので、入力項目の状態・確かめの一覧では数えない（進路の推定は進路の欄で1つと数える。0062 の追記 2026-10-31）
    quietEstimate: QUIET_STAT,
    get: (wh) => {
      const st = f.get(wh);
      if (st.value !== null) return st;
      const e = est(wh);
      return e === null ? st : { ...st, estimated: e.basis, hint: e.hint };
    },
    blankEstimate: (wh) => (f.get(wh).value === null ? (est(wh)?.value ?? null) : null),
  };
}

/** 浪人の年数の「?」（計算のとおりに: 入学から後がその年数だけうしろにずれる） */
export const DELAY_HELP =
  "浪人の年数だけ、この学校の入学・在学・卒業がうしろにずれます（入学金・受験の費用・学費・仕送りも、その年数だけ後の年に、教育費の上昇率で伸ばした額でかかります）。" +
  "独立（世帯を離れる時期）も最後の学校の終わりに合わせてずれ、その間は世帯の家族として生活費・扶養に入ります。" +
  "浪人の間の予備校の費用は入っていないので、かかるなら「その他の教育費」で足してください。貸与の奨学金・教育ローンの時期は自動ではずれないので、入れていれば直してください";

/** 在学年数の標準が1つに決まらない段（推定で見せる）。専門学校は1〜4年で2年制が多い */
const YEARS_VARY: Readonly<Record<string, string>> = { vocational: "専門学校は1〜4年の課程があり、ここでは2年制で計算しています" };

function stageFields(goalId: string, i: number, s: EducationStage, nurseryStart: string, rowsMode = false): FieldDef[] {
  const find: Finder = (h) => (getPath((h.goals ?? []).find((g) => g.id === goalId), ["education", "stages", String(i)]) as Obj | undefined) ?? undefined;
  const stageNow = (wh: WorkingHousehold) => find(wh.request.input.household, wh) as EducationStage | undefined;
  const lunchNow = (wh: WorkingHousehold) => lunchOf((wh.request.input.household.goals ?? []).find((g) => g.id === goalId));
  const key = `edu/${goalId}/stage/${i}`;
  const higher = isTertiary(s.stage);
  const sid = typeof s.id === "string" ? s.id : undefined;
  const sectorOptions =
    s.stage === "nursery"
      ? []
      : s.stage === "university" || isGraduate(s.stage) || s.stage === "kosen"
        ? SECTORS
        : isK12(s.stage)
          ? [...SECTORS.filter((o) => o.value !== "national" || s.stage !== "kindergarten"), { value: "international", label: "インターナショナルスクール" }]
          : SECTORS.filter((o) => o.value !== "national");
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
        mode: "ym",
        modes: ["ym"],
        dateStyle: "birth",
        nullText: `推定: ${nurseryStart}`,
        help: "「2028-04」の形で入れます。推定は1歳の4月（その子の育児休業を入れていれば、休業の終わりの翌月）です",
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
        hint: (v) => (v === null ? `推定あり: ${NURSERY_FEE_BASIS}` : v === 0 ? "保育料なし（自治体の無償化など）" : null),
        help: "自治体の保育料表の額が分かれば入れてください。0 なら保育料なし。3歳からの無償化は自動で計算します",
      }),
    );
    // 保育の時間（標準時間・短時間）は、国の基準の保育料の差が1〜2%と小さく、保育料の水準（割合）の目安の幅に埋もれるので出さない。
    // 前に「保育短時間」を入れた世帯だけ、その値を見せて直せるようにする
    if (s.hours === "short") fields.push(plain({ key: `${key}/hours`, item: "goal.education", label: "保育の時間", level: "detail", kind: "select", options: NURSERY_HOURS, find, path: ["hours"], optional: true, fallback: "standard", help: "保育短時間（1日8時間まで）は、国の基準の保育料が保育標準時間（11時間まで）より1〜2%低くなります" }));
    fields.push(plain({ key: `${key}/feeRatio`, item: "goal.education", label: "保育料の水準（国の基準に対する割合）", level: "detail", kind: "pct", find, path: ["feeRatio"], optional: true, fallback: "0.8", help: FEE_RATIO_HELP }));
    const extra = masterAmount("education.statistics.nursery.extra");
    fields.push({
      ...withEstimate(
        plain({ key: `${key}/extra`, item: "goal.education", label: "保育料とは別にかかるお金（年額）", level: "detail", kind: "yen", basis: "annual", find, path: ["extraAnnual"], optional: true, help: NURSERY_EXTRA_HELP }),
        () => (extra === null ? null : { value: extra, basis: NURSERY_EXTRA_BASIS, hint: `年${manText(extra)}（推定）` }),
      ),
      ...stageAddress(goalId, sid, "extraAnnual"),
    });
    return fields;
  }
  // 公立・私立は、公立・私立のある段すべてで標準（段によって選べたり選べなかったりすると分かりにくい。
  // 進路の型でまとめて変えられるので手間は増えない。0078 の 2026-10-29 の追記）。系統は詳細（文系・理系の差は小さい）。0078
  const reestimate = (_h: Household, target: Obj, _v: unknown, wh: WorkingHousehold) => {
    const prev = stageNow(wh);
    if (prev !== undefined) dropStaleEstimates(prev, target as unknown as EducationStage, lunchNow(wh));
  };
  fields.push(plain({ key: `${key}/sector`, item: "goal.education", label: "公立・私立", level: "simple", kind: "select", options: sectorOptions, find, path: ["sector"], optional: true, fallback: "public", help: sectorHelp(s.stage), after: reestimate }));
  // 高校・高専（高校の段と高専の段で入れ替える。段の ID は今のまま。0090）
  if (s.stage === "highSchool" || s.stage === "kosen")
    fields.push(
      field({
        key: `${key}/highKind`,
        item: "goal.education",
        label: "高校・高専",
        level: "detail",
        kind: "select",
        options: [
          { value: "highSchool", label: "高校（3年）" },
          { value: "kosen", label: "高専（5年）" },
        ],
        structural: true,
        help: "高専は15歳の学年から5年です。高専の後に大学に編入するときは、大学の段の在学年数を2年（3年次に編入）にします。大学は高専を出た翌月の4月からです",
        get: (wh) => ({ value: stageNow(wh)?.stage ?? s.stage }),
        set: (wh, v) =>
          v === s.stage || (v !== "highSchool" && v !== "kosen")
            ? wh
            : mutate(wh, (h, req) => {
                const st = find(h, { ...wh, request: req }) as EducationStage | undefined;
                if (st === undefined) return;
                st.stage = v;
                st.sector = v === "kosen" ? "national" : "public";
                delete st.years;
                delete st.annualOverride;
                delete st.entranceOverride;
                delete st.clubAnnual;
                delete st.outOfSchool;
                delete st.schoolLunch;
              }),
      }),
    );
  if (s.stage === "graduateProfessional")
    fields.push({
      ...plain({ key: `${key}/field`, item: "goal.education", label: "種類", level: "simple", kind: "select", options: [{ value: "other", label: "専門職大学院（教職・経営など）" }, { value: "law", label: "法科大学院" }], find, path: ["field"], optional: true, fallback: "other", help: "法科大学院は3年（法学既修者は2年。在学年数で直します）、ほかの専門職大学院は2年で計算します", after: reestimate }),
      ...stageAddress(goalId, sid, "field"),
    });
  if (s.stage === "university") fields.push(plain({ key: `${key}/field`, item: "goal.education", label: "系統", level: "detail", kind: "select", options: FIELDS, find, path: ["field"], optional: true, fallback: "humanities", help: fieldHelp(), after: reestimate }));
  if (higher) fields.push(plain({ key: `${key}/living`, item: "goal.education", label: "通い方", level: "simple", kind: "select", options: LIVING_PLACE, find, path: ["living"], optional: true, fallback: "home" }));
  // 学費の年額。空欄は統計の平均の推定（専門学校は統計の目安が無いので簡易で未入力の警告、公立の短大も簡易。私立の短大の平均で仮に計算）
  const simpleAnnual = s.stage === "vocational" || s.sector === "international" || (s.stage === "kosen" && s.sector !== "national") || (s.stage === "juniorCollege" && (s.sector ?? "public") !== "private");
  const annual = withEstimate(
    plain({
      key: `${key}/annual`,
      item: "goal.education",
      label: isK12(s.stage) ? "学校の費用（年額）" : "学費（年額）",
      level: simpleAnnual ? "simple" : "detail",
      kind: "yen",
      basis: "annual",
      find,
      path: ["annualOverride"],
      optional: true,
      hint: (v) => (v !== null ? "入れた年額で計算します（今の値段。将来は教育費の上昇率で伸びます）。学校の種類を変えたときは、前の学校の値のままでないか確かめてください" : null),
      help: annualHelp(s),
    }),
    (wh) => {
      const st = stageNow(wh);
      const e = st === undefined ? null : annualEstimate(st, lunchNow(wh));
      return e === null ? null : { ...e, hint: `年${manText(e.value)}（推定）` };
    },
  );
  fields.push({
    ...annual,
    ...stageAddress(goalId, sid, "annualOverride"),
    ...(s.stage === "vocational" || s.sector === "international" || (s.stage === "kosen" && s.sector !== "national")
      ? {
          get: (wh: WorkingHousehold) => {
            const st = annual.get(wh);
            return st.value === null ? { ...st, estimated: s.stage === "vocational" ? VOCATIONAL_MISSING : s.stage === "kosen" ? KOSEN_MISSING : INTERNATIONAL_MISSING } : st;
          },
        }
      : {}),
  });
  // 入学金（大学・短大は統計の平均の推定。幼稚園〜高校は学校の費用に含めて数えているので、入れたときだけ別に足す）
  if (higher || s.stage === "kosen")
    fields.push({
      ...withEstimate(
        plain({ key: `${key}/entrance`, item: "goal.education", label: "入学金", level: "detail", kind: "yen", basis: "once", find, path: ["entranceOverride"], optional: true, help: "入学の前の2月（国公立は3月）に払います" }),
        (wh) => {
          const st = stageNow(wh);
          const stat = st === undefined ? null : stageStatistic(st);
          return stat?.entrance == null ? null : { value: stat.entrance, basis: stat.entranceBasis, hint: `${manText(stat.entrance)}（推定）` };
        },
      ),
      ...stageAddress(goalId, sid, "entranceOverride"),
    });
  else
    fields.push({
      ...plain({ key: `${key}/entrance`, item: "goal.education", label: "入学金", level: "detail", kind: "yen", basis: "once", find, path: ["entranceOverride"], optional: true, hint: (v) => (v === null ? "なし（学校の費用に含めて数えています）" : null), help: "子供の学習費調査の学校の費用には、入学金などの学校納付金が含まれています。私立の受験校の入学金を別に足すときだけ入れてください" }),
      ...stageAddress(goalId, sid, "entranceOverride"),
    });
  if (isK12(s.stage)) fields.push(...k12Fields(goalId, i, s, key, find, sid, rowsMode));
  fields.push(
    field({
      key: `${key}/school`,
      item: "goal.education",
      label: "学校名",
      level: "detail",
      kind: "select",
      options: [{ value: "", label: "学校未定（平均で計算）" }],
      help: "学費は、進路の型と統計の平均で計算します（学校名からの検索はまだありません）",
      readOnly: "学校名からの検索はまだありません",
      get: (w) => ({ value: "", hint: getPath(find(w.request.input.household, w), ["school"]) !== undefined ? "学費データの行が入っています" : null }),
      set: (w) => w,
    }),
  );
  // 在学年数: 標準が1つに決まる段はその年数を最初から見せる（省略時の既定）。決まらない段（専門学校）は推定
  const years = plain({ key: `${key}/years`, item: "goal.education", label: "在学年数", level: "detail", kind: "int", suffix: "年", min: 1, max: 6, find, path: ["years"], optional: true, ...(YEARS_VARY[s.stage] === undefined ? { fallback: stageYears({ ...s, years: undefined }) } : {}), help: yearsHelp(s.stage) });
  const vary = YEARS_VARY[s.stage];
  fields.push(vary === undefined ? years : { ...years, get: (wh) => { const st = years.get(wh); return st.value === null ? { ...st, estimated: vary, hint: `${stageYears({ ...s, years: undefined })}年（推定）` } : st; }, blankEstimate: (wh) => (years.get(wh).value === null ? stageYears({ ...s, years: undefined }) : null) });
  if (higher) {
    fields.push(
      plain({ key: `${key}/delay`, item: "goal.education", label: "浪人の年数", level: "detail", kind: "int", suffix: "年", min: 0, max: 5, find, path: ["delayYears"], optional: true, fallback: 0, help: DELAY_HELP }),
      plain({ key: `${key}/exam`, item: "goal.education", label: "受験・併願の費用", level: "detail", kind: "yen", basis: "once", find, path: ["exam", "amount"], optional: true, help: "受験料など（入学の前の1月に払います）。入れなければ0円で計算します" }),
    );
    if (s.living === "away") {
      const b = boardingStatistic();
      fields.push(
        {
          ...withEstimate(
            plain({ key: `${key}/boarding/monthly`, item: "goal.education", label: "自宅外の仕送り（月額）", level: "detail", kind: "yen", basis: "monthly", find, path: ["boarding", "monthly"], optional: true, help: "家賃・食費など、親が出す仕送りの月額。在学中は毎月かかります" }),
            () => (b.annual === null ? null : { value: Math.round(b.annual / 12), basis: BOARDING_BASIS, hint: `月${manText(Math.round(b.annual / 12))}（推定）` }),
          ),
          ...stageAddress(goalId, sid, "boarding", "monthly"),
        },
        {
          ...withEstimate(
            plain({ key: `${key}/boarding/initial`, item: "goal.education", label: "自宅外の初期費用", level: "detail", kind: "yen", basis: "once", find, path: ["boarding", "initial"], optional: true, help: "敷金・家具など、自宅外で暮らし始める費用（入学の前の月）" }),
            () => (b.initial === null ? null : { value: b.initial, basis: BOARDING_INITIAL_BASIS, hint: `${manText(b.initial)}（推定）` }),
          ),
          ...stageAddress(goalId, sid, "boarding", "initial"),
        },
      );
    }
  }
  if (s.stage === "university")
    fields.push({
      ...plain({ key: `${key}/sciAgri`, item: "goal.education", label: "理工農系", level: "detail", kind: "bool", find, path: ["scienceAgriculture"], optional: true, fallback: false, help: "国の修学支援（授業料の減免）は、所得が中くらいの世帯（子が3人以上の世帯を除く）では理工農系の学部だけが対象です。理系の多くは対象です" }),
      ...stageAddress(goalId, sid, "scienceAgriculture"),
    });
  return fields;
}

/** 保育料とは別にかかるお金の推定の根拠（短い文）と「?」 */
const NURSERY_EXTRA_BASIS = "統計の平均。教材・被服・保護者会・遠足・通園などの実費（文部科学省・厚生労働省「幼稚園・保育所等の経営実態調査」の保育所の実費徴収。平成23年度）";
const NURSERY_EXTRA_HELP =
  "0〜2歳の保育料には給食（主食・副食）の費用が含まれるので、ここは教材・被服・保護者会・遠足・通園など、保育所が保育料とは別に集める実費です。" +
  "推定は、国の調査の費目ごとの実施率×1人当たりの額を足した目安で、公立・私立に分けた値はありません。3歳からの給食の副食費（国の目安は月4,500円）などは「保育園・幼稚園（3歳から）」の段の学校の費用に入っています";

/** 給食費の選び方（段ごと。公立の小学校・中学校） */
const LUNCH_ELEMENTARY = [
  { value: "", label: "制度どおり（国の負担軽減を引く）" },
  { value: "free", label: "自治体が無償化（全額を引く）" },
  { value: "paid", label: "全額を払う" },
];
const LUNCH_JUNIOR = [
  { value: "", label: "制度どおり（全額を払う）" },
  { value: "free", label: "自治体が無償化（全額を引く）" },
];

/** 統計の学校給食費（公立） */
const lunchStat = (stage: string): number | null => masterAmount(`education.statistics.${stage}.public.schoolLunch`);

/**
 * 段の給食費の選び方を書く: 前に教育の目標の選び方（goal.education.schoolLunch）を入れていた世帯は、まずそれを公立の小学校・中学校の段に写して外す
 * （段の「制度どおり」を目標の選び方で上書きされないように）。"" は段の選び方を外す
 */
function setStageLunch(h: Household, goalId: string, stageIndex: number, v: string): void {
  const g = (h.goals ?? []).find((x) => x.id === goalId);
  const e = g?.education;
  if (e === undefined) return;
  if (e.schoolLunch !== undefined) {
    for (const st of e.stages) if ((st.stage === "elementary" || st.stage === "juniorHigh") && (st.sector ?? "public") !== "private" && st.schoolLunch === undefined) st.schoolLunch = e.schoolLunch;
    delete e.schoolLunch;
  }
  const st = e.stages[stageIndex];
  if (st === undefined) return;
  if (v === "free" || v === "paid") st.schoolLunch = v;
  else delete st.schoolLunch;
}

/** 幼稚園〜高校の段の詳細の欄: 給食費の選び方（公立の小学校・中学校）・学校外の費用（月額）・部活動などの費用（中学校・高校） */
function k12Fields(goalId: string, i: number, s: EducationStage, key: string, find: Finder, sid: string | undefined, rowsMode: boolean): FieldDef[] {
  const out: FieldDef[] = [];
  const goalNow = (wh: WorkingHousehold) => (wh.request.input.household.goals ?? []).find((g) => g.id === goalId);
  const stageNow = (wh: WorkingHousehold) => find(wh.request.input.household, wh) as EducationStage | undefined;
  const pub = (s.sector ?? "public") === "public";
  if (pub && (s.stage === "elementary" || s.stage === "juniorHigh")) {
    const lunch = lunchStat(s.stage);
    const options = s.stage === "elementary" ? LUNCH_ELEMENTARY : s.schoolLunch === "paid" ? [...LUNCH_JUNIOR, { value: "paid", label: "全額を払う" }] : LUNCH_JUNIOR;
    out.push({
      ...field({
        key: `${key}/lunch`,
        item: "goal.education",
        label: "給食費",
        level: "detail",
        kind: "select",
        options,
        help:
          (s.stage === "elementary"
            ? "制度どおりは、令和8年度から公立小学校の給食費を国の負担軽減の基準額（月5,200円×11か月）まで学校の費用から引きます。"
            : "公立中学校の給食費は、国の負担軽減の対象外（国が検討中）なので、制度どおりは全額を払う計算です。") +
          `お住まいの自治体が給食費を無償にしていれば「自治体が無償化」。給食費の平均は年約${lunch === null ? "—" : manText(lunch)}（子供の学習費調査・令和5年度）`,
        get: (wh) => {
          const st = stageNow(wh);
          const v = st?.schoolLunch ?? goalNow(wh)?.education?.schoolLunch ?? "";
          return { value: v, ...(v === "" ? { implicit: true } : {}) };
        },
        set: (wh, v) => mutate(wh, (h) => setStageLunch(h, goalId, i, typeof v === "string" ? v : "")),
      }),
      ...stageAddress(goalId, sid, "schoolLunch"),
    });
  }
  // 学校外の費用（塾・習い事など）の月額。空欄は統計の平均（推定）。塾・習い事を期間の行で入れているときは段の額を数えないので出さない
  const stat = stageStatistic(s);
  const outMonthly = stat?.outOfSchool == null ? null : Math.round(stat.outOfSchool / 12);
  if (!rowsMode) out.push({
    ...withEstimate(
      field({
        key: `${key}/outOfSchool`,
        item: "goal.education",
        label: "学校外の費用（月額）",
        level: "detail",
        kind: "yen",
        basis: "monthly",
        optional: true,
        help: "塾・家庭教師・通信教育・習い事・体験活動などの月額です。推定は統計の平均（子供の学習費調査の学校外活動費を12で割った額）で、塾や習い事をしていない子も含めた平均です。0円にすると入れません",
        get: (wh) => {
          const o = stageNow(wh)?.outOfSchool;
          return { value: o === "none" ? 0 : typeof o === "object" ? o.monthly : null };
        },
        set: (wh, v) =>
          mutate(wh, (h, req) => {
            const st = find(h, { ...wh, request: req }) as EducationStage | undefined;
            if (st === undefined) return;
            if (v === null) delete st.outOfSchool;
            else st.outOfSchool = { monthly: Number(v) };
          }),
      }),
      () => (outMonthly === null ? null : { value: outMonthly, basis: OUT_OF_SCHOOL_BASIS, hint: `月${manText(outMonthly)}（推定）` }),
    ),
    ...stageAddress(goalId, sid, "outOfSchool", "monthly"),
  });
  // 部活動などの費用（中学校・高校）。空欄は統計の教科外活動費（学校の費用に含めて数えている）
  if (s.stage === "juniorHigh" || s.stage === "highSchool") {
    const sec = pub || s.sector === "national" ? "public" : "private";
    const club = masterAmount(`education.statistics.${s.stage}.${sec}.extracurricular`);
    out.push({
      ...withEstimate(
        plain({ key: `${key}/club`, item: "goal.education", label: "部活動などの費用（年額）", level: "detail", kind: "yen", basis: "annual", find, path: ["clubAnnual"], optional: true, help: CLUB_HELP }),
        (wh) => {
          const st = stageNow(wh);
          if (club === null || st?.annualOverride !== undefined) return null;
          return { value: club, basis: CLUB_BASIS, hint: `年${manText(club)}（推定・学校の費用に含む）` };
        },
      ),
      ...stageAddress(goalId, sid, "clubAnnual"),
    });
  }
  return out;
}

const OUT_OF_SCHOOL_BASIS = "統計の平均。塾・家庭教師などの補助学習費と、習い事・体験などのその他の学校外活動費を足したもの（文部科学省「子供の学習費調査」令和5年度）を12で割った額";
const CLUB_BASIS = "統計の平均の教科外活動費（部活動・クラブ活動・行事など。文部科学省「子供の学習費調査」令和5年度）。学校の費用に含めて数えています";
const CLUB_HELP =
  "部活動・クラブ活動の部費・遠征・用具などの年額です。推定は子供の学習費調査の教科外活動費（部活動をしていない生徒も含めた平均。学校の費用に含めて数えています）。" +
  "額を入れると、学校の費用の中の教科外活動費をその額に入れ替えます（学校の費用の年額を入れた段は、その年額に足します）。" +
  "目安: 中学生の運動部の家庭の支出は平均で年約5.1万円（公益財団法人笹川スポーツ財団「中学生のスポーツ活動と保護者の関与に関する調査」2025年）";

/**
 * 保育料の自動の計算のしかた（段の見出しの下の注記。計算エンジンの education.nurseryFee と同じ決まり。0029）。国の基準の額は推定の目安の写しの
 * 制度データ（保育標準時間の表）から
 */
export function nurseryMethodNote(): string {
  const table = regulationValue("educationSupport.nursery.fee.standard", null);
  const amounts = Array.isArray(table) ? (table as readonly { amount?: number }[]).map((x) => x.amount).filter((x): x is number => typeof x === "number" && x > 0) : [];
  const range = amounts.length > 0 ? `月${Math.min(...amounts).toLocaleString("ja-JP")}円〜${Math.max(...amounts).toLocaleString("ja-JP")}円` : "";
  return (
    `保育料は世帯の収入から自動で計算します（目安）: 父母の住民税（市町村民税の所得割の合計）の階層ごとの国の基準${range !== "" ? `（${range}）` : ""}×保育料の水準（目安80%）。` +
    "きょうだいが保育園・幼稚園に通っていれば第2子は半額・第3子から0円、ひとり親の世帯は軽減。4〜8月は前年度、9月からはその年度の住民税で決めます。"
  );
}

/** 保育料の自動の計算の根拠の短い文 */
export const NURSERY_FEE_BASIS = "世帯の収入（住民税の所得割）から自動で計算（国の基準×保育料の水準。目安）";
/** 保育料の水準の「?」 */
export const FEE_RATIO_HELP =
  "保育料を、国の基準（住民税の所得割の階層ごとの上限）の何%にするかです。多くの自治体は国の基準より低い保育料にしていて、目安は80%です（内閣府の令和4年度の調査で、独自に軽減している自治体の軽減の水準から）。お住まいの自治体の保育料表に合わせて変えられます";
const BOARDING_BASIS = "統計の平均の仕送り（日本政策金融公庫「教育費負担の実態調査」令和3年度。年95.8万円を12で割った額）";
const BOARDING_INITIAL_BASIS = "統計の平均（日本政策金融公庫「教育費負担の実態調査」令和3年度の、自宅外通学を始めるための費用）";

/** 1つの「?」に入れる、公立・私立の目安（統計の平均。今の値段） */
function sectorHelp(stage: string): string | undefined {
  const line = (sector: string, label: string) => {
    const st = stageStatistic({ stage, sector });
    return st?.annual == null ? null : `${label} 年約${manText(st.annual)}`;
  };
  const xs = stage === "university" ? [line("national", "国立"), line("public", "公立"), line("private", "私立（文科系）")] : stage === "vocational" ? [] : [line("public", "公立"), line("private", "私立")];
  const shown = xs.filter((x): x is string => x !== null);
  if (shown.length === 0) return undefined;
  return `学校の費用・学費の目安（統計の平均・今の値段）: ${shown.join("・")}`;
}

function fieldHelp(): string {
  const f = (field: string, label: string) => {
    const st = stageStatistic({ stage: "university", sector: "private", field });
    return st?.annual == null ? null : `${label} 年約${manText(st.annual)}`;
  };
  return `私立大学の学費の目安（授業料と施設設備費。統計の平均・令和7年度入学者）: ${[f("humanities", "文科系"), f("science", "理科系"), f("medical", "医歯系")].filter((x) => x !== null).join("・")}。医歯系は6年で計算します`;
}

function annualHelp(s: EducationStage): string {
  if (isK12(s.stage)) return "学校教育費（授業料・学用品・通学・修学旅行など）と学校給食費の年額です。学校外活動費（塾・習い事）は含めません。志望校の額が分かれば入れてください";
  if (s.stage === "vocational") return "授業料・実習費・設備費などの年額（入学金は別）。専門学校の学費の統計はまだ入れていないので、志望校の額を入れてください";
  return "授業料と施設設備費の年額（入学金は別）。志望校の学費が分かれば入れてください";
}

function yearsHelp(stage: string): string {
  if (stage === "kosen") return "高専の本科は5年です（専攻科の2年は、大学などの段で近づけます）";
  if (stage === "graduateProfessional") return "法科大学院は3年（法学既修者は2年）、ほかの専門職大学院は2年が標準です";
  if (stage === "university") return "標準は4年（系統が医歯系なら6年）。薬学部（6年）・獣医学部（6年）などは直してください";
  if (stage === "vocational") return "専門学校は1〜4年の課程があり、推定は2年制です。志望校の修業年限を入れてください";
  return "学校の種類の標準の年数です。留年などで変わるときだけ直してください";
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
  return [...rest, next].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
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

/**
 * 足したときのひな形の値（推定）の根拠（0062 の追記 2026-10-30）。
 * - 貸与の奨学金: 日本学生支援機構の第二種（月2万〜12万円から1万円刻みで選ぶ）の月5万円。利率は第二種の利率固定方式の令和8年7〜9月に
 *   貸与が終わった人の年3.0%（上限も年3.0%。在学中は無利子）。返す年数は「奨学金返還年数算出表」（貸与総額で割賦金の基礎額が決まり、
 *   総額÷基礎額の年数）。返し始めは貸与の終わりの翌月から数えて7か月目。利率の数は、ほかのローンの「奨学金の返済」と同じ目安
 *   （マスタデータ master.loanRates。hearing/src/loanRates.ts）から読む
 * - 教育ローン: 日本政策金融公庫「国の教育ローン」。額は入学の年にかかる学費（入学金と1年目の学費。統計の平均）で、融資の上限（子1人350万円。
 *   自宅外通学・大学院・海外留学などは450万円）まで。金利は固定の年4.05%（令和8年7月1日現在。保証料は別）、返す年数は上限の20年
 */
export const SCHOLARSHIP_BASIS = presetBasis(`貸与の奨学金（日本学生支援機構の第二種）月5万円・在学中。利率は${scholarshipRateEstimate().basis}・利率固定方式（上限も年3%）。返す年数は貸与総額から返還年数算出表で`);
export const LOAN_BASIS = presetBasis("国の教育ローン（日本政策金融公庫）: 入学の年の学費（入学金と1年目の学費の統計の平均。上限350万円）・固定金利 年4.05%（令和8年7月1日現在）・返済期間は上限の20年");

/** 日本学生支援機構「奨学金返還年数算出表」: 貸与総額（以下）→ 割賦金の基礎額。340万円を超えると総額の20分の1 */
const JASSO_BASE: readonly [number, number][] = [
  [200000, 30000], [400000, 40000], [500000, 50000], [600000, 60000], [700000, 70000], [900000, 80000], [1100000, 90000], [1300000, 100000],
  [1500000, 110000], [1700000, 120000], [1900000, 130000], [2100000, 140000], [2300000, 150000], [2500000, 160000], [3400000, 170000],
];

/** 貸与総額から返す年数（総額÷割賦金の基礎額の小数点以下を切り捨て。1年以上） */
export function jassoRepayYears(total: number): number {
  const base = JASSO_BASE.find(([upTo]) => total <= upTo)?.[1] ?? total / 20;
  return Math.max(1, Math.floor(total / base));
}

/** 国の教育ローンの融資の上限（自宅外通学・修業年限5年以上の大学・大学院・海外留学は450万円、ほかは350万円） */
const loanCap = (s: EducationStage | undefined): number => (s !== undefined && (s.living === "away" || stageYears(s) >= 5) ? 4500000 : 3500000);

/** 入学の年にかかる学費（入学金と1年目の学費の統計の平均か入れた額）。分からなければ 200万円 */
function firstYearCost(s: EducationStage | undefined): number {
  if (s === undefined) return 2000000;
  const stat = stageStatistic(s);
  const annual = s.annualOverride ?? stat?.annual ?? null;
  const entrance = s.entranceOverride ?? stat?.entrance ?? 0;
  return annual === null ? 2000000 : Math.round((annual + entrance) / 10000) * 10000;
}

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
    const months = (Number(p.to.slice(0, 4)) - Number(p.from.slice(0, 4))) * 12 + Number(p.to.slice(5, 7)) - Number(p.from.slice(5, 7)) + 1;
    const s: EducationScholarship = { id, monthly: 50000, from: { at: p.from }, to: { at: p.to }, rate: scholarshipRateEstimate().rate, termMonths: jassoRepayYears(50000 * months) * 12, debtor: "child" };
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
    const st = (g.education.stages ?? []).find((x) => isHigher(x.stage));
    const l: EducationLoan = { id, at: { at: addMonths(p.from, -3) }, amount: Math.min(firstYearCost(st), loanCap(st)), rate: "0.0405", termMonths: 240, borrower: self.id };
    (g.education.loans ??= []).push(l);
    estimatedRowAt(req.input as unknown as Obj, g.id, "loans", id, ["amount", "rate", "termMonths"], LOAN_BASIS);
  });
}

// ---- 留学（0088） ----

export const ABROAD_KINDS = [
  { value: "credit", label: "1年（単位が認められ、在学は延びない）" },
  { value: "leave", label: "1年（休学して留学し、在学が1年延びる）" },
  { value: "short", label: "短期（1か月ほど）" },
];
const ABROAD_CONTINGENCY = [
  { value: "continue", label: "続ける" },
  { value: "stop", label: "やめる" },
];
const ABROAD_STAGES = new Set(["highSchool", "university", "juniorCollege", "vocational"]);
/** 見出しの短い名前 */
const ABROAD_SHORT: Readonly<Record<string, string>> = { credit: "1年（延びない）", leave: "1年（休学で延びる）", short: "短期" };

/**
 * 留学1回の額の推定（今の値段。0088 の追記 2026-10-31）
 * - 大学など（短大・専門学校を含む）の1年: 文部科学省の委託調査「海外大学に長期留学する者の留学資金調達の現状に係る調査研究」（令和8年3月。
 *   半年以上の留学をした学生・社会人へのWebアンケート、2025年9〜11月、有効回答875件）の図表2-34「学位取得以外（1年以上）」のひと月あたりの費用
 *   （n=238。入学金・授業料・その他の教育関連費用 7万円、住居・光熱費・生活費・その他 17万円、合計 24万円）×12か月。休学して留学する1年は合計（288万円）、
 *   単位が認められる1年は、交換留学で留学先の授業料が免除されることが多い（在籍する大学の学費は払い続ける）ので住居・生活費などだけ（204万円）
 * - 高校の1年と短期: この調査は半年以上の大学などの留学だけなので、国の留学の支援制度（文部科学省「トビタテ！留学JAPAN」）の支給の上限から作った目安
 *   （北米・欧州など: 月額の奨学金16万円×月数＋留学準備金35万円）
 */
export function abroadEstimate(stage: string, kind: string): { value: number; basis: string } {
  if (stage !== "highSchool" && kind !== "short") {
    const value = kind === "leave" ? 240000 * 12 : 170000 * 12;
    const what = kind === "leave" ? "ひと月あたりの合計 24万円（留学先の授業料などを含む）×12か月" : "ひと月あたりの住居・光熱費・生活費・その他 17万円×12か月（交換留学で留学先の授業料は免除が多いので入れない）";
    return { value, basis: presetBasis(`文部科学省の委託調査（令和8年3月。2025年のWebアンケート875件）の、学位の取得でない1年以上の留学の${what}`) };
  }
  const monthly = 160000;
  const prep = 250000 + 100000;
  const months = kind === "short" ? 1 : 12;
  const value = monthly * months + prep;
  return { value, basis: presetBasis(`国の留学の支援制度（文部科学省「トビタテ！留学JAPAN」）の支給の上限から作った目安: 月額の奨学金 16万円×${months}か月・留学準備金 35万円（北米・欧州など）`) };
}

const abroadAddress = (goalId: string, id: string, f: string): Address => ({ target: { object: goalId }, item: "goal.education", at: ["abroad", id, f] });

/** 留学を足す（大学などがあれば大学など3年、無ければ高校2年。単位が認められる1年。額は推定） */
export function addAbroad(wh: WorkingHousehold, goalId: string, id: string = newId()): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const g = (h.goals ?? []).find((x) => x.id === goalId);
    if (g?.education === undefined) return;
    const st = g.education.stages.find((s) => isHigher(s.stage)) ?? g.education.stages.find((s) => s.stage === "highSchool");
    if (st === undefined) return;
    const est = abroadEstimate(st.stage, "credit");
    (g.education.abroad ??= []).push({ id, stage: st.stage, grade: st.stage === "highSchool" ? 2 : Math.min(3, stageYears(st)), kind: "credit", amount: est.value });
    putRow(req.input as unknown as Obj, abroadAddress(g.id, id, "amount"), { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: est.basis } });
  });
}

/** 学校か留学の形を変えたとき、額が推定のままなら新しい推定にする */
function reestimateAbroad(input: Obj, goalId: string, a: EducationAbroad): void {
  if (a.id === undefined) return;
  const addr = abroadAddress(goalId, a.id, "amount");
  if (rowAt(input, addr)?.state !== "estimated") return;
  const est = abroadEstimate(a.stage, a.kind);
  a.amount = est.value;
  putRow(input, addr, { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: est.basis } });
}

function abroadGroups(wh: WorkingHousehold, goal: Goal): GroupDef[] {
  const stages = (goal.education?.stages ?? []).filter((s) => ABROAD_STAGES.has(s.stage));
  return (goal.education?.abroad ?? []).map((a, i) => {
    const find: Finder = (hh) => (getPath((hh.goals ?? []).find((g) => g.id === goal.id), ["education", "abroad", String(i)]) as Obj | undefined) ?? undefined;
    const k = `edu/${goal.id}/abroad/${a.id ?? `n${i}`}`;
    const at = (f: string) => (a.id !== undefined ? { address: () => abroadAddress(goal.id, a.id as string, f) } : {});
    const st = stages.find((s) => s.stage === a.stage);
    const kindLabel = ABROAD_KINDS.find((x) => x.value === a.kind)?.label ?? "";
    const reest = (field: "stage" | "kind") =>
      field === "stage"
        ? (h: Household, t: Obj) => {
            const x = t as unknown as EducationAbroad;
            const s2 = (h.goals ?? []).find((g) => g.id === goal.id)?.education?.stages.find((s) => s.stage === x.stage);
            if (s2 !== undefined && x.grade > stageYears(s2)) x.grade = stageYears(s2);
          }
        : undefined;
    const withReestimate = (f: FieldDef): FieldDef => ({
      ...f,
      set: (w, v) => {
        const next = f.set(w, v);
        return mutate(next, (h, req) => {
          const x = (h.goals ?? []).find((g) => g.id === goal.id)?.education?.abroad?.[i];
          if (x !== undefined) reestimateAbroad(req.input as unknown as Obj, goal.id, x);
        });
      },
    });
    return {
      key: k,
      title: `留学 ${i + 1}: ${stageLabel(a.stage)}${a.grade}年生・${ABROAD_SHORT[a.kind] ?? kindLabel} ${manText(a.amount)}`,
      note: `${a.kind === "leave" ? "休学して留学する1年は、在籍する学校の学費・仕送りはかからず、卒業と独立が1年うしろにずれます。" : a.kind === "credit" ? "在籍する学校の学費は払い続け、卒業の時期は変わりません。" : ""}額は今の値段で入れ、教育費の上昇率で伸ばします。表の行は「教育費」で、世帯から払います`,
      level: "simple",
      fields: [
        { ...withReestimate(plain({ key: `${k}/stage`, item: "goal.education", label: "学校", level: "simple", kind: "select", options: stages.map((s) => ({ value: s.stage, label: stageLabel(s.stage) })), find, path: ["stage"], ...(reest("stage") !== undefined ? { after: reest("stage") as (h: Household, t: Obj) => void } : {}) })), ...at("stage") },
        { ...plain({ key: `${k}/grade`, item: "goal.education", label: "何年生のとき", level: "simple", kind: "int", suffix: "年生", min: 1, max: st === undefined ? 6 : stageYears(st), find, path: ["grade"], help: a.kind === "short" ? "その学年の夏（8月）に払う計算です" : "その学年の4月に払う計算です" }), ...at("grade") },
        { ...withReestimate(plain({ key: `${k}/kind`, item: "goal.education", label: "留学の形", level: "simple", kind: "select", options: ABROAD_KINDS, find, path: ["kind"], help: ABROAD_KIND_HELP })), ...at("kind") },
        { ...plain({ key: `${k}/amount`, item: "goal.education", label: "1回の額", level: "simple", kind: "yen", basis: "once", find, path: ["amount"], help: ABROAD_AMOUNT_HELP }), ...at("amount") },
        {
          ...field({
            key: `${k}/on`,
            item: "goal.education",
            label: "万一のときの扱い",
            level: "detail",
            kind: "select",
            options: ABROAD_CONTINGENCY,
            help: "万一（死亡）の想定の月の翌月より後の留学を、やめる（払わない）か続けるか",
            get: (w) => ({ value: (find(w.request.input.household, w) as unknown as EducationAbroad | undefined)?.onContingency?.mode ?? "continue", implicit: a.onContingency === undefined }),
            set: (w, v) =>
              mutate(w, (h, req) => {
                const x = find(h, { ...w, request: req }) as unknown as EducationAbroad | undefined;
                if (x === undefined) return;
                if (v === "stop") x.onContingency = { mode: "stop" };
                else delete x.onContingency;
              }),
          }),
          ...at("onContingency"),
        },
      ],
      actions: [
        removeAction(`${k}/remove`, "外す", "simple", (hh) => {
          const g = (hh.goals ?? []).find((x) => x.id === goal.id);
          if (g?.education?.abroad !== undefined) {
            g.education.abroad = g.education.abroad.filter((_, j) => j !== i);
            if (g.education.abroad.length === 0) delete g.education.abroad;
          }
        }),
      ],
    };
  });
}

const ABROAD_KIND_HELP =
  "高校は、校長が認めた外国の高校での学習を36単位まで認められるので（学校教育法施行規則第93条）、1年の留学でも3年で卒業できることが多いです。" +
  "大学は、交換留学・認定留学なら単位が認められて（大学設置基準第28条。60単位まで）卒業は延びず、休学して留学すると在学が1年延びます（休学の扱いは学校ごとの決まり）。" +
  "休学の年は、在籍する学校の学費・仕送りを計算しません（休学中の在籍料は入れていません）";
const ABROAD_AMOUNT_HELP =
  "渡航・滞在・留学先の学費などの合計（今の値段）。大学などの1年の推定は、文部科学省の委託調査（令和8年3月。半年以上の留学の経験者875件のWebアンケート）の、学位の取得でない1年以上の留学のひと月あたりの費用（合計24万円。うち授業料などは7万円）×12か月です。" +
  "地域で違い、ひと月あたり北米39万円・オセアニア41万円・ヨーロッパ28万円・アジア19万円です。高校の1年と短期の推定は、国の留学の支援制度（トビタテ！留学JAPAN）の支給の上限（月額16万円・準備金35万円）から作った目安です";

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
            label: "その他の教育費",
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

/**
 * 子が払う分（子のアルバイト・貯金。世帯の収入ではない）と給付型の奨学金・学費の助成（学資金として所得税がかからない。所得税法9条1項15号）は、
 * 非課税のほかに選ぶ扱いが無いので「課税の扱い」を出さない（前に別の扱いを入れた行は出す）
 */
const hideTax = (f: IncomeFlow, g: GroupDef): boolean => g.key === `in/${f.id}/tax` && (f.kind === "childPays" || f.kind === "scholarshipGrant") && f.taxTreatment === undefined;

function childMoneyGroups(wh: WorkingHousehold, child: Member, goal?: Goal): { groups: GroupDef[]; actions: ActionDef[] } {
  const h = wh.request.input.household;
  const groups: GroupDef[] = [...childIncomes(h, child.id).flatMap((f) => incomeGroups(wh, f, "education").filter((g) => !hideTax(f, g))), ...childExpenses(h, child.id).flatMap((p) => periodicGroups(wh, p))];
  const k = `edu/${child.id}/money`;
  const actions: ActionDef[] = [
    { key: `${k}/in/educationSupport`, label: "＋ 教育資金の援助を受ける", help: "祖父母などから受け取る教育資金です", level: "simple", run: (w) => addChildIncome(w, child.id, "educationSupport") },
    { key: `${k}/in/scholarshipGrant`, label: "＋ 給付型の奨学金・学費の助成", help: "額を入れます", level: "detail", run: (w) => addChildIncome(w, child.id, "scholarshipGrant") },
    { key: `${k}/in/childPays`, label: "＋ 子が払う分", help: "子のアルバイト・子の貯金から学費に充てる分です", level: "detail", run: (w) => addChildIncome(w, child.id, "childPays") },
    ...(goal !== undefined && (goal.education?.stages ?? []).some((s) => ABROAD_STAGES.has(s.stage)) ? [{ key: `${k}/out/abroad`, label: "＋ 留学", help: "1回ずつ足します。何回も留学するときは、もう一度押して足します", level: "simple" as const, run: (w: WorkingHousehold) => addAbroad(w, goal.id) }] : []),
    { key: `${k}/out/other`, label: "＋ その他の教育費", help: "寮費・部活などの教育費です", level: "detail", run: (w) => addChildExpense(w, child.id, "other") },
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

/**
 * 子の独立（世帯を離れる時点。member.leaves）は、最後の学校の終わり（卒業の翌月の4月）に合わせて自動で決める（欄は出さない。refreshLeaves）。
 * 前に年月などで入れた子（標準の形でない独立）だけ、読むだけの1行と「最後の学校の終わりに合わせる」を出す（黙って書き換えない）
 */
function leavesGroups(child: Member): GroupDef[] {
  if (isSchoolLinkedLeaves(child)) return [];
  const text = child.leaves === null ? "独立しない" : (child.leaves?.at ?? "前に入れた時期");
  return [
    {
      key: `edu/${child.id}/leaves`,
      title: `独立の時期: ${text}（前に入れた値）`,
      note: "いまは独立の時期を最後の学校の終わりに合わせて決めています。この子は前に入れた時期のまま計算しています",
      level: "detail",
      fields: [],
      actions: [{ key: `family/${child.id}/leavesStandard`, label: "最後の学校の終わりに合わせる", level: "detail", run: (w) => leavesToSchool(w, child.id) }],
    },
  ];
}

/** 子への援助の優先度（0103。ふつうの出るお金の行と同じ2つ） */
const GIFT_PRIORITIES = [
  { value: "need", label: "必ず" },
  { value: "want", label: "できれば" },
];

function giftGroups(wh: WorkingHousehold, goal: Goal, child: Member, who: string): GroupDef[] {
  const find = byId(goals, goal.id);
  return (goal.education?.gifts ?? []).map((gift, i) => {
    const findG: Finder = (hh) => (getPath((hh.goals ?? []).find((g) => g.id === goal.id), ["education", "gifts", String(i)]) as Obj | undefined) ?? undefined;
    const k = `edu/${goal.id}/gift/${i}`;
    return {
      key: k,
      title: `${who}への援助 ${i + 1}`,
      note: `結婚・住宅資金などの援助です。相続・贈与の項目にも出ます${gift.donor !== undefined ? "。贈与する人から出すので、援助の額を世帯から出しません" : ""}`,
      level: "simple",
      fields: [
        plain({ key: `${k}/purpose`, item: "goal.education", label: "使い道", level: "simple", kind: "select", options: GIFT_PURPOSES, find: findG, path: ["purpose"] }),
        plain({ key: `${k}/amount`, item: "goal.education", label: "額", level: "simple", kind: "yen", basis: "once", find: findG, path: ["amount"] }),
        timepointField({ key: `${k}/at`, item: "goal.education", label: "時期", level: "simple", find: findG, path: ["at"], ageOf: (hh) => hh.members.find((m) => m.id === child.id) }),
        // 優先度（0103）: ふつうの出るお金の行と同じ「必ず」「できれば」。「確実な分だけ」の見方で「できれば」の援助を外す。省略は必ず
        plain({ key: `${k}/priority`, item: "goal.education", label: "優先度", level: "simple", kind: "select", options: GIFT_PRIORITIES, find: findG, path: ["priority"], optional: true, fallback: "need", help: "結果の「確実な分だけ」で、「できれば」の援助を外して見られます" }),
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
  const money = childMoneyGroups(wh, child, goal);
  const noneAction: ActionDef = { key: `edu/${child.id}/none`, label: "この子の教育費を入れない", help: "この子の教育費を「該当なし」にします", level: "detail", run: (w) => educationNotApplicable(w, child.id) };
  if (goal === undefined) {
    const course = defaultCourseLabel(child, base);
    const has = defaultStages(child, base).length > 0;
    const leaves = leavesGroups(child);
    return {
      key: `edu/${child.id}`,
      title: who,
      note: has ? `未入力（教育費0円で計算中）。進路が入っていません。「推定の進路で埋める」で既定の型「${course}」を推定で入れます` : "これからの学校の段が無い年齢です（教育費は計算していません）",
      level: "simple",
      groups: [...leaves, ...money.groups],
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
    label: "保育園（2歳まで）に通う",
    level: "simple",
    kind: "bool",
    structural: true,
    help: "はいにすると、0〜2歳の保育料を世帯の収入から自動で計算します（目安）。3歳の4月からは「保育園・幼稚園（3歳から）」の段で、保育料は無償化で0円です",
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
    options: [{ value: "", label: "自分で選ぶ" }, ...COURSE_PRESETS.map((p) => ({ value: p.value, label: p.label }))],
    structural: true,
    // 進路の推定・該当なしの印（値の状態の行）は、進路の段の並び全体に付く（fill.ts）
    address: () => educationStagesAddress(goal.id),
    get: (w) => ({ value: presetOf(((find(w.request.input.household, w) as Goal | undefined)?.education?.stages ?? []) as EducationStage[]) }),
    set: (w, v) =>
      mutate(w, (hh) => {
        const p = COURSE_PRESETS.find((x) => x.value === v);
        const g = find(hh, w) as Goal | undefined;
        if (p === undefined || g?.education === undefined) return;
        for (const s of g.education.stages) {
          if (p.sectors[s.stage] === undefined) continue;
          const prev = structuredClone(s);
          s.sector = p.sectors[s.stage];
          if ((prev.sector ?? "public") !== s.sector) dropStaleEstimates(prev, s, lunchOf(g));
        }
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
    help: "選び直しても、通い方・浪人・仕送り・入れた年額はそのまま残ります。専門学校は学費の統計が無いので、年額を入れてください",
    get: (w) => ({ value: (((find(w.request.input.household, w) as Goal | undefined)?.education?.stages ?? []) as EducationStage[]).find((s) => isHigher(s.stage))?.stage ?? "none" }),
    set: (w, v) =>
      mutate(w, (hh) => {
        const g = find(hh, w) as Goal | undefined;
        if (g?.education !== undefined && typeof v === "string") g.education.stages = replaceHigher(g.education.stages, v);
      }),
  });
  const row = rowAt(wh.request.input as unknown as Record<string, unknown>, educationStagesAddress(goal.id));
  const hasHigh = stages.some((s) => s.stage === "highSchool" || s.stage === "kosen");
  const groups: GroupDef[] = [
    {
      key: `edu/${goal.id}`,
      title: `${who}の進路`,
      ...(row?.state === "notApplicable"
        ? { note: "教育費は「該当なし」にしています（段を足すと計算します）" }
        : row?.state === "estimated"
          ? { note: `進路は、ふつうの進み方${(row.estimate?.basis === EDUCATION_BASIS || row.estimate?.basis === EDUCATION_BASIS.replace("既定", "標準")) ? `（「${defaultCourseLabel(child, base)}」）` : ""}の目安で計算しています。実際の予定に合わせて直せます` }
          : {}),
      level: "simple",
      fields: [
        course,
        ...(row?.state === "notApplicable" ? [] : [higher]),
        ...(nurseryAge ? [nurseryToggle] : []),
        ...(outOfSchoolModeOf(goal) === "rows" ? [] : [uniformOutOfSchool(goal)]),
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
                  { value: "ineligible", label: "対象外" },
                ],
                find,
                path: ["education", "highSchoolSupport"],
                optional: true,
                fallback: "",
                help: "高校の授業料の支援（2026年度から所得の制限なし）。対象外にすると支援を計算しません",
              }),
            ]
          : []),
      ],
      actions: [removeAction(`edu/${goal.id}/remove`, "進路を外す", "detail", (hh) => void (hh.goals = (hh.goals ?? []).filter((g) => g.id !== goal.id))), ...(row?.state === "notApplicable" ? [] : [noneAction])],
    },
  ];
  groups.push(...leavesGroups(child));
  const start = nurseryDefaultStart(h, child);
  stages.forEach((s, i) => {
    const entryAge = STAGE_AGE[s.stage];
    const note =
      s.stage !== "nursery"
        ? stageNote(s, lunchOf(goal))
        : s.monthly === undefined
          ? `${nurseryMethodNote()}${free !== null ? `${free.slice(0, 4)}年4月からは無償化で0円。` : ""}月額が分かれば「詳細」で入れられます`
          : s.monthly === 0
            ? "保育料なし（月額 0 円を入れています）"
            : `保育料は入力した月額（${formatYen(s.monthly, "yen")}円）で計算します。消すと収入から自動で計算します`;
    groups.push({
      key: `edu/${goal.id}/stage/${i}`,
      title: `${stageLabel(s.stage)}${entryAge !== undefined && s.stage !== "kindergarten" ? `（${entryAge}歳から）` : ""}`,
      // 大学院は前の学校を出た翌月の4月から（STAGE_AGE に無いので年齢は添えない）
      ...(note !== undefined && note !== "" ? { note } : {}),
      level: "simple",
      fields: stageFields(goal.id, i, s, `${start.ym}（${start.reason}）`, outOfSchoolModeOf(goal) === "rows"),
      actions: [
        removeAction(`edu/${goal.id}/stage/${i}/remove`, s.stage === "university" ? "大学に行かない" : "この段を外す", "simple", (hh) => {
          const g = find(hh, wh) as Goal | undefined;
          if (g?.education !== undefined) g.education.stages = g.education.stages.filter((_, j) => j !== i);
        }),
      ],
    });
  });
  const have = new Set(stages.map((s) => s.stage));
  const tertiary = stages.find((s) => isHigher(s.stage));
  // 足すボタンは、この子の年齢でこれからの段だけ（終わった段・3歳の4月を過ぎた保育園は出さない。0062 の追記 2026-10-30）
  const upcoming = SCHOOL_STAGES.filter((o) => !stageEnded(child, { stage: o.value }, base));
  // 高校と高専はどちらか1つ（高校の段の「高校・高専」で入れ替える。0090）
  const highOrKosen = have.has("highSchool") || have.has("kosen");
  const addActions: ActionDef[] = upcoming.filter((o) => !have.has(o.value) && !(isHigher(o.value) && stages.some((s) => isHigher(s.stage))) && !(isGraduate(o.value) && tertiary === undefined) && !((o.value === "highSchool" || o.value === "kosen") && highOrKosen)).map((o) => ({
    key: `edu/${goal.id}/addStage/${o.value}`,
    label: `＋ ${o.label}`,
    level: o.value === "university" || o.value === "highSchool" ? "simple" : "detail",
    run: (w) =>
      mutate(w, (hh) => {
        const g = find(hh, w) as Goal | undefined;
        if (g?.education === undefined) return;
        const prev = g.education.stages.find((s) => isHigher(s.stage));
        const st: EducationStage =
          o.value === "university"
            ? { stage: o.value, sector: "private", field: "humanities", living: "home" }
            : o.value === "nursery"
              ? { stage: o.value }
              : isGraduate(o.value)
                ? { stage: o.value, sector: prev?.sector === "national" || prev?.sector === "public" ? prev.sector : "private", living: prev?.living ?? "home" }
                : o.value === "kosen"
                  ? { stage: o.value, sector: "national" }
                : { stage: o.value, sector: o.value === "juniorCollege" || o.value === "vocational" ? "private" : "public" };
        g.education.stages = [...g.education.stages, { id: newId(), ...st }].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
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
  groups.push(...abroadGroups(wh, goal), ...money.groups, ...giftGroups(wh, goal, child, who));
  groups.push({
    key: `edu/${goal.id}/addMore`,
    level: "simple",
    fields: [],
    actions: [
      ...money.actions,
      {
        key: `edu/${goal.id}/addGift`,
        label: "＋ 子への援助", help: "結婚・住宅資金などの援助です。相続・贈与の項目にも出ます",
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
  // 進路の段・学校外の費用・奨学金・援助などは、1つずつ足して外せる物（それぞれ自分の枠。進路の枠の中に入れない。ownBox）
  const own = (g: GroupDef): GroupDef => (g.key.startsWith(`edu/${goal.id}/`) ? { ...g, ownBox: true } : g);
  return { key: `edu/${child.id}`, title: who, level: "simple", groups: groups.map(own), actions: [] };
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
    lead: "子ごとの進路。学費は統計の平均（文部科学省「子供の学習費調査」など）で、保育料は世帯の収入から（国の基準と自治体の保育料の水準の目安）計算します。",
    sections: [...sections, ...money],
  };
}

// 6. 子ども・教育（0010・0029・0062）: 子ごとの区画に、進路・段ごとの費用・学校外の費用・奨学金と教育ローン・この子の入るお金と出るお金・子への援助。
// - 進路: 学校の行ごとの公立・私立・系統と通い方・保育園。高校のあとの学校は、大学などの行の先頭の「大学・短大・専門学校」で選ぶ（「大学などに
//   行かない」でも行は欄だけで残る。2026-11-14。進路の型の欄は入力から外し、結果のタブの動かす項目だけで使う）。学費は統計の平均
//   （文部科学省「子供の学習費調査」など）で、段の見出しに年額を読むだけで出し、詳細で年額・入学金・仕送りを上書きできる
// - 専門学校は統計の目安が無いので、年額を入れるまで未入力の警告（0円で計算中）。公立の短大は私立の短大の平均で仮に計算（知らせる）。
//   国の修学支援は大学だけを計算し、短大・専門学校はまだ計算しないことを段の1行で知らせる（計算エンジンの知らせは画面に出ないため）
// - 学校外の費用（0062・0063。2026-11-14 の見直し）: すべて統計の平均／すべて入れない／学校ごとに入れる（学校の行ごとの月額。大学などは統計が
//   無いので空欄は0円）／塾・習い事を別に入れる（期間と月額の行。統計の平均は足さない。統計の平均の行は作らない）。入れ方の無い古い世帯で
//   行がある物は、前の形（統計の平均に行を足す）のまま読み、切り替えを勧める
// - 児童手当・高校の就学支援金の欄は詳細だけ（標準の「▸」の中にも出さない）
// - この子のお金の行（0044）: 入るお金は受け取る人がその子か、時期がその子の年齢の行。出るお金は時期がその子の年齢の行（留学など）。
//   子を決めていない教育のお金の行は、カードの後ろの区画
// - 保育園（0〜2歳）は「通う・通わない」と通い始めを標準で聞き、保育料は月額を入れなければ収入から自動で計算する（目安。0029）。
//   共働き・働くひとり親の世帯は、推定の進路で通う（2026-11-14）。詳細で施設の種類・自治体の独自の無償化・延長保育を入れる
// - 学校名は学校の一覧（文部科学省の学校コード一覧）から探して選ぶ（schoolField.ts。0217）。学費の実データはまだ無いので、選んでも平均で計算する
import type { EducationAbroad, EducationLesson, EducationLoan, EducationScholarship, EducationStage, Goal, Household, IncomeFlow, IncomeFlowKind, Member, PeriodicExpense, Timepoint } from "../../../engine/types.ts";
import { schoolEntryYear } from "../../present.ts";
import { addMonths, ageAt } from "../../levers.ts";
import { byId, field, getPath, plain, removeAction, resolveTimepoint, timepointField, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { isSchoolLinkedLeaves, mutate, newId, presetBasis, standardBox, type WorkingHousehold } from "../household.ts";
import { amountText, formatYearMonth, formatYen } from "../units.ts";
import { EDUCATION_BASIS, educationStagesAddress, fillEducation, leavesToSchool, stageEnded } from "../fill.ts";
import { putRow, rowAt, type StateRow } from "../rows.ts";
import { addIncome, expenseCard, incomeCard, incomeGroups, incomeMoreLabel, moneySections, periodicGroups, PRIORITIES, likelihoodHelp } from "../moneyRows.ts";
import { boardingStatistic, estimateYen, examStatistic, INTERNATIONAL_MISSING, KOSEN_MISSING, isGraduate, isHigher, isK12, isTertiary, manText, STAGE_START_AGE, stagePeriod, stageStatistic, stageYears, VOCATIONAL_GUIDE } from "../educationCost.ts";
import { masterAmount, regulationValue } from "../../../../../hearing/src/statistics.ts";
import { childOfPeriodic } from "./events.ts";
import { departmentField, schoolNameField, showsSchoolField } from "../schoolField.ts";
import { donorOptions, FIELDS, GIFT_PURPOSES, HOUSING_EXEMPTION, LIVING_PLACE, memberLabel, memberOptions, NURSERY_HOURS, SCHOOL_STAGES, SECTORS, TAX_METHODS, WORDS } from "../labels.ts";
import type { Address } from "../../store/readings.ts";
import { scholarshipRateEstimate } from "../../../../../hearing/src/loanRates.ts";
import { officeBasisOf, presetIsOffice, presetNum, presetRate, presetText } from "../../../../../hearing/src/presets.ts";
import { pctText } from "../../../../../hearing/src/housingEstimates.ts";

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
  { value: "allPublic", label: "すべて公立（国公立大）", sectors: { kindergarten: "public", elementary: "public", juniorHigh: "public", highSchool: "public", university: "national" } },
  { value: "univPrivate", label: "大学だけ私立", sectors: { kindergarten: "public", elementary: "public", juniorHigh: "public", highSchool: "public", university: "private" } },
  { value: "highPrivate", label: "高校から私立", sectors: { kindergarten: "public", elementary: "public", juniorHigh: "public", highSchool: "private", university: "private" } },
  { value: "juniorPrivate", label: "中学から私立", sectors: { kindergarten: "private", elementary: "public", juniorHigh: "private", highSchool: "private", university: "private" } },
  { value: "allPrivate", label: "すべて私立", sectors: { kindergarten: "private", elementary: "private", juniorHigh: "private", highSchool: "private", university: "private" } },
];

/**
 * 段の並びが当たる進路の型（当たらなければ ""＝自分で選ぶ）。型に無い段は、型のどの段の代わりかで比較する:
 * 高校のあとの短大・専門学校は大学の代わり、高専は高校の代わり（型を選ぶとその段の公立・私立は変えないので、合わなければ「自分で選ぶ」になる）。
 * 代わりに比較するときは、国立と公立を同じ側（国公立）として比較する。大学院は型の外なので比較しない
 */
export function presetOf(stages: readonly EducationStage[]): string {
  // 公立・私立の欄で「公立」を選ぶと値が空になる（空は公立。計算も同じ）ので、空は公立として型と比較する
  const side = (x: string) => (x === "national" ? "public" : x);
  const matches = (p: (typeof COURSE_PRESETS)[number], s: EducationStage): boolean => {
    const sector = s.sector ?? "public";
    const own = p.sectors[s.stage];
    if (own !== undefined) return own === sector;
    const slot = s.stage === "juniorCollege" || s.stage === "vocational" ? "university" : s.stage === "kosen" ? "highSchool" : null;
    if (slot === null) return true;
    const want = p.sectors[slot];
    return want === undefined || side(want) === side(sector);
  };
  for (const p of COURSE_PRESETS) if (stages.length > 0 && stages.every((s) => matches(p, s))) return p.value;
  return "";
}

/**
 * 進路の型を当てる（結果のタブの動かす項目「進路の型」と AI の接続口の educationCourse。入力の欄は 2026-11-14 に外した）: 教育の目標の段のうち、型が決める段
 * （幼稚園〜大学）の公立・私立を型のとおりにする。公立・私立が変わった段は、前の学校の推定の額をそのまま入れた年額・入学金を外す
 * （dropStaleEstimates）。型に無い段（短大・専門学校・高専・大学院・保育園）は変えない。知らない型・教育の目標が無いときは変えない
 */
export function setCoursePreset(w: WorkingHousehold, goalId: string, preset: string): WorkingHousehold {
  const p = COURSE_PRESETS.find((x) => x.value === preset);
  if (p === undefined) return w;
  return mutate(w, (hh) => {
    const g = (hh.goals ?? []).find((x) => x.id === goalId);
    if (g?.education === undefined) return;
    for (const s of g.education.stages) {
      if (p.sectors[s.stage] === undefined) continue;
      const prev = structuredClone(s);
      s.sector = p.sectors[s.stage];
      if ((prev.sector ?? "public") !== s.sector) dropStaleEstimates(prev, s, lunchOf(g));
    }
  });
}

/**
 * 子の「進路の型」の欄の定義（教育の目標ごと）。入力の子ども・教育の入力項目には出さない（2026-11-14 に外した。学校ごとに公立・私立を選ぶ）。
 * 結果のタブの動かす項目「進路の型」（plans/items.ts）と AI の接続口が、この欄の読み・書き（同じ型・同じ関数・同じ後始末）で動かす
 */
export function courseField(goalId: string): FieldDef {
  const find = byId(goals, goalId);
  return field({
    key: `edu/${goalId}/preset`,
    item: "goal.education",
    label: "進路の型",
    level: "simple",
    kind: "select",
    options: [{ value: "", label: "自分で選ぶ" }, ...COURSE_PRESETS.map((p) => ({ value: p.value, label: p.label }))],
    structural: true,
    // 進路の推定・該当なしの印（値の状態の行）は、進路の段の並び全体に付く（fill.ts）
    address: () => educationStagesAddress(goalId),
    get: (w) => {
      const st = ((find(w.request.input.household, w) as Goal | undefined)?.education?.stages ?? []) as EducationStage[];
      const outside = presetOutsideStages(st);
      return { value: presetOf(st), ...(outside.length > 0 ? { hint: `${outside.join("・")}の公立・私立は型では変わりません（その段階で選びます）` } : {}) };
    },
    set: (w, v) => (typeof v === "string" ? setCoursePreset(w, goalId, v) : w),
  });
}

/** 進路の型で公立・私立が変わらない段（高校のあとの短大・専門学校・高専）の名前。型の欄の下の1行に出す */
export function presetOutsideStages(stages: readonly EducationStage[]): string[] {
  return stages.filter((s) => s.stage === "juniorCollege" || s.stage === "vocational" || s.stage === "kosen").map((s) => stageLabel(s.stage));
}

/**
 * 保育園（0〜2歳）に既定で通うか（2026-11-14）: これから保育の年齢（3歳の4月の前）がある子（生まれる予定の子を含む）で、通い始めの既定の月
 * （育児休業の終わりの翌月、無ければ1歳の4月。計算の基準の月より前なら基準の月）に、その子の親（親子の関係。無ければ本人・配偶者）が
 * 2人とも働いている（共働き）か、親が1人でその親が働いている（働くひとり親）。働いているは、その月を含む働き方の期間が「働いていない」でないこと
 * （育児休業の期間は働いているに数える）。保育所の利用には就労などの「保育の必要性」の認定が要るので、片方が働いていない世帯は通わない
 */
export function nurseryByDefault(h: Household, child: Member, baseMonth: string): boolean {
  const free = nurseryFreeMonth(child);
  if (free === null || free <= baseMonth) return false;
  const start = nurseryDefaultStart(h, child).ym;
  const at = start < baseMonth ? baseMonth : start;
  const rel = (h.relations ?? []).filter((r) => r.type === "parentOf" && (r as { child?: string }).child === child.id).map((r) => (r as { parent?: string }).parent);
  const parents = h.members.filter((m) => (rel.length > 0 ? rel.includes(m.id) : m.kind === "self" || m.kind === "spouse") && (m.kind === "self" || m.kind === "spouse"));
  const present = parents.filter((m) => {
    const joins = resolveTimepoint(h, m.joins ?? null);
    const leaves = resolveTimepoint(h, m.leaves ?? null);
    return (joins === null || joins <= at) && (leaves === null || leaves > at);
  });
  if (present.length === 0) return false;
  const works = (m: Member) =>
    (h.employmentPeriods ?? []).some((p) => {
      if (p.member !== m.id || p.type === "unemployed") return false;
      const from = resolveTimepoint(h, p.from);
      const to = p.to === null ? null : resolveTimepoint(h, p.to);
      return from !== null && from <= at && (to === null || to >= at);
    });
  return present.every(works);
}

/**
 * 今からの進路の初めの形: 子の年齢から、まだ終わっていない段だけ。進路の型の「大学だけ私立」（幼稚園〜高校は公立、大学は私立・文系・自宅。0010 の追記 2026-10-25）。
 * 世帯を渡すと、共働き・働くひとり親の世帯でこれから保育の年齢がある子は、保育園（2歳まで）の段も入れる（nurseryByDefault。2026-11-14）
 */
export function defaultStages(child: Member, baseMonth: string, h?: Household): EducationStage[] {
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
  if (h !== undefined && out.length > 0 && nurseryByDefault(h, child, baseMonth)) out.unshift({ stage: "nursery" });
  return out;
}

/**
 * 教育の段がもう全部過ぎた子か（通しの確かめ。0150。独立した34歳の子など）: 進路が入っていれば、どの段も終わっている。進路が無ければ、
 * この年齢でこれからの段が無い。これからの段がある子・奨学金や教育ローンなどの物がある子は過ぎていない
 */
export function educationFinished(child: Member, goal: Goal | undefined, baseMonth: string): boolean {
  const e = goal?.education;
  // 奨学金・教育ローン・援助・留学・習い事の物があれば、今までどおりの区画（返済などが続くため）
  if (e !== undefined && [e.scholarships, e.loans, e.gifts, e.lessons, e.abroad].some((x) => (x ?? []).length > 0)) return false;
  const stages = e?.stages ?? [];
  if (stages.length === 0) return defaultStages(child, baseMonth).length === 0;
  return stages.every((s) => stageEnded(child, s, baseMonth));
}

/** 教育の段が全部過ぎた子の区画の見出しの横の1行（推定に数えない。進路の欄は出さない。「?」の中は FINISHED_HELP） */
export const finishedSummary = (child: Member, baseMonth: string): string => `${ageAt(child, baseMonth)}歳・教育は終わっています`;
const FINISHED_HELP = "教育の段階（幼稚園〜大学）がもう全部過ぎているので、この子の教育費は計算していません。仕送り・援助などのこの子のお金は、下の「＋」で入れます";

/** 標準の進路の型の名前（ボタンと推定の印に出す。入る型とずらさない） */
export function defaultCourseLabel(child: Member, baseMonth: string): string {
  const stages = defaultStages(child, baseMonth);
  const p = COURSE_PRESETS.find((x) => x.value === presetOf(stages));
  const univ = stages.some((s) => s.stage === "university");
  return p === undefined ? "公立・私立は後で選ぶ" : `${p.label}${univ ? "〔文系・自宅〕" : ""}`;
}

// ---- 学校外の費用（0062・0063。2026-11-14 の見直しは 0134 の追記） ----

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

/** 学校外の費用の1つの欄の選択肢（前の形の世帯だけ「前の形」も足す）。言葉に「段階」を使わない（2026-11-14） */
export const OUT_OF_SCHOOL_CHOICES = [
  { value: "statistics", label: "すべて統計の平均" },
  { value: "none", label: "すべて入れない" },
  { value: "custom", label: "学校ごとに入れる" },
  { value: "rows", label: "塾・習い事を別に入れる" },
];

/**
 * 幼稚園〜高校のほかに、学校ごとの学校外の費用（月額）を入れられる学校（高専・大学・短大・専門学校）。統計の平均が無いので、
 * 空欄は0円（計算エンジンの education.cost の改訂11: 月額を入れた段だけ数える）
 */
export const isOtherOutStage = (stage: string): boolean => stage === "kosen" || isHigher(stage);

/**
 * 今の学校外の費用の選び方（1つの欄の値）。世帯ファイルは段ごとの outOfSchool と、目標の outOfSchoolMode のまま:
 * - rows・legacy は入れ方のとおり
 * - 幼稚園〜高校がすべて統計の平均（省略を含む）で、高専・大学などに額が無い → statistics
 * - 幼稚園〜高校がすべて「無し」で、高専・大学などが「無し」か省略（どこかに「無し」がある）→ none
 * - ほか（額を入れた学校がある・混ざっている）→ custom
 */
export function outOfSchoolChoiceOf(goal: Goal | undefined): "statistics" | "none" | "custom" | "rows" | "legacy" {
  if (goal === undefined) return "statistics";
  const mode = outOfSchoolModeOf(goal);
  if (mode !== "statistics") return mode;
  const stages = goal.education?.stages ?? [];
  const xs = stages.filter((s) => isK12(s.stage)).map((s) => s.outOfSchool);
  const ys = stages.filter((s) => isOtherOutStage(s.stage)).map((s) => s.outOfSchool);
  const isStat = (x: EducationStage["outOfSchool"]) => x === undefined || x === "statistics";
  if (xs.every(isStat) && ys.every(isStat)) return "statistics";
  if (xs.every((x) => x === "none") && ys.every((y) => y === undefined || y === "none") && [...xs, ...ys].some((x) => x === "none")) return "none";
  return "custom";
}

/**
 * 学校外の費用（塾・習い事など）の欄（標準。1つの欄）:
 * - すべて統計の平均: 学校ごとの額を外す（幼稚園〜高校は統計の平均、高専・大学などは0円。行で入れていたら入れ方を統計に戻す。行は消さずに残す）
 * - すべて入れない: 学校ごとに「無し」
 * - 学校ごとに入れる: 学校の行ごとに月額の欄を標準で出す。幼稚園〜高校で額の入っていない学校（「無し」を含む）に統計の平均の月額を推定で入れる。
 *   高専・大学などは空欄（0円）のまま。どの学校にも額が入らない（幼稚園〜高校が無い）ときは、選んだことが残るよう最初の学校に0円を入れる
 * - 塾・習い事を別に入れる: 入れ方を行にする（学校ごとの額は数えない。統計の平均の行は作らない。2026-11-14）
 */
function uniformOutOfSchool(goal: Goal): FieldDef {
  const find = byId(goals, goal.id);
  const legacy = outOfSchoolModeOf(goal) === "legacy";
  return {
    ...field({
      key: `edu/${goal.id}/outUniform`,
      item: "goal.education",
      label: "学校外の費用（塾・習い事など）",
      level: "simple",
      kind: "select",
      options: [...OUT_OF_SCHOOL_CHOICES, ...(legacy ? [LEGACY_MODE] : [])],
      structural: true,
      sideEffects: "「学校ごとに入れる」は、額の入っていない幼稚園〜高校に統計の平均の月額（推定）を入れます。「塾・習い事を別に入れる」で入れた行は、ほかに戻しても残します（使いません）",
      help:
        "幼稚園〜高校の塾・家庭教師・習い事・体験などの費用です。統計の平均（子供の学習費調査の学校外活動費）は、塾や習い事をしていない子も含めた平均です。" +
        "「学校ごとに入れる」は学校の行ごとの月額で（大学などは統計の平均が無いので、資格の予備校などがあれば入れます）、「塾・習い事を別に入れる」は塾・習い事ごとの期間と月額で入れます（統計の平均は足さないので二重になりません）",
      get: (w) => {
        const v = outOfSchoolChoiceOf(find(w.request.input.household, w) as Goal | undefined);
        return v === "statistics" ? { value: v, implicit: true } : { value: v };
      },
      set: (w, v) => {
        if (v === LEGACY_MODE.value || typeof v !== "string") return w;
        return mutate(w, (hh, req) => {
          const g = find(hh, w) as Goal | undefined;
          if (g?.education === undefined) return;
          if (v === "rows") {
            g.education.outOfSchoolMode = "rows";
            return;
          }
          if (outOfSchoolModeOf(g) !== "statistics") g.education.outOfSchoolMode = "statistics";
          const schools = g.education.stages.filter((s) => isK12(s.stage) || isOtherOutStage(s.stage));
          for (const s of schools) {
            if (v === "none") s.outOfSchool = "none";
            else if (v === "statistics") delete s.outOfSchool;
            else if (v === "custom") {
              if (typeof s.outOfSchool === "object") continue;
              if (!isK12(s.stage)) {
                delete s.outOfSchool;
                continue;
              }
              const stat = stageStatistic(s);
              if (stat?.outOfSchool == null) continue;
              const sid = typeof s.id === "string" ? s.id : newId();
              s.id = sid;
              // 欄に入れる推定は千円単位（0041 の追記 2026-11-14）
              s.outOfSchool = { monthly: estimateYen(stat.outOfSchool / 12) };
              putRow(req.input as unknown as Obj, { target: { object: g.id }, item: "goal.education", at: ["stages", sid, "outOfSchool", "monthly"] }, statRow(OUT_OF_SCHOOL_BASIS));
            }
          }
          // 選んだことが残るように（額の入る学校が無いとき）: 最初の学校に0円
          const first = schools[0];
          if (v === "custom" && first !== undefined && !schools.some((s) => typeof s.outOfSchool === "object")) first.outOfSchool = { monthly: 0 };
        });
      },
    }),
    address: () => ({ target: { object: goal.id }, item: "goal.education", at: ["outOfSchoolMode"] }),
  };
}

/** 前の形の行の説明（統計の平均の上に足す） */
const LESSONS_HELP = "幼稚園〜高校の間は、統計の平均の学校外活動費（塾・習い事・家庭での学習などを含む）がすでに入っています。ここに入れた月謝は、その上に足されます";
const ROWS_HELP = "入れた塾・習い事の行だけで数えます（統計の平均の学校外活動費は足しません）";

const lessonAddress = (goalId: string, lessonId: string, ...rest: string[]): Address => ({ target: { object: goalId }, item: "goal.education", at: ["lessons", lessonId, ...rest] });
const statRow = (basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis } });

/**
 * 塾・習い事のまとまり（学校の行の後ろ。2026-11-14）: 入れ方が「塾・習い事を別に入れる」（前の形を含む）のときは、標準で行の欄（名前・種類・月額・
 * 始まり・終わり）と「＋ 塾・習い事を足す」を出す。統計の平均で入れていて使っていない行があるときは、詳細にだけ見出しと説明を出す
 */
function outOfSchoolGroups(wh: WorkingHousehold, goal: Goal, child: Member): GroupDef[] {
  const find = byId(goals, goal.id);
  const mode = outOfSchoolModeOf(goal);
  const lessons = goal.education?.lessons ?? [];
  const blockKey = `edu/${goal.id}/out`;
  if (mode === "statistics") {
    const note = `学校外の費用は${outOfSchoolChoiceOf(goal) === "custom" ? "学校ごとに入れた額" : "学校ごとの額（推定は統計の平均）"}で計算しています。塾・習い事の行 ${lessons.length}件は使っていません（「学校外の費用」を「塾・習い事を別に入れる」にすると使います）`;
    return lessons.length > 0 ? [{ key: blockKey, title: "塾・習い事の行（使っていません）", note, level: "detail", fields: [], actions: [] }] : [];
  }
  const note =
    mode === "rows"
      ? lessons.length > 0
        ? `学校外の費用は、ここに入れた塾・習い事 ${lessons.length}件で計算しています（統計の平均は足しません）`
        : "学校外の費用は、ここに入れた塾・習い事だけで計算します（統計の平均は足しません）。まだ入っていません（0円で計算中）。「＋ 塾・習い事を足す」で足します"
      : `前の形: 統計の平均（塾・習い事を含む）に行 ${lessons.length}件を足しています。二重になっていないか確かめ、「学校外の費用」を「すべて統計の平均」か「塾・習い事を別に入れる」に切り替えてください`;
  const out: GroupDef[] = [{ key: blockKey, title: "塾・習い事", note, level: "simple", fields: [], actions: [] }];
  const ageOf = (hh: Household) => hh.members.find((m) => m.id === child.id);
  lessons.forEach((l, i) => {
    const findL: Finder = (hh) => (getPath((hh.goals ?? []).find((g) => g.id === goal.id), ["education", "lessons", String(i)]) as Obj | undefined) ?? undefined;
    const k = `edu/${goal.id}/lesson/${i}`;
    const at = (...rest: string[]) => (l.id !== undefined ? { address: () => lessonAddress(goal.id, l.id as string, ...rest) } : {});
    const kindLabel = LESSON_KINDS.find((x) => x.value === l.kind)?.label;
    const range = [resolveTimepoint(wh.request.input.household, l.from), resolveTimepoint(wh.request.input.household, l.to)].map((x) => (x === null ? "" : formatYearMonth(x)));
    out.push({
      key: k,
      title: `${l.label ?? kindLabel ?? "塾・習い事"} ${amountText(l.monthly, "month")}（${range[0]}〜${range[1]}）`,
      ...(mode === "legacy" ? { note: "幼稚園〜高校の間は、統計の平均の学校外活動費（塾・習い事を含む）が既定で入っています。この月謝はその上に足すので、平均より多くかかる分だけを入れると二重になりません" } : {}),
      level: "simple",
      // 塾・習い事のまとまりの枠の中に描く（行のキーは今のまま）
      partOf: blockKey,
      fields: [
        { ...plain({ key: `${k}/label`, item: "goal.education", label: "名前", level: "simple", kind: "text", find: findL, path: ["label"], optional: true }), ...at("label") },
        { ...plain({ key: `${k}/kind`, item: "goal.education", label: "種類", level: "simple", kind: "select", options: LESSON_KINDS, find: findL, path: ["kind"], optional: true, fallback: "cram" }), ...at("kind") },
        { ...plain({ key: `${k}/monthly`, item: "goal.education", label: "月額", level: "simple", kind: "yen", basis: "monthly", find: findL, path: ["monthly"], help: mode === "legacy" ? LESSONS_HELP : ROWS_HELP }), ...at("monthly") },
        timepointField({ key: `${k}/from`, item: "goal.education", label: "始まり", level: "simple", find: findL, path: ["from"], ageOf }),
        timepointField({ key: `${k}/to`, item: "goal.education", label: "終わり", level: "simple", find: findL, path: ["to"], startPath: ["from"], ageOf }),
      ],
      actions: [
        removeAction(`${k}/remove`, "外す", "simple", (hh) => {
          const g = find(hh, wh) as Goal | undefined;
          if (g?.education?.lessons !== undefined) {
            g.education.lessons = g.education.lessons.filter((_, j) => j !== i);
            if (g.education.lessons.length === 0) delete g.education.lessons;
          }
        }),
      ],
    });
  });
  const choice = { key: `edu/${goal.id}/addLesson`, label: "＋ 塾・習い事を足す", help: `塾・習い事・その他から選んで、1つずつ足します（期間は今から3年。月額・期間を直します）。${mode === "legacy" ? LESSONS_HELP : ROWS_HELP}` };
  const addLesson = (kind: "cram" | "lesson" | "other", label: string, monthly: number): ActionDef => ({
    key: `edu/${goal.id}/addLesson/${kind}`,
    label,
    level: "simple",
    choice,
    run: (w) =>
      mutate(w, (hh) => {
        const g = find(hh, w) as Goal | undefined;
        const b = w.request.input.baseMonth;
        if (g?.education === undefined) return;
        const lesson: EducationLesson = { id: newId(), from: { at: b }, to: { at: `${Number(b.slice(0, 4)) + 3}-03` }, monthly, label: kind === "other" ? "その他（学校外）" : label, kind };
        (g.education.lessons ??= []).push(lesson);
      }),
  });
  out.push({ key: `edu/${goal.id}/addLessons`, level: "simple", partOf: blockKey, fields: [], actions: [addLesson("cram", "塾", presetNum("preset.education.outside.cram")), addLesson("lesson", "習い事", presetNum("preset.education.outside.lessons")), addLesson("other", "その他", presetNum("preset.education.outside.other"))] });
  return out;
}

// ---- 段ごとの費用 ----

const stageAddress = (goalId: string, stageId: string | undefined, ...rest: string[]): { address?: () => Address } =>
  stageId === undefined ? {} : { address: () => ({ target: { object: goalId }, item: "goal.education", at: ["stages", stageId, ...rest] }) };

/** 専門学校の学費を目安で入れる（年額と入学金。入っていない方だけ。推定の印で、根拠は業界団体の調査の平均） */
export function fillVocationalGuide(wh: WorkingHousehold, goalId: string, stageIndex: number): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const st = (h.goals ?? []).find((g) => g.id === goalId)?.education?.stages[stageIndex];
    if (st?.stage !== "vocational") return;
    const sid = typeof st.id === "string" ? st.id : newId();
    st.id = sid;
    const est: StateRow = { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: VOCATIONAL_GUIDE.basis } };
    const at = (f: string): Address => ({ target: { object: goalId }, item: "goal.education", at: ["stages", sid, f] });
    if (st.annualOverride === undefined) {
      st.annualOverride = VOCATIONAL_GUIDE.annual;
      putRow(req.input as unknown as Obj, at("annualOverride"), est);
    }
    if (st.entranceOverride === undefined) {
      st.entranceOverride = VOCATIONAL_GUIDE.entrance;
      putRow(req.input as unknown as Obj, at("entranceOverride"), est);
    }
  });
}

/** 専門学校の学費の目安のボタンの名前 */
export const VOCATIONAL_GUIDE_LABEL = `学費を目安で入れる（年${manText(VOCATIONAL_GUIDE.annual)}・入学金${manText(VOCATIONAL_GUIDE.entrance)}）`;

/** 短大・専門学校の修学支援はまだ計算しない（計算エンジンの知らせは画面に出ないので、段の1行で知らせる） */
export const HIGHER_SUPPORT_NOTE = "国の修学支援（授業料等の減免・給付型奨学金）は、短大・専門学校ではまだ計算していません。受ける見込みなら、減免の後の額を年額に入れてください";
/** 専門学校の学費の未入力 */
export const VOCATIONAL_MISSING = "未入力（専門学校の学費の統計はまだありません。年額を入れるまで0円で計算中）";

/** 段の見出しの下の1行（統計の平均か、入れた額） */
function stageNote(s: EducationStage, lunch: LunchChoice, annualEstimated = false, rowsMode = false): string | undefined {
  if (s.stage === "nursery") return undefined;
  const stat = stageStatistic(s);
  const parts: string[] = [];
  const school = isK12(s.stage) ? "学校の費用" : "学費";
  const est = annualEstimate(s, lunch, false);
  if (s.annualOverride !== undefined) parts.push(`${school} 年${manText(s.annualOverride)}（${annualEstimated ? "推定" : "入れた額"}）`);
  else if (est !== null) parts.push(`${school} 年約${manText(est.value)}（統計の平均・今の値段）`);
  else if (s.stage === "vocational") parts.push("⚠ 学費が未入力です（0円で計算中）。学校の案内の年額を入れるか、「学費を目安で入れる」を押してください");
  else if (s.stage === "kosen" || s.sector === "international") parts.push("⚠ 学費が未入力です（0円で計算中）。学校の案内の年額を入れてください");
  // 学校外の費用の統計の平均（学校ごとに額を入れた学校は欄に出るので書かない。塾・習い事を別に入れるときは数えないので書かない）
  if (isK12(s.stage) && !rowsMode && stat?.outOfSchool != null && (s.outOfSchool === undefined || s.outOfSchool === "statistics")) parts.push(`${s.stage === "kindergarten" ? "園の外" : "学校外"} 年約${manText(stat.outOfSchool)}（入れ方は「学校外の費用」で）`);
  if (isTertiary(s.stage) && (s.stage !== "vocational" || s.entranceOverride !== undefined)) {
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
export function annualEstimate(s: EducationStage, lunch: LunchChoice, beforeSupport = true): { value: number; basis: string } | null {
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
  const value = stat.annual - off - club;
  const basis = notes.length === 0 ? stat.annualBasis : `${stat.annualBasis}から、${notes.join("と")}を引いた額`;
  // 高校（0010 の追記 2026-11-14）: 統計の授業料は就学支援金を差し引いた後の額で、年額を入れた段は計算エンジンが入れた額を支援金を引く前の額とみなして
  // 支援金（上限まで）を引く。「この値にする」で年額を入れても結果が変わらないように、授業料を支援金の上限（就学支援金を引く前の授業料の目安）に置き換えた額にする
  const capId = sec === "private" ? "educationSupport.highSchool.privateAnnual" : "educationSupport.highSchool.publicAnnual";
  // beforeSupport が false（見出しの1行・段の額）は、計算エンジンが統計の平均の段で払う学校の費用（支援金の後の額）のまま
  const cap = beforeSupport && s.stage === "highSchool" && s.sector !== "international" && stat.hsTuition !== null ? regulationValue(capId, null) : null;
  if (typeof cap === "number" && stat.hsTuition !== null && cap > stat.hsTuition) {
    return { value: value - stat.hsTuition + cap, basis: `${basis}。授業料は就学支援金を引く前の額（統計の年${manText(stat.hsTuition)}を支援金の上限の年${manText(cap)}に置き換え）で、就学支援金は別に入るお金で計算します` };
  }
  return { value, basis };
}

/** 計算の基準の月の年度（4月から） */
const fiscalYearOf = (ym: string): number => (Number(ym.slice(5, 7)) >= 4 ? Number(ym.slice(0, 4)) : Number(ym.slice(0, 4)) - 1);

/** 年月の差（月数。b − a） */
const monthsBetween = (a: string, b: string): number => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/** 月数の言葉（「4年半」「6年」「3年2か月」「5か月」） */
export function periodText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (m === 0) return `${y}年`;
  if (m === 6 && y > 0) return `${y}年半`;
  return y === 0 ? `${m}か月` : `${y}年${m}か月`;
}

/**
 * 段1つのこれからの教育費（今の値段。見出しの目安）: 計算エンジン（education.cost）が払う月のとおりに、計算の基準の月から卒業の月まで（2026-11-14 から月で数える）。
 * - 幼稚園〜高校の学校の費用・学校外の費用・部活動などと、自宅外の仕送り・高専や大学などの学校外の費用は、年額÷12を残りの月数だけ
 * - 大学などの学費は4月と10月に半分ずつ（残りの払う月の数だけ）
 * - 入学金（入学の前の2月、国公立は3月。幼稚園〜高校は統計の入学金等）・自宅外の初期費用（入学の前の月）・受験・併願の費用（入学の前の1月・2月。
 *   入れていなければ大学・短大・専門学校は統計の平均。0010 の追記 2026-11-14）は、その月が基準の月より後なら
 * 教育費の上昇率・修学支援・就学支援金・保育料・留学は入れない。保育園（0〜2歳）と終わった段は null。
 * started は基準の月にもう入学している（見出しは「残り○年（○年○月まで）」）、months は残りの月数
 */
export function stageRemainingCost(child: Member, s: EducationStage, baseMonth: string, lunch: LunchChoice, rowsMode = false): { years: number; months: number; started: boolean; until: string; total: number } | null {
  if (s.stage === "nursery") return null;
  const period = stagePeriod(child, s);
  if (period === null) return null;
  const all = stageYears(s);
  const started = period.from < baseMonth;
  const first = started ? baseMonth : period.from;
  const months = Math.min(all * 12, Math.max(0, monthsBetween(first, period.to) + 1));
  if (months === 0) return null;
  const stat = stageStatistic(s);
  const after = (ym: string) => ym >= baseMonth;
  // 年額を月で割って数える分（幼稚園〜高校の学校の費用・学校外の費用・部活動、仕送り、高専・大学などの学校外の費用）
  let monthlyYearly = 0;
  let once = 0;
  const school = (s.annualOverride ?? annualEstimate(s, lunch, false)?.value ?? 0) + (s.clubAnnual ?? 0);
  if (isK12(s.stage)) monthlyYearly += school;
  else {
    // 学費は4月と10月に半分ずつ（計算エンジンと同じ）
    let halves = 0;
    for (let k = 0; k < all; k++) for (const off of [0, 6]) if (after(addMonths(period.from, 12 * k + off)) && addMonths(period.from, 12 * k + off) <= period.to) halves++;
    once += (school / 2) * halves;
  }
  if (isK12(s.stage) && !rowsMode) monthlyYearly += s.outOfSchool === "none" ? 0 : typeof s.outOfSchool === "object" ? s.outOfSchool.monthly * 12 : (stat?.outOfSchool ?? 0);
  // 高専・大学などは、学校ごとに入れた月額だけ（統計の平均は無い。計算エンジンの education.cost の改訂11）
  else if (!isK12(s.stage) && !rowsMode && typeof s.outOfSchool === "object") monthlyYearly += s.outOfSchool.monthly * 12;
  // 入学金（幼稚園〜高校は統計の入学金等×在学年数の標準。0010 の追記 2026-11-14）
  const entrance = s.entranceOverride ?? stat?.entrance ?? 0;
  const entranceMonth = addMonths(period.from, isTertiary(s.stage) || s.stage === "kosen" ? ((s.sector ?? "public") === "private" ? -2 : -1) : -2);
  if (after(entranceMonth)) once += entrance;
  if (s.exam?.amount !== undefined || s.exam?.deposits !== undefined) {
    if (after(addMonths(period.from, -3))) once += s.exam?.amount ?? 0;
    if (after(addMonths(period.from, -2))) once += s.exam?.deposits ?? 0;
    // 推定は学費が分かる段だけ（学費が未入力の専門学校などで、受験の推定だけの額を見出しに出さない）
  } else if (school > 0 && after(addMonths(period.from, -3))) once += examStatistic(s)?.value ?? 0;
  if (isTertiary(s.stage) && s.living === "away") {
    const b = boardingStatistic();
    monthlyYearly += s.boarding?.monthly !== undefined ? s.boarding.monthly * 12 : (b.annual ?? 0);
    if (after(addMonths(period.from, -1))) once += s.boarding?.initial ?? b.initial ?? 0;
  }
  return { years: Math.floor(months / 12), months, started, until: period.to, total: Math.round((monthlyYearly * months) / 12 + once) };
}

/** 段の見出しの横の1行（まだ入学していない段は「6年で約○万円（今の値段）」、入学している段は「残り4年半（2031年3月まで）で約○万円（今の値段）」） */
export function stageCostLine(c: { months: number; started: boolean; until: string; total: number }): string {
  return `${c.started ? `残り${periodText(c.months)}（${formatYearMonth(c.until)}まで）` : periodText(c.months)}で約${amountText(c.total)}（今の値段）`;
}

/** 子の年齢と学年（「12歳・小6」。小学校の前と高校の後は年齢だけ） */
export function childAgeGrade(child: Member, baseMonth: string): string {
  // これから生まれる子は年齢を出さない（「-2歳」にしない。2026-11-14）
  if (child.birth.birthYearMonth > baseMonth) return `${formatYearMonth(child.birth.birthYearMonth)}生まれの予定`;
  const age = ageAt(child, baseMonth);
  const entry = schoolEntryYear(child.birth.birthYearMonth, child.birth.bornOnFirst, "elementary");
  const g = entry === null ? 0 : fiscalYearOf(baseMonth) - entry + 1;
  const grade = g >= 1 && g <= 6 ? `小${g}` : g >= 7 && g <= 9 ? `中${g - 6}` : g >= 10 && g <= 12 ? `高${g - 9}` : null;
  return grade === null ? `${age}歳` : `${age}歳・${grade}`;
}

/**
 * 学校の種類（公立・私立・系統）を変えたとき、前の推定の値をそのまま入れた年額・入学金（「この値にする」で書いた額）は外して、新しい推定に入れ直す
 * （前の学校の額のまま残ると、私立にしても公立の額で計算する）。FP が自分で入れた額（推定と違う額）は残す。next をそのまま書き換える
 */
export function dropStaleEstimates(prev: EducationStage, next: EducationStage, lunch: LunchChoice): void {
  // 推定の値は千円単位で入る（0041 の追記 2026-11-14）。丸める前に入れた前の版の値も見分ける
  const same = (v: number | undefined, est: number | null | undefined): boolean => v !== undefined && est != null && (v === est || v === estimateYen(est));
  if (same(next.annualOverride, annualEstimate(prev, lunch)?.value)) delete next.annualOverride;
  if (same(next.entranceOverride, stageStatistic(prev)?.entrance)) delete next.entranceOverride;
}

/** 数えない推定の理由（学校の種類で決まる統計の平均） */
const QUIET_STAT = "学校の種類で決まる統計の平均（進路を確かめれば、ここは数えない）";

/**
 * 空欄のとき推定の値を見せる（印「推定」・根拠・「この値にする」で書ける。0041）。est が null なら元の欄のまま。
 * 欄の中に見せる値と「この値にする」で入る値は千円単位に丸める（統計の円の額を万円にすると「103.1849」のように出るため。0041 の追記 2026-11-14）
 */
function withEstimate(f: FieldDef, est: (wh: WorkingHousehold) => { value: number; basis: string; hint: string; blankHint?: string } | null): FieldDef {
  return {
    ...f,
    // 学校の種類（進路）を選べば決まる統計の平均なので、入力項目の状態・確かめの一覧では数えない（進路の推定は進路の欄で1つと数える。0062 の追記 2026-10-31）
    quietEstimate: QUIET_STAT,
    get: (wh) => {
      const st = f.get(wh);
      if (st.value !== null) return st;
      const e = est(wh);
      return e === null ? st : { ...st, estimated: e.basis, hint: e.hint, ...(e.blankHint !== undefined ? { blankHint: e.blankHint } : {}) };
    },
    blankEstimate: (wh) => {
      if (f.get(wh).value !== null) return null;
      const v = est(wh)?.value;
      return v === undefined ? null : estimateYen(v);
    },
  };
}

/** 浪人の年数の「?」（計算のとおりに: 入学から後がその年数だけうしろにずれる） */
export const DELAY_HELP =
  "浪人の年数だけ、この学校の入学・在学・卒業がうしろにずれます（入学金・受験の費用・学費・仕送りも、その年数だけ後の年に、教育費の上昇率で伸ばした額でかかります）。" +
  "独立（世帯を離れる時期）も最後の学校の終わりに合わせてずれ、その間は世帯の家族として生活費・扶養に入ります。" +
  "浪人の間の予備校の費用は入っていないので、かかるなら「その他の教育費」で足してください。貸与の奨学金・教育ローンの時期は自動ではずれないので、入れていれば直してください";

/** 在学年数の標準が1つに決まらない段（推定で見せる）。専門学校は1〜4年で2年制が多い */
const YEARS_VARY: Readonly<Record<string, string>> = { vocational: "専門学校は1〜4年の課程があり、ここでは2年制で計算しています" };

/**
 * 進路の段1つの「▸ 続きを見る」の文（0078 の追記 2026-11-01）: 段の種類で開く欄が違うので、種類ごとに代表の欄を書く。
 * 高校のあとの学校は、自宅外のときだけ仕送りの欄が出るので、通い方でも変える
 */
export function stageMoreLabel(s: Pick<EducationStage, "stage" | "living">): string {
  if (s.stage === "nursery") return "施設の種類・自治体の無償化などを入れる";
  if (isTertiary(s.stage)) return s.living === "away" ? "初期費用・受験の費用などを入れる" : s.stage === "university" ? "系統・受験の費用などを入れる" : "入学金・受験の費用などを入れる";
  return s.stage === "kindergarten" ? "入学金・通う年数などを入れる" : "入学金・在学年数などを入れる";
}

type OutChoice = ReturnType<typeof outOfSchoolChoiceOf>;

function stageFields(goalId: string, i: number, s: EducationStage, nurseryStart: string, outChoice: OutChoice = "statistics"): FieldDef[] {
  const rowsMode = outChoice === "rows";
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
        // 入力例は推定の通い始めの年月（入れ方ごとの決まった例「2041-06」は、保育園の時期として不自然なため）
        example: `例: ${nurseryStart.slice(0, 7)}`,
        help: "「2028-04」の形で入れます。推定は1歳の4月（その子の育児休業を入れていれば、休業の終わりの翌月）です",
      }),
      nurseryStartKindField(goalId, key, find),
      nurseryFacilityField(key, find),
      {
        ...plain({
          key: `${key}/monthly`,
          item: "goal.education",
          label: "保育料（月額）",
          // 認可外・企業主導型は国の基準で計算できないので、月額を標準に出す（入れるまで0円）
          level: (s.facility ?? "licensed") === "licensed" ? "detail" : "simple",
          kind: "yen",
          basis: "monthly",
          find,
          path: ["monthly"],
          optional: true,
          hint: (v) => (v === null ? ((s.facility ?? "licensed") === "licensed" ? `推定あり: ${NURSERY_FEE_BASIS}` : NURSERY_UNLICENSED_MISSING) : v === 0 ? "保育料なし（自治体の無償化など）" : null),
          help: "自治体の保育料表の額（認可外・企業主導型は施設の保育料）が分かれば入れてください。0 なら保育料なし。3歳からの無償化は自動で計算します。自治体の独自の無償化を選んだ認可の施設は、その間は0円です",
        }),
      },
      {
        ...plain({ key: `${key}/localFree`, item: "goal.education", label: "自治体の独自の無償化", level: "detail", kind: "select", options: NURSERY_LOCAL_FREE, find, path: ["localFree"], optional: true, fallback: "", help: NURSERY_LOCAL_FREE_HELP }),
        ...stageAddress(goalId, sid, "localFree"),
      },
      {
        ...plain({ key: `${key}/extended`, item: "goal.education", label: "延長保育（月額）", level: "detail", kind: "yen", basis: "monthly", find, path: ["extendedMonthly"], optional: true, blankMeans: "0円", help: "延長保育を使う見込みなら、その月額を入れます（自治体・施設ごとに違い、統計はありません）。延長保育料は無償化の対象外なので、3歳の4月の前の月まで払います" }),
        ...stageAddress(goalId, sid, "extendedMonthly"),
      },
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
  // 高校のあとの学校の種類（大学・短大・専門学校・行かない）は、その学校の行の先頭で選ぶ（高校の行の「高校・高専」と同じ形。2026-11-14）
  if (isHigher(s.stage)) fields.push(higherKindField(goalId));
  // 公立・私立は、公立・私立のある段すべてで標準（段によって選べたり選べなかったりすると分かりにくい。
  // 進路の型でまとめて変えられるので手間は増えない。0078 の 2026-10-29 の追記）。系統は詳細（文系・理系の差は小さい）。0078
  const reestimate = (_h: Household, target: Obj, _v: unknown, wh: WorkingHousehold) => {
    const prev = stageNow(wh);
    if (prev !== undefined) dropStaleEstimates(prev, target as unknown as EducationStage, lunchNow(wh));
  };
  // 標準の選択肢は「公立／私立」の2つ。国立・インターナショナルスクールは詳細で選ぶ（選んでいれば標準にも出す）
  const sectorField = (k: string, level: "simple" | "detail", options: typeof sectorOptions): FieldDef =>
    plain({ key: k, item: "goal.education", label: "公立・私立", level, kind: "select", options, find, path: ["sector"], optional: true, fallback: "public", help: sectorHelp(s.stage), after: reestimate });
  const simpleSectors = sectorOptions.filter((o) => o.value === "public" || o.value === "private" || o.value === (s.sector ?? "public"));
  if (simpleSectors.length === sectorOptions.length) fields.push(sectorField(`${key}/sector`, "simple", sectorOptions));
  else
    fields.push(
      { ...sectorField(`${key}/sector`, "simple", simpleSectors), simpleOnly: true, swapNote: "公立・私立に、国立などを足して出しています" },
      sectorField(`${key}/sectorAll`, "detail", sectorOptions),
    );
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
        help: "高専は15歳の学年から5年です。高専の後に大学に編入するときは、大学の段階の在学年数を2年（3年次に編入）にします。大学は高専を出た翌月の4月からです",
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
  // 入学金（大学・短大は統計の平均の推定。幼稚園〜高校は統計の入学金等〔全学年の平均〕×在学年数の標準の推定。0010 の追記 2026-11-14）
  if (higher || s.stage === "kosen" || (isK12(s.stage) && s.sector !== "international" && stageStatistic(s)?.entrance != null))
    fields.push({
      ...withEstimate(
        plain({ key: `${key}/entrance`, item: "goal.education", label: "入学金", level: "detail", kind: "yen", basis: "once", find, path: ["entranceOverride"], optional: true, help: isK12(s.stage) ? K12_ENTRANCE_HELP : "入学の前の2月（国公立は3月）に払います" }),
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
  if (isK12(s.stage)) fields.push(...k12Fields(goalId, i, s, key, find, sid, outChoice));
  // 高専・大学・短大・専門学校の学校外の費用（月額）。統計の平均が無いので空欄は0円。「学校ごとに入れる」のときは標準
  if (isOtherOutStage(s.stage) && !rowsMode) fields.push({ ...otherOutField(key, find, s, outChoice === "custom" ? "simple" : "detail"), ...stageAddress(goalId, sid, "outOfSchool", "monthly") });
  // 学校名（学校の一覧から探して選ぶ。学部・学科の一覧がある学校は学部・学科も。0217）
  if (showsSchoolField(s.stage)) {
    const childOf = (wh: WorkingHousehold) => (wh.request.input.household.goals ?? []).find((g) => g.id === goalId)?.owner;
    fields.push(schoolNameField({ key: `${key}/school`, find, childOf, after: (prev, next, wh) => dropStaleEstimates(prev, next, lunchNow(wh)) }));
    const code = typeof (s.school as { school?: unknown } | undefined)?.school === "string" ? ((s.school as { school: string }).school) : null;
    const dep = departmentField({ key: `${key}/unit`, find, code });
    if (dep !== null) fields.push(dep);
  }
  // 在学年数: 標準が1つに決まる段はその年数を最初から見せる（省略時の既定）。決まらない段（専門学校）は推定
  const years = plain({ key: `${key}/years`, item: "goal.education", label: s.stage === "kindergarten" ? "通う年数" : "在学年数", level: "detail", kind: "int", suffix: "年", min: 1, max: 6, find, path: ["years"], optional: true, ...(YEARS_VARY[s.stage] === undefined ? { fallback: stageYears({ ...s, years: undefined }) } : {}), help: yearsHelp(s.stage) });
  const vary = YEARS_VARY[s.stage];
  fields.push(vary === undefined ? years : { ...years, get: (wh) => { const st = years.get(wh); return st.value === null ? { ...st, estimated: vary, hint: `${stageYears({ ...s, years: undefined })}年（推定）`, blankHint: `${stageYears({ ...s, years: undefined })}年制で計算（1〜4年の課程あり）` } : st; }, blankEstimate: (wh) => (years.get(wh).value === null ? stageYears({ ...s, years: undefined }) : null) });
  if (higher) {
    fields.push(
      plain({ key: `${key}/delay`, item: "goal.education", label: "浪人の年数", level: "detail", kind: "int", suffix: "年", min: 0, max: 5, find, path: ["delayYears"], optional: true, fallback: 0, help: DELAY_HELP }),
      {
        ...withEstimate(
          plain({ key: `${key}/exam`, item: "goal.education", label: "受験・併願の費用", level: "detail", kind: "yen", basis: "once", find, path: ["exam", "amount"], optional: true, help: examHelp(s) }),
          (wh) => {
            const st = stageNow(wh);
            const e = st === undefined ? null : examStatistic(st);
            return e === null ? null : { ...e, hint: `${manText(e.value)}（推定）`, blankHint: "統計の平均（日本政策金融公庫の調査）" };
          },
        ),
        ...stageAddress(goalId, sid, "exam", "amount"),
      },
    );
    if (s.living === "away") {
      const b = boardingStatistic();
      fields.push(
        {
          ...withEstimate(
            plain({ key: `${key}/boarding/monthly`, item: "goal.education", label: "自宅外の仕送り（月額）", level: "simple", kind: "yen", basis: "monthly", find, path: ["boarding", "monthly"], optional: true, help: "家賃・食費など、親が出す仕送りの月額。在学中は毎月かかります" }),
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
      ...plain({ key: `${key}/sciAgri`, item: "goal.education", label: "修学支援の対象の学部（理工農系）", level: "detail", kind: "bool", find, path: ["scienceAgriculture"], optional: true, fallback: false, help: "国の修学支援（授業料の減免）は、所得が中くらいの世帯（子が3人以上の世帯を除く）では理工農系の学部だけが対象です。理系の多くは対象です" }),
      ...stageAddress(goalId, sid, "scienceAgriculture"),
    });
  return fields;
}

/** 幼稚園〜高校の入学金の「?」（統計の入学金等をまとめて入学の前に。0010 の追記 2026-11-14） */
const K12_ENTRANCE_HELP =
  "入学金・入学時の施設整備費・受験した全部の学校の検定料と、入学しなかった学校への納付金です。入学の前の2月に払います（入学した後の子にはかかりません）。" +
  "推定は子供の学習費調査の入学金等（全学年の平均）に在学年数の標準を掛けた額で、学校の費用の年額には含めていません。志望校の額が分かれば入れてください";

/** 受験・併願の費用の「?」 */
function examHelp(s: EducationStage): string {
  const e = examStatistic(s);
  return e === null
    ? "受験料・受験の交通費・宿泊費と、入学しなかった学校への納付金です（入学の前の1月に払います）。この学校の統計は無いので、入れなければ0円で計算します"
    : `受験料・受験の交通費・宿泊費と、入学しなかった学校への納付金です（入学の前の1月に払います）。入れなければ推定（${e.basis.replace(/^統計の平均（/, "").replace(/）$/, "")}の平均 ${manText(e.value)}）で計算します`;
}

/** 保育料とは別にかかるお金の推定の根拠（短い文）と「?」 */
const NURSERY_EXTRA_BASIS = "統計の平均。教材・被服・保護者会・遠足・通園などの実費（文部科学省・厚生労働省「幼稚園・保育所等の経営実態調査」の保育所の実費徴収。平成23年度）";
const NURSERY_EXTRA_HELP =
  "0〜2歳の保育料には給食（主食・副食）の費用が含まれるので、ここは教材・被服・保護者会・遠足・通園など、保育所が保育料とは別に集める実費です。" +
  "推定は、国の調査の費目ごとの実施率×1人当たりの額を足した目安で、公立・私立に分けた値はありません。3歳からの給食の副食費（国の目安は月4,500円）などは「保育園・幼稚園（3歳から）」の段階の学校の費用に入っています";

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
function k12Fields(goalId: string, i: number, s: EducationStage, key: string, find: Finder, sid: string | undefined, outChoice: OutChoice): FieldDef[] {
  const rowsMode = outChoice === "rows";
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
  // 学校外の費用（塾・習い事など）の月額。空欄は統計の平均（推定）。塾・習い事を別に入れているときは学校ごとの額を数えないので出さない。
  // 「学校ごとに入れる」のときは標準に出す。保育園・幼稚園（3歳から）は「園の外の費用（習い事など）」（2026-11-14）
  const stat = stageStatistic(s);
  const outMonthly = stat?.outOfSchool == null ? null : Math.round(stat.outOfSchool / 12);
  if (!rowsMode) out.push({
    ...withEstimate(
      field({
        key: `${key}/outOfSchool`,
        item: "goal.education",
        label: s.stage === "kindergarten" ? "園の外の費用（習い事など・月額）" : "学校外の費用（月額）",
        level: outChoice === "custom" ? "simple" : "detail",
        kind: "yen",
        basis: "monthly",
        optional: true,
        help: `${s.stage === "kindergarten" ? "習い事・通信教育・体験活動など、園の外でかかる費用" : "塾・家庭教師・通信教育・習い事・体験活動などの費用"}の月額です。推定は統計の平均（子供の学習費調査の学校外活動費を12で割った額）で、${s.stage === "kindergarten" ? "習い事" : "塾や習い事"}をしていない子も含めた平均です。0円にすると入れません`,
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
        plain({ key: `${key}/club`, item: "goal.education", label: "うち部活動など（年額）", level: "detail", kind: "yen", basis: "annual", find, path: ["clubAnnual"], optional: true, help: CLUB_HELP }),
        (wh) => {
          const st = stageNow(wh);
          if (club === null || st?.annualOverride !== undefined) return null;
          return { value: club, basis: CLUB_BASIS, hint: `年${manText(club)}（推定・学校の費用に含む）`, blankHint: "統計の平均（文部科学省の調査）・学校の費用に含む" };
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
  "額を入れると、学校の費用の中の教科外活動費をその額に入れ替えます（学校の費用の年額を入れた段階は、その年額に足します）。" +
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

/** 保育園の施設の種類（計算エンジンの education.nurseryFee の改訂6） */
const NURSERY_FACILITIES = [
  { value: "licensed", label: "認可" },
  { value: "unlicensed", label: "認可外（認証など）" },
  { value: "employer", label: "企業主導型" },
];
/** 認可外・企業主導型で月額が無いとき */
export const NURSERY_UNLICENSED_MISSING = "未入力（認可外・企業主導型の保育料の統計はありません。施設の月額を入れるまで0円で計算中）";
/** 自治体の独自の無償化（認可の施設だけ） */
const NURSERY_LOCAL_FREE = [
  { value: "", label: "なし（国の基準どおり）" },
  { value: "second", label: "第2子から無償" },
  { value: "first", label: "第1子から無償" },
];
const NURSERY_LOCAL_FREE_HELP =
  "お住まいの自治体が0〜2歳の保育料を独自に無償にしているときに選びます（認可の施設だけに当てます。認可外の助成は自治体ごとに違うので、助成の後の月額を入れます）。" +
  "例: 東京都の区市町村は、令和7年9月から認可保育所などの0〜2歳の第1子の保育料を無償にしています（延長保育料は対象外）。" +
  "「第2子から無償」は、世帯に年長のきょうだいがいる間（年齢・保育園に通っているかを問わない）を0円にします。自治体によってきょうだいの数え方が違うので、案内で確かめてください";

/** 保育園の施設の種類の欄（詳細） */
function nurseryFacilityField(key: string, find: Finder): FieldDef {
  return plain({
    key: `${key}/facility`,
    item: "goal.education",
    label: "施設の種類",
    level: "detail",
    kind: "select",
    options: NURSERY_FACILITIES,
    find,
    path: ["facility"],
    optional: true,
    fallback: "licensed",
    help:
      "認可（認可保育所・認定こども園・小規模保育など）は、保育料を世帯の住民税から国の基準×保育料の水準で計算します。" +
      "認可外（認証保育所などを含む）と企業主導型は、保育料が施設ごとに決まり全国の統計も無いので、施設の月額を入れます（入れるまで0円）。認可外の0〜2歳の住民税非課税世帯の無償化（月4.2万円まで）は計算していません",
  });
}

/** 保育園の通い始めの選び方（詳細）。年月の欄（標準）と同じ値（段の from）を書く */
function nurseryStartKindField(goalId: string, key: string, find: Finder): FieldDef {
  const ownerOf = (h: Household) => (h.goals ?? []).find((g) => g.id === goalId)?.owner;
  const ofAge = (tp: unknown): string | null => {
    const a = (tp as { memberAge?: { years?: number; ageSwitch?: string; months?: number } } | undefined)?.memberAge;
    return a?.ageSwitch === "schoolYear" && (a.months ?? 0) === 0 && (a.years === 0 || a.years === 1) ? `age${a.years}` : null;
  };
  return field({
    key: `${key}/startKind`,
    item: "goal.education",
    label: "通い始める時期の決め方",
    level: "detail",
    kind: "select",
    options: [
      { value: "", label: "育休明けの翌月（既定）" },
      { value: "age0", label: "0歳の4月" },
      { value: "age1", label: "1歳の4月" },
      { value: "ym", label: "年月で入れた時期" },
    ],
    help: "既定は、その子の育児休業の終わりの翌月（育児休業を入れていなければ1歳の4月）です。0歳の4月・1歳の4月は、子の生年月から決まる学年の4月（4月2日〜翌年4月1日生まれが同じ学年）で、子の生年月を直すと一緒に動きます。年月で決めるときは「通い始める時期」に入れます",
    get: (w) => {
      const from = getPath(find(w.request.input.household, w), ["from"]);
      return { value: from === undefined ? "" : (ofAge(from) ?? "ym"), ...(from === undefined ? { implicit: true } : {}) };
    },
    set: (w, v) =>
      v === "ym" || typeof v !== "string"
        ? w
        : mutate(w, (h, req) => {
            const st = find(h, { ...w, request: req });
            const owner = ownerOf(h);
            if (st === undefined || owner === undefined) return;
            if (v === "") delete st.from;
            else st.from = { memberAge: { member: owner, years: v === "age0" ? 0 : 1, ageSwitch: "schoolYear" } };
          }),
  });
}

/** 保育園の段の見出しの下の1行（施設の種類・自治体の独自の無償化・月額で変える） */
function nurseryNote(s: EducationStage, free: string | null): string {
  const freeText = free !== null ? `${free.slice(0, 4)}年4月からは無償化で0円。` : "";
  const licensed = (s.facility ?? "licensed") === "licensed";
  const local = !licensed || s.localFree === undefined ? "" : s.localFree === "first" ? "自治体の独自の無償化（第1子から）で、保育料は0円で計算します。" : "自治体の独自の無償化（第2子から）で、年長のきょうだいがいる間は保育料を0円で計算します。";
  const extended = s.extendedMonthly !== undefined && s.extendedMonthly > 0 ? `延長保育 月${manText(s.extendedMonthly)}を足しています。` : "";
  if (!licensed && s.monthly === undefined) return `⚠ ${NURSERY_UNLICENSED_MISSING}。${extended}`;
  if (s.localFree === "first" && licensed) return `${local}${extended}${freeText}`;
  if (s.monthly === undefined) return `${local}${nurseryMethodNote()}${freeText}${extended}月額が分かれば「詳細」で入れられます`;
  if (s.monthly === 0) return `保育料なし（月額 0 円を入れています）。${extended}`;
  return `${local}保育料は入力した月額（${formatYen(s.monthly, "yen")}円）で計算します。${licensed ? "消すと収入から自動で計算します。" : ""}${extended}`;
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
  if (s.sector === "international") return "学校の費用（授業料・施設費など）の年額です。インターナショナルスクールの学費の統計は無いので、学校の案内の額を入れます";
  if (isK12(s.stage)) return "学校教育費（授業料・学用品・通学・修学旅行など）と学校給食費の年額です。学校外活動費（塾・習い事）は含めません。志望校の額が分かれば入れてください";
  if (s.stage === "vocational") return `授業料・実習費・設備費などの年額（入学金は別）。学校の案内の額を入れます。国の統計が無いので、分からなければ「学費を目安で入れる」で業界団体の調査の平均（年${manText(VOCATIONAL_GUIDE.annual)}・入学金${manText(VOCATIONAL_GUIDE.entrance)}。都内の私立の専門学校）を入れられます`;
  if (s.stage === "kosen" && s.sector !== "national") return "授業料と施設設備費の年額（入学金は別）。公立・私立の高専の学費の統計は無いので、学校の案内の額を入れます";
  return "授業料と施設設備費の年額（入学金は別）。志望校の学費が分かれば入れてください";
}

function yearsHelp(stage: string): string {
  if (stage === "kosen") return "高専の本科は5年です（専攻科の2年は、大学などの段階で近づけます）";
  if (stage === "graduateProfessional") return "法科大学院は3年（法学既修者は2年）、ほかの専門職大学院は2年が標準です";
  if (stage === "university") return "標準は4年（系統が医歯系なら6年）。薬学部（6年）・獣医学部（6年）などは直してください";
  if (stage === "vocational") return "専門学校は1〜4年の課程があり、推定は2年制です。志望校の修業年限を入れてください";
  return "学校の種類の標準の年数です。留年などで変わるときだけ直してください";
}

/** 高校のあとの学校（大学・短大・専門学校・行かない）。高校の行の「高校（3年）／高専（5年）」と同じ形で、大学などの行の先頭で選ぶ（2026-11-14） */
export const HIGHER_OPTIONS = [
  { value: "university", label: "大学（4年）" },
  { value: "juniorCollege", label: "短大" },
  { value: "vocational", label: "専門学校" },
  { value: "none", label: "大学などに行かない" },
];

/**
 * 大学などの行の「大学・短大・専門学校」の欄（キーは前の「高校のあとの進路」の edu/<目標>/higher のまま）。「大学などに行かない」は大学などの段を外し、
 * 行は「大学など」の見出しとこの欄だけで残る（選び直せる）。選び直しても、通い方・浪人・仕送り・入れた年額はそのまま（replaceHigher）
 */
export function higherKindField(goalId: string): FieldDef {
  const find = byId(goals, goalId);
  // 進路の推定・該当なしの印（値の状態の行）は進路の段の並び全体に付く（fill.ts）。入力の「進路の型」の欄を外したので（2026-11-14）、
  // 推定のままの進路の印と「この値にする」はこの欄に出す（子ごとに1つ）
  return { ...higherKindDef(goalId, find), address: () => educationStagesAddress(goalId) };
}
function higherKindDef(goalId: string, find: Finder): FieldDef {
  return field({
    key: `edu/${goalId}/higher`,
    item: "goal.education",
    label: "大学・短大・専門学校",
    level: "simple",
    kind: "select",
    options: HIGHER_OPTIONS,
    structural: true,
    help: "選び直しても、通い方・浪人・仕送り・入れた年額はそのまま残ります。専門学校は学費の国の統計が無いので、学校の案内の年額を入れるか、その学校の行の「学費を目安で入れる」で業界団体の調査の平均を入れます",
    get: (w) => ({ value: (((find(w.request.input.household, w) as Goal | undefined)?.education?.stages ?? []) as EducationStage[]).find((s) => isHigher(s.stage))?.stage ?? "none" }),
    set: (w, v) =>
      mutate(w, (hh) => {
        const g = find(hh, w) as Goal | undefined;
        if (g?.education !== undefined && typeof v === "string") g.education.stages = replaceHigher(g.education.stages, v);
      }),
  });
}

/** 高専・大学などの学校外の費用（月額）の欄。統計の平均が無いので、空欄は0円（推定なし） */
function otherOutField(key: string, find: Finder, s: EducationStage, level: "simple" | "detail"): FieldDef {
  const hint = s.stage === "kosen" ? "統計の平均はありません。塾・習い事などがあれば入れます" : "資格の予備校などがあれば入れます";
  return field({
    key: `${key}/outOfSchool`,
    item: "goal.education",
    label: "学校外の費用（月額）",
    level,
    kind: "yen",
    basis: "monthly",
    optional: true,
    blankMeans: "0円",
    help: `${s.stage === "kosen" ? "塾・習い事・資格の講座" : "資格の予備校・語学の講座・習い事"}など、学校の外でかかる費用の月額です。大学などの学校外の費用には国の統計が無いので、入れなければ0円で計算します`,
    get: (wh) => {
      const o = (find(wh.request.input.household, wh) as EducationStage | undefined)?.outOfSchool;
      const value = typeof o === "object" ? o.monthly : null;
      return { value, ...(value === null ? { hint } : {}) };
    },
    set: (wh, v) =>
      mutate(wh, (h, req) => {
        const st = find(h, { ...wh, request: req }) as EducationStage | undefined;
        if (st === undefined) return;
        if (v === null) delete st.outOfSchool;
        else st.outOfSchool = { monthly: Number(v) };
      }),
  });
}
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
 *   自宅外通学・大学院・海外留学などは450万円）まで。金利は固定の年4.60%（令和8年11月2日現在。保証料は別）、返す年数は上限の20年
 */
/** 貸与の奨学金のひな形の根拠の文（月額は presets.ts の目安、利率はマスタデータ。事務所の推定の値があればその値。読むたびに作る） */
export const scholarshipBasis = (): string =>
  officeBasisOf("preset.education.scholarship.monthly", "loanRates.scholarship") ??
  presetBasis(
    `貸与の奨学金（日本学生支援機構の第二種）${presetText("preset.education.scholarship.monthly", (v) => `月${String(Number(v) / 10000)}万円`)}・在学中。利率は${scholarshipRateEstimate().basis}・利率固定方式（上限も年3%）。返す年数は貸与総額から返還年数算出表で`,
  );
/** 教育ローンのひな形の根拠の文（金利は presets.ts の目安） */
export const loanBasis = (): string =>
  officeBasisOf("preset.education.loan.rate") ??
  presetBasis(
    `国の教育ローン（日本政策金融公庫）: 入学の年の学費（入学金と1年目の学費の統計の平均。上限350万円）・${presetText("preset.education.loan.rate", (v) => (presetIsOffice("preset.education.loan.rate") ? `固定金利 年${pctText(v)}` : `固定金利 年${pctText(v)}（令和8年11月2日現在）`))}・返済期間は上限の20年`,
  );

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

/**
 * 貸与の奨学金の種類（0104 の追記 2026-11-01）: 第一種（無利子）・第二種（有利子）。省略は第二種（前の世帯の奨学金は、入っている利率のまま第二種として読む）。
 * 種類で利率の目安が決まる: 第一種は0%、第二種はこれから借りる第二種の目安（マスタデータ master.loanRates）。種類は表示と目安の元だけで、計算は利率
 */
export const SCHOLARSHIP_TYPES = [
  { value: "first", label: "第一種（無利子）" },
  { value: "second", label: "第二種（有利子）" },
];

/** 種類ごとの利率の目安（率と根拠の文） */
export function scholarshipTypeRate(type: string | undefined): { rate: string; basis: string } {
  return type === "first" ? { rate: "0", basis: presetBasis("第一種奨学金（無利子）は利率0%") } : { rate: scholarshipRateEstimate().rate, basis: scholarshipBasis() };
}

/** 種類を変えたとき、利率が推定のまま（目安のボタンの値）なら、新しい種類の目安に入れ直す。FP が入れた利率は変えない */
function reestimateScholarshipRate(input: Obj, goalId: string, s: EducationScholarship): void {
  if (s.id === undefined) return;
  const addr: Address = { target: { object: goalId }, item: "goal.education", at: ["scholarships", s.id, "rate"] };
  if (rowAt(input, addr)?.state !== "estimated") return;
  const est = scholarshipTypeRate(s.type);
  s.rate = est.rate;
  putRow(input, addr, { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: est.basis } });
}

/** 奨学金を返す人（0104）。省略は子が返す */
const REPAID_BY = [
  { value: "child", label: "子が返す" },
  { value: "household", label: "世帯で返す" },
];

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
    const typeField = plain({
      key: `${k}/type`,
      item: "goal.education",
      label: "種類",
      level: "detail",
      kind: "select",
      options: SCHOLARSHIP_TYPES,
      find,
      path: ["type"],
      optional: true,
      fallback: "second",
      help: `種類で利率の目安が決まります（第一種は無利子で0%、第二種は${scholarshipRateEstimate().basis}）。利率を入れていれば、種類を変えても利率は変えません`,
    });
    const typeLabel = s.type === "first" ? "第一種" : "第二種";
    return {
      key: k,
      title: `貸与の奨学金（${typeLabel}） ${amountText(s.monthly, "month")}・${(s.repaidBy ?? "child") === "child" ? "子が返す" : "世帯で返す"}`,
      note: (s.repaidBy ?? "child") === "child" ? "在学中に受け取り（入るお金）、卒業の後に子が返します。子の返済は世帯の支出に入れません（結果の画面と提案書に返済の額を書き添えます）" : "在学中に受け取り（入るお金）、卒業の後に世帯で返します（返済は世帯の支出に入ります）",
      // 入っていれば標準にも見出しの1行を出す（欄は詳細。中身があるときだけ標準にも出るまとまり）
      level: "simple",
      moreLabel: "月額・利率・返す年数などを入れる",
      fields: [
        {
          ...typeField,
          ...at("type"),
          set: (w, v) => {
            const next = typeField.set(w, v);
            if (next === w) return w;
            return mutate(next, (h, req) => {
              const x = (h.goals ?? []).find((g) => g.id === goal.id)?.education?.scholarships?.[i];
              if (x !== undefined) reestimateScholarshipRate(req.input as unknown as Obj, goal.id, x);
            });
          },
        },
        { ...plain({ key: `${k}/monthly`, item: "goal.education", label: "月額", level: "detail", kind: "yen", basis: "monthly", find, path: ["monthly"] }), ...at("monthly") },
        timepointField({ key: `${k}/from`, item: "goal.education", label: WORDS.start, level: "detail", find, path: ["from"], ageOf }),
        timepointField({ key: `${k}/to`, item: "goal.education", label: WORDS.end, level: "detail", find, path: ["to"], startPath: ["from"], ageOf }),
        { ...plain({ key: `${k}/rate`, item: "goal.education", label: "利率（年）", level: "detail", kind: "pct", find, path: ["rate"] }), ...at("rate") },
        yearsField(`${k}/term`, "返す年数", find, 30, addr("termMonths")),
        timepointField({ key: `${k}/repay`, item: "goal.education", label: "返し始め", level: "detail", find, path: ["repaymentStart"], ageOf, optional: true, absentWhenEmpty: true, nullText: "空欄: 受け取りの終わりの7か月後" }),
        plain({
          key: `${k}/repaidBy`,
          item: "goal.education",
          label: "返す人",
          level: "detail",
          kind: "select",
          options: REPAID_BY,
          find,
          path: ["repaidBy"],
          optional: true,
          fallback: "child",
          help: "子が返すなら、返済は世帯の支出に入れません（受け取った奨学金は学費に使う入るお金のまま）。親が代わりに返すなど、世帯のお金から返すなら「世帯で返す」にします",
        }),
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
      title: `教育ローン ${amountText(l.amount)}`,
      note: "借りた月に入金になり、翌月から返します",
      level: "simple",
      moreLabel: "借りる額・金利・返す年数などを入れる",
      fields: [
        timepointField({ key: `${k}/at`, item: "goal.education", label: "借りる時期", level: "detail", find, path: ["at"], ageOf }),
        { ...plain({ key: `${k}/amount`, item: "goal.education", label: "借りる額", level: "detail", kind: "yen", basis: "once", find, path: ["amount"] }), ...at("amount") },
        { ...plain({ key: `${k}/rate`, item: "goal.education", label: "金利（年）", level: "detail", kind: "pct", find, path: ["rate"] }), ...at("rate") },
        yearsField(`${k}/term`, "返す年数", find, 25, addr("termMonths")),
        plain({ key: `${k}/borrower`, item: "goal.education", label: "ローンの名義", level: "detail", kind: "select", options: memberOptions(wh, (m) => m.kind === "self" || m.kind === "spouse"), find, path: ["borrower"] }),
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
    const monthly = presetNum("preset.education.scholarship.monthly");
    const s: EducationScholarship = { id, monthly, from: higherSchoolYears(g, child.id).from, to: { at: p.to }, rate: scholarshipRateEstimate().rate, termMonths: jassoRepayYears(monthly * months) * 12, repaidBy: "child" };
    (g.education.scholarships ??= []).push(s);
    estimatedRowAt(req.input as unknown as Obj, g.id, "scholarships", id, ["monthly", "rate", "termMonths"], scholarshipBasis());
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
    const l: EducationLoan = { id, at: { at: addMonths(p.from, -3) }, amount: Math.min(firstYearCost(st), loanCap(st)), rate: presetRate("preset.education.loan.rate"), termMonths: 240, borrower: self.id };
    (g.education.loans ??= []).push(l);
    estimatedRowAt(req.input as unknown as Obj, g.id, "loans", id, ["amount", "rate", "termMonths"], loanBasis());
  });
}

// ---- 留学（0088） ----

export const ABROAD_KINDS = [
  { value: "credit", label: "1年（単位が認められ、在学は延びない）" },
  { value: "leave", label: "1年（休学して留学し、在学が1年延びる）" },
  { value: "short", label: "短期（1か月ほど）" },
];
const ABROAD_CONTINGENCY = [
  { value: "continue", label: "続ける（既定）" },
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
      moreLabel: "万一のときの扱いを入れる",
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
            // 既定は「続ける」で、変えることは少ないので詳細
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

/**
 * 大学などの在学の始まり・最後の年の4月を、子の年齢（学年の4月。ageSwitch "schoolYear"）で表す時点。時期を子の物差しで読み、子の生年月を直しても
 * 一緒に動く（年月で書くと、ご本人の年齢で読まれ、生年月を直しても動かない）。大学などの段が無ければ18歳の4月から4年
 */
export function higherSchoolYears(goal: Goal | undefined, childId: string): { from: Timepoint; lastYear: Timepoint; label: string } {
  const st = (goal?.education?.stages ?? []).find((s) => isHigher(s.stage));
  const start = (STAGE_START_AGE[st?.stage ?? "university"] ?? 18) + (st?.delayYears ?? 0);
  const years = st === undefined ? 4 : stageYears(st);
  const at = (y: number): Timepoint => ({ memberAge: { member: childId, years: y, ageSwitch: "schoolYear" } });
  return { from: at(start), lastYear: at(start + years - 1), label: `${stageLabel(st?.stage ?? "university")}の${years}年間` };
}

/** 足した子の行の時期の推定の根拠（在学の期間に合わせた既定。直すと印は外れる） */
const childRowBasis = (label: string) => `既定の値（${label}。在学の期間に合わせました。時期が違えば直してください）`;

/** この子の入るお金を足す（受け取る人はその子。時期は大学などの在学の期間を子の年齢で。額は未入力） */
export function addChildIncome(wh: WorkingHousehold, childId: string, kind: "educationSupport" | "scholarshipGrant" | "childPays", id: string = newId()): WorkingHousehold {
  const next = addIncome(wh, kind, id);
  return mutate(next, (h, req) => {
    const f = (h.incomeFlows ?? []).find((x) => x.id === id);
    const child = h.members.find((m) => m.id === childId);
    if (f === undefined || child === undefined) return;
    const goal = (h.goals ?? []).find((x) => x.kind === "education" && x.owner === childId);
    const p = higherPeriod(goal, child);
    const y = higherSchoolYears(goal, childId);
    f.recipient = childId;
    f.from = y.from;
    // 年ごとの行は最後の年の4月まで（毎年4月に受け取る）、子が払う分（毎月）は卒業の月まで
    f.to = kind === "childPays" ? { at: p.to } : y.lastYear;
    f.everyYears = 1;
    if (kind === "childPays") f.monthly = true;
    else delete f.monthly;
    // 足した行の始まりの推定の印（「今から」の根拠のままにしない）
    putRow(req.input as unknown as Obj, { target: { object: id }, item: "incomeFlow.from", at: [] }, { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: childRowBasis(y.label) } });
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
        ? { id, label: "留学", kind: "education", row: "cf.expense.education", from: at20, to: structuredClone(at20), everyYears: 1, amount: standardBox(presetNum("preset.education.abroad"), presetBasis(presetText("preset.education.abroad", (v) => `留学 ${(Number(v) / 10000).toLocaleString("ja-JP")}万円`))) }
        : {
            id,
            label: "その他の教育費",
            kind: "education",
            row: "cf.expense.education",
            from: { memberAge: { member: childId, years: Math.max(12, ageNow + 1) } },
            to: { memberAge: { member: childId, years: Math.max(18, ageNow + 2) } },
            everyYears: 1,
            amount: standardBox(presetNum("preset.education.otherRow"), presetBasis(presetText("preset.education.otherRow", (v) => `その他の教育費 年${(Number(v) / 10000).toLocaleString("ja-JP")}万円`))),
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
  // 課税の扱いを隠した行（子が払う分・給付型の奨学金）は、「▸ 続きを見る」の文も課税の扱いを書かない
  const childIncomeGroups = (f: IncomeFlow): GroupDef[] => incomeGroups(wh, f, "education").map((g, i, all) => (i === 0 && all.some((x) => hideTax(f, x)) ? { ...g, moreLabel: incomeMoreLabel(null) } : g)).filter((g) => !hideTax(f, g));
  const groups: GroupDef[] = [...childIncomes(h, child.id).flatMap(childIncomeGroups), ...childExpenses(h, child.id).flatMap((p) => periodicGroups(wh, p))];
  const k = `edu/${child.id}/money`;
  const actions: ActionDef[] = [
    // 受け取るお金は1つのボタンで、足すときに種類を選ぶ（給付型の奨学金も標準で見つかるように）
    { key: `${k}/in/educationSupport`, label: "祖父母などの援助", help: "祖父母などから受け取る教育資金です", level: "simple", choice: aidChoice(k), run: (w) => addChildIncome(w, child.id, "educationSupport") },
    { key: `${k}/in/scholarshipGrant`, label: "給付型の奨学金・学費の助成", help: "返さなくてよい奨学金・学費の助成です。額を入れます", level: "simple", choice: aidChoice(k), run: (w) => addChildIncome(w, child.id, "scholarshipGrant") },
    { key: `${k}/in/childPays`, label: "子が払う分", help: "子のアルバイト・子の貯金から学費に充てる分です", level: "simple", choice: aidChoice(k), run: (w) => addChildIncome(w, child.id, "childPays") },
    ...(goal !== undefined && (goal.education?.stages ?? []).some((s) => ABROAD_STAGES.has(s.stage)) ? [{ key: `${k}/out/abroad`, label: "＋ 留学", help: "1回ずつ足します。何回も留学するときは、もう一度押して足します", level: "simple" as const, run: (w: WorkingHousehold) => addAbroad(w, goal.id) }] : []),
    { key: `${k}/out/other`, label: "＋ その他の教育費", help: "寮費・部活などの教育費です", level: "detail", run: (w) => addChildExpense(w, child.id, "other") },
  ];
  return { groups, actions };
}

/** この子の受け取るお金の「＋」（種類を選んで足す） */
const aidChoice = (k: string) => ({ key: `${k}/in`, label: "＋ 援助・給付型の奨学金を受ける", help: "祖父母などの援助・給付型の奨学金・子が払う分から選んで足します（貸与の奨学金・教育ローンは「▸」の中で足します）" });

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

/** 子への援助の見込み（値は priority。0103。ふつうの出るお金の行と同じ「確実」「不確実」） */
const GIFT_PRIORITIES = PRIORITIES;

/**
 * 子への援助の「出す人」の選択肢: 「世帯から出す」と、贈与する人ごとの「（名前）から出す」。贈与する人がいなければ空（欄を出さない）。
 * 前に選んだ人が今の候補に無ければ、そのまま残す（黙って書き換えない）
 */
export function giftDonorOptions(wh: WorkingHousehold, current: string | undefined): { value: string; label: string }[] {
  const others = donorOptions(wh).filter((o) => o.value !== "");
  if (others.length === 0 && (current === undefined || current === "")) return [];
  const out = [{ value: "", label: "世帯から出す" }, ...others.map((o) => ({ value: o.value, label: `${o.label}から出す` }))];
  if (current !== undefined && current !== "" && !out.some((o) => o.value === current)) out.push({ value: current, label: "前に選んだ人から出す" });
  return out;
}

function giftGroups(wh: WorkingHousehold, goal: Goal, child: Member, who: string): GroupDef[] {
  const find = byId(goals, goal.id);
  return (goal.education?.gifts ?? []).map((gift, i) => {
    const findG: Finder = (hh) => (getPath((hh.goals ?? []).find((g) => g.id === goal.id), ["education", "gifts", String(i)]) as Obj | undefined) ?? undefined;
    const k = `edu/${goal.id}/gift/${i}`;
    const donors = giftDonorOptions(wh, gift.donor);
    return {
      key: k,
      title: `${who}への援助 ${i + 1}`,
      note: `${donors.length === 0 && gift.donor === undefined ? "出す人: 世帯。" : ""}結婚・住宅資金などの援助です。相続・贈与の項目にも出ます${gift.donor !== undefined ? "。贈与する人から出すので、援助の額を世帯から出しません" : ""}`,
      level: "simple",
      moreLabel: "課税の方法などを入れる",
      fields: [
        plain({ key: `${k}/purpose`, item: "goal.education", label: "使い道", level: "simple", kind: "select", options: GIFT_PURPOSES, find: findG, path: ["purpose"] }),
        plain({ key: `${k}/amount`, item: "goal.education", label: "額", level: "simple", kind: "yen", basis: "once", find: findG, path: ["amount"] }),
        timepointField({ key: `${k}/at`, item: "goal.education", label: "時期", level: "simple", find: findG, path: ["at"], ageOf: (hh) => hh.members.find((m) => m.id === child.id) }),
        // 見込み（値は priority。0103）: ふつうの出るお金の行と同じ「確実」「不確実」。「不確実」の援助はふだんの計算に入れない。省略は確実
        plain({ key: `${k}/priority`, item: "goal.education", label: "見込み", level: "simple", kind: "select", options: GIFT_PRIORITIES, find: findG, path: ["priority"], optional: true, fallback: "need", help: likelihoodHelp("gift") }),
        // 出す人: 世帯の外の贈与する人がいなければ欄を出さない（世帯から出す。見出しの下の1行で読む）。いれば「世帯から出す」「（名前）から出す」
        ...(donors.length > 0 || gift.donor !== undefined
          ? [plain({ key: `${k}/donor`, item: "goal.education", label: "出す人", level: "simple", kind: "select", options: donors, find: findG, path: ["donor"], optional: true, fallback: "", help: "世帯のお金から出すか、家族の入力項目で登録した親・祖父母から出すか（贈与する人から出すと、援助の額を世帯から出しません）" })]
          : []),
        plain({ key: `${k}/payer`, item: "goal.education", label: "世帯の中で出す人", level: "detail", kind: "select", options: [{ value: "", label: "指定しない" }, ...memberOptions(wh, (m) => m.kind === "self" || m.kind === "spouse")], find: findG, path: ["payer"], optional: true, fallback: "" }),
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
  // 教育の段が全部過ぎた子（独立した子など）は、1行だけ（進路の型・推定の欄を出さず、推定にも数えない。通しの確かめ。0150）。
  // この子の入るお金・出るお金の行があれば、その行は今までどおり
  if (educationFinished(child, goal, base)) {
    return { key: `edu/${child.id}`, title: who, summary: finishedSummary(child, base), note: FINISHED_HELP, level: "simple", groups: [...leavesGroups(child), ...money.groups], actions: money.actions };
  }
  if (goal === undefined) {
    const course = defaultCourseLabel(child, base);
    const has = defaultStages(child, base).length > 0;
    const leaves = leavesGroups(child);
    return {
      key: `edu/${child.id}`,
      title: who,
      note: has ? `未入力（教育費0円で計算中）。進路が入っていません。「推定の進路で埋める」で既定の型「${course}」を推定で入れます` : "これからの学校の段階が無い年齢です（教育費は計算していません）",
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
    help: "はいにすると、0〜2歳の保育料を世帯の収入から自動で計算します（目安）。3歳の4月からは「保育園・幼稚園（3歳から）」の段階で、保育料は無償化で0円です",
    get: (w) => {
      const on = (((find(w.request.input.household, w) as Goal | undefined)?.education?.stages ?? []) as EducationStage[]).some((s) => s.stage === "nursery");
      // 推定のままの進路で共働き・働くひとり親なので「はい」にしているときは、その理由を添える（2026-11-14）
      const estimated = rowAt(w.request.input as unknown as Obj, educationStagesAddress(goal.id))?.state === "estimated";
      return { value: on, ...(estimated && on ? { hint: "推定: 親が働いている（共働き・働くひとり親）ので、通う見込みにしています" } : {}) };
    },
    set: (w, v) =>
      mutate(w, (hh) => {
        const g = find(hh, w) as Goal | undefined;
        if (g?.education === undefined) return;
        const has = g.education.stages.some((s) => s.stage === "nursery");
        if (v === true && !has) g.education.stages = [{ id: newId(), stage: "nursery" }, ...g.education.stages];
        if (v !== true && has) g.education.stages = g.education.stages.filter((s) => s.stage !== "nursery");
      }),
  });
  const row = rowAt(wh.request.input as unknown as Record<string, unknown>, educationStagesAddress(goal.id));
  const hasHigh = stages.some((s) => s.stage === "highSchool" || s.stage === "kosen");
  const groups: GroupDef[] = [
    {
      key: `edu/${goal.id}`,
      title: `${who}の進路`,
      ...(row?.state === "notApplicable"
        ? { note: "教育費は「該当なし」にしています（段階を足すと計算します）" }
        : row?.state === "estimated"
          ? { note: `進路は、ふつうの進み方${(row.estimate?.basis === EDUCATION_BASIS || row.estimate?.basis === EDUCATION_BASIS.replace("既定", "標準")) ? `（「${defaultCourseLabel(child, base)}」）` : ""}の目安で計算しています。実際の予定に合わせて直せます` }
          : {}),
      level: "simple",
      // 「▸」の中: 奨学金・教育ローン・子への援助・その他の教育費・学校（大学院など）を足すボタンと、この子の教育費を入れない
      moreLabel: "奨学金・教育ローン・子への援助などを入れる",
      fields: [...(nurseryAge ? [nurseryToggle] : []), uniformOutOfSchool(goal)],
      actions: [removeAction(`edu/${goal.id}/remove`, WORDS.remove, "detail", (hh) => void (hh.goals = (hh.goals ?? []).filter((g) => g.id !== goal.id))), ...(row?.state === "notApplicable" ? [] : [noneAction])],
    },
    // 児童手当・就学支援金は詳細だけ（標準では「▸」の中にも出さない。頭のまとまりの単位に入らないキーにし、詳細では進路の枠の中に描く。2026-11-14）
    {
      key: `edu/${child.id}/benefits`,
      title: "児童手当・就学支援金",
      level: "detail",
      partOf: `edu/${goal.id}`,
      fields: [
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
                help: "高校の授業料の支援（2026年度から所得の制限なし）。対象外にすると支援を計算しません。インターナショナルスクール（公立・私立の「インターナショナルスクール」）は、ここが対象でも計算しません",
              }),
            ]
          : []),
      ],
      actions: [],
    },
  ];
  groups.push(...leavesGroups(child));
  const start = nurseryDefaultStart(h, child);
  const outChoice = outOfSchoolChoiceOf(goal);
  const rowsMode = outChoice === "rows";
  let childTotal = 0;
  // 大学などの段が無く、この子の年齢でまだ大学などの前なら「大学など」の行（大学・短大・専門学校の欄だけ）を出す。該当なしのときは出さない
  const placeholder = row?.state !== "notApplicable" && !stages.some((s) => isHigher(s.stage)) && !stageEnded(child, { stage: "university" }, base);
  const higherPlaceholder = (): GroupDef => ({
    key: `edu/${goal.id}/higherNone`,
    title: `大学など（${STAGE_AGE.university}歳から）`,
    wideHead: true,
    note: "大学・短大・専門学校に行かない進路で計算しています（行く見込みなら、ここで学校を選びます）",
    level: "simple",
    fields: [higherKindField(goal.id)],
    actions: [],
  });
  stages.forEach((s, i) => {
    const entryAge = STAGE_AGE[s.stage];
    const note =
      s.stage !== "nursery"
        ? stageNote(s, lunchOf(goal), typeof s.id === "string" && rowAt(wh.request.input as unknown as Obj, { target: { object: goal.id }, item: "goal.education", at: ["stages", s.id, "annualOverride"] })?.state === "estimated", rowsMode)
        : nurseryNote(s, free);
    const cost = stageRemainingCost(child, s, base, lunchOf(goal), rowsMode);
    if (cost !== null) childTotal += cost.total;
    // 学費が未入力（0円）の段階は額を出さない（未入力の警告のほうを見せる）
    const costLine = cost === null || cost.total === 0 ? null : stageCostLine(cost);
    groups.push({
      key: `edu/${goal.id}/stage/${i}`,
      title: `${stageLabel(s.stage)}${entryAge !== undefined && s.stage !== "kindergarten" ? `（${entryAge}歳から）` : ""}`,
      // 大学院は前の学校を出た翌月の4月から（STAGE_AGE に無いので年齢は添えない）
      ...(note !== undefined && note !== "" ? { note } : {}),
      ...(costLine !== null ? { summary: costLine } : {}),
      // 学校の行は、欄の数によらず見出しを幅いっぱいの1行に（額の1行と「外す」を右の端に）
      wideHead: true,
      level: "simple",
      moreLabel: stageMoreLabel(s),
      fields: stageFields(goal.id, i, s, `${start.ym}（${start.reason}）`, outChoice),
      actions: [
        // 専門学校の学費は国の統計が無いので、目安（業界団体の調査の平均）を推定で入れるボタン。年額が入っていれば出さない
        ...(s.stage === "vocational" && s.annualOverride === undefined
          ? [{ key: `edu/${goal.id}/stage/${i}/guide`, label: VOCATIONAL_GUIDE_LABEL, help: `${VOCATIONAL_GUIDE.basis}。入学金が入っていれば入学金はそのままです`, level: "simple" as const, run: (w: WorkingHousehold) => fillVocationalGuide(w, goal.id, i) }]
          : []),
        // 大学・短大・専門学校の行は、行の先頭の欄の「大学などに行かない」で外す（外すボタンは出さない。2026-11-14）
        ...(isHigher(s.stage)
          ? []
          : [
              removeAction(`edu/${goal.id}/stage/${i}/remove`, WORDS.remove, "simple", (hh) => {
                const g = find(hh, wh) as Goal | undefined;
                if (g?.education !== undefined) g.education.stages = g.education.stages.filter((_, j) => j !== i);
              }),
            ]),
      ],
    });
    // 高校・高専の行の後に大学などの段が無ければ、「大学など」の行を欄だけで残す（「大学などに行かない」から選び直せる）
    if (placeholder && (s.stage === "highSchool" || s.stage === "kosen")) groups.push(higherPlaceholder());
  });
  // 高校・高専の段が無い進路（高校を外した・高校の前の段だけ）は、最後の学校の行の後に
  if (placeholder && !stages.some((s) => s.stage === "highSchool" || s.stage === "kosen")) groups.push(higherPlaceholder());
  const have = new Set(stages.map((s) => s.stage));
  const tertiary = stages.find((s) => isHigher(s.stage));
  // 足すボタンは、この子の年齢でこれからの段だけ（終わった段・3歳の4月を過ぎた保育園は出さない。0062 の追記 2026-10-30）
  const upcoming = SCHOOL_STAGES.filter((o) => !stageEnded(child, { stage: o.value }, base));
  // 高校と高専はどちらか1つ（高校の段の「高校・高専」で入れ替える。0090）
  const highOrKosen = have.has("highSchool") || have.has("kosen");
  // 大学・短大・専門学校は「大学など」の行の欄で選ぶ（行があるときは足すボタンを出さない）
  const addActions: ActionDef[] = upcoming.filter((o) => !have.has(o.value) && !(isHigher(o.value) && (placeholder || stages.some((s) => isHigher(s.stage)))) && !(isGraduate(o.value) && tertiary === undefined) && !((o.value === "highSchool" || o.value === "kosen") && highOrKosen)).map((o) => ({
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
  // （塾・習い事の行〔partOf〕は、塾・習い事のまとまりの枠の中に描く）
  const own = (g: GroupDef): GroupDef => (g.key.startsWith(`edu/${goal.id}/`) && g.partOf === undefined ? { ...g, ownBox: true } : g);
  // 見出し: 年齢・学年と、これからの教育費（段ごとの目安の合計。今の値段）
  return { key: `edu/${child.id}`, title: who, summary: `${childAgeGrade(child, base)}${childTotal > 0 ? `・これからの教育費 約${amountText(childTotal)}（今の値段・統計の平均）` : ""}`, level: "simple", groups: groups.map(own), actions: [] };
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

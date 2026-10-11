// 5. 子ども・教育: 子ごとに進路（公立・私立、大学の系統・自宅か自宅外か）を選び、統計の学費で計算する（0010・0008 の6 の教育の目標）。
// 学校名から学費を出す検索は、学校のデータを同梱してから（今は「学校未定（平均で計算）」だけ）
import type { EducationStage, Goal, Household, Member } from "../../../engine/types.ts";
import { schoolEntryYear } from "../../present.ts";
import { byId, field, getPath, plain, removeAction, timepointField, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, type WorkingHousehold } from "../household.ts";
import { donorOptions, FIELDS, GIFT_PURPOSES, HOUSING_EXEMPTION, LIVING_PLACE, memberLabel, memberOptions, SCHOOL_STAGES, SECTORS, TAX_METHODS } from "../labels.ts";

const goals = (h: Household) => h.goals;
const ORDER = ["nursery", "kindergarten", "elementary", "juniorHigh", "highSchool", "university", "juniorCollege", "vocational"];
const STAGE_AGE: Record<string, number> = { kindergarten: 3, elementary: 6, juniorHigh: 12, highSchool: 15, university: 18, juniorCollege: 18, vocational: 18 };

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

/** 今からの進路の初めの形: 子の年齢から、まだ終わっていない段だけ（大学は私立・文系・自宅） */
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

function stageFields(goalId: string, i: number, s: EducationStage): FieldDef[] {
  const find: Finder = (h) => (getPath((h.goals ?? []).find((g) => g.id === goalId), ["education", "stages", String(i)]) as Record<string, unknown> | undefined) ?? undefined;
  const key = `edu/${goalId}/stage/${i}`;
  const higher = s.stage === "university" || s.stage === "juniorCollege" || s.stage === "vocational";
  const sectorOptions = s.stage === "nursery" ? [] : s.stage === "university" ? SECTORS : SECTORS.filter((o) => o.value !== "national" || s.stage === "elementary" || s.stage === "juniorHigh" || s.stage === "highSchool");
  const fields: FieldDef[] = [];
  if (s.stage === "nursery") fields.push(plain({ key: `${key}/monthly`, item: "goal.education", label: "保育料（月額）", level: "simple", kind: "yen", basis: "monthly", find, path: ["monthly"], optional: true, help: "3歳からは無償化を自動で計算します" }));
  else fields.push(plain({ key: `${key}/sector`, item: "goal.education", label: "公立・私立", level: "simple", kind: "select", options: sectorOptions, find, path: ["sector"], optional: true, fallback: "public" }));
  if (s.stage === "university") fields.push(plain({ key: `${key}/field`, item: "goal.education", label: "系統", level: "simple", kind: "select", options: FIELDS, find, path: ["field"], optional: true, fallback: "humanities" }));
  if (higher) fields.push(plain({ key: `${key}/living`, item: "goal.education", label: "通い方", level: "simple", kind: "select", options: LIVING_PLACE, find, path: ["living"], optional: true, fallback: "home" }));
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
  }
  return fields;
}

function childSection(wh: WorkingHousehold, child: Member): SectionDef {
  const h = wh.request.input.household;
  const goal = (h.goals ?? []).find((g) => g.kind === "education" && g.owner === child.id);
  const who = memberLabel(wh, child.id);
  if (goal === undefined)
    return {
      key: `edu/${child.id}`,
      title: who,
      note: "進路が入っていないので、教育費は計算していません",
      level: "simple",
      groups: [],
      actions: [
        {
          key: `edu/${child.id}/add`,
          label: "＋ 進路を入れる（公立から始める）",
          level: "simple",
          run: (w) => mutate(w, (hh) => void (hh.goals ??= []).push({ id: newId(), kind: "education", owner: child.id, education: { stages: defaultStages(child, w.request.input.baseMonth) } })),
        },
      ],
    };
  const stages = goal.education?.stages ?? [];
  const find = byId(goals, goal.id);
  const course = field({
    key: `edu/${goal.id}/preset`,
    item: "goal.education",
    label: "進路の型",
    level: "simple",
    kind: "select",
    options: [{ value: "", label: "自分で選ぶ（下の各段）" }, ...COURSE_PRESETS.map((p) => ({ value: p.value, label: p.label }))],
    structural: true,
    get: (w) => ({ value: presetOf(((find(w.request.input.household, w) as Goal | undefined)?.education?.stages ?? []) as EducationStage[]) }),
    set: (w, v) =>
      mutate(w, (hh) => {
        const p = COURSE_PRESETS.find((x) => x.value === v);
        const g = find(hh, w) as Goal | undefined;
        if (p === undefined || g?.education === undefined) return;
        for (const s of g.education.stages) if (p.sectors[s.stage] !== undefined) s.sector = p.sectors[s.stage];
      }),
  });
  const groups: GroupDef[] = [
    {
      key: `edu/${goal.id}`,
      title: `${who}の進路`,
      level: "simple",
      fields: [
        course,
        plain({ key: `edu/${goal.id}/allowance`, item: "goal.education", label: "児童手当を計算する", level: "detail", kind: "bool", find, path: ["education", "childAllowance"], optional: true, fallback: true }),
      ],
      actions: [removeAction(`edu/${goal.id}/remove`, "進路を外す", "detail", (hh) => void (hh.goals = (hh.goals ?? []).filter((g) => g.id !== goal.id)))],
    },
  ];
  stages.forEach((s, i) => {
    const entryAge = STAGE_AGE[s.stage];
    groups.push({
      key: `edu/${goal.id}/stage/${i}`,
      title: `${SCHOOL_STAGES.find((o) => o.value === s.stage)?.label ?? s.stage}${entryAge !== undefined ? `（${entryAge}歳から）` : ""}`,
      level: "simple",
      fields: stageFields(goal.id, i, s),
      actions: [
        removeAction(`edu/${goal.id}/stage/${i}/remove`, s.stage === "university" ? "大学に行かない" : "この段を外す", "simple", (hh) => {
          const g = find(hh, wh) as Goal | undefined;
          if (g?.education !== undefined) g.education.stages = g.education.stages.filter((_, j) => j !== i);
        }),
      ],
    });
  });
  const have = new Set(stages.map((s) => s.stage));
  const addActions: ActionDef[] = SCHOOL_STAGES.filter((o) => !have.has(o.value)).map((o) => ({
    key: `edu/${goal.id}/addStage/${o.value}`,
    label: `＋ ${o.label}`,
    level: o.value === "university" || o.value === "highSchool" ? "simple" : "detail",
    run: (w) =>
      mutate(w, (hh) => {
        const g = find(hh, w) as Goal | undefined;
        if (g?.education === undefined) return;
        const st: EducationStage = o.value === "university" ? { stage: o.value, sector: "private", field: "humanities", living: "home" } : o.value === "nursery" ? { stage: o.value, monthly: 30000 } : { stage: o.value, sector: "public" };
        g.education.stages = [...g.education.stages, st].sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage));
      }),
  }));
  groups.push({ key: `edu/${goal.id}/addStages`, level: "simple", fields: [], actions: addActions });

  // 塾・習い事
  (goal.education?.lessons ?? []).forEach((l, i) => {
    const findL: Finder = (hh) => (getPath((hh.goals ?? []).find((g) => g.id === goal.id), ["education", "lessons", String(i)]) as Record<string, unknown> | undefined) ?? undefined;
    const k = `edu/${goal.id}/lesson/${i}`;
    groups.push({
      key: k,
      title: l.label ?? "塾・習い事",
      level: "detail",
      fields: [
        plain({ key: `${k}/label`, item: "goal.education", label: "名前", level: "detail", kind: "text", find: findL, path: ["label"], optional: true }),
        plain({ key: `${k}/monthly`, item: "goal.education", label: "月謝（月額）", level: "detail", kind: "yen", basis: "monthly", find: findL, path: ["monthly"] }),
        timepointField({ key: `${k}/from`, item: "goal.education", label: "始まり", level: "detail", find: findL, path: ["from"], ageOf: (hh) => hh.members.find((m) => m.id === child.id) }),
        timepointField({ key: `${k}/to`, item: "goal.education", label: "終わり", level: "detail", find: findL, path: ["to"], ageOf: (hh) => hh.members.find((m) => m.id === child.id) }),
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

  // 援助（子への援助。贈与する人を選べる）
  (goal.education?.gifts ?? []).forEach((gift, i) => {
    const findG: Finder = (hh) => (getPath((hh.goals ?? []).find((g) => g.id === goal.id), ["education", "gifts", String(i)]) as Record<string, unknown> | undefined) ?? undefined;
    const k = `edu/${goal.id}/gift/${i}`;
    groups.push({
      key: k,
      title: `${who}への援助 ${i + 1}`,
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
    });
  });
  groups.push({
    key: `edu/${goal.id}/addMore`,
    level: "simple",
    fields: [],
    actions: [
      {
        key: `edu/${goal.id}/addLesson`,
        label: "＋ 塾・習い事",
        level: "detail",
        run: (w) =>
          mutate(w, (hh) => {
            const g = find(hh, w) as Goal | undefined;
            const base = w.request.input.baseMonth;
            if (g?.education !== undefined) (g.education.lessons ??= []).push({ from: { at: base }, to: { at: `${Number(base.slice(0, 4)) + 3}-03` }, monthly: 20000, label: "塾" });
          }),
      },
      {
        key: `edu/${goal.id}/addGift`,
        label: "＋ 援助（結婚・住宅資金など）",
        level: "simple",
        run: (w) =>
          mutate(w, (hh) => {
            const g = find(hh, w) as Goal | undefined;
            const donor = (hh.donors ?? [])[0]?.id;
            const at = `${Number(child.birth.birthYearMonth.slice(0, 4)) + 30}-04`;
            if (g?.education !== undefined) (g.education.gifts ??= []).push({ at: { at }, amount: 1000000, purpose: "housing", ...(donor !== undefined ? { donor } : {}) });
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
  return { id: "education", label: "子ども・教育", lead: "子ごとの進路。学費は統計の平均（文部科学省「子供の学習費調査」など）で計算します。", sections };
}

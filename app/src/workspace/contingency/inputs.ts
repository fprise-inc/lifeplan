// 万一の想定の前提の欄（万一の画面のグラフの下に出す。主画面の対策と同じ並べ方・同じ部品で描く: PremisePanel.tsx）。
// 値は世帯の要求ではなく、画面の側の前提（WorkingHousehold.contingency）を読み書きする。団信だけは住まい・ローンの段階と同じ欄（世帯の要求）
import type { OldAgeChoice } from "../../engine/types.ts";
import { field, getPath, setPath, type FieldDef, type FieldState, type GroupDef, type Level, type Option, type SectionDef, type Val } from "../input/form.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { memberLabel } from "../input/labels.ts";
import { creditLifeGroups } from "../input/stages/housing.ts";
import type { ContingencyPlan } from "./planData.ts";
import { adults } from "./requests.ts";

type Obj = Record<string, unknown>;

/** 前提の欄の描き方（スライダーの範囲・既定の値）。欄の定義（FieldDef）には持たせず、ここで欄ごとに覚えておく */
export interface PremiseMeta {
  /** スライダーの範囲（金額は円、率は百分率の整数、整数はそのまま）。選択の欄は null */
  slider: { min: number; max: number; step: number } | null;
  /** 省略のときの既定（書き戻すと省略に戻る） */
  fallback: Val | undefined;
  /** 空欄（省略）が「目安・自動で計算」の意味の欄の、その説明（例: 「自動（勤続の月数で按分）」）。無い欄は空欄＝0 */
  auto: string | undefined;
}

const META = new WeakMap<FieldDef, PremiseMeta>();

/** 前提の欄の描き方（万一の前提の欄でなければ undefined） */
export function premiseMeta(f: FieldDef): PremiseMeta | undefined {
  return META.get(f);
}

const MAN = 10000;

/** 前提の欄（path は ContingencyPlan の中の場所）。fallback は省略のときの既定（書き戻すと省略に戻る） */
function planField(o: {
  key: string;
  label: string;
  level?: Level;
  kind: "pct" | "yen" | "int" | "select";
  basis?: "once" | "monthly" | "annual";
  options?: Option[];
  suffix?: string;
  min?: number;
  max?: number;
  path: readonly string[];
  fallback?: Val;
  help?: string;
  /** 値を数として持つ選択（等級） */
  numeric?: boolean;
  /** 金額のスライダーの上限（円。下限は0、刻みは1万円） */
  maxYen?: number;
  /** 空欄が「目安・自動」の意味のときの説明 */
  auto?: string;
}): FieldDef {
  const kindPart: Obj = { kind: o.kind };
  if (o.kind === "yen") kindPart.basis = o.basis ?? "once";
  if (o.kind === "select") kindPart.options = o.options ?? [];
  if (o.suffix !== undefined) kindPart.suffix = o.suffix;
  if (o.min !== undefined) kindPart.min = o.min;
  if (o.max !== undefined) kindPart.max = o.max;
  const def = field({
    key: o.key,
    item: null,
    label: o.label,
    level: o.level ?? "simple",
    optional: true,
    ...(o.help !== undefined ? { help: o.help } : {}),
    ...(kindPart as { kind: "int" }),
    get: (wh): FieldState => {
      const raw = getPath(wh.contingency, o.path);
      const v = raw === undefined ? null : o.numeric === true ? String(raw) : (raw as Val);
      if (v === null) return { value: o.fallback ?? null, ...(o.fallback !== undefined ? { implicit: true } : {}) };
      return { value: v, ...(o.fallback !== undefined && v === o.fallback ? { implicit: true } : {}) };
    },
    set: (wh, v) => {
      const plan = structuredClone(wh.contingency) as unknown as Obj;
      const none = v === null || v === "" || (o.fallback !== undefined && v === o.fallback);
      setPath(plan, o.path, none ? undefined : o.numeric === true ? Number(v) : v);
      // 空になった入れ物も残す形（survivor・work・oldAgeChoice）はそろえる
      const p = plan as unknown as ContingencyPlan;
      p.survivor ??= {};
      p.work ??= {};
      p.oldAgeChoice ??= {};
      return { ...wh, contingency: p };
    },
  });
  const slider =
    o.kind === "pct" ? { min: 0, max: 100, step: 1 } : o.kind === "yen" ? { min: 0, max: o.maxYen ?? 1000 * MAN, step: MAN } : o.kind === "int" ? { min: o.min ?? 0, max: Math.min(o.max ?? 100, 120), step: 1 } : null;
  META.set(def, { slider, fallback: o.fallback, auto: o.auto });
  return def;
}

export const HORIZON_KINDS: Option[] = [
  { value: "lifeExpectancy", label: "配偶者の平均余命まで" },
  { value: "youngestIndependence", label: "末子の独立まで" },
  { value: "age", label: "配偶者が決めた年齢になるまで" },
];

export const SURVIVOR_WORK_TYPES: Option[] = [
  { value: "keep", label: "今の働き方を続ける" },
  { value: "regular", label: "正社員として働く" },
  { value: "contract", label: "契約社員として働く" },
  { value: "partTime", label: "パートで働く" },
  { value: "selfEmployed", label: "自営業" },
  { value: "none", label: "働かない" },
];

export const GRADES: Option[] = [
  { value: "1", label: "障害1級に該当した場合" },
  { value: "2", label: "障害2級に該当した場合" },
  { value: "3", label: "障害3級に該当した場合" },
  { value: "0", label: "障害年金に当たらない（働けないだけ）" },
];

export const OLD_AGE_CHOICES: Option[] = [
  { value: "", label: "自動（手取りが多い組み合わせ）" },
  { value: "disability", label: "障害基礎年金＋障害厚生年金" },
  { value: "disabilityBasicOldAgeEmployee", label: "障害基礎年金＋老齢厚生年金" },
  { value: "oldAge", label: "老齢基礎年金＋老齢厚生年金" },
];

export const OLD_AGE_CHOICE_LABEL: Record<OldAgeChoice, string> = {
  disability: "障害基礎年金＋障害厚生年金",
  disabilityBasicOldAgeEmployee: "障害基礎年金＋老齢厚生年金",
  oldAge: "老齢基礎年金＋老齢厚生年金",
};

/** 残された人の働き方（大人ごと。配偶者が亡くなった想定で使う） */
function workGroups(wh: WorkingHousehold): GroupDef[] {
  const out: GroupDef[] = [];
  for (const a of adults(wh.request.input.household)) {
    if (a.spouse === undefined) continue;
    const id = a.spouse.id;
    const k = `cg/work/${id}`;
    const w = wh.contingency.work[id];
    const fields: FieldDef[] = [planField({ key: `${k}/type`, label: "働き方", kind: "select", options: SURVIVOR_WORK_TYPES, path: ["work", id, "type"], fallback: "keep" })];
    if (w?.type !== undefined && w.type !== "keep") {
      fields.push(planField({ key: `${k}/after`, label: "変える時期（亡くなってから）", kind: "int", suffix: "か月後", min: 0, max: 120, path: ["work", id, "afterMonths"], fallback: 6 }));
      if (w.type !== "none") {
        fields.push(
          planField({ key: `${k}/salary`, label: w.type === "selfEmployed" ? "事業の所得（年額）" : "年収（賞与を除く）", kind: "yen", basis: "annual", path: ["work", id, "annualSalary"], help: "空欄なら働き方ごとの目安で計算します", maxYen: 1500 * MAN, auto: "働き方ごとの目安" }),
          planField({ key: `${k}/until`, label: "何歳まで", kind: "int", suffix: "歳", min: 20, max: 80, path: ["work", id, "untilAge"], fallback: 65 }),
        );
      }
    }
    out.push({ key: k, title: `${memberLabel(wh, a.member.id)}が亡くなった後の${memberLabel(wh, id)}の働き方`, level: "simple", fields, actions: [] });
  }
  return out;
}

/** 前提の欄の区画（万一の画面のグラフの下） */
export function contingencyInputSections(wh: WorkingHousehold): SectionDef[] {
  const plan = wh.contingency;
  const sections: SectionDef[] = [
    {
      key: "cg/living",
      title: "遺族の生活費",
      note: "今の生活費（節目を当てた後）に掛ける割合。必要保障額の推移と死亡の想定に使います",
      level: "simple",
      groups: [
        {
          key: "cg/living/ratio",
          level: "simple",
          fields: [
            planField({ key: "cg/living/before", label: "子がいる間", kind: "pct", path: ["survivor", "livingRatio", "beforeIndependence"], fallback: "0.7" }),
            planField({ key: "cg/living/after", label: "末子の独立の後", kind: "pct", path: ["survivor", "livingRatio", "afterIndependence"], fallback: "0.5" }),
            planField({ key: "cg/living/noKids", label: "子がいない世帯", kind: "pct", path: ["survivor", "livingRatio", "noChildren"], fallback: "0.7" }),
          ],
          actions: [],
        },
      ],
      actions: [],
    },
    {
      key: "cg/lump",
      title: "一時の資金",
      level: "simple",
      groups: [
        {
          key: "cg/lump/fields",
          level: "simple",
          fields: [
            planField({ key: "cg/lump/allowance", label: "死亡退職金", kind: "yen", path: ["survivor", "deathBenefits", "retirementAllowance"], help: "空欄なら、退職金の見込みを勤続の月数で按分します", maxYen: 5000 * MAN, auto: "自動（勤続の月数で按分）" }),
            planField({ key: "cg/lump/condolence", label: "弔慰金", kind: "yen", path: ["survivor", "deathBenefits", "condolence"], maxYen: 1000 * MAN }),
            planField({ key: "cg/lump/funeral", label: "整理資金（葬儀・お墓など）", kind: "yen", path: ["survivor", "funeral"], help: "亡くなった月の翌月の支出にします", maxYen: 1000 * MAN }),
            planField({ key: "cg/lump/reserve", label: "予備の生活資金", kind: "int", suffix: "か月分", min: 0, max: 120, path: ["survivor", "reserveMonths"], help: "遺族の生活費の何か月分を、必要保障額に足すか" }),
          ],
          actions: [],
        },
      ],
      actions: [],
    },
    {
      key: "cg/horizon",
      title: "必要保障額の期間",
      level: "simple",
      groups: [
        {
          key: "cg/horizon/fields",
          level: "simple",
          fields: [
            planField({ key: "cg/horizon/kind", label: "いつまでの資金を数えるか", kind: "select", options: HORIZON_KINDS, path: ["horizon", "kind"], fallback: "lifeExpectancy" }),
            ...(plan.horizon?.kind === "age" ? [planField({ key: "cg/horizon/age", label: "配偶者の年齢", kind: "int", suffix: "歳", min: 50, max: 110, path: ["horizon", "age"], fallback: 90 })] : []),
          ],
          actions: [],
        },
      ],
      actions: [],
    },
    { key: "cg/work", title: "残された配偶者の働き方", note: "死亡の想定で、残された配偶者の働き方を置き換えます（必要保障額の推移は今の働き方のまま）", level: "simple", groups: workGroups(wh), actions: [] },
    {
      key: "cg/disability",
      title: "就業不能・障害の想定",
      note: "等級は「該当した場合」の仮定です。ご家族の実際の状態としては記録しません",
      level: "simple",
      groups: [
        {
          key: "cg/disability/fields",
          level: "simple",
          fields: [
            planField({ key: "cg/disability/grade", label: "仮定の等級", kind: "select", options: GRADES, path: ["grade"], fallback: "2", numeric: true }),
            planField({ key: "cg/disability/medical", label: "医療費（1か月・10割）", level: "detail", kind: "yen", basis: "monthly", path: ["medical", "monthly"], help: "高額療養費で止めた自己負担を計算します", maxYen: 300 * MAN }),
            planField({ key: "cg/disability/months", label: "医療費の月数", level: "detail", kind: "int", suffix: "か月", min: 1, max: 600, path: ["medical", "months"], fallback: 12 }),
          ],
          actions: [],
        },
      ],
      actions: [],
    },
  ];
  const cl = creditLifeGroups(wh);
  if (cl.length > 0) sections.push({ key: "cg/creditLife", title: "団信（住まい・ローンの段階と同じ欄）", note: "どちらで直しても同じ住宅ローンの値が変わります", level: "simple", groups: cl, actions: [] });
  return sections;
}

/** 障害年金の65歳からの組み合わせを選び直す欄（障害の想定の人ごと） */
export function oldAgeChoiceField(memberId: string): FieldDef {
  return planField({ key: `cg/choice/${memberId}`, label: "65歳からの障害年金と老齢年金の組み合わせ", kind: "select", options: OLD_AGE_CHOICES, path: ["oldAgeChoice", memberId], fallback: "" });
}

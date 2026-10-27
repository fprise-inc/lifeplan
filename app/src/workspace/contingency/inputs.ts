// 万一の想定の前提の欄（万一の画面のグラフの下に出す。主画面の対策と同じ並べ方・同じ部品で描く: PremisePanel.tsx）。
// 値は世帯の要求ではなく、画面の側の前提（WorkingHousehold.contingency）を読み書きする。団信だけは住まい・ローンの段階と同じ欄（世帯の要求）
import type { OldAgeChoice, Timepoint } from "../../engine/types.ts";
import { field, getPath, resolveTimepoint, setPath, timeView, type FieldDef, type FieldState, type GroupDef, type Level, type Option, type SectionDef, type Val } from "../input/form.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { ASSET_CLASSES, memberLabel } from "../input/labels.ts";
import { creditLifeGroups } from "../input/stages/housing.ts";
import type { ContingencyPlan } from "./planData.ts";
import { PREMISE_ITEMS } from "./premiseItems.ts";
import { adults, ESOP, HOSPITAL_DAYS_DEFAULT, FX_DEPOSIT, hasInvested, INCOME_DROP_DEFAULT, ILLNESS_DEFAULT, MARKET_CLASSES_DEFAULT, MARKET_DROP_DEFAULT } from "./requests.ts";

/** 病気の種類（0055） */
const DISEASES: Option[] = [
  { value: "cancer", label: "がん" },
  { value: "heartStroke", label: "心疾患・脳卒中" },
  { value: "other", label: "そのほか" },
];

/** 相場が下がったときの下がる幅（2〜5割） */
const DROPS: Option[] = [
  { value: "0.2", label: "2割" },
  { value: "0.3", label: "3割" },
  { value: "0.4", label: "4割" },
  { value: "0.5", label: "5割" },
];

type Obj = Record<string, unknown>;

/** 前提の欄の描き方（スライダーの範囲・既定の値）。欄の定義（FieldDef）には持たせず、ここで欄ごとに覚えておく */
export interface PremiseMeta {
  /** スライダーの範囲（金額は円、率は百分率の整数、整数はそのまま）。選択の欄は null */
  slider: { min: number; max: number; step: number } | null;
  /** 省略のときの既定（書き戻すと省略に戻る） */
  fallback: Val | undefined;
  /** 空欄（省略）が「目安・自動で計算」の意味の欄の、その説明（例: 「自動（勤続の月数で按分）」）。無い欄は空欄＝0 */
  auto: string | undefined;
  /** 前提の中の場所（プランごとの上書きの当て先。0071） */
  path: readonly string[];
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
    item: PREMISE_ITEMS[o.path[0] ?? ""] ?? null,
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
  META.set(def, { slider, fallback: o.fallback, auto: o.auto, path: o.path });
  return def;
}

/** オン／オフの前提の欄（path は ContingencyPlan の中の場所。既定はオフ） */
function planBool(o: { key: string; label: string; level?: Level; path: readonly string[]; help?: string }): FieldDef {
  const def = field({
    key: o.key,
    item: PREMISE_ITEMS[o.path[0] ?? ""] ?? null,
    label: o.label,
    level: o.level ?? "detail",
    kind: "bool",
    optional: true,
    ...(o.help !== undefined ? { help: o.help } : {}),
    get: (wh): FieldState => {
      const v = getPath(wh.contingency, o.path) === true;
      return { value: v, ...(v ? {} : { implicit: true }) };
    },
    set: (wh, v) => {
      const plan = structuredClone(wh.contingency) as unknown as Obj;
      setPath(plan, o.path, v === true ? true : undefined);
      return { ...wh, contingency: plan as unknown as ContingencyPlan };
    },
  });
  META.set(def, { slider: null, fallback: false, auto: undefined, path: o.path });
  return def;
}

/** 下げる資産の選択肢（資産の種類と、器ごと下げる持株会・外貨預金） */
export const MARKET_CLASS_OPTIONS: Option[] = [
  ...["equity.domestic", "equity.global", "reit.domestic", "reit.global", "bond.domestic", "bond.global", "balanced", "commodity"].map((v) => ({ value: v, label: ASSET_CLASSES.find((c) => c.value === v)?.label ?? v })),
  { value: ESOP, label: "持株会（配分を入れていない分）" },
  { value: FX_DEPOSIT, label: "外貨預金" },
];

/** 下げる資産の1つ（入れる・入れない）。書くと下げる資産の並びの全体（market.classes）を書き換える。既定の並びと同じなら省く */
function marketClassField(opt: Option): FieldDef {
  const path = ["market", "classes"] as const;
  const def = field({
    key: `cg/market/class/${opt.value}`,
    item: PREMISE_ITEMS.market ?? null,
    label: opt.label,
    level: "detail",
    kind: "bool",
    get: (wh): FieldState => {
      const list = (getPath(wh.contingency, path) as string[] | undefined) ?? MARKET_CLASSES_DEFAULT;
      return { value: list.includes(opt.value), ...(getPath(wh.contingency, path) === undefined ? { implicit: true } : {}) };
    },
    set: (wh, v) => {
      const cur = (getPath(wh.contingency, path) as string[] | undefined) ?? [...MARKET_CLASSES_DEFAULT];
      const next = MARKET_CLASS_OPTIONS.map((x) => x.value).filter((x) => (x === opt.value ? v === true : cur.includes(x)));
      const same = next.length === MARKET_CLASSES_DEFAULT.length && next.every((x) => MARKET_CLASSES_DEFAULT.includes(x));
      const plan = structuredClone(wh.contingency) as unknown as Obj;
      setPath(plan, path, same ? undefined : next);
      return { ...wh, contingency: plan as unknown as ContingencyPlan };
    },
  });
  META.set(def, { slider: null, fallback: MARKET_CLASSES_DEFAULT.includes(opt.value), auto: undefined, path });
  return def;
}

/** 残された配偶者の働き方を変える時期を、時点（人の年齢・出来事から）で入れる欄（0071。空は「亡くなった月から○か月後」） */
function workFromField(id: string, k: string): FieldDef {
  const path = ["work", id, "from"];
  const read = (wh: WorkingHousehold) => (getPath(wh.contingency, path) as Timepoint | undefined) ?? null;
  const time = timeView({
    read,
    write: (wh, tp) => {
      const plan = structuredClone(wh.contingency) as unknown as Obj;
      setPath(plan, path, tp ?? undefined);
      return { ...wh, contingency: plan as unknown as ContingencyPlan };
    },
    optional: true,
    nullText: "亡くなった月から○か月後（上の欄）",
    modes: ["age", "ym", "event"],
    mode: "age",
    ageOf: (h) => h.members.filter((m) => m.kind === "child").sort((a, b) => b.birth.birthYearMonth.localeCompare(a.birth.birthYearMonth))[0],
  });
  const def = field({
    key: `${k}/from`,
    item: PREMISE_ITEMS.work ?? null,
    label: "変える時期を時点で（下の子の年齢・出来事から）",
    level: "detail",
    kind: "when",
    time,
    optional: true,
    help: "亡くなった月より前の時点は、亡くなった月にします。空欄なら、亡くなった月から上の欄の月数の後",
    get: (wh) => ({ value: resolveTimepoint(wh.request.input.household, read(wh)), when: time.state(wh), ...(read(wh) === null ? { implicit: true } : {}) }),
    set: (wh, v) => (v === null || typeof v === "object" ? time.setWhen(wh, v as Timepoint | null, "this") : wh),
  });
  META.set(def, { slider: null, fallback: undefined, auto: undefined, path });
  return def;
}

export const HORIZON_KINDS: Option[] = [
  { value: "lifeExpectancy", label: "配偶者の平均余命まで（配偶者がいなければ末子の独立まで）" },
  { value: "youngestIndependence", label: "末子の独立まで" },
  { value: "age", label: "配偶者が決めた年齢になるまで" },
];

export const PROTECTION_METHODS: Option[] = [
  { value: "accumulation", label: "積み上げ方式（標準）" },
  { value: "reverse", label: "逆算方式" },
];

const INCOME_WHO: Option[] = [
  { value: "self", label: "本人" },
  { value: "spouse", label: "配偶者" },
  { value: "both", label: "本人と配偶者" },
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
      if (w.type !== "none")
        fields.push(planField({ key: `${k}/salary`, label: w.type === "selfEmployed" ? "事業の所得（年額）" : "年収（賞与を除く）", kind: "yen", basis: "annual", path: ["work", id, "annualSalary"], help: "空欄なら働き方ごとの目安で計算します", maxYen: 1500 * MAN, auto: "働き方ごとの目安" }));
      fields.push(planField({ key: `${k}/after`, label: "変える時期（亡くなってから）", level: "detail", kind: "int", suffix: "か月後", min: 0, max: 120, path: ["work", id, "afterMonths"], fallback: 6 }), workFromField(id, k));
      if (w.type !== "none") fields.push(planField({ key: `${k}/until`, label: "何歳まで", level: "detail", kind: "int", suffix: "歳", min: 20, max: 80, path: ["work", id, "untilAge"], fallback: 65 }));
    }
    out.push({ key: k, title: `${memberLabel(wh, a.member.id)}が亡くなった後の${memberLabel(wh, id)}の働き方`, level: "simple", fields, actions: [] });
  }
  return out;
}

/** まとまり1つの区画 */
const one = (key: string, title: string, fields: FieldDef[], o: { note?: string; level?: Level } = {}): SectionDef => ({
  key,
  title,
  ...(o.note !== undefined ? { note: o.note } : {}),
  level: o.level ?? "simple",
  groups: [{ key: `${key}/fields`, level: o.level ?? "simple", fields, actions: [] }],
  actions: [],
});

/**
 * 前提の欄の区画（万一の画面のグラフの下）。簡易／詳細の2形式（0071）: 簡易は場面ごとに1〜3欄（遺族の生活費は今の世帯に当たる1つ・
 * 整理資金・働き方と年収・病気の働けない期間・収入が減る・下がる幅）、ほかは詳細
 */
export function contingencyInputSections(wh: WorkingHousehold): SectionDef[] {
  const plan = wh.contingency;
  const h = wh.request.input.household;
  const kids = h.members.some((m) => m.kind === "child");
  const couple = adults(h).some((a) => a.spouse !== undefined);
  const lv = (simple: boolean): Level => (simple ? "simple" : "detail");
  const sections: SectionDef[] = [
    one(
      "cg/living",
      "遺族の生活費",
      [
        planField({ key: "cg/living/before", label: "子がいる間", level: lv(kids), kind: "pct", path: ["survivor", "livingRatio", "beforeIndependence"], fallback: "0.7" }),
        planField({ key: "cg/living/after", label: "末子の独立の後", level: "detail", kind: "pct", path: ["survivor", "livingRatio", "afterIndependence"], fallback: "0.5" }),
        planField({ key: "cg/living/noKids", label: "子がいない世帯", level: lv(!kids), kind: "pct", path: ["survivor", "livingRatio", "noChildren"], fallback: "0.7" }),
        planField({
          key: "cg/living/independence",
          label: "子の独立とみなす年齢",
          level: "detail",
          kind: "int",
          suffix: "歳",
          min: 15,
          max: 30,
          path: ["survivor", "independenceAge"],
          fallback: 22,
          help: "子の独立の時点を入れていない子に使います（入れている子はその時点）。その年齢の後の最初の3月末の翌月を独立とみなします",
        }),
      ],
      { note: "今の生活費（節目を当てた後）に掛ける割合（標準の値。出典は確かめ前）。必要保障額の推移と死亡の想定に使います" },
    ),
    one("cg/lump", "一時の資金", [
      planField({ key: "cg/lump/funeral", label: "整理資金（葬儀・お墓など）", kind: "yen", path: ["survivor", "funeral"], help: "亡くなった月の翌月の支出にします", maxYen: 1000 * MAN }),
      planField({ key: "cg/lump/allowance", label: "死亡退職金", level: "detail", kind: "yen", path: ["survivor", "deathBenefits", "retirementAllowance"], help: "空欄なら、退職金の見込みを勤続の月数で按分します（退職給付×亡くなる月までの勤続の月数÷退職までの勤続の月数）", maxYen: 5000 * MAN, auto: "自動（勤続の月数で按分）" }),
      planField({ key: "cg/lump/condolence", label: "弔慰金", level: "detail", kind: "yen", path: ["survivor", "deathBenefits", "condolence"], maxYen: 1000 * MAN }),
      planBool({ key: "cg/lump/workRelated", label: "業務上の死亡として見る", path: ["survivor", "deathBenefits", "workRelated"], help: "死亡退職金・弔慰金の非課税の扱いが変わります（労災の給付は計算に入れません）" }),
      planField({ key: "cg/lump/reserve", label: "予備の生活資金", level: "detail", kind: "int", suffix: "か月分", min: 0, max: 120, path: ["survivor", "reserveMonths"], help: "遺族の生活費の何か月分を、必要保障額に足すか（口座が使えない間の当座のお金を見込むとき）" }),
    ]),
    one(
      "cg/horizon",
      "必要保障額の出し方",
      [
        planField({ key: "cg/horizon/kind", label: "いつまでの資金を数えるか", level: "detail", kind: "select", options: HORIZON_KINDS, path: ["horizon", "kind"], fallback: "lifeExpectancy" }),
        ...(plan.horizon?.kind === "age" ? [planField({ key: "cg/horizon/age", label: "配偶者の年齢", level: "detail", kind: "int", suffix: "歳", min: 50, max: 110, path: ["horizon", "age"], fallback: 90 })] : []),
        planField({ key: "cg/horizon/method", label: "出し方", level: "detail", kind: "select", options: PROTECTION_METHODS, path: ["protection", "method"], fallback: "accumulation" }),
        ...(plan.protection?.method === "reverse"
          ? [planField({ key: "cg/horizon/reverseAge", label: "遺族が何歳になるまで資産が尽きないようにするか", level: "detail", kind: "int", suffix: "歳", min: 50, max: 110, path: ["protection", "reverseUntilAge"], help: "空欄なら遺族の平均余命まで（遺族が子なら末子の独立まで）", auto: "平均余命まで" })]
          : []),
      ],
      { level: "detail", note: "積み上げ方式は、遺族の支出から収入と一時の資金を引いた不足の累計。逆算方式は、遺族の資産が決めた年齢まで尽きないのに要る額" },
    ),
  ];
  if (couple) sections.push({ key: "cg/work", title: "残された配偶者の働き方", note: "死亡の想定で、残された配偶者の働き方を置き換えます（必要保障額の推移は今の働き方のまま）", level: "simple", groups: workGroups(wh), actions: [] });
  sections.push(
    one(
      "cg/disability",
      "就業不能・障害の想定",
      [
        planField({ key: "cg/disability/grade", label: "仮定の等級", level: "detail", kind: "select", options: GRADES, path: ["grade"], fallback: "2", numeric: true }),
        planField({ key: "cg/disability/medical", label: "医療費（1か月・10割）", level: "detail", kind: "yen", basis: "monthly", path: ["medical", "monthly"], help: "高額療養費で止めた自己負担を計算します", maxYen: 300 * MAN }),
        planField({ key: "cg/disability/months", label: "医療費の月数", level: "detail", kind: "int", suffix: "か月", min: 1, max: 600, path: ["medical", "months"], fallback: 12 }),
      ],
      { note: "等級は「該当した場合」の仮定です。ご家族の実際の状態としては記録しません（既定は2級。仮の値）" },
    ),
    // 0026: 大きな病気のとき・相場が下がったとき。0071: 復帰の後の働き方・収入が減る・下げる資産と戻り方・重ねる
    one(
      "cg/illness",
      "大きな病気のときの前提",
      [
        planField({ key: "cg/illness/months", label: "働けない期間", kind: "int", suffix: "か月", min: 1, max: 60, path: ["illness", "months"], fallback: ILLNESS_DEFAULT.months }),
        planField({ key: "cg/illness/medical", label: "医療費（1か月・10割）", level: "detail", kind: "yen", basis: "monthly", path: ["illness", "medicalMonthly"], fallback: ILLNESS_DEFAULT.medicalMonthly, maxYen: 300 * MAN }),
        planField({ key: "cg/illness/medicalMonths", label: "医療費の月数", level: "detail", kind: "int", suffix: "か月", min: 1, max: 60, path: ["illness", "medicalMonths"], fallback: ILLNESS_DEFAULT.medicalMonths }),
        // 0055: 保険の医療・がんの給付（入院日額・手術・がん一時金・三大疾病一時金）を受け取る見込みに使う
        planField({ key: "cg/illness/disease", label: "病気の種類", level: "detail", kind: "select", options: DISEASES, path: ["illness", "disease"], fallback: ILLNESS_DEFAULT.disease, help: "がん一時金はがん、三大疾病一時金はがん・心疾患・脳卒中のときに受け取ります" }),
        planField({
          key: "cg/illness/hospitalDays",
          label: "入院の日数（1回）",
          level: "detail",
          kind: "int",
          suffix: "日",
          min: 0,
          max: 365,
          path: ["illness", "hospitalDays"],
          fallback: HOSPITAL_DAYS_DEFAULT[plan.illness?.disease ?? ILLNESS_DEFAULT.disease],
          help: "空欄は病気の種類ごとの目安（患者調査の平均在院日数の水準。仮の値）",
        }),
        planField({ key: "cg/illness/surgeries", label: "手術の回数", level: "detail", kind: "int", suffix: "回", min: 0, max: 10, path: ["illness", "surgeries"], fallback: ILLNESS_DEFAULT.surgeries }),
        planField({ key: "cg/illness/afterMonths", label: "復帰の後に収入が減る期間", level: "detail", kind: "int", suffix: "か月", min: 0, max: 120, path: ["illness", "afterMonths"], help: "働きながら治療を続ける・時短で戻るとき。空欄なら元の働き方に戻ります" }),
        ...(plan.illness?.afterMonths !== undefined && plan.illness.afterMonths > 0
          ? [planField({ key: "cg/illness/afterRatio", label: "その間の収入（元の収入に対する割合）", level: "detail", kind: "pct", path: ["illness", "afterRatio"], fallback: "0.7" })]
          : []),
      ],
      { note: "働けない間は、会社員は休業して傷病手当金（健康保険）を受け、決めた月数の後に元の働き方に戻ります。医療費は保険診療の10割で入れ、自己負担は高額療養費（厚生労働省）で止めて計算します。目安の値は仮の値です（事務所で根拠を確かめて直してください）" },
    ),
    one(
      "cg/income",
      "収入が減るときの前提",
      [
        planField({ key: "cg/income/member", label: "誰の収入", kind: "select", options: couple ? INCOME_WHO : INCOME_WHO.slice(0, 1), path: ["incomeDrop", "member"], fallback: INCOME_DROP_DEFAULT.member }),
        planField({ key: "cg/income/ratio", label: "減る割合", kind: "pct", path: ["incomeDrop", "ratio"], fallback: INCOME_DROP_DEFAULT.ratio }),
        planField({ key: "cg/income/years", label: "何年", kind: "int", suffix: "年", min: 1, max: 30, path: ["incomeDrop", "years"], fallback: INCOME_DROP_DEFAULT.years }),
      ],
      { note: "起きる年から、給与・事業の所得を決めた割合だけ減らします（リストラの後の減収・子の入院で親が休む・上下する収入など、試しに見る悪い場合）。決まった休業は働き方と収入の項目の休業で入れます" },
    ),
  );
  if (hasInvested(h))
    sections.push(
      one(
        "cg/market",
        "相場が下がったときの前提",
        [
          planField({ key: "cg/market/drop", label: "下がる幅", kind: "select", options: DROPS, path: ["market", "drop"], fallback: MARKET_DROP_DEFAULT }),
          ...MARKET_CLASS_OPTIONS.map(marketClassField),
          planField({ key: "cg/market/recoveryYears", label: "下がった後に利回りを抑える年数", level: "detail", kind: "int", suffix: "年", min: 0, max: 20, path: ["market", "recoveryYears"], help: "空欄なら翌年からふだんの利回りに戻ります" }),
          ...(plan.market?.recoveryYears !== undefined && plan.market.recoveryYears > 0
            ? [planField({ key: "cg/market/recoveryCap", label: "その間の運用の利回り（上限）", level: "detail", kind: "pct", path: ["market", "recoveryCap"], fallback: "0" })]
            : []),
          planBool({ key: "cg/market/stack", label: "死亡・就業不能・病気・収入が減るの場面にも、同じ年の相場の下落を重ねる", level: "simple", path: ["stackMarket"], help: "全プラン共通の見方です（プランごとには変えません）" }),
        ],
        { note: "起きる年の年末に、運用する口座のうち選んだ資産の部分を下げます（配分を入れていない運用の口座は全体を下げます。預金・債券は選ばなければ下げません）。年ごとの帯は、どの年に下がっても最後まで足りるかを1年ずつ見せます" },
      ),
    );
  const cl = creditLifeGroups(wh);
  if (cl.length > 0) sections.push({ key: "cg/creditLife", title: "団信（住まい・ローンの段階と同じ欄）", note: "どちらで直しても同じ住宅ローンの値が変わります", level: "simple", groups: cl, actions: [] });
  return sections;
}

/** 障害年金の65歳からの組み合わせを選び直す欄（障害の想定の人ごと） */
export function oldAgeChoiceField(memberId: string): FieldDef {
  return planField({ key: `cg/choice/${memberId}`, label: "65歳からの障害年金と老齢年金の組み合わせ", level: "detail", kind: "select", options: OLD_AGE_CHOICES, path: ["oldAgeChoice", memberId], fallback: "" });
}

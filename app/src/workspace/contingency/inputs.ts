// 万一の想定の前提の欄と項目（万一の画面のグラフの下に出す。主画面の対策と同じ並べ方・同じ部品で描く: PremisePanel.tsx）。
// 選んでいる場面の項目（premiseItems。0085）を、事務所の既定値で最初から出す項目・足した項目・値を変えた項目だけ出す（premiseChoice.ts）。
// 値は世帯の要求ではなく、画面の側の前提（WorkingHousehold.contingency）を読み書きする。団信だけは住まい・ローンの段階と同じ欄（世帯の要求）
import type { OldAgeChoice, Timepoint } from "../../engine/types.ts";
import { field, getPath, resolveTimepoint, setPath, timeView, type FieldDef, type FieldState, type Level, type Option, type SectionDef, type Val } from "../input/form.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { ASSET_CLASSES, memberLabel } from "../input/labels.ts";
import { creditLifeGroups } from "../input/stages/housing.ts";
import type { ContingencyPlan, PartnerScene, SurvivorWork } from "./planData.ts";
import { PREMISE_KINDS, SCENE_KINDS, type PremiseKind } from "./premiseChoice.ts";
import { PREMISE_ITEMS } from "./premiseItems.ts";
import { adults, ESOP, HOSPITAL_DAYS_DEFAULT, FX_DEPOSIT, hasInvested, INCOME_DROP_DEFAULT, ILLNESS_DEFAULT, MARKET_CLASSES_DEFAULT, MARKET_DROP_DEFAULT, partnerOf, scenarios, type Scenario, type ScenarioKind } from "./requests.ts";

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

/** 働き方を変える時期を、時点（人の年齢・出来事から）で入れる欄（0071。空は「起きた月から○か月後」）。path は前提の中の場所 */
function workFromField(path: readonly string[], k: string, o: { label: string; nullText: string; help: string }): FieldDef {
  const read = (wh: WorkingHousehold) => (getPath(wh.contingency, path) as Timepoint | undefined) ?? null;
  const time = timeView({
    read,
    write: (wh, tp) => {
      const plan = structuredClone(wh.contingency) as unknown as Obj;
      setPath(plan, path, tp ?? undefined);
      return { ...wh, contingency: plan as unknown as ContingencyPlan };
    },
    optional: true,
    nullText: o.nullText,
    modes: ["age", "ym", "event"],
    mode: "age",
    ageOf: (h) => h.members.filter((m) => m.kind === "child").sort((a, b) => b.birth.birthYearMonth.localeCompare(a.birth.birthYearMonth))[0],
  });
  const def = field({
    key: `${k}/from`,
    item: PREMISE_ITEMS[path[0] ?? ""] ?? null,
    label: o.label,
    level: "detail",
    kind: "when",
    time,
    optional: true,
    help: o.help,
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


/** 前提の項目（0085）: 想定の前提の枠のまとまり。対策の項目と同じく、最初から出す・足す・外すの単位 */
export interface PremiseItem {
  kind: PremiseKind;
  /** 枠の名前（欄が1つの項目は、この名前を欄の名前にする） */
  label: string;
  /** 欄のまとまり（団信はローンごと。見出しはまとまりの名前） */
  parts: { title?: string; fields: FieldDef[] }[];
  /** 描き方: fields は欄ごとの枠、work は働き方と年収を1つの枠、checks はチェックの並びを1つの枠 */
  shape: "fields" | "work" | "checks";
  /** 当てはまらないときの説明（枠は出し、欄は動かせない。例: 働き方が「今の働き方を続ける」ときの年収） */
  inactive?: string;
  /** 枠の下の説明（省略は欄の説明） */
  note?: string;
}

/** 項目の欄（まとまりを並べた物） */
export const itemFields = (it: PremiseItem): FieldDef[] => it.parts.flatMap((p) => p.fields);

/** 場面ごとの前提の説明（想定の前提の見出しの下） */
export const SCENE_NOTES: Readonly<Record<ScenarioKind, string>> = {
  death: "遺族の生活費は、今の生活費（節目を当てた後）に掛ける割合です（標準の値。出典は確かめ前）。残された配偶者の働き方は死亡の想定で置き換え、必要保障額の推移は今の働き方のままです",
  disability: "等級は「該当した場合」の仮定です。ご家族の実際の状態としては記録しません（既定は2級。仮の値）。配偶者の働き方と年収は、働けなくなった月の6か月後から65歳まで置き換えます（時期は「＋ 動かす項目を追加」で直せます）",
  illness:
    "働けない間は、会社員は休業して傷病手当金（健康保険）を受け、決めた月数の後に元の働き方に戻ります。医療費は保険診療の10割で入れ、自己負担は高額療養費（厚生労働省）で止めて計算します。目安の値は仮の値です（事務所で根拠を確かめて直してください）",
  income:
    "起きる年から、給与・事業の所得を決めた割合だけ減らします（リストラの後の減収・子の入院で親が休む・上下する収入など、試しに見る悪い場合）。決まった休業は働き方と収入の項目の休業で入れます。配偶者の働き方と年収は、減り始めた月の6か月後から65歳まで置き換えます",
  market: "起きる年の年末に、運用する口座のうち選んだ資産の部分を下げます（配分を入れていない運用の口座は全体を下げます。預金・債券は選ばなければ下げません）。年ごとの帯は、どの年に下がっても最後まで足りるかを1年ずつ見せます",
};

const PAID = (t: string | undefined) => t !== undefined && t !== "keep" && t !== "none";

/**
 * 働き方を置き換える人の欄（死亡は残された配偶者の work、就業不能・収入が減るは配偶者の partnerWork。0071・0085）: 働き方・年収・変える時期（○か月後・時点）・何歳まで。
 * base は前提の中のその人の場所（["work", id] か ["partnerWork", scene, id]）
 */
function workFields(wh: WorkingHousehold, base: readonly string[], k: string, after: string) {
  const w = getPath(wh.contingency, base) as SurvivorWork | undefined;
  const type = planField({ key: `${k}/type`, label: "働き方", kind: "select", options: SURVIVOR_WORK_TYPES, path: [...base, "type"], fallback: "keep" });
  const salary = planField({
    key: `${k}/salary`,
    label: w?.type === "selfEmployed" ? "事業の所得（年額）" : "年収（賞与を除く）",
    kind: "yen",
    basis: "annual",
    path: [...base, "annualSalary"],
    help: "空欄なら働き方ごとの目安で計算します",
    maxYen: 1500 * MAN,
    auto: "働き方ごとの目安",
  });
  const when: FieldDef[] = [
    planField({ key: `${k}/after`, label: `変える時期（${after}）`, kind: "int", suffix: "か月後", min: 0, max: 120, path: [...base, "afterMonths"], fallback: 6 }),
    workFromField([...base, "from"], k, {
      label: "変える時期を時点で（下の子の年齢・出来事から）",
      nullText: `${after.replace(/てから$/, "た")}月から○か月後（上の欄）`,
      help: `${after.replace(/てから$/, "た")}月より前の時点は、その月にします。空欄なら、上の欄の月数の後`,
    }),
  ];
  if (w?.type !== "none") when.push(planField({ key: `${k}/until`, label: "何歳まで", kind: "int", suffix: "歳", min: 20, max: 80, path: [...base, "untilAge"], fallback: 65 }));
  return { w, type, salary, when };
}

/**
 * 選んでいる場面の想定の前提の項目（0085。一覧の並び）。その世帯・その場面に当てはまらない項目は出さない（配偶者がいない・子がいない・
 * 住宅ローンが無い・障害年金に当たらない等級など）。値は世帯の要求ではなく画面の側の前提（WorkingHousehold.contingency）を読み書きする（団信だけは住まい・ローンと同じ欄）
 */
export function premiseItems(wh: WorkingHousehold, sc: Scenario | undefined): PremiseItem[] {
  if (sc === undefined) return [];
  const plan = wh.contingency;
  const h = wh.request.input.household;
  const kids = h.members.some((m) => m.kind === "child");
  const couple = adults(h).some((a) => a.spouse !== undefined);
  const partner = sc.kind === "market" ? undefined : partnerOf(h, sc);
  const one = (kind: PremiseKind, f: FieldDef, o: Partial<PremiseItem> = {}): PremiseItem => ({ kind, label: o.label ?? f.label, parts: [{ fields: [f] }], shape: "fields", ...o });
  const many = (kind: PremiseKind, label: string, fields: FieldDef[], o: Partial<PremiseItem> = {}): PremiseItem => ({ kind, label, parts: [{ fields }], shape: "fields", ...o });
  const out: (PremiseItem | null)[] = [];
  const creditLife = (kind: PremiseKind): PremiseItem | null => {
    const groups = creditLifeGroups(wh);
    return groups.length === 0 ? null : { kind, label: "団信", parts: groups.map((g) => ({ ...(g.title !== undefined ? { title: g.title } : {}), fields: g.fields })), shape: "fields", note: "住まい・ローンの入力項目と同じ欄です（どちらで直しても同じ住宅ローンの値が変わります）" };
  };
  /** 就業不能・収入が減るの配偶者の働き方と年収（1つの枠）と、変える時期と何歳まで */
  const partnerItems = (scene: PartnerScene, after: string) => {
    if (partner === undefined) return [null, null] as const;
    const pl = memberLabel(wh, partner.id);
    const f = workFields(wh, ["partnerWork", scene, partner.id], `cg/partner/${scene}/${partner.id}`, after);
    const work: PremiseItem = { kind: `${scene}:partner`, label: `${pl}の働き方と年収`, parts: [{ fields: [f.type, f.salary] }], shape: "work" };
    const when = PAID(f.w?.type) || f.w?.type === "none" ? many(`${scene}:partnerWhen`, `${pl}の働き方を変える時期と何歳まで`, f.when) : null;
    return [work, when] as const;
  };

  if (sc.kind === "death") {
    // 並びは最後に一覧の並びにそろえる
    const living = kids
      ? planField({ key: "cg/living/before", label: "遺族の生活費の割合（子がいる間）", kind: "pct", path: ["survivor", "livingRatio", "beforeIndependence"], fallback: "0.7" })
      : planField({ key: "cg/living/noKids", label: "遺族の生活費の割合（子がいない世帯）", kind: "pct", path: ["survivor", "livingRatio", "noChildren"], fallback: "0.7" });
    out.push(one("death:living", living));
    if (partner !== undefined) {
      const pl = memberLabel(wh, partner.id);
      const f = workFields(wh, ["work", partner.id], `cg/work/${partner.id}`, "亡くなってから");
      out.push(
        one("death:work", f.type, { label: `残された${pl}の働き方` }),
        one("death:salary", f.salary, {
          label: `残された${pl}の${f.w?.type === "selfEmployed" ? "事業の所得（年額）" : "年収（賞与を除く）"}`,
          ...(PAID(f.w?.type) ? {} : { inactive: f.w?.type === "none" ? "働かないので0円です" : "今の働き方のままです（働き方を選ぶと入れられます）" }),
        }),
        PAID(f.w?.type) || f.w?.type === "none" ? many("death:workWhen", `残された${pl}の働き方を変える時期と何歳まで`, f.when) : null,
      );
    }
    out.push(one("death:funeral", planField({ key: "cg/lump/funeral", label: "整理資金（葬儀・お墓など）", kind: "yen", path: ["survivor", "funeral"], help: "亡くなった月の翌月の支出にします", maxYen: 1000 * MAN })));
    if (kids) out.push(one("death:livingAfter", planField({ key: "cg/living/after", label: "遺族の生活費の割合（末子の独立の後）", kind: "pct", path: ["survivor", "livingRatio", "afterIndependence"], fallback: "0.5" })));
    pushDeathRest(out, kids, one);
    out.push(creditLife("death:creditLife"));
  } else if (sc.kind === "disability") {
    out.push(one("disability:grade", planField({ key: "cg/disability/grade", label: "仮定の等級", kind: "select", options: GRADES, path: ["grade"], fallback: "2", numeric: true })));
    out.push(one("disability:medical", planField({ key: "cg/disability/medical", label: "医療費（1か月・10割）", kind: "yen", basis: "monthly", path: ["medical", "monthly"], help: "高額療養費で止めた自己負担を計算します", maxYen: 300 * MAN })));
    out.push(one("disability:medicalMonths", planField({ key: "cg/disability/months", label: "医療費の月数", kind: "int", suffix: "か月", min: 1, max: 600, path: ["medical", "months"], fallback: 12 })));
    const [work, when] = partnerItems("disability", "働けなくなってから");
    out.push(work);
    if ((plan.grade ?? 2) !== 0) out.push(one("disability:oldAgeChoice", oldAgeChoiceField(sc.member), { note: "自動で手取りが多い組み合わせを選びます。選び直すとその組み合わせで計算します" }));
    out.push(when, creditLife("disability:creditLife"));
  } else if (sc.kind === "illness") {
    out.push(
      one("illness:months", planField({ key: "cg/illness/months", label: "働けない期間", kind: "int", suffix: "か月", min: 1, max: 60, path: ["illness", "months"], fallback: ILLNESS_DEFAULT.months })),
      // 0055: 保険の医療・がんの給付（入院日額・手術・がん一時金・三大疾病一時金）を受け取る見込みに使う
      one("illness:disease", planField({ key: "cg/illness/disease", label: "病気の種類", kind: "select", options: DISEASES, path: ["illness", "disease"], fallback: ILLNESS_DEFAULT.disease, help: "がん一時金はがん、三大疾病一時金はがん・心疾患・脳卒中のときに受け取ります" })),
      one(
        "illness:hospitalDays",
        planField({
          key: "cg/illness/hospitalDays",
          label: "入院の日数（1回）",
          kind: "int",
          suffix: "日",
          min: 0,
          max: 365,
          path: ["illness", "hospitalDays"],
          fallback: HOSPITAL_DAYS_DEFAULT[plan.illness?.disease ?? ILLNESS_DEFAULT.disease],
          help: "空欄は病気の種類ごとの目安（患者調査の平均在院日数の水準。仮の値）",
        }),
      ),
      one("illness:medical", planField({ key: "cg/illness/medical", label: "医療費（1か月・10割）", kind: "yen", basis: "monthly", path: ["illness", "medicalMonthly"], fallback: ILLNESS_DEFAULT.medicalMonthly, maxYen: 300 * MAN })),
      one("illness:surgeries", planField({ key: "cg/illness/surgeries", label: "手術の回数", kind: "int", suffix: "回", min: 0, max: 10, path: ["illness", "surgeries"], fallback: ILLNESS_DEFAULT.surgeries })),
      one("illness:medicalMonths", planField({ key: "cg/illness/medicalMonths", label: "医療費の月数", kind: "int", suffix: "か月", min: 1, max: 60, path: ["illness", "medicalMonths"], fallback: ILLNESS_DEFAULT.medicalMonths })),
      many("illness:after", "復帰の後の収入", [
        planField({ key: "cg/illness/afterMonths", label: "復帰の後に収入が減る期間", kind: "int", suffix: "か月", min: 0, max: 120, path: ["illness", "afterMonths"], help: "働きながら治療を続ける・時短で戻るとき。空欄なら元の働き方に戻ります" }),
        ...(plan.illness?.afterMonths !== undefined && plan.illness.afterMonths > 0 ? [planField({ key: "cg/illness/afterRatio", label: "その間の収入（元の収入に対する割合）", kind: "pct", path: ["illness", "afterRatio"], fallback: "0.7" })] : []),
      ]),
    );
  } else if (sc.kind === "income") {
    out.push(
      one("income:member", planField({ key: "cg/income/member", label: "誰の収入", kind: "select", options: couple ? INCOME_WHO : INCOME_WHO.slice(0, 1), path: ["incomeDrop", "member"], fallback: INCOME_DROP_DEFAULT.member })),
      one("income:ratio", planField({ key: "cg/income/ratio", label: "減る割合", kind: "pct", path: ["incomeDrop", "ratio"], fallback: INCOME_DROP_DEFAULT.ratio })),
      one("income:years", planField({ key: "cg/income/years", label: "何年", kind: "int", suffix: "年", min: 1, max: 30, path: ["incomeDrop", "years"], fallback: INCOME_DROP_DEFAULT.years })),
    );
    const [work, when] = partnerItems("income", "減り始めてから");
    out.push(work, when);
  } else if (sc.kind === "market") {
    out.push(
      one("market:drop", planField({ key: "cg/market/drop", label: "下がる幅", kind: "select", options: DROPS, path: ["market", "drop"], fallback: MARKET_DROP_DEFAULT })),
      { kind: "market:classes", label: "下げる資産", parts: [{ fields: MARKET_CLASS_OPTIONS.map(marketClassField) }], shape: "checks", note: "既定は株・REIT と、配分を入れていない持株会です" },
      one("market:recoveryYears", planField({ key: "cg/market/recoveryYears", label: "下がった後に利回りを抑える年数", kind: "int", suffix: "年", min: 0, max: 20, path: ["market", "recoveryYears"], help: "空欄なら翌年からふだんの利回りに戻ります" })),
      one(
        "market:recoveryCap",
        planField({ key: "cg/market/recoveryCap", label: "その間の運用の利回り（上限）", kind: "pct", path: ["market", "recoveryCap"], fallback: "0", help: "利回りを抑える年数を入れたときに使います" }),
        plan.market?.recoveryYears !== undefined && plan.market.recoveryYears > 0 ? {} : { note: "利回りを抑える年数を入れると使います" },
      ),
    );
  }
  // 相場の下落を重ねる（全プラン共通の見方。死亡・就業不能・病気・収入が減るの場面に効く）
  if (hasInvested(h))
    out.push(
      one("market:stack", planBool({ key: "cg/market/stack", label: "同じ年の相場の下落を重ねる", level: "simple", path: ["stackMarket"], help: "死亡・就業不能・病気・収入が減るの場面に、相場の下落の場面の前提（下がる幅・下げる資産）で同じ年の下落を重ねます。全プラン共通の見方です（プランごとには変えません）" }), {
        label: "同じ年の相場の下落を重ねる",
      }),
    );
  const order = new Map<string, number>(PREMISE_KINDS.map((k, i) => [k.kind, i]));
  return out.filter((x): x is PremiseItem => x !== null).sort((a, b) => (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0));
}

/** 死亡の場面の、遺族の生活費・整理資金のほかの項目（子の独立とみなす年齢・死亡退職金・弔慰金・業務上の死亡・予備の生活資金） */
function pushDeathRest(out: (PremiseItem | null)[], kids: boolean, one: (kind: PremiseKind, f: FieldDef, o?: Partial<PremiseItem>) => PremiseItem): void {
  if (kids)
    out.push(
      one(
        "death:independence",
        planField({
          key: "cg/living/independence",
          label: "子の独立とみなす年齢",
          kind: "int",
          suffix: "歳",
          min: 15,
          max: 30,
          path: ["survivor", "independenceAge"],
          fallback: 22,
          help: "子の独立の時点を入れていない子に使います（入れている子はその時点）。その年齢の後の最初の3月末の翌月を独立とみなします",
        }),
      ),
    );
  out.push(
    one("death:allowance", planField({ key: "cg/lump/allowance", label: "死亡退職金", kind: "yen", path: ["survivor", "deathBenefits", "retirementAllowance"], help: "空欄なら、退職金の見込みを勤続の月数で按分します（退職給付×亡くなる月までの勤続の月数÷退職までの勤続の月数）", maxYen: 5000 * MAN, auto: "自動（勤続の月数で按分）" })),
    one("death:condolence", planField({ key: "cg/lump/condolence", label: "弔慰金", kind: "yen", path: ["survivor", "deathBenefits", "condolence"], maxYen: 1000 * MAN })),
    one("death:workRelated", planBool({ key: "cg/lump/workRelated", label: "業務上の死亡として見る", path: ["survivor", "deathBenefits", "workRelated"], help: "死亡退職金・弔慰金の非課税の扱いが変わります（労災の給付は計算に入れません）" })),
    one("death:reserve", planField({ key: "cg/lump/reserve", label: "予備の生活資金", kind: "int", suffix: "か月分", min: 0, max: 120, path: ["survivor", "reserveMonths"], help: "遺族の生活費の何か月分を、必要保障額に足すか（口座が使えない間の当座のお金を見込むとき）" })),
  );
}

/** 項目の値が既定と違うか（共通の前提か見ているプランで値を入れた。最初から出さない項目でも出す。団信の欄は入力の値なので数えない） */
export function itemValued(it: PremiseItem, wh: WorkingHousehold): boolean {
  return itemFields(it).some((f) => {
    const meta = premiseMeta(f);
    if (meta === undefined) return false;
    const st = f.get(wh);
    const v = st.value;
    if (st.implicit === true || v === null || v === "") return false;
    return !(meta.fallback !== undefined && String(v) === String(meta.fallback));
  });
}

/** 項目の値を既定に戻した世帯（外すとき。団信の欄は入力の値なので戻さない） */
export function resetItem(it: PremiseItem, wh: WorkingHousehold): WorkingHousehold {
  let w = wh;
  for (const f of itemFields(it)) if (premiseMeta(f) !== undefined && itemValued({ ...it, parts: [{ fields: [f] }] }, w)) w = f.set(w, f.kind === "bool" ? (premiseMeta(f)?.fallback ?? false) : null);
  return w;
}

/**
 * 前提の欄の区画（場面の種類ごと。その世帯の全部の場面の、全部の項目の欄）。画面は premiseItems で選んでいる場面の項目だけを出す。
 * ここは欄の往復の確かめなど、全部の欄を見る所が使う
 */
export function contingencyInputSections(wh: WorkingHousehold): SectionDef[] {
  const out: SectionDef[] = [];
  for (const s of SCENE_KINDS) {
    const seen = new Set<string>();
    const fields: FieldDef[] = [];
    for (const sc of scenarios(wh).filter((x) => x.kind === s.kind))
      for (const it of premiseItems(wh, sc))
        for (const f of itemFields(it))
          if (!seen.has(f.key)) {
            seen.add(f.key);
            fields.push(f);
          }
    if (fields.length > 0) out.push({ key: `cg/${s.kind}`, title: s.label, level: "simple", groups: [{ key: `cg/${s.kind}/fields`, level: "simple", fields, actions: [] }], actions: [] });
  }
  return out;
}

/** 障害年金の65歳からの組み合わせを選び直す欄（障害の想定の人ごと） */
export function oldAgeChoiceField(memberId: string): FieldDef {
  return planField({ key: `cg/choice/${memberId}`, label: "65歳からの障害年金と老齢年金の組み合わせ", level: "detail", kind: "select", options: OLD_AGE_CHOICES, path: ["oldAgeChoice", memberId], fallback: "" });
}

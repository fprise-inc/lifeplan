// 万一のタブの想定の前提に最初から出す項目と、場面の帯の並べ方（事務所の既定値。0085）。対策に最初から出す項目（plans/leverChoice.ts。0084）と同じ作り:
// - 想定の前提は、選んでいる場面の項目だけを出す。最初から出す項目（場面ごとに既定の4つ）と、「＋ 動かす項目を追加」で足した項目と、
//   値を変えた項目（共通の前提かそのプランで既定と違う値）。最初から出す項目は外せない。足した・値を変えた項目は外せる（値は既定に戻す）
// - 事務所データ（office/settings.ts の premises）には、既定の組み合わせとの違いだけを持つ。既定は DEFAULT_PREMISE_KINDS の1か所
// - 場面の帯に並べる場面（種類ごと）と、開いたときに選んでおく場面も事務所の既定値（scenes）。世帯ごとには持たない
// - 見せ方だけ: 値も計算も変えない。世帯には写さない（変えるとどの世帯にもすぐ効く）
import type { ScenarioKind } from "./requests.ts";

/** 場面の種類（場面の帯の並び） */
export const SCENE_KINDS = [
  { kind: "death", label: "死亡" },
  { kind: "disability", label: "就業不能・障害" },
  { kind: "illness", label: "大きな病気" },
  { kind: "income", label: "収入が減る" },
  { kind: "market", label: "相場の下落" },
] as const satisfies readonly { kind: ScenarioKind; label: string }[];

/** 想定の前提の項目の種類（一覧の並び＝前提の並び）。scene はその項目を出す場面（stack はどの場面にも出す） */
export const PREMISE_KINDS = [
  { kind: "death:living", scene: "death", label: "遺族の生活費の割合", note: "子がいる世帯は子がいる間、いない世帯は子がいない世帯の割合" },
  { kind: "death:work", scene: "death", label: "残された配偶者の働き方", note: "配偶者がいる世帯だけ" },
  { kind: "death:salary", scene: "death", label: "残された配偶者の年収", note: "配偶者がいる世帯だけ" },
  { kind: "death:funeral", scene: "death", label: "整理資金（葬儀・お墓など）" },
  { kind: "death:livingAfter", scene: "death", label: "遺族の生活費の割合（末子の独立の後）", note: "子がいる世帯だけ" },
  { kind: "death:independence", scene: "death", label: "子の独立とみなす年齢", note: "子がいる世帯だけ" },
  { kind: "death:allowance", scene: "death", label: "死亡退職金" },
  { kind: "death:condolence", scene: "death", label: "弔慰金" },
  { kind: "death:workRelated", scene: "death", label: "業務上の死亡として見る" },
  { kind: "death:reserve", scene: "death", label: "予備の生活資金" },
  { kind: "death:workWhen", scene: "death", label: "残された配偶者の働き方を変える時期と何歳まで", note: "配偶者がいる世帯だけ" },
  { kind: "death:creditLife", scene: "death", label: "団信（住まい・ローンと同じ欄）", note: "住宅ローンがある世帯だけ" },
  { kind: "disability:grade", scene: "disability", label: "仮定の等級" },
  { kind: "disability:medical", scene: "disability", label: "医療費（1か月）" },
  { kind: "disability:medicalMonths", scene: "disability", label: "医療費の月数" },
  { kind: "disability:partner", scene: "disability", label: "配偶者の働き方と年収", note: "配偶者がいる世帯だけ" },
  { kind: "disability:oldAgeChoice", scene: "disability", label: "65歳からの年金の組み合わせ", note: "障害年金に当たる等級のときだけ" },
  { kind: "disability:partnerWhen", scene: "disability", label: "配偶者の働き方を変える時期と何歳まで", note: "配偶者がいる世帯だけ" },
  { kind: "disability:creditLife", scene: "disability", label: "団信（住まい・ローンと同じ欄）", note: "住宅ローンがある世帯だけ" },
  { kind: "illness:months", scene: "illness", label: "働けない期間" },
  { kind: "illness:disease", scene: "illness", label: "病気の種類" },
  { kind: "illness:hospitalDays", scene: "illness", label: "入院の日数" },
  { kind: "illness:medical", scene: "illness", label: "医療費（1か月）" },
  { kind: "illness:surgeries", scene: "illness", label: "手術の回数" },
  { kind: "illness:medicalMonths", scene: "illness", label: "医療費の月数" },
  { kind: "illness:after", scene: "illness", label: "復帰の後の収入（期間と割合）" },
  { kind: "income:member", scene: "income", label: "誰の収入" },
  { kind: "income:ratio", scene: "income", label: "減る割合" },
  { kind: "income:years", scene: "income", label: "何年" },
  { kind: "income:partner", scene: "income", label: "配偶者の働き方と年収", note: "配偶者がいる世帯だけ" },
  { kind: "income:partnerWhen", scene: "income", label: "配偶者の働き方を変える時期と何歳まで", note: "配偶者がいる世帯だけ" },
  { kind: "market:drop", scene: "market", label: "下がる幅" },
  { kind: "market:classes", scene: "market", label: "下げる資産" },
  { kind: "market:recoveryYears", scene: "market", label: "利回りを抑える年数" },
  { kind: "market:recoveryCap", scene: "market", label: "その間の利回り" },
  { kind: "market:stack", scene: "market", label: "同じ年に相場の下落を重ねる", note: "死亡・就業不能・病気・収入が減るの場面に出ます" },
] as const satisfies readonly { kind: string; scene: ScenarioKind; label: string; note?: string }[];

export type PremiseKind = (typeof PREMISE_KINDS)[number]["kind"];

/**
 * 既定の組み合わせ（事務所が何も選んでいないとき）。**差し替えるのはここだけ**。場面ごとに4つ:
 * 死亡は遺族の生活費の割合・残された配偶者の働き方と年収・整理資金、就業不能は等級・医療費と月数・配偶者の働き方と年収、
 * 大きな病気は働けない期間・病気の種類・入院の日数・医療費、収入が減るは誰の収入・減る割合・何年・配偶者の働き方と年収、
 * 相場の下落は下がる幅・下げる資産・利回りを抑える年数・その間の利回り
 */
export const DEFAULT_PREMISE_KINDS: readonly PremiseKind[] = [
  "death:living",
  "death:work",
  "death:salary",
  "death:funeral",
  "disability:grade",
  "disability:medical",
  "disability:medicalMonths",
  "disability:partner",
  "illness:months",
  "illness:disease",
  "illness:hospitalDays",
  "illness:medical",
  "income:member",
  "income:ratio",
  "income:years",
  "income:partner",
  "market:drop",
  "market:classes",
  "market:recoveryYears",
  "market:recoveryCap",
];

export interface PremiseChoice {
  /** 既定に無いが、最初から出す種類（一覧の並び） */
  shown?: PremiseKind[];
  /** 既定にあるが、最初から出さない種類（一覧の並び） */
  hidden?: PremiseKind[];
}

const KNOWN = new Set<string>(PREMISE_KINDS.map((k) => k.kind));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const inOrder = (xs: Iterable<string>): PremiseKind[] => {
  const set = new Set(xs);
  return PREMISE_KINDS.map((k) => k.kind).filter((k) => set.has(k));
};

/** 読んだ値から選び方（形の合わない所・知らない種類は捨てる。両方にある種類は「出さない」） */
export function readPremiseChoice(v: unknown): PremiseChoice {
  if (!isObj(v)) return {};
  const pick = (x: unknown): PremiseKind[] => (Array.isArray(x) ? inOrder(x.filter((y): y is string => typeof y === "string" && KNOWN.has(y))) : []);
  const hidden = pick(v.hidden);
  const shown = pick(v.shown).filter((k) => !hidden.includes(k));
  return { ...(shown.length > 0 ? { shown } : {}), ...(hidden.length > 0 ? { hidden } : {}) };
}

export const isEmptyPremiseChoice = (c: PremiseChoice | undefined | null): boolean => c === undefined || c === null || ((c.shown ?? []).length === 0 && (c.hidden ?? []).length === 0);

/** その種類を最初から出すか */
export function premiseStarts(c: PremiseChoice | undefined, kind: PremiseKind, defaults: readonly PremiseKind[] = DEFAULT_PREMISE_KINDS): boolean {
  if ((c?.hidden ?? []).includes(kind)) return false;
  return defaults.includes(kind) || (c?.shown ?? []).includes(kind);
}

/** 最初から出す種類（一覧の並び） */
export const premiseStartKinds = (c: PremiseChoice | undefined, defaults: readonly PremiseKind[] = DEFAULT_PREMISE_KINDS): Set<PremiseKind> => new Set(PREMISE_KINDS.map((k) => k.kind).filter((k) => premiseStarts(c, k, defaults)));

/** 最初から出す・出さないを決める（既定と同じになる分は持たない） */
export function withPremiseStart(c: PremiseChoice | undefined, kind: PremiseKind, on: boolean, defaults: readonly PremiseKind[] = DEFAULT_PREMISE_KINDS): PremiseChoice {
  const shown = new Set<string>(c?.shown ?? []);
  const hidden = new Set<string>(c?.hidden ?? []);
  shown.delete(kind);
  hidden.delete(kind);
  if (on && !defaults.includes(kind)) shown.add(kind);
  if (!on && defaults.includes(kind)) hidden.add(kind);
  return readPremiseChoice({ shown: [...shown], hidden: [...hidden] });
}

/** 出す項目（kinds はその世帯・その場面で出せる項目の種類の一覧の並び）: 最初から出す項目 → 足した項目（足した順） → 値を変えた項目（一覧の並び） */
export function premiseView(kinds: readonly PremiseKind[], start: ReadonlySet<PremiseKind>, added: readonly string[], valued: (k: PremiseKind) => boolean): { shown: PremiseKind[]; fixed: Set<PremiseKind> } {
  const here = new Set(kinds);
  const fixed = new Set(kinds.filter((k) => start.has(k)));
  const out: PremiseKind[] = kinds.filter((k) => fixed.has(k));
  for (const a of added) if (here.has(a as PremiseKind) && !out.includes(a as PremiseKind)) out.push(a as PremiseKind);
  for (const k of kinds) if (!out.includes(k) && valued(k)) out.push(k);
  return { shown: out, fixed };
}

// ---- 場面の帯 ----

/** 開いたときに選んでおける場面（場面の帯の鍵。requests.ts の scenarios の key） */
export const OPEN_SCENES = [
  { key: "death:self", label: "本人の死亡" },
  { key: "death:spouse", label: "配偶者の死亡" },
  { key: "disability:self", label: "本人の就業不能・障害" },
  { key: "disability:spouse", label: "配偶者の就業不能・障害" },
  { key: "illness:self", label: "本人の大きな病気" },
  { key: "illness:spouse", label: "配偶者の大きな病気" },
  { key: "income", label: "収入が減る" },
  { key: "market", label: "相場の下落" },
] as const;

export type OpenScene = (typeof OPEN_SCENES)[number]["key"];

/** 場面の帯の並べ方（事務所の既定値）。既定は全部の種類を並べ、開いたときは本人の死亡 */
export interface SceneChoice {
  /** 並べない種類 */
  hidden?: ScenarioKind[];
  /** 開いたときに選んでおく場面（省略は本人の死亡） */
  open?: OpenScene;
}

export const DEFAULT_OPEN_SCENE: OpenScene = "death:self";

export function readSceneChoice(v: unknown): SceneChoice {
  if (!isObj(v)) return {};
  const kinds = SCENE_KINDS.map((k) => k.kind as ScenarioKind);
  const hidden = Array.isArray(v.hidden) ? kinds.filter((k) => (v.hidden as unknown[]).includes(k)) : [];
  // 全部の種類を並べないことはできない（何も並べない値は読まない）
  const keep = hidden.length < kinds.length ? hidden : [];
  const open = OPEN_SCENES.find((s) => s.key === v.open && s.key !== DEFAULT_OPEN_SCENE)?.key;
  return { ...(keep.length > 0 ? { hidden: keep } : {}), ...(open !== undefined ? { open } : {}) };
}

export const isEmptySceneChoice = (c: SceneChoice | undefined | null): boolean => c === undefined || c === null || ((c.hidden ?? []).length === 0 && c.open === undefined);

/** 場面の帯に並べる種類か */
export const sceneShown = (c: SceneChoice | undefined, kind: ScenarioKind): boolean => !(c?.hidden ?? []).includes(kind);

/** 並べる場面と選んでいる場面: want（その世帯で最後に見た場面・URL の場面）を優先し、無ければ事務所の開いたときの場面、並べない種類なら並べるものの最初 */
export function pickScene<T extends { key: string; kind: ScenarioKind }>(all: readonly T[], c: SceneChoice | undefined, want: string | undefined): { list: T[]; selected: T | undefined } {
  const list = all.filter((s) => sceneShown(c, s.kind));
  const shown = list.length > 0 ? list : [...all];
  const hit = (k: string | undefined) => (k === undefined ? undefined : shown.find((s) => s.key === k));
  return { list: shown, selected: hit(want) ?? hit(c?.open ?? DEFAULT_OPEN_SCENE) ?? shown[0] };
}

// ---- 必要保障額の数え方（事務所の既定値。0085。前は想定の前提の欄） ----

/** 必要保障額の数え方: いつまでの資金を数えるか（配偶者の年齢を含む）と出し方（逆算で資産が尽きないようにする遺族の年齢を含む）。省いた所は標準 */
export interface ProtectionSetting {
  horizon?: { kind: "lifeExpectancy" | "age" | "youngestIndependence"; age?: number };
  protection?: { method?: "accumulation" | "reverse"; reverseUntilAge?: number };
}

const HORIZON_KIND = ["lifeExpectancy", "age", "youngestIndependence"] as const;
const ageOk = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 50 && v <= 110;

/** 標準（配偶者の平均余命まで・積み上げ方式）と同じ所を省いた形（年齢は使う方式のときだけ持つ） */
export function normalProtection(s: ProtectionSetting): ProtectionSetting {
  const out: ProtectionSetting = {};
  const kind = s.horizon?.kind;
  if (kind === "age") out.horizon = { kind, age: ageOk(s.horizon?.age) ? s.horizon.age : 90 };
  else if (kind === "youngestIndependence") out.horizon = { kind };
  if (s.protection?.method === "reverse") out.protection = { method: "reverse", ...(ageOk(s.protection.reverseUntilAge) ? { reverseUntilAge: s.protection.reverseUntilAge } : {}) };
  return out;
}

/** 読んだ値から数え方（読めない所は標準） */
export function readProtectionSetting(v: unknown): ProtectionSetting {
  if (!isObj(v)) return {};
  const h = isObj(v.horizon) && HORIZON_KIND.includes(v.horizon.kind as (typeof HORIZON_KIND)[number]) ? { kind: v.horizon.kind as (typeof HORIZON_KIND)[number], ...(ageOk(v.horizon.age) ? { age: v.horizon.age } : {}) } : undefined;
  const p = isObj(v.protection) && v.protection.method === "reverse" ? { method: "reverse" as const, ...(ageOk(v.protection.reverseUntilAge) ? { reverseUntilAge: v.protection.reverseUntilAge } : {}) } : undefined;
  return normalProtection({ ...(h !== undefined ? { horizon: h } : {}), ...(p !== undefined ? { protection: p } : {}) });
}

export const sameProtection = (a: ProtectionSetting, b: ProtectionSetting): boolean => JSON.stringify(normalProtection(a)) === JSON.stringify(normalProtection(b));

/** 世帯の万一の前提の数え方 */
export const protectionOf = (plan: { horizon?: ProtectionSetting["horizon"]; protection?: ProtectionSetting["protection"] }): ProtectionSetting => normalProtection({ ...(plan.horizon !== undefined ? { horizon: plan.horizon } : {}), ...(plan.protection !== undefined ? { protection: plan.protection } : {}) });

/** 前提に数え方を書いた写し（標準と同じ所は省く。ほかの前提はそのまま） */
export function withProtection<T extends { horizon?: ProtectionSetting["horizon"]; protection?: ProtectionSetting["protection"] }>(plan: T, s: ProtectionSetting): T {
  const n = normalProtection(s);
  const { horizon: _h, protection: _p, ...rest } = plan;
  void _h;
  void _p;
  return { ...rest, ...(n.horizon !== undefined ? { horizon: n.horizon } : {}), ...(n.protection !== undefined ? { protection: n.protection } : {}) } as T;
}

/** 数え方の言い方（例: 「配偶者の平均余命まで・積み上げ方式」「配偶者が90歳になるまで・逆算方式（遺族が平均余命まで）」） */
export function protectionText(s: ProtectionSetting): string {
  const n = normalProtection(s);
  const until = n.horizon?.kind === "age" ? `配偶者が${n.horizon.age ?? 90}歳になるまで` : n.horizon?.kind === "youngestIndependence" ? "末子の独立まで" : "配偶者の平均余命まで";
  const how = n.protection?.method === "reverse" ? `逆算方式（遺族が${n.protection.reverseUntilAge !== undefined ? `${n.protection.reverseUntilAge}歳` : "平均余命"}まで）` : "積み上げ方式";
  return `${until}・${how}`;
}

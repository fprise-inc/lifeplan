// 表示の設定（タブごとに独立。事務所の設定として持てる形）: 結果のタブの表示の設定（DisplaySettings）と、資産と負債のタブの表示の設定（BalanceSettings）。
// 万一のときのタブには表示の設定が無い（グラフを小窓で出すボタンはグラフの見出しにある）。
// 結果のタブ: 主画面に出す数字を FP が選ぶ。既定では何も足さない（「○歳時点の資産」も出さない。2026-10-17）。
// 選んだ数字は、案の帯のカード・結論の2行目・グラフ（○歳時点の印）に出す。
// グラフの比較の仕方（基準の案と選んだ案を1つのグラフに重ねるか、左右に2つ並べるか、帯の全部の案を色分けで重ねるか）もここで選ぶ。既定は重ねる。
// 資産と負債のタブ: 家計の体力の目安を表示するか（health。既定は表示する）と目安の幅、時点を並べるときの既定の時点（と、この世帯で見出しから選んだ時点）、
// お金の3つの分け方（0032）。
// どちらも世帯ファイルの本文の display に、タブごとの区画（display.result・display.balance）で書く（形式の版 0.8 から。store/body.ts）
// 事務所の既定値（0213 の段C。OFFICE_DISPLAY_IDS の11件）: 事務所データの defaults.display に、世帯と同じ形で標準と違う欄だけを持つ。
// 世帯ファイルでは、事務所の既定値に従う設定の id を display.followOffice に並べる（印。形式の版 0.80 から）。印のある設定は事務所の既定値を読み
// （resolveDisplay）、その世帯で値を変えると印を外してその世帯の値を持つ（withOwnChange）。印の無い前の版の世帯は、どの設定も「この世帯だけ」と読む
// （今の値のまま。事務所の既定値を変えても変わらない）。この世帯で並べる時点（balance.columns）と対策に足した項目は世帯だけ（事務所の既定にしない）
import { man, manDiff } from "../presentation/format.ts";
import type { ChartLayout } from "../presentation/MainChart.tsx";
import type { AgeMark, VerdictPart } from "../presentation/model.ts";
import type { EngineRequest } from "../engine/types.ts";
import type { BsColumn, BsGuide, BsPointKey, MoneyThreeSettings } from "../presentation/model.ts";
import { DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS, readBsColumns, readBsGuide, readBsPoints } from "./balanceTab.ts";
import { DEFAULT_MONEY_THREE, readMoneyThree } from "./moneyThree.ts";
import type { PlanMetrics } from "./plans/compare.ts";
import { atAgeIn, targetYearOf } from "./present.ts";

export type MetricKey = "assetsAtAge" | "takeHome" | "minAssets" | "feeLine";

/** 結果のタブの表示の設定 */
export interface DisplaySettings {
  /** 出す数字（並びは選択肢の順） */
  metrics: MetricKey[];
  /** 「○歳時点の金融資産」の年齢（本人） */
  atAge: number;
  /** グラフの比較の仕方: 重ねる（既定）／左右に並べる／全部の案を色分けで重ねる */
  layout: ChartLayout;
  /** 資産の推移に口座の内訳を積み上げて出す（0026。既定は出さない） */
  invBreakdown: boolean;
  /** 資産の推移の上に運用の期間の帯を出す（0026。null は「取り崩しの予定があるときだけ」） */
  invPeriods: boolean | null;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = { metrics: [], atAge: 95, layout: "overlay", invBreakdown: false, invPeriods: null };

/** 資産と負債のタブの表示の設定（0027） */
export interface BalanceSettings {
  /**
   * 家計の体力の目安（1年ずつ見るときの図の下の区画）を表示するか（既定は true。false のときは区画も「目安の幅を変える」も出さない。
   * 目安の幅 guide は覚えたまま。0027 の 2026-11-13 の追記。形式の版 0.77 から）
   */
  health: boolean;
  /** 家計の体力の目安の幅（最初の値は 6〜12か月分・10〜40%・50%未満） */
  guide: BsGuide;
  /** 時点を並べるときの既定の時点（2〜4つ。最初の値は 今・退職の年・75歳） */
  points: BsPointKey[];
  /** この世帯で見出しから選んだ並べる時点（2〜4つ。候補の鍵か決まった年）。null は既定のまま */
  columns: BsColumn[] | null;
  /** お金の3つの分け方（何か月分・何年先まで・呼び方。0032。形式の版 0.13 から） */
  moneyThree: MoneyThreeSettings;
}

export const DEFAULT_BALANCE_SETTINGS: BalanceSettings = { health: true, guide: DEFAULT_BS_GUIDE, points: DEFAULT_BS_POINTS, columns: null, moneyThree: DEFAULT_MONEY_THREE };

export const LAYOUT_CHOICES: readonly { key: ChartLayout; label: string; note: string }[] = [
  { key: "overlay", label: "重ねる", note: "1つのグラフに基準のプラン（点線）と選んだプランを重ねる" },
  { key: "side", label: "左右に並べる", note: "基準のプランと選んだプランを2つのグラフにして並べる。縦の目盛りはそろえる" },
  { key: "all", label: "全部のプランを色分けで重ねる", note: "帯に並べた全部のプラン（現状を含め最大6本）を1つのグラフに、色で描き分ける（プランごとに色が決まっています）。収支は年間収支の線で比較する" },
];

export const METRIC_CHOICES: readonly { key: MetricKey; label: string; note: string }[] = [
  { key: "assetsAtAge", label: "○歳時点の金融資産", note: "年齢を選べます。プランの帯・結論の2行目・グラフの印に出します" },
  { key: "takeHome", label: "生涯の手取りの合計", note: "収入から税・社会保険料を引いた額の、表の期間の合計" },
  { key: "minAssets", label: "金融資産がいちばん少ない年", note: "その年と額" },
  { key: "feeLine", label: "FP顧問料の一文", note: "顧問料を払っても基準より多いか（顧問料の契約がある世帯だけ）" },
];

/** 「○歳時点」の年齢の選択肢 */
export const AGE_OPTIONS: readonly number[] = [60, 65, 70, 75, 80, 85, 90, 95, 100];

/**
 * 表示の設定に出す年齢の選択肢: 本人の表の最初の年の年齢（firstAge）より前の年齢は出さない（その年は表に無く、金融資産を引けない）。
 * 今の値（今より前なら firstAge にした年齢）は選択肢に無くても足す（選んだ形に見せるため）
 */
export function ageOptionsFor(firstAge: number | null, atAge: number): { options: number[]; value: number } {
  const value = firstAge === null ? atAge : Math.max(atAge, firstAge);
  const options = [...new Set([...AGE_OPTIONS.filter((a) => firstAge === null || a >= firstAge), value])].sort((a, b) => a - b);
  return { options, value };
}

export function toggleMetric(s: DisplaySettings, key: MetricKey, on: boolean): DisplaySettings {
  const set = new Set(s.metrics);
  if (on) set.add(key);
  else set.delete(key);
  return { ...s, metrics: METRIC_CHOICES.map((c) => c.key).filter((k) => set.has(k)) };
}

export const shows = (s: DisplaySettings, key: MetricKey) => s.metrics.includes(key);

/** 案の帯のカードに足す数字 */
export function cardMetrics(s: DisplaySettings, m: PlanMetrics | null): { label: string; text: string; neg: boolean }[] {
  if (m === null) return [];
  const out: { label: string; text: string; neg: boolean }[] = [];
  if (shows(s, "assetsAtAge")) out.push({ label: `${m.targetAge}歳時点`, text: `${man(m.target)}万円`, neg: m.target < 0 });
  if (shows(s, "takeHome")) out.push({ label: "生涯の手取り", text: `${man(m.takeHome)}万円`, neg: false });
  if (shows(s, "minAssets")) out.push({ label: `いちばん少ない（${m.min.year}年）`, text: `${man(m.min.amount)}万円`, neg: m.min.amount < 0 });
  return out;
}

/** 結論の2行目に足す数字（選んだ案と基準の案。差はいつも「選んだ案−基準」） */
export function verdictMetrics(s: DisplaySettings, sel: { name: string; m: PlanMetrics }, base: { name: string; m: PlanMetrics } | null): VerdictPart[] {
  const parts: VerdictPart[] = [];
  const add = (label: string, a: number, b: number | null) => {
    parts.push({ text: `${parts.length > 0 ? "／" : "\u3000"}${label}: ${sel.name} ${man(a)}万円` });
    if (b !== null && base !== null) parts.push({ text: `・${base.name} ${man(b)}万円（差 ${manDiff(a - b)}万円）` });
  };
  if (shows(s, "assetsAtAge")) add(`${sel.m.targetAge}歳時点`, sel.m.target, base?.m.target ?? null);
  if (shows(s, "takeHome")) add("生涯の手取り", sel.m.takeHome, base?.m.takeHome ?? null);
  if (shows(s, "minAssets")) add("いちばん少ない年の金融資産", sel.m.min.amount, base?.m.min.amount ?? null);
  return parts;
}

/** グラフの「○歳時点」の印（○歳時点の金融資産を選んだときだけ） */
export function ageMarkOf(s: DisplaySettings, req: EngineRequest): AgeMark | null {
  if (!shows(s, "assetsAtAge")) return null;
  return { year: targetYearOf(req, s.atAge), label: `${atAgeIn(req, s.atAge)}歳` };
}

// ---- 事務所の既定値と「事務所の既定値に従う」の印（0213 の段C） ----

/** 結果のタブ・資産と負債のタブの表示の設定の、事務所の既定値を持てる11件（表示の設定の一覧の id。この世帯で並べる時点・対策に足した項目は入れない） */
export const OFFICE_DISPLAY_IDS = [
  "result.metrics",
  "result.atAge",
  "result.layout",
  "result.invBreakdown",
  "result.invPeriods",
  "balance.health",
  "balance.guide",
  "balance.points",
  "balance.moneyThree.wording",
  "balance.moneyThree.months",
  "balance.moneyThree.years",
] as const;
export type OfficeDisplayId = (typeof OFFICE_DISPLAY_IDS)[number];

export const isOfficeDisplayId = (v: unknown): v is OfficeDisplayId => typeof v === "string" && (OFFICE_DISPLAY_IDS as readonly string[]).includes(v);

/** 2つのタブの表示の設定（読んだ後の値） */
export interface DisplayPair {
  result: DisplaySettings;
  balance: BalanceSettings;
}

/** 世帯ファイルの本文の表示の設定（区画 display）: 世帯の値と、事務所の既定値に従う設定の印（0.80 から） */
export interface StoredDisplay extends DisplayPair {
  /** 事務所の既定値に従う設定の id（OFFICE_DISPLAY_IDS の並び。空・無い〔前の版の世帯〕は全部この世帯の値） */
  followOffice?: OfficeDisplayId[];
}

/** 事務所データの defaults.display（世帯と同じ形で、標準と違う欄だけ。columns は持たない） */
export interface OfficeDisplayStored {
  result?: Partial<DisplaySettings>;
  balance?: Partial<Omit<BalanceSettings, "columns" | "moneyThree">> & { moneyThree?: Partial<MoneyThreeSettings> };
}

export const STANDARD_DISPLAY: DisplayPair = { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * 表示の設定の区画を読む（世帯ファイルの本文の display と、事務所データの defaults.display の同じ形。区画の無い 0.7 までの本文は直下の値から読む）。
 * 読めない値は既定。区画の中の知らない欄は持たない（なくした dock など）
 */
export function readDisplayPair(v: unknown): DisplayPair {
  const d = isObj(v) ? v : {};
  const r = isObj(d.result) ? d.result : d;
  const bal = isObj(d.balance) ? d.balance : null;
  return {
    result: {
      metrics: strs(r.metrics).filter((k): k is MetricKey => METRIC_CHOICES.some((c) => c.key === k)),
      atAge: typeof r.atAge === "number" ? r.atAge : DEFAULT_DISPLAY_SETTINGS.atAge,
      layout: LAYOUT_CHOICES.some((c) => c.key === r.layout) ? (r.layout as DisplaySettings["layout"]) : DEFAULT_DISPLAY_SETTINGS.layout,
      invBreakdown: typeof r.invBreakdown === "boolean" ? r.invBreakdown : DEFAULT_DISPLAY_SETTINGS.invBreakdown,
      invPeriods: typeof r.invPeriods === "boolean" ? r.invPeriods : DEFAULT_DISPLAY_SETTINGS.invPeriods,
    },
    balance: {
      health: typeof bal?.health === "boolean" ? bal.health : DEFAULT_BALANCE_SETTINGS.health,
      guide: readBsGuide(bal !== null ? bal.guide : d.bsGuide),
      points: readBsPoints(bal !== null ? bal.points : d.bsPoints),
      columns: readBsColumns(bal !== null ? bal.columns : d.bsColumns),
      moneyThree: readMoneyThree(bal !== null ? bal.moneyThree : undefined),
    },
  };
}

/** 事務所の既定値に従う印を読む（知らない id・重なりは捨て、OFFICE_DISPLAY_IDS の並びにする。無ければ空＝前の版の世帯） */
export function readFollowOffice(v: unknown): OfficeDisplayId[] {
  const set = new Set(strs(v));
  return OFFICE_DISPLAY_IDS.filter((id) => set.has(id));
}

/** 1つの設定の値（id は OFFICE_DISPLAY_IDS） */
export function displayValueOf(d: DisplayPair, id: OfficeDisplayId): unknown {
  switch (id) {
    case "result.metrics":
      return d.result.metrics;
    case "result.atAge":
      return d.result.atAge;
    case "result.layout":
      return d.result.layout;
    case "result.invBreakdown":
      return d.result.invBreakdown;
    case "result.invPeriods":
      return d.result.invPeriods;
    case "balance.health":
      return d.balance.health;
    case "balance.guide":
      return d.balance.guide;
    case "balance.points":
      return d.balance.points;
    case "balance.moneyThree.wording":
      return d.balance.moneyThree.wording;
    case "balance.moneyThree.months":
      return d.balance.moneyThree.months;
    case "balance.moneyThree.years":
      return d.balance.moneyThree.years;
  }
}

/** 1つの設定の値を置き換えた設定（値は確かめた物。ほかの設定は変えない） */
export function setDisplayValue<T extends DisplayPair>(d: T, id: OfficeDisplayId, v: unknown): T {
  const r = d.result;
  const b = d.balance;
  const m3 = b.moneyThree;
  switch (id) {
    case "result.metrics":
      return { ...d, result: { ...r, metrics: [...(v as MetricKey[])] } };
    case "result.atAge":
      return { ...d, result: { ...r, atAge: v as number } };
    case "result.layout":
      return { ...d, result: { ...r, layout: v as ChartLayout } };
    case "result.invBreakdown":
      return { ...d, result: { ...r, invBreakdown: v as boolean } };
    case "result.invPeriods":
      return { ...d, result: { ...r, invPeriods: v as boolean | null } };
    case "balance.health":
      return { ...d, balance: { ...b, health: v as boolean } };
    case "balance.guide":
      return { ...d, balance: { ...b, guide: v as BsGuide } };
    case "balance.points":
      return { ...d, balance: { ...b, points: [...(v as BsPointKey[])] } };
    case "balance.moneyThree.wording":
      return { ...d, balance: { ...b, moneyThree: { ...m3, wording: v as MoneyThreeSettings["wording"] } } };
    case "balance.moneyThree.months":
      return { ...d, balance: { ...b, moneyThree: { ...m3, months: v as number } } };
    case "balance.moneyThree.years":
      return { ...d, balance: { ...b, moneyThree: { ...m3, years: v as number } } };
  }
}

/** 1つの設定の値を、もう1つの表示の設定から写した設定（ほかの設定は変えない） */
export const withValueFrom = <T extends DisplayPair>(d: T, id: OfficeDisplayId, from: DisplayPair): T => setDisplayValue(d, id, displayValueOf(from, id));

/**
 * 事務所データの defaults.display を読む（世帯と同じ読み方。「○歳時点」の年齢は選択肢の年齢だけ。並べる時点 columns は持たない）。
 * 答えは全部の欄を埋めた表示の設定（事務所で決めていない欄は提供元の既定）
 */
export function officeDisplayOf(v: unknown): DisplayPair {
  const d = readDisplayPair(isObj(v) ? { result: isObj(v.result) ? v.result : {}, balance: isObj(v.balance) ? v.balance : {} } : {});
  const atAge = AGE_OPTIONS.includes(d.result.atAge) ? d.result.atAge : DEFAULT_DISPLAY_SETTINGS.atAge;
  return { result: { ...d.result, atAge }, balance: { ...d.balance, columns: null } };
}

/** 事務所データに書く形（提供元の既定と違う欄だけ。全部同じなら undefined） */
export function officeDisplayStored(d: DisplayPair): OfficeDisplayStored | undefined {
  const result: Partial<DisplaySettings> = {};
  for (const k of Object.keys(DEFAULT_DISPLAY_SETTINGS) as (keyof DisplaySettings)[]) if (!same(d.result[k], DEFAULT_DISPLAY_SETTINGS[k])) (result as Record<string, unknown>)[k] = d.result[k];
  const balance: NonNullable<OfficeDisplayStored["balance"]> = {};
  if (d.balance.health !== DEFAULT_BALANCE_SETTINGS.health) balance.health = d.balance.health;
  if (!same(d.balance.guide, DEFAULT_BALANCE_SETTINGS.guide)) balance.guide = d.balance.guide;
  if (!same(d.balance.points, DEFAULT_BALANCE_SETTINGS.points)) balance.points = d.balance.points;
  const m3: Partial<MoneyThreeSettings> = {};
  for (const k of ["months", "years", "wording"] as const) if (d.balance.moneyThree[k] !== DEFAULT_BALANCE_SETTINGS.moneyThree[k]) (m3 as Record<string, unknown>)[k] = d.balance.moneyThree[k];
  if (Object.keys(m3).length > 0) balance.moneyThree = m3;
  const out: OfficeDisplayStored = { ...(Object.keys(result).length > 0 ? { result } : {}), ...(Object.keys(balance).length > 0 ? { balance } : {}) };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 画面に出す表示の設定: 事務所の既定値に従う印のある設定は事務所の既定値（office は officeDisplayOf の答え）、ほかは世帯の値 */
export function resolveDisplay(d: StoredDisplay, office: DisplayPair): DisplayPair {
  let out: DisplayPair = { result: d.result, balance: d.balance };
  for (const id of d.followOffice ?? []) out = withValueFrom(out, id, office);
  return out;
}

/** 2つの表示の設定で値の違う設定（OFFICE_DISPLAY_IDS の並び） */
export function changedDisplayIds(a: DisplayPair, b: DisplayPair): OfficeDisplayId[] {
  return OFFICE_DISPLAY_IDS.filter((id) => !same(displayValueOf(a, id), displayValueOf(b, id)));
}

/**
 * その世帯で表示の設定を変えた後の本文の表示の設定（next は画面に出す表示の設定を変えた後の値）: 値の変わった設定は印を外してその世帯の値を持つ。
 * 変わっていない設定は、印も世帯の値もそのまま（この世帯で並べる時点は世帯だけの値なので、いつも next の値）
 */
export function withOwnChange(d: StoredDisplay, before: DisplayPair, next: DisplayPair): StoredDisplay {
  const changed = changedDisplayIds(before, next);
  let own: StoredDisplay = { ...d, balance: { ...d.balance, columns: next.balance.columns } };
  for (const id of changed) own = withValueFrom(own, id, next);
  return { ...own, followOffice: (d.followOffice ?? []).filter((id) => !changed.includes(id)) };
}

/** 「事務所の既定値に戻す」: その設定に印を付け、世帯の値も今の事務所の既定値にする（前の版のアプリで開いても同じ値に見える） */
export function withFollowOffice(d: StoredDisplay, id: OfficeDisplayId, office: DisplayPair): StoredDisplay {
  const own = withValueFrom(d, id, office);
  return { ...own, followOffice: OFFICE_DISPLAY_IDS.filter((x) => x === id || (d.followOffice ?? []).includes(x)) };
}

/**
 * 新しく作る世帯の表示の設定: 11件とも事務所の既定値に従う印を付け、世帯の値にも今の事務所の既定値を書く。
 * own は、印を付けずに世帯の値にする設定（画面の確かめの URL で選んだ値など）
 */
export function newHouseholdDisplay(office: DisplayPair, own: { set: DisplayPair; ids: readonly OfficeDisplayId[] } | null = null): StoredDisplay {
  let d: StoredDisplay = { result: { ...office.result }, balance: { ...office.balance, columns: null }, followOffice: [...OFFICE_DISPLAY_IDS] };
  if (own !== null) for (const id of own.ids) d = withValueFrom(d, id, own.set);
  return { ...d, followOffice: OFFICE_DISPLAY_IDS.filter((id) => own === null || !own.ids.includes(id)) };
}

/** その設定が事務所の既定値に従っているか（画面の「事務所の既定値」・「この世帯だけ」） */
export const followsOffice = (d: Pick<StoredDisplay, "followOffice">, id: OfficeDisplayId): boolean => (d.followOffice ?? []).includes(id);

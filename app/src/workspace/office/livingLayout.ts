// 基本生活費の内訳の並べ方（事務所の既定値。0109）: 事務所ごとに、内訳（月額）の行の名前・まとめ方・隠す内訳・1つの内訳を分けた行を決める。
// 計算の内訳（10の内訳。LIVING_CATEGORY_ORDER）と推定（同じ人数の世帯の平均）は変えない。見せ方だけなので世帯には写さず、
// 変えるとどの世帯にもすぐ効く（並べ方を変えただけでは、世帯の値も結果も変わらない）。
// - 行の種類: one（内訳1つ。名前を変えられる）・group（2つ以上の内訳をまとめた1行。入れた額は内訳の今の額の割合で分ける）・
//   split（1つの内訳を2〜6の行に分ける。分けた行の合計がその内訳の額。分けた額は世帯の側に残す。input/livingParts.ts）
// - どの行にも無い内訳は「隠す」。隠した内訳は「その他」の行に入れる（その他の行が隠した内訳とのまとめの行になる）。その他は隠せず、分けられない
// - 読むときは形を確かめ、読めない所は標準（並べ方が標準と同じなら null）
// 画面の側の操作（入力項目の内訳の行）が読む今の並べ方も、ここに置く（ほかの所に頼らないよう、統計も世帯も読まない。読むのは内訳の並びだけ）
import { LIVING_CATEGORY_ORDER } from "../input/estimates.ts";

export type LivingRowCategory = (typeof LIVING_CATEGORY_ORDER)[number];

/** 分けた行（1つの内訳の中の行）。share は事務所が決めた割合（整数の%）。どの行にもあって合計100のときだけ使い、無ければ等分 */
export interface LivingPartDef {
  label: string;
  share?: number;
}

export type LivingRow =
  | { kind: "one"; category: LivingRowCategory; label?: string }
  | { kind: "group"; label: string; categories: LivingRowCategory[] }
  | { kind: "split"; category: LivingRowCategory; label?: string; parts: LivingPartDef[] };

/** 内訳の並べ方（rows に無い内訳は隠す） */
export interface LivingLayout {
  rows: LivingRow[];
}

/** 行の名前の長さの上限（文字） */
export const LIVING_LABEL_MAX = 20;
/** 分けた行の数（2〜6） */
export const LIVING_PARTS_MIN = 2;
export const LIVING_PARTS_MAX = 6;

/** 内訳の標準の名前（labels.ts の LIVING_CATEGORIES と同じ。ここは何も読み込まないよう写して持つ） */
export const STANDARD_LIVING_NAMES: Readonly<Record<LivingRowCategory, string>> = {
  food: "食費",
  utilities: "水道・光熱費",
  communication: "通信費",
  transit: "交通費",
  furniture: "日用品",
  clothing: "被服・美容",
  health: "医療費",
  recreation: "趣味・娯楽",
  pocketAndSocial: "こづかい・交際費",
  other: "その他",
};

/** 標準の並べ方（10の内訳を1行ずつ、標準の名前で） */
export const STANDARD_LIVING_LAYOUT: LivingLayout = { rows: LIVING_CATEGORY_ORDER.map((category) => ({ kind: "one", category })) };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const CATS: ReadonlySet<string> = new Set(LIVING_CATEGORY_ORDER);
const isCat = (v: unknown): v is LivingRowCategory => typeof v === "string" && CATS.has(v);

/** 行の名前を読む（前後の空白を外し、長すぎる名前は切る。空は undefined） */
function readLabel(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, LIVING_LABEL_MAX);
  return t === "" ? undefined : t;
}

/** 分けた行の割合（どの行にもあって合計100のときだけ。ほかは割合を持たない＝等分） */
function readShares(parts: { label: string; share?: unknown }[]): LivingPartDef[] {
  const ok = parts.every((p) => typeof p.share === "number" && Number.isInteger(p.share) && p.share >= 0 && p.share <= 100) && parts.reduce((s, p) => s + (p.share as number), 0) === 100;
  return parts.map((p) => (ok ? { label: p.label, share: p.share as number } : { label: p.label }));
}

/**
 * 読んだ値から並べ方（読めない行は捨てる。同じ内訳は最初の行だけ。その他はどの行にも無ければ最後に1行足し、分けた行にあれば1行に戻す。
 * 標準と同じなら null）
 */
export function readLivingLayout(v: unknown): LivingLayout | null {
  if (!isObj(v) || !Array.isArray(v.rows)) return null;
  const used = new Set<string>();
  const rows: LivingRow[] = [];
  for (const r of v.rows) {
    if (!isObj(r)) continue;
    if (r.kind === "one" && isCat(r.category) && !used.has(r.category)) {
      used.add(r.category);
      const label = readLabel(r.label);
      rows.push({ kind: "one", category: r.category, ...(label !== undefined && label !== STANDARD_LIVING_NAMES[r.category] ? { label } : {}) });
    } else if (r.kind === "group" && Array.isArray(r.categories)) {
      const cats = [...new Set(r.categories.filter(isCat))].filter((c) => !used.has(c));
      if (cats.length === 0) continue;
      for (const c of cats) used.add(c);
      const label = readLabel(r.label);
      if (cats.length === 1) {
        const c = cats[0] as LivingRowCategory;
        rows.push({ kind: "one", category: c, ...(label !== undefined && label !== STANDARD_LIVING_NAMES[c] ? { label } : {}) });
      } else rows.push({ kind: "group", label: label ?? cats.map((c) => STANDARD_LIVING_NAMES[c]).join("・"), categories: cats });
    } else if (r.kind === "split" && isCat(r.category) && !used.has(r.category) && Array.isArray(r.parts)) {
      used.add(r.category);
      const label = readLabel(r.label);
      // 名前の無い行・同じ名前の2つ目は捨てる
      const parts: { label: string; share?: unknown }[] = [];
      for (const p of r.parts) {
        const pl = isObj(p) ? readLabel(p.label) : undefined;
        if (pl !== undefined && !parts.some((x) => x.label === pl) && parts.length < LIVING_PARTS_MAX) parts.push({ label: pl, share: (p as Record<string, unknown>).share });
      }
      const keepLabel = label !== undefined && label !== STANDARD_LIVING_NAMES[r.category] ? { label } : {};
      // その他は分けない（隠した内訳を入れる行のため）。分けた行が2つに満たなければ1行のまま
      if (r.category === "other" || parts.length < LIVING_PARTS_MIN) rows.push({ kind: "one", category: r.category, ...keepLabel });
      else rows.push({ kind: "split", category: r.category, ...keepLabel, parts: readShares(parts) });
    }
  }
  if (!used.has("other")) rows.push({ kind: "one", category: "other" });
  const layout: LivingLayout = { rows };
  return isStandardLivingLayout(layout) ? null : layout;
}

/** 標準の並べ方と同じか */
export const isStandardLivingLayout = (l: LivingLayout | null | undefined): boolean => l == null || JSON.stringify(l.rows) === JSON.stringify(STANDARD_LIVING_LAYOUT.rows);

/** 行の内訳（並べた順） */
export const rowCategories = (r: LivingRow): LivingRowCategory[] => (r.kind === "group" ? r.categories : [r.category]);

/** 隠した内訳（どの行にも無い内訳。標準の並び順） */
export function hiddenCategories(l: LivingLayout): LivingRowCategory[] {
  const shown = new Set(l.rows.flatMap(rowCategories));
  return LIVING_CATEGORY_ORDER.filter((c) => !shown.has(c));
}

/** 行の中身の内訳（その他の行は、隠した内訳も入れる） */
export function rowMembers(l: LivingLayout, r: LivingRow): LivingRowCategory[] {
  const own = rowCategories(r);
  return own.includes("other") ? [...own, ...hiddenCategories(l)] : own;
}

/** 行の名前（名前を変えていなければ標準の名前） */
export const rowLabel = (r: LivingRow): string => (r.kind === "group" ? r.label : (r.label ?? STANDARD_LIVING_NAMES[r.category]));

/** 分けた行の割合（%。事務所が決めていなければ等分。合計100） */
export function partShares(parts: readonly LivingPartDef[]): number[] {
  if (parts.length > 0 && parts.every((p) => p.share !== undefined)) return parts.map((p) => p.share as number);
  const n = parts.length;
  return parts.map((_p, i) => Math.floor(100 / n) + (i < 100 % n ? 1 : 0));
}

/** 分けた行の割合を事務所が決めているか */
export const hasShares = (parts: readonly LivingPartDef[]): boolean => parts.length > 0 && parts.every((p) => p.share !== undefined);

/**
 * 額を重みで分ける（step 円の単位に丸め、端は重みの一番大きい物に置く。合計は total のまま）。重みが全部0なら null。
 * 丸めで端がマイナスになるときは1円の単位で分ける
 */
export function apportion(total: number, weights: readonly number[], step = 1000): number[] | null {
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (sum <= 0 || weights.length === 0) return null;
  let big = 0;
  weights.forEach((w, i) => {
    if (w > (weights[big] ?? 0)) big = i;
  });
  const once = (st: number): number[] => {
    const out = weights.map((w) => Math.round((total * Math.max(0, w)) / sum / st) * st);
    out[big] = 0;
    out[big] = total - out.reduce((s, x) => s + x, 0);
    return out;
  };
  const a = once(step);
  return (a[big] ?? 0) >= 0 ? a : once(1);
}

// ---- 画面の側の操作が読む今の並べ方（アプリが開いている間。事務所の既定値を読み込んだとき・保存したときに入れる） ----

let now: LivingLayout | null = null;

/** 今の事務所の並べ方（標準なら null） */
export const livingLayoutNow = (): LivingLayout | null => now;

export function setLivingLayoutNow(l: LivingLayout | null | undefined): void {
  now = l === undefined || isStandardLivingLayout(l) ? null : l;
}

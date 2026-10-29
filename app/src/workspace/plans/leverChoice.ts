// 対策に最初から出す項目の選び方（事務所の既定値。0084）: 主画面の対策に、どの世帯でも最初から出す項目。
// - 選べるのは、対策の固定の項目（働く最後の年齢・年金の受け取り開始・NISA・生活費・FP顧問料）と配偶者の働き方と年収、
//   「＋ 動かす項目を追加」の資産運用・貯まり方・よく使う項目。入力の欄そのものを動かす項目（field:）は数が多く、
//   世帯の入力の形で増え減りするので対象にしない（今までどおり「＋ 動かす項目を追加」で足す）
// - 世帯ごとに1つずつある項目（住宅ローンの借入額・繰上返済・金利、資産運用の配分）は種類で選ぶ。選ぶと、その世帯の当てはまる物すべての項目が出る。
//   当てはまる物が無い世帯には出ない
// - 事務所データ（office/settings.ts の levers）には、既定の組み合わせとの違いだけを持つ（入力項目の選び方 input/itemChoice.ts と同じ考え方）。
//   既定の組み合わせは DEFAULT_LEVER_KINDS の1か所。差し替えると、事務所が足した・外した種類はそのままで、触っていない種類は新しい既定に従う
// - 見せ方だけ: 値も計算も変えない。外した項目でも、選んだプランで値が入っていれば出す（黙って値を隠さない。0083 の4と同じ）
// - 世帯ごとには持たない（その場で「＋ 動かす項目を追加」で足せる。足した項目は今までどおり世帯の作業の状態 shownItems）
import type { Catalog, MovableItem } from "./items.ts";
import type { Values } from "./plans.ts";

/** 対策に最初から出せる項目の種類（一覧の並び＝対策の並び） */
export const LEVER_KINDS = [
  { kind: "lever:retireAge", group: "対策", label: "働く最後の年齢（本人）" },
  { kind: "lever:pensionAge", group: "対策", label: "年金を受け取り始める年齢（本人）" },
  { kind: "lever:nisaMonthly", group: "対策", label: "NISAの積立額（月）" },
  { kind: "lever:livingMonthly", group: "対策", label: "毎月の生活費" },
  { kind: "spouse:work", group: "対策", label: "配偶者の働き方と年収", note: "配偶者がいる世帯だけ" },
  { kind: "lever:fee", group: "対策", label: "FP顧問料（入れる・入れない）", note: "契約がある世帯だけ" },
  { kind: "inv:monthly", group: "資産運用", label: "毎月の積立額" },
  { kind: "inv:rate", group: "資産運用", label: "運用の利回り（預金を除く）" },
  { kind: "inv:stop", group: "資産運用", label: "積立をやめる年齢" },
  { kind: "inv:wStart", group: "資産運用", label: "取り崩しを始める年齢" },
  { kind: "inv:wAmt", group: "資産運用", label: "毎月の取り崩し額" },
  { kind: "inv:wRate", group: "資産運用", label: "毎年の取り崩し率" },
  { kind: "surplus:ratio", group: "貯まり方", label: "黒字のうち貯まる割合" },
  { kind: "loan:principal", group: "よく使う", label: "住宅ローンの借入額", note: "まだ借りていないローンごと" },
  { kind: "loan:prepay", group: "よく使う", label: "住宅ローンの繰上返済", note: "もう借りているローンごと" },
  { kind: "loan:rate", group: "よく使う", label: "住宅ローンの金利", note: "ローンごと" },
  { kind: "rates:shift", group: "よく使う", label: "変動金利の上昇", note: "変動金利のローンがある世帯だけ" },
  { kind: "mix", group: "よく使う", label: "資産運用の配分", note: "口座ごと" },
] as const satisfies readonly { kind: string; group: string; label: string; note?: string }[];

export type LeverKind = (typeof LEVER_KINDS)[number]["kind"];

/**
 * 既定の組み合わせ（事務所が何も選んでいないとき）。**差し替えるのはここだけ**。
 * 今は、働く最後の年齢・年金の受け取り開始・毎月の生活費・配偶者の働き方と年収の4つと、FP顧問料（顧問料の契約がある世帯だけ。4つの後ろの別の行）。
 * NISA の積立は既定から外した（「＋ 動かす項目を追加」で足せる。事務所の設定で戻せる）
 */
export const DEFAULT_LEVER_KINDS: readonly LeverKind[] = ["lever:retireAge", "lever:pensionAge", "lever:livingMonthly", "spouse:work", "lever:fee"];

export interface LeverChoice {
  /** 既定に無いが、最初から出す種類（一覧の並び） */
  shown?: LeverKind[];
  /** 既定にあるが、最初から出さない種類（一覧の並び） */
  hidden?: LeverKind[];
}

const KNOWN = new Set<string>(LEVER_KINDS.map((k) => k.kind));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 一覧の並びに並べる（知らない種類・重なりは捨てる） */
const inOrder = (xs: Iterable<string>): LeverKind[] => {
  const set = new Set(xs);
  return LEVER_KINDS.map((k) => k.kind).filter((k) => set.has(k));
};

/** 読んだ値から選び方（形の合わない所・知らない種類は捨てる。両方にある種類は「出さない」。何も無ければ空のオブジェクト） */
export function readLeverChoice(v: unknown): LeverChoice {
  if (!isObj(v)) return {};
  const pick = (x: unknown): LeverKind[] => (Array.isArray(x) ? inOrder(x.filter((y): y is string => typeof y === "string" && KNOWN.has(y))) : []);
  const hidden = pick(v.hidden);
  const shown = pick(v.shown).filter((k) => !hidden.includes(k));
  return { ...(shown.length > 0 ? { shown } : {}), ...(hidden.length > 0 ? { hidden } : {}) };
}

/** 何も選んでいない（既定の組み合わせのまま） */
export const isEmptyLeverChoice = (c: LeverChoice | undefined | null): boolean => c === undefined || c === null || ((c.shown ?? []).length === 0 && (c.hidden ?? []).length === 0);

/** その種類を最初から出すか */
export function startsWith(c: LeverChoice | undefined, kind: LeverKind, defaults: readonly LeverKind[] = DEFAULT_LEVER_KINDS): boolean {
  if ((c?.hidden ?? []).includes(kind)) return false;
  return defaults.includes(kind) || (c?.shown ?? []).includes(kind);
}

/** 最初から出す種類（一覧の並び） */
export const startKinds = (c: LeverChoice | undefined, defaults: readonly LeverKind[] = DEFAULT_LEVER_KINDS): LeverKind[] => LEVER_KINDS.map((k) => k.kind).filter((k) => startsWith(c, k, defaults));

/** 最初から出す・出さないを決める（既定と同じになる分は持たない） */
export function withStart(c: LeverChoice | undefined, kind: LeverKind, on: boolean, defaults: readonly LeverKind[] = DEFAULT_LEVER_KINDS): LeverChoice {
  const shown = new Set<string>(c?.shown ?? []);
  const hidden = new Set<string>(c?.hidden ?? []);
  shown.delete(kind);
  hidden.delete(kind);
  if (on && !defaults.includes(kind)) shown.add(kind);
  if (!on && defaults.includes(kind)) hidden.add(kind);
  return readLeverChoice({ shown: [...shown], hidden: [...hidden] });
}

/** 動かす項目のキー → 種類（ローン・口座ごとの項目は物の ID を除いた種類。入力の欄の項目〔field:〕と知らない項目は null） */
export function leverKindOf(key: string): LeverKind | null {
  if (KNOWN.has(key) && key !== "mix" && !key.startsWith("loan:") && !key.startsWith("spouse:")) return key as LeverKind;
  if (/^spouse:.+:work$/.test(key)) return "spouse:work";
  const loan = /^loan:.+:(principal|prepay|rate)$/.exec(key);
  if (loan !== null) return `loan:${loan[1] as "principal" | "prepay" | "rate"}`;
  if (key.startsWith("mix:")) return "mix";
  return null;
}

/** この世帯の動かす項目のうち、最初から出す項目のキー */
export function startKeys(cat: Catalog, c: LeverChoice | undefined, defaults: readonly LeverKind[] = DEFAULT_LEVER_KINDS): Set<string> {
  const out = new Set<string>();
  for (const it of cat.items) {
    const k = leverKindOf(it.key);
    if (k !== null && startsWith(c, k, defaults)) out.add(it.key);
  }
  return out;
}

export interface LeverView {
  /** 最初から出す項目（外せない） */
  fixed: ReadonlySet<string>;
  /** 対策の上に、固定の形（対策の固定の項目の部品）で出す項目（一覧の並び。最初から出す・足した・値が入っている対策の固定の項目と、最初から出すほかの項目） */
  top: MovableItem[];
  /** 足した項目の行（足した順。続けて、足していないが値が入っている項目を一覧の並びで） */
  added: MovableItem[];
}

const isLeverPhase = (it: MovableItem) => it.phase === "lever" || it.phase === "fee";

/**
 * 対策に出す項目を決める。values は選んだプランの値（現状のときは空）。
 * 最初から出す項目・「＋ 動かす項目を追加」で足した項目（shown）・選んだプランで値が入っている項目を出す
 */
export function leverView(cat: Catalog, c: LeverChoice | undefined, shown: readonly string[], values: Values, defaults: readonly LeverKind[] = DEFAULT_LEVER_KINDS): LeverView {
  const fixed = startKeys(cat, c, defaults);
  const picked = new Set(shown);
  const valued = (k: string) => Object.hasOwn(values, k);
  const top = cat.items.filter((it) => fixed.has(it.key) || (isLeverPhase(it) && (picked.has(it.key) || valued(it.key))));
  const inTop = new Set(top.map((it) => it.key));
  const rest = (it: MovableItem | undefined): it is MovableItem => it !== undefined && !inTop.has(it.key);
  const added = [...new Set(shown)].map((k) => cat.byKey.get(k)).filter(rest);
  const inAdded = new Set(added.map((it) => it.key));
  for (const it of cat.items) if (rest(it) && !inAdded.has(it.key) && valued(it.key)) added.push(it);
  return { fixed, top, added };
}

/** 対策に出している項目のキー（「＋ 動かす項目を追加」の一覧で「出しています」にする） */
export const visibleKeys = (v: LeverView): Set<string> => new Set([...v.top, ...v.added].map((it) => it.key));

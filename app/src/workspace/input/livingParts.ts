// 基本生活費の内訳を分けた行の額（0109）: 事務所の並べ方（office/livingLayout.ts）で1つの内訳を分けた行（例: 食費 → 自炊・外食）に入れた額を、
// 世帯の側に残す。計算に使うのは今までどおり内訳の額（分けた行の合計）で、ここの額は計算に使わない（見せるため・ほかの並べ方の事務所で開いても失わないため）。
// - 置き場所: 作業中の世帯の livingParts（内訳の要素の ID → 分けた行の名前と額）。プランで分けた額は「プランの ID:要素の ID」に置く
// - 世帯ファイルでは拡張領域（0011 の4）の公式の項目 ext.official.livingParts に入れる（形式の版は上げない。知らないアプリも失わずに書き戻す）
// - 使ってよいのは、分けた行の合計が今の内訳の額と同じときだけ（明細の取り込み・推定の入れ直し・ほかの事務所で内訳を直したなどで額が変わったら、
//   古い分け方として使わない。保存するときに外す）
import type { LivingExpense } from "../../engine/types.ts";
import type { WorkingHousehold } from "./household.ts";

/** 分けた行1つ（名前・月額。estimated は事務所の割合で分けた目安のままの行の根拠の文） */
export interface LivingPart {
  label: string;
  monthly: number;
  estimated?: string;
}

/** 拡張領域のキー（0011 の4。作成者 official は公式が拡張の形で試す項目） */
export const LIVING_PARTS_EXT = "ext.official.livingParts";

/** 拡張領域の項目の定義（世帯ファイルに値と一緒に写す） */
export const LIVING_PARTS_DEFINITION = {
  type: "object",
  label: "基本生活費の内訳を分けた行の額",
  description: "事務所の並べ方で1つの内訳を分けた行（例: 食費の自炊・外食）の名前と月額。キーは内訳の要素の ID（プランは「プランの ID:要素の ID」）。合計が内訳の額と同じときだけ使う。計算には使わない",
  version: 1,
  attachTo: "household",
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 読んだ値から分けた行の額（形の合わない物は捨てる） */
export function readLivingParts(v: unknown): Record<string, LivingPart[]> {
  if (!isObj(v)) return {};
  const out: Record<string, LivingPart[]> = {};
  for (const [k, list] of Object.entries(v)) {
    if (!Array.isArray(list)) continue;
    const parts: LivingPart[] = [];
    for (const p of list) {
      if (!isObj(p) || typeof p.label !== "string" || p.label === "" || typeof p.monthly !== "number" || !Number.isInteger(p.monthly) || p.monthly < 0) continue;
      parts.push({ label: p.label, monthly: p.monthly, ...(typeof p.estimated === "string" && p.estimated !== "" ? { estimated: p.estimated } : {}) });
    }
    if (parts.length >= 2) out[k] = parts;
  }
  return out;
}

// ---- プランの中身で見るとき（plans/planEdit.ts の planView が入れる） ----

/** プランの中身の作業中の世帯 → そのプランと土台のプランの ID（近い順） */
const scopes = new WeakMap<object, readonly string[]>();

/** プランの中身の作業中の世帯に、プランの ID（近い順）を覚えさせる */
export function setPartsScope(view: WorkingHousehold, plans: readonly string[]): void {
  scopes.set(view, plans);
}

const sum = (ps: readonly LivingPart[]) => ps.reduce((s, p) => s + p.monthly, 0);

/**
 * 内訳の要素の、使ってよい分けた行（合計が今の額と同じ物。プランの中身ならプランの物を先に）。labels を渡すと、名前と並びが同じ物だけ。
 * 無ければ null
 */
export function partsOf(wh: WorkingHousehold, elementId: string | undefined, value: number | null, labels?: readonly string[]): LivingPart[] | null {
  if (elementId === undefined || value === null) return null;
  const all = wh.livingParts ?? {};
  const keys = [...(scopes.get(wh) ?? []).map((p) => `${p}:${elementId}`), elementId];
  for (const k of keys) {
    const ps = all[k];
    if (ps === undefined || sum(ps) !== value) continue;
    if (labels !== undefined && (ps.length !== labels.length || ps.some((p, i) => p.label !== labels[i]))) continue;
    return ps;
  }
  return null;
}

/**
 * 分けた行を書いた世帯（プランの中身なら、そのプランの所に書く。parts が undefined なら外す）。scopeOf は、どのプランの中身かを読む世帯
 * （書く前の世帯。書いた後の世帯はプランの印を持たないため）
 */
export function withParts(wh: WorkingHousehold, elementId: string, parts: LivingPart[] | undefined, scopeOf: WorkingHousehold = wh): WorkingHousehold {
  const scope = scopes.get(scopeOf)?.[0];
  const key = scope !== undefined ? `${scope}:${elementId}` : elementId;
  const next = { ...(wh.livingParts ?? {}) };
  if (parts === undefined) delete next[key];
  else next[key] = parts.map((p) => ({ ...p }));
  const { livingParts: _old, ...rest } = wh;
  void _old;
  return Object.keys(next).length === 0 ? rest : { ...rest, livingParts: next };
}

/**
 * 保存する分けた行（現状の物は、合計が今の内訳の額と同じ物だけ。プランの物は、そのプランがある物だけ）。空なら null
 */
export function partsToSave(wh: WorkingHousehold): Record<string, LivingPart[]> | null {
  const all = wh.livingParts ?? {};
  const values = new Map<string, number | null>();
  for (const l of (wh.request.input.household.livingExpenses ?? []) as LivingExpense[]) for (const c of l.categories ?? []) if (c.id !== undefined) values.set(c.id, c.monthly.value ?? null);
  const plans = new Set(wh.proposals.map((p) => p.id));
  const out: Record<string, LivingPart[]> = {};
  for (const [k, ps] of Object.entries(all)) {
    const i = k.indexOf(":");
    if (i >= 0 ? plans.has(k.slice(0, i)) : values.get(k) === sum(ps)) out[k] = ps;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 本文の拡張領域に分けた行を入れる（無ければ外す。ほかの拡張項目はそのまま） */
export function extWithParts(carry: { extDefinitions: Record<string, unknown>; ext: Record<string, unknown> }, parts: Record<string, LivingPart[]> | null): { extDefinitions: Record<string, unknown>; ext: Record<string, unknown> } {
  const { [LIVING_PARTS_EXT]: _v, ...ext } = carry.ext;
  const { [LIVING_PARTS_EXT]: _d, ...defs } = carry.extDefinitions;
  void _v;
  void _d;
  if (parts === null) return { extDefinitions: defs, ext };
  return { extDefinitions: { ...defs, [LIVING_PARTS_EXT]: LIVING_PARTS_DEFINITION }, ext: { ...ext, [LIVING_PARTS_EXT]: parts } };
}

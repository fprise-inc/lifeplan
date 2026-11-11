// プランの候補の書き方（対象・入力項目ID・値）を、主画面の「動かす項目」（items.ts）に当てはめる（0015 の7・0195）。
// - 画面の「AIからの候補」（ai/model.ts）と、AI接続口の計算（connector/plan.ts の applyPlan）・動かせる項目の一覧（listPlanItems）が、
//   この1か所で当てはめる。画面と接続口で、同じ候補が同じ項目・同じ値になる（接続口に別の書き方を作らない）
// - 画面の状態（帯・選んだプラン・保存していない変更）には依らない。世帯（WorkingHousehold）と動かす項目の一覧（Catalog）だけを読む
// - 当てはめは対策の固定の項目（働く最後の年齢・年金の受け取り開始・NISA・生活費・FP顧問料）を先に探し、当たらなければ入力の欄の項目を探す
//   （同じ入力項目ID・同じ向き先の欄より、結果の画面の対策を選ぶ）
import { ITEM_LABELS } from "../../generated/labels.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { rangeText, rateInRange, type PctRange } from "../input/rateRanges.ts";
import { currentPeriodId, resolveKey, type Reading } from "../store/readings.ts";
import type { Catalog, DiffTarget, ItemValue, MovableItem } from "./items.ts";
import type { Values } from "./plans.ts";

/** 入力項目の外で縮約版に入る項目の名前（AIに渡した記録・共有の画面の「渡す項目」。0195） */
const EXTRA_ITEM_LABELS: Record<string, string> = { postRetirement: "定年後の働き方の条件" };

/** 入力項目IDの短い名前。知らない ID はそのまま */
export const itemName = (id: string): string => ITEM_LABELS[id] || EXTRA_ITEM_LABELS[id] || id;

/** プランの候補の変更1件（propose_scenario の changes の1件と同じ中身。対象は物・構成員の ID か前提） */
export interface ProposedChange {
  id: string;
  target: { object: string } | { plan: "assumptions" };
  item: string;
  value: unknown;
  note: string | null;
}

/** 候補の変更1件の見せ方と、プランにできるか */
export interface CandidateRow {
  diffId: string;
  label: string;
  from: string;
  to: string;
  /** AIが書いた理由（信用しない文章） */
  note: string | null;
  /** プランにするときの動かす項目のキー。プランにできないときは null */
  key: string | null;
  /** プランにできない理由 */
  reason: string | null;
  value: ItemValue;
}

const sameTarget = (it: DiffTarget, t: ProposedChange["target"]): boolean => {
  if ("plan" in t) return "plan" in it && it.plan === t.plan;
  return ("object" in it && it.object === t.object) || ("member" in it && it.member === t.object);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** 値の箱（{value: …}）・年ごとの列の既定の値だけ（{default: …}）で来たら中身を取り出す */
const unbox = (v: unknown): unknown => {
  if (isObj(v) && "value" in v && Object.keys(v).every((k) => ["value", "state", "origin", "estimate"].includes(k))) return v.value;
  if (isObj(v) && "default" in v && Object.keys(v).length === 1) return v.default;
  return v;
};

/** AI の値を、動かす項目の値の形にする（合わなければ undefined） */
export function coerce(it: MovableItem, raw: unknown): ItemValue | undefined {
  const v = unbox(raw);
  const c = it.control;
  const num = (): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && DECIMAL.test(v) ? Number(v) : undefined);
  const rate = (): string | undefined => (typeof v === "string" && DECIMAL.test(v) ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);
  switch (c.kind) {
    case "range":
    case "age":
      return num();
    case "rate":
      return rate();
    case "toggle":
      return typeof v === "boolean" ? v : undefined;
    case "field":
      return c.field.kind === "pct" || c.field.kind === "decimal" ? rate() : num();
    case "mix":
      return Array.isArray(v) && v.every((m) => isObj(m) && typeof m.assetClass === "string" && typeof m.share === "string") ? (v as { assetClass: string; share: string }[]).map((m) => ({ assetClass: m.assetClass, share: m.share })) : undefined;
    case "shift": {
      const s = Array.isArray(v) ? v[0] : v;
      return isObj(s) && typeof s.add === "string" && typeof s.from === "string" && DECIMAL.test(s.add) ? { add: s.add, from: s.from } : undefined;
    }
    case "work": {
      // 働き方の種類（選択肢のどれか）と1年の収入（0〜上限の整数の円）。スライダーと同じ範囲
      if (!isObj(v) || typeof v.type !== "string" || !c.options.some((o) => o.value === v.type)) return undefined;
      const a = v.annual;
      const annual = typeof a === "number" ? a : typeof a === "string" && DECIMAL.test(a) ? Number(a) : undefined;
      return annual !== undefined && Number.isInteger(annual) && annual >= 0 && annual <= c.max ? { type: v.type, annual } : undefined;
    }
  }
}

const short = (v: unknown): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v) ?? "—";
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
};

/** 率の項目の入れてよい範囲（割合の欄の min・max か、率のスライダーの limit。0098）。無ければ null */
function rangeOf(it: MovableItem): PctRange | { min?: number; max?: number } | null {
  const c = it.control;
  if (c.kind === "rate") return c.limit ?? null;
  if (c.kind === "field" && c.field.kind === "pct" && (c.field.min !== undefined || c.field.max !== undefined)) return { ...(c.field.min !== undefined ? { min: c.field.min } : {}), ...(c.field.max !== undefined ? { max: c.field.max } : {}) };
  return null;
}

/**
 * 対策の固定の項目の数の値が、入れてよい範囲の外なら理由（0195。今と同じ値は確かめない）。年齢は1歳ずつで、スライダーの下の端（働く最後の年齢は今の年齢の次・
 * 年金の受け取り開始は過ぎていない年齢）から上の端まで。金額（NISA・生活費）は0以上の整数の円（スライダーの幅は目盛りなので確かめない）
 */
function leverOutOfRange(it: MovableItem, v: ItemValue, now: ItemValue): string | null {
  const c = it.control;
  if (typeof v !== "number" || it.same(v, now)) return null;
  // 上の端は、今の値が外にあれば広げる（画面のスライダーと同じ。items.ts の ageSliderBounds）
  const max = typeof now === "number" ? Math.max(c.kind === "age" ? c.max : 0, now) : c.kind === "age" ? c.max : 0;
  if (c.kind === "age") return Number.isInteger(v) && v >= c.min && v <= max ? null : `入れてよい範囲（${c.min}〜${max}歳の整数）の外の値のため、取り込みません`;
  if (c.kind === "range") return Number.isInteger(v) && v >= 0 ? null : "0以上の整数（円）でないため、取り込みません";
  return null;
}

/** 動かす項目のキーの読み替え（resolveKey）を、一覧と現状ごとに1回だけ作る（一覧のすべての項目を当てはめ直す listPlanItems のため） */
const READINGS = new WeakMap<Catalog, { input: object; map: Map<string, Reading | null> }>();
function readingsOf(cat: Catalog, input: Record<string, unknown>): (key: string) => Reading | null {
  let c = READINGS.get(cat);
  if (c === undefined || c.input !== input) {
    c = { input, map: new Map() };
    READINGS.set(cat, c);
  }
  const map = c.map;
  return (key) => {
    if (!map.has(key)) map.set(key, resolveKey(key, input));
    return map.get(key) ?? null;
  };
}

/**
 * 候補の変更1件に当てはまる動かす項目（同じ値を指す欄は1つに数える）。1つに決まらなければ、0件か2件以上を返す。
 * 当て先を正にする（0036 の9）: 欄の当て先の向き先と入力項目ID が候補と同じ欄。今までの向き先（働き方の欄は構成員など、欄の
 * 一覧の向き先）で送る AI のアプリも当てはまるよう、どちらで合っても当てはめる。候補はまだ場所（at）を持たない
 */
export function matchItems(d: Pick<ProposedChange, "target" | "item">, wh: WorkingHousehold, cat: Catalog): MovableItem[] {
  const input = wh.request.input as unknown as Record<string, unknown>;
  // 働き方の値を構成員に向けて送る候補は、その人の今の働き方の期間の欄にも当てはめる（今の働き方の年収は標準では年収〔賞与込み〕の1欄で、
  // 年収・賞与の動かす項目は働き方の期間の欄にある。0078）
  const tid = "object" in d.target ? d.target.object : null;
  const memberId = tid !== null && wh.request.input.household.members.some((m) => m.id === tid) ? tid : null;
  const period = memberId !== null && d.item?.startsWith("employment.") === true ? currentPeriodId(input, memberId) : null;
  const hits = (t: DiffTarget) => sameTarget(t, d.target) || (period !== null && sameTarget(t, { object: period }));
  const read = readingsOf(cat, input);
  const matchIn = (phase: (p: MovableItem["phase"]) => boolean) =>
    cat.items.filter((it) => {
      if (!phase(it.phase) || it.item !== d.item) return false;
      const r = read(it.key);
      return (r !== null && r.kind === "address" && hits(r.address.target as DiffTarget)) || hits(it.target);
    });
  // 対策の固定の項目（働く最後の年齢・年金の受け取り開始・NISA・生活費・FP顧問料。向き先は構成員・物）を先に探し、当たらなければ入力の欄の
  // 項目を探す（同じ入力項目ID・同じ向き先の欄〔本人の定年の年齢など〕より、結果の画面の対策を選ぶ。0195）
  const levers = matchIn((p) => p !== "field");
  const found = levers.length > 0 ? levers : matchIn((p) => p === "field");
  // 同じ値を指す欄（今の働き方の期間の欄と、その期間の欄など）は1つに数える
  const placeOf = (it: MovableItem) => {
    const r = read(it.key);
    return r !== null && r.kind === "address" ? JSON.stringify(r.address) : it.key;
  };
  return found.filter((it, i) => found.findIndex((x) => placeOf(x) === placeOf(it)) === i);
}

/** 候補の変更を、主画面の動かす項目に当てはめる（当てはまらないものは理由つきで返す） */
export function candidateRows(c: { diffs: readonly ProposedChange[] }, wh: WorkingHousehold, cat: Catalog): CandidateRow[] {
  return c.diffs.map((d) => {
    const base = { diffId: d.id, note: d.note };
    const matches = matchItems(d, wh, cat);
    if (matches.length !== 1) {
      return { ...base, label: itemName(d.item), from: "—", to: short(unbox(d.value)), key: null, value: null, reason: matches.length === 0 ? "「結果」の画面のプランでは動かせない項目です（取り込みません。必要なら入力で直してください）" : "対応する欄が複数あるため、取り込みません" };
    }
    const it = matches[0] as MovableItem;
    const v = coerce(it, d.value);
    const now = it.read(wh);
    if (v === undefined) return { ...base, label: it.label, from: it.text(now), to: short(unbox(d.value)), key: null, value: null, reason: "値の形がこの項目に合わないため、取り込みません" };
    const range = rangeOf(it);
    if (range !== null && typeof v === "string" && !rateInRange(v, range)) return { ...base, label: it.label, from: it.text(now), to: short(unbox(d.value)), key: null, value: null, reason: `入れてよい範囲（${rangeText(range)}）の外の値のため、取り込みません` };
    const out = it.phase === "field" ? null : leverOutOfRange(it, v, now);
    if (out !== null) return { ...base, label: it.label, from: it.text(now), to: short(unbox(d.value)), key: null, value: null, reason: out };
    return { ...base, label: it.label, from: it.text(now), to: it.text(v), key: it.key, value: v, reason: it.same(v, now) ? "今と同じ値です" : null };
  });
}

/** プランにする値（当てはまり、今と違うものだけ） */
export function candidateValues(rows: readonly CandidateRow[]): Values {
  const out: Values = {};
  for (const r of rows) if (r.key !== null && r.reason === null) out[r.key] = r.value;
  return out;
}

/**
 * 動かす項目の、候補の書き方での対象（物・構成員の ID か "assumptions"）。この書き方で当てはめると、その項目自身に1つに決まるときだけ返す
 * （同じ入力項目ID・同じ対象の項目が2つ以上ある、同じ入力項目ID・同じ対象の対策の固定の項目に隠れる、などは null。一覧に出さない）
 */
export function candidateTargetOf(it: MovableItem, wh: WorkingHousehold, cat: Catalog): string | null {
  const r = readingsOf(cat, wh.request.input as unknown as Record<string, unknown>)(it.key);
  const tries: DiffTarget[] = [it.target, ...(r !== null && r.kind === "address" ? [r.address.target as DiffTarget] : [])];
  for (const t of tries) {
    const target = "plan" in t ? (t.plan === "assumptions" ? "assumptions" : null) : "object" in t ? t.object : t.member;
    if (target === null) continue;
    const matches = matchItems({ target: target === "assumptions" ? { plan: "assumptions" } : { object: target }, item: it.item }, wh, cat);
    if (matches.length === 1 && matches[0]?.key === it.key) return target;
  }
  return null;
}

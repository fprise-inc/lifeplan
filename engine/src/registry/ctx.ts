// 0006 の1: 部品が外の世界に触れる手段は ctx だけ。制度の値・丸め・呼び出しはここで根拠の記録に残る。
// 0005・0006 の追記（2回目の見直し）: 部品の呼び出しごとに「何を読み、どの部品をどの入力で呼んだか（依存）」を記録し、
// 案×想定・スライダーの1刻みのあいだで、依存が同じ呼び出しの結果を使い回す（依存の記録と使い回し。下の invoke）
import { EngineError } from "../errors.ts";
import { deepFreeze } from "../engine/freeze.ts";
import type { AnnualRow, CalcConventions, EngineInput, Flow, FlowsOutput } from "../engine/types.ts";
import { check, hasSchema } from "../io/validate.ts";
import { CONVENTIONS } from "../money/conventions.ts";
import { intToString, type Int } from "../money/integer.ts";
import {
  rate,
  rateAdd,
  rateCompare,
  rateDiv,
  rateFraction,
  rateMul,
  rateMulInt,
  ratePow,
  rateSub,
  rateToString,
  type Rate,
} from "../money/rate.ts";
import * as R from "../money/rounding.ts";
import type { Money, Yen } from "../money/yen.ts";
import {
  asBrackets,
  asCount,
  asGrades,
  asRate,
  asRoundingRule,
  asYen,
  type Bracket,
  type Grade,
  type Json,
  type Jurisdiction,
  type RegulationStore,
  type Selected,
} from "../regulation/reader.ts";
import { projectCollection, type ItemTable } from "./items.ts";
import { resolveAgeSwitch, type Age, type AgeSwitch } from "../time/ageSwitch.ts";
import { lookupFor, type LookupContext } from "../time/basis.ts";
import { formatYm, monthIndex, yearOf, type MonthIndex } from "../time/month.ts";
import type { Timepoint, TimeResolver } from "../time/timepoint.ts";
import type { Assembly, Impl } from "./assemble.ts";
import { rowAllowedInSlot, SLOTS } from "./slots.ts";
import { Frame, type Tracer } from "./trace.ts";
import { autoStarts, segmentKey, segmentsOf, type Segment, type SegmentOptions } from "./segments.ts";

export interface MoneyApi {
  mulRate(amount: Yen, r: Rate, roundingId: string): Yen;
  mulRatio(amount: Yen, num: Int, den: Int, roundingId: string): Yen;
  divInt(amount: Yen, k: number, roundingId: string): Yen;
  round(amount: Yen, roundingId: string): Yen;
  allocate(total: Yen, weights: readonly number[], roundingId: string, remainderTo: R.RemainderTo): Yen[];
  convert(m: Money, fxRate: Rate, roundingId: string): Yen;
}

export interface RateApi {
  readonly of: typeof rate;
  readonly add: typeof rateAdd;
  readonly sub: typeof rateSub;
  readonly mul: typeof rateMul;
  readonly mulInt: typeof rateMulInt;
  readonly div: typeof rateDiv;
  readonly pow: typeof ratePow;
  readonly compare: typeof rateCompare;
  readonly toString: typeof rateToString;
  readonly fraction: typeof rateFraction;
}

export interface ParamOptions {
  /** 条件 birthDate・basis birthDate の値を選ぶ構成員 */
  readonly member?: string;
  /** basis anchor の値を選ぶ出来事（名前つきイベントのID） */
  readonly anchorEvent?: string;
  /** 全国以外の管轄の値（協会けんぽの支部など。0007 の6） */
  readonly jurisdiction?: Jurisdiction;
}

/** 「いま計算している月」に結び付けた制度の値と丸め（0003 の9）。区間（ctx.segments）の at も同じ形 */
export interface MonthCtx {
  readonly month: MonthIndex;
  param(id: string, opts?: ParamOptions): Selected;
  paramYen(id: string, opts?: ParamOptions): Yen | null;
  paramRate(id: string, opts?: ParamOptions): Rate | null;
  paramBrackets(id: string, opts?: ParamOptions): readonly Bracket[] | null;
  paramGrades(id: string, opts?: ParamOptions): readonly Grade[] | null;
  paramCount(id: string, opts?: ParamOptions): number | null;
  /** 延長の仮定を使わずに、その月の値（行）があるか。根拠の記録には残さない（改定率のように前提で延ばす値のため） */
  has(id: string, opts?: ParamOptions): boolean;
  readonly money: MoneyApi;
}

export interface TimeApi {
  /** 計算基準月と表の最後の月 */
  readonly base: MonthIndex;
  readonly end: MonthIndex;
  resolve(tp: Timepoint): MonthIndex;
  ageSwitch(member: string, age: Age, rule: AgeSwitch): MonthIndex;
}

export interface Ctx {
  call<O = unknown>(id: string, input: unknown): O;
  /**
   * 部品を呼び、出力の field（月の昇順の並び。要素は支払月 ym か月 month の欄を持つ）のうち from〜to の月の分だけを返す（0006 の追記）。
   * 依存はその月の分だけになり、ほかの月の値が変わっても、この部品は計算し直さない（年ごとの部品が、全期間の出力の1年分を読むとき）
   */
  callMonths<T extends { readonly ym: string } | { readonly month: string }>(id: string, input: unknown, field: string, from: MonthIndex, to: MonthIndex): readonly T[];
  slot(id: string, input: unknown): FlowsOutput[];
  /** 物の集まり（member・employment など）を、マニフェストの reads に書いた入力項目だけに絞って返す（0016 の5）。memberScope の集まりは入力の member の物だけ */
  list<T = Record<string, unknown>>(collection: string): readonly T[];
  get<T = Record<string, unknown>>(collection: string, object: string): T;
  /** 前提条件の、その年の値。reads に assumptions.<名前> が要る。入力に無い前提は fallback（無ければエラー） */
  assumption(name: string, year: number, fallback?: Rate): Rate;
  /** 計算に反映していないこと（未対応の制度など）の知らせ。見出しの notices に ID だけで残す */
  notice(code: string, ids: readonly string[]): void;
  at(month: MonthIndex): MonthCtx;
  /**
   * 区間ごとの計算（0006 の追記）: from〜to を、指定した制度の値（params）が同じ行で、breaks・every の変わり目をまたがない区間に分ける。
   * 区間の at は区間のどの月でも同じ値を返す（params に書いた値だけを読める）。月ごとの計算を区間ごとに1回にする
   */
  segments(from: MonthIndex, to: MonthIndex, opts: SegmentOptions): readonly Segment[];
  readonly conventions: CalcConventions;
  readonly money: MoneyApi;
  readonly rate: RateApi;
  readonly time: TimeApi;
}

/** 部品の結果の値。同じ値なら同じ物を使い、依存の比べ方は物の同一性で行う（早い打ち切り） */
export interface Cell {
  readonly output: unknown;
}

/**
 * 呼び出し自身が残したこと（memo のとき）のうち、順番に依らないもの: 延長の仮定で使った値の行と年の範囲、後の版の値の知らせ。
 * ctx.notice の知らせは、依存と同じ列に読んだ順で入れる（見出しの知らせを、1件ずつ計算したときと同じ順で集めるため）
 */
export interface Own {
  readonly extended: Map<string, { first: number; last: number }>;
  readonly notices: Map<string, { readonly code: string; readonly ids: readonly string[] }>;
}

/** 呼び出しの鍵（部品の実体と入力）。組の中で1つにする（同じ部品・同じ入力なら同じ物）。使い回しの候補（新しい順）もここに持つ */
export interface CallKey {
  readonly impl: Impl;
  /** 最初に見た入力（同じ鍵の入力は JSON として同じ値） */
  readonly input: unknown;
  variants: Variant[];
  /** この要求（epoch）の結果。要求ごとの表を引かずに、鍵に置く */
  epoch: number;
  res: Res | null;
  /** 枠（lane）ごとの、前の計算の候補（まず、その候補を確かめる） */
  prevs: (Variant | undefined)[];
}

/** 呼び出しの鍵の表（部品の実体ごとの、入力の欄の木と JSON の表）と、作った鍵の一覧（使わない候補を捨てるため） */
export interface KeyTable {
  readonly trees: Map<Impl, Map<unknown, unknown>>;
  readonly byJson: Map<Impl, Map<string, CallKey>>;
  readonly all: CallKey[];
}

export const newKeyTable = (): KeyTable => ({ trees: new Map(), byJson: new Map(), all: [] });

/** 1回の計算（要求）の中の、部品の呼び出しの結果。依存の記録にもこれを使う（鍵で同じ呼び出しを作り直せる） */
export interface Res {
  readonly ck: CallKey;
  readonly impl: Impl;
  readonly input: unknown;
  readonly output: unknown;
  readonly node: number;
  /** 使い回しのとき（組があるとき）だけ */
  readonly cell: Cell | null;
  readonly closure: Closure | null;
  readonly variant: Variant | null;
}

/** 入力への依存（集まりの写し・1つの物・前提）。値は JSON の文字列で比べる */
export interface InputDep {
  readonly t: 0 | 1 | 2;
  readonly key: string;
  readonly value: string;
  readonly impl: Impl;
  /** t=0・1: 集まり、t=2: 前提の名前 */
  readonly name: string;
  /** memberScope の構成員（t=0・1）、物のID（t=1） */
  readonly member: string | null;
  readonly object: string | null;
}

/** 組（Partition）の中で1つにした入力への依存（同じ鍵・同じ値なら同じ物）。n は通し番号 */
export interface CanonDep extends InputDep {
  readonly n: number;
  /** この依存だけの集まり（作ったら覚えておく） */
  single?: Closure;
  /** この要求（epoch）で確かめた結果 */
  epoch: number;
  ok: boolean;
}

/** ctx.notice の知らせ（依存の列の中で、出した順に持つ） */
export interface NoticeDep {
  readonly t: 3;
  readonly key: string;
  readonly notice: { readonly code: string; readonly ids: readonly string[] };
}

/** 部品の出力の一部（月の範囲）への依存（ctx.callMonths）。呼んだ部品の結果が変わっても、その範囲が同じなら同じ */
export interface PartDep {
  readonly t: 4;
  readonly res: Res;
  readonly field: string;
  readonly from: string;
  readonly to: string;
  readonly items: readonly unknown[];
}

export type Dep = CanonDep | NoticeDep | PartDep | Res;

/**
 * 呼び出しが（内側の呼び出しを含めて）読んだ入力への依存の集まり。組の中で1つにする（同じ中身なら同じ物）。
 * これに入る入力の値がすべて同じ要求なら、その呼び出しは内側をたどらずに同じ結果だとわかる（速い確かめ）
 */
export interface Closure {
  readonly ids: readonly number[];
  readonly deps: readonly CanonDep[];
  readonly unions: Map<Closure, Closure>;
  /** この要求（epoch）で確かめた結果 */
  epoch: number;
  ok: boolean;
}

/** 使い回しの候補: その呼び出しの依存（読んだ順）、読んだ入力の集まり、値、自身が残したこと */
export interface Variant {
  readonly deps: readonly Dep[];
  readonly closure: Closure;
  readonly cell: Cell;
  readonly own: Own | null;
  /** 知らせを集めるときにたどった印 */
  mark: number;
}

/** 要求の組（計算基準月・データの組・構成員の生年月などが同じ要求）で共有するもの */
export interface Partition {
  readonly keys: KeyTable;
  readonly params: ParamCache;
  readonly canon: Map<string, Map<string, CanonDep>>;
  readonly closures: Map<string, Closure>;
  readonly empty: Closure;
  next: number;
}

export function newPartition(): Partition {
  const empty: Closure = { ids: [], deps: [], unions: new Map(), epoch: 0, ok: true };
  return { keys: newKeyTable(), params: { params: new Map(), has: new Map() }, canon: new Map(), closures: new Map([["", empty]]), empty, next: 0 };
}

function internClosure(p: Partition, ids: readonly number[], deps: readonly CanonDep[]): Closure {
  const key = ids.join(",");
  let c = p.closures.get(key);
  if (c === undefined) {
    c = { ids, deps, unions: new Map(), epoch: 0, ok: false };
    p.closures.set(key, c);
  }
  return c;
}

/** 2つの集まりを合わせた集まり（合わせた結果は覚えておく） */
function unionClosure(p: Partition, a: Closure, b: Closure): Closure {
  if (a === b || b.ids.length === 0) return a;
  if (a.ids.length === 0) return b;
  const hit = a.unions.get(b);
  if (hit !== undefined) return hit;
  const ids: number[] = [];
  const deps: CanonDep[] = [];
  let i = 0;
  let j = 0;
  while (i < a.ids.length || j < b.ids.length) {
    const x = i < a.ids.length ? (a.ids[i] as number) : Infinity;
    const y = j < b.ids.length ? (b.ids[j] as number) : Infinity;
    if (x <= y) {
      ids.push(x);
      deps.push(a.deps[i] as CanonDep);
      i++;
      if (x === y) j++;
    } else {
      ids.push(y);
      deps.push(b.deps[j] as CanonDep);
      j++;
    }
  }
  const c = ids.length === a.ids.length ? a : ids.length === b.ids.length ? b : internClosure(p, ids, deps);
  a.unions.set(b, c);
  return c;
}

function singleClosure(p: Partition, d: CanonDep): Closure {
  d.single ??= internClosure(p, [d.n], [d]);
  return d.single;
}

function canonDep(p: Partition, d: InputDep): CanonDep {
  let byValue = p.canon.get(d.key);
  if (byValue === undefined) {
    byValue = new Map();
    p.canon.set(d.key, byValue);
  }
  let c = byValue.get(d.value);
  if (c === undefined) {
    c = { ...d, n: p.next++, epoch: 0, ok: false };
    byValue.set(d.value, c);
  }
  return c;
}

/** 1つの鍵に持つ候補の数の上限（超えたら古いものから捨てる。結果は同じで、計算し直すだけ） */
const VARIANTS_PER_KEY = 24;
/** 読んだ入力の集まりで速く確かめる候補の数（同じ枠の前の候補のほかに、新しいものから） */
const FAST = 6;
/** 速い確かめで当たらなかったとき、依存をたどって確かめる候補の数（同じ枠の前の候補のほかに、新しいものから） */
const WALKS = 1;
/** 早い打ち切りで、同じ値か比べる前の結果の数（同じ鍵の候補が持つ、値の違う結果。新しいものから） */
const CELLS = 6;

/** 制度の値を引いた結果の使い回し（計算基準月・データの組・構成員の生年月などが同じ要求のあいだで共有） */
export interface ParamCache {
  readonly params: Map<string, Map<number, Selected>>;
  readonly has: Map<string, Map<number, boolean>>;
}

export interface RunState {
  readonly assembly: Assembly;
  readonly store: RegulationStore;
  readonly tracer: Tracer;
  readonly time: TimeResolver;
  readonly input: EngineInput;
  readonly items: ItemTable;
  /** 部品ごと・集まりごと（・構成員ごと）の絞った写し（1回の計算の中で使い回す） */
  readonly projections: Map<string, readonly Record<string, unknown>[]>;
  readonly notices: Map<string, { readonly code: string; readonly ids: readonly string[] }>;
  /** 延長の仮定で使った値の行（<値ID>@<rev>）→ 使った年の範囲（見出しの notices に出す。0007 の追記） */
  readonly extended: Map<string, { first: number; last: number }>;
  readonly checkInternal: boolean;
  readonly base: MonthIndex;
  readonly end: MonthIndex;
  /** 呼び出しの鍵の表（組があれば組のもの）と、この要求の結果（1回の計算の中で使い回す） */
  readonly keys: KeyTable;
  /** この要求の番号（鍵・集まり・依存に置いた、この要求の結果の印） */
  readonly epoch: number;
  /** この要求で求めた結果（鍵の順） */
  readonly resolved: Res[];
  /** お金の動き（オブジェクト）→ それを作った call の記録の番号（full のとき） */
  readonly provenance: Map<object, number>;
  readonly stack: string[];
  readonly paramCache: ParamCache;
  /** 要求のあいだの使い回し（根拠の記録なしのときだけ）。候補は呼び出しの鍵に持つ */
  readonly partition?: Partition;
  /** 部品の入力への依存（t ごと: 集まり・物・前提）→ この要求の値で1つにしたもの */
  readonly depCache?: readonly [Map<Impl, Map<string, CanonDep>>, Map<Impl, Map<string, CanonDep>>, Map<Impl, Map<string, CanonDep>>];
  /** 枠（案×想定）の番号。同じ枠の前の計算の候補を、鍵の prevs のこの位置に置く（-1 は無し） */
  readonly lane: number;
  /** 入力への依存の値（鍵 → JSON。1回の計算の中で使い回す） */
  readonly inputs: Map<string, string>;
}

const RATE_API: RateApi = Object.freeze({
  of: rate,
  add: rateAdd,
  sub: rateSub,
  mul: rateMul,
  mulInt: rateMulInt,
  div: rateDiv,
  pow: ratePow,
  compare: rateCompare,
  toString: rateToString,
  fraction: rateFraction,
});

function mergeExtended(to: Map<string, { first: number; last: number }>, ref: string, first: number, last: number): void {
  const r = to.get(ref);
  if (r === undefined) to.set(ref, { first, last });
  else {
    if (first < r.first) r.first = first;
    if (last > r.last) r.last = last;
  }
}

/** 候補とその内側が残したこと（知らせは最初に残った順） */
interface Summary {
  readonly notices: Map<string, { readonly code: string; readonly ids: readonly string[] }>;
  readonly extended: Map<string, { first: number; last: number }>;
}

/** 依存の多い候補（構成員ごとのお金の動きを集める部品など）は、内側が残したことをまとめて覚えておく（要求のたびに内側をたどらない） */
const BIG = 64;
const SUMMARIES = new WeakMap<Variant, Summary>();
/** たどった印の通し番号（たどるたびに新しくする） */
let MARK = 0;

/** v とその内側が残したことを、最初に残った順に to へ足す（seen はたどった候補） */
function gather(to: Summary, v: Variant, mark: number): void {
  if (v.mark === mark) return;
  v.mark = mark;
  if (v.deps.length >= BIG && to !== SUMMARIES.get(v)) {
    let sum = SUMMARIES.get(v);
    if (sum === undefined) {
      sum = { notices: new Map(), extended: new Map() };
      SUMMARIES.set(v, sum);
      gather(sum, v, ++MARK);
    }
    for (const [k, n] of sum.notices) if (!to.notices.has(k)) to.notices.set(k, n);
    for (const [ref, r] of sum.extended) mergeExtended(to.extended, ref, r.first, r.last);
    return;
  }
  for (const d of v.deps) {
    if (!("t" in d)) {
      if (d.variant !== null) gather(to, d.variant, mark);
    } else if (d.t === 4) {
      if (d.res.variant !== null) gather(to, d.res.variant, mark);
    } else if (d.t === 3 && !to.notices.has(d.key)) to.notices.set(d.key, d.notice);
  }
  if (v.own !== null) {
    for (const [k, n] of v.own.notices) if (!to.notices.has(k)) to.notices.set(k, n);
    for (const [ref, r] of v.own.extended) mergeExtended(to.extended, ref, r.first, r.last);
  }
}

/**
 * 組があるとき、要求の見出しの知らせ・延長の仮定の記録を、根の結果から依存をたどって集める（呼び出しが最初に起きた順。
 * 1件ずつ計算したときに知らせが残る順と同じ）。使い回した結果も、その計算が残したことを同じように残す
 */
export function collectEffects(state: RunState, root: Res): void {
  if (root.variant === null) return;
  gather({ notices: state.notices, extended: state.extended }, root.variant, ++MARK);
}


/** JSON として同じ値か（部品の出力の比べ方。早い打ち切り） */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    const k = ka[i] as string;
    if (k !== kb[i]) return false;
    if (!sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** 月の並びの要素の月の欄（支払月 ym か、月 month） */
type MonthItem = { readonly ym: string } | { readonly month: string };
const monthKeyOf = (x: MonthItem): string => ("ym" in x ? x.ym : x.month);

/** 出力の field（月の昇順の並び。要素は ym か month の欄を持つ）のうち from〜to（"YYYY-MM"。両端を含む）の月の分（二分探索） */
function monthsOf(output: unknown, field: string, from: string, to: string): readonly MonthItem[] {
  const xs = (output as Record<string, unknown> | null)?.[field];
  if (!Array.isArray(xs)) throw new EngineError("E_ARGUMENT", ["callMonths", field]);
  const list = xs as readonly MonthItem[];
  const bound = (key: string, strict: boolean): number => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const m = monthKeyOf(list[mid] as MonthItem);
      if (strict ? m <= key : m < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return list.slice(bound(from, false), bound(to, true));
}

/** 根拠の記録なしのときの Frame（記録には使わない） */
const NO_FRAME = new Frame("-");

/** 鍵の木の葉の印 */
const LEAF = Symbol("leaf");

/**
 * 呼び出しの鍵（部品の実体と入力）を引く。入力の欄の名前と値の木をたどる（欄の値が数・文字列・真偽・null の入力。鍵の文字列を作らない）。
 * それ以外の入力は JSON の文字列で引く。組（Partition）があれば組の中で共有する（同じ部品・同じ入力なら、どの要求でも同じ鍵）
 */
function callKeyOf(keys: KeyTable, impl: Impl, input: unknown): CallKey {
  let tree = keys.trees.get(impl);
  if (tree === undefined) {
    tree = new Map();
    keys.trees.set(impl, tree);
  }
  let node: Map<unknown, unknown> | null = tree;
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    for (const k in o) {
      const v = o[k];
      if (v === undefined) continue;
      if (typeof v !== "number" && typeof v !== "string" && typeof v !== "boolean" && v !== null) {
        node = null;
        break;
      }
      let a = node.get(k) as Map<unknown, unknown> | undefined;
      if (a === undefined) {
        a = new Map();
        node.set(k, a);
      }
      let b = a.get(v) as Map<unknown, unknown> | undefined;
      if (b === undefined) {
        b = new Map();
        a.set(v, b);
      }
      node = b;
    }
  } else node = null;
  if (node !== null) {
    let ck = node.get(LEAF) as CallKey | undefined;
    if (ck === undefined) {
      ck = { impl, input, variants: [], epoch: 0, res: null, prevs: [] };
      node.set(LEAF, ck);
      keys.all.push(ck);
    }
    return ck;
  }
  let byJson = keys.byJson.get(impl);
  if (byJson === undefined) {
    byJson = new Map();
    keys.byJson.set(impl, byJson);
  }
  const key = JSON.stringify(input) ?? "undefined";
  let ck = byJson.get(key);
  if (ck === undefined) {
    ck = { impl, input, variants: [], epoch: 0, res: null, prevs: [] };
    byJson.set(key, ck);
    keys.all.push(ck);
  }
  return ck;
}

/**
 * 部品を1回呼ぶ。1回の計算の中では「部品＋入力」（呼び出しの鍵）で結果を使い回す（部品は純粋な関数）。
 * 組があるとき（要求のあいだの使い回し）は、同じ鍵の前の結果のうち、依存（読んだ入力の値と、呼んだ部品の結果）が
 * この要求でも同じものを使う。まず読んだ入力の集まり（内側を含む）で速く確かめ、当たらなければ依存を読んだ順にたどる
 * （前の依存が同じなら、部品は同じ順に同じものを読むので、次の依存も同じ物を指す）
 */
export function invoke(state: RunState, impl: Impl, input: unknown): Res {
  const ck = callKeyOf(state.keys, impl, input);
  return ck.epoch === state.epoch ? (ck.res as Res) : resolve(state, ck, input);
}

let EPOCH = 0;
/** 要求の番号を新しく取る */
export function nextEpoch(): number {
  return ++EPOCH;
}

/** 要求で求めた結果を、枠の前の計算の候補にする */
export function keepLane(state: RunState): void {
  if (state.lane < 0) return;
  for (const r of state.resolved) if (r.variant !== null) r.ck.prevs[state.lane] = r.variant;
}

function setResult(state: RunState, ck: CallKey, r: Res): void {
  ck.epoch = state.epoch;
  ck.res = r;
  state.resolved.push(r);
}

/** 呼び出しの鍵で、この要求の結果を引く（無ければ求める） */
function lookup(state: RunState, ck: CallKey): Res {
  return ck.epoch === state.epoch ? (ck.res as Res) : resolve(state, ck, ck.input);
}

function resolve(state: RunState, ck: CallKey, input: unknown): Res {
  const impl = ck.impl;
  const id = impl.def.id;
  if (state.stack.includes(id)) throw new EngineError("E_COMPONENT_CYCLE", [...state.stack, id]);
  const sharing = state.partition !== undefined;
  const variants = ck.variants;
  const prev = sharing && state.lane >= 0 ? (ck.prevs[state.lane] ?? null) : null;
  if (sharing) {
    let found: Variant | null = null;
    if (prev !== null && closureValid(state, prev.closure)) found = prev;
    for (let i = 0; i < variants.length && i < FAST && found === null; i++) if (closureValid(state, (variants[i] as Variant).closure)) found = variants[i] as Variant;
    if (found === null) {
      // 依存をたどる: 同じ枠の前の候補と、新しい候補をいくつか
      let walked = 0;
      for (let i = -1; i < variants.length && walked <= WALKS && found === null; i++) {
        const v = i < 0 ? prev : (variants[i] as Variant);
        if (v === null || (i >= 0 && v === prev)) continue;
        walked++;
        const w = verify(state, v);
        if (w === null) continue;
        // たどって同じとわかった候補は、この要求の依存と読んだ入力の集まりで作り直す（内側の結果は同じ値でも、読んだ入力が違うことがある。
        // 次からはこの要求の形の候補が速い確かめで当たる）
        found = w.closure === v.closure ? v : { deps: w.deps, closure: w.closure, cell: v.cell, own: v.own, mark: 0 };
        if (found !== v) addVariant(ck, found);
      }
    }
    if (found !== null) {
      const r: Res = { ck, impl, input, output: found.cell.output, node: -1, cell: found.cell, closure: found.closure, variant: found };
      setResult(state, ck, r);
      return r;
    }
  }
  // 0006 の5: 公式部品どうしは CI とテストでだけ、差し替え・追加は常に検査する
  const validate = state.checkInternal || impl.origin !== "official";
  if (validate && hasSchema(impl.def.input)) check(impl.def.input, input, "E_COMPONENT_SCHEMA", [id, "input"]);
  if (validate && !hasSchema(impl.def.input)) throw new EngineError("E_COMPONENT_SCHEMA", [id, "input.schema"]);
  // 根拠の記録なしのときは、呼び出しの記録（Frame）を使わないので作らない
  const frame = state.tracer.on ? new Frame(id) : NO_FRAME;
  state.stack.push(id);
  const deps: Dep[] | null = sharing ? [] : null;
  const ctx = new CtxImpl(state, impl, frame, input, deps);
  let output: unknown;
  try {
    output = impl.def.compute(input, ctx);
  } finally {
    state.stack.pop();
  }
  // 出力は使い回すので、書き換えられないように凍結する。公式部品どうしは CI とテスト（checkInternal）でだけ凍結し
  // （書き換える部品があればそこで例外になる）、製品では速さのため省く（入出力の検査と同じ扱い。0006 の5・追記）
  if (validate) deepFreeze(output);
  if (validate) check(impl.def.output, output, "E_COMPONENT_SCHEMA", [id, "output"]);
  const o = output as { flows?: readonly Flow[]; annual?: readonly AnnualRow[] } | null;
  const flows = o?.flows ?? [];
  const annual = o?.annual ?? [];
  for (let i = 0; i < flows.length; i++) if (typeof (flows[i] as Flow).formula !== "string") throw new EngineError("E_FORMULA_MISSING", [id]);
  for (let i = 0; i < annual.length; i++) if (typeof (annual[i] as AnnualRow).formula !== "string") throw new EngineError("E_FORMULA_MISSING", [id]);
  if (state.tracer.on) state.tracer.formulas(id, [...flows, ...annual].map((f) => f.formula));
  const node = state.tracer.finishCall(frame);
  if (state.tracer.mode === "full") {
    // 最も内側で作った部品を、そのお金の動きの出どころにする
    for (const f of [...flows, ...annual]) if (!state.provenance.has(f)) state.provenance.set(f, node);
  }
  let cell: Cell | null = null;
  let variant: Variant | null = null;
  const closure = deps === null ? null : ctx.closureOf();
  if (deps !== null && closure !== null) {
    // 早い打ち切り: 前の結果（同じ枠の前の結果と、新しい候補）と同じ値なら同じ物にする（この部品を呼ぶ部品は、依存が変わらないので計算し直さない）
    // 値の同じ結果は鍵ごとに1つの物にする（ほかの想定・案で同じ値になった結果とも同じ物になり、下流が想定をまたいで使い回せる）
    if (prev !== null && sameJson(prev.cell.output, output)) cell = prev.cell;
    for (let i = 0, n = 0, last: Cell | null = prev?.cell ?? null; cell === null && i < variants.length && n < CELLS; i++) {
      const c = (variants[i] as Variant).cell;
      if (c === last || (prev !== null && c === prev.cell)) continue;
      last = c;
      n++;
      if (sameJson(c.output, output)) cell = c;
    }
    cell ??= { output };
    variant = { deps, closure, cell, own: ctx.ownOf(), mark: 0 };
    addVariant(ck, variant);
  }
  const r: Res = { ck, impl, input, output: cell === null ? output : cell.output, node, cell, closure, variant };
  setResult(state, ck, r);
  return r;
}

/** 候補を鍵の先頭に足す（上限を超えたら古いものから捨てる） */
function addVariant(ck: CallKey, v: Variant): void {
  ck.variants.unshift(v);
  if (ck.variants.length > VARIANTS_PER_KEY) ck.variants.length = VARIANTS_PER_KEY;
}

/** 読んだ入力の集まりの値が、この要求でもすべて同じか（集まりごとに1回だけ確かめる） */
function closureValid(state: RunState, c: Closure): boolean {
  if (c.epoch === state.epoch) return c.ok;
  let ok = true;
  for (const d of c.deps) {
    if (!depValid(state, d)) {
      ok = false;
      break;
    }
  }
  c.epoch = state.epoch;
  c.ok = ok;
  return ok;
}

/**
 * 候補の依存が、この要求でも同じか（読んだ順に確かめ、違えばそこで止める）。呼んだ部品の結果はこの要求で求める
 * （この候補の前の依存が同じなので、部品は実際にこの呼び出しをする）。
 * 同じなら、この要求での依存（呼び出しはこの要求の結果）と読んだ入力の集まりを返す
 */
function verify(state: RunState, v: Variant): { deps: Dep[]; closure: Closure } | null {
  const deps = v.deps;
  // 1回目: 確かめるだけ（違えばすぐ止める）
  for (let i = 0; i < deps.length; i++) {
    const d = deps[i] as Dep;
    if ("t" in d) {
      if (d.t === 4) {
        const r = lookup(state, d.res.ck);
        if (r.cell !== d.res.cell && !sameJson(monthsOf(r.output, d.field, d.from, d.to), d.items)) return null;
      } else if (d.t !== 3 && !depValid(state, d)) return null;
      continue;
    }
    if (lookup(state, d.ck).cell !== d.cell) return null;
  }
  // 2回目: この要求での依存と読んだ入力の集まり（呼び出しはこの要求の結果の表から引くだけ）
  const p = state.partition as Partition;
  const out: Dep[] = [];
  let closure = p.empty;
  for (let i = 0; i < deps.length; i++) {
    const d = deps[i] as Dep;
    if ("t" in d) {
      if (d.t === 4) {
        const r = lookup(state, d.res.ck);
        out.push(r === d.res ? d : { t: 4, res: r, field: d.field, from: d.from, to: d.to, items: d.items });
        closure = unionClosure(p, closure, r.closure as Closure);
        continue;
      }
      if (d.t !== 3) closure = unionClosure(p, closure, singleClosure(p, d));
      out.push(d);
      continue;
    }
    const r = lookup(state, d.ck);
    out.push(r);
    closure = unionClosure(p, closure, r.closure as Closure);
  }
  return { deps: out, closure };
}

/** 1つの入力への依存の値が、この要求でも同じか（依存ごとに1回だけ比べる） */
function depValid(state: RunState, d: CanonDep): boolean {
  if (d.epoch === state.epoch) return d.ok;
  const ok = inputValue(state, d) === d.value;
  d.epoch = state.epoch;
  d.ok = ok;
  return ok;
}

/** 部品の入力への依存（集まり・物・前提）を、この要求の値で1つにしたもの（要求の中で覚えておく） */
function canonInput(state: RunState, impl: Impl, t: 0 | 1 | 2, name: string, member: string | null, object: string | null): CanonDep {
  const table = state.depCache as [Map<Impl, Map<string, CanonDep>>, Map<Impl, Map<string, CanonDep>>, Map<Impl, Map<string, CanonDep>>];
  let byImpl = table[t].get(impl);
  if (byImpl === undefined) {
    byImpl = new Map();
    table[t].set(impl, byImpl);
  }
  const sub = member === null && object === null ? name : `${name}\u0000${member ?? ""}\u0000${object ?? ""}`;
  let c = byImpl.get(sub);
  if (c === undefined) {
    const key = `${t}\u0000${impl.def.id}\u0000${name}\u0000${member ?? ""}\u0000${object ?? ""}`;
    const d = { t, key, impl, name, member, object };
    c = canonDep(state.partition as Partition, { ...d, value: inputValue(state, d) });
    byImpl.set(sub, c);
  }
  return c;
}

/** 入力への依存の、この要求での値 */
function inputValue(state: RunState, d: Omit<InputDep, "value">): string {
  const hit = state.inputs.get(d.key);
  if (hit !== undefined) return hit;
  let v: string;
  if (d.t === 2) {
    const series = (state.input.assumptions as Readonly<Record<string, unknown>>)[d.name];
    v = series === undefined ? "-" : JSON.stringify(series);
  } else {
    const list = listOf(state, d.impl, d.name, d.member);
    if (d.t === 0) v = JSON.stringify(list);
    else {
      const found = list.find((o) => o.id === d.object);
      v = found === undefined ? "-" : JSON.stringify(found);
    }
  }
  state.inputs.set(d.key, v);
  return v;
}

// マニフェストの params・reads・memberScope の集合は部品ごとに1回だけ作る
interface ManifestSets {
  readonly params: ReadonlySet<string>;
  readonly reads: ReadonlySet<string>;
  readonly scope: ReadonlySet<string>;
}
const MANIFEST_SETS = new WeakMap<object, ManifestSets>();

function manifestSets(def: Impl["def"]): ManifestSets {
  let s = MANIFEST_SETS.get(def);
  if (s === undefined) {
    s = { params: new Set(def.params), reads: new Set(def.reads), scope: new Set(def.memberScope ?? []) };
    MANIFEST_SETS.set(def, s);
  }
  return s;
}

/** 部品が呼べる部品（requires に書いたもの）の実体。部品表と部品ごとに1回だけ作る */
const CALLEES = new WeakMap<Assembly, WeakMap<Impl, Map<string, Impl>>>();

function callees(assembly: Assembly, impl: Impl): Map<string, Impl> {
  let byImpl = CALLEES.get(assembly);
  if (byImpl === undefined) {
    byImpl = new WeakMap();
    CALLEES.set(assembly, byImpl);
  }
  let m = byImpl.get(impl);
  if (m === undefined) {
    m = new Map();
    for (const id of Object.keys(impl.def.requires)) {
      const t = assembly.impls.get(id);
      if (t !== undefined) m.set(id, t);
    }
    byImpl.set(impl, m);
  }
  return m;
}

/** 部品の reads に絞った集まりの写し（memberScope なら member の物だけ）。1回の計算の中で使い回す */
function listOf(state: RunState, impl: Impl, collection: string, member: string | null): readonly Record<string, unknown>[] {
  const def = impl.def;
  const key = `${def.id}\u0000${collection}\u0000${member ?? ""}`;
  const hit = state.projections.get(key);
  if (hit !== undefined) return hit;
  const out = deepFreeze(projectCollection(state.items, state.input as unknown as Record<string, unknown>, collection, manifestSets(def).reads, def.id, member));
  state.projections.set(key, out);
  return out;
}

/** 金額の関数（0002）。month が null なら規約（conv.*）の丸めだけを使える。速さのため月ごとに関数を作らずクラスにする（中身は # で隠す） */
class MoneyImpl implements MoneyApi {
  readonly #ctx: CtxImpl;
  readonly #mc: MonthCtx | null;
  constructor(ctx: CtxImpl, mc: MonthCtx | null) {
    this.#ctx = ctx;
    this.#mc = mc;

  }
  #rule(id: string): R.RoundingRule {
    if (id.startsWith("conv.")) {
      const r = CONVENTIONS[id];
      if (r === undefined) throw new EngineError("E_ROUNDING_UNKNOWN", [id]);
      return r;
    }
    // 制度の端数処理は制度の値なので、計算している月が要る
    if (this.#mc === null) throw new EngineError("E_ROUNDING_UNKNOWN", [id, "month"]);
    return asRoundingRule(this.#mc.param(id));
  }
  #done(id: string, op: string, r: R.Rounded): Yen {
    const tracer = this.#ctx.tracer;
    if (tracer.on) tracer.rounding(this.#ctx.frame, id, op, () => `${intToString(r.num)}/${intToString(r.den)}`, r.value);
    return r.value;
  }
  mulRate(a: Yen, r: Rate, id: string): Yen {
    return this.#done(id, "mulRate", R.mulRate(a, r, this.#rule(id)));
  }
  mulRatio(a: Yen, n: Int, d: Int, id: string): Yen {
    return this.#done(id, "mulRatio", R.mulRatio(a, n, d, this.#rule(id)));
  }
  divInt(a: Yen, k: number, id: string): Yen {
    return this.#done(id, "divInt", R.divInt(a, k, this.#rule(id)));
  }
  round(a: Yen, id: string): Yen {
    return this.#done(id, "round", R.round(a, this.#rule(id)));
  }
  convert(m: Money, fx: Rate, id: string): Yen {
    return this.#done(id, "convert", R.convert(m, fx, this.#rule(id)));
  }
  allocate(total: Yen, weights: readonly number[], id: string, to: R.RemainderTo): Yen[] {
    const out = R.allocate(total, weights, this.#rule(id), to);
    const tracer = this.#ctx.tracer;
    if (tracer.on) tracer.rounding(this.#ctx.frame, id, "allocate", () => `${total}|${weights.join(",")}|${String(to)}`, out);
    return out;
  }
}

/** 値の取り出し（MonthCtx と区間の at に共通） */
abstract class ParamReader {
  abstract param(id: string, opts?: ParamOptions): Selected;
  paramYen(id: string, opts?: ParamOptions): Yen | null {
    return asYen(this.param(id, opts));
  }
  paramRate(id: string, opts?: ParamOptions): Rate | null {
    return asRate(this.param(id, opts));
  }
  paramBrackets(id: string, opts?: ParamOptions): readonly Bracket[] | null {
    return asBrackets(this.param(id, opts));
  }
  paramGrades(id: string, opts?: ParamOptions): readonly Grade[] | null {
    return asGrades(this.param(id, opts));
  }
  paramCount(id: string, opts?: ParamOptions): number | null {
    return asCount(this.param(id, opts));
  }
}

const simpleOpts = (opts: ParamOptions | undefined): boolean =>
  opts === undefined || (opts.anchorEvent === undefined && (opts.jurisdiction === undefined || opts.jurisdiction === "national"));

/**
 * 「いま計算している月」に結び付けた制度の値と丸め（0003 の9）。この呼び出しのこの月の中では、同じ値（条件なし・構成員だけの条件）を
 * 引いた結果を使い回す。2回目以後の読み取りは根拠の記録・知らせ・延長の仮定の記録に何も足さない（同じ記録・同じ年）ので、引き直さなくても結果は同じ
 */
class MonthCtxImpl extends ParamReader implements MonthCtx {
  readonly month: MonthIndex;
  readonly money: MoneyApi;
  readonly #ctx: CtxImpl;
  readonly #local = new Map<string, Selected>();
  #hasLocal: Map<string, boolean> | null = null;
  constructor(ctx: CtxImpl, month: MonthIndex) {
    super();
    this.#ctx = ctx;
    this.month = month;
    this.money = new MoneyImpl(ctx, this);

  }
  param(id: string, opts?: ParamOptions): Selected {
    if (!simpleOpts(opts)) return this.#ctx.param(id, this.month, opts ?? {}, this.month);
    const key = opts?.member === undefined ? id : `${id}|${opts.member}`;
    const hit = this.#local.get(key);
    if (hit !== undefined) return hit;
    const s = this.#ctx.param(id, this.month, opts ?? {}, this.month);
    this.#local.set(key, s);
    return s;
  }
  has(id: string, opts?: ParamOptions): boolean {
    if (!simpleOpts(opts)) return this.#ctx.has(id, this.month, opts ?? {});
    const key = opts?.member === undefined ? id : `${id}|${opts.member}`;
    this.#hasLocal ??= new Map();
    const hit = this.#hasLocal.get(key);
    if (hit !== undefined) return hit;
    const v = this.#ctx.has(id, this.month, opts ?? {});
    this.#hasLocal.set(key, v);
    return v;
  }
}

/** 値の読み取りの鍵（値ID・構成員・出来事・管轄） */
const optsKey = (id: string, opts: ParamOptions | undefined): string => {
  if (opts === undefined) return id;
  const j = opts.jurisdiction;
  return `${id}|${opts.member ?? ""}|${opts.anchorEvent ?? ""}|${j === undefined || j === "national" ? "" : `${j.level}:${j.code}`}`;
};

/**
 * 区間の自動の使い回し（0006 の追記）: 部品のマニフェストの値すべての行が変わらない区間（from〜to）の中では、どの月で読んでも同じ行が選ばれ、
 * 延長の仮定の記録も同じ年になる。そこで ctx.at(m) は、同じ区間の月どうしで値の読み取りを共有する（読み取りは区間の最初の月で行い、
 * 延長の記録は区間の月の分を残す）。月ごとの文脈（MonthView）は月を持ち、読み取りだけをここに任せる
 */
class AutoAt {
  readonly #ctx: CtxImpl;
  readonly #from: MonthIndex;
  readonly #to: MonthIndex;
  readonly #local = new Map<string, Selected>();
  #hasLocal: Map<string, boolean> | null = null;
  constructor(ctx: CtxImpl, from: MonthIndex, to: MonthIndex) {
    this.#ctx = ctx;
    this.#from = from;
    this.#to = to;
  }
  param(id: string, opts: ParamOptions | undefined, month: MonthIndex): Selected {
    const key = optsKey(id, opts);
    let s = this.#local.get(key);
    if (s === undefined) {
      s = this.#ctx.param(id, this.#from, opts ?? {}, this.#to);
      this.#local.set(key, s);
    }
    this.#ctx.checkSame(id, opts ?? {}, month, s);
    return s;
  }
  has(id: string, opts: ParamOptions | undefined, month: MonthIndex): boolean {
    const key = optsKey(id, opts);
    this.#hasLocal ??= new Map();
    let v = this.#hasLocal.get(key);
    if (v === undefined) {
      v = this.#ctx.has(id, this.#from, opts ?? {});
      this.#hasLocal.set(key, v);
    }
    if (this.#ctx.checking && this.#ctx.has(id, month, opts ?? {}) !== v) throw new EngineError("E_ARGUMENT", [id, "segments.notConstant"]);
    return v;
  }
}

/** ctx.at(m) の月の文脈（区間の自動の使い回しの中の1か月） */
class MonthView extends ParamReader implements MonthCtx {
  readonly month: MonthIndex;
  readonly money: MoneyApi;
  readonly #shared: AutoAt;
  constructor(ctx: CtxImpl, month: MonthIndex, shared: AutoAt) {
    super();
    this.month = month;
    this.#shared = shared;
    this.money = new MoneyImpl(ctx, this);
  }
  param(id: string, opts?: ParamOptions): Selected {
    return this.#shared.param(id, opts, this.month);
  }
  has(id: string, opts?: ParamOptions): boolean {
    return this.#shared.has(id, opts, this.month);
  }
}

/** 部品ごとの、区間の自動の使い回しの区切り（データの組・計算の範囲ごとに1回だけ作る） */
interface AutoSegments {
  readonly from: MonthIndex;
  readonly to: MonthIndex;
  readonly starts: readonly number[];
}
const AUTO = new WeakMap<RegulationStore, Map<string, Map<Impl, AutoSegments>>>();
/** 1回の呼び出しで読んだ月がこの数を超えたら、区間の自動の使い回しにする */
const AUTO_AFTER = 24;

function autoSegmentsOf(state: RunState, impl: Impl): AutoSegments {
  let byRange = AUTO.get(state.store);
  if (byRange === undefined) {
    byRange = new Map();
    AUTO.set(state.store, byRange);
  }
  const from = monthIndex(yearOf(state.base) - 3, 1);
  const to = monthIndex(yearOf(state.end) + 3, 12);
  const rk = `${from}|${to}`;
  let byImpl = byRange.get(rk);
  if (byImpl === undefined) {
    byImpl = new Map();
    byRange.set(rk, byImpl);
  }
  let a = byImpl.get(impl);
  if (a === undefined) {
    a = { from, to, starts: autoStarts(state.store, impl.def.params, from, to) };
    byImpl.set(impl, a);
  }
  return a;
}

/**
 * 区間（from〜to）の値。区間のどの月でも同じ行が選ばれる値（segments の params）だけを読める。読み取りは区間の最初の月で行い、
 * 延長の仮定の記録は区間のすべての月の分（引く日の年の範囲）を残す（月ごとに読んだときと同じ記録）
 */
export class SegmentAt extends ParamReader implements MonthCtx {
  readonly month: MonthIndex;
  readonly money: MoneyApi;
  readonly #ctx: CtxImpl;
  readonly #to: MonthIndex;
  readonly #allowed: ReadonlySet<string>;
  readonly #local = new Map<string, Selected>();
  constructor(ctx: CtxImpl, from: MonthIndex, to: MonthIndex, allowed: ReadonlySet<string>) {
    super();
    this.#ctx = ctx;
    this.month = from;
    this.#to = to;
    this.#allowed = allowed;
    this.money = new MoneyImpl(ctx, this);

  }
  param(id: string, opts?: ParamOptions): Selected {
    const key = segmentKey(id, opts);
    if (opts?.anchorEvent !== undefined || !this.#allowed.has(key)) throw new EngineError("E_PARAM_UNDECLARED", [this.#ctx.id, id, "segment"]);
    const hit = this.#local.get(key);
    if (hit !== undefined) return hit;
    const s = this.#ctx.param(id, this.month, opts ?? {}, this.#to);
    this.#local.set(key, s);
    return s;
  }
  has(id: string, opts?: ParamOptions): boolean {
    const key = segmentKey(id, opts);
    if (opts?.anchorEvent !== undefined || !this.#allowed.has(key)) throw new EngineError("E_PARAM_UNDECLARED", [this.#ctx.id, id, "segment"]);
    return this.#ctx.has(id, this.month, opts ?? {});
  }
}

class TimeImpl implements TimeApi {
  readonly base: MonthIndex;
  readonly end: MonthIndex;
  readonly #ctx: CtxImpl;
  constructor(ctx: CtxImpl, state: RunState) {
    this.#ctx = ctx;
    this.base = state.base;
    this.end = state.end;

  }
  resolve(tp: Timepoint): MonthIndex {
    return this.#ctx.resolveTime(tp);
  }
  ageSwitch(member: string, age: Age, rule: AgeSwitch): MonthIndex {
    return this.#ctx.ageSwitchOf(member, age, rule);
  }
}

/** 形を確かめた知らせの符号（同じ符号を何度も確かめない） */
const NOTICE_CODES = new Set<string>();

/** 部品に渡す ctx（呼び出しごとに1つ）。状態は # で隠す */
class CtxImpl implements Ctx {
  readonly #state: RunState;
  readonly #impl: Impl;
  readonly #frame: Frame;
  readonly #input: unknown;
  /** 依存の記録（memo のときだけ）と、記録済みの鍵・結果 */
  readonly #deps: Dep[] | null;
  #seen: Set<unknown> | null = null;
  readonly #memo: boolean;
  readonly #sets: ManifestSets;
  #closure: Closure | null;
  #own: Own | null = null;
  #months: Map<MonthIndex, MonthCtx> | null = null;
  #autoAts: Map<number, AutoAt> | null = null;
  #money: MoneyImpl | null = null;
  #time: TimeImpl | null = null;

  constructor(state: RunState, impl: Impl, frame: Frame, input: unknown, deps: Dep[] | null) {
    this.#state = state;
    this.#impl = impl;
    this.#frame = frame;
    this.#input = input;
    this.#deps = deps;
    this.#memo = deps !== null;
    this.#sets = manifestSets(impl.def);
    this.#closure = deps === null ? null : (state.partition as Partition).empty;
  }

  /** この呼び出しが（内側を含めて）読んだ入力の集まり */
  closureOf(): Closure | null {
    return this.#closure;
  }

  /** この呼び出し自身が残したこと（memo のとき） */
  ownOf(): Own | null {
    return this.#own;
  }

  #ownEffects(): Own {
    this.#own ??= { extended: new Map(), notices: new Map() };
    return this.#own;
  }

  /** 延長の仮定で使った値の行と年の範囲（memo のときは呼び出し自身の記録に、そうでなければ要求の状態に） */
  #addExtended(ref: string, first: number, last: number): void {
    mergeExtended(this.#deps === null ? this.#state.extended : this.#ownEffects().extended, ref, first, last);
  }

  /** 知らせを残す（同じものは1回） */
  #addNotice(key: string, value: { readonly code: string; readonly ids: readonly string[] }, ordered: boolean): void {
    if (this.#deps === null) {
      if (!this.#state.notices.has(key)) this.#state.notices.set(key, value);
    } else if (ordered) this.#record({ t: 3, key, notice: value }, `n\u0000${key}`);
    else if (!this.#ownEffects().notices.has(key)) this.#ownEffects().notices.set(key, value);
  }

  get id(): string {
    return this.#impl.def.id;
  }
  get tracer(): Tracer {
    return this.#state.tracer;
  }
  get frame(): Frame {
    return this.#frame;
  }
  get conventions(): CalcConventions {
    return this.#state.input.calcConventions;
  }
  get money(): MoneyApi {
    this.#money ??= new MoneyImpl(this, null);
    return this.#money;
  }
  get rate(): RateApi {
    return RATE_API;
  }
  get time(): TimeApi {
    this.#time ??= new TimeImpl(this, this.#state);
    return this.#time;
  }

  #record(d: Dep, seenKey: unknown): void {
    if (!this.#memo) return;
    this.#seen ??= new Set();
    if (this.#seen.has(seenKey)) return;
    this.#seen.add(seenKey);
    (this.#deps as Dep[]).push(d);
  }

  #inputDep(t: 0 | 1 | 2, name: string, member: string | null, object: string | null): void {
    if (!this.#memo) return;
    const c = canonInput(this.#state, this.#impl, t, name, member, object);
    if (this.#seen?.has(c) === true) return;
    this.#record(c, c);
    this.#closure = unionClosure(this.#state.partition as Partition, this.#closure as Closure, singleClosure(this.#state.partition as Partition, c));
  }

  #callDep(r: Res): void {
    if (!this.#memo || this.#seen?.has(r) === true) return;
    this.#record(r, r);
    this.#closure = unionClosure(this.#state.partition as Partition, this.#closure as Closure, r.closure as Closure);
  }

  /** memberScope の集まりなら、入力の member */
  #scopeOf(collection: string): string | null {
    if (!this.#sets.scope.has(collection)) return null;
    const m = (this.#input as { member?: unknown } | null)?.member;
    if (typeof m !== "string") throw new EngineError("E_ARGUMENT", [this.#impl.def.id, "memberScope.member"]);
    return m;
  }

  call<O>(id: string, input: unknown): O {
    const target = callees(this.#state.assembly, this.#impl).get(id);
    if (target === undefined) {
      const def = this.#impl.def;
      if (def.requires[id] === undefined) throw new EngineError("E_CALL_UNDECLARED", [def.id, id]);
      throw new EngineError("E_COMPONENT_UNKNOWN", [id]);
    }
    const r = invoke(this.#state, target, input);
    if (r.node >= 0) this.#frame.uses.add(r.node);
    this.#callDep(r);
    return r.output as O;
  }

  callMonths<T extends MonthItem>(id: string, input: unknown, field: string, from: MonthIndex, to: MonthIndex): readonly T[] {
    const target = callees(this.#state.assembly, this.#impl).get(id);
    if (target === undefined) {
      const def = this.#impl.def;
      if (def.requires[id] === undefined) throw new EngineError("E_CALL_UNDECLARED", [def.id, id]);
      throw new EngineError("E_COMPONENT_UNKNOWN", [id]);
    }
    const r = invoke(this.#state, target, input);
    if (r.node >= 0) this.#frame.uses.add(r.node);
    const f = formatYm(from);
    const t = formatYm(to);
    if (this.#state.checkInternal) {
      const xs = (r.output as Record<string, unknown> | null)?.[field];
      if (Array.isArray(xs)) for (let i = 1; i < xs.length; i++) if (monthKeyOf(xs[i - 1] as MonthItem) > monthKeyOf(xs[i] as MonthItem)) throw new EngineError("E_ARGUMENT", [id, field, "order"]);
    }
    const items = monthsOf(r.output, field, f, t) as readonly T[];
    if (this.#memo && this.#seen?.has(r) !== true) {
      (this.#deps as Dep[]).push({ t: 4, res: r, field, from: f, to: t, items });
      this.#closure = unionClosure(this.#state.partition as Partition, this.#closure as Closure, r.closure as Closure);
    }
    return items;
  }

  slot(id: string, input: unknown): FlowsOutput[] {
    const def = this.#impl.def;
    const state = this.#state;
    if (!(def.slots ?? []).includes(id)) throw new EngineError("E_CALL_UNDECLARED", [def.id, id]);
    const slot = SLOTS.get(id);
    if (slot === undefined) throw new EngineError("E_SLOT_UNKNOWN", [id]);
    if (slot.input !== null) check(slot.input, input, "E_COMPONENT_SCHEMA", [id, "input"]);
    const outs: FlowsOutput[] = [];
    for (const ext of state.assembly.extensions.get(id) ?? []) {
      const r = invoke(state, ext, input);
      if (slot.output !== null) check(slot.output, r.output, "E_COMPONENT_SCHEMA", [ext.def.id, "output"]);
      const out = r.output as FlowsOutput;
      for (const f of out.flows) if (!rowAllowedInSlot(slot, f.row)) throw new EngineError("E_SLOT_ROW", [ext.def.id, f.row]);
      if (r.node >= 0) this.#frame.uses.add(r.node);
      this.#callDep(r);
      outs.push(out);
    }
    return outs;
  }

  list<T>(collection: string): readonly T[] {
    const member = this.#scopeOf(collection);
    const out = listOf(this.#state, this.#impl, collection, member);
    this.#inputDep(0, collection, member, null);
    const tracer = this.#state.tracer;
    if (tracer.mode === "full") for (const o of out) tracer.input(this.#frame, { collection }, o.id as string | undefined, () => o as Json);
    return out as unknown as readonly T[];
  }

  get<T>(collection: string, object: string): T {
    const member = this.#scopeOf(collection);
    const found = listOf(this.#state, this.#impl, collection, member).find((o) => o.id === object);
    this.#inputDep(1, collection, member, object);
    if (found === undefined) throw new EngineError("E_ARGUMENT", [collection, object]);
    this.#state.tracer.input(this.#frame, { collection }, object, () => found as Json);
    return found as unknown as T;
  }

  assumption(name: string, year: number, fallback?: Rate): Rate {
    const def = this.#impl.def;
    const item = `assumptions.${name}`;
    if (!this.#sets.reads.has(item)) throw new EngineError("E_READ_UNDECLARED", [def.id, item]);
    this.#inputDep(2, name, null, null);
    const series = (this.#state.input.assumptions as Readonly<Record<string, { default: string; byYear?: Record<string, string> } | undefined>>)[name];
    if (series === undefined) {
      if (fallback !== undefined) return fallback;
      throw new EngineError("E_ARGUMENT", [item]);
    }
    this.#state.tracer.input(this.#frame, { item }, undefined, () => series as unknown as Json);
    return rate(series.byYear?.[String(year)] ?? series.default);
  }

  notice(code: string, ids: readonly string[]): void {
    if (!NOTICE_CODES.has(code)) {
      if (!/^N_[A-Z_]+$/.test(code)) throw new EngineError("E_ARGUMENT", ["notice.code"]);
      NOTICE_CODES.add(code);
    }
    const key = `${code}|${ids.join(",")}`;
    this.#addNotice(key, { code, ids: [this.#impl.def.id, ...ids] }, true);
  }

  at(month: MonthIndex): MonthCtx {
    this.#months ??= new Map();
    const hit = this.#months.get(month);
    if (hit !== undefined) return hit;
    let mc: MonthCtx;
    // 1回の呼び出しで多くの月を読む部品（月ごとの計算）だけ、区間の自動の使い回しを使う（年ごとの部品は準備のほうが重い）
    const auto = this.#months.size >= AUTO_AFTER ? autoSegmentsOf(this.#state, this.#impl) : null;
    if (auto !== null && Number.isInteger(month) && month >= auto.from && month <= auto.to) {
      // 区間の自動の使い回し: m を含む区間（starts の中で m 以下の最後）
      const starts = auto.starts;
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if ((starts[mid] as number) <= month) lo = mid;
        else hi = mid - 1;
      }
      this.#autoAts ??= new Map();
      let shared = this.#autoAts.get(lo);
      if (shared === undefined) {
        const next = starts[lo + 1];
        shared = new AutoAt(this, starts[lo] as MonthIndex, (next === undefined ? auto.to : next - 1) as MonthIndex);
        this.#autoAts.set(lo, shared);
      }
      mc = new MonthView(this, month, shared);
    } else mc = new MonthCtxImpl(this, month);
    this.#months.set(month, mc);
    return mc;
  }

  /** CI とテスト（checkInternal）で確かめる */
  get checking(): boolean {
    return this.#state.checkInternal;
  }

  /** CI とテスト（checkInternal）: 区間の自動の使い回しで読んだ行が、その月で読んだときと同じ行（延長の有無も同じ）か */
  checkSame(id: string, opts: ParamOptions, month: MonthIndex, s: Selected): void {
    if (!this.#state.checkInternal) return;
    const direct = this.#selectAt(id, month, opts);
    if (direct.entry !== s.entry || (direct.extendedYear === undefined) !== (s.extendedYear === undefined) || direct.extendedYear !== s.extendedYear) {
      throw new EngineError("E_ARGUMENT", [id, "segments.notConstant"]);
    }
  }

  segments(from: MonthIndex, to: MonthIndex, opts: SegmentOptions): readonly Segment[] {
    const sets = this.#sets;
    for (const p of opts.params) {
      const id = typeof p === "string" ? p : p[0];
      if (!sets.params.has(id)) throw new EngineError("E_PARAM_UNDECLARED", [this.#impl.def.id, id]);
    }
    const state = this.#state;
    return segmentsOf(
      state.store,
      (id, o) => this.#lookupBasis(id, o),
      (id, o) => this.#matchOf(id, o),
      from,
      to,
      opts,
      (a, b, allowed) => new SegmentAt(this, a, b, allowed),
      state.checkInternal
        ? (id, o, m) => {
            try {
              return this.#selectAt(id, m, o);
            } catch (e) {
              if (e instanceof EngineError) return null;
              throw e;
            }
          }
        : null,
    );
  }

  #matchOf(_id: string, opts: ParamOptions): { birth?: ReturnType<TimeResolver["birthOf"]>; sex?: "female" | "male"; jurisdiction?: Jurisdiction } {
    const time = this.#state.time;
    const birth = opts.member !== undefined ? time.birthOf(opts.member) : undefined;
    const sex = opts.member !== undefined ? time.sexOf(opts.member) : undefined;
    return {
      ...(birth !== undefined ? { birth } : {}),
      ...(sex !== undefined ? { sex } : {}),
      ...(opts.jurisdiction !== undefined ? { jurisdiction: opts.jurisdiction } : {}),
    };
  }

  #lookupBasis(id: string, opts: ParamOptions): { basis: ReturnType<RegulationStore["definition"]>["basis"]; lc: LookupContext } {
    const state = this.#state;
    const vdef = state.store.definition(id);
    const lc: { anchorMonth?: MonthIndex } = {};
    if (vdef.basis.type === "anchor") {
      if (opts.anchorEvent === undefined) throw new EngineError("E_ARGUMENT", [id, "anchorEvent"]);
      if (state.time.eventKind(opts.anchorEvent) !== vdef.basis.anchor) throw new EngineError("E_ARGUMENT", [id, "anchorEvent.kind"]);
      lc.anchorMonth = state.time.resolveEvent(opts.anchorEvent, []);
    }
    return { basis: vdef.basis, lc: lc as LookupContext };
  }

  #selectAt(id: string, month: MonthIndex, opts: ParamOptions): Selected {
    const { basis, lc } = this.#lookupBasis(id, opts);
    return this.#state.store.select(id, lookupFor(basis, month, lc).date, this.#matchOf(id, opts));
  }

  /** 延長の仮定を使わずに値があるか */
  has(id: string, month: MonthIndex, opts: ParamOptions): boolean {
    const def = this.#impl.def;
    const state = this.#state;
    if (!this.#sets.params.has(id)) throw new EngineError("E_PARAM_UNDECLARED", [def.id, id]);
    if (!state.store.knows(id)) return false;
    // 鍵: 値ID →（構成員・出来事・管轄）→ 月（param と同じ形）
    const j = opts.jurisdiction;
    const sub =
      opts.member === undefined && opts.anchorEvent === undefined && (j === undefined || j === "national")
        ? id
        : `${id}|${opts.member ?? ""}|${opts.anchorEvent ?? ""}|${j === undefined || j === "national" ? "" : `${j.level}:${j.code}`}`;
    let byMonth = state.paramCache.has.get(sub);
    if (byMonth === undefined) {
      byMonth = new Map();
      state.paramCache.has.set(sub, byMonth);
    }
    const hit = byMonth.get(month);
    if (hit !== undefined) return hit;
    const vdef = state.store.definition(id);
    const lc: { anchorMonth?: MonthIndex } = {};
    if (vdef.basis.type === "anchor") {
      if (opts.anchorEvent === undefined) throw new EngineError("E_ARGUMENT", [id, "anchorEvent"]);
      lc.anchorMonth = state.time.resolveEvent(opts.anchorEvent, []);
    }
    const v = state.store.trySelect(id, lookupFor(vdef.basis, month, lc as LookupContext).date, { ...this.#matchOf(id, opts), noExtension: true }) !== null;
    byMonth.set(month, v);
    return v;
  }

  /**
   * 制度の値を month で引く。延長の仮定の記録は month〜until の月の分（区間の at のとき。ふつうは until = month）。
   * 引いた結果は、同じ要求の組（計算基準月・データの組・構成員の生年月などが同じ）のあいだで使い回す
   */
  param(id: string, month: MonthIndex, opts: ParamOptions, until: MonthIndex): Selected {
    const def = this.#impl.def;
    const state = this.#state;
    if (!this.#sets.params.has(id)) throw new EngineError("E_PARAM_UNDECLARED", [def.id, id]);
    // 鍵: 値ID →（構成員・出来事・管轄）→ 月。数の鍵で引けるように入れ子の Map にする
    const j = opts.jurisdiction;
    const sub =
      opts.member === undefined && opts.anchorEvent === undefined && (j === undefined || j === "national")
        ? id
        : `${id}|${opts.member ?? ""}|${opts.anchorEvent ?? ""}|${j === undefined || j === "national" ? "" : `${j.level}:${j.code}`}`;
    const cache = state.paramCache.params;
    let byMonth = cache.get(sub);
    if (byMonth === undefined) {
      byMonth = new Map();
      cache.set(sub, byMonth);
    }
    let sel = byMonth.get(month);
    if (sel === undefined) {
      sel = this.#selectAt(id, month, opts);
      byMonth.set(month, sel);
    }
    if (sel.recordedLater === true) {
      this.#addNotice(`N_PARAM_RECORDED_LATER|${id}`, { code: "N_PARAM_RECORDED_LATER", ids: [sel.ref, sel.entry.recordedIn] }, false);
    }
    if (sel.extendedYear !== undefined) {
      let last = sel.extendedYear;
      if (until !== month) {
        const { basis, lc } = this.#lookupBasis(id, opts);
        last = lookupFor(basis, until, lc).date.year;
      }
      this.#addExtended(sel.ref, sel.extendedYear, last);
    }
    const tracer = state.tracer;
    if (tracer.on) {
      tracer.param(this.#frame, {
        type: "param",
        id,
        ref: sel.ref,
        value: sel.entry.value,
        packVersion: sel.entry.recordedIn,
        appliesFrom: sel.entry.appliesFrom,
        appliesTo: sel.effectiveTo,
        sources: sel.entry.sources,
        ...(sel.extendedYear !== undefined ? { extended: true } : {}),
      });
    }
    return sel;
  }

  resolveTime(tp: Timepoint): MonthIndex {
    const state = this.#state;
    const m = state.time.resolve(tp);
    const tracer = state.tracer;
    if (tracer.on) {
      const d = state.time.describe(tp, m);
      tracer.timepoint(this.#frame, {
        type: "timepoint",
        timepoint: d.timepoint as unknown as Json,
        ym: d.ym,
        ...(d.rule !== undefined ? { rule: d.rule } : {}),
      });
    }
    return m;
  }

  ageSwitchOf(member: string, age: Age, rule: AgeSwitch): MonthIndex {
    const state = this.#state;
    const m = resolveAgeSwitch(state.time.birthOf(member), age, rule);
    const tracer = state.tracer;
    if (tracer.on) {
      tracer.timepoint(this.#frame, {
        type: "timepoint",
        timepoint: { memberAge: { member, years: age.years, months: age.months ?? 0, ageSwitch: rule } },
        ym: formatYm(m),
        rule,
      });
    }
    return m;
  }
}

// カスタム部品が ctx の作りを書き換えて他の部品に影響しないように、クラスの prototype を凍結する（0005 の3・0016）
for (const c of [CtxImpl, MonthCtxImpl, SegmentAt, MonthView, AutoAt, MoneyImpl, TimeImpl, ParamReader]) Object.freeze(c.prototype);

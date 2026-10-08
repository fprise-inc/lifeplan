// 0006 の1: 部品が外の世界に触れる手段は ctx だけ。制度の値・丸め・呼び出しはここで根拠の記録に残る
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
import { formatYm, type MonthIndex } from "../time/month.ts";
import type { Timepoint, TimeResolver } from "../time/timepoint.ts";
import type { Assembly, Impl } from "./assemble.ts";
import { rowAllowedInSlot, SLOTS } from "./slots.ts";
import { Frame, type Tracer } from "./trace.ts";

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

/** 「いま計算している月」に結び付けた制度の値と丸め（0003 の9） */
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
  slot(id: string, input: unknown): FlowsOutput[];
  /** 物の集まり（member・employment など）を、マニフェストの reads に書いた入力項目だけに絞って返す（0016 の5） */
  list<T = Record<string, unknown>>(collection: string): readonly T[];
  get<T = Record<string, unknown>>(collection: string, object: string): T;
  /** 前提条件の、その年の値。reads に assumptions.<名前> が要る。入力に無い前提は fallback（無ければエラー） */
  assumption(name: string, year: number, fallback?: Rate): Rate;
  /** 計算に反映していないこと（未対応の制度など）の知らせ。見出しの notices に ID だけで残す */
  notice(code: string, ids: readonly string[]): void;
  at(month: MonthIndex): MonthCtx;
  readonly conventions: CalcConventions;
  readonly money: MoneyApi;
  readonly rate: RateApi;
  readonly time: TimeApi;
}

export interface RunState {
  readonly assembly: Assembly;
  readonly store: RegulationStore;
  readonly tracer: Tracer;
  readonly time: TimeResolver;
  readonly input: EngineInput;
  readonly items: ItemTable;
  /** 部品ごと・集まりごとの絞った写し（1回の計算の中で使い回す） */
  readonly projections: Map<string, readonly Record<string, unknown>[]>;
  readonly notices: Map<string, { readonly code: string; readonly ids: readonly string[] }>;
  /** 延長の仮定で使った値の行（<値ID>@<rev>）→ 使った年の範囲（見出しの notices に出す。0007 の追記） */
  readonly extended: Map<string, { first: number; last: number }>;
  readonly checkInternal: boolean;
  readonly base: MonthIndex;
  readonly end: MonthIndex;
  /** 部品ID → 入力の JSON → 結果 */
  readonly cache: Map<string, Map<string, { readonly output: unknown; readonly node: number }>>;
  /** お金の動き（オブジェクト）→ それを作った call の記録の番号（full のとき） */
  readonly provenance: Map<object, number>;
  readonly stack: string[];
  /** 制度の値を引いた結果（値ID・計算している月・構成員・出来事・管轄ごと）。1回の計算の中で使い回す */
  readonly params?: Map<string, Map<number, Selected>>;
  /** 値の有無（延長の仮定を使わない）を見た結果 */
  readonly hasParams?: Map<string, boolean>;
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

function outputsOf(output: unknown): { flows: readonly Flow[]; annual: readonly AnnualRow[] } {
  const o = output as { flows?: readonly Flow[]; annual?: readonly AnnualRow[] } | null;
  return { flows: o?.flows ?? [], annual: o?.annual ?? [] };
}

/** 部品を1回呼ぶ。1回の計算の中では「部品ID＋入力」で結果を使い回す（部品は純粋な関数） */
export function invoke(state: RunState, impl: Impl, input: unknown): { output: unknown; node: number } {
  const id = impl.def.id;
  // 部品ごとの表を引いてから入力の JSON で引く（鍵の文字列を短くする）
  let byInput = state.cache.get(id);
  if (byInput === undefined) {
    byInput = new Map();
    state.cache.set(id, byInput);
  }
  const key = JSON.stringify(input);
  const hit = byInput.get(key);
  if (hit !== undefined) return hit;
  if (state.stack.includes(id)) throw new EngineError("E_COMPONENT_CYCLE", [...state.stack, id]);
  // 0006 の5: 公式部品どうしは CI とテストでだけ、差し替え・追加は常に検査する
  const validate = state.checkInternal || impl.origin !== "official";
  if (validate && hasSchema(impl.def.input)) check(impl.def.input, input, "E_COMPONENT_SCHEMA", [id, "input"]);
  if (validate && !hasSchema(impl.def.input)) throw new EngineError("E_COMPONENT_SCHEMA", [id, "input.schema"]);
  const frame = new Frame(id);
  state.stack.push(id);
  let output: unknown;
  try {
    output = impl.def.compute(input, makeCtx(state, impl, frame));
  } finally {
    state.stack.pop();
  }
  // 出力は使い回すので、書き換えられないように凍結する。公式部品どうしは CI とテスト（checkInternal）でだけ凍結し
  // （書き換える部品があればそこで例外になる）、製品では速さのため省く（入出力の検査と同じ扱い。0006 の5・追記）
  if (validate) deepFreeze(output);
  if (validate) check(impl.def.output, output, "E_COMPONENT_SCHEMA", [id, "output"]);
  const { flows, annual } = outputsOf(output);
  for (const f of flows) if (typeof f.formula !== "string") throw new EngineError("E_FORMULA_MISSING", [id]);
  for (const f of annual) if (typeof f.formula !== "string") throw new EngineError("E_FORMULA_MISSING", [id]);
  if (state.tracer.on) state.tracer.formulas(id, [...flows, ...annual].map((f) => f.formula));
  const node = state.tracer.finishCall(frame);
  if (state.tracer.mode === "full") {
    // 最も内側で作った部品を、そのお金の動きの出どころにする
    for (const f of [...flows, ...annual]) if (!state.provenance.has(f)) state.provenance.set(f, node);
  }
  const result = { output, node };
  byInput.set(key, result);
  return result;
}

// マニフェストの params・reads の集合は部品ごとに1回だけ作る
const MANIFEST_SETS = new WeakMap<object, { readonly params: ReadonlySet<string>; readonly reads: ReadonlySet<string> }>();

function manifestSets(def: Impl["def"]): { readonly params: ReadonlySet<string>; readonly reads: ReadonlySet<string> } {
  let s = MANIFEST_SETS.get(def);
  if (s === undefined) {
    s = { params: new Set(def.params), reads: new Set(def.reads) };
    MANIFEST_SETS.set(def, s);
  }
  return s;
}

function makeCtx(state: RunState, impl: Impl, frame: Frame): Ctx {
  const def = impl.def;
  const { params, reads } = manifestSets(def);
  const tracer = state.tracer;

  const matchOf = (opts: ParamOptions) => {
    const birth = opts.member !== undefined ? state.time.birthOf(opts.member) : undefined;
    const sex = opts.member !== undefined ? state.time.sexOf(opts.member) : undefined;
    return {
      ...(birth !== undefined ? { birth } : {}),
      ...(sex !== undefined ? { sex } : {}),
      ...(opts.jurisdiction !== undefined ? { jurisdiction: opts.jurisdiction } : {}),
    };
  };
  const lookupOf = (id: string, month: MonthIndex, opts: ParamOptions) => {
    const vdef = state.store.definition(id);
    const lc: { anchorMonth?: MonthIndex } = {};
    if (vdef.basis.type === "anchor") {
      if (opts.anchorEvent === undefined) throw new EngineError("E_ARGUMENT", [id, "anchorEvent"]);
      lc.anchorMonth = state.time.resolveEvent(opts.anchorEvent, []);
    }
    return lookupFor(vdef.basis, month, lc as LookupContext);
  };
  const has = (id: string, month: MonthIndex, opts: ParamOptions = {}): boolean => {
    if (!params.has(id)) throw new EngineError("E_PARAM_UNDECLARED", [def.id, id]);
    if (!state.store.knows(id)) return false;
    const cache = state.hasParams;
    const j = opts.jurisdiction;
    const key = cache === undefined ? "" : `${id}|${month}|${opts.member ?? ""}|${opts.anchorEvent ?? ""}|${j === undefined || j === "national" ? "" : `${j.level}:${j.code}`}`;
    const hit = cache?.get(key);
    if (hit !== undefined) return hit;
    const v = state.store.trySelect(id, lookupOf(id, month, opts).date, { ...matchOf(opts), noExtension: true }) !== null;
    cache?.set(key, v);
    return v;
  };

  const selectParam = (id: string, month: MonthIndex, opts: ParamOptions): Selected => {
    const vdef = state.store.definition(id);
    const lc: { anchorMonth?: MonthIndex } = {};
    if (vdef.basis.type === "anchor") {
      if (opts.anchorEvent === undefined) throw new EngineError("E_ARGUMENT", [id, "anchorEvent"]);
      if (state.time.eventKind(opts.anchorEvent) !== vdef.basis.anchor) throw new EngineError("E_ARGUMENT", [id, "anchorEvent.kind"]);
      lc.anchorMonth = state.time.resolveEvent(opts.anchorEvent, []);
    }
    const lookup = lookupFor(vdef.basis, month, lc as LookupContext);
    return state.store.select(id, lookup.date, matchOf(opts));
  };
  const param = (id: string, month: MonthIndex, opts: ParamOptions = {}): Selected => {
    if (!params.has(id)) throw new EngineError("E_PARAM_UNDECLARED", [def.id, id]);
    let sel: Selected;
    const cache = state.params;
    if (cache === undefined) sel = selectParam(id, month, opts);
    else {
      // 鍵: 値ID → (構成員・出来事・管轄) → 月。数の鍵で引けるように入れ子の Map にする
      const j = opts.jurisdiction;
      const sub = opts.member === undefined && opts.anchorEvent === undefined && (j === undefined || j === "national") ? id : `${id}|${opts.member ?? ""}|${opts.anchorEvent ?? ""}|${j === undefined || j === "national" ? "" : `${j.level}:${j.code}`}`;
      let byMonth = cache.get(sub);
      if (byMonth === undefined) {
        byMonth = new Map();
        cache.set(sub, byMonth);
      }
      const hit = byMonth.get(month);
      if (hit !== undefined) sel = hit;
      else {
        sel = selectParam(id, month, opts);
        byMonth.set(month, sel);
      }
    }
    // 0009 の追記: 値の1行は <制度の値ID>@<rev>
    const ref = `${id}@${sel.entry.rev}`;
    if (sel.recordedLater === true && !state.notices.has(`N_PARAM_RECORDED_LATER|${id}`)) {
      state.notices.set(`N_PARAM_RECORDED_LATER|${id}`, { code: "N_PARAM_RECORDED_LATER", ids: [`${id}@${sel.entry.rev}`, sel.entry.recordedIn] });
    }
    if (sel.extendedYear !== undefined) {
      const r = state.extended.get(ref);
      if (r === undefined) state.extended.set(ref, { first: sel.extendedYear, last: sel.extendedYear });
      else {
        if (sel.extendedYear < r.first) r.first = sel.extendedYear;
        if (sel.extendedYear > r.last) r.last = sel.extendedYear;
      }
    }
    if (tracer.on) {
      tracer.param(frame, {
        type: "param",
        id,
        ref,
        value: sel.entry.value,
        packVersion: sel.entry.recordedIn,
        appliesFrom: sel.entry.appliesFrom,
        appliesTo: sel.effectiveTo,
        sources: sel.entry.sources,
        ...(sel.extendedYear !== undefined ? { extended: true } : {}),
      });
    }
    return sel;
  };

  const moneyApi = (month: MonthIndex | null): MoneyApi => {
    const rule = (id: string): R.RoundingRule => {
      if (id.startsWith("conv.")) {
        const r = CONVENTIONS[id];
        if (r === undefined) throw new EngineError("E_ROUNDING_UNKNOWN", [id]);
        return r;
      }
      // 制度の端数処理は制度の値なので、計算している月が要る
      if (month === null) throw new EngineError("E_ROUNDING_UNKNOWN", [id, "month"]);
      return asRoundingRule(param(id, month));
    };
    const done = (id: string, op: string, r: R.Rounded): Yen => {
      if (tracer.on) tracer.rounding(frame, id, op, () => `${intToString(r.num)}/${intToString(r.den)}`, r.value);
      return r.value;
    };
    return {
      mulRate: (a, r, id) => done(id, "mulRate", R.mulRate(a, r, rule(id))),
      mulRatio: (a, n, d, id) => done(id, "mulRatio", R.mulRatio(a, n, d, rule(id))),
      divInt: (a, k, id) => done(id, "divInt", R.divInt(a, k, rule(id))),
      round: (a, id) => done(id, "round", R.round(a, rule(id))),
      convert: (m, fx, id) => done(id, "convert", R.convert(m, fx, rule(id))),
      allocate: (total, weights, id, to) => {
        const out = R.allocate(total, weights, rule(id), to);
        if (tracer.on) tracer.rounding(frame, id, "allocate", () => `${total}|${weights.join(",")}|${String(to)}`, out);
        return out;
      },
    };
  };

  // 同じ月の MonthCtx は使い回す（部品は月ごとに何度も ctx.at を呼ぶ）
  const monthCtxs = new Map<MonthIndex, MonthCtx>();

  const listOf = (collection: string): readonly Record<string, unknown>[] => {
    const key = `${def.id}\u0000${collection}`;
    const hit = state.projections.get(key);
    if (hit !== undefined) return hit;
    const out = deepFreeze(projectCollection(state.items, state.input as unknown as Record<string, unknown>, collection, reads, def.id));
    state.projections.set(key, out);
    return out;
  };

  const ctx: Ctx = {
    call<O>(id: string, input: unknown): O {
      if (def.requires[id] === undefined) throw new EngineError("E_CALL_UNDECLARED", [def.id, id]);
      const target = state.assembly.impls.get(id);
      if (target === undefined) throw new EngineError("E_COMPONENT_UNKNOWN", [id]);
      const r = invoke(state, target, input);
      if (r.node >= 0) frame.uses.add(r.node);
      return r.output as O;
    },
    slot(id: string, input: unknown): FlowsOutput[] {
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
        if (r.node >= 0) frame.uses.add(r.node);
        outs.push(out);
      }
      return outs;
    },
    list<T>(collection: string): readonly T[] {
      const out = listOf(collection);
      if (tracer.mode === "full") for (const o of out) tracer.input(frame, { collection }, o.id as string | undefined, () => o as Json);
      return out as unknown as readonly T[];
    },
    get<T>(collection: string, object: string): T {
      const found = listOf(collection).find((o) => o.id === object);
      if (found === undefined) throw new EngineError("E_ARGUMENT", [collection, object]);
      tracer.input(frame, { collection }, object, () => found as Json);
      return found as unknown as T;
    },
    assumption(name: string, year: number, fallback?: Rate): Rate {
      const item = `assumptions.${name}`;
      if (!reads.has(item)) throw new EngineError("E_READ_UNDECLARED", [def.id, item]);
      const series = (state.input.assumptions as Readonly<Record<string, { default: string; byYear?: Record<string, string> } | undefined>>)[name];
      if (series === undefined) {
        if (fallback !== undefined) return fallback;
        throw new EngineError("E_ARGUMENT", [item]);
      }
      tracer.input(frame, { item }, undefined, () => series as unknown as Json);
      return rate(series.byYear?.[String(year)] ?? series.default);
    },
    notice(code: string, ids: readonly string[]): void {
      if (!/^N_[A-Z_]+$/.test(code)) throw new EngineError("E_ARGUMENT", ["notice.code"]);
      const key = `${code}|${ids.join(",")}`;
      if (!state.notices.has(key)) state.notices.set(key, { code, ids: [def.id, ...ids] });
    },
    at(month: MonthIndex): MonthCtx {
      const hit = monthCtxs.get(month);
      if (hit !== undefined) return hit;
      const mc: MonthCtx = {
        month,
        param: (id, opts) => param(id, month, opts),
        paramYen: (id, opts) => asYen(param(id, month, opts)),
        paramRate: (id, opts) => asRate(param(id, month, opts)),
        paramBrackets: (id, opts) => asBrackets(param(id, month, opts)),
        paramGrades: (id, opts) => asGrades(param(id, month, opts)),
        paramCount: (id, opts) => asCount(param(id, month, opts)),
        has: (id, opts) => has(id, month, opts),
        money: moneyApi(month),
      };
      monthCtxs.set(month, mc);
      return mc;
    },
    conventions: state.input.calcConventions,
    money: moneyApi(null),
    rate: RATE_API,
    time: {
      base: state.base,
      end: state.end,
      resolve(tp: Timepoint): MonthIndex {
        const m = state.time.resolve(tp);
        if (tracer.on) {
          const d = state.time.describe(tp, m);
          tracer.timepoint(frame, {
            type: "timepoint",
            timepoint: d.timepoint as unknown as Json,
            ym: d.ym,
            ...(d.rule !== undefined ? { rule: d.rule } : {}),
          });
        }
        return m;
      },
      ageSwitch(member: string, age: Age, rule: AgeSwitch): MonthIndex {
        const m = resolveAgeSwitch(state.time.birthOf(member), age, rule);
        if (tracer.on) {
          tracer.timepoint(frame, {
            type: "timepoint",
            timepoint: { memberAge: { member, years: age.years, months: age.months ?? 0, ageSwitch: rule } },
            ym: formatYm(m),
            rule,
          });
        }
        return m;
      },
    },
  };
  return Object.freeze(ctx);
}

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
  asRate,
  asRoundingRule,
  asYen,
  type Bracket,
  type Json,
  type RegulationStore,
  type Selected,
} from "../regulation/reader.ts";
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
}

/** 「いま計算している月」に結び付けた制度の値と丸め（0003 の9） */
export interface MonthCtx {
  readonly month: MonthIndex;
  param(id: string, opts?: ParamOptions): Selected;
  paramYen(id: string, opts?: ParamOptions): Yen | null;
  paramRate(id: string, opts?: ParamOptions): Rate | null;
  paramBrackets(id: string, opts?: ParamOptions): readonly Bracket[] | null;
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
  read<T = unknown>(item: string): T;
  readObject<T extends { readonly id: string }>(item: string, object: string): T;
  assumption(name: string, year: number): Rate;
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
  readonly items: ReadonlyMap<string, unknown>;
  readonly checkInternal: boolean;
  readonly base: MonthIndex;
  readonly end: MonthIndex;
  readonly cache: Map<string, { readonly output: unknown; readonly node: number }>;
  /** お金の動き（オブジェクト）→ それを作った call の記録の番号（full のとき） */
  readonly provenance: Map<object, number>;
  readonly stack: string[];
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
  const key = `${id}\u0000${JSON.stringify(input)}`;
  const hit = state.cache.get(key);
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
  deepFreeze(output);
  if (validate) check(impl.def.output, output, "E_COMPONENT_SCHEMA", [id, "output"]);
  const { flows, annual } = outputsOf(output);
  for (const f of [...flows, ...annual]) if (typeof f.formula !== "string") throw new EngineError("E_FORMULA_MISSING", [id]);
  if (state.tracer.on) state.tracer.formulas(id, [...flows, ...annual].map((f) => f.formula));
  const node = state.tracer.finishCall(frame);
  if (state.tracer.mode === "full") {
    // 最も内側で作った部品を、そのお金の動きの出どころにする
    for (const f of [...flows, ...annual]) if (!state.provenance.has(f)) state.provenance.set(f, node);
  }
  const result = { output, node };
  state.cache.set(key, result);
  return result;
}

function makeCtx(state: RunState, impl: Impl, frame: Frame): Ctx {
  const def = impl.def;
  const params = new Set(def.params);
  const reads = new Set(def.reads);
  const tracer = state.tracer;

  const param = (id: string, month: MonthIndex, opts: ParamOptions = {}): Selected => {
    if (!params.has(id)) throw new EngineError("E_PARAM_UNDECLARED", [def.id, id]);
    const vdef = state.store.definition(id);
    const lc: { anchorMonth?: MonthIndex } = {};
    if (vdef.basis.type === "anchor") {
      if (opts.anchorEvent === undefined) throw new EngineError("E_ARGUMENT", [id, "anchorEvent"]);
      if (state.time.eventKind(opts.anchorEvent) !== vdef.basis.anchor) throw new EngineError("E_ARGUMENT", [id, "anchorEvent.kind"]);
      lc.anchorMonth = state.time.resolveEvent(opts.anchorEvent, []);
    }
    const lookup = lookupFor(vdef.basis, month, lc as LookupContext);
    const birth = opts.member !== undefined ? state.time.birthOf(opts.member) : undefined;
    const sel = state.store.select(id, lookup.date, birth !== undefined ? { birth } : {});
    if (tracer.on) {
      tracer.param(frame, {
        type: "param",
        id,
        ref: `${id}@r${sel.entry.rev}`,
        value: sel.entry.value,
        packVersion: sel.entry.recordedIn,
        appliesFrom: sel.entry.appliesFrom,
        appliesTo: sel.effectiveTo,
        sources: sel.entry.sources,
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

  const readItem = (item: string): unknown => {
    if (!reads.has(item)) throw new EngineError("E_READ_UNDECLARED", [def.id, item]);
    if (!state.items.has(item)) throw new EngineError("E_ARGUMENT", [item]);
    return state.items.get(item);
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
    read<T>(item: string): T {
      const v = readItem(item);
      tracer.input(frame, item, undefined, () => v as Json);
      return v as T;
    },
    readObject<T extends { readonly id: string }>(item: string, object: string): T {
      const list = readItem(item);
      const found = Array.isArray(list) ? (list as T[]).find((o) => o.id === object) : undefined;
      if (found === undefined) throw new EngineError("E_ARGUMENT", [item, object]);
      tracer.input(frame, item, object, () => found as unknown as Json);
      return found;
    },
    assumption(name: string, year: number): Rate {
      const item = `assumptions.${name}`;
      if (!reads.has(item)) throw new EngineError("E_READ_UNDECLARED", [def.id, item]);
      const series = (state.input.assumptions as Readonly<Record<string, { default: string; byYear?: Record<string, string> }>>)[name];
      if (series === undefined) throw new EngineError("E_ARGUMENT", [item]);
      tracer.input(frame, item, undefined, () => series as unknown as Json);
      return rate(series.byYear?.[String(year)] ?? series.default);
    },
    at(month: MonthIndex): MonthCtx {
      return {
        month,
        param: (id, opts) => param(id, month, opts),
        paramYen: (id, opts) => asYen(param(id, month, opts)),
        paramRate: (id, opts) => asRate(param(id, month, opts)),
        paramBrackets: (id, opts) => asBrackets(param(id, month, opts)),
        money: moneyApi(month),
      };
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

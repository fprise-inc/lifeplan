// 0006 の7: 根拠の記録。ctx を通るたびにエンジンが自動で取る（部品は計算式IDだけを書く）
import type { Json } from "../regulation/reader.ts";

export type TraceMode = "none" | "summary" | "full";

export interface ParamUse {
  readonly id: string;
  readonly ref: string;
  readonly value: Json;
  readonly packVersion: string;
  /** 延長の仮定で使った（0007 の追記） */
  readonly extended?: true;
}

export type TraceNode =
  | {
      readonly type: "param";
      readonly id: string;
      readonly ref: string;
      readonly value: Json;
      readonly packVersion: string;
      readonly appliesFrom: string;
      readonly appliesTo: string | null;
      readonly sources: readonly Json[];
      readonly extended?: true;
    }
  | { readonly type: "input"; readonly item?: string; readonly collection?: string; readonly object?: string; readonly value: Json }
  | { readonly type: "rounding"; readonly rule: string; readonly op: string; readonly input: string; readonly result: Json }
  | { readonly type: "timepoint"; readonly event?: string; readonly timepoint: Json; readonly ym: string; readonly rule?: string }
  | { readonly type: "call"; readonly component: string; readonly uses: readonly number[] };

interface SummaryEntry {
  readonly formulas: Set<string>;
  readonly params: Map<string, ParamUse>;
  readonly roundings: Set<string>;
}

/** 1回の部品の呼び出しの間に使った記録 */
export class Frame {
  readonly uses = new Set<number>();
  readonly component: string;
  constructor(component: string) {
    this.component = component;
  }
}

export class Tracer {
  readonly nodes: TraceNode[] = [];
  private readonly index = new Map<string, number>();
  private readonly summary = new Map<string, SummaryEntry>();
  private readonly timepoints: TraceNode[] = [];
  private readonly timepointKeys = new Set<string>();

  readonly mode: TraceMode;
  constructor(mode: TraceMode) {
    this.mode = mode;
  }

  get on(): boolean {
    return this.mode !== "none";
  }

  private entry(component: string): SummaryEntry {
    let e = this.summary.get(component);
    if (e === undefined) {
      e = { formulas: new Set(), params: new Map(), roundings: new Set() };
      this.summary.set(component, e);
    }
    return e;
  }

  /** 同じ記録は1回だけ持ち、番号で指す（重複を除いた有向グラフ） */
  private intern(key: string, make: () => TraceNode): number {
    const found = this.index.get(key);
    if (found !== undefined) return found;
    const i = this.nodes.length;
    this.nodes.push(make());
    this.index.set(key, i);
    return i;
  }

  param(frame: Frame, node: Extract<TraceNode, { type: "param" }>): void {
    if (this.mode === "none") return;
    const e = this.entry(frame.component);
    const key = node.extended === true ? `${node.ref}+` : node.ref;
    if (!e.params.has(key)) {
      e.params.set(key, { id: node.id, ref: node.ref, value: node.value, packVersion: node.packVersion, ...(node.extended === true ? { extended: true as const } : {}) });
    }
    if (this.mode === "full") frame.uses.add(this.intern(`p|${key}`, () => node));
  }

  rounding(frame: Frame, rule: string, op: string, input: () => string, result: Json): void {
    if (this.mode === "none") return;
    this.entry(frame.component).roundings.add(rule);
    if (this.mode === "full") {
      const inp = input();
      const key = `r|${rule}|${op}|${inp}|${JSON.stringify(result)}`;
      frame.uses.add(this.intern(key, () => ({ type: "rounding", rule, op, input: inp, result })));
    }
  }

  /** 入力を読んだ記録。前提条件は item（入力項目ID）、物の集まりは collection と object（reads に絞った写し） */
  input(frame: Frame, source: { readonly item: string } | { readonly collection: string }, object: string | undefined, value: () => Json): void {
    if (this.mode !== "full") return;
    const name = "item" in source ? `i:${source.item}` : `c:${source.collection}`;
    const key = `i|${name}|${frame.component}|${object ?? ""}`;
    frame.uses.add(
      this.intern(key, () => ({ type: "input", ...source, ...(object === undefined ? {} : { object }), value: value() })),
    );
  }

  timepoint(frame: Frame | null, node: Extract<TraceNode, { type: "timepoint" }>): void {
    if (this.mode === "none") return;
    const key = `t|${node.event ?? ""}|${JSON.stringify(node.timepoint)}|${node.ym}`;
    if (!this.timepointKeys.has(key)) {
      this.timepointKeys.add(key);
      this.timepoints.push(node);
    }
    if (this.mode === "full") {
      const i = this.intern(key, () => node);
      if (frame !== null) frame.uses.add(i);
    }
  }

  formulas(component: string, formulas: Iterable<string>): void {
    if (this.mode === "none") return;
    const e = this.entry(component);
    for (const f of formulas) e.formulas.add(f);
  }

  /** 呼び出しが終わったら call の記録を作る。親はこの番号を使う */
  finishCall(frame: Frame): number {
    if (this.mode !== "full") return -1;
    const uses = [...frame.uses].sort((a, b) => a - b);
    return this.intern(`c|${frame.component}|${uses.join(",")}`, () => ({ type: "call", component: frame.component, uses }));
  }

  toSummaryJson(): Json {
    const components = [...this.summary.entries()].map(([id, e]) => ({
      id,
      formulas: [...e.formulas].sort(),
      params: [...e.params.values()].map((p) => ({ ...p })),
      roundings: [...e.roundings].sort(),
    }));
    return { mode: "summary", components, timepoints: this.timepoints as unknown as Json[] };
  }
}

// エンジン全体の計算: 入力の検査 → 部品表の組み立て → 時点の解決 → 部品の呼び出し → 出力の検査
import buildInfo from "../generated/build-info.json" with { type: "json" };
import { OFFICIAL_COMPONENTS, ROOT_COMPONENT } from "../components/index.ts";
import { EngineError } from "../errors.ts";
import { checkRow } from "../ids/cfTree.ts";
import { check } from "../io/validate.ts";
import type { Json, PackJson } from "../regulation/reader.ts";
import { RegulationStore } from "../regulation/reader.ts";
import { contractMajor, satisfiesRange } from "../regulation/versions.ts";
import { assemble, type Assembly, type Extension, type Replacement } from "../registry/assemble.ts";
import { invoke, type RunState, type SharedCache } from "../registry/ctx.ts";
import { ITEMS, projectCollection } from "../registry/items.ts";
import { Tracer } from "../registry/trace.ts";
import { decemberOf, formatYm, parseYm, yearOf } from "../time/month.ts";
import { TimeResolver } from "../time/timepoint.ts";
import { tableYear } from "./aggregate.ts";
import { deepFreeze } from "./freeze.ts";
import type { AnnualRow, EngineRequest, Flow } from "./types.ts";

export interface RunOptions {
  /** 公式部品どうしの呼び出しの入出力も検査する（CI とテスト。0006 の5） */
  readonly checkInternal?: boolean;
  /** テストと、将来のカスタム層（0016）のための差し替え・追加 */
  readonly replacements?: readonly Replacement[];
  readonly extensions?: readonly Extension[];
  /** テスト専用: 計算のはじめに呼ぶ部品と入力を変える（答え合わせで1つの部品だけを試すため。製品の入口は渡さない） */
  readonly entry?: { readonly component: string; readonly input: unknown };
  /** テスト専用: 部品の出力を決まった値にする（答え合わせで公式の計算例の途中の値を入れるため。製品の入口は渡さない） */
  readonly stubs?: Readonly<Record<string, (input: unknown) => unknown>>;
  /** runBatch から: 検査済みのパック・組み立て済みの部品表と、要求のあいだで使い回す結果 */
  readonly batch?: BatchContext;
  /** 表示の先出し用（0005 の5）: お金の動き（flows）と根拠の記録を返さず、見出し・年ごとの行・表だけを返す */
  readonly preview?: boolean;
}

/** 複数の要求をまとめて計算するときに1回だけ用意するもの */
interface BatchContext {
  readonly stores: Map<string, RegulationStore>;
  readonly assembly: Assembly;
  readonly shared: SharedCache;
  /** 部品ID → その部品と内側で呼ぶ部品（差し込み口の追加を含む）が読む入力項目ID */
  readonly closures: Map<string, readonly string[]>;
}

export interface EngineResult {
  readonly header: Json;
  readonly flows: readonly Flow[];
  readonly annual: readonly AnnualRow[];
  readonly table: readonly Json[];
  readonly trace: Json;
  /** options.entry のときだけ: その部品の出力 */
  readonly entryOutput?: unknown;
}

const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

function compareFlow(a: Flow, b: Flow): number {
  return (
    cmp(a.ym, b.ym) ||
    cmp(a.row, b.row) ||
    cmp(a.member ?? "", b.member ?? "") ||
    cmp(a.object ?? "", b.object ?? "") ||
    cmp(a.formula, b.formula) ||
    cmp(a.accrualYear, b.accrualYear) ||
    cmp(a.amount, b.amount)
  );
}

function compareAnnual(a: AnnualRow, b: AnnualRow): number {
  return cmp(a.year, b.year) || cmp(a.row, b.row) || cmp(a.member ?? "", b.member ?? "") || cmp(a.object ?? "", b.object ?? "");
}

/** 値が undefined の欄を除いた写し（JSON にしたときと同じ形。undefined の無い物はそのまま使う） */
function stripUndefined<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < v.length; i++) {
      const x = v[i] as unknown;
      const y = x === undefined ? null : stripUndefined(x);
      if (y !== x && out === null) out = v.slice(0, i);
      if (out !== null) out.push(y);
    }
    return (out ?? v) as T;
  }
  let out: Record<string, unknown> | null = null;
  const keys = Object.keys(v);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i] as string;
    const x = (v as Record<string, unknown>)[k];
    const y = x === undefined ? undefined : stripUndefined(x);
    if (y !== x || x === undefined) {
      if (out === null) {
        out = {};
        for (let j = 0; j < i; j++) out[keys[j] as string] = (v as Record<string, unknown>)[keys[j] as string];
      }
    }
    if (out !== null && y !== undefined) out[k] = y;
  }
  return (out ?? v) as T;
}

const baseYearOf = (m: number) => yearOf(m as never);

/**
 * compareFlow の順に並べる。まず支払月で分け（月は「年×12＋月」の整数）、月の中だけを比べて並べる。
 * どちらも安定した並べ方なので、compareFlow で全体を並べたときと同じ順になる（内蔵の実行環境では比べる回数が多いと遅いため）
 */
function sortFlows(flows: Flow[]): void {
  if (flows.length < 2) return;
  const buckets = new Map<string, Flow[]>();
  for (const f of flows) {
    const b = buckets.get(f.ym);
    if (b === undefined) buckets.set(f.ym, [f]);
    else b.push(f);
  }
  const months = [...buckets.keys()].sort();
  let i = 0;
  for (const ym of months) {
    const b = buckets.get(ym) as Flow[];
    if (b.length > 1) b.sort(compareFlow);
    for (const f of b) flows[i++] = f;
  }
}

/** パックの形と、パックが必要とする計算部品の約束の版（0007 の3）を確かめる */
function checkPacks(packs: readonly unknown[], assembly: Assembly): void {
  packs.forEach((p, i) => check("regulation.pack", p, "E_PACK_SCHEMA", [`packs[${i}]`]));
  checkPackRequires(packs, assembly);
}

function checkPackRequires(packs: readonly unknown[], assembly: Assembly): void {
  for (const p of packs as readonly PackJson[]) {
    for (const [id, range] of Object.entries(p.pack.requires)) {
      const impl = assembly.impls.get(id);
      if (impl === undefined || !satisfiesRange(contractMajor(impl.def.contract), range)) {
        throw new EngineError("E_CONTRACT_MISMATCH", [p.pack.packId, id]);
      }
    }
  }
}

/** 部品と、それが内側で呼ぶ部品（requires をたどる）・差し込み口の追加が読む入力項目ID（重なりを除いて並べたもの） */
function readsClosure(assembly: Assembly, id: string, memo: Map<string, ReadonlySet<string>>): ReadonlySet<string> {
  const hit = memo.get(id);
  if (hit !== undefined) return hit;
  const out = new Set<string>();
  memo.set(id, out);
  const impl = assembly.impls.get(id);
  if (impl === undefined) return out;
  for (const r of impl.def.reads) out.add(r);
  for (const dep of Object.keys(impl.def.requires)) for (const r of readsClosure(assembly, dep, memo)) out.add(r);
  for (const slot of impl.def.slots ?? []) for (const ext of assembly.extensions.get(slot) ?? []) for (const r of ext.def.reads) out.add(r);
  return out;
}

export function runEngine(request: unknown, packs: readonly unknown[], options: RunOptions = {}): EngineResult {
  check("engine.request", request, "E_INPUT_SCHEMA");
  const req = deepFreeze(request as EngineRequest);
  const input = req.input;
  const batch = options.batch;
  if (batch === undefined) packs.forEach((p, i) => check("regulation.pack", p, "E_PACK_SCHEMA", [`packs[${i}]`]));

  const dataSetKey = JSON.stringify(input.dataSet ?? {});
  let store = batch?.stores.get(dataSetKey);
  if (store === undefined) {
    store = new RegulationStore(packs as readonly PackJson[], input.dataSet ?? {});
    batch?.stores.set(dataSetKey, store);
  }
  const assembled = batch?.assembly ?? assemble(OFFICIAL_COMPONENTS, options);
  const assembly =
    options.stubs === undefined
      ? assembled
      : {
          ...assembled,
          impls: new Map(
            [...assembled.impls].map(([id, impl]) => {
              const stub = options.stubs?.[id];
              return [id, stub === undefined ? impl : { ...impl, origin: "replacement" as const, def: { ...impl.def, compute: (input: unknown) => stub(input) } }];
            }),
          ),
        };
  // 0007 の3: パックが必要とする計算部品の約束の版（まとめて計算するときは runBatch で1回だけ）
  if (batch === undefined) checkPackRequires(packs, assembly);
  const h = input.household;
  // 世帯内の物のIDは、その世帯の中で一意（0004 の4）
  const objectIds = [
    h.members,
    h.events,
    h.employmentPeriods,
    h.accounts,
    h.insuranceContracts,
    h.residentTaxAssessments ?? [],
    h.pensionRecords ?? [],
    h.premiumAssessments ?? [],
    h.premiumRates ?? [],
  ].flatMap((l) =>
    (l as readonly { id: string }[]).map((o) => o.id),
  );
  if (new Set(objectIds).size !== objectIds.length) throw new EngineError("E_ARGUMENT", ["household.id"]);
  const memberIds = new Set(h.members.map((m) => m.id));
  const refs = [
    ...h.employmentPeriods.map((p) => p.member),
    ...h.accounts.map((a) => a.owner),
    ...h.insuranceContracts.flatMap((c) => [c.policyholder, c.insured]),
    ...(h.residentTaxAssessments ?? []).map((a) => a.member),
    ...(h.pensionRecords ?? []).map((a) => a.member),
    ...(h.premiumAssessments ?? []).map((a) => a.member),
    ...h.employmentPeriods.flatMap((p) => [p.leaveChild, p.childcareShortHours?.child].filter((x): x is string => x !== undefined)),
    ...h.relations.flatMap((r) => (r.type === "spouse" ? [r.a, r.b] : [r.parent, r.child])),
  ];
  if (refs.some((id) => !memberIds.has(id))) throw new EngineError("E_ARGUMENT", ["household.member"]);
  // 年金の加入の記録は構成員ごとに1件まで
  const recordMembers = (h.pensionRecords ?? []).map((r) => r.member);
  if (new Set(recordMembers).size !== recordMembers.length) throw new EngineError("E_ARGUMENT", ["household.pensionRecords.member"]);

  const tracer = new Tracer(req.trace);
  const time = new TimeResolver(h.members, h.events);
  // 0003 の6: 計算の前にすべてのイベントを絶対の年月へ解決する（循環はここでエラー）
  const events = time.resolveAllEvents();
  for (const e of h.events) {
    tracer.timepoint(null, { type: "timepoint", event: e.id, timepoint: e.at as unknown as Json, ym: formatYm(events.get(e.id) as never) });
  }

  const base = parseYm(input.baseMonth);
  const end = decemberOf(input.endYear);
  if (end < base) throw new EngineError("E_ARGUMENT", ["endYear"]);
  const state: RunState = {
    assembly,
    store,
    tracer,
    time,
    input,
    items: ITEMS,
    projections: new Map(),
    notices: new Map(),
    extended: new Map(),
    checkInternal: options.checkInternal === true,
    base,
    end,
    cache: new Map(),
    provenance: new Map(),
    stack: [],
    params: new Map(),
    hasParams: new Map(),
    // 案×想定のあいだの使い回しは、根拠の記録なしのときだけ（記録は計算した要求の記録にしか残らないため）
    ...(batch !== undefined && req.trace === "none" ? { shared: batch.shared, fingerprint: fingerprinter(batch, input, dataSetKey), effects: [] } : {}),
  };
  const rootId = options.entry?.component ?? ROOT_COMPONENT;
  const root = assembly.impls.get(rootId);
  if (root === undefined) throw new EngineError("E_COMPONENT_UNKNOWN", [rootId]);
  const { output, node: rootNode } = invoke(state, root, options.entry?.input ?? {});
  const out = output as { flows?: readonly Flow[]; annual?: readonly AnnualRow[] };

  // 0003 の5: 計算基準月より前・表の最後より後のお金の動きは載せない
  const flows: Flow[] = [];
  for (const f of out.flows ?? []) {
    const m = parseYm(f.ym);
    if (m >= base && m <= end) flows.push(f);
  }
  for (const f of flows) {
    if (typeof f.formula !== "string") throw new EngineError("E_FORMULA_MISSING", [rootId]);
    checkRow(f.row);
  }
  const annual = (out.annual ?? []).filter((a) => a.year >= baseYearOf(base) && a.year <= input.endYear);
  for (const f of annual) {
    if (typeof f.formula !== "string") throw new EngineError("E_FORMULA_MISSING", [rootId]);
    checkRow(f.row);
  }
  // 先出しでは flows を返さないので並べない（表は年ごとに足すだけなので順番に依らない）
  if (options.preview !== true) sortFlows(flows);
  annual.sort(compareAnnual);

  // キャッシュフロー表: お金の動きを年に集め、年ごとの行を足す
  const aggregation = input.calcConventions.aggregation;
  const baseYear = yearOf(base);
  type Cell = { row: string; year: number; amount: number; member?: string; object?: string };
  const cells: Cell[] = [];
  const index = new Map<string, Cell>();
  const add = (row: string, year: number, amount: number, member?: string, object?: string) => {
    const key = `${row}|${year}|${member ?? ""}|${object ?? ""}`;
    const c = index.get(key);
    if (c !== undefined) c.amount += amount;
    else {
      const cell: Cell = { row, year, amount, ...(member !== undefined ? { member } : {}), ...(object !== undefined ? { object } : {}) };
      index.set(key, cell);
      cells.push(cell);
    }
  };
  for (const f of flows) add(f.row, tableYear(f, aggregation, baseYear), f.amount, f.member, f.object);
  for (const a of annual) add(a.row, a.year, a.amount, a.member, a.object);
  const table = cells.sort(
    (a, b) => cmp(a.row, b.row) || cmp(a.year, b.year) || cmp(a.member ?? "", b.member ?? "") || cmp(a.object ?? "", b.object ?? ""),
  );
  for (const c of table) if (!Number.isSafeInteger(c.amount)) throw new EngineError("E_UNSAFE_INTEGER", [c.row]);

  let trace: Json = null;
  if (req.trace === "summary" && options.preview !== true) trace = tracer.toSummaryJson();
  if (req.trace === "full" && options.preview !== true) {
    const ref = (o: object) => state.provenance.get(o) ?? rootNode;
    trace = {
      mode: "full",
      nodes: tracer.nodes as unknown as Json[],
      flows: flows.map(ref),
      annual: annual.map(ref),
    };
  }

  const header: Json = {
    engine: { version: buildInfo.version, sourceDigest: buildInfo.sourceDigest },
    trace: req.trace,
    baseMonth: input.baseMonth,
    endYear: input.endYear,
    calcConventions: input.calcConventions as unknown as Json,
    components: assembly.refs as unknown as Json[],
    data: store.packs() as unknown as Json[],
    // 計算に反映していないこと（未対応の制度など）と、延長の仮定で使った値（値の行・最初の年・最後の年）。ID だけ
    notices: [
      ...mergeProjected([...state.notices.values()]),
      ...[...state.extended.entries()].map(([ref, r]) => ({ code: "N_PARAM_EXTENDED", ids: [ref, String(r.first), String(r.last)] })),
    ].sort((a, b) => cmp(`${a.code}|${a.ids.join(",")}`, `${b.code}|${b.ids.join(",")}`)) as unknown as Json[],
  };
  // undefined の欄を除くのは見出しと根拠の記録だけ（お金の動き・年ごとの行・表は部品と上の集計が欄を省いて作り、JSON にしたときも同じ）
  const result = { header: stripUndefined(header), flows: options.preview === true ? [] : flows, annual, table: table as unknown as Json[], trace: stripUndefined(trace) };
  return options.entry === undefined ? result : { ...result, entryOutput: output };
}

/**
 * 部品ごとの「読む入力の指紋」（0005・0006 の追記: 依存の追跡）。部品とその内側で呼ぶ部品が読む入力項目（reads をたどったもの）の値と、
 * どの部品も読める共通のもの（計算基準月・表の最後の年・計算方式・データの組・構成員の生年月と性別・名前つきイベント）をつなげた文字列。
 * 2つの要求でこれが同じなら、その部品の同じ入力の呼び出しは同じ結果になる（部品は ctx でしか入力に触れないため）
 */
function fingerprinter(batch: BatchContext, input: EngineRequest["input"], dataSetKey: string): (component: string) => string {
  const h = input.household;
  const common = JSON.stringify([
    input.baseMonth,
    input.endYear,
    input.calcConventions,
    dataSetKey,
    h.members.map((m) => [m.id, m.birth, m.sex ?? null]),
    h.events,
  ]);
  const byClosure = new Map<string, string>();
  const byComponent = new Map<string, string>();
  const source = input as unknown as Record<string, unknown>;
  const assumptions = (input.assumptions ?? {}) as Readonly<Record<string, unknown>>;
  return (component) => {
    const hit = byComponent.get(component);
    if (hit !== undefined) return hit;
    let reads = batch.closures.get(component);
    if (reads === undefined) {
      reads = [...readsClosure(batch.assembly, component, new Map())].sort();
      batch.closures.set(component, reads);
    }
    const closureKey = reads.join(",");
    let fp = byClosure.get(closureKey);
    if (fp === undefined) {
      const readSet = new Set(reads);
      const parts: unknown[] = [];
      for (const collection of Object.keys(ITEMS.collections).sort()) {
        if (reads.some((r) => ITEMS.items[r]?.collection === collection)) parts.push(collection, projectCollection(ITEMS, source, collection, readSet, component));
      }
      for (const r of reads) if (r.startsWith("assumptions.")) parts.push(r, assumptions[r.slice("assumptions.".length)] ?? null);
      fp = `${common}${JSON.stringify(parts)}`;
      byClosure.set(closureKey, fp);
    }
    byComponent.set(component, fp);
    return fp;
  };
}

/**
 * 複数の要求（案×想定）をまとめて計算する（0005 の7・追記）。パックの検査と部品表の組み立ては1回だけ行い、根拠の記録なしの要求の
 * あいだでは、読む入力が同じ部品の結果を使い回す。結果は1件ずつ計算したときと同じ（一致テストで確かめる）。
 * preview は表示の先出し用で、お金の動きと根拠の記録を除いた見出し・年ごとの行・表だけを返す
 */
export function runBatch(requests: readonly unknown[], packs: readonly unknown[], options: RunOptions = {}): (EngineResult | { readonly error: { readonly code: string; readonly ids: readonly string[] } })[] {
  const assembly = assemble(OFFICIAL_COMPONENTS, options);
  checkPacks(packs, assembly);
  const batch: BatchContext = { stores: new Map(), assembly, shared: new Map(), closures: new Map() };
  return requests.map((r) => {
    try {
      return runEngine(r, packs, { ...options, batch });
    } catch (e) {
      if (e instanceof EngineError) return { error: { code: e.code, ids: e.ids } };
      throw e;
    }
  });
}

/** 延ばした値の知らせ（N_PARAM_PROJECTED。部品・値の ID・最初の年・最後の年）は、構成員ごとに出たものを1つにまとめる */
function mergeProjected(notices: readonly { code: string; ids: readonly string[] }[]): { code: string; ids: readonly string[] }[] {
  const out: { code: string; ids: readonly string[] }[] = [];
  const merged = new Map<string, { code: string; ids: string[] }>();
  for (const n of notices) {
    if (n.code !== "N_PARAM_PROJECTED" || n.ids.length !== 4) {
      out.push(n);
      continue;
    }
    const [component, id, first, last] = n.ids as [string, string, string, string];
    const key = `${component}|${id}`;
    const m = merged.get(key);
    if (m === undefined) merged.set(key, { code: n.code, ids: [component, id, first, last] });
    else {
      if (Number(first) < Number(m.ids[2])) m.ids[2] = first;
      if (Number(last) > Number(m.ids[3])) m.ids[3] = last;
    }
  }
  return [...out, ...merged.values()];
}

/** runBatch の文字列の入口。requestsJson は要求の配列。結果も配列（1件ずつ結果か {error}） */
export function runBatchJson(requestsJson: string, packsJson: string, optionsJson = "{}"): string {
  try {
    const opts = JSON.parse(optionsJson) as { checkInternal?: boolean; preview?: boolean };
    const requests = JSON.parse(requestsJson) as unknown;
    if (!Array.isArray(requests)) throw new EngineError("E_INPUT_SCHEMA", ["/:type"]);
    const preview = opts.preview === true;
    const results = runBatch(requests, JSON.parse(packsJson) as unknown[], { checkInternal: opts.checkInternal === true, preview });
    const out = results.map((r) => {
      if ("error" in r) return r;
      if (!preview) {
        check("engine.output", r, "E_OUTPUT_SCHEMA");
        return r;
      }
      const p = { header: r.header, annual: r.annual, table: r.table };
      check("engine.preview", p, "E_OUTPUT_SCHEMA");
      return p;
    });
    return JSON.stringify(out);
  } catch (e) {
    if (e instanceof EngineError) return JSON.stringify({ error: { code: e.code, ids: e.ids } });
    if (e instanceof SyntaxError) return JSON.stringify({ error: { code: "E_INPUT_SCHEMA", ids: ["json"] } });
    throw e;
  }
}

/** 文字列で受けて文字列で返す入口（Rust のホストと Node の両方がこれを呼ぶ） */
export function runJson(requestJson: string, packsJson: string, optionsJson = "{}"): string {
  try {
    const opts = JSON.parse(optionsJson) as { checkInternal?: boolean };
    const result = runEngine(JSON.parse(requestJson), JSON.parse(packsJson) as unknown[], { checkInternal: opts.checkInternal === true });
    check("engine.output", result, "E_OUTPUT_SCHEMA");
    return JSON.stringify(result);
  } catch (e) {
    if (e instanceof EngineError) return JSON.stringify({ error: { code: e.code, ids: e.ids } });
    if (e instanceof SyntaxError) return JSON.stringify({ error: { code: "E_INPUT_SCHEMA", ids: ["json"] } });
    throw e;
  }
}

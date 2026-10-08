// エンジン全体の計算: 入力の検査 → 部品表の組み立て → 時点の解決 → 部品の呼び出し → 出力の検査
import buildInfo from "../generated/build-info.json" with { type: "json" };
import { OFFICIAL_COMPONENTS, ROOT_COMPONENT } from "../components/index.ts";
import { EngineError } from "../errors.ts";
import { checkRow } from "../ids/cfTree.ts";
import { check } from "../io/validate.ts";
import type { Json, PackJson } from "../regulation/reader.ts";
import { RegulationStore } from "../regulation/reader.ts";
import { contractMajor, satisfiesRange } from "../regulation/versions.ts";
import { assemble, type Extension, type Replacement } from "../registry/assemble.ts";
import { invoke, type RunState } from "../registry/ctx.ts";
import { ITEMS } from "../registry/items.ts";
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

function stripUndefined<T extends object>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

const baseYearOf = (m: number) => yearOf(m as never);

export function runEngine(request: unknown, packs: readonly unknown[], options: RunOptions = {}): EngineResult {
  check("engine.request", request, "E_INPUT_SCHEMA");
  packs.forEach((p, i) => check("regulation.pack", p, "E_PACK_SCHEMA", [`packs[${i}]`]));
  const req = deepFreeze(request as EngineRequest);
  const input = req.input;

  const store = new RegulationStore(packs as readonly PackJson[], input.dataSet ?? {});
  const assembled = assemble(OFFICIAL_COMPONENTS, options);
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
  // 0007 の3: パックが必要とする計算部品の約束の版
  for (const p of packs as readonly PackJson[]) {
    for (const [id, range] of Object.entries(p.pack.requires)) {
      const impl = assembly.impls.get(id);
      if (impl === undefined || !satisfiesRange(contractMajor(impl.def.contract), range)) {
        throw new EngineError("E_CONTRACT_MISMATCH", [p.pack.packId, id]);
      }
    }
  }
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
  };
  const rootId = options.entry?.component ?? ROOT_COMPONENT;
  const root = assembly.impls.get(rootId);
  if (root === undefined) throw new EngineError("E_COMPONENT_UNKNOWN", [rootId]);
  const { output, node: rootNode } = invoke(state, root, options.entry?.input ?? {});
  const out = output as { flows?: readonly Flow[]; annual?: readonly AnnualRow[] };

  // 0003 の5: 計算基準月より前・表の最後より後のお金の動きは載せない
  const flows = (out.flows ?? []).filter((f) => {
    const m = parseYm(f.ym);
    return m >= base && m <= end;
  });
  const annual = (out.annual ?? []).filter((a) => a.year >= baseYearOf(base) && a.year <= input.endYear);
  for (const f of [...flows, ...annual]) {
    if (typeof f.formula !== "string") throw new EngineError("E_FORMULA_MISSING", [rootId]);
    checkRow(f.row);
  }
  flows.sort(compareFlow);
  annual.sort(compareAnnual);

  // キャッシュフロー表: お金の動きを年に集め、年ごとの行を足す
  const aggregation = input.calcConventions.aggregation;
  const baseYear = yearOf(base);
  const cells = new Map<string, { row: string; year: number; amount: number; member?: string; object?: string }>();
  const add = (row: string, year: number, amount: number, member?: string, object?: string) => {
    const key = `${row}|${year}|${member ?? ""}|${object ?? ""}`;
    const c = cells.get(key);
    if (c !== undefined) c.amount += amount;
    else cells.set(key, { row, year, amount, ...(member !== undefined ? { member } : {}), ...(object !== undefined ? { object } : {}) });
  };
  for (const f of flows) add(f.row, tableYear(f, aggregation, baseYear), f.amount, f.member, f.object);
  for (const a of annual) add(a.row, a.year, a.amount, a.member, a.object);
  const table = [...cells.values()].sort(
    (a, b) => cmp(a.row, b.row) || cmp(a.year, b.year) || cmp(a.member ?? "", b.member ?? "") || cmp(a.object ?? "", b.object ?? ""),
  );
  for (const c of table) if (!Number.isSafeInteger(c.amount)) throw new EngineError("E_UNSAFE_INTEGER", [c.row]);

  let trace: Json = null;
  if (req.trace === "summary") trace = tracer.toSummaryJson();
  if (req.trace === "full") {
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
      ...state.notices.values(),
      ...[...state.extended.entries()].map(([ref, r]) => ({ code: "N_PARAM_EXTENDED", ids: [ref, String(r.first), String(r.last)] })),
    ].sort((a, b) => cmp(`${a.code}|${a.ids.join(",")}`, `${b.code}|${b.ids.join(",")}`)) as unknown as Json[],
  };
  const result = stripUndefined({ header, flows, annual, table: table as unknown as Json[], trace });
  return options.entry === undefined ? result : { ...result, entryOutput: output };
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

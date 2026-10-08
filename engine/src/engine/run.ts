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
import { Tracer } from "../registry/trace.ts";
import { decemberOf, formatYm, parseYm, yearOf } from "../time/month.ts";
import { TimeResolver } from "../time/timepoint.ts";
import { tableYear } from "./aggregate.ts";
import { deepFreeze } from "./freeze.ts";
import type { AnnualRow, EngineInput, EngineRequest, Flow } from "./types.ts";

export interface RunOptions {
  /** 公式部品どうしの呼び出しの入出力も検査する（CI とテスト。0006 の5） */
  readonly checkInternal?: boolean;
  /** テストと、将来のカスタム層（0016）のための差し替え・追加 */
  readonly replacements?: readonly Replacement[];
  readonly extensions?: readonly Extension[];
}

export interface EngineResult {
  readonly header: Json;
  readonly flows: readonly Flow[];
  readonly annual: readonly AnnualRow[];
  readonly table: readonly Json[];
  readonly trace: Json;
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

/** 部品が読む入力項目（入力項目IDの登録簿はまだ無い。見本の部品が使うものだけ） */
function inputItems(input: EngineInput): Map<string, unknown> {
  return new Map<string, unknown>([
    ["test.sample.flows", input.flows],
    ["test.sample.annualLumpSums", input.annualLumpSums],
    ["test.sample.openingBalance", input.openingBalance],
  ]);
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
  const assembly = assemble(OFFICIAL_COMPONENTS, options);
  // 0007 の3: パックが必要とする計算部品の約束の版
  for (const p of packs as readonly PackJson[]) {
    for (const [id, range] of Object.entries(p.pack.requires)) {
      const impl = assembly.impls.get(id);
      if (impl === undefined || !satisfiesRange(contractMajor(impl.def.contract), range)) {
        throw new EngineError("E_CONTRACT_MISMATCH", [p.pack.packId, id]);
      }
    }
  }
  for (const f of input.flows) checkRow(f.row);
  for (const m of input.members) if (input.members.filter((o) => o.id === m.id).length > 1) throw new EngineError("E_ARGUMENT", ["members.id"]);

  const tracer = new Tracer(req.trace);
  const time = new TimeResolver(input.members, input.events);
  // 0003 の6: 計算の前にすべてのイベントを絶対の年月へ解決する（循環はここでエラー）
  const events = time.resolveAllEvents();
  for (const e of input.events) {
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
    items: inputItems(input),
    checkInternal: options.checkInternal === true,
    base,
    end,
    cache: new Map(),
    provenance: new Map(),
    stack: [],
  };
  const root = assembly.impls.get(ROOT_COMPONENT);
  if (root === undefined) throw new EngineError("E_COMPONENT_UNKNOWN", [ROOT_COMPONENT]);
  const { output, node: rootNode } = invoke(state, root, {});
  const out = output as { flows?: readonly Flow[]; annual?: readonly AnnualRow[] };

  // 0003 の5: 計算基準月より前・表の最後より後のお金の動きは載せない
  const flows = (out.flows ?? []).filter((f) => {
    const m = parseYm(f.ym);
    return m >= base && m <= end;
  });
  const annual = (out.annual ?? []).filter((a) => a.year >= baseYearOf(base) && a.year <= input.endYear);
  for (const f of [...flows, ...annual]) {
    if (typeof f.formula !== "string") throw new EngineError("E_FORMULA_MISSING", [ROOT_COMPONENT]);
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
  };
  return stripUndefined({ header, flows, annual, table: table as unknown as Json[], trace });
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

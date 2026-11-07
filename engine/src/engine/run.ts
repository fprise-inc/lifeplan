// エンジン全体の計算: 入力の検査 → 部品表の組み立て → 時点の解決 → 部品の呼び出し → 出力の検査
import buildInfo from "../generated/build-info.json" with { type: "json" };
import { INHERITANCE_COMPONENT, OFFICIAL_COMPONENTS, PROTECTION_COMPONENT, ROOT_COMPONENT } from "../components/index.ts";
import { EngineError } from "../errors.ts";
import { checkRow, isUnder } from "../ids/cfTree.ts";
import { check, checkOutput } from "../io/validate.ts";
import type { Json, PackJson } from "../regulation/reader.ts";
import { RegulationStore } from "../regulation/reader.ts";
import { contractMajor, satisfiesRange } from "../regulation/versions.ts";
import { assemble, type Assembly, type Extension, type Replacement } from "../registry/assemble.ts";
import type { ComponentDefinition } from "../registry/define.ts";
import { BACKFILLED, collectEffects, invoke, keepLane, newKeyTable, newParamCache, newPartition, nextEpoch, type Partition, type RunState, type Variant } from "../registry/ctx.ts";
import { ITEMS } from "../registry/items.ts";
import { Tracer } from "../registry/trace.ts";
import { decemberOf, formatYm, parseYm, yearOf } from "../time/month.ts";
import { TimeResolver } from "../time/timepoint.ts";
import { tableYear } from "./aggregate.ts";
import { componentConventions } from "./compatibility.ts";
import { deepFreeze } from "./freeze.ts";
import { numTable, type NumTable } from "./numTable.ts";
import { applyInvestment } from "./investment.ts";
import { applyContingency, applyStress, applyWorkChanges } from "./overlay.ts";
import type { AnnualRow, CalcConventions, DonorInput, EngineInput, EngineRequest, Flow } from "./types.ts";

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
  /**
   * テスト専用: 公式部品の定義を、差し替えの決まり（0119）を通さずに置き換える（エンジンの仕組み〔区間・構成員ごとの依存・凍結など〕を、
   * 差し替えを許さない公式部品で確かめるため）。見出しの起こりは replacement。製品の入口は渡さない
   */
  readonly probes?: Readonly<Record<string, ComponentDefinition>>;
  /** runBatch から: 検査済みのパック・組み立て済みの部品表と、要求のあいだで使い回す結果 */
  readonly batch?: BatchContext;
  /** 表示の先出し用（0005 の5）: お金の動き（flows）と根拠の記録を返さず、見出し・年ごとの行・表だけを返す */
  readonly preview?: boolean;
  /** 本体が形を確かめたパックの指紋（checkPacksJson の結果）。このパックは計算ごとには確かめない（0005・0017 の追記） */
  readonly packsChecked?: readonly string[];
}

/** 複数の要求をまとめて計算するときに1回だけ用意するもの */
export interface BatchContext {
  readonly stores: Map<string, RegulationStore>;
  readonly assembly: Assembly;
  /**
   * 要求の組: 計算基準月・表の最後の年・計算方式・データの組・構成員の生年月と性別・名前つきイベントが同じ要求どうし。
   * 部品はこれらを ctx を通して依存の記録なしに使う（制度の値・時点の解決）ので、使い回しはこの組の中だけで行う
   */
  readonly partitions: Map<string, Partition>;
  /** お金の動きの配列（使い回した部品の結果）→ 表に載せるお金の動きとその集計 */
  readonly aggregates: WeakMap<readonly Flow[], Map<string, FlowAggregate>>;
  /** 最後に計算した要求の根の候補（セッションが持ち続ける候補を決めるため） */
  lastUsed: Variant[] | null;
  /**
   * 次に計算する要求の枠の番号。計算した結果を鍵の prevs のこの位置に置き、同じ枠の次の計算でまず確かめる
   * （セッションは枠ごとの番号、runBatch はすべて0で、1つ前の要求の結果）
   */
  lane: number;
}

export interface EngineResult {
  readonly header: Json;
  readonly flows: readonly Flow[];
  readonly annual: readonly AnnualRow[];
  readonly table: readonly Json[];
  /** 表から作る要約（表の期間の収入・税と社会保険料・支出・年間収支の合計と、FP顧問料の累計。0008 の追記） */
  readonly summary: Json;
  readonly trace: Json;
  /** 必要保障額の推移（input.protection を指定したときだけ） */
  readonly protection?: Json;
  /** 相続税の目安（input.inheritanceTax を指定したときだけ。0039） */
  readonly inheritanceTax?: Json;
  /** options.entry のときだけ: その部品の出力 */
  readonly entryOutput?: unknown;
}

const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 同じ支払月のお金の動きどうしの並べ方（行・構成員・物・計算式・帰属の年・額）。全体の並べ方は「支払月、その中でこれ」で、
 * sortFlows は月で分けてから月の中だけをこれで並べる（月の比べ方を省く。0005 の追記（2026-10-10））
 */
function compareFlowInMonth(a: Flow, b: Flow): number {
  // cmp を欄ごとに呼ぶのと同じ（関数を呼ばずに。どちらでもなければ次の欄へ）
  const ar = a.row;
  const br = b.row;
  if (ar !== br) {
    if (ar < br) return -1;
    if (ar > br) return 1;
  }
  const am = a.member ?? "";
  const bm = b.member ?? "";
  if (am !== bm) {
    if (am < bm) return -1;
    if (am > bm) return 1;
  }
  const ao = a.object ?? "";
  const bo = b.object ?? "";
  if (ao !== bo) {
    if (ao < bo) return -1;
    if (ao > bo) return 1;
  }
  const af = a.formula;
  const bf = b.formula;
  if (af !== bf) {
    if (af < bf) return -1;
    if (af > bf) return 1;
  }
  return cmp(a.accrualYear, b.accrualYear) || cmp(a.amount, b.amount);
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

type Cell = { row: string; year: number; amount: number; member?: string; object?: string };

function addCell(index: Map<string, Cell>, cells: Cell[], row: string, year: number, amount: number, member?: string, object?: string): void {
  const key = `${row}|${year}|${member ?? ""}|${object ?? ""}`;
  const c = index.get(key);
  if (c !== undefined) c.amount += amount;
  else {
    const cell: Cell = { row, year, amount, ...(member !== undefined ? { member } : {}), ...(object !== undefined ? { object } : {}) };
    index.set(key, cell);
    cells.push(cell);
  }
}

/** addCell と同じ（鍵の文字列の代わりに、行 → 構成員 → 物 → 年 の表で引く） */
function addTreeCell(tree: CellTree, cells: Cell[], row: string, year: number, amount: number, member?: string, object?: string): void {
  let byMember = tree.get(row);
  if (byMember === undefined) {
    byMember = new Map();
    tree.set(row, byMember);
  }
  let byObject = byMember.get(member ?? "");
  if (byObject === undefined) {
    byObject = new Map();
    byMember.set(member ?? "", byObject);
  }
  let byYear = byObject.get(object ?? "");
  if (byYear === undefined) {
    byYear = numTable<Cell>();
    byObject.set(object ?? "", byYear);
  }
  const c = byYear[year];
  if (c !== undefined) c.amount += amount;
  else {
    const cell: Cell = { row, year, amount, ...(member !== undefined ? { member } : {}), ...(object !== undefined ? { object } : {}) };
    byYear[year] = cell;
    cells.push(cell);
  }
}

/** 表に載せるお金の動き（計算基準月から表の最後まで）と、それを年に集めた表の行 */
interface FlowAggregate {
  readonly flows: Flow[];
  readonly cells: readonly { readonly key: string; readonly cell: Readonly<Cell> }[];
}

/** 行 → 構成員 → 物 → 年 の表（集めた表の行） */
type CellTree = Map<string, Map<string, Map<string, NumTable<Cell>>>>;

/**
 * shared を渡すと、その表と行の並びに足し込む（1件ずつの計算: 部品の出力ごとの集計を使い回さないので、全部の部品の出力を1つの表に集める。
 * 足す順は部品の出力の順で、表の行は最後に並べ替えるので、出力ごとに集めて足し合わせたときと同じ。戻り値の cells は空）
 */
function aggregateFlows(
  raw: readonly Flow[],
  base: number,
  end: number,
  aggregation: CalcConventions["aggregation"],
  baseYear: number,
  rootId: string,
  shared?: { readonly tree: CellTree; readonly cells: Cell[] },
): FlowAggregate {
  const flows: Flow[] = [];
  // 月の文字列の読み取りは parseYm が文字列ごとに覚えている
  // 部品の出力は同じ月のお金の動きが続くので、1つ前と同じ月の文字列なら読み直さない
  let lastYm: string | null = null;
  let lastM = 0;
  for (const f of raw) {
    const ym = f.ym;
    if (ym !== lastYm) {
      lastM = parseYm(ym);
      lastYm = ym;
    }
    if (lastM >= base && lastM <= end) flows.push(f);
  }
  // 行 → 構成員 → 物 → 年 の表で足す（お金の動きごとに鍵の文字列を作らない）。部品の出力は同じ行・構成員・物のお金の動きが続くので、
  // 1つ前と同じなら表を引き直さない。計算式と行の確かめは、表に足す前にお金の動きの順に行う（同じ行は1回だけ確かめる）
  const tree: CellTree = shared?.tree ?? new Map();
  const cells: Cell[] = shared?.cells ?? [];
  let lastRow: string | null = null;
  let lastMember: string | undefined;
  let lastObject: string | undefined;
  let byYear: NumTable<Cell> | null = null;
  for (const f of flows) {
    if (typeof f.formula !== "string") throw new EngineError("E_FORMULA_MISSING", [rootId]);
    const row = f.row;
    if (row !== lastRow) checkRow(row);
    let year: number;
    if (aggregation === "cash") {
      const ym = f.ym;
      if (ym !== lastYm) {
        lastM = parseYm(ym);
        lastYm = ym;
      }
      year = Math.floor(lastM / 12);
    } else year = tableYear(f, aggregation, baseYear);
    if (byYear === null || row !== lastRow || f.member !== lastMember || f.object !== lastObject) {
      let byMember = tree.get(row);
      if (byMember === undefined) {
        byMember = new Map();
        tree.set(row, byMember);
      }
      const mk = f.member ?? "";
      let byObject = byMember.get(mk);
      if (byObject === undefined) {
        byObject = new Map();
        byMember.set(mk, byObject);
      }
      const ok = f.object ?? "";
      byYear = byObject.get(ok) ?? null;
      if (byYear === null) {
        byYear = numTable<Cell>();
        byObject.set(ok, byYear);
      }
      lastRow = row;
      lastMember = f.member;
      lastObject = f.object;
    }
    const c = byYear[year];
    if (c !== undefined) c.amount += f.amount;
    else {
      const cell: Cell = { row, year, amount: f.amount, ...(f.member !== undefined ? { member: f.member } : {}), ...(f.object !== undefined ? { object: f.object } : {}) };
      byYear[year] = cell;
      cells.push(cell);
    }
  }
  if (shared !== undefined) return { flows, cells: [] };
  const keyed = cells.map((cell) => ({ key: `${cell.row}|${cell.year}|${cell.member ?? ""}|${cell.object ?? ""}`, cell: Object.freeze(cell) }));
  return { flows, cells: keyed };
}

/**
 * 支払月、その中で compareFlowInMonth の順に並べる。まず支払月で分け、月の中だけを比べて並べる。
 * どちらも安定した並べ方なので、全体を1回で並べたときと同じ順になる（内蔵の実行環境では比べる回数が多いと遅いため）
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
    if (b.length > 1) b.sort(compareFlowInMonth);
    for (const f of b) flows[i++] = f;
  }
}

/**
 * パックの形（スキーマ）を確かめる。checked にある指紋（digest）のパックは、本体（署名を確かめ、checkPacks で形を確かめたもの）が
 * 検査済みと渡したものなので、計算ごとには確かめない（0005・0017 の追記: パックの検査は本体で1回）
 */
function checkPackSchemas(packs: readonly unknown[], checked: readonly string[] | undefined): void {
  packs.forEach((p, i) => {
    const digest = (p as { digest?: unknown } | null)?.digest;
    if (checked !== undefined && typeof digest === "string" && checked.includes(digest)) return;
    check("regulation.pack", p, "E_PACK_SCHEMA", [`packs[${i}]`]);
  });
}

/** パックの形と、パックが必要とする計算部品の約束の版（0007 の3）を確かめる */
function checkPacks(packs: readonly unknown[], assembly: Assembly, checked: readonly string[] | undefined): void {
  checkPackSchemas(packs, checked);
  checkPackRequires(packs, assembly);
}

/**
 * 本体がパックを読み込んだとき（署名を確かめた後）に1回だけ流す入口: パックの形と、公式部品の約束の版を確かめ、
 * 検査済みのパックの指紋を返す（計算のときに packsChecked として渡す。0005・0017 の追記）
 */
export function checkPacksJson(packsJson: string): string {
  try {
    const packs = JSON.parse(packsJson) as unknown;
    if (!Array.isArray(packs)) throw new EngineError("E_PACK_SCHEMA", ["/:type"]);
    checkPacks(packs, assemble(OFFICIAL_COMPONENTS, {}), undefined);
    return JSON.stringify({ ok: true, digests: packs.map((p) => (p as { digest: string }).digest) });
  } catch (e) {
    if (e instanceof EngineError) return JSON.stringify({ error: { code: e.code, ids: e.ids } });
    if (e instanceof SyntaxError) return JSON.stringify({ error: { code: "E_INPUT_SCHEMA", ids: ["json"] } });
    throw e;
  }
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

/**
 * 0035 の4: 世帯ファイルの形式 0.17 では、贈与者を世帯の外の家族の構成員（`outside`。生年月・性別なし）で持つ。
 * 生年月の無い世帯の外の家族は贈与者（donors）として読み、構成員の計算には使わない（0.16 の贈与者と同じ結果）。
 * 生年月のある世帯の外の家族は構成員として読み、世帯の外の家族の決まりで計算する（収入・税・社会保険料は家計を1つにする期間のうち
 * 収入を世帯に入れる期間だけ世帯に入れる・世帯の判定の顔ぶれに入れない、など。部品が sdk の isOutside・sameHousehold で見る）
 */
const RELATIVE_KINDS: ReadonlySet<string> = new Set(["parent", "grandparent", "sibling", "child", "grandchild"]);

export function readOutsideFamily(input: EngineInput): EngineInput {
  const members = input.household.members;
  const asDonor = members.filter((m) => m.outside !== undefined && (m as { readonly birth?: unknown }).birth === undefined);
  if (asDonor.length === 0) return input;
  const donors: DonorInput[] = [
    ...(input.household.donors ?? []),
    ...asDonor.map(
      (m): DonorInput => ({
        id: m.id,
        kind: m.kind === "parent" || m.kind === "grandparent" ? m.kind : "other",
        ...(m.outside?.of !== undefined ? { of: m.outside.of } : {}),
        // 0039: 相続人の数え方に使う（家族の種類と亡くなる見込み）。贈与の計算は読まない
        relative: RELATIVE_KINDS.has(m.kind) ? (m.kind as NonNullable<DonorInput["relative"]>) : "other",
        ...(m.leaves !== null ? { leaves: m.leaves } : {}),
      }),
    ),
  ];
  return { ...input, household: { ...input.household, members: members.filter((m) => !asDonor.includes(m)), donors } };
}

export function runEngine(request: unknown, packs: readonly unknown[], options: RunOptions = {}): EngineResult {
  check("engine.request", request, "E_INPUT_SCHEMA");
  const req = deepFreeze(request as EngineRequest);
  const given = readOutsideFamily(req.input);
  // 基準の月の年は、表の年（common の year）と同じ 1900〜2200 の内（年月の形は年の範囲を持たないので、ここで入力の誤りにする）
  const givenBaseYear = yearOf(parseYm(given.baseMonth));
  if (givenBaseYear < 1900 || givenBaseYear > 2200) throw new EngineError("E_ARGUMENT", ["baseMonth"]);
  const batch = options.batch;
  if (batch === undefined) checkPackSchemas(packs, options.packsChecked);

  // パックの版の組と事務所の推定の値（0111）が同じ要求どうしで、同じ値の読み取りを使い回す
  // （推定で埋めない目安〔0111 の2回目〕も同じ）
  const dataSetKey =
    given.estimateValues === undefined && given.estimateNoFill === undefined ? JSON.stringify(given.dataSet ?? {}) : JSON.stringify([given.dataSet ?? {}, given.estimateValues ?? {}, [...(given.estimateNoFill ?? [])].sort()]);
  let store = batch?.stores.get(dataSetKey);
  if (store === undefined) {
    store = new RegulationStore(packs as readonly PackJson[], given.dataSet ?? {}, (given.estimateValues ?? {}) as Readonly<Record<string, Json>>, given.estimateNoFill ?? []);
    batch?.stores.set(dataSetKey, store);
  }
  const assembled = batch?.assembly ?? assembleWith(options);
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
  // 0008 の7: 上書きの決まり方の順番の最後に、ストレステスト（前提の書き換え）と万一の重ねを入力に重ねる（overlay.ts）。
  // 構成員の生年月・性別と名前つきイベントは変えないので、要求の組（使い回しの範囲）は万一なしの要求と同じ
  const time = new TimeResolver(given.household.members, given.household.events);
  // 0026: 資産運用の入れ方と既定の値（積立の終わり・iDeCo の受け取りの始まり）を、ストレス・万一より先に重ねる
  const invested = applyInvestment(given, time, parseYm(given.baseMonth), decemberOf(given.endYear));
  const stressed = applyStress(invested.input, time, (id) => (store as RegulationStore).estimate(id));
  const overlaid = applyContingency(stressed.input, time);
  // 0085: 働き方の置き換え（万一の重ねの後。就業不能・収入が減るの場面の配偶者の働き方）
  const input = applyWorkChanges(overlaid.input, time);
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
    h.donors ?? [],
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
    ...(h.careExpenses ?? []).flatMap((c) => [c.member, ...(c.payer !== undefined ? [c.payer] : [])]),
    ...h.insuranceContracts.flatMap((c) => [...(c.annuitant !== undefined ? [c.annuitant] : []), ...(c.beneficiaries ?? []).flatMap((b) => (b.member !== undefined ? [b.member] : []))]),
    ...(input.protection?.members ?? []),
    ...(h.donors ?? []).flatMap((d) => (d.of !== undefined ? [d.of] : [])),
  ];
  if (refs.some((id) => !memberIds.has(id))) throw new EngineError("E_ARGUMENT", ["household.member"]);
  // 贈与者を指す欄は、贈与者（donors）か世帯の外の家族の構成員の ID だけ（0035 の4）
  const donorIds = new Set([...(h.donors ?? []).map((d) => d.id), ...h.members.filter((m) => m.outside !== undefined).map((m) => m.id)]);
  const donorRefs = [
    ...(h.residences ?? []).flatMap((r) => (r.purchase?.gifts ?? []).flatMap((g) => (g.donor !== undefined ? [g.donor] : []))),
    ...(h.goals ?? []).flatMap((g) => (g.education?.gifts ?? []).flatMap((x) => (x.donor !== undefined ? [x.donor] : []))),
  ];
  if (donorRefs.some((id) => !donorIds.has(id))) throw new EngineError("E_ARGUMENT", ["household.donor"]);
  // 相続税の目安の要求が指す人は、構成員か世帯の外の家族（贈与者として読んだ人を含む。0039）
  const it = input.inheritanceTax;
  if (it !== undefined) {
    const itRefs = [...(it.members ?? []), ...(it.lastSurvivor !== undefined ? [it.lastSurvivor] : []), ...(it.adopted ?? []), ...(it.heirCounts ?? []).map((x) => x.decedent), ...(it.retirementAllowances ?? []).map((x) => x.decedent), ...(it.overrides ?? []).flatMap((x) => (x.decedent !== undefined ? [x.decedent] : []))];
    if (itRefs.some((id) => !memberIds.has(id) && !donorIds.has(id))) throw new EngineError("E_ARGUMENT", ["inheritanceTax.member"]);
  }
  // 年金の加入の記録は構成員ごとに1件まで
  const recordMembers = (h.pensionRecords ?? []).map((r) => r.member);
  if (new Set(recordMembers).size !== recordMembers.length) throw new EngineError("E_ARGUMENT", ["household.pensionRecords.member"]);

  // 要求の組（Partition）の鍵
  const partitionKey = JSON.stringify([input.baseMonth, input.endYear, input.calcConventions, dataSetKey, h.members.map((m) => [m.id, m.birth, m.sex ?? null]), h.events]);
  let partition = batch?.partitions.get(partitionKey);
  if (batch !== undefined && partition === undefined) {
    partition = newPartition();
    batch.partitions.set(partitionKey, partition);
  }
  // 要求のあいだの結果の使い回しは、根拠の記録なしのときだけ（記録は計算した要求の記録にしか残らないため）
  const sharing = partition !== undefined && req.trace === "none";
  const tracer = new Tracer(req.trace);
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
    traceOn: tracer.on,
    time,
    input,
    conventions: componentConventions(input.calcConventions),
    items: ITEMS,
    projections: new Map(),
    notices: new Map(),
    extended: new Map(),
    checkInternal: options.checkInternal === true,
    base,
    end,
    keys: sharing ? (partition as Partition).keys : newKeyTable(),
    epoch: nextEpoch(),
    resolved: [],
    lane: sharing ? (batch as BatchContext).lane : -1,
    provenance: new Map(),
    stack: [],
    paramCache: partition?.params ?? newParamCache(),
    inputs: new Map(),
    ...(sharing ? { partition, depCache: [new Map(), new Map(), new Map()] } : {}),
  };
  const rootId = options.entry?.component ?? ROOT_COMPONENT;
  const root = assembly.impls.get(rootId);
  if (root === undefined) throw new EngineError("E_COMPONENT_UNKNOWN", [rootId]);
  const rootRes = invoke(state, root, options.entry?.input ?? {});
  const { output, node: rootNode } = rootRes;
  if (sharing) collectEffects(state, rootRes);
  // 必要保障額の推移（指定したときだけ。6.3）: 根の部品の後に、同じ要求の中で求める（キャッシュフロー表の部品の結果を使い回す）
  let protectionRes: ReturnType<typeof invoke> | null = null;
  if (input.protection !== undefined && options.entry === undefined) {
    const impl = assembly.impls.get(PROTECTION_COMPONENT);
    if (impl === undefined) throw new EngineError("E_COMPONENT_UNKNOWN", [PROTECTION_COMPONENT]);
    protectionRes = invoke(state, impl, { request: input.protection });
    if (sharing) collectEffects(state, protectionRes);
  }
  // 相続税の目安（指定したときだけ。0039）: 根の部品の後に、同じ要求の中で求める（表示だけで、お金の流れには入れない）
  let inheritanceRes: ReturnType<typeof invoke> | null = null;
  if (input.inheritanceTax !== undefined && options.entry === undefined) {
    const impl = assembly.impls.get(INHERITANCE_COMPONENT);
    if (impl === undefined) throw new EngineError("E_COMPONENT_UNKNOWN", [INHERITANCE_COMPONENT]);
    inheritanceRes = invoke(state, impl, { request: input.inheritanceTax });
    if (sharing) collectEffects(state, inheritanceRes);
  }
  if (batch !== undefined) {
    const used = [rootRes.variant, protectionRes?.variant ?? null, inheritanceRes?.variant ?? null].filter((v): v is Variant => v !== null);
    batch.lastUsed = rootRes.variant === null ? null : used;
    if (sharing) keepLane(state);
  }
  const out = output as { flows?: readonly Flow[]; annual?: readonly AnnualRow[]; parts?: readonly (readonly Flow[])[] };

  // 0003 の5: 計算基準月より前・表の最後より後のお金の動きは載せない。表のうちお金の動きを年に集めた部分も作る。
  // 根の部品が parts（お金の動きを出した部品の出力ごとの配列）を返すときは、部品の出力ごとに集め、まとめて計算するときは
  // 同じ配列（使い回した部品の結果）について1回だけ行う（0005 の追記）
  const aggregation = input.calcConventions.aggregation;
  const baseYear = yearOf(base);
  const rawFlows = out.flows ?? [];
  const parts = out.parts ?? [rawFlows];
  const aggKey = `${base}|${end}|${aggregation}`;
  // 1件ずつの計算（まとめて計算でない）は、部品の出力ごとの集計を使い回さないので、1つの表に集める
  const shared = batch === undefined ? { tree: new Map() as CellTree, cells: [] as Cell[] } : undefined;
  const aggOf = (arr: readonly Flow[]): FlowAggregate => {
    if (shared !== undefined) return aggregateFlows(arr, base, end, aggregation, baseYear, rootId, shared);
    let agg = batch?.aggregates.get(arr)?.get(aggKey);
    if (agg === undefined) {
      agg = aggregateFlows(arr, base, end, aggregation, baseYear, rootId);
      if (batch !== undefined) {
        let m = batch.aggregates.get(arr);
        if (m === undefined) {
          m = new Map();
          batch.aggregates.set(arr, m);
        }
        m.set(aggKey, agg);
      }
    }
    return agg;
  };
  const aggs = parts.map(aggOf);
  if (out.parts !== undefined && state.checkInternal) {
    // parts をつなげると flows と同じ中身（数と合計）
    let n = 0;
    let sum = 0;
    for (const p of parts) for (const f of p) {
      n++;
      sum += f.amount;
    }
    let sum0 = 0;
    for (const f of rawFlows) sum0 += f.amount;
    if (n !== rawFlows.length || sum !== sum0) throw new EngineError("E_ARGUMENT", [rootId, "parts"]);
  }
  const flows: Flow[] = [];
  if (options.preview !== true) {
    for (const g of aggs) for (const f of g.flows) flows.push(f);
    sortFlows(flows);
  }
  const annual = (out.annual ?? []).filter((a) => a.year >= baseYearOf(base) && a.year <= input.endYear);
  for (const f of annual) {
    if (typeof f.formula !== "string") throw new EngineError("E_FORMULA_MISSING", [rootId]);
    checkRow(f.row);
  }
  annual.sort(compareAnnual);

  // キャッシュフロー表: お金の動きを年に集めたもの（部品の出力ごと）を足し合わせ、年ごとの行を足す
  const cells: Cell[] = shared?.cells ?? [];
  const index = new Map<string, Cell>();
  for (const g of aggs) {
    for (const c of g.cells) {
      const cur = index.get(c.key);
      if (cur !== undefined) cur.amount += c.cell.amount;
      else {
        const cell = { ...c.cell };
        index.set(c.key, cell);
        cells.push(cell);
      }
    }
  }
  if (shared !== undefined) for (const a of annual) addTreeCell(shared.tree, cells, a.row, a.year, a.amount, a.member, a.object);
  else for (const a of annual) addCell(index, cells, a.row, a.year, a.amount, a.member, a.object);
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
    ...(overlaid.header !== null ? { contingency: overlaid.header as unknown as Json } : {}),
    ...(stressed.header !== null ? { stressTest: stressed.header as unknown as Json } : {}),
    components: assembly.refs as unknown as Json[],
    data: store.packs() as unknown as Json[],
    // 計算に反映していないこと（未対応の制度など）と、延長の仮定・さかのぼりの仮定（0099）で使った値（値の行・最初の年・最後の年）。ID だけ
    notices: [
      ...mergeProjected([...state.notices.values()]),
      ...invested.notices,
      ...[...state.extended.entries()].map(([key, r]) =>
        key.startsWith(BACKFILLED)
          ? { code: "N_PARAM_BACKFILLED", ids: [key.slice(BACKFILLED.length), String(r.first), String(r.last)] }
          : { code: "N_PARAM_EXTENDED", ids: [key, String(r.first), String(r.last)] },
      ),
    ].sort((a, b) => cmp(`${a.code}|${a.ids.join(",")}`, `${b.code}|${b.ids.join(",")}`)) as unknown as Json[],
  };
  // undefined の欄を除くのは見出しと根拠の記録だけ（お金の動き・年ごとの行・表は部品と上の集計が欄を省いて作り、JSON にしたときも同じ）
  const details = (output as { details?: { insurance?: Json; gifts?: Json; outsideWallets?: Json; childScholarships?: Json; realEstate?: Json; realEstateAnalysis?: Json } } | null)?.details;
  const summary = summaryOf(table, details);
  const result = {
    header: stripUndefined(header),
    flows: options.preview === true ? [] : flows,
    annual,
    table: table as unknown as Json[],
    summary,
    trace: stripUndefined(trace),
    ...(protectionRes !== null ? { protection: protectionRes.output as Json } : {}),
    ...(inheritanceRes !== null ? { inheritanceTax: inheritanceRes.output as Json } : {}),
  };
  return options.entry === undefined ? result : { ...result, entryOutput: output };
}

/**
 * 複数の要求（案×想定）をまとめて計算する（0005 の7・追記）。パックの検査と部品表の組み立ては1回だけ行い、根拠の記録なしの要求の
 * あいだでは、読む入力が同じ部品の結果を使い回す。結果は1件ずつ計算したときと同じ（一致テストで確かめる）。
 * preview は表示の先出し用で、お金の動き・年ごとの行（表に含まれる）・根拠の記録を除いた見出しと表だけを返す
 */
export function runBatch(
  requests: readonly unknown[],
  packs: readonly unknown[],
  options: RunOptions = {},
  context?: BatchContext,
): (EngineResult | { readonly error: { readonly code: string; readonly ids: readonly string[] } })[] {
  const batch = context ?? createBatchContext(packs, options);
  return requests.map((r) => {
    try {
      return runEngine(r, packs, { ...options, batch });
    } catch (e) {
      if (e instanceof EngineError) return { error: { code: e.code, ids: e.ids } };
      throw e;
    }
  });
}

/** 部品表の組み立て。テスト専用の probes は、組み立てた後に定義を置き換える（まとめて計算するときも1回だけ。使い回しの鍵が変わらないように） */
function assembleWith(options: RunOptions): Assembly {
  const assembled = assemble(OFFICIAL_COMPONENTS, options);
  const probes = options.probes;
  if (probes === undefined) return assembled;
  return {
    ...assembled,
    impls: new Map([...assembled.impls].map(([id, impl]) => [id, probes[id] === undefined ? impl : { ...impl, origin: "replacement" as const, def: probes[id] }])),
    refs: assembled.refs.map((r) => (probes[r.id] === undefined ? r : { ...r, origin: "replacement" as const })),
  };
}

/** パックの検査と部品表の組み立て（まとめて計算するときと、セッションで1回だけ行う） */
export function createBatchContext(packs: readonly unknown[], options: RunOptions = {}): BatchContext {
  const assembly = assembleWith(options);
  checkPacks(packs, assembly, options.packsChecked);
  return { stores: new Map(), assembly, partitions: new Map(), aggregates: new WeakMap(), lastUsed: null, lane: 0 };
}

/** セッションが持つ候補の数がこれを超えたら、どの枠でも使っていない候補を捨てる（結果は同じで、計算し直すだけ） */
const SESSION_GC_EVERY = 40;

/** 枠の状態（0005 の追記: 計算し直しが終わっていない結果には「古い」と分かる印を付ける） */
type SlotState = "fresh" | "stale" | "missing";

interface Slot {
  /** 今の要求（JSON）と、要求が変わるたびに1つ増える番号 */
  request: string;
  rev: number;
  /** 最後に計算した結果（JSON）と、それを計算したときの番号・先出しか */
  result: string | null;
  resultRev: number;
  preview: boolean;
  /** 最後の計算で使った・作った候補（持ち続ける候補を決めるため）と、枠の番号（鍵の prevs の位置） */
  used: Variant[];
  lane: number;
}

/**
 * 画面側のエンジン（0005 の5: 表示の先出し）のためのセッション。パックの検査と部品表の組み立てを1回だけ行い、
 * 呼び出しをまたいで、依存（読んだ入力と呼んだ部品の結果）が同じ部品の結果を使い回す（スライダーを動かすたびに、変わった入力に関係する
 * 部品だけを計算し直す）。結果は1件ずつ計算したときと同じ。本体の計算（正）は計算ごとに新しい実行環境で run・runBatch を使う（0005 の3）。
 *
 * 枠（案×想定。ID は画面が決める文字列）ごとに要求を置き（set）、見ている案の枠だけを先に計算し（compute）、残りは古い印のまま返せる（results・status）。
 * 枠の番号（rev）は要求が変わるたびに増え、結果にはそれを計算したときの番号が付く（本体の計算の結果を、どの要求のものか照らし合わせるのにも使える）
 */
export interface Session {
  /** 枠を置く: {"<枠ID>": 要求 | null}（null は枠を消す）。要求が変わった枠は古い（stale）になる。戻り値は status() */
  set(slotsJson: string): string;
  /** 枠を計算する（idsJson は枠IDの配列。省略は古い枠と、まだ計算していない枠すべて）。戻り値は {"<枠ID>": {"rev", "state": "fresh", "result"}} */
  compute(idsJson?: string, optionsJson?: string): string;
  /** 枠ごとの最後の結果と状態: {"<枠ID>": {"rev": 今の番号, "resultRev": 結果の番号, "state", "preview", "result": 結果 | null}} */
  results(idsJson?: string): string;
  /** 枠ごとの状態: {"<枠ID>": {"rev", "state": "fresh" | "stale" | "missing"}} */
  status(): string;
  /**
   * スライダーの1刻み（0005 の追記（2026-10-09）: 先出しの範囲）。枠を置き直し（set と同じ）、今見ている案の「万一が起きない」想定の1枠（focus）だけを
   * 先出しで計算する。戻り値は {"focus": {"<枠ID>": {"rev", "state": "fresh", "result"}}, "status": status()}。ほかの枠は古い（stale）のまま、
   * results() で前の結果を返せる（画面は古い印を付けて表示する）。FP が万一の画面を見ているときは、その万一の枠を focus にしてよい
   * （0005 の追記 2026-10-09: 万一・ストレステストの枠と先出し）
   */
  slide(slotsJson: string, focusId: string): string;
  /** 指を離した直後: 古い枠とまだ計算していない枠をすべて計算する（既定は先出し。{"preview": false} で出力全体）。戻り値は compute と同じ */
  release(optionsJson?: string): string;
  /** 互換: 要求の配列を計算する（i 番目を枠 "#i" として置いて計算し、結果の配列を返す） */
  runBatch(requestsJson: string, optionsJson?: string): string;
  clear(): void;
}

export function createSession(packsJson: string, optionsJson = "{}"): Session {
  let packs: unknown[] | null = null;
  let batch: BatchContext | null = null;
  let failure: string | null = null;
  let checkInternal = false;
  try {
    const opts = JSON.parse(optionsJson) as { checkInternal?: boolean; packsChecked?: string[] };
    checkInternal = opts.checkInternal === true;
    packs = JSON.parse(packsJson) as unknown[];
    batch = createBatchContext(packs, { checkInternal, ...packsCheckedOf(opts) });
  } catch (e) {
    if (e instanceof EngineError) failure = JSON.stringify({ error: { code: e.code, ids: e.ids } });
    else if (e instanceof SyntaxError) failure = JSON.stringify({ error: { code: "E_INPUT_SCHEMA", ids: ["json"] } });
    else throw e;
  }
  const slots = new Map<string, Slot>();
  // 枠の番号（消した枠の番号は使い回す）
  const freeLanes: number[] = [];
  let nextLane = 0;
  const lanes = new Set<number>();
  let sinceGc = 0;
  const stateOf = (s: Slot): SlotState => (s.result === null ? "missing" : s.resultRev === s.rev ? "fresh" : "stale");
  const statusJson = (): string => {
    const out: Record<string, { rev: number; state: SlotState }> = {};
    for (const [id, s] of slots) out[id] = { rev: s.rev, state: stateOf(s) };
    return JSON.stringify(out);
  };
  const ids = (idsJson: string | undefined, all: boolean): string[] => {
    if (idsJson === undefined) return [...slots.entries()].filter(([, s]) => all || stateOf(s) !== "fresh").map(([id]) => id);
    const list = JSON.parse(idsJson) as unknown;
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string" || !slots.has(x))) throw new EngineError("E_ARGUMENT", ["session.ids"]);
    return [...new Set(list as string[])];
  };
  /** どの枠でも使っていない候補を捨てる */
  const gc = (): void => {
    if (batch === null) return;
    // 枠が使った候補と、その依存（呼んだ部品の結果）の候補をたどって残す
    const keep = new Set<Variant>();
    const todo: Variant[] = [];
    for (const s of slots.values()) for (const v of s.used) todo.push(v);
    while (todo.length > 0) {
      const v = todo.pop() as Variant;
      if (keep.has(v)) continue;
      keep.add(v);
      for (const d of v.deps) {
        if (!("t" in d)) {
          if (d.variant !== null) todo.push(d.variant);
        } else if (d.t === 4 && d.res.variant !== null) todo.push(d.res.variant);
      }
    }
    for (const p of batch.partitions.values()) {
      for (const ck of p.keys.all) {
        if (ck.variants.length > 0) ck.variants = ck.variants.filter((v: Variant) => keep.has(v));
        for (let i = 0; i < ck.prevs.length; i++) {
          const v = ck.prevs[i];
          if (v !== undefined && (!lanes.has(i) || !keep.has(v))) ck.prevs[i] = undefined;
        }
      }
    }
  };
  const guard = (f: () => string): string => {
    if (failure !== null || batch === null || packs === null) return failure ?? "";
    try {
      return f();
    } catch (e) {
      if (e instanceof EngineError) return JSON.stringify({ error: { code: e.code, ids: e.ids } });
      if (e instanceof SyntaxError) return JSON.stringify({ error: { code: "E_INPUT_SCHEMA", ids: ["json"] } });
      throw e;
    }
  };
  const session: Session = {
    set(slotsJson: string): string {
      return guard(() => {
        const given = JSON.parse(slotsJson) as unknown;
        if (given === null || typeof given !== "object" || Array.isArray(given)) throw new EngineError("E_INPUT_SCHEMA", ["/:type"]);
        for (const [id, req] of Object.entries(given as Record<string, unknown>)) {
          if (req === null) {
            const old = slots.get(id);
            if (old !== undefined) {
              slots.delete(id);
              lanes.delete(old.lane);
              freeLanes.push(old.lane);
            }
            continue;
          }
          const text = JSON.stringify(req);
          const s = slots.get(id);
          if (s === undefined) {
            const lane = freeLanes.pop() ?? nextLane++;
            lanes.add(lane);
            // 前にこの番号を使った枠の候補は、確かめる前の候補にしない（結果は同じだが、無駄に確かめないため）
            for (const p of (batch as BatchContext).partitions.values()) for (const ck of p.keys.all) if (ck.prevs.length > lane) ck.prevs[lane] = undefined;
            slots.set(id, { request: text, rev: 1, result: null, resultRev: 0, preview: false, used: [], lane });
          }
          else if (s.request !== text) {
            s.request = text;
            s.rev++;
          }
        }
        return statusJson();
      });
    },
    compute(idsJson?: string, runOptionsJson = "{}"): string {
      return guard(() => {
        const opts = JSON.parse(runOptionsJson) as { preview?: boolean };
        const preview = opts.preview === true;
        // 返す JSON は、枠に残した結果の JSON をそのまま使って作る（結果を2回 JSON にしない。0005 の追記（3回目の見直し））
        const parts: string[] = [];
        const b = batch as BatchContext;
        for (const id of ids(idsJson, false)) {
          const s = slots.get(id) as Slot;
          b.lane = s.lane;
          const result = runChecked(JSON.parse(s.request) as unknown, packs as unknown[], { checkInternal, preview, batch: b });
          s.result = JSON.stringify(result);
          s.resultRev = s.rev;
          s.preview = preview;
          s.used = b.lastUsed ?? [];
          b.lastUsed = null;
          b.lane = 0;
          sinceGc++;
          parts.push(`${JSON.stringify(id)}:{"rev":${s.rev},"state":"fresh","result":${s.result}}`);
        }
        if (sinceGc >= SESSION_GC_EVERY) {
          sinceGc = 0;
          gc();
        }
        return `{${parts.join(",")}}`;
      });
    },
    results(idsJson?: string): string {
      return guard(() => {
        const parts: string[] = [];
        for (const id of ids(idsJson, true)) {
          const s = slots.get(id) as Slot;
          parts.push(`${JSON.stringify(id)}:{"rev":${s.rev},"resultRev":${s.resultRev},"state":"${stateOf(s)}","preview":${s.preview},"result":${s.result ?? "null"}}`);
        }
        return `{${parts.join(",")}}`;
      });
    },
    status(): string {
      return guard(statusJson);
    },
    slide(slotsJson: string, focusId: string): string {
      return guard(() => {
        const st = session.set(slotsJson);
        if (st.startsWith('{"error"')) return st;
        if (!slots.has(focusId)) throw new EngineError("E_ARGUMENT", ["session.focus"]);
        const focus = session.compute(JSON.stringify([focusId]), '{"preview":true}');
        if (focus.startsWith('{"error"')) return focus;
        return `{"focus":${focus},"status":${statusJson()}}`;
      });
    },
    release(runOptionsJson = '{"preview":true}'): string {
      return guard(() => session.compute(undefined, runOptionsJson));
    },
    runBatch(requestsJson: string, runOptionsJson = "{}"): string {
      return guard(() => {
        const requests = JSON.parse(requestsJson) as unknown;
        if (!Array.isArray(requests)) throw new EngineError("E_INPUT_SCHEMA", ["/:type"]);
        const names = requests.map((_, i) => `#${i}`);
        session.set(JSON.stringify(Object.fromEntries(names.map((n, i) => [n, requests[i]]))));
        const computed = JSON.parse(session.compute(JSON.stringify(names), runOptionsJson)) as Record<string, { result: unknown }>;
        return JSON.stringify(names.map((n) => (computed[n] as { result: unknown }).result));
      });
    },
    clear(): void {
      slots.clear();
      lanes.clear();
      freeLanes.length = 0;
      nextLane = 0;
      if (batch !== null) batch.partitions.clear();
    },
  };
  return Object.freeze(session);
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

/** 入口の options の packsChecked（文字列の配列のときだけ使う） */
function packsCheckedOf(opts: { packsChecked?: unknown }): { packsChecked?: readonly string[] } {
  const c = opts.packsChecked;
  return Array.isArray(c) && c.every((x) => typeof x === "string") ? { packsChecked: c as string[] } : {};
}

/**
 * 表から作る要約（0008 の追記）。案どうしの比較（受け取り方の比較など）のための、表の期間の合計（収入・税と社会保険料・支出・年間収支）と、
 * FP顧問料（cf.expense.advisoryFee）の年ごとの額・累計・契約ごとの合計。顧問料の行は契約の物の ID（object）で分かるので、
 * 顧問料を除いた場合との差は、契約を enabled: false にした要求と比べて出す（提案の効果の内訳の材料）
 */
function summaryOf(table: readonly { row: string; year: number; amount: number; member?: string; object?: string }[], details?: { insurance?: Json; gifts?: Json; outsideWallets?: Json; childScholarships?: Json; realEstate?: Json; realEstateAnalysis?: Json }): Json {
  let income = 0;
  let taxSi = 0;
  let expense = 0;
  let net = 0;
  const feeByYear = new Map<number, number>();
  const feeByContract = new Map<string, { member: string | undefined; total: number }>();
  for (const c of table) {
    if (isUnder(c.row, "cf.income")) income += c.amount;
    else if (isUnder(c.row, "cf.taxSi")) taxSi += c.amount;
    else if (isUnder(c.row, "cf.expense")) expense += c.amount;
    else if (c.row === "cf.net") net += c.amount;
    if (isUnder(c.row, "cf.expense.advisoryFee")) {
      feeByYear.set(c.year, (feeByYear.get(c.year) ?? 0) + c.amount);
      const k = c.object ?? "";
      const e = feeByContract.get(k) ?? { member: c.member, total: 0 };
      e.total += c.amount;
      feeByContract.set(k, e);
    }
  }
  const out: Record<string, Json> = { totals: { income, taxSi, expense, net } };
  if (feeByYear.size > 0) {
    let cumulative = 0;
    const byYear: Json[] = [];
    for (const year of [...feeByYear.keys()].sort((a, b) => a - b)) {
      const amount = feeByYear.get(year) as number;
      cumulative += amount;
      byYear.push({ year, amount, cumulative });
    }
    const contracts = [...feeByContract.entries()].sort((a, b) => cmp(a[0], b[0])).map(([object, e]) => ({ ...(object === "" ? {} : { object }), ...(e.member === undefined ? {} : { member: e.member }), total: e.total }));
    out.advisoryFee = { total: cumulative, byYear, contracts } as unknown as Json;
  }
  // 保障内容一覧・払込保険料の推移の材料（insurance）と贈与の税（gifts）は、根の部品（plan.cashflow）の details から（6.8・贈与）
  if (details?.insurance !== undefined) out.insurance = details.insurance;
  if (details?.gifts !== undefined) out.gifts = details.gifts;
  // 世帯の外の家族のお金が尽きる見込みの月（0042）
  if (details?.outsideWallets !== undefined) out.outsideWallets = details.outsideWallets;
  // 子が返す貸与の奨学金（世帯の収支に入れない返済。0104）
  if (details?.childScholarships !== undefined) out.childScholarships = details.childScholarships;
  // 住まい以外の不動産の物件ごとの数字（asset.realEstate の出力。帳票の入力の材料。0009 の追記）
  if (details?.realEstate !== undefined) out.realEstate = details.realEstate;
  // 収益不動産の分析の数字（asset.realEstateAnalysis の出力。結果の画面の収益不動産のタブ・提案書の収益不動産のまとめの材料。0082）
  if (details?.realEstateAnalysis !== undefined) out.realEstateAnalysis = details.realEstateAnalysis;
  return out as unknown as Json;
}

/** 1件を計算し、出力を検査した形（先出しは見出しと表だけ）。エンジンのエラーは {error} */
function runChecked(request: unknown, packs: readonly unknown[], opts: { checkInternal: boolean; preview: boolean; batch: BatchContext }): unknown {
  try {
    const r = runEngine(request, packs, { checkInternal: opts.checkInternal, preview: opts.preview, batch: opts.batch });
    if (!opts.preview) {
      checkOutput(r, "E_OUTPUT_SCHEMA");
      return r;
    }
    // 年ごとの行（annual）は表（table）にも入っているので、先出しでは返さない（0005 の追記（3回目の見直し）: 先出しの出力を小さく）
    const p = {
      header: r.header,
      table: r.table,
      summary: r.summary,
      ...(r.protection !== undefined ? { protection: r.protection } : {}),
      ...(r.inheritanceTax !== undefined ? { inheritanceTax: r.inheritanceTax } : {}),
    };
    check("engine.preview", p, "E_OUTPUT_SCHEMA");
    return p;
  } catch (e) {
    if (e instanceof EngineError) return { error: { code: e.code, ids: e.ids } };
    throw e;
  }
}

/** runBatch の文字列の入口。requestsJson は要求の配列。結果も配列（1件ずつ結果か {error}） */
export function runBatchJson(requestsJson: string, packsJson: string | readonly unknown[], optionsJson = "{}", context?: BatchContext): string {
  try {
    const opts = JSON.parse(optionsJson) as { checkInternal?: boolean; preview?: boolean; packsChecked?: string[] };
    const requests = JSON.parse(requestsJson) as unknown;
    if (!Array.isArray(requests)) throw new EngineError("E_INPUT_SCHEMA", ["/:type"]);
    const preview = opts.preview === true;
    const checkInternal = opts.checkInternal === true;
    const packs = typeof packsJson === "string" ? (JSON.parse(packsJson) as unknown[]) : packsJson;
    const batch = context ?? createBatchContext(packs, { checkInternal, ...packsCheckedOf(opts) });
    return JSON.stringify(
      requests.map((r) => runChecked(r, packs, { checkInternal, preview, batch })),
    );
  } catch (e) {
    if (e instanceof EngineError) return JSON.stringify({ error: { code: e.code, ids: e.ids } });
    if (e instanceof SyntaxError) return JSON.stringify({ error: { code: "E_INPUT_SCHEMA", ids: ["json"] } });
    throw e;
  }
}

/** 文字列で受けて文字列で返す入口（Rust のホストと Node の両方がこれを呼ぶ） */
export function runJson(requestJson: string, packsJson: string, optionsJson = "{}"): string {
  try {
    const opts = JSON.parse(optionsJson) as { checkInternal?: boolean; packsChecked?: string[] };
    const result = runEngine(JSON.parse(requestJson), JSON.parse(packsJson) as unknown[], { checkInternal: opts.checkInternal === true, ...packsCheckedOf(opts) });
    checkOutput(result, "E_OUTPUT_SCHEMA");
    return JSON.stringify(result);
  } catch (e) {
    if (e instanceof EngineError) return JSON.stringify({ error: { code: e.code, ids: e.ids } });
    if (e instanceof SyntaxError) return JSON.stringify({ error: { code: "E_INPUT_SCHEMA", ids: ["json"] } });
    throw e;
  }
}

// 0007: エンジン側の制度データの読み取り。部品は ctx.param を通してだけ使う（0006）
import { EngineError } from "../errors.ts";
import type { RoundingMode } from "../money/integer.ts";
import { rate, type Rate } from "../money/rate.ts";
import type { RoundingRule } from "../money/rounding.ts";
import { yen, type Yen } from "../money/yen.ts";
import type { Birth } from "../time/ageSwitch.ts";
import type { Basis } from "../time/basis.ts";
import { numTable, type NumTable } from "../engine/numTable.ts";
import { dateKey, daysInMonth, formatDate, parseDate, previousDay, type CivilDate } from "../time/civil.ts";
import { parseYm, type MonthIndex } from "../time/month.ts";
import { deepFreeze } from "../engine/freeze.ts";
import { isReadableFormat } from "./format.ts";
import { comparePackVersion } from "./versions.ts";

/** このエンジンが理解する「無視できない」形式の機能（0007 の3）。まだ無い */
export const KNOWN_FEATURES: readonly string[] = [];

export type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };

export interface PackHeader {
  readonly packId: string;
  readonly formatVersion: string;
  readonly version: string;
  readonly features: readonly string[];
  readonly title: string;
  readonly fictional?: boolean;
  /** 架空のパックが、どの製品のパックの代わりか（テスト用。値ID の test. を外した ID で引ける。PR の提案） */
  readonly fictionalOf?: string;
  readonly requires: Readonly<Record<string, string>>;
}

export interface Condition {
  readonly key: string;
  readonly from?: string | number | null;
  readonly to?: string | number | null;
  readonly equals?: string;
}

export interface Entry {
  readonly rev: number;
  readonly appliesFrom: string;
  readonly appliesTo: string | null;
  /** 施行日。分からない行は null、「遅くともこの日には施行済み」だけが分かる行は {notAfter}（0007 の追記） */
  readonly enforcedOn: string | { readonly notAfter: string } | null;
  readonly status: "proposed" | "enacted";
  readonly scenarioId?: string;
  readonly jurisdiction: Json;
  readonly conditions: readonly Condition[];
  readonly value: Json;
  readonly sources: readonly Json[];
  readonly recordedIn: string;
  readonly supersededIn: string | null;
}

export interface ValueDef {
  readonly id: string;
  readonly title: string;
  readonly unit: string;
  readonly kind: string;
  readonly basis: Basis;
  readonly ageSwitch: string | null;
  readonly rounding: string | null;
  readonly linkage: string;
  readonly entries: readonly Entry[];
}

export interface PackJson {
  readonly format: "financia.regulationPack";
  readonly pack: PackHeader;
  readonly values: readonly ValueDef[];
  readonly digest: string;
}

export interface PackInfo {
  readonly packId: string;
  readonly formatVersion: string;
  readonly version: string;
  readonly asOf: string;
  readonly digest: string;
  readonly fictional: boolean;
  readonly fictionalOf?: string;
}

/** 管轄（0007 の6）。national 以外は {level, code} */
export type Jurisdiction = "national" | { readonly level: string; readonly code: string };

/** 選んだ1行と、その実際の適用終了日（null は終わりなし） */
export interface Selected {
  readonly def: ValueDef;
  readonly entry: Entry;
  /** 値の1行（<制度の値ID>@<rev>。0009 の追記）。引くたびに作らないよう選んだときに作る */
  readonly ref: string;
  readonly packVersion: string;
  readonly effectiveTo: string | null;
  /**
   * 延長の仮定（0007 の4・追記）: 適用終了の後の値がまだ分からないので、最後の行が続くとみなして選んだ。
   * 値を引いた日の年（見出しの notices に出す）
   */
  readonly extendedYear?: number;
  /** プランの dataSet の版ではこの値IDの行を1つも知らなかったので、最新の版の行を使った（PR の提案） */
  readonly recordedLater?: true;
}

/** 区間で選ぶ行（sel）、または延長の仮定で続くとみなす行（ext。引く年ごとに byYear） */
interface RegionHit {
  readonly def: ValueDef;
  readonly sel: Selected | null;
  readonly ext: Visible | null;
  readonly byYear: Map<number, Selected>;
}

interface Visible {
  readonly entry: Entry;
  /** 管轄の比べ方の鍵（jurisdictionKey）。引くたびに作らないよう前もって作る */
  readonly jurisdiction: string;
  readonly fromKey: number;
  readonly toKey: number | null;
  readonly effectiveTo: string | null;
}

export interface MatchContext {
  /** basis が birthDate、または条件 birthDate を使う値のための構成員の生年月 */
  readonly birth?: Birth;
  /** 全国以外の管轄の値を選ぶとき（協会けんぽの支部など）。省略は全国の値 */
  readonly jurisdiction?: Jurisdiction;
  /** 条件 sex を使う値のための構成員の性別 */
  readonly sex?: "female" | "male";
  /** 延長の仮定を使わない（値が無ければ E_PARAM_NO_VALUE）。改定率のように前提で延ばす値の有無を確かめるため */
  readonly noExtension?: boolean;
}

const jurisdictionKey = (j: Json | Jurisdiction | undefined): string =>
  j === undefined || j === "national" ? "national" : JSON.stringify([(j as { level: string }).level, (j as { code: string }).code]);

export class RegulationStore {
  private readonly defs = new Map<string, { def: ValueDef; pack: PackHeader; asOf: string }>();
  private readonly visible = new Map<string, readonly Visible[]>();
  private readonly infos: PackInfo[] = [];
  private readonly later = new Set<string>();
  /** 引いた結果（同じ値ID・引く日・条件なら同じ行。部品が同じ値を何度も引くので使い回す） */
  private readonly selected = new Map<string, NumTable<Selected | null>>();
  private readonly hints = new Map<string, { readonly keys: readonly number[]; readonly extendFrom: number | null }>();
  /** 引いた結果の、行が変わりうる日（boundaryHints の keys）で区切った区間ごとの使い回し（memo → 区間の番号。0005 の追記（2026-10-10）） */
  private readonly regions = new Map<string, NumTable<RegionHit>>();

  constructor(packs: readonly PackJson[], dataSet: Readonly<Record<string, string>> = {}) {
    for (const p of packs) {
      const h = p.pack;
      if (!isReadableFormat(h.formatVersion)) throw new EngineError("E_PACK_FORMAT_VERSION", [h.packId]);
      // 知らない機能を使うパックは使わずに保留する（ここではエラーにして止める）
      for (const f of h.features) if (!KNOWN_FEATURES.includes(f)) throw new EngineError("E_PACK_FEATURE", [h.packId, f]);
      if (this.infos.some((i) => i.packId === h.packId)) throw new EngineError("E_PACK_DUPLICATE", [h.packId]);
      const asOf = dataSet[h.packId] ?? h.version;
      if (comparePackVersion(asOf, h.version) > 0) throw new EngineError("E_PACK_FORMAT_VERSION", [h.packId, asOf]);
      this.infos.push({
        packId: h.packId,
        formatVersion: h.formatVersion,
        version: h.version,
        asOf,
        digest: p.digest,
        fictional: h.fictional === true,
        ...(h.fictionalOf !== undefined ? { fictionalOf: h.fictionalOf } : {}),
      });
      for (const raw of p.values) {
        // 架空のパックの test.<値ID> は、代わりをする製品のパックの <値ID> として引く
        const def = h.fictional === true && h.fictionalOf !== undefined ? { ...raw, id: raw.id.replace(/^test\./, "") } : raw;
        if (this.defs.has(def.id)) throw new EngineError("E_PACK_DUPLICATE", [def.id]);
        this.defs.set(def.id, { def, pack: h, asOf });
      }
    }
    for (const id of Object.keys(dataSet)) {
      if (!this.infos.some((i) => i.packId === id)) throw new EngineError("E_PACK_UNKNOWN", [id]);
    }
  }

  /**
   * その値の、パックの版 asOf の時点で知っていた行（初めて使うときに作る。計算ごとに全部の値の行を作らないため）。
   * dataSet の版のときにはまだ無かった値ID（後の版で足した値）は、最新の版の行を使い、見出しで知らせる
   */
  private visibleOf(id: string): readonly Visible[] {
    const hit = this.visible.get(id);
    if (hit !== undefined) return hit;
    const d = this.defs.get(id);
    if (d === undefined) return [];
    // 部品は ctx.param の結果から値の行（entry・def）に触れられるので、書き換えられないように凍結する（カスタム部品が他の部品の値を変えないため）
    deepFreeze(d.def);
    let vis = visibleEntries(d.def, d.asOf);
    if (vis.length === 0 && d.asOf !== d.pack.version) {
      vis = visibleEntries(d.def, d.pack.version);
      if (vis.length > 0) this.later.add(id);
    }
    this.visible.set(id, vis);
    return vis;
  }

  packs(): readonly PackInfo[] {
    return this.infos;
  }

  definition(id: string): ValueDef {
    const d = this.defs.get(id);
    if (d === undefined) throw new EngineError("E_PARAM_UNKNOWN", [id]);
    return d.def;
  }

  packVersionOf(id: string): string {
    const d = this.defs.get(id);
    if (d === undefined) throw new EngineError("E_PARAM_UNKNOWN", [id]);
    return d.pack.version;
  }

  /** 値の ID が制度データにあるか */
  knows(id: string): boolean {
    return this.defs.has(id);
  }

  /**
   * 区間ごとの計算（ctx.segments）のための、値の行が変わりうる日の鍵（行の適用開始と、適用終了の翌日。条件・管轄を問わず全部）と、
   * 延長の仮定が始まりうる日の鍵（同じ条件・管轄の組の最後の行がどれも終わる組のうち、最も早く終わる組の終わりの翌日。無ければ null）
   */
  boundaryHints(id: string): { readonly keys: readonly number[]; readonly extendFrom: number | null } {
    const hit = this.hints.get(id);
    if (hit !== undefined) return hit;
    const keys = new Set<number>();
    const lastOf = new Map<string, number | null>();
    for (const v of this.visibleOf(id)) {
      keys.add(v.fromKey);
      if (v.toKey !== null) keys.add(v.toKey + 1);
      const g = `${JSON.stringify(v.entry.conditions)}|${v.jurisdiction}`;
      const cur = lastOf.get(g);
      if (cur === null) continue;
      lastOf.set(g, v.toKey === null ? null : cur === undefined || v.toKey > cur ? v.toKey : cur);
    }
    let extendFrom: number | null = null;
    for (const last of lastOf.values()) if (last !== null && (extendFrom === null || last + 1 < extendFrom)) extendFrom = last + 1;
    const out = { keys: [...keys].sort((a, b) => a - b), extendFrom };
    this.hints.set(id, out);
    return out;
  }

  /** 引く日（basis から決めたもの）の行を1つだけ選ぶ */
  select(id: string, date: CivilDate, mc: MatchContext = {}): Selected {
    const s = this.trySelect(id, date, mc);
    if (s === null) throw new EngineError("E_PARAM_NO_VALUE", [id]);
    return s;
  }

  /** select と同じ。値が無いときはエラーにせず null を返す（有無だけを見るときに、エラーを作る手間を省くため） */
  trySelect(id: string, date: CivilDate, mc: MatchContext = {}): Selected | null {
    const key = dateKey(date);
    const j = mc.jurisdiction;
    const want = j === undefined || j === "national" ? "national" : jurisdictionKey(j);
    // 鍵: 値ID と条件（管轄・生年月・性別・延長の有無）→ 引く日
    const memo =
      want === "national" && mc.birth === undefined && mc.sex === undefined && mc.noExtension !== true
        ? id
        : `${id}|${want}|${mc.birth === undefined ? "" : `${mc.birth.birthYearMonth}${mc.birth.bornOnFirst ? "+" : ""}`}|${mc.sex ?? ""}|${mc.noExtension === true ? "x" : ""}`;
    let byDate = this.selected.get(memo);
    if (byDate === undefined) {
      byDate = numTable<Selected | null>();
      this.selected.set(memo, byDate);
    }
    const hit = byDate[key];
    if (hit !== undefined) return hit;
    // 行が変わりうる日（どの条件・管轄の行の適用開始と適用終了の翌日。boundaryHints）の間（区間）では、引く日の範囲に入る行の組が同じなので、
    // 選ばれる行も同じ（延長の仮定は年だけが違う）。区間ごとに1回だけ行を探す（日ごとに探したときと同じ結果・同じ誤り）
    const keys = this.boundaryHints(id).keys;
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((keys[mid] as number) <= key) lo = mid + 1;
      else hi = mid;
    }
    let byRegion = this.regions.get(memo);
    if (byRegion === undefined) {
      byRegion = numTable<RegionHit>();
      this.regions.set(memo, byRegion);
    }
    let r = byRegion[lo];
    if (r === undefined) {
      r = this.regionHit(id, key, want, mc);
      byRegion[lo] = r;
    }
    let s: Selected | null;
    if (r.ext === null) s = r.sel;
    else {
      s = r.byYear.get(date.year) ?? null;
      if (s === null) {
        const ext = r.ext;
        s = Object.freeze({
          def: r.def,
          entry: ext.entry,
          ref: `${id}@${ext.entry.rev}`,
          packVersion: ext.entry.recordedIn,
          effectiveTo: ext.effectiveTo,
          extendedYear: date.year,
          ...(this.later.has(id) ? { recordedLater: true as const } : {}),
        });
        r.byYear.set(date.year, s);
      }
    }
    byDate[key] = s;
    return s;
  }

  /** 引く日 key の区間で選ぶ行（延長の仮定なら、その行。値が無ければ sel も ext も null） */
  private regionHit(id: string, key: number, want: string, mc: MatchContext): RegionHit {
    const def = this.definition(id);
    const hits: Visible[] = [];
    for (const v of this.visibleOf(id)) {
      if (v.fromKey > key || (v.toKey !== null && v.toKey < key)) continue;
      if (v.jurisdiction !== want) continue;
      if (!matchConditions(v.entry.conditions, mc, id)) continue;
      hits.push(v);
    }
    if (hits.length === 0) {
      // 延長の仮定（0007 の追記）: 期限の後の値が分からない（同じ条件・管轄の最後の行が、引く日より前に終わる）ときは、
      // 計算を止めずに最後の行が続くとみなす。最初の行より前の日は値が無いので止める
      const ext = mc.noExtension === true ? null : this.extension(id, key, want, mc);
      return { def, sel: null, ext, byYear: new Map() };
    }
    if (hits.length > 1) throw new EngineError("E_PARAM_AMBIGUOUS", [id]);
    const hit = hits[0] as Visible;
    const sel: Selected = Object.freeze({ def, entry: hit.entry, ref: `${id}@${hit.entry.rev}`, packVersion: hit.entry.recordedIn, effectiveTo: hit.effectiveTo, ...(this.later.has(id) ? { recordedLater: true as const } : {}) });
    return { def, sel, ext: null, byYear: new Map() };
  }

  /** 引く日より前に終わる行のうち最後のもの（その後に始まる行が無いときだけ）。同じ条件の組で1つに決まらなければエラー */
  private extension(id: string, key: number, want: string, mc: MatchContext): Visible | null {
    const groups = new Map<string, Visible>();
    for (const v of this.visibleOf(id)) {
      if (v.jurisdiction !== want) continue;
      if (!matchConditions(v.entry.conditions, mc, id)) continue;
      if (v.fromKey > key) return null;
      if (v.toKey === null) continue;
      const g = JSON.stringify(v.entry.conditions);
      const cur = groups.get(g);
      if (cur === undefined || (cur.toKey as number) < v.toKey) groups.set(g, v);
    }
    if (groups.size > 1) throw new EngineError("E_PARAM_AMBIGUOUS", [id]);
    return [...groups.values()][0] ?? null;
  }
}

/**
 * 0007 の8: パックの版 asOf の時点で知っていた行（recordedIn ≦ asOf、まだ訂正されていない）。
 * 案（proposed）はまだ使わない（シナリオの選び方は次の作業）
 */
function visibleEntries(def: ValueDef, asOf: string): Visible[] {
  const known = def.entries.filter(
    (e) =>
      comparePackVersion(e.recordedIn, asOf) <= 0 &&
      (e.supersededIn === null || comparePackVersion(e.supersededIn, asOf) > 0) &&
      e.status === "enacted",
  );
  // 適用終了が null の行は「同じ条件・管轄の次の行の適用開始の前日まで」
  // 組の鍵は行ごとに1回だけ作る（行どうしを比べるたびに作らない。0005 の追記（2026-10-10））
  const groups = known.map((e) => `${JSON.stringify(e.conditions)}|${jurisdictionKey(e.jurisdiction)}`);
  const out: Visible[] = [];
  for (let i = 0; i < known.length; i++) {
    const e = known[i] as Entry;
    let effectiveTo = e.appliesTo;
    if (effectiveTo === null) {
      const sameGroup = groups[i];
      let next: string | null = null;
      for (let k = 0; k < known.length; k++) {
        const o = known[k] as Entry;
        if (o === e || groups[k] !== sameGroup) continue;
        if (o.appliesFrom > e.appliesFrom && (next === null || o.appliesFrom < next)) next = o.appliesFrom;
      }
      if (next !== null) effectiveTo = formatDate(previousDay(parseDate(next)));
    }
    out.push({
      entry: e,
      jurisdiction: jurisdictionKey(e.jurisdiction),
      fromKey: dateKey(parseDate(e.appliesFrom)),
      toKey: effectiveTo === null ? null : dateKey(parseDate(effectiveTo)),
      effectiveTo,
    });
  }
  return out;
}

function matchConditions(conditions: readonly Condition[], mc: MatchContext, id: string): boolean {
  for (const c of conditions) {
    if (c.key === "sex") {
      if (mc.sex === undefined) throw new EngineError("E_ARGUMENT", [id, "sex"]);
      if (c.equals !== mc.sex) return false;
      continue;
    }
    if (c.key !== "birthDate") throw new EngineError("E_PARAM_UNSUPPORTED", [id, `condition.${c.key}`]);
    if (mc.birth === undefined) throw new EngineError("E_ARGUMENT", [id, "birth"]);
    const r = matchBirthDate(mc.birth, c);
    if (r === "ambiguous") throw new EngineError("E_PARAM_AMBIGUOUS", [id, "birthDate"]);
    if (!r) return false;
  }
  return true;
}

/** 生年月＋1日生まれか（0012）で、生年月日の範囲の条件に当たるか。月の途中の境目では決まらないことがある */
function matchBirthDate(birth: Birth, c: Condition): boolean | "ambiguous" {
  const [y, m] = birth.birthYearMonth.split("-").map(Number) as [number, number];
  const lo = dateKey({ year: y, month: m, day: birth.bornOnFirst ? 1 : 2 });
  const hi = dateKey({ year: y, month: m, day: birth.bornOnFirst ? 1 : daysInMonth(y, m) });
  const from = typeof c.from === "string" ? dateKey(parseDate(c.from)) : null;
  const to = typeof c.to === "string" ? dateKey(parseDate(c.to)) : null;
  const allIn = (from === null || lo >= from) && (to === null || hi <= to);
  const allOut = (from !== null && hi < from) || (to !== null && lo > to);
  if (allIn) return true;
  if (allOut) return false;
  return "ambiguous";
}

// 値の種類ごとの取り出し（constant・rounding・bracketTable・gradeTable）。選んだ行（Selected）は使い回すので、取り出した形も行ごとに使い回す
// 取り出した形は値の行（entry）ごとに同じなので、行で使い回す（取り出した形は undefined にならない）
const CONVERTED = new WeakMap<Entry, unknown>();
function converted<T>(s: Selected, make: () => T): T {
  const hit = CONVERTED.get(s.entry);
  if (hit !== undefined) return hit as T;
  const v = make();
  CONVERTED.set(s.entry, v);
  return v;
}

export function asYen(s: Selected): Yen | null {
  if (s.def.kind !== "constant" || s.def.unit !== "JPY") throw new EngineError("E_PARAM_KIND", [s.def.id]);
  return s.entry.value === "notApplicable" ? null : yen(s.entry.value as number);
}

export function asRate(s: Selected): Rate | null {
  if (s.def.kind !== "constant" || s.def.unit !== "rate") throw new EngineError("E_PARAM_KIND", [s.def.id]);
  return s.entry.value === "notApplicable" ? null : converted(s, () => rate(s.entry.value as string));
}

/** 回数・年齢などの整数（unit: count・years・months） */
export function asCount(s: Selected): number | null {
  if (s.def.kind !== "constant" || !["count", "years", "months"].includes(s.def.unit)) throw new EngineError("E_PARAM_KIND", [s.def.id]);
  return s.entry.value === "notApplicable" ? null : (s.entry.value as number);
}

export function asRoundingRule(s: Selected): RoundingRule {
  if (s.def.kind !== "rounding") throw new EngineError("E_PARAM_KIND", [s.def.id]);
  return converted(s, () => {
    const v = s.entry.value as { mode: RoundingMode; unit: number };
    return Object.freeze({ mode: v.mode, unit: v.unit });
  });
}

export interface Bracket {
  readonly upTo: Yen | null;
  readonly amount?: Yen;
  readonly rate?: Rate;
}

export function asBrackets(s: Selected): readonly Bracket[] | null {
  if (s.def.kind !== "bracketTable") throw new EngineError("E_PARAM_KIND", [s.def.id]);
  if (s.entry.value === "notApplicable") return null;
  return converted(s, () =>
    Object.freeze(
      (s.entry.value as readonly { upTo: number | null; amount?: number; rate?: string }[]).map((b) =>
        Object.freeze({
          upTo: b.upTo === null ? null : yen(b.upTo),
          ...(b.amount !== undefined ? { amount: yen(b.amount) } : {}),
          ...(b.rate !== undefined ? { rate: rate(b.rate) } : {}),
        }),
      ),
    ),
  );
}

/** 段階表で x が当たる段（upTo 以下の最初の段） */
export function bracketFor(brackets: readonly Bracket[], x: Yen): Bracket {
  for (const b of brackets) if (b.upTo === null || x <= b.upTo) return b;
  throw new EngineError("E_ARGUMENT", ["bracket"]);
}

/** 0007 の追記: 等級表の1行。報酬月額 from 以上 below 未満（below が null は上限なし）で、その等級の額が amount */
export interface Grade {
  readonly grade: number;
  readonly amount: Yen;
  readonly from: Yen;
  readonly below: Yen | null;
}

export function asGrades(s: Selected): readonly Grade[] | null {
  if (s.def.kind !== "gradeTable") throw new EngineError("E_PARAM_KIND", [s.def.id]);
  if (s.entry.value === "notApplicable") return null;
  return converted(s, () =>
    Object.freeze(
      (s.entry.value as readonly { grade: number; amount: number; from: number; below: number | null }[]).map((g) =>
        Object.freeze({
          grade: g.grade,
          amount: yen(g.amount),
          from: yen(g.from),
          below: g.below === null ? null : yen(g.below),
        }),
      ),
    ),
  );
}

/** 0007 の追記（2回目の見直し）: 期間の表の1行。月が from〜to（両端を含む。to が null は上限なし）なら率 rate */
export interface PeriodRate {
  readonly from: MonthIndex;
  readonly to: MonthIndex | null;
  readonly rate: Rate;
}

export function asPeriodRates(s: Selected): readonly PeriodRate[] | null {
  if (s.def.kind !== "periodTable") throw new EngineError("E_PARAM_KIND", [s.def.id]);
  if (s.entry.value === "notApplicable") return null;
  return converted(s, () =>
    Object.freeze(
      (s.entry.value as readonly { from: string; to: string | null; rate: string }[]).map((p) =>
        Object.freeze({ from: parseYm(p.from), to: p.to === null ? null : parseYm(p.to), rate: rate(p.rate) }),
      ),
    ),
  );
}

/** 期間の表で月 m が当たる行（無ければ null。二分探索） */
export function periodRateFor(rows: readonly PeriodRate[], m: MonthIndex): PeriodRate | null {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((rows[mid] as PeriodRate).from <= m) lo = mid + 1;
    else hi = mid;
  }
  const r = rows[lo - 1];
  return r !== undefined && (r.to === null || m <= r.to) ? r : null;
}

/** 等級表で x が当たる行 */
export function gradeFor(grades: readonly Grade[], x: Yen): Grade {
  for (const g of grades) if (x >= g.from && (g.below === null || x < g.below)) return g;
  throw new EngineError("E_ARGUMENT", ["grade"]);
}

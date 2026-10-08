// 0007: エンジン側の制度データの読み取り。部品は ctx.param を通してだけ使う（0006）
import { EngineError } from "../errors.ts";
import type { RoundingMode } from "../money/integer.ts";
import { rate, type Rate } from "../money/rate.ts";
import type { RoundingRule } from "../money/rounding.ts";
import { yen, type Yen } from "../money/yen.ts";
import type { Birth } from "../time/ageSwitch.ts";
import type { Basis } from "../time/basis.ts";
import { dateKey, daysInMonth, formatDate, parseDate, previousDay, type CivilDate } from "../time/civil.ts";
import { comparePackVersion } from "./versions.ts";

export const SUPPORTED_FORMAT_MAJOR = 1;
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
  readonly enforcedOn: string;
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
}

/** 選んだ1行と、その実際の適用終了日（null は終わりなし） */
export interface Selected {
  readonly def: ValueDef;
  readonly entry: Entry;
  readonly packVersion: string;
  readonly effectiveTo: string | null;
}

interface Visible {
  readonly entry: Entry;
  readonly fromKey: number;
  readonly toKey: number | null;
  readonly effectiveTo: string | null;
}

export interface MatchContext {
  /** basis が birthDate、または条件 birthDate を使う値のための構成員の生年月 */
  readonly birth?: Birth;
}

export class RegulationStore {
  private readonly defs = new Map<string, { def: ValueDef; pack: PackHeader }>();
  private readonly visible = new Map<string, readonly Visible[]>();
  private readonly infos: PackInfo[] = [];

  constructor(packs: readonly PackJson[], dataSet: Readonly<Record<string, string>> = {}) {
    for (const p of packs) {
      const h = p.pack;
      if (Number(h.formatVersion.split(".")[0]) !== SUPPORTED_FORMAT_MAJOR) {
        throw new EngineError("E_PACK_FORMAT_VERSION", [h.packId]);
      }
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
      });
      for (const def of p.values) {
        if (this.defs.has(def.id)) throw new EngineError("E_PACK_DUPLICATE", [def.id]);
        this.defs.set(def.id, { def, pack: h });
        this.visible.set(def.id, visibleEntries(def, asOf));
      }
    }
    for (const id of Object.keys(dataSet)) {
      if (!this.infos.some((i) => i.packId === id)) throw new EngineError("E_PACK_UNKNOWN", [id]);
    }
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

  /** 引く日（basis から決めたもの）の行を1つだけ選ぶ */
  select(id: string, date: CivilDate, mc: MatchContext = {}): Selected {
    const def = this.definition(id);
    const key = dateKey(date);
    const hits: Visible[] = [];
    for (const v of this.visible.get(id) ?? []) {
      if (v.fromKey > key || (v.toKey !== null && v.toKey < key)) continue;
      if (!matchConditions(v.entry.conditions, mc, id)) continue;
      hits.push(v);
    }
    if (hits.length === 0) throw new EngineError("E_PARAM_NO_VALUE", [id]);
    if (hits.length > 1) throw new EngineError("E_PARAM_AMBIGUOUS", [id]);
    const hit = hits[0] as Visible;
    return { def, entry: hit.entry, packVersion: hit.entry.recordedIn, effectiveTo: hit.effectiveTo };
  }
}

/**
 * 0007 の8: パックの版 asOf の時点で知っていた行（recordedIn ≦ asOf、まだ訂正されていない）。
 * 案（proposed）と全国以外の管轄は、土台ではまだ使わない
 */
function visibleEntries(def: ValueDef, asOf: string): Visible[] {
  const known = def.entries.filter(
    (e) =>
      comparePackVersion(e.recordedIn, asOf) <= 0 &&
      (e.supersededIn === null || comparePackVersion(e.supersededIn, asOf) > 0) &&
      e.status === "enacted" &&
      e.jurisdiction === "national",
  );
  // 適用終了が null の行は「同じ条件の次の行の適用開始の前日まで」
  const out: Visible[] = [];
  for (const e of known) {
    let effectiveTo = e.appliesTo;
    if (effectiveTo === null) {
      const sameGroup = JSON.stringify(e.conditions);
      let next: string | null = null;
      for (const o of known) {
        if (o === e || JSON.stringify(o.conditions) !== sameGroup) continue;
        if (o.appliesFrom > e.appliesFrom && (next === null || o.appliesFrom < next)) next = o.appliesFrom;
      }
      if (next !== null) effectiveTo = formatDate(previousDay(parseDate(next)));
    }
    out.push({
      entry: e,
      fromKey: dateKey(parseDate(e.appliesFrom)),
      toKey: effectiveTo === null ? null : dateKey(parseDate(effectiveTo)),
      effectiveTo,
    });
  }
  return out;
}

function matchConditions(conditions: readonly Condition[], mc: MatchContext, id: string): boolean {
  for (const c of conditions) {
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

// 値の種類ごとの取り出し（土台では constant・rounding・bracketTable だけ）

export function asYen(s: Selected): Yen | null {
  if (s.def.kind !== "constant" || s.def.unit !== "JPY") throw new EngineError("E_PARAM_KIND", [s.def.id]);
  return s.entry.value === "notApplicable" ? null : yen(s.entry.value as number);
}

export function asRate(s: Selected): Rate | null {
  if (s.def.kind !== "constant" || s.def.unit !== "rate") throw new EngineError("E_PARAM_KIND", [s.def.id]);
  return s.entry.value === "notApplicable" ? null : rate(s.entry.value as string);
}

export function asRoundingRule(s: Selected): RoundingRule {
  if (s.def.kind !== "rounding") throw new EngineError("E_PARAM_KIND", [s.def.id]);
  const v = s.entry.value as { mode: RoundingMode; unit: number };
  return { mode: v.mode, unit: v.unit };
}

export interface Bracket {
  readonly upTo: Yen | null;
  readonly amount?: Yen;
  readonly rate?: Rate;
}

export function asBrackets(s: Selected): readonly Bracket[] | null {
  if (s.def.kind !== "bracketTable") throw new EngineError("E_PARAM_KIND", [s.def.id]);
  if (s.entry.value === "notApplicable") return null;
  return (s.entry.value as readonly { upTo: number | null; amount?: number; rate?: string }[]).map((b) => ({
    upTo: b.upTo === null ? null : yen(b.upTo),
    ...(b.amount !== undefined ? { amount: yen(b.amount) } : {}),
    ...(b.rate !== undefined ? { rate: rate(b.rate) } : {}),
  }));
}

/** 段階表で x が当たる段（upTo 以下の最初の段） */
export function bracketFor(brackets: readonly Bracket[], x: Yen): Bracket {
  for (const b of brackets) if (b.upTo === null || x <= b.upTo) return b;
  throw new EngineError("E_ARGUMENT", ["bracket"]);
}

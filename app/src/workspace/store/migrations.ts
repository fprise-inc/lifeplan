// 他のソフトからの移行の取り込みの記録（本文の区画 migrations。形式の版 0.56 から。0113 の10・0011 の追記）。
// 移行したことの無い世帯は区画ごと無い（明細の区画 statements と同じ置き方）。元のファイル・ファイル名・伏せ字の前の文字・家族の名前・
// 移行元のソフトの計算の式は持たない。読むときは形を確かめ、形の合わない記録・行は捨てる（知らない欄は持たない）。
// 取り込みの記録を作るのは移行の部品（0113 の実装の段取りの2）で、この版では形と読み書きだけ。
// あわせて、互換モード（calcConventions.compatibility。0113 の8）の source.import が世帯の取り込みの記録に無いときに null に直す
import type { EngineRequest } from "../../engine/types.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { migrationId } from "./readings.ts";

export const MIGRATION_LOG_VERSION = 1;

/** 読み取った値の対応先（0113 の5 の5種類のうち、記録に残る3つ。読まない drop は何も残さない） */
export type MigrationTarget = { item: string; member?: string; object?: string } | { row: string } | { memo: true };

/** 伏せ字の後の抽出結果の1行 */
export interface MigrationExtracted {
  block: string;
  label: string;
  text: string;
  to: MigrationTarget;
  /** どこから決まったか（規則・覚えた対応・AI の候補・FP） */
  decidedBy: "rule" | "learned" | "ai" | "fp";
}

/** 参照値（0004 の7 の形に precision を足したもの。計算に入らない） */
export interface MigrationReferenceValue {
  row: string;
  year: number;
  amount: number;
  label?: string;
  basisMonth?: string;
  /** 移行元の数字の単位（円で 1・1000・10000） */
  precision?: 1 | 1000 | 10000;
}

/** 移行元の数え方（規則が言ったものに、照合の画面で FP が直したものを重ねた。0113 の4・8） */
export interface MigrationConventions {
  tableAge?: "yearEnd" | "yearStart";
  tableBalance?: "yearEnd" | "yearStart";
  ageTiming?: "month" | "yearOfReach" | "yearAfterReach";
  firstYear?: "fromBaseMonth" | "wholeYear";
  growthStart?: "nextYear" | "baseYear";
  aggregation?: "cash" | "accrual";
  investmentTiming?: "midYear" | "beginning" | "end";
  valueBasis?: "nominal" | "presentValue";
}

/** 取り込みの記録（移行）の1件（0113 の10） */
export interface MigrationImport {
  id: string;
  kind: "migration";
  at: string;
  approvedBy: "fp";
  file: { sha256: string; bytes: number };
  reader: { id: string; version: number };
  rule: { id: string; revision: number; contract: string };
  dictionaries: { id: string; revision: number }[];
  source: { product: string | null; document: string; edition?: string; planBaseMonth?: string };
  extracted: MigrationExtracted[];
  referenceValues: MigrationReferenceValue[];
  memo: { label: string; text: string }[];
  conventions: MigrationConventions;
  candidates: string[];
  ai: { headings: boolean };
}

export interface MigrationLog {
  version: number;
  imports: MigrationImport[];
}

/** 上限（明細と同じ考え方で、読み込みで太らせない。値は内部） */
const MAX_IMPORTS = 200;
const MAX_ROWS = 5000;
const MAX_REFERENCE = 50000;
const TEXT = 1000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const text = (v: unknown, max = TEXT): v is string => typeof v === "string" && v.length <= max;
const posInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
const DOTTED = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/u;
const ROW = /^cf(\.[a-z][a-zA-Z0-9]*)+$/u;
const NAME = /^[a-z][a-zA-Z0-9]*$/u;
const YM = /^[0-9]{4}-(0[1-9]|1[0-2])$/u;
const SHA = /^sha256:[0-9a-f]{64}$/u;
const CONTRACT = /^migration-rule@1\.[0-9]+$/u;
/** 取り込みの記録の ID（互換モードの source.import と同じ形。engine.input.json） */
const IMPORT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const ROLES = ["self", "spouse", "child", "parent", "grandparent", "sibling", "grandchild", "other"];
const DECIDED = ["rule", "learned", "ai", "fp"] as const;
const CONVENTIONS: Readonly<Record<keyof MigrationConventions, readonly string[]>> = {
  tableAge: ["yearEnd", "yearStart"],
  tableBalance: ["yearEnd", "yearStart"],
  ageTiming: ["month", "yearOfReach", "yearAfterReach"],
  firstYear: ["fromBaseMonth", "wholeYear"],
  growthStart: ["nextYear", "baseYear"],
  aggregation: ["cash", "accrual"],
  investmentTiming: ["midYear", "beginning", "end"],
  valueBasis: ["nominal", "presentValue"],
};

function readTarget(v: unknown): MigrationTarget | null {
  if (!isObj(v)) return null;
  if (typeof v.item === "string" && DOTTED.test(v.item) && v.row === undefined && v.memo === undefined) {
    if (v.member !== undefined && !ROLES.includes(v.member as string)) return null;
    if (v.object !== undefined && !(typeof v.object === "string" && NAME.test(v.object))) return null;
    return { item: v.item, ...(typeof v.member === "string" ? { member: v.member } : {}), ...(typeof v.object === "string" ? { object: v.object } : {}) };
  }
  if (typeof v.row === "string" && ROW.test(v.row) && v.item === undefined && v.memo === undefined) return { row: v.row };
  if (v.memo === true && v.item === undefined && v.row === undefined) return { memo: true };
  return null;
}

function readExtracted(v: unknown): MigrationExtracted | null {
  if (!isObj(v) || !(typeof v.block === "string" && NAME.test(v.block)) || !text(v.label) || !text(v.text)) return null;
  const to = readTarget(v.to);
  if (to === null || !(DECIDED as readonly unknown[]).includes(v.decidedBy)) return null;
  return { block: v.block, label: v.label, text: v.text, to, decidedBy: v.decidedBy as MigrationExtracted["decidedBy"] };
}

function readReference(v: unknown): MigrationReferenceValue | null {
  if (!isObj(v) || !(typeof v.row === "string" && ROW.test(v.row)) || !Number.isSafeInteger(v.year) || (v.year as number) < 1900 || (v.year as number) > 2200 || !Number.isSafeInteger(v.amount)) return null;
  if (v.precision !== undefined && v.precision !== 1 && v.precision !== 1000 && v.precision !== 10000) return null;
  if (v.basisMonth !== undefined && !(typeof v.basisMonth === "string" && YM.test(v.basisMonth))) return null;
  return {
    row: v.row,
    year: v.year as number,
    amount: v.amount as number,
    ...(text(v.label) && v.label !== "" ? { label: v.label } : {}),
    ...(typeof v.basisMonth === "string" ? { basisMonth: v.basisMonth } : {}),
    ...(v.precision !== undefined ? { precision: v.precision as 1 | 1000 | 10000 } : {}),
  };
}

function readConventions(v: unknown): MigrationConventions {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, values] of Object.entries(CONVENTIONS)) if (typeof v[k] === "string" && values.includes(v[k])) out[k] = v[k];
  return out as MigrationConventions;
}

function readImport(v: unknown): MigrationImport | null {
  if (!isObj(v) || !(str(v.id, 64) && IMPORT_ID.test(v.id)) || v.kind !== "migration" || !str(v.at, 40) || v.approvedBy !== "fp") return null;
  const f = v.file;
  if (!isObj(f) || !(typeof f.sha256 === "string" && SHA.test(f.sha256)) || !Number.isSafeInteger(f.bytes) || (f.bytes as number) < 0) return null;
  const r = v.reader;
  if (!isObj(r) || !str(r.id, 40) || !posInt(r.version)) return null;
  const rule = v.rule;
  if (!isObj(rule) || !(typeof rule.id === "string" && DOTTED.test(rule.id) && rule.id.length <= 128) || !posInt(rule.revision) || !(typeof rule.contract === "string" && CONTRACT.test(rule.contract))) return null;
  const s = v.source;
  if (!isObj(s) || !(s.product === null || str(s.product)) || !str(s.document)) return null;
  if (s.planBaseMonth !== undefined && !(typeof s.planBaseMonth === "string" && YM.test(s.planBaseMonth))) return null;
  const list = (x: unknown, max: number): unknown[] => (Array.isArray(x) ? x.slice(0, max) : []);
  const dictionaries = list(v.dictionaries, 20).flatMap((d) => (isObj(d) && typeof d.id === "string" && DOTTED.test(d.id) && d.id.length <= 128 && posInt(d.revision) ? [{ id: d.id, revision: d.revision }] : []));
  const ai = isObj(v.ai) ? v.ai : {};
  return {
    id: v.id,
    kind: "migration",
    at: v.at,
    approvedBy: "fp",
    file: { sha256: f.sha256, bytes: f.bytes as number },
    reader: { id: r.id, version: r.version },
    rule: { id: rule.id, revision: rule.revision, contract: rule.contract },
    dictionaries,
    source: { product: s.product as string | null, document: s.document, ...(str(s.edition) ? { edition: s.edition } : {}), ...(typeof s.planBaseMonth === "string" ? { planBaseMonth: s.planBaseMonth } : {}) },
    extracted: list(v.extracted, MAX_ROWS).map(readExtracted).filter((x): x is MigrationExtracted => x !== null),
    referenceValues: list(v.referenceValues, MAX_REFERENCE).map(readReference).filter((x): x is MigrationReferenceValue => x !== null),
    memo: list(v.memo, MAX_ROWS).flatMap((m) => (isObj(m) && text(m.label) && text(m.text) ? [{ label: m.label, text: m.text }] : [])),
    conventions: readConventions(v.conventions),
    candidates: list(v.candidates, MAX_ROWS).filter((x): x is string => str(x, 64)),
    ai: { headings: ai.headings === true },
  };
}

/** 区画 migrations を読む（形の合わない記録・行は捨てる。同じ ID の記録は先の1件だけ） */
export function readMigrationLog(v: unknown): MigrationLog {
  if (!isObj(v)) return { version: MIGRATION_LOG_VERSION, imports: [] };
  const seen = new Set<string>();
  const imports = (Array.isArray(v.imports) ? v.imports.slice(0, MAX_IMPORTS) : []).flatMap((x) => {
    const i = readImport(x);
    if (i === null || seen.has(i.id)) return [];
    seen.add(i.id);
    return [i];
  });
  return { version: MIGRATION_LOG_VERSION, imports };
}

/** 残す中身があるか（空の記録は区画を作らない） */
export function hasMigrations(l: MigrationLog): boolean {
  return l.imports.length > 0;
}

/**
 * 互換モードの source.import が世帯の移行の取り込みの記録に無いとき、互換モードを null に直し、開いたときの知らせを出す（0113 の8）。
 * 互換モードを持てるのは、その世帯の取り込みの記録から作った照合用のプランだけ。今は現状の計算の要求だけを見る
 * （プランの差分で互換モードを付ける形は、照合の画面を作る回に決める。0113 の実装の段取りの4）。控え（snapshots）は変えない
 */
export function withoutOrphanCompatibility(wh: WorkingHousehold): WorkingHousehold {
  const conv = (wh.request.input as unknown as { calcConventions?: { compatibility?: unknown } }).calcConventions;
  const compat = conv?.compatibility;
  if (compat === undefined || compat === null) return wh;
  const ids = new Set((wh.migrations?.imports ?? []).map((i) => i.id));
  const ref = isObj(compat) && isObj(compat.source) ? compat.source.import : undefined;
  if (typeof ref === "string" && ids.has(ref)) return wh;
  const input = { ...(wh.request.input as unknown as Record<string, unknown>), calcConventions: { ...conv, compatibility: null } };
  const request = { ...wh.request, input } as unknown as EngineRequest;
  const id = migrationId("notices/compatibilityDropped");
  const notices = (wh.notices ?? []).some((x) => x.id === id) ? wh.notices : [...(wh.notices ?? []), { id, kind: "compatibilityDropped" }];
  return { ...wh, request, ...(notices !== undefined ? { notices } : {}) };
}

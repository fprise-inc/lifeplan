// 書類の読み取りの記録（本文の区画 documents。形式の版 0.68 から。0148 の1）。読んでいない世帯は区画ごと無い。
// 読むときは形を確かめ、形の合わない記録・候補は捨てる（知らない欄は持たない）。文字は読むときにも番号を消し直す（privacy.ts）。
// 元に戻す・やり直すの対象にしない（明細の取り込みの記録と同じ。承認で変えた現状の値は、元に戻せる変更として入れる）
// 取り込みを外した書類（0159）の記録も捨てずに読む（書類の種類・物の種類をそのまま残す。確かめの画面では見るだけ。番号を消し直すのは同じ）
import type { WorkingHousehold } from "../input/household.ts";
import { knownItem } from "./proposal.ts";
import { cleanText, cleanValue, isPersonalNumberValue } from "./privacy.ts";
import { NEW_OBJECT_KINDS, RETIRED_OBJECT_KINDS } from "./objects.ts";
import { DOC_TYPES, DOCUMENT_LOG_VERSION, isRetired, RETIRED_DOC_TYPES, LIMITS, type AppliedTo, type CandidateStatus, type CandidateTarget, type CandidateValue, type Confidence, type DocCandidate, type DocDecision, type DocObject, type DocReference, type DocSource, type DocumentLog, type DocumentReading, type RecordedDocType, type Via } from "./types.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ROLE = /^(self|spouse|holder|child[1-9][0-9]?|other[1-9][0-9]?)$/u;
const AT_STEP = /^[A-Za-z0-9_-]{1,40}$/u;
const OBJECT_KEY = /^[A-Za-z0-9_-]{1,16}$/u;
const YM = /^[0-9]{4}-(0[1-9]|1[0-2])$/u;
const ROW = /^cf(\.[a-z][a-zA-Z0-9]*)+$/u;
const PATH = /^[A-Za-z0-9_./-]{1,120}$/u;
const SHA = /^sha256:[0-9a-f]{64}$/u;
const TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?(Z|[+-][0-9]{2}:[0-9]{2})$/u;
const READER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const VIAS: readonly Via[] = ["reader", "ai", "paste", "sample"];
const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];
const STATUSES: readonly CandidateStatus[] = ["pending", "accepted", "corrected", "rejected"];

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = cleanText(v, max).text;
  return t === "" ? undefined : t;
};

function readSource(v: unknown): DocSource {
  if (!isObj(v)) return {};
  const out: DocSource = {};
  if (Number.isSafeInteger(v.page) && (v.page as number) >= 1 && (v.page as number) <= 999) out.page = v.page as number;
  const where = text(v.where, LIMITS.where);
  if (where !== undefined) out.where = where;
  const t = text(v.text, LIMITS.sourceText);
  if (t !== undefined) out.text = t;
  if (Array.isArray(v.box) && v.box.length === 4 && v.box.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1)) out.box = [v.box[0], v.box[1], v.box[2], v.box[3]] as [number, number, number, number];
  if (typeof v.path === "string" && PATH.test(v.path)) out.path = v.path;
  return out;
}

function readValue(v: unknown): CandidateValue | null | undefined {
  if (v === null || v === undefined) return null;
  if (isPersonalNumberValue(v)) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return cleanValue(v, LIMITS.textValue).text;
  return undefined;
}

function readTarget(v: unknown, keys: ReadonlySet<string>): CandidateTarget | null {
  if (!isObj(v) || typeof v.item !== "string" || !knownItem(v.item)) return null;
  const t: CandidateTarget = { item: v.item };
  if (Array.isArray(v.at) && v.at.length > 0 && v.at.length <= 4 && v.at.every((x) => typeof x === "string" && AT_STEP.test(x))) t.at = v.at as string[];
  if (typeof v.newObject === "string" && keys.has(v.newObject)) t.newObject = v.newObject;
  else if (typeof v.object === "string" && UUID.test(v.object)) t.object = v.object;
  if (typeof v.member === "string" && (ROLE.test(v.member) || UUID.test(v.member))) t.member = v.member;
  return t;
}

function readApplied(v: unknown): AppliedTo | undefined {
  if (!isObj(v) || typeof v.item !== "string" || !Array.isArray(v.at) || !v.at.every((x) => typeof x === "string") || !isObj(v.target)) return undefined;
  const t = v.target;
  const target: AppliedTo["target"] | null =
    typeof t.object === "string" && UUID.test(t.object) ? { object: t.object } : typeof t.member === "string" && UUID.test(t.member) ? { member: t.member } : t.plan === "assumptions" || t.plan === "input" ? { plan: t.plan } : null;
  return target === null ? undefined : { target, item: v.item, at: v.at as string[] };
}

function readDecision(v: unknown): DocDecision | undefined {
  if (!isObj(v) || typeof v.at !== "string" || !TIME.test(v.at)) return undefined;
  const d: DocDecision = { at: v.at };
  const value = readValue(v.value);
  if (value !== undefined && value !== null) d.value = value;
  const to = readApplied(v.to);
  if (to !== undefined) d.to = to;
  return d;
}

function readCandidate(v: unknown, keys: ReadonlySet<string>): DocCandidate | null {
  if (!isObj(v) || typeof v.id !== "string" || !UUID.test(v.id)) return null;
  // 番号らしい値は読むときにも落とす（候補ごと捨てる）
  if (isPersonalNumberValue(v.value)) return null;
  const target = readTarget(v.target, keys);
  const value = readValue(v.value);
  if (target === null || value === undefined) return null;
  const c: DocCandidate = {
    id: v.id,
    target,
    value: v.unreadable === true ? null : value,
    source: readSource(v.source),
    confidence: CONFIDENCES.includes(v.confidence as Confidence) ? (v.confidence as Confidence) : "low",
    status: STATUSES.includes(v.status as CandidateStatus) ? (v.status as CandidateStatus) : "pending",
  };
  if (v.unreadable === true || c.value === null) c.unreadable = true;
  if (v.period === "monthly" || v.period === "annual" || v.period === "once") c.period = v.period;
  const note = text(v.note, LIMITS.note);
  if (note !== undefined) c.note = note;
  const d = readDecision(v.decided);
  if (d !== undefined) c.decided = d;
  return c;
}

function readObject(v: unknown): DocObject | null {
  if (!isObj(v) || typeof v.key !== "string" || !OBJECT_KEY.test(v.key) || typeof v.kind !== "string" || (NEW_OBJECT_KINDS[v.kind] === undefined && RETIRED_OBJECT_KINDS[v.kind] === undefined)) return null;
  const o: DocObject = {
    key: v.key,
    kind: v.kind,
    source: readSource(v.source),
    confidence: CONFIDENCES.includes(v.confidence as Confidence) ? (v.confidence as Confidence) : "low",
    status: v.status === "accepted" || v.status === "rejected" ? v.status : "pending",
  };
  if (typeof v.created === "string" && UUID.test(v.created)) o.created = v.created;
  if (v.linked === true && o.created !== undefined && o.status === "accepted") o.linked = true;
  if (typeof v.decidedAt === "string" && TIME.test(v.decidedAt)) o.decidedAt = v.decidedAt;
  return o;
}

function readReference(v: unknown): DocReference | null {
  if (!isObj(v) || typeof v.id !== "string" || !UUID.test(v.id) || !Number.isSafeInteger(v.amount) || isPersonalNumberValue(v.amount)) return null;
  const label = text(v.label, LIMITS.label);
  if (label === undefined) return null;
  const r: DocReference = { id: v.id, label, amount: v.amount as number, source: readSource(v.source) };
  if (typeof v.row === "string" && ROW.test(v.row)) r.row = v.row;
  if (Number.isSafeInteger(v.year) && (v.year as number) >= 1900 && (v.year as number) <= 2200) r.year = v.year as number;
  return r;
}

function readReading(v: unknown): DocumentReading | null {
  if (!isObj(v) || v.kind !== "document" || typeof v.id !== "string" || !UUID.test(v.id) || typeof v.at !== "string" || !TIME.test(v.at) || !VIAS.includes(v.via as Via)) return null;
  const objects: DocObject[] = [];
  const keys = new Set<string>();
  for (const o of (Array.isArray(v.objects) ? v.objects : []).slice(0, LIMITS.objects)) {
    const r = readObject(o);
    if (r === null || keys.has(r.key)) continue;
    keys.add(r.key);
    objects.push(r);
  }
  const seen = new Set<string>();
  const candidates: DocCandidate[] = [];
  for (const c of (Array.isArray(v.candidates) ? v.candidates : []).slice(0, LIMITS.candidates)) {
    const r = readCandidate(c, keys);
    if (r === null || seen.has(r.id)) continue;
    seen.add(r.id);
    candidates.push(r);
  }
  const references = (Array.isArray(v.references) ? v.references : []).slice(0, LIMITS.references).map(readReference).filter((r): r is DocReference => r !== null);
  const reading: DocumentReading = {
    id: v.id,
    kind: "document",
    docType: [...DOC_TYPES, ...RETIRED_DOC_TYPES].some((d) => d.value === v.docType) ? (v.docType as RecordedDocType) : "other",
    at: v.at,
    via: v.via as Via,
    objects,
    candidates,
    references,
    dropped: Number.isSafeInteger(v.dropped) && (v.dropped as number) >= 0 ? (v.dropped as number) : 0,
  };
  if (isObj(v.reader) && typeof v.reader.id === "string" && READER_ID.test(v.reader.id) && Number.isSafeInteger(v.reader.version) && (v.reader.version as number) >= 1) reading.reader = { id: v.reader.id, version: v.reader.version as number };
  const connector = isObj(v.ai) ? text(v.ai.connector, LIMITS.connector) : undefined;
  if (connector !== undefined) reading.ai = { connector };
  if (isObj(v.file) && typeof v.file.sha256 === "string" && SHA.test(v.file.sha256) && Number.isSafeInteger(v.file.bytes) && (v.file.bytes as number) >= 0) reading.file = { sha256: v.file.sha256, bytes: v.file.bytes as number };
  if (typeof v.asOf === "string" && YM.test(v.asOf)) reading.asOf = v.asOf;
  if (typeof v.holder === "string" && UUID.test(v.holder)) reading.holder = v.holder;
  return reading;
}

/** 区画 documents を読む（形の合わない記録・候補は捨てる。同じ ID の記録は先の1件だけ） */
export function readDocumentLog(v: unknown): DocumentLog {
  const readings: DocumentReading[] = [];
  const ids = new Set<string>();
  if (isObj(v) && Array.isArray(v.readings))
    for (const r of v.readings.slice(0, LIMITS.readings)) {
      const x = readReading(r);
      if (x === null || ids.has(x.id)) continue;
      ids.add(x.id);
      readings.push(x);
    }
  return { version: DOCUMENT_LOG_VERSION, readings };
}

/** 残す中身があるか（空の記録は区画を作らない） */
export const hasDocuments = (l: DocumentLog | undefined): boolean => l !== undefined && l.readings.length > 0;

/** 読み取りの記録を足す・置き換える（同じ ID なら置き換える） */
export function withReading(log: DocumentLog | undefined, r: DocumentReading): DocumentLog {
  const list = log?.readings ?? [];
  const at = list.findIndex((x) => x.id === r.id);
  const readings = at >= 0 ? list.map((x, i) => (i === at ? r : x)) : [...list, r];
  return { version: DOCUMENT_LOG_VERSION, readings: readings.slice(-LIMITS.readings) };
}

/** 読み取りの記録を外す（承認・直した候補のある記録は外さない。現状の値の承認の記録が指す先なので） */
export function withoutReading(log: DocumentLog | undefined, id: string): DocumentLog | undefined {
  if (log === undefined) return undefined;
  const r = log.readings.find((x) => x.id === id);
  if (r === undefined || !removable(r)) return log;
  const readings = log.readings.filter((x) => x.id !== id);
  return readings.length > 0 ? { version: DOCUMENT_LOG_VERSION, readings } : undefined;
}

/** 外せる記録か（現状に入れた候補が無い） */
export const removable = (r: DocumentReading): boolean => !r.candidates.some((c) => c.status === "accepted" || c.status === "corrected") && !r.objects.some((o) => o.status === "accepted");

/** 未決の候補（値・新しい物）の数。取り込みを外した書類の記録は見るだけなので数えない（0159） */
export const pendingCount = (r: DocumentReading): number => isRetired(r) ? 0 : r.candidates.filter((c) => c.status === "pending").length + r.objects.filter((o) => o.status === "pending").length;

/** 世帯の中の未決の候補の数（入口の数に出す） */
export const pendingTotal = (wh: Pick<WorkingHousehold, "documents">): number => (wh.documents?.readings ?? []).reduce((n, r) => n + pendingCount(r), 0);

/** 世帯の記録を置き換える（記録が空なら欄を持たない） */
export function withDocumentLog(wh: WorkingHousehold, log: DocumentLog | undefined): WorkingHousehold {
  const { documents: _old, ...rest } = wh;
  void _old;
  return log !== undefined && hasDocuments(log) ? { ...rest, documents: log } : rest;
}

/** 元に戻す・やり直すで、今の記録を持ち越す（明細の取り込みの記録と同じ。keepStatements） */
export function keepDocuments(next: WorkingHousehold, cur: WorkingHousehold): WorkingHousehold {
  if (next.documents === cur.documents) return next;
  return withDocumentLog(next, cur.documents);
}

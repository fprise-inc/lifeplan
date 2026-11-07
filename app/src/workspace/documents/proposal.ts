// 書類の候補の読み口（0148 の4）: アプリの中の読み手・AI接続口の道具・貼り付けた AI の答え・架空の見本は、どれもここを通して
// 読み取りの記録（候補の受け皿）にする。届いた答えは信用しない（0015・0016）:
// - 形を確かめ、知らない欄は捨てる。入力項目ID は登録簿にあるものだけ。大きさの上限を超える分は読まない
// - 個人番号などの番号は、候補に入る前に落とす（privacy.ts）。落とした数だけ残す
// - 文字（元の場所の文字・添え書き・文字の値）は伏せ字の後の文字として持ち、画面では文字のまま出す（HTML にしない・指示として読まない）
// - ここでは世帯の値を変えない。承認は確かめの画面（apply.ts）
//
// 答えの形（document-candidates@1）:
// { contract, docType, asOf?, holder?, objects?: [{key, kind, source?, confidence?}],
//   values: [{item, at?, member?, object?, newObject?, value, unreadable?, period?, source?, confidence?, note?}],
//   references?: [{label, amount, row?, year?, source?}] }
import { ITEM_LABELS } from "../../generated/labels.ts";
import { cleanText, cleanValue, isNumberField, isPersonalNumberValue } from "./privacy.ts";
import { DOC_TYPES, LIMITS, PROPOSAL_CONTRACT, type CandidateTarget, type CandidateValue, type Confidence, type DocCandidate, type DocObject, type DocReference, type DocSource, type DocType, type DocumentReading, type Via } from "./types.ts";
import { NEW_OBJECT_KINDS } from "./objects.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ProposalContext {
  via: Via;
  /** 届いた日時（承認の日時と同じ形） */
  at: string;
  /** 乱数の ID を作る（記録・候補・照合の値に振る） */
  newId: () => string;
  reader?: { id: string; version: number };
  /** AI の名乗り（自己申告。AI接続口なら接続口が受けた名前、貼り付けなら FP が入れた名前） */
  connector?: string;
  file?: { sha256: string; bytes: number };
  /** 続柄の鍵 → 構成員の ID（答えの holder〔書類の名義の続柄〕を記録の名義の人の初めの値にする。無ければ名義は FP が選ぶ） */
  members?: readonly { key: string; id: string }[];
}

export interface ProposalResult {
  /** 読めた記録（候補が1つも無ければ null） */
  reading: DocumentReading | null;
  /** 読まなかった所の理由（画面に出す。値・文字は入れない） */
  issues: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ROLE = /^(self|spouse|holder|child[1-9][0-9]?|other[1-9][0-9]?)$/u;
const AT_STEP = /^[A-Za-z0-9_-]{1,40}$/u;
const OBJECT_KEY = /^[A-Za-z0-9_-]{1,16}$/u;
const YM = /^[0-9]{4}-(0[1-9]|1[0-2])$/u;
const ROW = /^cf(\.[a-z][a-zA-Z0-9]*)+$/u;
const PATH = /^[A-Za-z0-9_./-]{1,120}$/u;
const SHA = /^sha256:[0-9a-f]{64}$/u;
const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];

/** 入力項目ID が登録簿にあるか */
export const knownItem = (item: string): boolean => Object.hasOwn(ITEM_LABELS, item);

function readSource(v: unknown, count: { masked: number }): DocSource {
  if (!isObj(v)) return {};
  const out: DocSource = {};
  if (Number.isSafeInteger(v.page) && (v.page as number) >= 1 && (v.page as number) <= 999) out.page = v.page as number;
  if (typeof v.where === "string" && v.where.trim() !== "") {
    const c = cleanText(v.where, LIMITS.where);
    if (c.masked) count.masked++;
    if (c.text !== "") out.where = c.text;
  }
  if (typeof v.text === "string" && v.text.trim() !== "") {
    const c = cleanText(v.text, LIMITS.sourceText);
    if (c.masked) count.masked++;
    if (c.text !== "") out.text = c.text;
  }
  if (Array.isArray(v.box) && v.box.length === 4 && v.box.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1)) out.box = [v.box[0], v.box[1], v.box[2], v.box[3]] as [number, number, number, number];
  if (typeof v.path === "string" && PATH.test(v.path)) out.path = v.path;
  return out;
}

const readConfidence = (v: unknown): Confidence => (CONFIDENCES.includes(v as Confidence) ? (v as Confidence) : "low");

/** 値: 数（整数・有限）・文字（数の形はそのまま、ほかは伏せ字の後で200字まで）・真偽。読めなければ undefined */
function readValue(v: unknown, count: { masked: number }): CandidateValue | null | undefined {
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    if (v.trim() === "") return null;
    const c = cleanValue(v, LIMITS.textValue);
    if (c.masked) count.masked++;
    return c.text;
  }
  return undefined;
}

function readTarget(v: Obj, objectKeys: ReadonlySet<string>): CandidateTarget | string {
  if (typeof v.item !== "string" || !knownItem(v.item)) return "登録簿に無い入力項目の候補";
  const t: CandidateTarget = { item: v.item };
  if (v.at !== undefined) {
    if (!Array.isArray(v.at) || v.at.length > 4 || !v.at.every((x) => typeof x === "string" && AT_STEP.test(x))) return "場所の書き方が違う候補";
    if (v.at.length > 0) t.at = v.at as string[];
  }
  if (v.newObject !== undefined) {
    if (typeof v.newObject !== "string" || !objectKeys.has(v.newObject)) return "新しい物の鍵が物の候補に無い候補";
    t.newObject = v.newObject;
  } else if (v.object !== undefined) {
    if (typeof v.object !== "string" || !UUID.test(v.object)) return "物の ID の書き方が違う候補";
    t.object = v.object;
  }
  if (v.member !== undefined && v.member !== null) {
    if (typeof v.member !== "string" || !(ROLE.test(v.member) || UUID.test(v.member))) return "人の書き方が違う候補";
    t.member = v.member;
  }
  return t;
}

/**
 * 届いた答え（JSON の値）を読み取りの記録にする。形の合わない所は読まずに理由を issues に入れる。
 * 候補（値・新しい物・照合の値）が1つも残らなければ reading は null
 */
export function readProposal(raw: unknown, ctx: ProposalContext): ProposalResult {
  const issues: string[] = [];
  if (!isObj(raw)) return { reading: null, issues: ["答えの形が違います（{ … } の形の JSON ではありません）"] };
  if (raw.contract !== PROPOSAL_CONTRACT) return { reading: null, issues: [`答えの形の名前（contract）が「${PROPOSAL_CONTRACT}」ではありません`] };
  const count = { masked: 0, dropped: 0 };
  const docType: DocType = DOC_TYPES.some((d) => d.value === raw.docType) ? (raw.docType as DocType) : "other";
  // 新しい物の候補
  const objects: DocObject[] = [];
  const keys = new Set<string>();
  const rawObjects = Array.isArray(raw.objects) ? raw.objects : [];
  if (rawObjects.length > LIMITS.objects) issues.push(`新しい物の候補が多すぎるので、先の${LIMITS.objects}件だけ読みました`);
  for (const o of rawObjects.slice(0, LIMITS.objects)) {
    if (!isObj(o) || typeof o.key !== "string" || !OBJECT_KEY.test(o.key) || keys.has(o.key)) {
      issues.push("鍵の無い・重なった新しい物の候補");
      continue;
    }
    if (typeof o.kind !== "string" || NEW_OBJECT_KINDS[o.kind] === undefined) {
      issues.push("作れない種類の新しい物の候補");
      continue;
    }
    keys.add(o.key);
    objects.push({ key: o.key, kind: o.kind, source: readSource(o.source, count), confidence: readConfidence(o.confidence), status: "pending" });
  }
  // 値の候補
  const candidates: DocCandidate[] = [];
  const rawValues = Array.isArray(raw.values) ? raw.values : [];
  if (rawValues.length > LIMITS.candidates) issues.push(`値の候補が多すぎるので、先の${LIMITS.candidates}件だけ読みました`);
  for (const v of rawValues.slice(0, LIMITS.candidates)) {
    if (!isObj(v)) {
      issues.push("形の違う値の候補");
      continue;
    }
    // 番号の欄・番号らしい値は、候補ごと落とす（中身は持たない）
    const where = isObj(v.source) && typeof v.source.where === "string" ? v.source.where : undefined;
    if (isNumberField(where) || isPersonalNumberValue(v.value)) {
      count.dropped++;
      continue;
    }
    const target = readTarget(v, keys);
    if (typeof target === "string") {
      issues.push(target);
      continue;
    }
    const value = readValue(v.value, count);
    if (value === undefined) {
      issues.push("値の形が違う候補");
      continue;
    }
    const unreadable = v.unreadable === true || value === null;
    const c: DocCandidate = {
      id: ctx.newId(),
      target,
      value: unreadable ? null : value,
      source: readSource(v.source, count),
      confidence: readConfidence(v.confidence),
      status: "pending",
    };
    if (unreadable) c.unreadable = true;
    if (v.period === "monthly" || v.period === "annual" || v.period === "once") c.period = v.period;
    if (typeof v.note === "string" && v.note.trim() !== "") {
      const n = cleanText(v.note, LIMITS.note);
      if (n.masked) count.masked++;
      if (n.text !== "") c.note = n.text;
    }
    candidates.push(c);
  }
  // 照合だけの値
  const references: DocReference[] = [];
  const rawRefs = Array.isArray(raw.references) ? raw.references : [];
  for (const r of rawRefs.slice(0, LIMITS.references)) {
    if (!isObj(r) || typeof r.label !== "string" || !Number.isSafeInteger(r.amount)) {
      issues.push("形の違う照合の値");
      continue;
    }
    if (isNumberField(r.label) || isPersonalNumberValue(r.amount)) {
      count.dropped++;
      continue;
    }
    const label = cleanText(r.label, LIMITS.label);
    if (label.masked) count.masked++;
    if (label.text === "") continue;
    const ref: DocReference = { id: ctx.newId(), label: label.text, amount: r.amount as number, source: readSource(r.source, count) };
    if (typeof r.row === "string" && ROW.test(r.row)) ref.row = r.row;
    if (Number.isSafeInteger(r.year) && (r.year as number) >= 1900 && (r.year as number) <= 2200) ref.year = r.year as number;
    references.push(ref);
  }
  if (rawRefs.length > LIMITS.references) issues.push(`照合の値が多すぎるので、先の${LIMITS.references}件だけ読みました`);
  // 値の候補の無い新しい物は作らない（足しても中身が空になる）
  const used = new Set(candidates.flatMap((c) => (c.target.newObject !== undefined ? [c.target.newObject] : [])));
  const kept = objects.filter((o) => used.has(o.key));
  if (kept.length < objects.length) issues.push("値の候補の無い新しい物の候補は読みませんでした");
  if (candidates.length === 0 && references.length === 0) return { reading: null, issues: [...issues, "読める候補がありませんでした"] };
  const reading: DocumentReading = {
    id: ctx.newId(),
    kind: "document",
    docType,
    at: ctx.at,
    via: ctx.via,
    objects: kept,
    candidates,
    references,
    dropped: count.dropped + count.masked,
  };
  if (ctx.reader !== undefined) reading.reader = { id: ctx.reader.id, version: ctx.reader.version };
  if (ctx.connector !== undefined) {
    const c = cleanText(ctx.connector, LIMITS.connector);
    if (c.text !== "") reading.ai = { connector: c.text };
  }
  if (ctx.file !== undefined && SHA.test(ctx.file.sha256) && Number.isSafeInteger(ctx.file.bytes) && ctx.file.bytes >= 0) reading.file = { sha256: ctx.file.sha256, bytes: ctx.file.bytes };
  if (typeof raw.asOf === "string" && YM.test(raw.asOf)) reading.asOf = raw.asOf;
  const holder = typeof raw.holder === "string" ? ctx.members?.find((m) => m.key === raw.holder || m.id === raw.holder)?.id : undefined;
  if (holder !== undefined) reading.holder = holder;
  return { reading, issues: [...new Set(issues)] };
}

/**
 * 貼り付けた文字（ウェブのチャット AI の答え）から答えの JSON を取り出して読む。前後の文や ```json の囲みがあってもよい。
 * 大きすぎる文字は読まない
 */
export function readProposalText(text: string, ctx: ProposalContext): ProposalResult {
  if (text.length > LIMITS.pasteChars) return { reading: null, issues: ["貼り付けた文が大きすぎます"] };
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return { reading: null, issues: ["答えの JSON が見つかりません"] };
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(start, end + 1));
  } catch {
    return { reading: null, issues: ["答えの JSON を読めません（途中で切れていないか確かめてください）"] };
  }
  return readProposal(raw, ctx);
}

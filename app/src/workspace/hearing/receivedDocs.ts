// Web のヒアリングで受け取った書類（0125・0158）を FP が見て使う所（0191）: 世帯ごとの受け取った書類の一覧・入力項目と書類のつながり・
// 自分のフォルダに保存するときのファイル名・見たか・保存したかの印。
// - 書類の名前は書類のひな形の定義（hearing の documents.ts）から引く。ひな形が増えても、ここは直さずに名前が出る
// - 書類は世帯ファイルの中に置いたまま（世帯の鍵で暗号化。0125 の8）。アプリは自動で消さず、消すように促さない。FP が自分のフォルダに保存し、
//   要らなくなったら FP が消す。一覧に大きさを出して、FP が判断できるようにする
// - ファイル名にお客さまのお名前は入れない（アプリは氏名を持たない。0012 の2）。顧客番号・書類の名前・持ち主の呼び方（ご本人・配偶者など）・受け取った日
import { docForCheck, MIME_EXT, OWNER_LABEL, templateOf } from "../../../../hearing/src/web/documents.ts";
import type { RequestedDocument } from "../../../../hearing/src/web/packet.ts";
import type { DocRequest } from "../input/docRequests.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { webLog, withWebEntry, type StoredDocumentFile, type WebLogEntry } from "./web.ts";

/** 受け取った書類のファイル1つ（一覧の1行） */
export interface ReceivedFile {
  requestId: string;
  customerNo: string;
  doc: RequestedDocument;
  /** 書類の名前（ひな形の名前。独自の書類は見出し） */
  name: string;
  /** 持ち主の呼び方（ご本人・配偶者・医療保険・ご本人 など。分からなければ null） */
  whose: string | null;
  file: StoredDocumentFile;
  /** FP が受け取った日時（送りの記録。前の版の記録で送りが無ければ答えを受け取った日時） */
  receivedAt: string;
  /** お客さまが送った日時（申告。分からなければ null） */
  sentAt: string | null;
  /** 同じ依頼の同じ書類の何枚目か（1から）と、その書類の枚数 */
  index: number;
  count: number;
}

/** 書類の種類（ひな形の kind）→ その書類を見ながら打つ入力項目（入力のホームのカードの ID）。知らない種類は書類のお願いのつながりだけで引く */
export const DOC_CARDS: Readonly<Record<string, readonly string[]>> = {
  withholding: ["work"],
  payslip: ["work"],
  bonusSlip: ["work"],
  taxReturn: ["work"],
  companyAccounts: ["work"],
  residentTaxNotice: ["work"],
  retirementRules: ["retirement"],
  dcNotice: ["retirement", "savings"],
  pensionNotice: ["pension"],
  pensionAmountNotice: ["pension"],
  deposits: ["savings"],
  securities: ["savings"],
  investStatement: ["savings"],
  insurancePolicy: ["insurance"],
  insuranceDeduction: ["insurance"],
  loanSchedule: ["housing", "car"],
  otherLoanSchedule: ["housing", "car"],
  propertyTax: ["housing"],
  rentalContract: ["housing"],
  householdBook: ["living"],
};

/** 書類の種類: ひな形の kind。無ければ、結びついた書類待ちの1通の書類の名前から引く */
export function kindOfDoc(doc: RequestedDocument): string | null {
  if (doc.kind !== null && doc.kind !== "") return doc.kind;
  const name = doc.docRequest?.split("|")[0];
  return name === undefined || name === "" ? null : docForCheck(name);
}

/**
 * 書類の名前と持ち主。名前はひな形の定義から引き、見出しの残りの括弧の中を持ち主とみる（「ねんきん定期便（ご本人）」→ ねんきん定期便・ご本人）。
 * 頼む書類に持ち主の欄（owner。ご本人・配偶者の方）があれば、その言葉を使う（書類の頼み方の定義の OWNER_LABEL）
 */
export function docNameParts(doc: RequestedDocument): { name: string; whose: string | null } {
  const t = doc.kind !== null ? templateOf(doc.kind) : undefined;
  const title = doc.title.trim();
  if (doc.owner !== undefined) {
    const label = OWNER_LABEL[doc.owner];
    const base = t !== undefined && title.startsWith(t.title) ? t.title : title.replace(new RegExp(`（${escapeRe(label)}）$`), "");
    return { name: base, whose: label };
  }
  if (t !== undefined && title.startsWith(t.title)) {
    const rest = /^（(.+)）$/.exec(title.slice(t.title.length).trim());
    return { name: t.title, whose: rest?.[1] ?? null };
  }
  // ひな形と見出しが違う（ローンの言い分け・独自の書類）: 見出しの最後の括弧を持ち主とみる。ひな形の名前そのものの括弧は持ち主にしない
  const m = /^(.+?)（([^（）]+)）$/.exec(title);
  if (m !== null && templateOf(kindOfDoc(doc) ?? "")?.title !== title) return { name: m[1] ?? title, whose: m[2] ?? null };
  return { name: title, whose: null };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 世帯の受け取った書類を、新しく受け取った順に（同じ受け取りの中は依頼の書類の並び・ファイルの並び） */
export function receivedFiles(wh: WorkingHousehold): ReceivedFile[] {
  const out: ReceivedFile[] = [];
  for (const e of webLog(wh)) out.push(...filesOf(e));
  return out.sort((a, b) => (a.receivedAt === b.receivedAt ? 0 : a.receivedAt < b.receivedAt ? 1 : -1));
}

function filesOf(e: WebLogEntry): ReceivedFile[] {
  const files = e.files ?? [];
  const batches = e.batches ?? [];
  const out: ReceivedFile[] = [];
  for (const doc of e.record.selection.documents) {
    const mine = files.filter((f) => f.docId === doc.id);
    const { name, whose } = docNameParts(doc);
    mine.forEach((file, i) => {
      const b = batches.find((x) => x.batchId === file.batchId);
      out.push({ requestId: e.record.requestId, customerNo: e.record.customerNo, doc, name, whose, file, receivedAt: b?.receivedAt ?? e.received?.at ?? e.record.issuedAt, sentAt: b?.sentAt ?? e.received?.submittedAt ?? null, index: i + 1, count: mine.length });
    });
  }
  return out;
}

/** 一覧の見出しの数: 件数・大きさ・まだ見ていない・まだ保存していない */
export function receivedSummary(list: readonly ReceivedFile[]): { files: number; bytes: number; unseen: number; unsaved: number } {
  return { files: list.length, bytes: list.reduce((n, r) => n + r.file.bytes, 0), unseen: list.filter((r) => r.file.viewedAt === undefined).length, unsaved: list.filter((r) => r.file.savedAt === undefined).length };
}

/** 大きさの言葉（KB・MB） */
export function sizeText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")}MB`;
}

/** 日付（手元の時刻）を YYYYMMDD に */
function ymd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** ファイル名の1つの部分（使えない字・空白・括弧を _ に。長さを抑える） */
function part(s: string, max: number): string {
  return s.replace(/[\\/:*?"<>|\s（）()「」]+/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_").slice(0, max);
}

/**
 * 自分のフォルダに保存するときのファイル名: 顧客番号_書類の名前_持ち主_受け取った日[_枚目].拡張子（例: A0042_源泉徴収票_ご本人_20261108.jpg）。
 * - 顧客番号を先に置く: 何世帯分も同じフォルダに保存しても、世帯ごとに並ぶ（顧客番号とお名前の対応は FP がアプリの外で持つ。0012 の1）
 * - お名前は入れない（アプリは氏名を持たない。0012 の2）。持ち主は書類のお願いと同じ呼び方（ご本人・配偶者）
 * - 日付は FP が受け取った日（お客さまの送った日時は申告で、端末の時計に左右されるため）
 * - 同じ日に同じ書類を何枚か受け取ったときは、2枚目から _2・_3 を添える（1枚目の名前は、後から届いても変わらない）
 */
export function docFileName(r: ReceivedFile, nth = 1): string {
  const pieces = [part(r.customerNo, 20), part(r.name, 40), r.whose !== null ? part(r.whose, 30) : "", ymd(r.receivedAt)].filter((x) => x !== "");
  return `${pieces.join("_") || "書類"}${nth > 1 ? `_${nth}` : ""}.${MIME_EXT[r.file.mime]}`;
}

/**
 * 一覧の全部のファイルのファイル名。古く受け取った順に名前を決め、同じ名前になったら後のものに _2・_3 を足す
 * （同じ日の同じ書類の2枚目・同じ日に別の依頼で届いた同じ書類）。後から届いた書類で、前に保存した書類の名前は変わらない
 */
export function fileNames(list: readonly ReceivedFile[]): Map<string, string> {
  const oldest = list.slice().sort((a, b) => (a.receivedAt === b.receivedAt ? (a.requestId === b.requestId ? (a.doc.id === b.doc.id ? a.index - b.index : 0) : a.requestId < b.requestId ? -1 : 1) : a.receivedAt < b.receivedAt ? -1 : 1));
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const r of oldest) {
    let n = 1;
    while (used.has(docFileName(r, n))) n++;
    const name = docFileName(r, n);
    used.add(name);
    out.set(r.file.fileId, name);
  }
  return out;
}

/** 見た・保存したの印を付ける（ファイルの ID ごと。同じ印がもうあれば書き換えない） */
export function withFileMarks(wh: WorkingHousehold, fileIds: readonly string[], mark: "viewedAt" | "savedAt", at: string): WorkingHousehold {
  const ids = new Set(fileIds);
  let out = wh;
  for (const e of webLog(wh)) {
    const files = e.files ?? [];
    if (!files.some((f) => ids.has(f.fileId) && (mark === "savedAt" || f[mark] === undefined))) continue;
    out = withWebEntry(out, { ...e, files: files.map((f) => (ids.has(f.fileId) && (mark === "savedAt" || f[mark] === undefined) ? { ...f, [mark]: at } : f)) });
  }
  return out;
}

/** その入力項目で見ながら打つ書類（書類の種類から引く・書類のお願いの1通の欄の入力項目から引く） */
export function filesForCard(list: readonly ReceivedFile[], card: string, pending: readonly DocRequest[]): ReceivedFile[] {
  return list.filter((r) => {
    const kind = kindOfDoc(r.doc);
    if (kind !== null && (DOC_CARDS[kind] ?? []).includes(card)) return true;
    const p = r.doc.docRequest === undefined ? undefined : pending.find((x) => x.id === r.doc.docRequest);
    return p !== undefined && p.values.some((v) => v.card === card);
  });
}

/** 書類ごと（依頼と書類）にまとめる（入口のボタン・見る枠の切り替えに使う） */
export function byDocument(list: readonly ReceivedFile[]): { key: string; name: string; whose: string | null; files: ReceivedFile[] }[] {
  const out: { key: string; name: string; whose: string | null; files: ReceivedFile[] }[] = [];
  for (const r of list) {
    const key = `${r.requestId}|${r.doc.id}`;
    const g = out.find((x) => x.key === key);
    if (g !== undefined) g.files.push(r);
    else out.push({ key, name: r.name, whose: r.whose, files: [r] });
  }
  for (const g of out) g.files.sort((a, b) => a.index - b.index);
  return out;
}

/** 書類の見出し（名前と持ち主） */
export const docLabel = (r: { name: string; whose: string | null }): string => (r.whose !== null ? `${r.name}（${r.whose}）` : r.name);

/** 世帯から受け取った書類を外す（FP が「消す」を押したときだけ） */
export function withoutFiles(wh: WorkingHousehold, fileIds: readonly string[]): WorkingHousehold {
  const ids = new Set(fileIds);
  let out = wh;
  for (const e of webLog(wh)) if ((e.files ?? []).some((f) => ids.has(f.fileId))) out = withWebEntry(out, { ...e, files: (e.files ?? []).filter((f) => !ids.has(f.fileId)) });
  return out;
}

// Web のヒアリング（0125）の FP の側（作業の層）: 依頼の記録・状況・受け取り・取り込み・受け取った書類・事務所のひな形。
// - 依頼の記録（鍵の組の秘密鍵・合言葉・問いの鍵の元を含む）と受け取った答え・書類は、世帯の取り込みの記録（hearing.web）に置き、
//   世帯ファイルと一緒に世帯の鍵で暗号化される（0011・0013）。画面の保存機能・ログには置かない（0016）
// - 通信は本体の命令（hearing_web_call）だけが行う。開発用のサーバーでは同じ所の /api/hearing/v1（メモリの置き場か手元の wrangler dev）
// - 受け取ったら、世帯に保存してからサーバーから消す。取り込みは Excel と同じ候補の画面（viewOfResult）で FP が承認する
import { importAnswers, OFFICIAL_SHEETS, requestIdFrom, type SheetDefinition } from "../../../../hearing/src/index.ts";
import { exportAnswers } from "../../../../hearing/src/export.ts";
import type { EngineRequest as HearingEngineRequest } from "../../../../hearing/src/types.ts";
import { b64u, fromB64u } from "../../../../hearing/src/web/b64.ts";
import { DOCUMENT_TEMPLATES, docForCheck, MIME_EXT, type DocumentMime } from "../../../../hearing/src/web/documents.ts";
import { filledOf, issueRequest, receive, type WebRequestRecord } from "../../../../hearing/src/web/fp.ts";
import { buildPacket, CUSTOM_PREFIX, FP_SECTION, importDefinition, selectionFromSheet, type DocumentAnswer, type OfficeFace, type QuestionsPacket, type RequestedDocument, type WebSelection } from "../../../../hearing/src/web/packet.ts";
import { relay, type RelayTransport } from "../../../../hearing/src/web/protocol.ts";
import type { Answer } from "../../../../hearing/src/answers.ts";
import type { DocRequest } from "../input/docRequests.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { logOf, viewOfResult, type ImportView } from "./sheet.ts";

/** 受け取った書類のファイル（世帯ファイルの中。暗号化は世帯ファイルの暗号化のまま） */
export interface StoredDocumentFile {
  docId: string;
  fileId: string;
  mime: DocumentMime;
  /** 中身（base64url） */
  data: string;
  bytes: number;
  sha256: string;
}

export interface WebReceived {
  at: string;
  submittedAt: string;
  answers: Answer[];
  documents: DocumentAnswer[];
  dropped: number;
  missingFiles: number;
}

export type WebState = "issued" | "received" | "imported" | "cancelled";

/** Web の依頼1件の記録 */
export interface WebLogEntry {
  record: WebRequestRecord;
  state: WebState;
  received?: WebReceived;
  files?: StoredDocumentFile[];
  importedAt?: string;
}

/** 受け取った書類の1世帯の上限（世帯ファイルが大きくなりすぎないように。写し終えたら消す） */
export const STORED_DOCUMENTS_MAX_BYTES = 40 * 1024 * 1024;

export function webLog(wh: WorkingHousehold): WebLogEntry[] {
  const w = (logOf(wh) as { web?: unknown }).web;
  return Array.isArray(w) ? (w as WebLogEntry[]).filter((e) => typeof e === "object" && e !== null && typeof e.record?.requestId === "string") : [];
}

export function withWebEntry(wh: WorkingHousehold, e: WebLogEntry): WorkingHousehold {
  const log = logOf(wh);
  const list = webLog(wh).filter((x) => x.record.requestId !== e.record.requestId);
  return { ...wh, hearing: { ...log, web: [...list, e] } };
}

/** 画面に出す状況（期限は発行の記録の日時で決める） */
export type WebStatus = "issued" | "answered" | "received" | "imported" | "expired" | "cancelled";

export function statusOf(e: WebLogEntry, now: Date, answered = false): WebStatus {
  if (e.state === "imported") return "imported";
  if (e.state === "received") return "received";
  if (e.state === "cancelled") return "cancelled";
  if (Date.parse(e.record.expiresAt) <= now.getTime()) return "expired";
  return answered ? "answered" : "issued";
}

export const STATUS_TEXT: Readonly<Record<WebStatus, string>> = { issued: "発行済み", answered: "回答あり", received: "受け取り済み", imported: "取り込み済み", expired: "期限切れ", cancelled: "取り消し" };

// ---- 元のシート・ひな形 ----

export type WebTemplateKind = "first" | "detail" | "review";

export const WEB_TEMPLATES: readonly { value: WebTemplateKind; label: string; note: string }[] = [
  { value: "first", label: "初回の前", note: "ご家族・収入・住まい・貯蓄・生活費を大まかに（金額は範囲でも答えられる）" },
  { value: "detail", label: "詳細", note: "書類を見ながら答えてもらう詳しい問い" },
  { value: "review", label: "見直し", note: "詳細の問いで、今の値を見せて確かめてもらう" },
];

export function baseSheet(kind: WebTemplateKind): SheetDefinition {
  const id = kind === "first" ? "basic" : "full";
  const d = OFFICIAL_SHEETS.filter((x) => x.sheetId === id && x.status !== "retired").sort((a, b) => b.version - a.version)[0];
  if (d === undefined) throw new Error("E_HEARING_NO_SHEET");
  return d;
}

export function sheetOf(sel: WebSelection): SheetDefinition | undefined {
  return OFFICIAL_SHEETS.find((d) => d.sheetId === sel.base.sheetId && d.version === sel.base.version);
}

/** 今の世帯の値（確かめてもらう項目の前回の値。詳細のシートだけ） */
export function prefillOf(wh: WorkingHousehold, def: SheetDefinition): Answer[] {
  if (def.sheetId !== "full") return [];
  try {
    return [...exportAnswers(def, wh.request as unknown as HearingEngineRequest, { assumed: wh.assumed }).answers];
  } catch {
    return [];
  }
}

/** ひな形から始める選び方（見直しは、今の世帯に値のある項目を「確かめてもらう」に） */
export function templateSelection(kind: WebTemplateKind, wh: WorkingHousehold): WebSelection {
  const def = baseSheet(kind);
  if (kind !== "review") return selectionFromSheet(def);
  const has = new Set(prefillOf(wh, def).filter((a) => a.status !== "blank").map((a) => a.key));
  return selectionFromSheet(def, (k) => (has.has(k) ? "confirm" : "ask"));
}

/** 独自の質問の新しいキー（ext.office.q + 8字の乱数） */
export function newCustomKey(random: Uint8Array = crypto.getRandomValues(new Uint8Array(6))): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[(random[i % random.length] as number + i * 7) % chars.length];
  return `${CUSTOM_PREFIX}q${s}`;
}

/** 選び方に独自の質問を足す（FP の質問の区画の最後に） */
export function withCustom(sel: WebSelection, label: string, help: string, key = newCustomKey()): WebSelection {
  const custom = [...sel.custom, { key, label: label.trim(), ...(help.trim() !== "" ? { help: help.trim() } : {}) }];
  const has = sel.sections.some((s) => s.id === FP_SECTION.id);
  const sections = has ? sel.sections.map((s) => (s.id === FP_SECTION.id ? { ...s, items: [...s.items, { key, mode: "ask" as const }] } : s)) : [...sel.sections, { id: FP_SECTION.id, items: [{ key, mode: "ask" as const }] }];
  return { ...sel, custom, sections };
}

export function withoutCustom(sel: WebSelection, key: string): WebSelection {
  return { ...sel, custom: sel.custom.filter((c) => c.key !== key), sections: sel.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.key !== key) })).filter((s) => s.items.length > 0) };
}

/** 次の書類の ID（d1・d2 …） */
export function nextDocId(sel: WebSelection): string {
  let n = 1;
  while (sel.documents.some((d) => d.id === `d${n}`)) n++;
  return `d${n}`;
}

/** 公式の書類のひな形から頼む書類を作る */
export function documentFromTemplate(sel: WebSelection, kind: string, whose?: string): RequestedDocument {
  const t = DOCUMENT_TEMPLATES.find((x) => x.kind === kind);
  return { id: nextDocId(sel), kind, title: whose !== undefined && whose !== "" ? `${t?.title ?? kind}（${whose}）` : (t?.title ?? kind), purpose: t?.purpose ?? "", where: t?.where ?? "" };
}

/** 書類待ちの1通（0102）から頼む書類を作る（書類待ちと結びつける） */
export function documentFromCheck(sel: WebSelection, r: DocRequest): RequestedDocument {
  const kind = docForCheck(r.doc);
  const t = kind === null ? undefined : DOCUMENT_TEMPLATES.find((x) => x.kind === kind);
  const fields = [...new Set(r.values.map((v) => v.field))];
  return { id: nextDocId(sel), kind, title: r.title, purpose: t?.purpose ?? "数字を確かめるため", where: fields.length > 0 ? `${fields.join("・")}の欄が写るように` : (t?.where ?? ""), docRequest: r.id };
}

// ---- 事務所の見た目 → お客さまのページ ----

export function officeFace(o: { name: string; color: string | null; purpose: string; privacyContact: string }): OfficeFace {
  return { name: o.name.trim().slice(0, 60), color: o.color, purpose: o.purpose.trim().slice(0, 120), privacyContact: o.privacyContact.trim().slice(0, 120) };
}

/** 見本の問い（通信しない。FP のアプリの見本に使う） */
export async function previewPacket(wh: WorkingHousehold, sel: WebSelection, office: OfficeFace, days: number, now: Date): Promise<QuestionsPacket> {
  const def = sheetOf(sel);
  if (def === undefined) throw new Error("E_HEARING_NO_SHEET");
  return buildPacket(def, sel, { requestId: "R-PREV1E", expiresAt: new Date(now.getTime() + days * 86400_000).toISOString(), office, prefill: prefillOf(wh, def) });
}

// ---- 発行 ----

export interface IssueInput {
  selection: WebSelection;
  customerNo: string;
  office: OfficeFace;
  days: number;
  pageUrl: string;
  transport: RelayTransport;
  now?: Date;
  random?: Uint8Array;
}

/** URL を発行し、依頼の記録を世帯に足す（サーバーに置けたときだけ） */
export async function issueWeb(wh: WorkingHousehold, o: IssueInput): Promise<{ wh: WorkingHousehold; entry: WebLogEntry }> {
  const def = sheetOf(o.selection);
  if (def === undefined) throw new Error("E_HEARING_NO_SHEET");
  const confirm = o.selection.sections.some((s) => s.items.some((i) => i.mode === "confirm"));
  const { record } = await issueRequest({
    definition: def,
    selection: o.selection,
    requestId: requestIdFrom(o.random ?? crypto.getRandomValues(new Uint8Array(6))),
    customerNo: o.customerNo,
    office: o.office,
    days: o.days,
    now: o.now ?? new Date(),
    pageUrl: o.pageUrl,
    ...(confirm ? { prefill: prefillOf(wh, def) } : {}),
    transport: o.transport,
  });
  const entry: WebLogEntry = { record, state: "issued" };
  return { wh: withWebEntry(wh, entry), entry };
}

/** お客さまに送る案内文のひな形（FP がメールなどで送る。アプリは送らない）。URL の中の鍵が漏れないよう、送り先を確かめてもらう */
export function invitationText(e: WebLogEntry, office: string): string {
  const end = new Date(e.record.expiresAt).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  const docs = e.record.selection.documents.length;
  return [
    "〇〇様",
    "",
    `いつもお世話になっております。${office.trim() !== "" ? office.trim() : "（事務所名）"}です。`,
    "ライフプランの面談の前に、いくつかご質問させてください。次のリンクを開くと、スマートフォンでも1問ずつお答えいただけます（10〜15分ほどです）。",
    "",
    e.record.url,
    "",
    `・お答えの期限: ${end}まで`,
    "・お名前やマイナンバーなどの番号はお聞きしません。",
    ...(docs > 0 ? ["・書類の写真をお願いする所があります。マイナンバー・口座番号などは隠してお撮りください。"] : []),
    "・お答えと書類は、お使いの端末の中で暗号化して送られ、担当の FP だけが開けます。",
    "・このリンクはご本人さま専用です。ほかの方に転送しないでください。",
    "",
    "わからない所は空けたままでかまいません。どうぞよろしくお願いいたします。",
  ].join("\n");
}

// ---- 受け取り ----

/** サーバーの状況を見る（答えがあるか）。消えていれば null */
export async function checkAnswered(e: WebLogEntry, t: RelayTransport): Promise<boolean | null> {
  try {
    return (await relay.status(t, e.record.serverId, e.record.secrets.pickupToken)).submitted;
  } catch (err) {
    if (err instanceof Error && (err.message === "E_RELAY_GONE" || err.message === "E_RELAY_EXPIRED")) return null;
    throw err;
  }
}

/** 答えと書類を受け取り、世帯に入れる（入れた後、呼ぶ側が保存してから removeOnServer を呼ぶ）。まだなら null */
export async function receiveWeb(wh: WorkingHousehold, e: WebLogEntry, t: RelayTransport, now: Date = new Date()): Promise<{ wh: WorkingHousehold; entry: WebLogEntry } | null> {
  const def = sheetOf(e.record.selection);
  if (def === undefined) throw new Error("E_HEARING_NO_SHEET");
  const got = await receive(e.record, def, t);
  if (got === null) return null;
  const kept = webLog(wh).flatMap((x) => (x.record.requestId === e.record.requestId ? [] : (x.files ?? [])));
  let room = STORED_DOCUMENTS_MAX_BYTES - kept.reduce((s, f) => s + f.bytes, 0);
  const files: StoredDocumentFile[] = [];
  let over = 0;
  for (const f of got.files) {
    if (f.bytes.length > room) {
      over++;
      continue;
    }
    room -= f.bytes.length;
    files.push({ docId: f.docId, fileId: f.fileId, mime: f.mime, data: b64u(f.bytes), bytes: f.bytes.length, sha256: f.sha256 });
  }
  const entry: WebLogEntry = {
    ...e,
    state: "received",
    received: { at: now.toISOString().replace(/\.\d+Z$/, "Z"), submittedAt: got.checked.submittedAt, answers: got.checked.answers, documents: got.checked.documents, dropped: got.checked.dropped, missingFiles: got.missingFiles + over },
    files,
  };
  return { wh: withWebEntry(wh, entry), entry };
}

/** サーバーから消す（受け取って世帯に保存した後・取り消し） */
export async function removeOnServer(e: WebLogEntry, t: RelayTransport): Promise<void> {
  await relay.remove(t, e.record.serverId, e.record.secrets.pickupToken);
}

/** 受け取った答えを、Excel と同じ候補の一覧にする（取り込みの画面で FP が承認する） */
export function importWeb(wh: WorkingHousehold, e: WebLogEntry, appVersion: string, newId?: () => string): ImportView {
  const def = sheetOf(e.record.selection);
  if (def === undefined || e.received === undefined) throw new Error("E_HEARING_NO_SHEET");
  const idef = importDefinition(def, e.record.selection);
  const filled = filledOf(e.record, { answers: e.received.answers }, appVersion);
  const r = importAnswers(idef, filled, { baseMonth: wh.request.input.baseMonth, ...(newId !== undefined ? { newId } : {}) });
  return viewOfResult({ ok: true, ...r, definition: idef, requestRecord: null }, wh);
}

/** 取り込んだ印（承認したとき） */
export function markImported(wh: WorkingHousehold, requestId: string, at: string): WorkingHousehold {
  const e = webLog(wh).find((x) => x.record.requestId === requestId);
  return e === undefined ? wh : withWebEntry(wh, { ...e, state: "imported", importedAt: at });
}

// ---- 受け取った書類 ----

export interface ReceivedDocumentView {
  requestId: string;
  doc: RequestedDocument;
  answer: DocumentAnswer | undefined;
  files: StoredDocumentFile[];
}

/** 受け取った書類の一覧（依頼ごと・書類ごと） */
export function receivedDocuments(wh: WorkingHousehold): ReceivedDocumentView[] {
  return webLog(wh).flatMap((e) =>
    e.received === undefined
      ? []
      : e.record.selection.documents.map((doc) => ({ requestId: e.record.requestId, doc, answer: e.received?.documents.find((d) => d.id === doc.id), files: (e.files ?? []).filter((f) => f.docId === doc.id) })),
  );
}

/** 書類待ち（0102 の1通の鍵）ごとの Web の状況: 頼んだ・届いた（ファイルの数） */
export function docRequestStatus(wh: WorkingHousehold, now: Date = new Date()): Map<string, { requested: boolean; files: number; answer: DocumentAnswer["status"] | null }> {
  const out = new Map<string, { requested: boolean; files: number; answer: DocumentAnswer["status"] | null }>();
  for (const e of webLog(wh)) {
    const st = statusOf(e, now);
    if (st === "cancelled" || st === "expired") continue;
    for (const d of e.record.selection.documents) {
      if (d.docRequest === undefined) continue;
      const cur = out.get(d.docRequest) ?? { requested: false, files: 0, answer: null };
      const ans = e.received?.documents.find((x) => x.id === d.id);
      out.set(d.docRequest, { requested: true, files: cur.files + (e.files ?? []).filter((f) => f.docId === d.id).length, answer: ans?.status ?? cur.answer });
    }
  }
  return out;
}

export function fileBytes(f: StoredDocumentFile): Uint8Array<ArrayBuffer> {
  return fromB64u(f.data);
}

/** 書類を保存するときの名前（顧客番号・書類の見出し・番号。氏名は入れない） */
export function documentFileName(customerNo: string, title: string, f: StoredDocumentFile, n: number): string {
  const safe = title.replace(/[\\/:*?"<>|\s（）()]+/g, "_").replace(/_+$/, "").slice(0, 40);
  return `${customerNo}_${safe}_${n}.${MIME_EXT[f.mime]}`;
}

/** 受け取った書類のファイルを世帯から外す（写し終えたら消す） */
export function withoutFile(wh: WorkingHousehold, requestId: string, fileId: string): WorkingHousehold {
  const e = webLog(wh).find((x) => x.record.requestId === requestId);
  if (e === undefined) return wh;
  return withWebEntry(wh, { ...e, files: (e.files ?? []).filter((f) => f.fileId !== fileId) });
}

// ---- 事務所のひな形（事務所の既定値 0073 の hearingTemplates） ----

export interface HearingTemplate {
  name: string;
  selection: WebSelection;
}

export const TEMPLATE_MAX = 20;

export function readHearingTemplates(v: unknown): HearingTemplate[] {
  if (!Array.isArray(v)) return [];
  const out: HearingTemplate[] = [];
  for (const t of v.slice(0, TEMPLATE_MAX)) {
    if (typeof t !== "object" || t === null) continue;
    const o = t as { name?: unknown; selection?: unknown };
    const s = o.selection as WebSelection | undefined;
    if (typeof o.name !== "string" || o.name.trim() === "" || s === undefined || typeof s !== "object" || s === null || typeof s.base?.sheetId !== "string" || !Array.isArray(s.sections) || !Array.isArray(s.custom) || !Array.isArray(s.documents)) continue;
    if (OFFICIAL_SHEETS.find((d) => d.sheetId === s.base.sheetId && d.version === s.base.version) === undefined) continue;
    out.push({ name: o.name.trim().slice(0, 40), selection: s });
  }
  return out;
}

/** 元に戻す・やり直すで、Web の依頼の記録を今のものに保つ（サーバーの状態と食い違わないように。控え・明細の記録と同じ扱い） */
export function keepWebLog(next: WorkingHousehold, cur: WorkingHousehold): WorkingHousehold {
  const now = webLog(cur);
  if (webLog(next) === now) return next;
  const log = logOf(next);
  const { web: _w, ...rest } = log as typeof log & { web?: unknown };
  void _w;
  return { ...next, hearing: now.length > 0 ? { ...rest, web: now } : rest };
}

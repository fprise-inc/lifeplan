// Web のヒアリング（0125）の FP の側（作業の層）: 依頼の記録・状況・受け取り・取り込み・受け取った書類・事務所のひな形。
// - 依頼の記録（鍵の組の秘密鍵・合言葉・問いの鍵の元を含む）と受け取った答え・書類は、世帯の取り込みの記録（hearing.web）に置き、
//   世帯ファイルと一緒に世帯の鍵で暗号化される（0011・0013）。画面の保存機能・ログには置かない（0016）
// - 通信は本体の命令（hearing_web_call）だけが行う。開発用のサーバーでは同じ所の /api/hearing/v1（メモリの置き場か手元の wrangler dev）
// - 受け取ったら、世帯に保存してから、受け取った答え・書類の送りだけをサーバーから消す。取り込みは Excel と同じ候補の画面（viewOfResult）で FP が承認する
// - 書類は答えと別に、期限まで何回でも届く（0158）。受け取るたびに、何をいつ受け取ったかを送りごとに残す
// - 期限は30日の決め打ち。延長は押した日から30日（作った日から90日まで）
import { importAnswers, OFFICIAL_SHEETS, requestIdFrom, type SheetDefinition } from "../../../../hearing/src/index.ts";
import { axisOf } from "../../../../hearing/src/definition.ts";
import { exportAnswers } from "../../../../hearing/src/export.ts";
import type { EngineRequest as HearingEngineRequest } from "../../../../hearing/src/types.ts";
import { b64u, fromB64u } from "../../../../hearing/src/web/b64.ts";
import { DOCUMENT_TEMPLATES, docForCheck, HIDE_NUMBERS, MIME_EXT, OWNER_LABEL, templateOf, type DocumentMime, type DocumentOwner } from "../../../../hearing/src/web/documents.ts";
import { extendRequest, extendTarget, filledOf, issueRequest, receive, removeReceived, type WebRequestRecord } from "../../../../hearing/src/web/fp.ts";
import { gateOptions } from "../../../../hearing/src/web/flow.ts";
import { buildPacket, CUSTOM_PREFIX, documentCovers, FP_SECTION, GATE_IDS, importDefinition, selectionFromSheet, type DocumentAnswer, type GateAnswers, type GateId, type OfficeFace, type QuestionsPacket, type RequestedDocument, type WebSelection } from "../../../../hearing/src/web/packet.ts";
import { relay, RELAY_LIMITS, type RelayTransport } from "../../../../hearing/src/web/protocol.ts";
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
  /** どの書類の送りで届いたか（0158） */
  batchId?: string;
}

export interface WebReceived {
  at: string;
  submittedAt: string;
  answers: Answer[];
  /** 答えを送ったときの書類ごとの状態（ファイルは書類の送りで別に届く） */
  documents: DocumentAnswer[];
  /** 分岐の問いの答え（お子さまの人数・ご両親のことを答えるか など。0158） */
  gates: GateAnswers;
  dropped: number;
}

/** 受け取った書類の送り1回分の記録（何をいつ受け取ったか。ファイルの中身は files にある。消しても記録は残す） */
export interface WebBatchRecord {
  batchId: string;
  /** お客さまが送った日時（申告）と、受け取った日時 */
  sentAt: string;
  receivedAt: string;
  /** 書類ごとの受け取ったファイルの数 */
  documents: { id: string; files: number }[];
  /** 受け取れなかったファイル（指紋・形が合わない・世帯の上限を超えた） */
  missingFiles: number;
}

export type WebState = "issued" | "received" | "imported" | "cancelled";

/** Web の依頼1件の記録 */
export interface WebLogEntry {
  record: WebRequestRecord;
  state: WebState;
  received?: WebReceived;
  files?: StoredDocumentFile[];
  /** 受け取った書類の送り（古い順） */
  batches?: WebBatchRecord[];
  importedAt?: string;
  /** FP が受け付けを終えた（サーバーから消した）日時。答えを受け取った後で URL を止めたとき */
  closedAt?: string;
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

/**
 * 画面に出す状況（期限は発行の記録の日時で決める）。undone は、取り込んだ後に元に戻して、世帯の取り込みの記録からその依頼が消えたもの
 * （依頼の記録は元に戻すで戻さない〔keepWebLog〕ので、世帯の取り込みの記録と照らして出す）
 */
export type WebStatus = "issued" | "answered" | "received" | "imported" | "undone" | "expired" | "cancelled";

/** その依頼がまだ書類・答えを受け付けているか（期限の中・取り消していない・受け付けを終えていない） */
export function accepting(e: WebLogEntry, now: Date): boolean {
  return e.state !== "cancelled" && e.closedAt === undefined && Date.parse(e.record.expiresAt) > now.getTime();
}

export function statusOf(e: WebLogEntry, now: Date, answered = false, wh?: WorkingHousehold): WebStatus {
  if (e.state === "imported") return wh !== undefined && !logOf(wh).imports.some((i) => i.requestId === e.record.requestId) ? "undone" : "imported";
  if (e.state === "received") return "received";
  if (e.state === "cancelled") return "cancelled";
  if (Date.parse(e.record.expiresAt) <= now.getTime()) return "expired";
  return answered ? "answered" : "issued";
}

export const STATUS_TEXT: Readonly<Record<WebStatus, string>> = { issued: "発行済み", answered: "回答あり", received: "受け取り済み", imported: "取り込み済み", undone: "受け取り済み（取り込みを元に戻しました）", expired: "期限切れ", cancelled: "取り消し" };

/** お客さまが送った日時の言葉（例: 11月6日 22:15） */
export function sentAtText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "不明" : d.toLocaleString("ja-JP", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

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

/** 持ち主の言葉（「ご本人」「配偶者」「配偶者の方」、または self・spouse）→ 持ち主（0190）。分からなければ undefined */
export function ownerFrom(whose: string | null | undefined): DocumentOwner | undefined {
  if (whose === "self" || whose === "ご本人") return "self";
  if (whose === "spouse" || whose === "配偶者" || whose === "配偶者の方") return "spouse";
  return undefined;
}

/** 書類の持ち主を変える（見出しの括弧「（ご本人）」も付け替える。FP の画面・受け取った書類の一覧で、どなたの書類か分かるように） */
export function withOwner(doc: RequestedDocument, owner: DocumentOwner | undefined): RequestedDocument {
  const tags = Object.values(OWNER_LABEL).map((l) => `（${l}）`);
  const tag = tags.find((x) => doc.title.endsWith(x));
  const base = tag === undefined ? doc.title : doc.title.slice(0, -tag.length);
  const { owner: _o, ...rest } = doc;
  void _o;
  return owner === undefined ? { ...rest, title: base } : { ...rest, title: base === "" ? base : `${base}（${OWNER_LABEL[owner]}）`, owner };
}

/** 一覧から足すときの持ち主の初めの値: 人の書類はご本人（同じ書類をもうご本人の分で頼んでいれば配偶者の方）。ほかは選ばない */
export function defaultOwner(sel: WebSelection, kind: string): DocumentOwner | undefined {
  if (templateOf(kind)?.whose !== "person") return undefined;
  return sel.documents.some((d) => d.kind === kind && d.owner === "self") && !sel.documents.some((d) => d.kind === kind && d.owner === "spouse") ? "spouse" : "self";
}

/** 公式の書類のひな形から頼む書類を作る（owner は持ち主。「ご本人」などの言葉でもよい） */
export function documentFromTemplate(sel: WebSelection, kind: string, owner?: string): RequestedDocument {
  const t = DOCUMENT_TEMPLATES.find((x) => x.kind === kind);
  return withOwner({ id: nextDocId(sel), kind, title: t?.title ?? kind, purpose: t?.purpose ?? "", where: t?.where ?? "" }, ownerFrom(owner));
}

/** 書類待ちの1通（0102）から頼む書類を作る（書類待ちと結びつける。人の書類は持ち主も入れる） */
export function documentFromCheck(sel: WebSelection, r: DocRequest): RequestedDocument {
  const kind = docForCheck(r.doc);
  const t = templateOf(kind);
  const fields = [...new Set(r.values.map((v) => v.field))];
  const doc: RequestedDocument = { id: nextDocId(sel), kind, title: r.title, purpose: t?.purpose ?? "数字を確かめるため", where: fields.length > 0 ? `${fields.join("・")}の欄` : (t?.where ?? ""), docRequest: r.id };
  const owner = t?.whose === "person" ? ownerFrom(r.whose) : undefined;
  return owner === undefined ? doc : withOwner({ ...doc, title: r.doc }, owner);
}

/** 頼んだ書類で分かる問いの1項目（どの書類で・誰の分か。全員の分なら who は null） */
export interface CoverageInfo {
  docs: string[];
  who: string[] | null;
}

/** 頼んだ書類で分かる問い（項目キー → どの書類で・誰の分か。0190） */
export function coverageOf(def: SheetDefinition, sel: WebSelection): Map<string, CoverageInfo> {
  const out = new Map<string, CoverageInfo>();
  for (const d of sel.documents) {
    for (const c of documentCovers(def, sel, d)) {
      const [key, n] = c.split("#") as [string, string | undefined];
      const cur: CoverageInfo = out.get(key) ?? { docs: [], who: [] };
      if (!cur.docs.includes(d.title)) cur.docs.push(d.title);
      // 誰の分か（大人の繰り返しの番号）。全員の分の書類があれば null
      const who = n === undefined ? null : (axisOf(def, key)?.labels[Number(n) - 1] ?? `${n}番目`);
      cur.who = cur.who === null || who === null ? null : cur.who.includes(who) ? cur.who : [...cur.who, who];
      out.set(key, cur);
    }
  }
  return out;
}

/** 項目の行の「？」の説明 */
export function coverageHelp(c: CoverageInfo): string {
  const scope = c.who === null ? "" : `（${c.who.join("・")}の分）`;
  return `${c.docs.join("・")}を頼んでいるので、お客さまの画面にはこの問い${scope}を出しません。お客さまが「手元にない」を選んだときだけ、この問いを出します。`;
}

// ---- 事務所の見た目 → お客さまのページ ----

export function officeFace(o: { name: string; color: string | null; purpose: string; privacyContact: string }): OfficeFace {
  return { name: o.name.trim().slice(0, 60), color: o.color, purpose: o.purpose.trim().slice(0, 120), privacyContact: o.privacyContact.trim().slice(0, 120) };
}

/** 見本の問い（通信しない。FP のアプリの見本に使う） */
export async function previewPacket(wh: WorkingHousehold, sel: WebSelection, office: OfficeFace, now: Date): Promise<QuestionsPacket> {
  const def = sheetOf(sel);
  if (def === undefined) throw new Error("E_HEARING_NO_SHEET");
  return buildPacket(def, sel, { requestId: "R-PREV1E", expiresAt: new Date(now.getTime() + RELAY_LIMITS.days * 86400_000).toISOString(), office, prefill: prefillOf(wh, def) });
}

// ---- 発行 ----

export interface IssueInput {
  selection: WebSelection;
  customerNo: string;
  office: OfficeFace;
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
    ...(docs > 0 ? [`・書類の写真をお願いする所があります。${HIDE_NUMBERS}`, "・書類は、お答えを送った後でも、期限までに同じリンクから何回でも送れます。"] : []),
    "・お答えと書類は、お使いの端末の中で暗号化して送られ、担当の FP だけが開けます。",
    "・このリンクはご本人さま専用です。ほかの方に転送しないでください。",
    "",
    "わからない所は空けたままでかまいません。どうぞよろしくお願いいたします。",
  ].join("\n");
}

// ---- 受け取り ----

/** サーバーの状況（答えがあるか・まだ受け取っていない書類の送りの数・今の期限）。消えていれば null */
export async function checkAnswered(e: WebLogEntry, t: RelayTransport): Promise<{ answered: boolean; newAnswers: boolean; batches: number; expiresAt: string; limitAt: string } | null> {
  try {
    const st = await relay.status(t, e.record.serverId, e.record.secrets.pickupToken);
    const known = new Set((e.batches ?? []).map((b) => b.batchId));
    return { answered: st.submitted, newAnswers: st.answers && e.received === undefined, batches: st.batches.filter((b) => !known.has(b.batchId)).length, expiresAt: st.expiresAt, limitAt: st.limitAt };
  } catch (err) {
    if (err instanceof Error && (err.message === "E_RELAY_GONE" || err.message === "E_RELAY_EXPIRED")) return null;
    throw err;
  }
}

/** 受け取ったもの（サーバーから消す分） */
export interface WebTaken {
  answers: boolean;
  batches: string[];
  files: number;
  missingFiles: number;
  badBatches: number;
  dropped: number;
}

/**
 * 届いている答え（まだ受け取っていなければ）と書類の送りを受け取り、世帯に入れる。入れた後、呼ぶ側が保存してから cleanupOnServer を呼ぶ。
 * 新しく届いたものが無ければ null。答えを受け取った後も、書類の送りは何回でも受け取れる
 */
export async function receiveWeb(wh: WorkingHousehold, e: WebLogEntry, t: RelayTransport, now: Date = new Date()): Promise<{ wh: WorkingHousehold; entry: WebLogEntry; taken: WebTaken } | null> {
  const def = sheetOf(e.record.selection);
  if (def === undefined) throw new Error("E_HEARING_NO_SHEET");
  const got = await receive(e.record, def, t, { answers: e.received === undefined, knownBatches: (e.batches ?? []).map((b) => b.batchId) });
  if (got === null) return null;
  const at = now.toISOString().replace(/\.\d+Z$/, "Z");
  const kept = webLog(wh).flatMap((x) => (x.record.requestId === e.record.requestId ? (e.files ?? []) : (x.files ?? [])));
  let room = STORED_DOCUMENTS_MAX_BYTES - kept.reduce((s, f) => s + f.bytes, 0);
  const files: StoredDocumentFile[] = [...(e.files ?? [])];
  const batches: WebBatchRecord[] = [...(e.batches ?? [])];
  let newFiles = 0;
  let missing = 0;
  for (const b of got.batches) {
    const per = new Map<string, number>();
    let over = 0;
    for (const f of b.files) {
      if (f.bytes.length > room) {
        over++;
        continue;
      }
      room -= f.bytes.length;
      files.push({ docId: f.docId, fileId: f.fileId, mime: f.mime, data: b64u(f.bytes), bytes: f.bytes.length, sha256: f.sha256, batchId: b.batchId });
      per.set(f.docId, (per.get(f.docId) ?? 0) + 1);
      newFiles++;
    }
    missing += b.missingFiles + over;
    batches.push({ batchId: b.batchId, sentAt: b.sentAt, receivedAt: at, documents: [...per.entries()].map(([id, n]) => ({ id, files: n })), missingFiles: b.missingFiles + over });
  }
  const a = got.answers;
  const entry: WebLogEntry = {
    ...e,
    record: { ...e.record, expiresAt: got.expiresAt, limitAt: got.limitAt },
    state: a !== null && e.state === "issued" ? "received" : e.state,
    ...(a !== null ? { received: { at, submittedAt: a.submittedAt, answers: a.answers, documents: a.documents, gates: a.gates, dropped: a.dropped } } : {}),
    files,
    batches,
  };
  const taken: WebTaken = { answers: a !== null, batches: got.batches.map((b) => b.batchId), files: newFiles, missingFiles: missing, badBatches: got.badBatches, dropped: a?.dropped ?? 0 };
  return { wh: withWebEntry(wh, entry), entry, taken };
}

/** 受け取って世帯に保存した答え・書類の送りをサーバーから消す（依頼と問いは期限まで残る。お客さまは書類を足せる） */
export async function cleanupOnServer(e: WebLogEntry, taken: Pick<WebTaken, "answers" | "batches">, t: RelayTransport): Promise<void> {
  await removeReceived(e.record, t, taken);
}

/** サーバーから消す（取り消し・受け付けを終える。URL はもう開けない） */
export async function removeOnServer(e: WebLogEntry, t: RelayTransport): Promise<void> {
  await relay.remove(t, e.record.serverId, e.record.secrets.pickupToken);
}

/**
 * 延長のボタンの状態。押せるのは、受け付けている依頼で、期限がまだ上限（発行した日から90日）より前のとき。
 * どこまで延びるかはサーバーが決める（押した日から30日。この PC の時計とずれても、サーバーの時計で決まる）。to はこの PC の時計での目安（延びなければ null）
 */
export function extendState(e: WebLogEntry, now: Date): { ok: true; to: string | null; capped: boolean } | { ok: false; reason: "limit" | "closed" } {
  if (!accepting(e, now)) return { ok: false, reason: "closed" };
  if (Date.parse(e.record.expiresAt) >= Date.parse(limitOf(e.record))) return { ok: false, reason: "limit" };
  const t = extendTarget({ expiresAt: e.record.expiresAt, limitAt: limitOf(e.record) }, now);
  // 1日も延びないとき（発行したすぐ後など）は目安を出さない
  const gain = t === null ? 0 : Date.parse(t.to) - Date.parse(e.record.expiresAt);
  return gain >= 86400_000 && t !== null ? { ok: true, to: t.to, capped: t.capped } : { ok: true, to: null, capped: false };
}

/** 延長できる上限（作った日から90日。前の記録に無ければ発行の日時から） */
export function limitOf(r: WebRequestRecord): string {
  return typeof r.limitAt === "string" ? r.limitAt : new Date(Date.parse(r.issuedAt) + RELAY_LIMITS.maxTotalDays * 86400_000).toISOString().replace(/\.\d+Z$/, "Z");
}

/** 期限を延ばし、依頼の記録の期限を書き換える（押した日から30日。作った日から90日まで） */
export async function extendWeb(wh: WorkingHousehold, e: WebLogEntry, t: RelayTransport): Promise<{ wh: WorkingHousehold; entry: WebLogEntry; changed: boolean }> {
  const v = await extendRequest(e.record, t);
  const entry: WebLogEntry = { ...e, record: { ...e.record, expiresAt: v.expiresAt, limitAt: v.limitAt } };
  return { wh: withWebEntry(wh, entry), entry, changed: v.expiresAt !== e.record.expiresAt };
}

// ---- 分岐の答え（0158） ----

const GATE_LABEL: Readonly<Record<GateId, string>> = { spouse: "配偶者の方", child: "お子さま", loan: "住宅ローン", policy: "保険", parent: "ご両親のこと" };

/** 分岐の答えを言葉にする（「お子さま: いない」「ご両親のこと: いいえ（今回は答えない）」）。並びは決まった順 */
export function gateLines(e: WebLogEntry): { gate: GateId; label: string; text: string }[] {
  const g = e.received?.gates ?? {};
  const def = sheetOf(e.record.selection);
  const counts = new Map(def?.axes.map((a) => [a.id, a.count]) ?? []);
  return GATE_IDS.filter((id) => g[id] !== undefined).map((id) => {
    const n = g[id] as number;
    // 言葉は、お客さまの画面の選択肢と同じもの（人数の最後の段は「4人以上」）
    const text = gateOptions(id, counts.get(id) ?? 1).find((o) => o.value === String(n))?.label ?? String(n);
    return { gate: id, label: GATE_LABEL[id], text };
  });
}

/** 今の世帯の人数・本数・件数（分岐の答えと照らす） */
function currentCounts(wh: WorkingHousehold): Partial<Record<GateId, number>> {
  const h = wh.request.input.household;
  const members = h.members ?? [];
  // 住まいの住宅ローン（収益不動産のローンは数えない）
  const loans = (h.debts ?? []).filter((d) => d.kind === "mortgage" && d.property === undefined).length;
  return { spouse: members.some((m) => m.kind === "spouse") ? 1 : 0, child: members.filter((m) => m.kind === "child").length, loan: loans, policy: (h.insuranceContracts ?? []).length };
}

/** 面談の準備: いちばん新しく受け取った Web のヒアリングの分岐の答えと、今の世帯との違い（「お子さま: いない（今の世帯は2人）」） */
export function gateNotes(wh: WorkingHousehold): { requestId: string; receivedAt: string; lines: { label: string; text: string; now: string | null }[] } | null {
  const e = webLog(wh)
    .filter((x) => x.received !== undefined && Object.keys(x.received.gates ?? {}).length > 0)
    .sort((a, b) => ((a.received?.at ?? "") < (b.received?.at ?? "") ? 1 : -1))[0];
  if (e === undefined || e.received === undefined) return null;
  const cur = currentCounts(wh);
  const unit: Partial<Record<GateId, string>> = { child: "人", loan: "本", policy: "件" };
  const lines = gateLines(e).map((l) => {
    const n = e.received?.gates[l.gate];
    const c = cur[l.gate];
    if (l.gate === "parent" || c === undefined || n === undefined || n === c) return { label: l.label, text: l.text, now: null };
    // 人数の最後の段（4人以上）と同じかそれより多いときは違いとしない
    const top = (sheetOf(e.record.selection)?.axes.find((a) => a.id === l.gate)?.count ?? 0) === n && c >= n;
    if (top) return { label: l.label, text: l.text, now: null };
    const now = l.gate === "spouse" ? (c === 1 ? "いらっしゃる" : "いらっしゃらない") : `${c}${unit[l.gate] ?? ""}`;
    return { label: l.label, text: l.text, now };
  });
  return { requestId: e.record.requestId, receivedAt: e.received.at, lines };
}

/** 受け取った答えを、Excel と同じ候補の一覧にする（取り込みの画面で FP が承認する） */
export function importWeb(wh: WorkingHousehold, e: WebLogEntry, appVersion: string, newId?: () => string): ImportView {
  const def = sheetOf(e.record.selection);
  if (def === undefined || e.received === undefined) throw new Error("E_HEARING_NO_SHEET");
  const idef = importDefinition(def, e.record.selection);
  const filled = filledOf(e.record, { answers: e.received.answers }, appVersion);
  // 記入の年月は送った月（ページが入れる）。計算基準月より後でも、1年までは知らせない
  const r = importAnswers(idef, filled, { baseMonth: wh.request.input.baseMonth, filledOnIsSubmission: true, ...(newId !== undefined ? { newId } : {}) });
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

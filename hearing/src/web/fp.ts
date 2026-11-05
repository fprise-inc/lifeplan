// Web のヒアリング（0125）の FP の側: 依頼を作ってサーバーに置く（issueRequest）、答えと書類を受け取って開く（receive）、
// 取り込みの受け皿（filled-sheet）にそろえる（filledOf）。乱数・鍵の組は WebCrypto、通信は渡された通り道（アプリは本体の命令）。
// - 依頼の記録（WebRequestRecord）は世帯ファイルの中（暗号化）にだけ置く。秘密鍵・受け取りの合言葉・問いの鍵の元を含む
// - 受け取った答えは checkAnswers で確かめ、書類は指紋（SHA-256）・形（見出しのバイト）・大きさを確かめる。合わないものは受け取らない
import { HEARING_FORMAT, HEARING_FORMAT_VERSION, type FilledSheet } from "../answers.ts";
import type { SheetDefinition } from "../definition.ts";
import { fromB64u, fromUtf8, utf8 } from "./b64.ts";
import { DOCUMENT_LIMITS, sniffMime, type DocumentMime } from "./documents.ts";
import { derive, fragmentOf, newRequestSecrets, openAsFp, sealQuestions, sha256Hex, type RequestSecrets } from "./e2e.ts";
import { buildPacket, checkAnswers, type CheckedAnswers, type OfficeFace, type QuestionsPacket, type WebSelection } from "./packet.ts";
import { relay, RELAY_LIMITS, type RelayTransport } from "./protocol.ts";
import type { Answer } from "../answers.ts";

/** 依頼の記録（世帯ファイルの中だけ。0013 の世帯の鍵で暗号化される） */
export interface WebRequestRecord {
  readonly kind: "web";
  readonly requestId: string;
  /** サーバーの上の名前 */
  readonly serverId: string;
  readonly secrets: RequestSecrets;
  readonly selection: WebSelection;
  readonly digest: string;
  readonly customerNo: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** お客さまに送る URL（フラグメントに鍵を含む。漏れると問いを読まれる） */
  readonly url: string;
}

export interface IssueOptions {
  readonly definition: SheetDefinition;
  readonly selection: WebSelection;
  readonly requestId: string;
  readonly customerNo: string;
  readonly office: OfficeFace;
  /** 有効期限の日数（1〜30） */
  readonly days: number;
  readonly now: Date;
  /** お客さまのページの URL（# の前まで。例 https://<受け付けのホスト>/h/） */
  readonly pageUrl: string;
  readonly prefill?: readonly Answer[];
  readonly transport: RelayTransport;
}

export interface Issued {
  readonly record: WebRequestRecord;
  readonly packet: QuestionsPacket;
}

export function expiresOn(now: Date, days: number): string {
  const d = Math.min(RELAY_LIMITS.maxDays, Math.max(RELAY_LIMITS.minDays, Math.trunc(days)));
  return new Date(now.getTime() + d * 86400_000).toISOString().replace(/\.\d+Z$/, "Z");
}

/** 依頼を作ってサーバーに置く（サーバーに置くのは問いの暗号文と2つの合言葉のハッシュ・有効期限だけ） */
export async function issueRequest(o: IssueOptions): Promise<Issued> {
  const secrets = await newRequestSecrets();
  const d = await derive(fromB64u(secrets.secret));
  const expiresAt = expiresOn(o.now, o.days);
  const packet = await buildPacket(o.definition, o.selection, { requestId: o.requestId, expiresAt, office: o.office, ...(o.prefill !== undefined ? { prefill: o.prefill } : {}) });
  const questions = await sealQuestions(utf8(JSON.stringify(packet)), d, secrets.publicKey);
  if (questions.length > RELAY_LIMITS.questionsChars) throw new Error("E_WEB_TOO_LARGE");
  await relay.create(o.transport, { id: d.id, questions, submitHash: await sha256Hex(d.submitToken), pickupHash: await sha256Hex(secrets.pickupToken), expiresAt });
  const record: WebRequestRecord = {
    kind: "web",
    requestId: o.requestId,
    serverId: d.id,
    secrets,
    selection: o.selection,
    digest: packet.digest,
    customerNo: o.customerNo,
    issuedAt: o.now.toISOString().replace(/\.\d+Z$/, "Z"),
    expiresAt,
    url: `${o.pageUrl}#${fragmentOf(secrets)}`,
  };
  return { record, packet };
}

export interface ReceivedFile {
  readonly docId: string;
  readonly fileId: string;
  readonly mime: DocumentMime;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly sha256: string;
}

export interface Received {
  readonly checked: CheckedAnswers;
  readonly files: readonly ReceivedFile[];
  /** 受け取れなかった書類のファイル（指紋・形が合わない・サーバーに無い） */
  readonly missingFiles: number;
}

/**
 * 答えと書類を受け取って開く。まだ送られていなければ null。受け取ったあと、サーバーから消すのは呼ぶ側（世帯に保存してから remove）
 */
export async function receive(rec: WebRequestRecord, def: SheetDefinition, t: RelayTransport): Promise<Received | null> {
  const st = await relay.status(t, rec.serverId, rec.secrets.pickupToken);
  if (!st.submitted) return null;
  const env = await relay.answers(t, rec.serverId, rec.secrets.pickupToken);
  const plain = await openAsFp(env, rec.secrets.privateKey, rec.serverId, { kind: "answers" });
  let json: unknown;
  try {
    json = JSON.parse(fromUtf8(plain));
  } catch {
    throw new Error("E_WEB_ANSWERS_SHAPE");
  }
  const checked = checkAnswers(json, def, rec.selection, rec.requestId);
  const files: ReceivedFile[] = [];
  let missing = 0;
  const onServer = new Set(st.files.map((f) => f.fileId));
  for (const d of checked.documents) {
    for (const f of d.files) {
      if (!onServer.has(f.fileId)) {
        missing++;
        continue;
      }
      try {
        const data = await relay.file(t, rec.serverId, f.fileId, rec.secrets.pickupToken);
        const bytes = await openAsFp(data, rec.secrets.privateKey, rec.serverId, { kind: "document", docId: f.fileId });
        const mime = sniffMime(bytes);
        const digest = await sha256Hex(bytes);
        if (bytes.length !== f.bytes || bytes.length > DOCUMENT_LIMITS.fileBytes || mime === null || mime !== f.mime || digest !== f.sha256) {
          missing++;
          continue;
        }
        files.push({ docId: d.id, fileId: f.fileId, mime, bytes, sha256: digest });
      } catch {
        missing++;
      }
    }
  }
  return { checked, files, missingFiles: missing };
}

/** 受け取った答えを、Excel と同じ受け皿（記入済みのシートの中身）にそろえる。管理の値はアプリの側の依頼の記録から作る（届いたものを信用しない） */
export function filledOf(rec: WebRequestRecord, checked: Pick<CheckedAnswers, "answers">, appVersion: string): FilledSheet {
  return {
    management: {
      format: HEARING_FORMAT,
      formatVersion: HEARING_FORMAT_VERSION,
      sheetId: rec.selection.base.sheetId,
      sheetVersion: rec.selection.base.version,
      requestId: rec.requestId,
      customerNo: rec.customerNo,
      layoutDigest: rec.digest,
      appVersion,
      exportedOn: rec.issuedAt.slice(0, 10),
    },
    answers: checked.answers,
  };
}

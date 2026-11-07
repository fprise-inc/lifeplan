// Web のヒアリング（0125）の FP の側: 依頼を作ってサーバーに置く（issueRequest）、答えと書類を受け取って開く（receive）、
// 取り込みの受け皿（filled-sheet）にそろえる（filledOf）。乱数・鍵の組は WebCrypto、通信は渡された通り道（アプリは本体の命令）。
// - 依頼の記録（WebRequestRecord）は世帯ファイルの中（暗号化）にだけ置く。秘密鍵・受け取りの合言葉・問いの鍵の元を含む
// - 受け取った答えは checkAnswers で確かめ、書類は指紋（SHA-256）・形（見出しのバイト）・大きさを確かめる。合わないものは受け取らない
// - 書類は答えと別の「書類の送り」で何回でも届く（0158）。受け取るたびに、届いている答え（まだ受け取っていなければ）と送りを全部受け取る
// - 期限は30日の決め打ち。延長（extendRequest）は押した日から30日、作った日から90日まで
import { HEARING_FORMAT, HEARING_FORMAT_VERSION, type FilledSheet } from "../answers.ts";
import type { SheetDefinition } from "../definition.ts";
import { fromB64u, fromUtf8, utf8 } from "./b64.ts";
import { DOCUMENT_LIMITS, sniffMime, type DocumentMime } from "./documents.ts";
import { derive, fragmentOf, newRequestSecrets, openAsFp, sealQuestions, sha256Hex, type RequestSecrets } from "./e2e.ts";
import { buildPacket, checkAnswers, checkDocuments, type CheckedAnswers, type OfficeFace, type QuestionsPacket, type WebSelection } from "./packet.ts";
import { relay, RELAY_LIMITS, type ExpiryView, type RelayTransport } from "./protocol.ts";
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
  /** 有効期限（サーバーの値。延長すると書き換える） */
  readonly expiresAt: string;
  /** 延長できる上限（作った日から90日。サーバーの値） */
  readonly limitAt: string;
  /** お客さまに送る URL（フラグメントに鍵を含む。漏れると問いを読まれる） */
  readonly url: string;
}

export interface IssueOptions {
  readonly definition: SheetDefinition;
  readonly selection: WebSelection;
  readonly requestId: string;
  readonly customerNo: string;
  readonly office: OfficeFace;
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

/** 作った日から30日（問いの中に入れる目安。本当の期限はサーバーが決めて返す） */
export function expiresOn(now: Date): string {
  return new Date(now.getTime() + RELAY_LIMITS.days * 86400_000).toISOString().replace(/\.\d+Z$/, "Z");
}

/** 依頼を作ってサーバーに置く（サーバーに置くのは問いの暗号文と2つの合言葉のハッシュだけ。期限はサーバーが決める: 30日） */
export async function issueRequest(o: IssueOptions): Promise<Issued> {
  const secrets = await newRequestSecrets();
  const d = await derive(fromB64u(secrets.secret));
  const packet = await buildPacket(o.definition, o.selection, { requestId: o.requestId, expiresAt: expiresOn(o.now), office: o.office, ...(o.prefill !== undefined ? { prefill: o.prefill } : {}) });
  const questions = await sealQuestions(utf8(JSON.stringify(packet)), d, secrets.publicKey);
  if (questions.length > RELAY_LIMITS.questionsChars) throw new Error("E_WEB_TOO_LARGE");
  const { expiresAt, limitAt } = await relay.create(o.transport, { id: d.id, questions, submitHash: await sha256Hex(d.submitToken), pickupHash: await sha256Hex(secrets.pickupToken) });
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
    limitAt,
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

/** 受け取った書類の送り1回分 */
export interface ReceivedBatch {
  readonly batchId: string;
  /** お客さまが送った日時（送り状の申告）と、サーバーが受けた日時 */
  readonly sentAt: string;
  readonly serverAt: string;
  readonly files: readonly ReceivedFile[];
  /** 受け取れなかったファイル（指紋・形が合わない・サーバーに無い・申告の形が違う） */
  readonly missingFiles: number;
}

export interface Received {
  /** 答え（サーバーにまだあり、受け取ると言ったときだけ。無ければ null） */
  readonly answers: CheckedAnswers | null;
  readonly batches: readonly ReceivedBatch[];
  /** 開けなかった・形の違う書類の送り（受け取らない。サーバーには残す） */
  readonly badBatches: number;
  readonly expiresAt: string;
  readonly limitAt: string;
  readonly submittedAt: string | null;
}

export interface ReceiveOptions {
  /** 答えを受け取るか（もう受け取った依頼は false。サーバーに残っていても読まない） */
  readonly answers: boolean;
  /** もう受け取った書類の送りの番号（サーバーに残っていても読まない。消し損ねたとき） */
  readonly knownBatches?: readonly string[];
}

/**
 * 答えと書類の送りを受け取って開く。新しく届いたものが無ければ null。受け取ったあと、サーバーから消すのは呼ぶ側（世帯に保存してから
 * removeReceived）。答えの暗号文が開けない・形が違うときは投げる（何も受け取らない）。書類の送りは1回ずつ確かめ、開けないものは数えて飛ばす
 */
export async function receive(rec: WebRequestRecord, def: SheetDefinition, t: RelayTransport, o: ReceiveOptions = { answers: true }): Promise<Received | null> {
  const st = await relay.status(t, rec.serverId, rec.secrets.pickupToken);
  const known = new Set(o.knownBatches ?? []);
  const todo = st.batches.filter((b) => !known.has(b.batchId));
  const wantAnswers = o.answers && st.answers;
  if (!wantAnswers && todo.length === 0) return null;
  let answers: CheckedAnswers | null = null;
  if (wantAnswers) {
    const env = await relay.answers(t, rec.serverId, rec.secrets.pickupToken);
    const plain = await openAsFp(env, rec.secrets.privateKey, rec.serverId, { kind: "answers" });
    let json: unknown;
    try {
      json = JSON.parse(fromUtf8(plain));
    } catch {
      throw new Error("E_WEB_ANSWERS_SHAPE");
    }
    answers = checkAnswers(json, def, rec.selection, rec.requestId);
  }
  const batches: ReceivedBatch[] = [];
  let bad = 0;
  for (const b of todo) {
    let checked;
    try {
      const got = await relay.batch(t, rec.serverId, b.batchId, rec.secrets.pickupToken);
      const plain = await openAsFp(got.data, rec.secrets.privateKey, rec.serverId, { kind: "batch", batchId: b.batchId });
      checked = checkDocuments(JSON.parse(fromUtf8(plain)), rec.selection, rec.requestId, b.batchId, got.files);
    } catch {
      bad++;
      continue;
    }
    const files: ReceivedFile[] = [];
    let missing = checked.dropped;
    for (const d of checked.documents) {
      for (const f of d.files) {
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
    batches.push({ batchId: b.batchId, sentAt: checked.sentAt, serverAt: b.at, files, missingFiles: missing });
  }
  if (answers === null && batches.length === 0 && bad === 0) return null;
  return { answers, batches, badBatches: bad, expiresAt: st.expiresAt, limitAt: st.limitAt, submittedAt: st.submittedAt };
}

/** 受け取って世帯に保存した答え・書類の送りを、サーバーから消す（依頼と問いは期限まで残る。お客さまは書類を足せる） */
export async function removeReceived(rec: WebRequestRecord, t: RelayTransport, got: { readonly answers: boolean; readonly batches: readonly string[] }): Promise<void> {
  if (got.answers) await relay.removeAnswers(t, rec.serverId, rec.secrets.pickupToken);
  for (const b of got.batches) await relay.removeBatch(t, rec.serverId, b, rec.secrets.pickupToken);
}

/** 期限を延ばす（押した日から30日。作った日から90日まで。上限なら E_RELAY_EXTEND_LIMIT） */
export async function extendRequest(rec: WebRequestRecord, t: RelayTransport): Promise<ExpiryView> {
  return relay.extend(t, rec.serverId, rec.secrets.pickupToken);
}

/** 延長したら期限がどこまで延びるか（押した日から30日。上限を超えれば上限）。延びなければ null */
export function extendTarget(rec: Pick<WebRequestRecord, "expiresAt" | "limitAt">, now: Date): { readonly to: string; readonly capped: boolean } | null {
  const cap = Date.parse(rec.limitAt);
  const want = now.getTime() + RELAY_LIMITS.days * 86400_000;
  const to = Math.min(want, cap);
  if (to <= Date.parse(rec.expiresAt)) return null;
  return { to: new Date(to).toISOString().replace(/\.\d+Z$/, "Z"), capped: want >= cap };
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

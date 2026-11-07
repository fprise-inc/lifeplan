// Web のヒアリング（0125）のお客さまの側: URL のフラグメントから鍵を出し、問いを受け取って開く・書類を暗号化して置く・答えを暗号化して送る。
// お客さまのページ（app/src/hearingForm/）と、FP のアプリの見本（通信しない）から使う
// - 書類は答えと別に動く（0158）: ファイルを置き、送り状（どの書類のどのファイルか）を「書類の送り」として送る。答えの前でも後でも、期限まで何回でも
import { fromUtf8, utf8 } from "./b64.ts";
import { b64u } from "./b64.ts";
import { derive, openDraft, openQuestions, parseFragment, randomBytes, sealDraft, sealForFp, sha256Hex, type Derived, type Fragment } from "./e2e.ts";
import { documentsPacketOf, type DraftFile } from "./flow.ts";
import { QUESTIONS_FORMAT, type AnswersPacket, type QuestionsPacket } from "./packet.ts";
import { relay, RELAY_LIMITS, type RelayTransport } from "./protocol.ts";

export interface Opened {
  readonly fragment: Fragment;
  readonly keys: Derived;
  /** 問い（期限 expiresAt は、延長を反映したサーバーの値に置き換えてある） */
  readonly packet: QuestionsPacket;
  readonly submitted: boolean;
  /** 答えを送った日時（まだなら null） */
  readonly submittedAt: string | null;
  readonly expiresAt: string;
}

/** 問いの中身の形を確かめる（暗号文が正しく開けた後。形の違うものは E_WEB_PACKET） */
export function readPacket(v: unknown): QuestionsPacket {
  const o = v as Partial<QuestionsPacket> | null;
  if (o === null || typeof o !== "object" || o.format !== QUESTIONS_FORMAT || !Array.isArray(o.items) || !Array.isArray(o.sections) || !Array.isArray(o.documents) || typeof o.requestId !== "string" || typeof o.office !== "object" || o.consent === undefined) throw new Error("E_WEB_PACKET");
  return o as QuestionsPacket;
}

/** URL のフラグメントから鍵を出し、問いを受け取って開く */
export async function openRequest(hash: string, t: RelayTransport): Promise<Opened> {
  const fragment = parseFragment(hash);
  if (fragment === null) throw new Error("E_WEB_LINK");
  const keys = await derive(fragment.secret);
  const v = await relay.questions(t, keys.id);
  const plain = await openQuestions(v.questions, keys, fragment.publicKeyText);
  // 期限は FP が延ばせる（問いの中の期限は作ったときの値）。画面にはサーバーの今の期限を出す
  const packet = { ...readPacket(JSON.parse(fromUtf8(plain))), expiresAt: v.expiresAt };
  return { fragment, keys, packet, submitted: v.submitted, submittedAt: v.submittedAt ?? null, expiresAt: v.expiresAt };
}

/** 書類のファイルを FP の公開鍵あてに暗号化して置く（ファイルの番号・指紋を返す。答えの一覧に載せる） */
export async function uploadFile(o: Opened, bytes: Uint8Array<ArrayBuffer>, t: RelayTransport): Promise<{ fileId: string; sha256: string }> {
  const fileId = b64u(randomBytes(12));
  const data = await sealForFp(bytes, o.fragment.publicKey, o.keys.id, { kind: "document", docId: fileId });
  if (data.length > RELAY_LIMITS.documentChars) throw new Error("E_RELAY_TOO_LARGE");
  await relay.putFile(t, o.keys.id, fileId, data, o.keys.submitToken);
  return { fileId, sha256: await sha256Hex(bytes) };
}

export async function removeFile(o: Opened, fileId: string, t: RelayTransport): Promise<void> {
  await relay.deleteFile(t, o.keys.id, fileId, o.keys.submitToken);
}

/** 16進の前の12バイト */
const hexBytes = (hex: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(12);
  for (let i = 0; i < 12; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** 送りの番号: 送るファイルの番号から決める（同じファイルの送り直しは同じ番号になり、サーバーは2回目を同じ送りとして受ける） */
export async function batchIdOf(fileIds: readonly string[]): Promise<string> {
  return b64u(hexBytes(await sha256Hex([...fileIds].sort().join(","))));
}

/** 書類の送り: 付けたファイル（置いてあるもの）の送り状を FP の公開鍵あてに暗号化して送る。送ったファイルの番号を返す */
export async function sendDocuments(o: Opened, list: readonly { readonly id: string; readonly files: readonly DraftFile[] }[], t: RelayTransport, now: Date = new Date()): Promise<string[]> {
  const fileIds = list.flatMap((x) => x.files.map((f) => f.fileId));
  if (fileIds.length === 0) return [];
  const batchId = await batchIdOf(fileIds);
  const packet = documentsPacketOf(o.packet, list, batchId, now);
  const data = await sealForFp(utf8(JSON.stringify(packet)), o.fragment.publicKey, o.keys.id, { kind: "batch", batchId });
  if (data.length > RELAY_LIMITS.batchChars) throw new Error("E_RELAY_TOO_LARGE");
  await relay.putBatch(t, o.keys.id, batchId, { data, files: fileIds }, o.keys.submitToken);
  return fileIds;
}

/** 答えを FP の公開鍵あてに暗号化して送る（1回だけ。2回目はサーバーが断る） */
export async function submitAnswers(o: Opened, answers: AnswersPacket, t: RelayTransport): Promise<void> {
  const data = await sealForFp(utf8(JSON.stringify(answers)), o.fragment.publicKey, o.keys.id, { kind: "answers" });
  if (data.length > RELAY_LIMITS.answersChars) throw new Error("E_RELAY_TOO_LARGE");
  await relay.submit(t, o.keys.id, data, o.keys.submitToken);
}

/** 下書きの置き場の名前（端末の中。依頼ごと） */
export const draftStorageKey = (keys: Derived): string => `financia-hearing-draft:${keys.id}`;
/** 答えを送った後の書類の下書きと、この端末から送った書類の控えの置き場の名前（端末の中。依頼ごと。0158） */
export const moreStorageKey = (keys: Derived): string => `financia-hearing-more:${keys.id}`;

export async function sealDraftText(keys: Derived, draft: unknown): Promise<string> {
  return sealDraft(utf8(JSON.stringify({ at: Date.now(), draft })), keys);
}

/** 下書きを開く（開けない・30日より古いものは null） */
export async function openDraftText(keys: Derived, text: string): Promise<unknown> {
  try {
    const v = JSON.parse(fromUtf8(await openDraft(text, keys))) as { at?: number; draft?: unknown };
    if (typeof v.at !== "number" || Date.now() - v.at > 31 * 86400_000) return null;
    return v.draft ?? null;
  } catch {
    return null;
  }
}

// Web のヒアリング（0125）のお客さまの側: URL のフラグメントから鍵を出し、問いを受け取って開く・書類を暗号化して置く・答えを暗号化して送る。
// お客さまのページ（app/src/hearingForm/）と、FP のアプリの見本（通信しない）から使う
import { fromUtf8, utf8 } from "./b64.ts";
import { b64u } from "./b64.ts";
import { derive, openDraft, openQuestions, parseFragment, randomBytes, sealDraft, sealForFp, sha256Hex, type Derived, type Fragment } from "./e2e.ts";
import { QUESTIONS_FORMAT, type AnswersPacket, type QuestionsPacket } from "./packet.ts";
import { relay, RELAY_LIMITS, type RelayTransport } from "./protocol.ts";

export interface Opened {
  readonly fragment: Fragment;
  readonly keys: Derived;
  readonly packet: QuestionsPacket;
  readonly submitted: boolean;
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
  return { fragment, keys, packet: readPacket(JSON.parse(fromUtf8(plain))), submitted: v.submitted, expiresAt: v.expiresAt };
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

/** 答えを FP の公開鍵あてに暗号化して送る（1回だけ。2回目はサーバーが断る） */
export async function submitAnswers(o: Opened, answers: AnswersPacket, t: RelayTransport): Promise<void> {
  const data = await sealForFp(utf8(JSON.stringify(answers)), o.fragment.publicKey, o.keys.id, { kind: "answers" });
  if (data.length > RELAY_LIMITS.answersChars) throw new Error("E_RELAY_TOO_LARGE");
  await relay.submit(t, o.keys.id, data, o.keys.submitToken);
}

/** 下書きの置き場の名前（端末の中。依頼ごと） */
export const draftStorageKey = (keys: Derived): string => `financia-hearing-draft:${keys.id}`;

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

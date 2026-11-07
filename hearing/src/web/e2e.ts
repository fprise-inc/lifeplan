// Web のヒアリング（0125）の端から端までの暗号化（E2E）。WebCrypto の標準の部品だけを使い、自前の暗号は作らない。
// - 依頼ごとに FP のアプリが作るもの: 問いの鍵の元（32バイトの乱数。URL のフラグメントで渡す）・FP の鍵の組（ECDH P-256。公開鍵は
//   フラグメントで渡し、秘密鍵は世帯ファイルの中だけに置く）・受け取りの合言葉（32バイトの乱数。サーバーにはハッシュだけを置く）
// - 問いの鍵の元から HKDF-SHA256 で導くもの: サーバーの上の名前（id）・送るときの合言葉（submit。サーバーにはハッシュだけ）・
//   問いを解く鍵（AES-GCM）・端末の中の下書きの鍵（AES-GCM）
// - 答えと書類は、お客さまのブラウザが使い捨ての鍵の組を作り、FP の公開鍵と ECDH で共有の値を出し、HKDF-SHA256 で AES-GCM の鍵にして
//   暗号化する。開けるのは FP の秘密鍵だけ（URL が漏れても、送った答えは読めない）
// - 暗号文には、何の暗号文か（問い・答え・書類の番号）と依頼の名前を追加の認証データ（AAD）として結びつける（差し替え・付け替えを断る）
// URL のフラグメント（# の後）はブラウザがサーバーに送らない。サーバーが持つのは暗号文と2つの合言葉のハッシュだけ
import { b64u, fromB64u, utf8 } from "./b64.ts";

/** 暗号の形の版（フラグメント・封筒の頭に入れる） */
export const E2E_VERSION = "1";
const SALT = utf8("financia-hearing-web-v1");
const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

async function hkdf(ikm: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: string, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: utf8(info) }, key, bytes * 8));
}

async function aesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sha256Hex(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const d = typeof data === "string" ? utf8(data) : data;
  return [...new Uint8Array(await subtle().digest("SHA-256", d))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 依頼の鍵の元から導いた値（お客さまのページと FP のアプリの両方で同じものを出す） */
export interface Derived {
  /** サーバーの上の名前（16バイト。base64url で22字） */
  readonly id: string;
  /** 送るときの合言葉（32バイトの base64url。サーバーにはハッシュだけ） */
  readonly submitToken: string;
  readonly questionKey: CryptoKey;
  readonly draftKey: CryptoKey;
}

export async function derive(secret: Uint8Array<ArrayBuffer>): Promise<Derived> {
  if (secret.length !== 32) throw new Error("E_WEB_SECRET");
  const id = b64u(await hkdf(secret, SALT, "id", 16));
  const submitToken = b64u(await hkdf(secret, SALT, "submit", 32));
  const questionKey = await aesKey(await hkdf(secret, SALT, "questions", 32));
  const draftKey = await aesKey(await hkdf(secret, SALT, "draft", 32));
  return { id, submitToken, questionKey, draftKey };
}

/** FP の側で依頼ごとに作るもの（秘密鍵と合言葉は世帯ファイルの中だけに置く） */
export interface RequestSecrets {
  /** 問いの鍵の元（base64url。URL のフラグメントで渡す） */
  readonly secret: string;
  /** FP の公開鍵（ECDH P-256 の圧縮しない形の65バイト。base64url） */
  readonly publicKey: string;
  /** FP の秘密鍵（PKCS#8 の base64url） */
  readonly privateKey: string;
  /** 受け取りの合言葉（32バイトの base64url。サーバーにはハッシュだけ） */
  readonly pickupToken: string;
}

export async function newRequestSecrets(): Promise<RequestSecrets> {
  const pair = (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  const priv = new Uint8Array(await subtle().exportKey("pkcs8", pair.privateKey));
  return { secret: b64u(randomBytes(32)), publicKey: b64u(pub), privateKey: b64u(priv), pickupToken: b64u(randomBytes(32)) };
}

/** URL のフラグメント（# の後）: 版.問いの鍵の元.FP の公開鍵 */
export function fragmentOf(s: Pick<RequestSecrets, "secret" | "publicKey">): string {
  return `${E2E_VERSION}.${s.secret}.${s.publicKey}`;
}

export interface Fragment {
  readonly secret: Uint8Array<ArrayBuffer>;
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly publicKeyText: string;
}

/** フラグメントを読む（形が違えば null） */
export function parseFragment(hash: string): Fragment | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const m = /^1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{87})$/.exec(h);
  if (m === null) return null;
  try {
    const secret = fromB64u(m[1] as string);
    const publicKey = fromB64u(m[2] as string);
    if (secret.length !== 32 || publicKey.length !== 65 || publicKey[0] !== 4) return null;
    return { secret, publicKey, publicKeyText: m[2] as string };
  } catch {
    return null;
  }
}

/** 何の暗号文か（AAD に入れる） */
export type Purpose = { readonly kind: "questions" } | { readonly kind: "answers" } | { readonly kind: "document"; readonly docId: string } | { readonly kind: "batch"; readonly batchId: string } | { readonly kind: "draft" };

/** 用途の文字（AAD と鍵の導きに入れる。書類のファイルは番号、書類の送り状は送りの番号で分ける。0158） */
const what = (p: Purpose): string => (p.kind === "document" ? `document:${p.docId}` : p.kind === "batch" ? `batch:${p.batchId}` : p.kind);

function aad(id: string, p: Purpose, extra: string): Uint8Array<ArrayBuffer> {
  return utf8(`financia-hearing|${E2E_VERSION}|${id}|${what(p)}|${extra}`);
}

/** 問いを暗号化する（問いを解く鍵で。AAD に FP の公開鍵を入れ、フラグメントの公開鍵との組み合わせを確かめる）。封筒は「1.iv.暗号文」 */
export async function sealQuestions(plain: Uint8Array<ArrayBuffer>, d: Derived, publicKeyText: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad(d.id, { kind: "questions" }, publicKeyText) }, d.questionKey, plain));
  return `${E2E_VERSION}.${b64u(iv)}.${b64u(ct)}`;
}

export async function openQuestions(envelope: string, d: Derived, publicKeyText: string): Promise<Uint8Array<ArrayBuffer>> {
  const m = /^1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/.exec(envelope);
  if (m === null) throw new Error("E_WEB_ENVELOPE");
  try {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: fromB64u(m[1] as string), additionalData: aad(d.id, { kind: "questions" }, publicKeyText) }, d.questionKey, fromB64u(m[2] as string)));
  } catch {
    throw new Error("E_WEB_DECRYPT");
  }
}

/** 下書きを暗号化する（端末の中だけに置く。依頼の鍵の元から導いた鍵） */
export async function sealDraft(plain: Uint8Array<ArrayBuffer>, d: Derived): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad(d.id, { kind: "draft" }, "") }, d.draftKey, plain));
  return `${E2E_VERSION}.${b64u(iv)}.${b64u(ct)}`;
}

export async function openDraft(envelope: string, d: Derived): Promise<Uint8Array<ArrayBuffer>> {
  const m = /^1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/.exec(envelope);
  if (m === null) throw new Error("E_WEB_ENVELOPE");
  try {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: fromB64u(m[1] as string), additionalData: aad(d.id, { kind: "draft" }, "") }, d.draftKey, fromB64u(m[2] as string)));
  } catch {
    throw new Error("E_WEB_DECRYPT");
  }
}

/**
 * FP の公開鍵あてに暗号化する（答え・書類）。使い捨ての鍵の組の公開鍵・HKDF の塩・iv を封筒に入れる。
 * 封筒は「1.使い捨ての公開鍵.塩.iv.暗号文」
 */
export async function sealForFp(plain: Uint8Array<ArrayBuffer>, fpPublicKey: Uint8Array<ArrayBuffer>, id: string, p: Purpose): Promise<string> {
  const fp = await subtle().importKey("raw", fpPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const ephPub = b64u(new Uint8Array(await subtle().exportKey("raw", eph.publicKey)));
  const shared = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: fp }, eph.privateKey, 256));
  const salt = randomBytes(16);
  const info = `financia-hearing-seal|${E2E_VERSION}|${id}|${what(p)}`;
  const key = await aesKey(await hkdf(shared, salt, info, 32));
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad(id, p, ephPub) }, key, plain));
  return `${E2E_VERSION}.${ephPub}.${b64u(salt)}.${b64u(iv)}.${b64u(ct)}`;
}

/** FP の秘密鍵で開く（改ざん・別の依頼や別の書類の暗号文の付け替えは E_WEB_DECRYPT） */
export async function openAsFp(envelope: string, privateKeyPkcs8: string, id: string, p: Purpose): Promise<Uint8Array<ArrayBuffer>> {
  const m = /^1\.([A-Za-z0-9_-]{87})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/.exec(envelope);
  if (m === null) throw new Error("E_WEB_ENVELOPE");
  try {
    const priv = await subtle().importKey("pkcs8", fromB64u(privateKeyPkcs8), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const eph = await subtle().importKey("raw", fromB64u(m[1] as string), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: eph }, priv, 256));
    const info = `financia-hearing-seal|${E2E_VERSION}|${id}|${what(p)}`;
    const key = await aesKey(await hkdf(shared, fromB64u(m[2] as string), info, 32));
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: fromB64u(m[3] as string), additionalData: aad(id, p, m[1] as string) }, key, fromB64u(m[4] as string)));
  } catch {
    throw new Error("E_WEB_DECRYPT");
  }
}

/** 封筒の中身の大きさ（バイト。base64url を戻した長さの目安。上限の確かめ用） */
export function envelopeBytes(envelope: string): number {
  return Math.floor((envelope.length * 3) / 4);
}

// 持ち帰り用のレポートのファイルの入れ物（0030）。アプリ（書き出す側）とファイルの中の画面（開く側）が同じ部品を使う。
// - データ（TakeawayData の JSON）は gzip で縮め、パスワードを付けたときは PBKDF2（SHA-256・60万回）で作った鍵の AES-256-GCM で暗号化し、
//   Base64 にして HTML の中のデータの塊（実行されない <script type="application/octet-stream">）に入れる
// - 見出し（形式・版・暗号の値・塩・IV）は平文の JSON。暗号化するときは見出しの文字列を AES-GCM の追加の認証データにして、値の書き換えも見つける
// - パスワードはファイルにもアプリにも残さない（鍵はその場で作って捨てる）
// - 使うのはブラウザの標準の機能だけ（CompressionStream・DecompressionStream・WebCrypto）。外の部品は使わない
export const TAKEAWAY_KDF_ITERATIONS = 600_000;

export interface ContainerHeader {
  format: "financia.takeaway";
  v: 1;
  zip: "gzip";
  /** 暗号化していなければ null */
  enc: { cipher: "AES-256-GCM"; kdf: "PBKDF2-SHA256"; iter: number; salt: string; iv: string } | null;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text.replace(/\s+/g, ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function canCompress(): boolean {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

export const gzip = (bytes: Uint8Array): Promise<Uint8Array> => pipe(bytes, new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
export const gunzip = (bytes: Uint8Array): Promise<Uint8Array> => pipe(bytes, new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);

async function deriveKey(password: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as Uint8Array<ArrayBuffer>, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** 見出しを決まった並びの文字列にする（暗号化するときの追加の認証データ） */
export function headerText(h: ContainerHeader): string {
  const e = h.enc === null ? null : { cipher: h.enc.cipher, kdf: h.enc.kdf, iter: h.enc.iter, salt: h.enc.salt, iv: h.enc.iv };
  return JSON.stringify({ format: h.format, v: h.v, zip: h.zip, enc: e });
}

export interface Sealed {
  header: ContainerHeader;
  /** データの塊（Base64） */
  body: string;
}

/** データを縮めて（パスワードがあれば暗号化して）入れ物にする。random は乱数（テストで決まった値を渡せる） */
export async function seal(json: string, password: string | null, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): Promise<Sealed> {
  const zipped = await gzip(enc.encode(json));
  if (password === null) return { header: { format: "financia.takeaway", v: 1, zip: "gzip", enc: null }, body: toBase64(zipped) };
  const salt = random(16);
  const iv = random(12);
  const header: ContainerHeader = { format: "financia.takeaway", v: 1, zip: "gzip", enc: { cipher: "AES-256-GCM", kdf: "PBKDF2-SHA256", iter: TAKEAWAY_KDF_ITERATIONS, salt: toBase64(salt), iv: toBase64(iv) } };
  const key = await deriveKey(password, salt, TAKEAWAY_KDF_ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer>, additionalData: enc.encode(headerText(header)) }, key, zipped as Uint8Array<ArrayBuffer>);
  return { header, body: toBase64(new Uint8Array(ct)) };
}

export class WrongPassword extends Error {
  constructor() {
    super("E_TAKEAWAY_PASSWORD");
  }
}

/** 見出しの形を確かめる（ファイルの中の値なので、そのまま信じない） */
export function readHeader(text: string): ContainerHeader {
  const h = JSON.parse(text) as Partial<ContainerHeader>;
  if (h.format !== "financia.takeaway" || h.v !== 1 || h.zip !== "gzip") throw new Error("E_TAKEAWAY_FORMAT");
  if (h.enc === null || h.enc === undefined) return { format: "financia.takeaway", v: 1, zip: "gzip", enc: null };
  const e = h.enc;
  if (e.cipher !== "AES-256-GCM" || e.kdf !== "PBKDF2-SHA256" || typeof e.iter !== "number" || e.iter < 100_000 || e.iter > 10_000_000 || typeof e.salt !== "string" || typeof e.iv !== "string") throw new Error("E_TAKEAWAY_FORMAT");
  return { format: "financia.takeaway", v: 1, zip: "gzip", enc: { cipher: e.cipher, kdf: e.kdf, iter: e.iter, salt: e.salt, iv: e.iv } };
}

/** 入れ物を開く（暗号化していればパスワードで）。違うパスワード・書き換えは WrongPassword */
export async function open(header: ContainerHeader, body: string, password: string | null): Promise<string> {
  let zipped = fromBase64(body);
  if (header.enc !== null) {
    if (password === null) throw new WrongPassword();
    const key = await deriveKey(password, fromBase64(header.enc.salt), header.enc.iter);
    try {
      zipped = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(header.enc.iv) as Uint8Array<ArrayBuffer>, additionalData: enc.encode(headerText(header)) }, key, zipped as Uint8Array<ArrayBuffer>));
    } catch {
      throw new WrongPassword();
    }
  }
  return dec.decode(await gunzip(zipped));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Base64(text: string): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

/** HTML の中のデータの塊の id */
export const BLOCK = { header: "fx-header", data: "fx-data", engine: "fx-engine" } as const;

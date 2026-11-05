// base64url（= を付けない）と UTF-8 の変換（画面・お客さまのページ・サーバーで同じものを使う。Node の組み込みを使わない）
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const R = new Map([...A].map((c, i) => [c, i]));

export function b64u(bytes: Uint8Array): string {
  let s = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    s += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + A[(n >> 6) & 63]! + A[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    s += A[(n >> 18) & 63]! + A[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    s += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + A[(n >> 6) & 63]!;
  }
  return s;
}

export function fromB64u(text: string): Uint8Array<ArrayBuffer> {
  if (text.length % 4 === 1) throw new Error("E_B64");
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (const c of text) {
    const v = R.get(c);
    if (v === undefined) throw new Error("E_B64");
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 255;
    }
  }
  return out.subarray(0, o) as Uint8Array<ArrayBuffer>;
}

export const utf8 = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(b);

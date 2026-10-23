// 文字コードの見分け（0034 の3）: BOM（UTF-8・UTF-16）を先に見て、無ければ UTF-8 として厳密に読み、読めなければ Shift_JIS（Windows-31J）。
// TextDecoder は画面（WebView）でも Node でも使える。外の部品は使わない
export type Encoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "shift_jis";

export interface Decoded {
  readonly text: string;
  readonly encoding: Encoding;
}

export function decodeText(bytes: Uint8Array): Decoded {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8-bom" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("shift_jis").decode(bytes), encoding: "shift_jis" };
  }
}

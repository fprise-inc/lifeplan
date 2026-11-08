// セルの値と、列の文字・セルの参照の読み書き（書き出しと読み込みで共通）

/** セルの値（数は文字のまま持つ: 10進の桁を失わないため） */
export type CellValue = { readonly kind: "number"; readonly text: string } | { readonly kind: "text"; readonly text: string } | { readonly kind: "bool"; readonly value: boolean };

/** 文字のセルの値 */
export const text = (t: string): CellValue => ({ kind: "text", text: t });

/** 数のセルの値 */
export const num = (n: number | string): CellValue => ({ kind: "number", text: String(n) });

/** 列の文字を 0 から数えた番号に（A → 0） */
export function colIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 から数えた番号を列の文字に */
export function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 名前の定義の参照（'シート'!$C$12）を読む。範囲・#REF! は null */
export function parseRef(ref: string | undefined): { sheet: string; col: number; row: number } | null {
  if (ref === undefined) return null;
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref.trim());
  if (m === null) return null;
  const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] as string);
  return { sheet, col: colIndex(m[3] as string), row: Number(m[4]) };
}

/** シートの名前を参照の形（'シート'）に */
export const quoteSheet = (name: string): string => `'${name.replace(/'/g, "''")}'`;

/** 表計算のソフトが見せる数の桁（有効数字 15 桁） */
const SHOWN_DIGITS = 15;

/**
 * 表計算のソフトが保存した数のセルの値（2進の浮動小数点を 17 桁で書いたもの。例「6.2500000000000003E-3」「0.10000000000000001」）を、
 * 画面に見えている精度（有効数字 15 桁）に丸めた 10進の文字（指数なし）にする。shift は 10 の何乗を掛けるか
 * （パーセントの書式のセルの値を、見えている % の数にするときは 2）。読めない形は null
 */
export function shownNumber(text: string, shift = 0): string | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (m === null) return null;
  const int = m[2] ?? "";
  const frac = m[3] ?? "";
  if (int === "" && frac === "") return null;
  const exp = (m[4] === undefined ? 0 : Number(m[4])) + shift;
  if (Math.abs(exp) > 400) return null;
  const all = int + frac;
  let digits = all.replace(/^0+/, "");
  if (digits === "") return "0";
  // 値 = 0.<digits> × 10^point
  let point = int.length - (all.length - digits.length) + exp;
  if (digits.length > SHOWN_DIGITS) {
    const up = Number(digits[SHOWN_DIGITS]) >= 5;
    let head = digits.slice(0, SHOWN_DIGITS);
    if (up) {
      const inc = (BigInt(head) + 1n).toString();
      if (inc.length > SHOWN_DIGITS) point += 1;
      head = inc.slice(0, SHOWN_DIGITS);
    }
    digits = head;
  }
  digits = digits.replace(/0+$/, "");
  if (digits === "") return "0";
  const s = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return m[1] === "-" ? `-${s}` : s;
}

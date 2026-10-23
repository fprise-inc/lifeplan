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

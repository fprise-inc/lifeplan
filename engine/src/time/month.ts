// 0003: 計算の最小単位は月。エンジンの中では「年×12＋(月−1)」の整数で持つ
import { EngineError } from "../errors.ts";
import { numTable } from "../engine/numTable.ts";

export type MonthIndex = number & { readonly __brand: "MonthIndex" };

export function monthIndex(year: number, month: number): MonthIndex {
  // Number.isInteger と同じ判定を、組み込みの関数を呼ばずに（NaN・Infinity は % 1 が NaN になって外れる。0005 の追記（2026-10-10））
  if (typeof year !== "number" || year % 1 !== 0 || typeof month !== "number" || month % 1 !== 0 || month < 1 || month > 12) {
    throw new EngineError("E_ARGUMENT", ["monthIndex"]);
  }
  return (year * 12 + (month - 1)) as MonthIndex;
}

// 読んだ月の文字列の結果（同じ文字列は同じ結果。お金の動き・支払いの月は同じ文字列が何万回も出る。0005 の追記（2026-10-10））
const PARSED = new Map<string, MonthIndex>();

/** "YYYY-MM" を月の通し番号にする（正規表現 ^(\d{4})-(0[1-9]|1[0-2])$ と同じ判定を、速さのため文字ごとに行う） */
export function parseYm(text: string): MonthIndex {
  if (typeof text !== "string") throw new EngineError("E_ARGUMENT", ["yearMonth"]);
  const hit = PARSED.get(text);
  if (hit !== undefined) return hit;
  if (text.length === 7 && text.charCodeAt(4) === 45) {
    // 数字でない文字は 0〜9 の外になる（関数を呼ばずに1文字ずつ）
    const y0 = text.charCodeAt(0) - 48;
    const y1 = text.charCodeAt(1) - 48;
    const y2 = text.charCodeAt(2) - 48;
    const y3 = text.charCodeAt(3) - 48;
    const m0 = text.charCodeAt(5) - 48;
    const m1 = text.charCodeAt(6) - 48;
    if (y0 >= 0 && y0 <= 9 && y1 >= 0 && y1 <= 9 && y2 >= 0 && y2 <= 9 && y3 >= 0 && y3 <= 9 && m0 >= 0 && m0 <= 9 && m1 >= 0 && m1 <= 9) {
      if ((m0 === 0 && m1 >= 1) || (m0 === 1 && m1 <= 2)) {
        const m = ((y0 * 1000 + y1 * 100 + y2 * 10 + y3) * 12 + (m0 * 10 + m1 - 1)) as MonthIndex;
        if (PARSED.size < 100000) PARSED.set(text, m);
        return m;
      }
    }
  }
  throw new EngineError("E_ARGUMENT", ["yearMonth"]);
}

export function yearOf(m: MonthIndex): number {
  return Math.floor(m / 12);
}

/** 1〜12 */
export function monthOf(m: MonthIndex): number {
  return m - yearOf(m) * 12 + 1;
}

// 同じ月の文字列は使い回す（部品は月ごとに何度も作る）。文字列は不変なので計算の結果には影響しない
const FORMATTED = numTable<string>();
let formattedCount = 0;

export function formatYm(m: MonthIndex): string {
  const hit = FORMATTED[m];
  if (hit !== undefined) return hit;
  const mm = monthOf(m);
  const s = `${String(yearOf(m)).padStart(4, "0")}-${mm < 10 ? "0" : ""}${mm}`;
  if (formattedCount < 100000) {
    FORMATTED[m] = s;
    formattedCount++;
  }
  return s;
}

export function addMonths(m: MonthIndex, n: number): MonthIndex {
  if (!Number.isInteger(n)) throw new EngineError("E_ARGUMENT", ["addMonths"]);
  return (m + n) as MonthIndex;
}

/** その年の最初の月（1月）と最後の月（12月） */
export function januaryOf(year: number): MonthIndex {
  return monthIndex(year, 1);
}

export function decemberOf(year: number): MonthIndex {
  return monthIndex(year, 12);
}

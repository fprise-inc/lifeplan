// 0003: 計算の最小単位は月。エンジンの中では「年×12＋(月−1)」の整数で持つ
import { EngineError } from "../errors.ts";

export type MonthIndex = number & { readonly __brand: "MonthIndex" };

export function monthIndex(year: number, month: number): MonthIndex {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new EngineError("E_ARGUMENT", ["monthIndex"]);
  }
  return (year * 12 + (month - 1)) as MonthIndex;
}

const digit = (text: string, i: number): number => {
  const c = text.charCodeAt(i) - 48;
  return c >= 0 && c <= 9 ? c : -1;
};

/** "YYYY-MM" を月の通し番号にする（正規表現 ^(\d{4})-(0[1-9]|1[0-2])$ と同じ判定を、速さのため文字ごとに行う） */
export function parseYm(text: string): MonthIndex {
  if (typeof text === "string" && text.length === 7 && text.charCodeAt(4) === 45) {
    const y0 = digit(text, 0);
    const y1 = digit(text, 1);
    const y2 = digit(text, 2);
    const y3 = digit(text, 3);
    const m0 = digit(text, 5);
    const m1 = digit(text, 6);
    if (y0 >= 0 && y1 >= 0 && y2 >= 0 && y3 >= 0 && m0 >= 0 && m1 >= 0) {
      const month = m0 * 10 + m1;
      if ((m0 === 0 && m1 >= 1) || (m0 === 1 && m1 <= 2)) return ((y0 * 1000 + y1 * 100 + y2 * 10 + y3) * 12 + (month - 1)) as MonthIndex;
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
const FORMATTED = new Map<number, string>();

export function formatYm(m: MonthIndex): string {
  const hit = FORMATTED.get(m);
  if (hit !== undefined) return hit;
  const mm = monthOf(m);
  const s = `${String(yearOf(m)).padStart(4, "0")}-${mm < 10 ? "0" : ""}${mm}`;
  if (FORMATTED.size < 100000) FORMATTED.set(m, s);
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

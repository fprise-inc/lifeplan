// 0003: 計算の最小単位は月。エンジンの中では「年×12＋(月−1)」の整数で持つ
import { EngineError } from "../errors.ts";

export type MonthIndex = number & { readonly __brand: "MonthIndex" };

const YM_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function monthIndex(year: number, month: number): MonthIndex {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new EngineError("E_ARGUMENT", ["monthIndex"]);
  }
  return (year * 12 + (month - 1)) as MonthIndex;
}

/** "YYYY-MM" を月の通し番号にする */
export function parseYm(text: string): MonthIndex {
  const m = YM_PATTERN.exec(text);
  if (m === null) throw new EngineError("E_ARGUMENT", ["yearMonth"]);
  return monthIndex(Number(m[1]), Number(m[2]));
}

export function yearOf(m: MonthIndex): number {
  return Math.floor(m / 12);
}

/** 1〜12 */
export function monthOf(m: MonthIndex): number {
  return m - yearOf(m) * 12 + 1;
}

export function formatYm(m: MonthIndex): string {
  const mm = monthOf(m);
  return `${String(yearOf(m)).padStart(4, "0")}-${mm < 10 ? "0" : ""}${mm}`;
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

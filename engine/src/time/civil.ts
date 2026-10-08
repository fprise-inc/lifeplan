// 暦の日付（制度データの適用期間 "YYYY-MM-DD"）。時計ではなく決まった計算（0003）
import { EngineError } from "../errors.ts";

export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

export function parseDate(text: string): CivilDate {
  const m = DATE_PATTERN.exec(text);
  if (m === null) throw new EngineError("E_ARGUMENT", ["date"]);
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (d.day > daysInMonth(d.year, d.month)) throw new EngineError("E_ARGUMENT", ["date"]);
  return d;
}

export function isValidDate(text: string): boolean {
  const m = DATE_PATTERN.exec(text);
  if (m === null) return false;
  return Number(m[3]) <= daysInMonth(Number(m[1]), Number(m[2]));
}

export function formatDate(d: CivilDate): string {
  const p2 = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${String(d.year).padStart(4, "0")}-${p2(d.month)}-${p2(d.day)}`;
}

/** 比較のための整数（年×10000＋月×100＋日） */
export function dateKey(d: CivilDate): number {
  return d.year * 10000 + d.month * 100 + d.day;
}

export function compareDate(a: string, b: string): number {
  return dateKey(parseDate(a)) - dateKey(parseDate(b));
}

export function nextDay(d: CivilDate): CivilDate {
  if (d.day < daysInMonth(d.year, d.month)) return { year: d.year, month: d.month, day: d.day + 1 };
  if (d.month < 12) return { year: d.year, month: d.month + 1, day: 1 };
  return { year: d.year + 1, month: 1, day: 1 };
}

export function previousDay(d: CivilDate): CivilDate {
  if (d.day > 1) return { year: d.year, month: d.month, day: d.day - 1 };
  if (d.month > 1) return { year: d.year, month: d.month - 1, day: daysInMonth(d.year, d.month - 1) };
  return { year: d.year - 1, month: 12, day: 31 };
}

// テストの道具: 計算エンジンの出力から、帳票と同じ書式で数字を作る（帳票の側の書式 parts/format.typ と同じ規則）
import type { EngineOutput, TableCell } from "../src/bundle.ts";

const under = (row: string, prefix: string): boolean => row === prefix || row.startsWith(prefix + ".");

export function group(n: number): string {
  return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 万円の文字列（四捨五入。符号は対称。マイナスは▲） */
export function man(yen: number): string {
  const v = Math.round(Math.abs(yen) / 10000) * (yen < 0 ? -1 : 1);
  return (v < 0 ? "▲" : "") + group(v);
}

export const yenText = (n: number): string => `${n < 0 ? "▲" : ""}${group(n)}円`;

/** 表のマスを年ごとに足す（無い年は undefined） */
export function byYear(r: EngineOutput, pred: (c: TableCell) => boolean): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of r.table) if (pred(c)) out.set(c.year, (out.get(c.year) ?? 0) + c.amount);
  return out;
}

export const ROWS: Record<string, (c: TableCell) => boolean> = {
  収入合計: (c) => under(c.row, "cf.income"),
  支出合計: (c) => under(c.row, "cf.expense") || under(c.row, "cf.taxSi"),
  年間収支: (c) => c.row === "cf.net",
  金融資産残高: (c) => c.row === "cf.balance.financial",
};

export const normalize = (s: string): string => s.replace(/\s+/g, "");

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

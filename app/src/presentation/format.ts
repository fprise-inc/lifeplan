// 表示の書式（計算ではない。国内の帳票に合わせてマイナスは「▲」）
import type { Yen } from "./model.ts";

/** 3桁ごとのカンマ（端末の言語設定に依らない） */
export function group(n: number): string {
  const s = String(Math.abs(Math.trunc(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 万円の数（四捨五入。符号は対称） */
export function toMan(yen: Yen): number {
  const v = Math.round(Math.abs(yen) / 10000);
  return yen < 0 ? -v : v;
}

/** 万円の文字列（単位なし）: 50,920,000 → "5,092"、−20,270,000 → "▲2,027" */
export function man(yen: Yen): string {
  const v = toMan(yen);
  return (v < 0 ? "▲" : "") + group(v);
}

/** 差の万円（＋／▲つき） */
export function manDiff(yen: Yen): string {
  const v = toMan(yen);
  if (v === 0) return "±0";
  return (v > 0 ? "+" : "▲") + group(v);
}

/** 円の文字列: 3012537 → "3,012,537円" */
export function yen(n: Yen): string {
  return (n < 0 ? "▲" : "") + group(n) + "円";
}

/** 月額の万円（1万円未満は円で）: 30000 → "3万円"、0 → "なし" */
export function monthlyMan(n: number): string {
  if (n === 0) return "なし";
  return n % 10000 === 0 ? `${group(n / 10000)}万円` : `${group(n)}円`;
}

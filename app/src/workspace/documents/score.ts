// 読み取りの成績（0148 の5）: 書類の種類・読み手と版（AI なら名乗り）・欄ごとの「合った・直した・読めなかった」の数だけ。
// 値・文字・ID・日時・世帯の物は入れない（顧客データを含まない形）。FP が中身を見てから任意で送ってもらう形にするが、
// 送る仕組みはまだ作らない（この形と、画面で数を見せるところまで）。
// 数え方: 合った＝書類の値のまま承認した、直した＝直して入れた（読めた値を直した）、読めなかった＝読み手が値を出せなかった欄（その後 FP が入れても）。
// 入れない（捨てた）候補は数えない（読み違いとは限らないため。読み違いなら「直す」で入れてもらう）
import type { DocType, DocumentReading, Via } from "./types.ts";

export const SCORE_CONTRACT = "document-reading-score@1";

export interface ReadingScore {
  contract: typeof SCORE_CONTRACT;
  docType: DocType;
  via: Via;
  reader?: { id: string; version: number };
  ai?: { connector: string };
  fields: { item: string; at?: string; matched: number; corrected: number; unreadable: number }[];
}

export function readingScore(r: DocumentReading): ReadingScore {
  const byField = new Map<string, { item: string; at?: string; matched: number; corrected: number; unreadable: number }>();
  for (const c of r.candidates) {
    const at = c.target.at?.join("/");
    const key = `${c.target.item}#${at ?? ""}`;
    const row = byField.get(key) ?? { item: c.target.item, ...(at !== undefined ? { at } : {}), matched: 0, corrected: 0, unreadable: 0 };
    if (c.unreadable === true) row.unreadable++;
    else if (c.status === "accepted") row.matched++;
    else if (c.status === "corrected") row.corrected++;
    else continue;
    byField.set(key, row);
  }
  return {
    contract: SCORE_CONTRACT,
    docType: r.docType,
    via: r.via,
    ...(r.reader !== undefined ? { reader: { ...r.reader } } : {}),
    ...(r.ai !== undefined ? { ai: { connector: r.ai.connector } } : {}),
    fields: [...byField.values()].sort((a, b) => (a.item === b.item ? (a.at ?? "").localeCompare(b.at ?? "") : a.item.localeCompare(b.item))),
  };
}

/** 合計（画面の1行に出す） */
export function scoreTotals(s: ReadingScore): { matched: number; corrected: number; unreadable: number } {
  return s.fields.reduce((t, f) => ({ matched: t.matched + f.matched, corrected: t.corrected + f.corrected, unreadable: t.unreadable + f.unreadable }), { matched: 0, corrected: 0, unreadable: 0 });
}

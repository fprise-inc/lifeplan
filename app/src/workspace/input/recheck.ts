// 確かめの一覧の「次回確かめる」の印（0072）: 行ごとに付け外しし、世帯ファイルの household.recheck（形式の版 0.29 から）に残す。
// 印の付いた行は、次の面談・見直しで確かめることの一覧（面談の確かめの一覧の文）として書き出せる。計算には使わない。
// - 印は行の ID（確かめの一覧の行の ID。欄のキーか入っていない物の ID）で持ち、付けたときのカードと見出しを写す（後で行が消えても、何に付けたか分かる）
// - 値は写さない（書き出すときに今の値を読む）
import type { CheckRow } from "./checkRows.ts";
import type { WorkingHousehold } from "./household.ts";

export interface RecheckMark {
  /** 確かめの一覧の行の ID */
  id: string;
  /** カードの ID と名前（付けたとき） */
  card: string;
  cardLabel: string;
  /** 行の見出し（付けたとき） */
  label: string;
  /** 付けた日（YYYY-MM-DD） */
  on: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 読んだ値から印の一覧（形の合わない行は捨てる） */
export function readRecheck(v: unknown): RecheckMark[] {
  if (!Array.isArray(v)) return [];
  const out: RecheckMark[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    const { id, card, cardLabel, label, on } = x;
    if (typeof id !== "string" || id === "" || typeof card !== "string" || typeof cardLabel !== "string" || typeof label !== "string" || typeof on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(on)) continue;
    if (out.some((m) => m.id === id)) continue;
    out.push({ id, card, cardLabel, label, on });
  }
  return out;
}

export const recheckMarks = (wh: WorkingHousehold): RecheckMark[] => wh.recheck ?? [];

export const isRechecked = (wh: WorkingHousehold, rowId: string): boolean => recheckMarks(wh).some((m) => m.id === rowId);

/** 印を付ける（on は YYYY-MM-DD）・外す（null）。印が無くなったら欄ごと外す */
export function setRecheck(wh: WorkingHousehold, row: Pick<CheckRow, "id" | "card" | "cardLabel" | "label">, on: string | null): WorkingHousehold {
  const rest = recheckMarks(wh).filter((m) => m.id !== row.id);
  const next = on === null ? rest : [...rest, { id: row.id, card: row.card, cardLabel: row.cardLabel, label: row.label, on }];
  const { recheck: _r, ...base } = wh;
  void _r;
  return next.length === 0 ? base : { ...base, recheck: next };
}

/**
 * 面談の確かめの一覧の文（印の付いた行。今の一覧にある行は今の値と状態を添える）。氏名・顧客番号は入れない。
 * 並びは付けた順
 */
export function recheckText(marks: readonly RecheckMark[], rows: readonly CheckRow[]): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lines = ["次回確かめること", ""];
  for (const m of marks) {
    const r = byId.get(m.id);
    const now = r === undefined ? "（今は確かめの一覧にありません）" : [r.value != null ? `今: ${r.value}` : null, r.detail].filter((x) => x !== null).join("／");
    lines.push(`・${m.cardLabel} › ${m.label}${now !== "" ? `\u3000${now}` : ""}`);
  }
  return lines.join("\n");
}

// 表示の設定の前の値（0215）: AI の候補を「反映する」ごとに、その設定の前の値を事務所データの defaults.displayHistory に残す（追記だけ。設定ごとに
// 直近 DISPLAY_HISTORY_MAX 件。古い物から外す）。事務所の既定値の画面の「前の値に戻す」が読む。
// - 置くのは、AI が候補を出せる設定（事務所の既定値の見せ方だけの7つ。connector/displayCatalog.ts の PROPOSABLE_DISPLAY_IDS）だけ。値の形は
//   get_display_settings の今の値（current.office.value）と同じ（事務所データの欄の形が変わっても、戻すときに同じ関数で書き直せる）
// - 読むときは、候補と同じ関数（connector/displayProposal.ts の checkDisplayValue）で確かめ、読めない行・知らない設定は捨てる（無ければ欄を持たない）
// - 前の値に戻したときも、戻す前の値を同じく残す（もう一度戻せる。行の reason が restore）
import { PROPOSABLE_DISPLAY_IDS, type ProposableDisplayId } from "../../connector/displayCatalog.ts";
import { checkDisplayValue } from "../../connector/displayProposal.ts";

/** 設定ごとに残す前の値の数 */
export const DISPLAY_HISTORY_MAX = 3;

/** 前の値の1行（at は残した日時〔UTC の ISO 8601〕。reason は ai＝AI の候補を反映する前・restore＝前の値に戻す前） */
export interface DisplayHistoryEntry {
  value: unknown;
  at: string;
  reason: "ai" | "restore";
}

/** 設定の id → 前の値（古い順） */
export type DisplayHistory = Partial<Record<ProposableDisplayId, DisplayHistoryEntry[]>>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** 読んだ値から前の値（読めない行・知らない設定は捨てる。設定ごとに新しい方から DISPLAY_HISTORY_MAX 件。何も無ければ undefined） */
export function readDisplayHistory(v: unknown): DisplayHistory | undefined {
  if (!isObj(v)) return undefined;
  const out: DisplayHistory = {};
  for (const id of PROPOSABLE_DISPLAY_IDS) {
    const list = v[id];
    if (!Array.isArray(list)) continue;
    const rows: DisplayHistoryEntry[] = [];
    for (const e of list) {
      if (!isObj(e) || typeof e.at !== "string" || !AT.test(e.at) || (e.reason !== "ai" && e.reason !== "restore")) continue;
      const r = checkDisplayValue(id, e.value);
      if (r.ok) rows.push({ value: r.value, at: e.at, reason: e.reason });
    }
    if (rows.length > 0) out[id] = rows.slice(-DISPLAY_HISTORY_MAX);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 前の値を1行足す（後ろに足し、古い物から外して DISPLAY_HISTORY_MAX 件にする） */
export function withHistoryEntry(h: DisplayHistory | undefined, id: ProposableDisplayId, e: DisplayHistoryEntry): DisplayHistory {
  return { ...(h ?? {}), [id]: [...(h?.[id] ?? []), e].slice(-DISPLAY_HISTORY_MAX) };
}

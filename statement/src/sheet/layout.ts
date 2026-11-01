// 前もってお客さまに印を付けてもらう確認シート（表計算のファイル。0034 の9）の決まり: 形式名・管理の値・列の並び・選択肢の言葉。
// 書き出し（write.ts）と読み込み（read.ts）で同じ決まりを使う。管理の値の置き場所と行・列は形式の版で固定する
import { CATEGORIES, type StatementCategory } from "../classify/categories.ts";
import { BUCKET_LABELS, type Bucket } from "../classify/work.ts";
import { looseKey } from "../text/normalize.ts";

/**
 * 埋め込みの形式名と形式の版（β公開までは 0.x）。
 * - 0.1: 迷う行を1行ずつ載せる
 * - 0.2: 店単位で答えられる同じ店の行を1行にまとめる（ご利用日の欄に期間と回数、金額の欄に合計）。列の並び・管理の値の置き場所は 0.1 と同じで、
 *   0.1 のシートもそのまま読める（どの番号がまとめた行かは、シートではなく依頼の記録で決める）
 */
export const SHEET_FORMAT = "fprise-lifeplan-statement-check";
export const SHEET_FORMAT_VERSION = "0.2";
/** ヒアリングシートの形式名（取り違えて読んだときに案内する） */
export const HEARING_SHEET_FORMAT = "fprise-lifeplan-hearing";

/** 見えるシートの名前 */
export const SHEET_NAME = "明細のご確認";

/** 管理の値のキー（隠したシート・ユーザー設定のプロパティで共通） */
export const MANAGE_KEYS = ["format", "formatVersion", "requestId", "customerNo", "rowCount", "appVersion", "exportedOn"] as const;
export type ManageKey = (typeof MANAGE_KEYS)[number];

/** 見える管理欄（1枚目。見出しの列 B、値の列 C） */
export const MANAGE_ROWS = { requestId: 3, customerNo: 4, exportedOn: 5 } as const;
export const MANAGE_LABELS = { requestId: "依頼番号", customerNo: "お客さま番号", exportedOn: "書き出した日" } as const;
export const MANAGE_LABEL_COL = "B";
export const MANAGE_VALUE_COL = "C";

/** 列の見出しの行（この下から明細の行） */
export const HEADER_ROW = 14;
/** 読むときに見る行の数（見出しの下から。顧客が行を足しても読めるように、載せる行の上限より広く見る） */
export const SCAN_ROWS = 1000;

/** 列 */
export const COLS = { no: "A", date: "B", merchant: "C", amount: "D", account: "E", owner: "F", guess: "G", category: "H", bucket: "I", share: "J", memo: "K" } as const;

/** 列の見出し */
export const HEADERS: Readonly<Record<keyof typeof COLS, string>> = {
  no: "番号",
  date: "ご利用日（まとめたお店は期間と回数）",
  merchant: "お店・内容",
  amount: "金額（円。まとめたお店は合計）",
  account: "カード・口座",
  owner: "お使いになった方",
  guess: "いまの見立て",
  category: "何に使ったか",
  bucket: "どこに入るか",
  share: "事業の割合（%）",
  memo: "メモ（任意）",
};

/** 列の幅 */
export const WIDTHS = [6, 22, 30, 14, 26, 16, 22, 26, 30, 11, 30] as const;

/** メモの欄の文字数の上限 */
export const MEMO_MAX = 200;

/** 区分の選択肢の言葉（お客さまに見せる言葉） */
export const SHEET_BUCKET_LABELS: Readonly<Record<Bucket, string>> = {
  household: "家計（ふだんの暮らし）",
  reimbursable: "立替（会社に請求する）",
  business: "事業の経費",
  company: "会社の経費",
  oneOff: "一時的な支出（旅行・冠婚葬祭など）",
  excluded: "除外（家計に数えない）",
};

/** 選択肢の項目の並び（基本生活費 → 住居・教育・保険・車・税 → 一時的 → 数えないもの） */
export const SHEET_CATEGORIES: readonly StatementCategory[] = CATEGORIES.map((c) => c.id);

/** 項目の言葉（括弧の説明つき） */
export const categoryLabel = (id: StatementCategory): string => CATEGORIES.find((c) => c.id === id)?.label ?? id;

/** 項目の短い言葉（括弧の説明を外す） */
export const categoryShort = (id: StatementCategory): string => categoryLabel(id).replace(/（.*）$/u, "");

const norm = looseKey;

const CATEGORY_WORDS: ReadonlyMap<string, StatementCategory> = new Map(
  SHEET_CATEGORIES.flatMap((id) => [
    [norm(categoryLabel(id)), id] as const,
    [norm(categoryShort(id)), id] as const,
    [norm(id), id] as const,
    // 前の言葉（言葉を変える前に書き出したシートの選択肢）
    ...(CATEGORIES.find((c) => c.id === id)?.aliases ?? []).map((a) => [norm(a), id] as const),
  ]),
);

const BUCKET_WORDS: ReadonlyMap<string, Bucket> = new Map(
  (Object.keys(SHEET_BUCKET_LABELS) as Bucket[]).flatMap((b) => [[norm(SHEET_BUCKET_LABELS[b]), b] as const, [norm(BUCKET_LABELS[b]), b] as const, [norm(SHEET_BUCKET_LABELS[b].replace(/（.*）$/u, "")), b] as const, [norm(b), b] as const]),
);

/** 書かれた言葉を項目にする（選択肢の言葉・短い言葉。読めなければ null） */
export const categoryOfText = (t: string): StatementCategory | null => CATEGORY_WORDS.get(norm(t)) ?? null;

/** 書かれた言葉を区分にする（選択肢の言葉・アプリの言葉。読めなければ null） */
export const bucketOfText = (t: string): Bucket | null => BUCKET_WORDS.get(norm(t)) ?? null;

/** 依頼番号（読み違えやすい字 0・O・1・I を除いた6文字。M- は明細の確認シートの印）。乱数はアプリ本体が渡す */
export function sheetRequestId(random: Uint8Array): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  if (random.length < 6) throw new Error("依頼番号には6バイト以上の乱数が要る");
  let s = "M-";
  for (let i = 0; i < 6; i++) s += chars[(random[i] as number) % chars.length];
  return s;
}

export const SHEET_REQUEST_ID = /^M-[2-9A-HJ-NP-Z]{6}$/u;

/** 日付の表示（2026/10/03） */
export const dateText = (d: string): string => d.replace(/-/gu, "/");

/** まとめた行のご利用日の欄（2025/10/10〜2026/09/10 と、次の行に 12回） */
export const rangeText = (from: string, to: string, count: number): string => `${from === to ? dateText(from) : `${dateText(from)}〜${dateText(to)}`}\n${count}回`;

/** まとめた行のご利用日の欄を読む（rangeText の形。空白・全角はそろえてから渡す。読めなければ null） */
export function parseRange(t: string): { from: string; to: string; count: number } | null {
  const m = /^(\S+?)(?:\s*[〜~～]\s*(\S+?))?\s*[(（]?(\d{1,5})回[)）]?$/u.exec(t.replace(/\s+/gu, " ").trim());
  if (m === null) return null;
  return { from: m[1] as string, to: m[2] ?? (m[1] as string), count: Number(m[3]) };
}

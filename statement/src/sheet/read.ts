// 返ってきた確認シート（表計算のファイル .xlsx）を読む（0034 の9）。返ってきたファイルは信用しない（土台は xlsx/ の Book。0018 の6 と同じ）。
// - 管理の値を3か所（隠したシート・文書のプロパティ・見える管理欄）から読み、食い違えば止める
// - 依頼番号で、開いている世帯の依頼の記録を探す。無ければ止める（別の世帯のファイル・記録の無い書き出しを取り違えて読まない）。
//   古い依頼・もう取り込んだ依頼は知らせる。同じファイルは2回取り込まない
// - 行は番号の欄で依頼の記録と結び、使った日・金額が記録の行と合わない行は読まない（番号の書き換え・別の書き出しの行の混ざりを防ぐ）。
//   店ごとにまとめた行（依頼の記録で同じ番号に複数の行がある）は、期間（最初と最後の日）・回数・合計が記録の行と合うときだけ読み、
//   答えをその番号の行すべてに当てる。行の一部が無くなっていれば照らし合わせられないので読まない
// - 読むのは、番号の行の「何に使ったか」「どこに入るか」「事業の割合」「メモ」だけ。印が無い・読めない行は迷う行のまま残す
// - 読んだ印は「決めたことの候補」にするだけ。FP が画面で確かめて承認したものだけを applyDecisions に渡す（候補の流れと同じ）
import { shownNumber } from "../../../xlsx/src/cells.ts";
import { Book, problemOf, type FileProblem, type Sheet } from "../../../xlsx/src/read.ts";
import { META_SHEET, PROPERTY_PREFIX } from "../../../xlsx/src/write.ts";
import { DEFAULT_LIMITS, type ZipLimits } from "../../../xlsx/src/zip.ts";
import type { ClassifiedRow } from "../classify/classify.ts";
import { parseShare, type Bucket } from "../classify/work.ts";
import type { StatementCategory } from "../classify/categories.ts";
import { issue, type Issue } from "../issues.ts";
import type { FileMark, StatementLog, StatementRequest } from "../log.ts";
import { fileDigest } from "../readers.ts";
import type { RowDecision } from "../review.ts";
import { maskText } from "../text/mask.ts";
import { nfkc } from "../text/normalize.ts";
import {
  bucketOfText,
  categoryOfText,
  COLS,
  dateText,
  HEADER_ROW,
  HEARING_SHEET_FORMAT,
  MANAGE_KEYS,
  MANAGE_LABEL_COL,
  MANAGE_LABELS,
  MANAGE_ROWS,
  MANAGE_VALUE_COL,
  MEMO_MAX,
  parseRange,
  SCAN_ROWS,
  SHEET_BUCKET_LABELS,
  SHEET_FORMAT,
  SHEET_FORMAT_VERSION,
  type ManageKey,
} from "./layout.ts";

export interface ReadMarkSheetOptions {
  /** 開いている世帯の明細の取り込みの記録（依頼の記録 requests を正にして読む） */
  readonly log: StatementLog;
  /** 今の仕分け（classify の結果。行の持ち主・選べる区分・FP が決めた日時を見る） */
  readonly rows: readonly ClassifiedRow[];
  readonly limits?: ZipLimits;
}

/** お客さまの印（項目・区分・割合。選ばなかった欄は無い） */
export interface Mark {
  readonly category?: StatementCategory;
  readonly bucket?: Bucket;
  readonly share?: string;
}

/** 読んだ印からできた「決めたことの候補」（シートの1行ぶん。まとめた店の行は、その店の行すべて） */
export interface MarkCandidate {
  /** シートの番号 */
  readonly no: number;
  /** row: 明細の1行。shop: 店ごとにまとめた行 */
  readonly kind: "row" | "shop";
  /** 使った日（まとめた行は最初と最後） */
  readonly date: string;
  readonly to: string;
  /** 明細の行の数 */
  readonly count: number;
  readonly merchant: string;
  /** 金額（まとめた行は合計） */
  readonly amount: number;
  readonly owner: string | null;
  readonly mark: Mark;
  /** 承認したら applyDecisions に渡す決めたこと（明細の行ごと。まとめた行は同じ印を行の数だけ） */
  readonly decisions: readonly RowDecision[];
  /** お客さまのメモ（番号らしき数字は消した後。保存しない） */
  readonly memo?: string;
  /** pending は最初にチェックしておく。needsReview は FP が確かめてからチェックする */
  readonly status: "pending" | "needsReview";
  /** 要確認の理由 */
  readonly notes: readonly string[];
}

/** 印は無いがメモだけが書かれた行 */
export interface MarkMemo {
  readonly no: number;
  readonly kind: "row" | "shop";
  readonly date: string;
  readonly to: string;
  readonly count: number;
  readonly merchant: string;
  readonly amount: number;
  readonly memo: string;
}

export type ReadMarkSheetResult =
  | {
      readonly ok: true;
      readonly request: StatementRequest;
      /** 返ってきたファイルの指紋と大きさ（取り込んだ記録に残す。ファイルそのものは持たない） */
      readonly file: FileMark;
      readonly candidates: readonly MarkCandidate[];
      readonly memos: readonly MarkMemo[];
      /** 印が無かった明細の行の数（迷う行のまま残る。まとめた行は明細の行の数で数える） */
      readonly unmarked: number;
      readonly issues: readonly Issue[];
    }
  | { readonly ok: false; readonly issues: readonly Issue[] };

const fail = (issues: Issue[], i: Issue): ReadMarkSheetResult => ({ ok: false, issues: [...issues, i] });
const fileIssue = (p: FileProblem): Issue => issue("error", "S_SHEET_FILE", p.message);

/** 返ってきた確認シートを読み、決めたことの候補にする */
export async function readMarkSheet(bytes: Uint8Array, o: ReadMarkSheetOptions): Promise<ReadMarkSheetResult> {
  const opened = await Book.open(bytes, o.limits ?? DEFAULT_LIMITS);
  const issues: Issue[] = opened.notes.map((n) => issue("info", "S_SHEET_IGNORED", n.message));
  if (!opened.ok) return fail(issues, fileIssue(opened.problem));
  try {
    return await readBook(opened.book, bytes, o, issues);
  } catch (e) {
    return fail(issues, fileIssue(problemOf(e)));
  }
}

async function readBook(book: Book, bytes: Uint8Array, o: ReadMarkSheetOptions, issues: Issue[]): Promise<ReadMarkSheetResult> {
  // ---- 管理の値（3か所） ----
  const sources: { where: string; values: Partial<Record<ManageKey, string>> }[] = [];
  const meta = await book.keyValues(META_SHEET, MANAGE_KEYS);
  if (meta !== null) sources.push({ where: "隠したシート", values: meta });
  const props = await book.properties(PROPERTY_PREFIX, MANAGE_KEYS);
  if (Object.keys(props).length > 0) sources.push({ where: "文書のプロパティ", values: props });
  const firstName = book.firstVisible();
  const sheet = firstName === undefined ? null : await book.sheet(firstName);
  if (sheet !== null && book.text(sheet, `${MANAGE_LABEL_COL}${MANAGE_ROWS.requestId}`) === MANAGE_LABELS.requestId) {
    const v = (k: keyof typeof MANAGE_ROWS) => (book.text(sheet, `${MANAGE_VALUE_COL}${MANAGE_ROWS[k]}`) ?? "").trim();
    sources.push({ where: "1枚目の管理欄", values: { requestId: v("requestId"), customerNo: v("customerNo") } });
  }
  const formats = sources.map((s) => s.values.format).filter((x): x is string => x !== undefined);
  if (formats.includes(HEARING_SHEET_FORMAT)) return fail(issues, issue("error", "S_SHEET_HEARING", "ヒアリングシートです。入力のホームの「記入済みのシートを取り込む」から読んでください"));
  if (sources.length === 0 || !(formats.includes(SHEET_FORMAT) || sources.some((s) => s.where === "1枚目の管理欄"))) {
    return fail(issues, issue("error", "S_SHEET_NOT_OURS", "このソフトで書き出した明細の確認シートではありません（管理の値が見つかりません）"));
  }
  if (sources.length < 3) {
    const lost = ["隠したシート", "文書のプロパティ", "1枚目の管理欄"].filter((w) => !sources.some((x) => x.where === w));
    issues.push(issue("info", "S_SHEET_PARTLY_LOST", `管理の値の一部（${lost.join("・")}）が見つかりませんでした。別のソフトで保存し直したためかもしれません。残った管理の値で読みます`));
  }
  const merged: Partial<Record<ManageKey, string>> = {};
  for (const k of MANAGE_KEYS) {
    const vals = sources.filter((x) => x.values[k] !== undefined).map((x) => ({ where: x.where, v: x.values[k] as string }));
    const firstVal = vals[0];
    if (firstVal === undefined) continue;
    const diff = vals.find((x) => x.v !== firstVal.v);
    if (diff !== undefined) {
      return fail(issues, issue("error", "S_SHEET_MANAGE_MISMATCH", `管理の値（${k}）が食い違っています（${firstVal.where}: ${firstVal.v}／${diff.where}: ${diff.v}）。シートが書き換えられた可能性があるため、取り込みを止めました`));
    }
    merged[k] = firstVal.v;
  }
  const major = Number((merged.formatVersion ?? SHEET_FORMAT_VERSION).split(".")[0]);
  if (!(major <= Number(SHEET_FORMAT_VERSION.split(".")[0]))) return fail(issues, issue("error", "S_SHEET_NEWER", "新しい版のアプリで書き出したシートです。アプリを更新してから取り込んでください"));

  // ---- 依頼の記録（開いている世帯の記録を正にする） ----
  const requestId = merged.requestId ?? "";
  const requests = o.log.requests ?? [];
  const request = requests.find((r) => r.id === requestId);
  if (request === undefined) {
    return fail(
      issues,
      issue("error", "S_SHEET_OTHER_HOUSEHOLD", `この世帯で書き出した確認シートではありません（依頼番号 ${requestId === "" ? "なし" : requestId}）。別の世帯のファイルか、書き出しの記録が残っていない依頼です。開いている世帯を確かめてください`),
    );
  }
  const file: FileMark = { sha256: await fileDigest(bytes), bytes: bytes.length };
  if (request.received.some((x) => x.file.sha256 === file.sha256)) return fail(issues, issue("error", "S_SHEET_ALREADY", "このファイルはもう取り込んでいます（同じファイルは2回取り込みません）"));
  const latest = [...requests].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).at(-1);
  if (latest !== undefined && latest.id !== request.id) {
    issues.push(issue("warning", "S_SHEET_OLD_REQUEST", `新しい依頼（${dateText(latest.at.slice(0, 10))} に書き出した ${latest.id}）があります。このファイルは前の依頼（${dateText(request.at.slice(0, 10))} の ${request.id}）のものです`));
  }
  const prev = request.received.at(-1);
  if (prev !== undefined) issues.push(issue("warning", "S_SHEET_RECEIVED_BEFORE", `この依頼は ${dateText(prev.at.slice(0, 10))} にも取り込んでいます（そのとき ${prev.decided}行）。もう一度読んだ印で置き換わります`));
  if (file.sha256 === request.file.sha256) issues.push(issue("info", "S_SHEET_UNCHANGED", "書き出したままのファイルです（お客さまの印は付いていません）"));
  if (sheet === null) return fail(issues, issue("error", "S_SHEET_NOT_OURS", "明細のご確認のシートが見つかりません"));

  // ---- 行 ----
  const byNo = new Map<number, StatementRequest["rows"][number][]>();
  for (const x of request.rows) byNo.set(x.no, [...(byNo.get(x.no) ?? []), x]);
  const rowsByKey = new Map(o.rows.map((r) => [`${r.importId}\u001f${r.row.id}`, r]));
  const seen = new Set<number>();
  const candidates: MarkCandidate[] = [];
  const memos: MarkMemo[] = [];
  let unmarked = 0;
  for (let r = HEADER_ROW + 1; r <= HEADER_ROW + SCAN_ROWS; r++) {
    const noCell = book.cell(sheet, `${COLS.no}${r}`).raw;
    if (noCell === null) continue;
    const no = noCell.kind === "number" ? Number(noCell.text) : noCell.kind === "text" ? Number(nfkc(noCell.text)) : Number.NaN;
    if (!Number.isInteger(no)) continue;
    const refs = byNo.get(no);
    if (refs === undefined) {
      issues.push(issue("warning", "S_SHEET_ROW_UNKNOWN", `${no}番の行は、この依頼の記録にありません（読みませんでした）`));
      continue;
    }
    if (seen.has(no)) {
      issues.push(issue("warning", "S_SHEET_ROW_DUPLICATE", `${no}番の行が2つあります。最初の行だけを読みました`));
      continue;
    }
    seen.add(no);
    const found = refs.map((x) => rowsByKey.get(`${x.import}\u001f${x.row}`));
    const rows = found.filter((x): x is ClassifiedRow => x !== undefined).sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : 0));
    const shop = refs.length > 1;
    if (rows.length < refs.length) {
      issues.push(
        issue(
          "info",
          "S_SHEET_ROW_GONE",
          shop
            ? `${no}番（同じ店をまとめた行）のうち ${refs.length - rows.length}行は、明細の取り込みを外したか仕分けに使っていないため、照らし合わせられません（読みませんでした。迷う行のまま残ります）`
            : `${no}番の行は、明細の取り込みを外したか仕分けに使っていないため読みませんでした`,
        ),
      );
      continue;
    }
    const head = rows[0] as ClassifiedRow;
    const from = head.row.date;
    const to = (rows[rows.length - 1] as ClassifiedRow).row.date;
    const total = rows.reduce((n, x) => n + x.row.amount, 0);
    const dateRaw = book.cell(sheet, `${COLS.date}${r}`).raw;
    const amountRaw = book.cell(sheet, `${COLS.amount}${r}`).raw;
    if (!shop && (!sameDate(dateRaw, from) || !sameAmount(amountRaw, total))) {
      issues.push(issue("warning", "S_SHEET_ROW_CHANGED", `${no}番の行の使った日・金額が、書き出した明細（${dateText(from)}・${total.toLocaleString("ja-JP")}円）と合いません（読みませんでした）`));
      continue;
    }
    if (shop && (!sameRange(dateRaw, from, to, rows.length) || !sameAmount(amountRaw, total))) {
      issues.push(issue("warning", "S_SHEET_ROW_CHANGED", `${no}番（同じ店をまとめた行）の期間・回数・合計が、書き出した明細（${dateText(from)}〜${dateText(to)}・${rows.length}回・合計 ${total.toLocaleString("ja-JP")}円）と合いません（読みませんでした）`));
      continue;
    }
    const mark = readMarks(book, sheet, r, no, rows, request, issues);
    if (mark === "unreadable") continue;
    const base = { no, kind: shop ? ("shop" as const) : ("row" as const), date: from, to, count: rows.length, merchant: head.row.merchant, amount: total };
    if (mark.mark === null) {
      unmarked += rows.length;
      if (mark.memo !== undefined) memos.push({ ...base, memo: mark.memo });
      continue;
    }
    const m = mark.mark;
    candidates.push({
      ...base,
      owner: head.owner,
      mark: m,
      decisions: rows.map((x) => ({ importId: x.importId, rowId: x.row.id, ...m })),
      ...(mark.memo !== undefined ? { memo: mark.memo } : {}),
      status: mark.notes.length > 0 ? "needsReview" : "pending",
      notes: mark.notes,
    });
  }
  const missing = request.rows.filter((x) => !seen.has(x.no)).length;
  if (missing > 0) issues.push(issue("info", "S_SHEET_ROW_GONE", `書き出した明細の行のうち ${missing}行がシートに見つかりませんでした（迷う行のまま残ります）`));
  if (candidates.length === 0) issues.push(issue("info", "S_SHEET_NO_MARKS", "印の付いた行はありませんでした"));
  return { ok: true, request, file, candidates, memos, unmarked, issues };
}

/** まとめた行のご利用日の欄が、記録の行の期間と回数と同じか（rangeText の形） */
function sameRange(raw: ReturnType<Book["cell"]>["raw"], from: string, to: string, count: number): boolean {
  if (raw === null || raw.kind !== "text") return false;
  const p = parseRange(nfkc(raw.text));
  return p !== null && p.count === count && sameDateText(p.from, from) && sameDateText(p.to, to);
}

/** シートの日付の欄が、記録の行の日付と同じか（文字 2026/10/03・2026-10-03、日付の通し番号のどれでもよい） */
function sameDate(raw: ReturnType<Book["cell"]>["raw"], date: string): boolean {
  if (raw === null || raw.kind === "bool") return false;
  if (raw.kind === "number") {
    const n = Number(raw.text);
    if (!Number.isInteger(n)) return false;
    // 表計算のソフトの日付の通し番号（1899-12-30 から数えた日）
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
    return d === date;
  }
  return sameDateText(raw.text, date);
}

/** 日付の文字（2026/10/03・2026-10-03・2026年10月3日）が、記録の行の日付と同じか */
function sameDateText(text: string, date: string): boolean {
  const t = nfkc(text).replace(/[/.年月]/gu, "-").replace(/日$/u, "");
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(t);
  return m !== null && `${m[1]}-${(m[2] as string).padStart(2, "0")}-${(m[3] as string).padStart(2, "0")}` === date;
}

/** シートの金額の欄が、記録の行の金額と同じか（数・カンマつきの文字） */
function sameAmount(raw: ReturnType<Book["cell"]>["raw"], amount: number): boolean {
  if (raw === null || raw.kind === "bool") return false;
  const t = raw.kind === "number" ? raw.text : nfkc(raw.text).replace(/[,円¥\s]/gu, "");
  return /^-?\d+(?:\.0+)?$/u.test(t) && Number(t) === amount;
}

type Marks = { mark: Mark | null; memo?: string; notes: string[] } | "unreadable";

/** シートの1行の印を読む（読めない欄が1つでもあれば、その行は読まない）。rows はその番号の明細の行（まとめた行は複数） */
function readMarks(book: Book, sheet: Sheet, r: number, no: number, rows: readonly ClassifiedRow[], request: StatementRequest, issues: Issue[]): Marks {
  const notes: string[] = [];
  // 選べる区分は、行すべてで選べるもの（書き出した後に FP が持ち主を直した行があっても、選べない区分を入れない）
  const allowed = (rows[0] as ClassifiedRow).allowed.filter((b) => rows.every((x) => x.allowed.includes(b)));
  const cell = (col: string) => {
    const c = book.cell(sheet, `${col}${r}`);
    if (c.noValue) return { text: null as string | null, formula: true, empty: false };
    // 数のセルは見えている数として読む: パーセントの書式のセル（Excel で「60%」と打つと値は 0.6）は 100 倍し、
    // 2進の浮動小数点の桁（0.59999999999999998 など）は見えている有効数字 15 桁に丸める
    const shown = c.raw?.kind === "number" ? shownNumber(c.raw.text, c.percent ? 2 : 0) : null;
    const t = c.raw === null ? null : c.raw.kind === "bool" ? String(c.raw.value) : nfkc(shown ?? c.raw.text);
    return { text: t === "" ? null : t, formula: c.formula, empty: t === null || t === "" };
  };
  const cat = cell(COLS.category);
  const buc = cell(COLS.bucket);
  const sha = cell(COLS.share);
  const memoCell = cell(COLS.memo);
  if ([cat, buc, sha].some((x) => x.formula)) {
    notes.push("数式の欄があります（保存されている計算結果を読みました）");
    issues.push(issue("warning", "S_SHEET_FORMULA", `${no}番の行に数式の欄があります。保存されている計算結果を要確認として読みました`));
  }
  let category: StatementCategory | undefined;
  if (cat.text !== null) {
    const c = categoryOfText(cat.text);
    if (c === null) {
      issues.push(issue("warning", "S_SHEET_VALUE", `${no}番の行の「何に使ったか」の「${clip(cat.text)}」は選択肢にありません（この行は読みませんでした）`));
      return "unreadable";
    }
    category = c;
  }
  let bucket: Bucket | undefined;
  if (buc.text !== null) {
    const b = bucketOfText(buc.text);
    if (b === null) {
      issues.push(issue("warning", "S_SHEET_VALUE", `${no}番の行の「どこに入るか」の「${clip(buc.text)}」は選択肢にありません（この行は読みませんでした）`));
      return "unreadable";
    }
    if (!allowed.includes(b)) {
      if (category === undefined) {
        issues.push(issue("warning", "S_SHEET_VALUE", `${no}番の行の「${SHEET_BUCKET_LABELS[b]}」は、お使いになった方の働き方では選べません（この行は読みませんでした）`));
        return "unreadable";
      }
      notes.push(`「${SHEET_BUCKET_LABELS[b]}」は、お使いになった方の働き方では選べないため入れません`);
    } else bucket = b;
  }
  let share: string | undefined;
  if (bucket === "business") {
    const p = sha.text === null ? null : percentShare(sha.text);
    if (p === null) {
      share = "1";
      notes.push(sha.text === null ? "事業の割合が書かれていないので 100% にしています" : `事業の割合「${clip(sha.text)}」が読めないので 100% にしています`);
    } else share = p;
  }
  const memo = memoCell.text === null ? undefined : maskText(memoCell.text).text.slice(0, MEMO_MAX);
  if (category === undefined && bucket === undefined) return { mark: null, ...(memo !== undefined ? { memo } : {}), notes };
  const later = rows.filter((x) => x.row.decidedAt !== undefined && x.row.decidedAt > request.at).length;
  if (later > 0) notes.push(rows.length > 1 ? `書き出した後に FP が決めた行が ${later}行あります（今の決めたことを置き換えます）` : "書き出した後に FP が決めた行です（今の決めたことを置き換えます）");
  if (rows.length > 1 && memo !== undefined) notes.push("まとめた店の行にメモがあります（回によって違うことがないか、メモを確かめてください）");
  const mark: Mark = { ...(category !== undefined ? { category } : {}), ...(bucket !== undefined ? { bucket } : {}), ...(share !== undefined ? { share } : {}) };
  return { mark, ...(memo !== undefined ? { memo } : {}), notes };
}

const clip = (s: string) => (s.length > 20 ? `${s.slice(0, 20)}…` : s);

/**
 * 割合の欄（1〜100 の%。「60%」も読む）を割合の文字列（"0.6"）に。読めなければ null。
 * 1 より小さい数（0.6 など）は、% で打った値が書式を失って割合の数で残った疑いがあるので読まない（1〜100 の決まりの外）
 */
export function percentShare(t: string): string | null {
  const s = nfkc(t).replace(/[%％\s]/gu, "");
  if (!/^\d{1,3}(?:\.\d{1,2})?$/u.test(s)) return null;
  const p = Number(s);
  if (!(p >= 1 && p <= 100)) return null;
  const str = p === 100 ? "1" : (Math.round(p * 100) / 10000).toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
  return parseShare(str) === null ? null : str;
}

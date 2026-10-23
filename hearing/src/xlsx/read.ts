// 返ってきたヒアリングシート（.xlsx）を読む（0018 の2・4・5・6）。AI を使わず、決まった手順で読む。
// - 受け付けるのは .xlsx だけ。マクロ・外部リンク・埋め込みのオブジェクトは読まず、実行もしない。数式は評価しない
// - 読むのは管理の値と、シート定義が指すセルだけ（ほかのセル・ほかのシートは読まない）
// - 管理の値は3か所から読み、食い違えば止める。どのシート定義で読むかは、アプリの側の依頼の記録を正にする
// - 回答のセルは名前の定義で探し、シート定義の固定の位置と照らし合わせる。食い違いは「要確認」にして黙って使わない
import { HEARING_FORMAT, HEARING_FORMAT_VERSION, type Answer, type AnswerStatus, type FilledSheet, type Management, type RawValue } from "../answers.ts";
import { STATE_LABELS, answerCells, cellName, colIndex, colLetter, itemByKey, type SheetDefinition } from "../definition.ts";
import { issue, type Issue, type IssueCode } from "../issues.ts";
import { MANAGE_LABEL_COL, MANAGE_ROWS, MANAGE_VALUE_COL, layoutDigest } from "../layout.ts";
import { MANAGE_KEYS, META_SHEET, PROPERTY_PREFIX } from "./write.ts";
import { parseRef } from "../../../xlsx/src/cells.ts";
import { Book, problemOf, type FileNoteCode, type FileProblem, type FileProblemCode } from "../../../xlsx/src/read.ts";
import { DEFAULT_LIMITS, type ZipLimits } from "../../../xlsx/src/zip.ts";

/** アプリの側に残す依頼の記録（0018 の2・5。世帯ファイルの取り込みの記録に暗号化して置く） */
export interface HearingRequest {
  readonly requestId: string;
  readonly sheetId: string;
  readonly sheetVersion: number;
  readonly layoutDigest: string;
  readonly customerNo: string;
  readonly exportedOn: string;
  /** 前回の値を記入して書き出したか（0018 の9） */
  readonly prefilled: boolean;
}

export interface ReadOptions {
  /** アプリに同梱した、公開したすべての版のシート定義 */
  readonly definitions: readonly SheetDefinition[];
  /** アプリの側に残した依頼の記録（見つかれば、これを正にして読む） */
  readonly requests?: readonly HearingRequest[];
  readonly limits?: ZipLimits;
}

export type ReadResult =
  | { readonly ok: true; readonly definition: SheetDefinition; readonly filled: FilledSheet; readonly request: HearingRequest | null; readonly issues: readonly Issue[] }
  | { readonly ok: false; readonly issues: readonly Issue[] };

const fail = (issues: Issue[], i: Issue): ReadResult => ({ ok: false, issues: [...issues, i] });

/** 表計算のファイルの土台（xlsx/）の読めなかった理由・知らせを、ヒアリングシートの知らせの符号にする */
const PROBLEM_CODES: Record<FileProblemCode, IssueCode> = { xls: "H_FILE_XLS", notXlsx: "H_FILE_NOT_XLSX", ods: "H_FILE_ODS", numbers: "H_FILE_NUMBERS", tooLarge: "H_FILE_TOO_LARGE", encrypted: "H_FILE_ENCRYPTED", broken: "H_FILE_BROKEN" };
const NOTE_CODES: Record<FileNoteCode, IssueCode> = { macro: "H_FILE_MACRO_IGNORED", external: "H_FILE_EXTERNAL_IGNORED", embedded: "H_FILE_EMBEDDED_IGNORED" };
const problemIssue = (p: FileProblem): Issue => issue("error", PROBLEM_CODES[p.code], p.message);

/** 返ってきた .xlsx を読み、回答の一覧にする */
export async function readSheetXlsx(bytes: Uint8Array, options: ReadOptions): Promise<ReadResult> {
  const opened = await Book.open(bytes, options.limits ?? DEFAULT_LIMITS);
  const issues: Issue[] = opened.notes.map((n) => issue("info", NOTE_CODES[n.code], n.message));
  if (!opened.ok) return fail(issues, problemIssue(opened.problem));
  try {
    return await readBook(opened.book, options, issues);
  } catch (e) {
    return fail(issues, problemIssue(problemOf(e)));
  }
}

async function readBook(book: Book, options: ReadOptions, issues: Issue[]): Promise<ReadResult> {
  const sheetByName = (name: string) => book.sheet(name);
  const textAt = (sheet: Awaited<ReturnType<typeof sheetByName>>, ref: string): string | null => book.text(sheet, ref);

  // 管理の値（3か所）
  const sources: { where: string; values: Partial<Record<(typeof MANAGE_KEYS)[number], string>> }[] = [];
  const meta = await book.keyValues(META_SHEET, MANAGE_KEYS);
  if (meta !== null) sources.push({ where: "隠したシート", values: meta });
  const props = await book.properties(PROPERTY_PREFIX, MANAGE_KEYS);
  if (Object.keys(props).length > 0) sources.push({ where: "文書のプロパティ", values: props });
  const firstVisible = book.firstVisible();
  if (firstVisible !== undefined) {
    const sh = await sheetByName(firstVisible);
    const sv = textAt(sh, `${MANAGE_VALUE_COL}${MANAGE_ROWS.sheet}`);
    const label = textAt(sh, `${MANAGE_LABEL_COL}${MANAGE_ROWS.sheet}`);
    if (sv !== null && label === "シートの種類と版") {
      const m = /^([a-zA-Z0-9]+)-(\d+)$/.exec(sv.trim());
      const values: Record<string, string> = {};
      if (m !== null) {
        values.sheetId = m[1] as string;
        values.sheetVersion = m[2] as string;
      }
      values.requestId = (textAt(sh, `${MANAGE_VALUE_COL}${MANAGE_ROWS.requestId}`) ?? "").trim();
      values.customerNo = (textAt(sh, `${MANAGE_VALUE_COL}${MANAGE_ROWS.customerNo}`) ?? "").trim();
      sources.push({ where: "1枚目の管理欄", values });
    }
  }
  if (sources.length === 0 || !sources.some((x) => x.values.format === HEARING_FORMAT || x.where === "1枚目の管理欄")) {
    return fail(issues, issue("error", "H_NOT_HEARING_SHEET", "このソフトのヒアリングシートではありません（管理の値が見つかりません）"));
  }
  if (sources.length < 3) {
    const lost = ["隠したシート", "文書のプロパティ", "1枚目の管理欄"].filter((w) => !sources.some((x) => x.where === w));
    issues.push(issue("info", "H_MANAGE_PARTLY_LOST", `管理の値の一部（${lost.join("・")}）が見つかりませんでした。別のソフトで保存し直したためかもしれません。残った管理の値で読みます`));
  }
  const merged: Record<string, string> = {};
  for (const k of MANAGE_KEYS) {
    const vals = sources.filter((x) => x.values[k] !== undefined).map((x) => ({ where: x.where, v: x.values[k] as string }));
    if (vals.length === 0) continue;
    const first = vals[0] as { where: string; v: string };
    const diff = vals.find((x) => x.v !== first.v);
    if (diff !== undefined) {
      return fail(issues, issue("error", "H_MANAGE_MISMATCH", `管理の値（${k}）が食い違っています（${first.where}: ${first.v}／${diff.where}: ${diff.v}）。シートが書き換えられた可能性があるため、取り込みを止めました`));
    }
    merged[k] = first.v;
  }
  const major = Number((merged.formatVersion ?? HEARING_FORMAT_VERSION).split(".")[0]);
  if (major > Number(HEARING_FORMAT_VERSION.split(".")[0])) return fail(issues, issue("error", "H_FORMAT_NEWER", "新しい版のアプリで書き出したシートです。アプリを更新してから取り込んでください"));
  const requestId = merged.requestId ?? "";
  const record = options.requests?.find((r) => r.requestId === requestId) ?? null;
  // どのシート定義で読むか: 依頼の記録があれば記録を正にする（シートの中の値は依頼を見つけるためだけに使う）
  const sheetId = record?.sheetId ?? merged.sheetId;
  const sheetVersion = record?.sheetVersion ?? Number(merged.sheetVersion);
  const def = options.definitions.find((d) => d.sheetId === sheetId && d.version === sheetVersion);
  if (def === undefined) return fail(issues, issue("error", "H_SHEET_UNKNOWN", `このアプリが知らないシートです（${sheetId ?? "?"}-${Number.isNaN(sheetVersion) ? "?" : sheetVersion}）。アプリを更新してから取り込んでください`));
  const digest = await layoutDigest(def);
  if (record !== null) {
    if (record.layoutDigest !== digest) return fail(issues, issue("error", "H_LAYOUT_MISMATCH", "依頼の記録の配置が、このアプリのシート定義と合いません（FP が項目を選んで作ったシートの読み込みは、まだできません）"));
    if (merged.sheetId !== undefined && (merged.sheetId !== record.sheetId || Number(merged.sheetVersion) !== record.sheetVersion)) {
      return fail(issues, issue("error", "H_MANAGE_MISMATCH", "シートの種類と版が、依頼の記録と食い違っています。取り込みを止めました"));
    }
  } else {
    issues.push(issue("warning", "H_REQUEST_UNKNOWN", `依頼の記録（${requestId || "依頼番号なし"}）が見つかりません。公式のシートなので、同梱のシート定義で読みます`));
    if (merged.layoutDigest !== undefined && merged.layoutDigest !== digest) {
      return fail(issues, issue("error", "H_LAYOUT_MISMATCH", "シートの配置が公式のシートと違います（FP が項目を選んで作ったシートは、依頼の記録が無いと読めません）"));
    }
  }
  const management: Management = {
    format: HEARING_FORMAT,
    formatVersion: merged.formatVersion ?? HEARING_FORMAT_VERSION,
    sheetId: def.sheetId,
    sheetVersion: def.version,
    requestId,
    customerNo: record?.customerNo ?? merged.customerNo ?? "",
    layoutDigest: digest,
    appVersion: merged.appVersion ?? "",
    exportedOn: record?.exportedOn ?? merged.exportedOn ?? "",
  };

  // 回答のセル
  const items = itemByKey(def);
  const col = def.layout.columns;
  const valueCol = colIndex(col.value);
  const answers: Answer[] = [];
  let missingNames = 0;
  for (const cell of answerCells(def)) {
    const item = items.get(cell.key);
    if (item === undefined) continue;
    const at = { key: cell.key, ...(cell.index !== undefined ? { index: cell.index } : {}) };
    const fixed = { sheet: cell.sheet, col: valueCol, row: cell.row };
    const review: string[] = [];
    let pos = fixed;
    const named = parseRef(book.definedNames.get(cellName(cell.key, cell.index).toLowerCase()));
    const sheet0 = await sheetByName(cell.sheet);
    if (named !== null) {
      if (named.sheet !== fixed.sheet || named.col !== fixed.col || named.row !== fixed.row) {
        pos = named;
        review.push("名前の定義の位置が、シート定義の位置と違います（行の挿入などで動いた可能性）");
        issues.push(issue("warning", "H_NAME_MOVED", `${item.label}: 回答のセルの位置が動いています（${fixed.sheet}!${col.value}${fixed.row} → ${named.sheet}!${colLetter(named.col)}${named.row}）。要確認にしました`, at));
      }
    } else {
      missingNames++;
      const label = textAt(sheet0, `${col.label}${fixed.row}`);
      if (label !== item.label) {
        review.push("名前の定義が無く、決まった位置の質問の文も違います");
        issues.push(issue("warning", "H_LABEL_MISMATCH", `${item.label}: 名前の定義が無く、決まった位置の質問の文も違うため、要確認にしました`, at));
      }
    }
    const sh = pos === fixed ? sheet0 : await sheetByName(pos.sheet);
    if (sh === null) {
      answers.push({ ...at, status: "blank" });
      continue;
    }
    const offset = (c: string) => colIndex(c) - valueCol;
    const read = (dc: number): { raw: RawValue | null; formula: boolean; noValue: boolean } => {
      return book.cell(sh, `${colLetter(pos.col + dc)}${pos.row}`);
    };
    const v1 = read(0);
    const v2 = item.type === "yearMonth" ? read(offset(col.value2)) : { raw: null, formula: false, noValue: false };
    const st = item.states.length > 0 ? read(offset(col.status)) : { raw: null, formula: false, noValue: false };
    for (const x of [v1, v2, st]) {
      if (x.noValue) issues.push(issue("warning", "H_FORMULA_NO_VALUE", `${item.label}: 数式のセルに計算結果が保存されていないため、読みませんでした`, at));
      else if (x.formula) review.push("数式のセルです（保存されている計算結果を読みました）");
    }
    if (review.some((r) => r.startsWith("数式"))) issues.push(issue("warning", "H_FORMULA", `${item.label}: 数式のセルがあります。保存されている計算結果を要確認として読みました`, at));
    let state: AnswerStatus | null = null;
    if (st.raw !== null) {
      const t = st.raw.kind === "bool" ? "" : st.raw.text.trim();
      if (t === STATE_LABELS.unknown) state = "unknown";
      else if (t === STATE_LABELS.notApplicable) state = "notApplicable";
      else if (t !== "") issues.push(issue("warning", "H_INVALID_VALUE", `${item.label}: 状態の欄の「${t}」は選択肢にありません（読みませんでした）`, at));
    }
    const hasValue = v1.raw !== null || v2.raw !== null;
    if (hasValue) {
      if (state !== null) {
        review.push("値と状態（わからない・該当なし）の両方が記入されています");
        issues.push(issue("warning", "H_VALUE_AND_STATE", `${item.label}: 値と状態の両方が記入されています。値を要確認として読みました`, at));
      }
      answers.push({
        ...at,
        status: "value",
        raw: v1.raw ?? { kind: "text", text: "" },
        ...(v2.raw !== null ? { raw2: v2.raw } : {}),
        ...(review.length > 0 ? { review } : {}),
      });
    } else answers.push({ ...at, status: state ?? "blank" });
  }
  if (missingNames > 0) issues.push(issue("info", "H_NAME_MISSING", `回答のセルの名前の定義が ${missingNames} か所で見つからないため、決まった位置で読みました（質問の文が合うかを確かめています）`));
  return { ok: true, definition: def, filled: { management, answers }, request: record, issues };
}

// 前もってお客さまに印を付けてもらう確認シート（表計算のファイル .xlsx）を書き出す（0034 の9）。土台はヒアリングシートと同じ
// 表計算のファイルの部品（xlsx/。zip・書式・入力規則・管理の値を3か所に書く）。
// - 載せるのは迷う行だけ: 使った日・店の名前（番号を消した後）・金額・カード／口座の呼び名・お使いになった方・いまの見立てと、
//   お客さまが選ぶ欄（何に使ったか・どこに入るか〔持ち主の働き方で選べる区分だけ〕・事業の割合・メモ）
// - 世帯の内部ID・取り込みの ID・行の ID は書かない。依頼ごとの番号（1〜）だけを書き、番号 → 行の対応は依頼の記録
//   （暗号化した世帯ファイルの区画 statements の requests）に残す
// - 店の名前はもう一度、番号らしき数字を消してから書く（読み手が消し忘れても、ファイルに番号を出さない）
// - 暗号化されないファイルに店の名前と金額が載るので、書き出す前に FP に警告する（S_SHEET_PLAINTEXT）
import { listValidation, Lists, LIST_SHEET, lines, META_SHEET, metaSheetXml, numberValidation, SheetBuilder, STYLE, STYLE_COUNT, buildStyles, validation, writeBook } from "../../../xlsx/src/write.ts";
import { num, text } from "../../../xlsx/src/cells.ts";
import { issue, type Issue } from "../issues.ts";
import { MAX_REQUEST_ROWS, type StatementRequest } from "../log.ts";
import { fileDigest } from "../readers.ts";
import type { ReviewItem } from "../review.ts";
import { maskText } from "../text/mask.ts";
import {
  categoryLabel,
  categoryShort,
  COLS,
  dateText,
  HEADER_ROW,
  HEADERS,
  MANAGE_KEYS,
  MANAGE_LABEL_COL,
  MANAGE_LABELS,
  MANAGE_ROWS,
  MANAGE_VALUE_COL,
  MEMO_MAX,
  SHEET_BUCKET_LABELS,
  SHEET_CATEGORIES,
  SHEET_FORMAT,
  SHEET_FORMAT_VERSION,
  SHEET_NAME,
  SHEET_REQUEST_ID,
  WIDTHS,
  type ManageKey,
} from "./layout.ts";

/** シートだけで使う書式（共通の書式の後ろに足す） */
const X = { readonly: STYLE_COUNT, amount: STYLE_COUNT + 1, warn: STYLE_COUNT + 2 } as const;
const STYLES = buildStyles([
  `<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`, // 読むだけの欄
  `<xf numFmtId="3" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>`, // 金額（3桁ごとのカンマ）
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`, // 気をつけてほしい文
]);

export interface MarkSheetOptions {
  /** 迷う行（reviewList の結果。並びの重いものから載せる） */
  readonly items: readonly ReviewItem[];
  /** 口座・カードの ID → 呼び名（番号は書かない呼び名） */
  readonly accounts: ReadonlyMap<string, string>;
  /** 構成員の ID → お客さまに見せる呼び名（ご主人・奥様など） */
  readonly owners: ReadonlyMap<string, string>;
  /** 依頼番号（sheetRequestId にアプリ本体の乱数を渡して作る） */
  readonly requestId: string;
  /** 表示用の顧客番号（英数字。氏名は入れない。無くてよい） */
  readonly customerNo?: string;
  /** 書き出した日時（ISO 8601。日付の部分を書き出した日にする） */
  readonly exportedAt: string;
  readonly appVersion: string;
}

export interface MarkSheetResult {
  readonly bytes: Uint8Array;
  /** 依頼の記録（保存したときだけ世帯に残す） */
  readonly request: StatementRequest;
  /** 載せた行の数 */
  readonly rows: number;
  /** 書き出す前に FP に見せる知らせ（暗号化されないこと・載せきれなかった行） */
  readonly issues: readonly Issue[];
}

const CUSTOMER_NO = /^[A-Za-z0-9-]{1,16}$/u;

/** 番号らしき数字を消した文字（消すものが無ければ元のまま。全角の括弧などをそろえ直さない） */
function masked(t: string): string {
  const m = maskText(t);
  return m.masked ? m.text : t;
}

/** 書き出す前に FP に見せる知らせ（行を選ぶ前にも出す） */
export function markSheetWarnings(count: number): Issue[] {
  const out = [issue("warning", "S_SHEET_PLAINTEXT", "暗号化されない表計算のファイルに、店の名前・金額・使った日が載ります（カード番号・口座番号は消してあります）。送り方と保管に気をつけてください（書き出したことを記録します）")];
  if (count > MAX_REQUEST_ROWS) out.push(issue("warning", "S_SHEET_OVERFLOW", `迷う行が ${count}行あります。シートには迷う度合いの重いものから ${MAX_REQUEST_ROWS}行までを載せます`));
  return out;
}

/** 確認シートの .xlsx を作る */
export async function createMarkSheet(o: MarkSheetOptions): Promise<MarkSheetResult> {
  if (!SHEET_REQUEST_ID.test(o.requestId)) throw new Error("E_STATEMENT_SHEET_REQUEST_ID");
  if (o.items.length === 0) throw new Error("E_STATEMENT_SHEET_EMPTY");
  const customerNo = o.customerNo !== undefined && CUSTOMER_NO.test(o.customerNo) ? o.customerNo : "";
  const exportedOn = o.exportedAt.slice(0, 10);
  const issues = markSheetWarnings(o.items.length);
  // 載せる行: 重いものから上限まで → カード・口座ごとに使った日の順に並べる（お客さまが明細と見比べやすい順）
  const picked = o.items.slice(0, MAX_REQUEST_ROWS);
  const accountOf = (it: ReviewItem) => o.accounts.get(it.account) ?? "";
  const rows = [...picked].sort((a, b) => (accountOf(a) < accountOf(b) ? -1 : accountOf(a) > accountOf(b) ? 1 : a.date < b.date ? -1 : a.date > b.date ? 1 : a.merchant < b.merchant ? -1 : a.merchant > b.merchant ? 1 : 0));

  const management: Record<ManageKey, string> = {
    format: SHEET_FORMAT,
    formatVersion: SHEET_FORMAT_VERSION,
    requestId: o.requestId,
    customerNo,
    rowCount: String(rows.length),
    appVersion: o.appVersion,
    exportedOn,
  };
  const lists = new Lists();
  const b = new SheetBuilder();
  const last = COLS.memo;
  const widthAll = WIDTHS.reduce((s, w) => s + w, 0);

  b.set(1, "A", STYLE.title, text("明細のご確認のお願い"));
  b.height(1, 26);
  for (const k of ["requestId", "customerNo", "exportedOn"] as const) {
    b.set(MANAGE_ROWS[k], MANAGE_LABEL_COL, STYLE.manageLabel, text(MANAGE_LABELS[k]));
    b.set(MANAGE_ROWS[k], MANAGE_VALUE_COL, STYLE.manageValue, text(k === "exportedOn" ? dateText(exportedOn) : management[k]));
  }
  b.set(7, "A", STYLE.heading, text("ご記入のしかた"));
  const notes: [number, string, number][] = [
    [8, "カード・口座の明細のうち、使い道や、家計に入れるかどうかを確かめたい行です。黄色の欄を ▼ から選んでください。分からない行は空欄のままで構いません。", STYLE.text],
    [9, "「何に使ったか」は食費・日用品などの項目です。「どこに入るか」は、ふだんの家計か、お仕事で使った分（会社に請求する立替・事業の経費・会社の経費）か、旅行などの一時的な支出かを選びます。選べるものは、お使いになった方の働き方に合わせてあります。", STYLE.text],
    [10, "事業の経費のときは、事業で使った割合（1〜100 の%）も書いてください。お仕事と暮らしの両方で使うもの（携帯電話・車など）は、だいたいの割合で構いません。", STYLE.text],
    [11, "番号・ご利用日・金額の欄は書き換えないでください（お預かりした明細と照らし合わせて読みます）。気になることはメモの欄にどうぞ。", STYLE.text],
    [12, "カード番号・口座番号は消してあります（●●●●）。このファイルには、ご利用のお店と金額が載っています。保管とお送りの方法にお気をつけください。お名前は書かないでください。", X.warn],
  ];
  for (const [row, t, st] of notes) {
    b.set(row, "A", st, text(t));
    b.merges.push(`A${row}:${last}${row}`);
    b.height(row, 18 * lines(t, widthAll));
  }
  for (const [k, col] of Object.entries(COLS) as [keyof typeof COLS, string][]) b.set(HEADER_ROW, col, STYLE.colHead, text(HEADERS[k]));
  b.height(HEADER_ROW, 32);

  const categoryChoices = SHEET_CATEGORIES.map(categoryLabel);
  const map: StatementRequest["rows"][number][] = [];
  rows.forEach((it, i) => {
    const no = i + 1;
    const r = HEADER_ROW + no;
    map.push({ no, import: it.importId, row: it.rowId });
    b.set(r, COLS.no, STYLE.no, num(no));
    b.set(r, COLS.date, X.readonly, text(dateText(it.date)));
    b.set(r, COLS.merchant, X.readonly, text(masked(it.merchant)));
    b.set(r, COLS.amount, X.amount, num(it.amount));
    b.set(r, COLS.account, X.readonly, text(masked(accountOf(it))));
    b.set(r, COLS.owner, X.readonly, text(it.owner === null ? "ご家族（共用）" : (o.owners.get(it.owner) ?? "ご家族")));
    b.set(r, COLS.guess, X.readonly, text(`${it.category === null ? "分からない" : categoryShort(it.category)}／${SHEET_BUCKET_LABELS[it.bucket].replace(/（.*）$/u, "")}`));
    b.set(r, COLS.category, STYLE.input);
    b.set(r, COLS.bucket, STYLE.input);
    const business = it.allowed.includes("business");
    b.set(r, COLS.share, business ? STYLE.input : STYLE.locked);
    b.set(r, COLS.memo, STYLE.inputText);
    b.height(r, Math.max(22, 16 * Math.max(lines(it.merchant, WIDTHS[2]), lines(accountOf(it), WIDTHS[4])) + 4));
    b.validations.push(listValidation(`${COLS.bucket}${r}`, lists, it.allowed.map((x) => SHEET_BUCKET_LABELS[x]), "選択肢から選んでください（お使いになった方の働き方で選べるものだけです）"));
    if (business) b.validations.push(numberValidation(`${COLS.share}${r}`, "whole", 1, 100, "1〜100 の数で書いてください"));
  });
  const first = HEADER_ROW + 1;
  const end = HEADER_ROW + rows.length;
  b.validations.unshift(
    listValidation(`${COLS.category}${first}:${COLS.category}${end}`, lists, categoryChoices, "選択肢から選んでください"),
    validation(`${COLS.memo}${first}:${COLS.memo}${end}`, 'type="textLength" operator="lessThanOrEqual"', `${MEMO_MAX}文字までで書いてください`) + `<formula1>${MEMO_MAX}</formula1></dataValidation>`,
  );

  const entries = MANAGE_KEYS.map((k) => [k, management[k]] as const);
  const bytes = writeBook({
    sheets: [
      { name: SHEET_NAME, xml: b.xml({ widths: WIDTHS, protect: true, freezeRows: HEADER_ROW, landscape: true }) },
      { name: LIST_SHEET, xml: lists.sheetXml(), state: "hidden" },
      { name: META_SHEET, xml: metaSheetXml(entries), state: "veryHidden" },
    ],
    styles: STYLES,
    title: "明細のご確認のお願い",
    application: SHEET_FORMAT,
    properties: entries,
    date: exportedOn,
  });
  const request: StatementRequest = { id: o.requestId, at: o.exportedAt, file: { sha256: await fileDigest(bytes), bytes: bytes.length }, rows: map, received: [] };
  return { bytes, request, rows: rows.length, issues };
}

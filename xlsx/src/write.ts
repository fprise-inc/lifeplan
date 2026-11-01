// 表計算のファイル（.xlsx）を書き出す土台。マクロは使わない（.xlsx だけ）。決まった入力から決まったバイト列になる（無圧縮の zip）。
// - シートの組み立て（SheetBuilder）: セル・行の高さ・結合・入力規則・保護（パスワードなし）・見出しの行の固定
// - 選択肢の一覧（Lists）: 入力規則の選択肢を隠したシートの列にまとめる
// - 書式（buildStyles）: 共通の書式の並び（STYLE）に、使う側の書式を足せる
// - 管理の値を3か所に書く（0018 の2）: 非常に隠したシート（metaSheetXml）・文書のユーザー設定のプロパティ（writeBook の properties）・
//   1枚目の見える管理欄（使う側がシートに書く）
import { colIndex, colLetter, type CellValue } from "./cells.ts";
import { escapeXml, escapeXstring } from "./xml.ts";
import { writeZip } from "./zip.ts";

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** 管理の値を書く非常に隠したシートの名前（形式で固定） */
export const META_SHEET = "_lifeplan";
/** 選択肢の一覧のシートの名前（隠す） */
export const LIST_SHEET = "_lists";
/** ユーザー設定のプロパティの名前の接頭辞 */
export const PROPERTY_PREFIX = "lifeplan.";

/** 共通の書式の番号（styles.xml の cellXfs の並び。buildStyles の extra はこの後ろに続く） */
export const STYLE = { title: 1, section: 2, group: 3, label: 4, input: 5, small: 6, heading: 7, text: 8, manageLabel: 9, manageValue: 10, inputText: 11, no: 12, colHead: 13, locked: 14 } as const;
/** 共通の書式の数（extra の最初の番号） */
export const STYLE_COUNT = 15;

interface Cell {
  readonly col: string;
  readonly style: number;
  readonly value?: CellValue;
}

export interface SheetXmlOptions {
  readonly widths: readonly number[];
  /** 記入欄（書式で保護を外したセル）以外を保護する（パスワードなし。形を崩しにくくするためで、守りのためではない） */
  readonly protect: boolean;
  /** 上から何行を固定するか */
  readonly freezeRows?: number;
  readonly landscape?: boolean;
}

export class SheetBuilder {
  readonly rows = new Map<number, Cell[]>();
  readonly heights = new Map<number, number>();
  readonly merges: string[] = [];
  readonly validations: string[] = [];
  set(row: number, col: string, style: number, value?: CellValue): void {
    const list = this.rows.get(row) ?? [];
    list.push({ col, style, ...(value !== undefined ? { value } : {}) });
    this.rows.set(row, list);
  }
  height(row: number, h: number): void {
    this.heights.set(row, Math.max(this.heights.get(row) ?? 0, h));
  }
  xml(opts: SheetXmlOptions): string {
    const rows = [...this.rows.keys()].sort((a, b) => a - b);
    const body = rows
      .map((r) => {
        const cells = (this.rows.get(r) as Cell[]).sort((a, b) => colIndex(a.col) - colIndex(b.col));
        const ht = this.heights.get(r);
        const attrs = ht === undefined ? "" : ` ht="${ht}" customHeight="1"`;
        return `<row r="${r}"${attrs}>${cells.map((c) => cellXml(`${c.col}${r}`, c)).join("")}</row>`;
      })
      .join("");
    const cols = opts.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
    const pane = opts.freezeRows === undefined ? "" : `<pane ySplit="${opts.freezeRows}" topLeftCell="A${opts.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`;
    return (
      XML_HEAD +
      `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
      `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
      `<sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="18"/>` +
      `<cols>${cols}</cols>` +
      `<sheetData>${body}</sheetData>` +
      (opts.protect ? `<sheetProtection sheet="1" objects="1" scenarios="1" formatColumns="0" formatRows="0"/>` : "") +
      (this.merges.length > 0 ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "") +
      (this.validations.length > 0 ? `<dataValidations count="${this.validations.length}">${this.validations.join("")}</dataValidations>` : "") +
      `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
      `<pageSetup paperSize="9" orientation="${opts.landscape === true ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>` +
      `</worksheet>`
    );
  }
}

function cellXml(ref: string, c: Cell): string {
  if (c.value === undefined) return `<c r="${ref}" s="${c.style}"/>`;
  if (c.value.kind === "number") return `<c r="${ref}" s="${c.style}"><v>${escapeXml(c.value.text)}</v></c>`;
  if (c.value.kind === "bool") return `<c r="${ref}" s="${c.style}" t="b"><v>${c.value.value ? 1 : 0}</v></c>`;
  return `<c r="${ref}" s="${c.style}" t="inlineStr"><is><t xml:space="preserve">${escapeXstring(c.value.text)}</t></is></c>`;
}

/** 全角の文字の幅で、行の数を見積もる（結合したセル・折り返しの行の高さ用） */
export function lines(t: string, width: number): number {
  let w = 0;
  for (const ch of t) w += ch.charCodeAt(0) > 0xff ? 2 : 1;
  return Math.max(1, Math.ceil(w / Math.max(1, width - 2)));
}

/** 選択肢の一覧（隠したシートの列）をまとめる。同じ選択肢の組は1つの列を使い回す */
export class Lists {
  readonly columns: string[][] = [];
  private readonly index = new Map<string, number>();
  ref(values: readonly string[]): string {
    const key = values.join("\u0000");
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.columns.length;
      this.columns.push([...values]);
      this.index.set(key, i);
    }
    const col = colLetter(i);
    return `'${LIST_SHEET}'!$${col}$1:$${col}$${values.length}`;
  }
  /** 一覧のシート（隠す） */
  sheetXml(): string {
    const b = new SheetBuilder();
    this.columns.forEach((col, i) => col.forEach((v, j) => b.set(j + 1, colLetter(i), 0, { kind: "text", text: v })));
    return b.xml({ widths: [30], protect: true });
  }
}

/** 入力規則の始まりのタグ（閉じる </dataValidation> は使う側が式の後に付ける） */
export function validation(sqref: string, body: string, error: string): string {
  return `<dataValidation ${body} allowBlank="1" showErrorMessage="1" errorTitle="ご記入の内容" error="${escapeXstring(error)}" sqref="${sqref}">`;
}

/** 選択肢から選ぶ入力規則 */
export function listValidation(sqref: string, lists: Lists, values: readonly string[], error: string): string {
  return validation(sqref, 'type="list"', error) + `<formula1>${escapeXml(lists.ref(values))}</formula1></dataValidation>`;
}

/** 数の範囲の入力規則 */
export function numberValidation(sqref: string, type: "whole" | "decimal", min: number, max: number, error: string): string {
  return validation(sqref, `type="${type}" operator="between"`, error) + `<formula1>${min}</formula1><formula2>${max}</formula2></dataValidation>`;
}

/** 管理の値の非常に隠したシート（キーと値の2列） */
export function metaSheetXml(entries: readonly (readonly [string, string])[]): string {
  const b = new SheetBuilder();
  entries.forEach(([k, v], i) => {
    b.set(i + 1, "A", 0, { kind: "text", text: k });
    b.set(i + 1, "B", 0, { kind: "text", text: v });
  });
  return b.xml({ widths: [20, 70], protect: true });
}

const FONT = '<name val="游ゴシック"/><family val="3"/><charset val="128"/>';
const BASE_XFS: readonly string[] = [
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`, // 0 既定
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>`, // 1 題名
  `<xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>`, // 2 章
  `<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`, // 3 まとまり
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`, // 4 質問
  `<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1" applyProtection="1"><alignment vertical="center" wrapText="1"/><protection locked="0"/></xf>`, // 5 記入欄
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`, // 6 単位・手引き
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>`, // 7 見出し
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`, // 8 文
  `<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>`, // 9 管理欄の見出し
  `<xf numFmtId="49" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>`, // 10 管理欄の値
  `<xf numFmtId="49" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1" applyProtection="1"><alignment vertical="top" wrapText="1"/><protection locked="0"/></xf>`, // 11 記入欄（文字）
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`, // 12 番号
  `<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`, // 13 列の見出し
  `<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>`, // 14 使わない欄
];

/**
 * 書式（styles.xml）。フォント 0 既定・1 太字・2 題名・3 小さい灰色・4 白の太字、塗り 2 記入欄（薄い黄）・3 章（紺）・4 まとまり（薄い青）・5 灰色、
 * 罫線 1 細い灰色。extra はセルの書式（<xf .../>）で、STYLE_COUNT から順に番号が付く
 */
export function buildStyles(extra: readonly string[] = []): string {
  const xfs = [...BASE_XFS, ...extra];
  return (
    XML_HEAD +
    `<styleSheet xmlns="${NS_MAIN}">` +
    `<fonts count="5">` +
    `<font><sz val="11"/>${FONT}</font>` +
    `<font><b/><sz val="11"/>${FONT}</font>` +
    `<font><b/><sz val="14"/>${FONT}</font>` +
    `<font><sz val="9"/><color rgb="FF595959"/>${FONT}</font>` +
    `<font><b/><sz val="12"/><color rgb="FFFFFFFF"/>${FONT}</font>` +
    `</fonts>` +
    `<fills count="6">` +
    `<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFFFF7D6"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF2F5597"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">` +
    xfs.join("") +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

export interface BookSheet {
  readonly name: string;
  readonly xml: string;
  readonly state?: "hidden" | "veryHidden";
}

export interface BookOptions {
  /** シート（並びのとおり。最初の見えるシートが1枚目） */
  readonly sheets: readonly BookSheet[];
  /** 名前の定義（名前 → 参照）。名前の順に並べて書く */
  readonly definedNames?: readonly (readonly [string, string])[];
  /** 書式（buildStyles の結果） */
  readonly styles: string;
  /** 文書の題名 */
  readonly title: string;
  /** 文書を作ったもの（形式名） */
  readonly application: string;
  /** 管理の値（文書のユーザー設定のプロパティ。名前は PROPERTY_PREFIX＋キー） */
  readonly properties: readonly (readonly [string, string])[];
  /** zip の中のファイルの日付（YYYY-MM-DD） */
  readonly date: string;
}

/** ブックを組み立てて .xlsx のバイト列にする */
export function writeBook(o: BookOptions): Uint8Array {
  const enc = new TextEncoder();
  const sheets = o.sheets;
  const names = [...(o.definedNames ?? [])].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const definedNames = names.map(([n, ref]) => `<definedName name="${escapeXml(n)}">${escapeXml(ref)}</definedName>`).join("");
  const workbook =
    XML_HEAD +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
    sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}"${s.state === undefined ? "" : ` state="${s.state}"`} r:id="rId${i + 1}"/>`).join("") +
    `</sheets>${names.length > 0 ? `<definedNames>${definedNames}</definedNames>` : ""}</workbook>`;
  const wbRels =
    XML_HEAD +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="${NS_R}/styles" Target="styles.xml"/></Relationships>`;
  const props = o.properties
    .map(([k, v], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${PROPERTY_PREFIX}${k}"><vt:lpwstr>${escapeXml(v)}</vt:lpwstr></property>`)
    .join("");
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      XML_HEAD +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
        `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
        `<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>` +
        `</Types>`,
    ],
    [
      "_rels/.rels",
      XML_HEAD +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
        `<Relationship Id="rId3" Type="${NS_R}/extended-properties" Target="docProps/app.xml"/>` +
        `<Relationship Id="rId4" Type="${NS_R}/custom-properties" Target="docProps/custom.xml"/>` +
        `</Relationships>`,
    ],
    [
      "docProps/core.xml",
      XML_HEAD +
        `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>${escapeXml(o.title)}</dc:title></cp:coreProperties>`,
    ],
    ["docProps/app.xml", XML_HEAD + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${escapeXml(o.application)}</Application></Properties>`],
    [
      "docProps/custom.xml",
      XML_HEAD + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${props}</Properties>`,
    ],
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", wbRels],
    ["xl/styles.xml", o.styles],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, s.xml]),
  ];
  return writeZip(
    files.map(([name, body]) => ({ name, data: enc.encode(body) })),
    o.date,
  );
}

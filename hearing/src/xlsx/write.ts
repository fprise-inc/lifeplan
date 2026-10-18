// ヒアリングシートの .xlsx を書き出す（0018 の2・4）。マクロは使わない。
// - 回答のセルに Excel の「名前の定義」（項目キー、繰り返しは _n）を付ける
// - 回答の状態は値のセルの隣の「状態のセル」で選ぶ（わからない・該当なし）
// - 入力規則（選択肢・数・文字数）、記入例、転記の手引きを入れる。回答のセル以外を保護する（パスワードなし）
// - 管理の値を3か所に書く: 隠したシート _lifeplan（非常に隠す）・文書のユーザー設定のプロパティ・1枚目の管理欄
// - 世帯の内部ID・名前の欄・聞かない項目の欄は作らない（0012）
import { HEARING_FORMAT, answerKey, type Answer, type Management, type RawValue } from "../answers.ts";
import { MONTH_LABELS, STATE_LABELS, colIndex, colLetter, itemByKey, yearLabel, type LayoutRow, type SheetDefinition, type SheetItem } from "../definition.ts";
import { ANSWER_HEADER_ROW, MANAGE_LABEL_COL, MANAGE_ROWS, MANAGE_VALUE_COL } from "../layout.ts";
import { escapeXml } from "./xml.ts";
import { writeZip } from "./zip.ts";

/** 1枚目に出す事務所の情報（FP の事務所の設定から） */
export interface OfficeInfo {
  readonly name: string;
  readonly purpose: string;
  readonly privacyContact: string;
}

export interface WriteOptions {
  readonly management: Management;
  readonly office: OfficeInfo;
}

/** 隠したシートの名前（形式で固定） */
export const META_SHEET = "_lifeplan";
const LIST_SHEET = "_lists";

/** 管理の値のキー（隠したシート・ユーザー設定のプロパティで共通） */
export const MANAGE_KEYS = ["format", "formatVersion", "sheetId", "sheetVersion", "requestId", "customerNo", "layoutDigest", "appVersion", "exportedOn"] as const;
/** ユーザー設定のプロパティの名前の接頭辞 */
export const PROPERTY_PREFIX = "lifeplan.";

// 書式の番号（styles.xml の cellXfs の並び）
const S = { title: 1, section: 2, group: 3, label: 4, input: 5, small: 6, heading: 7, text: 8, manageLabel: 9, manageValue: 10, inputText: 11, no: 12, colHead: 13, locked: 14 } as const;

const enc = new TextEncoder();
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

interface Cell {
  readonly col: string;
  readonly style: number;
  readonly value?: RawValue;
}

class SheetBuilder {
  readonly rows = new Map<number, Cell[]>();
  readonly heights = new Map<number, number>();
  readonly merges: string[] = [];
  readonly validations: string[] = [];
  set(row: number, col: string, style: number, value?: RawValue): void {
    const list = this.rows.get(row) ?? [];
    list.push({ col, style, ...(value !== undefined ? { value } : {}) });
    this.rows.set(row, list);
  }
  height(row: number, h: number): void {
    this.heights.set(row, Math.max(this.heights.get(row) ?? 0, h));
  }
  xml(opts: { widths: readonly number[]; protect: boolean; freezeRows?: number; landscape?: boolean }): string {
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
  return `<c r="${ref}" s="${c.style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(c.value.text)}</t></is></c>`;
}

const text = (t: string): RawValue => ({ kind: "text", text: t });

/** 全角の文字の幅で、行の数を見積もる（結合したセル・折り返しの行の高さ用） */
function lines(t: string, width: number): number {
  let w = 0;
  for (const ch of t) w += ch.charCodeAt(0) > 0xff ? 2 : 1;
  return Math.max(1, Math.ceil(w / Math.max(1, width - 2)));
}

/** 選択肢の一覧（_lists シートの列）をまとめる */
class Lists {
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
}

function unitText(item: SheetItem): string {
  if (item.type === "money" && item.unit !== undefined) {
    const basis = { monthly: "月額", annual: "年額", once: "" }[item.unit.basis];
    return `${item.unit.scale === "manYen" ? "万円" : "円"}${basis === "" ? "" : `（${basis}）`}`;
  }
  if (item.type === "percent") return "%";
  return item.unitLabel ?? "";
}

function validation(sqref: string, body: string, error: string): string {
  return `<dataValidation ${body} allowBlank="1" showErrorMessage="1" errorTitle="ご記入の内容" error="${escapeXml(error)}" sqref="${sqref}">`;
}

function itemValidations(def: SheetDefinition, item: SheetItem, row: number, lists: Lists): string[] {
  const c = def.layout.columns;
  const out: string[] = [];
  const v = `${c.value}${row}`;
  const num = (type: "whole" | "decimal", min: number | undefined, max: number | undefined, err: string) =>
    validation(v, `type="${type}" operator="between"`, err) + `<formula1>${min ?? -1e12}</formula1><formula2>${max ?? 1e12}</formula2></dataValidation>`;
  switch (item.type) {
    case "money":
    case "decimal":
    case "percent":
      out.push(num("decimal", item.min, item.max, "数字で記入してください"));
      break;
    case "integer":
      out.push(num("whole", item.min, item.max, "整数で記入してください"));
      break;
    case "choice":
      out.push(validation(v, 'type="list"', "選択肢から選んでください") + `<formula1>${escapeXml(lists.ref((item.choices ?? []).map((x) => x.label)))}</formula1></dataValidation>`);
      break;
    case "yearMonth": {
      const years: string[] = [];
      for (let y = def.years.to; y >= def.years.from; y--) years.push(yearLabel(y));
      out.push(validation(v, 'type="list"', "年を選んでください") + `<formula1>${escapeXml(lists.ref(years))}</formula1></dataValidation>`);
      out.push(validation(`${c.value2}${row}`, 'type="list"', "月を選んでください") + `<formula1>${escapeXml(lists.ref(MONTH_LABELS))}</formula1></dataValidation>`);
      break;
    }
    case "text":
      if (item.maxLength !== undefined) out.push(validation(v, 'type="textLength" operator="lessThanOrEqual"', `${item.maxLength}文字までで記入してください`) + `<formula1>${item.maxLength}</formula1></dataValidation>`);
      break;
  }
  if (item.states.length > 0) {
    out.push(validation(`${c.status}${row}`, 'type="list"', "「わからない」か「該当なし」を選んでください") + `<formula1>${escapeXml(lists.ref(item.states.map((s) => STATE_LABELS[s])))}</formula1></dataValidation>`);
  }
  return out;
}

/** シート定義と回答（空欄・前回の値）から .xlsx のバイト列を作る */
export function writeSheetXlsx(def: SheetDefinition, answers: readonly Answer[], options: WriteOptions): Uint8Array {
  const items = itemByKey(def);
  const byKey = new Map(answers.map((a) => [answerKey(a.key, a.index), a]));
  const c = def.layout.columns;
  const lists = new Lists();
  const intro = new SheetBuilder();
  const ans = new SheetBuilder();
  const names: [string, string][] = [];
  const sheetOf = (name: string) => (name === def.layout.introSheet ? intro : ans);
  const widths = [5, 38, 24, 14, 12, 50];
  const mergeAll = (b: SheetBuilder, row: number, from: string) => b.merges.push(`${from}${row}:${c.guide}${row}`);
  const sections = new Map(def.sections.map((s) => [s.id, s]));
  const axes = new Map(def.axes.map((a) => [a.id, a]));
  const m = options.management;

  // 1枚目の管理欄
  const manage: [number, string, string][] = [
    [MANAGE_ROWS.sheet, "シートの種類と版", `${m.sheetId}-${m.sheetVersion}`],
    [MANAGE_ROWS.requestId, "依頼番号", m.requestId],
    [MANAGE_ROWS.customerNo, "お客さま番号", m.customerNo],
  ];
  for (const [row, label, value] of manage) {
    intro.set(row, MANAGE_LABEL_COL, S.manageLabel, text(label));
    intro.set(row, MANAGE_VALUE_COL, S.manageValue, text(value));
  }
  // 記入欄の見出し
  const head: [string, string][] = [
    [c.no, "番号"],
    [c.label, "ご質問"],
    [c.value, "ご記入欄"],
    [c.value2, "単位・月"],
    [c.status, "状態"],
    [c.guide, "記入例・書類の見方"],
  ];
  for (const [col, t] of head) ans.set(ANSWER_HEADER_ROW, col, S.colHead, text(t));

  const office: Readonly<Record<string, [string, string]>> = {
    name: ["ご相談先の事務所", options.office.name],
    purpose: ["ご記入の情報の利用目的", options.office.purpose],
    privacy: ["個人情報の取り扱いのお問い合わせ", options.office.privacyContact],
  };
  const counters = new Map<string, number>();
  for (const r of def.layout.rows) {
    const b = sheetOf(r.sheet);
    switch (r.kind) {
      case "title":
        b.set(r.row, c.label, S.title, text(r.text ?? ""));
        b.height(r.row, 24);
        break;
      case "heading":
        b.set(r.row, c.label, S.heading, text(r.text ?? ""));
        break;
      case "note":
      case "document":
      case "lead": {
        const t = r.kind === "document" ? `・${r.text ?? ""}` : (r.text ?? "");
        b.set(r.row, c.label, S.text, text(t));
        mergeAll(b, r.row, c.label);
        b.height(r.row, 18 * lines(t, widths.slice(1).reduce((s, w) => s + w, 0)));
        break;
      }
      case "office": {
        const [label, value] = office[r.ref ?? "name"] ?? ["", ""];
        b.set(r.row, c.label, S.label, text(label));
        b.set(r.row, c.value, S.text, text(value));
        b.merges.push(`${c.value}${r.row}:${c.guide}${r.row}`);
        b.height(r.row, 18 * Math.max(lines(label, widths[1] as number), lines(value, 100)));
        break;
      }
      case "section": {
        const s = sections.get(r.section);
        b.set(r.row, c.no, S.section);
        b.set(r.row, c.label, S.section, text(s?.title ?? ""));
        for (const col of [c.value, c.value2, c.status, c.guide]) b.set(r.row, col, S.section);
        b.height(r.row, 22);
        break;
      }
      case "group": {
        const g = sections.get(r.section)?.groups.find((x) => x.id === r.group);
        const axis = g?.axis === undefined ? undefined : axes.get(g.axis);
        const t = axis !== undefined && r.index !== undefined ? (axis.labels[r.index - 1] ?? "") : (g?.title ?? "");
        b.set(r.row, c.no, S.group);
        b.set(r.row, c.label, S.group, text(t));
        for (const col of [c.value, c.value2, c.status, c.guide]) b.set(r.row, col, S.group);
        break;
      }
      case "item": {
        const no = (counters.get(r.sheet) ?? 0) + 1;
        counters.set(r.sheet, no);
        writeItem(def, b, r, items.get(r.key) as SheetItem, byKey.get(answerKey(r.key, r.index)), no, lists, names, widths);
        break;
      }
        break;
    }
  }

  // 選択肢の一覧のシート（隠す）
  const listSheet = new SheetBuilder();
  lists.columns.forEach((col, i) => col.forEach((v, j) => listSheet.set(j + 1, colLetter(i), 0, text(v))));
  // 管理の値のシート（非常に隠す）
  const meta = new SheetBuilder();
  MANAGE_KEYS.forEach((k, i) => {
    meta.set(i + 1, "A", 0, text(k));
    meta.set(i + 1, "B", 0, text(String(m[k])));
  });

  const sheets = [
    { name: def.layout.introSheet, xml: intro.xml({ widths, protect: true }), state: "" },
    { name: def.layout.answerSheet, xml: ans.xml({ widths, protect: true, freezeRows: ANSWER_HEADER_ROW }), state: "" },
    { name: LIST_SHEET, xml: listSheet.xml({ widths: [30], protect: true }), state: ' state="hidden"' },
    { name: META_SHEET, xml: meta.xml({ widths: [20, 70], protect: true }), state: ' state="veryHidden"' },
  ];
  const definedNames = names
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([n, ref]) => `<definedName name="${escapeXml(n)}">${escapeXml(ref)}</definedName>`)
    .join("");
  const workbook =
    XML_HEAD +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
    sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}"${s.state} r:id="rId${i + 1}"/>`).join("") +
    `</sheets><definedNames>${definedNames}</definedNames></workbook>`;
  const wbRels =
    XML_HEAD +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="${NS_R}/styles" Target="styles.xml"/></Relationships>`;
  const props = MANAGE_KEYS.map(
    (k, i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${PROPERTY_PREFIX}${k}"><vt:lpwstr>${escapeXml(String(m[k]))}</vt:lpwstr></property>`,
  ).join("");
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
        `<dc:title>${escapeXml(def.title)}</dc:title></cp:coreProperties>`,
    ],
    ["docProps/app.xml", XML_HEAD + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${escapeXml(HEARING_FORMAT)}</Application></Properties>`],
    [
      "docProps/custom.xml",
      XML_HEAD + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${props}</Properties>`,
    ],
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", wbRels],
    ["xl/styles.xml", STYLES],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, s.xml]),
  ];
  return writeZip(
    files.map(([name, body]) => ({ name, data: enc.encode(body) })),
    m.exportedOn,
  );
}

function writeItem(def: SheetDefinition, b: SheetBuilder, r: Extract<LayoutRow, { kind: "item" }>, item: SheetItem, a: Answer | undefined, no: number, lists: Lists, names: [string, string][], widths: readonly number[]): void {
  const c = def.layout.columns;
  const row = r.row;
  b.set(row, c.no, S.no, { kind: "number", text: String(no) });
  b.set(row, c.label, S.label, text(item.label));
  const inputStyle = item.type === "text" ? S.inputText : S.input;
  const value = a?.status === "value" ? a.raw : undefined;
  b.set(row, c.value, inputStyle, value);
  if (item.type === "yearMonth") b.set(row, c.value2, S.input, a?.status === "value" ? a.raw2 : undefined);
  else {
    const u = unitText(item);
    b.set(row, c.value2, S.small, u === "" ? undefined : text(u));
  }
  if (item.states.length > 0) {
    const st = a?.status === "unknown" || a?.status === "notApplicable" ? text(STATE_LABELS[a.status]) : undefined;
    b.set(row, c.status, S.input, st);
  } else b.set(row, c.status, S.locked);
  const guide = [item.example !== undefined ? `記入例: ${item.example}` : "", item.guide ?? ""].filter((x) => x !== "").join("\n");
  b.set(row, c.guide, S.small, guide === "" ? undefined : text(guide));
  const guideLines = guide.split("\n").reduce((s, t) => s + lines(t, (widths[5] as number) * 1.2), 0);
  const labelLines = lines(item.label, widths[1] as number);
  const textLines = item.type === "text" ? 3 : 1;
  b.height(row, Math.max(20, 16 * Math.max(guideLines, labelLines, textLines) + 4));
  const sheet = `'${r.sheet.replace(/'/g, "''")}'`;
  names.push([r.index === undefined ? r.key : `${r.key}_${r.index}`, `${sheet}!$${c.value}$${row}`]);
  b.validations.push(...itemValidations(def, item, row, lists));
}

const FONT = '<name val="游ゴシック"/><family val="3"/><charset val="128"/>';
const STYLES =
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
  `<cellXfs count="15">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` + // 0 既定
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` + // 1 題名
  `<xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>` + // 2 章
  `<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` + // 3 まとまり
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` + // 4 質問
  `<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1" applyProtection="1"><alignment vertical="center" wrapText="1"/><protection locked="0"/></xf>` + // 5 記入欄
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` + // 6 単位・手引き
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` + // 7 見出し
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` + // 8 文
  `<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` + // 9 管理欄の見出し
  `<xf numFmtId="49" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>` + // 10 管理欄の値
  `<xf numFmtId="49" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1" applyProtection="1"><alignment vertical="top" wrapText="1"/><protection locked="0"/></xf>` + // 11 記入欄（文字）
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` + // 12 番号
  `<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` + // 13 列の見出し
  `<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>` + // 14 使わない欄
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

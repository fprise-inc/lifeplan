// ヒアリングシートの .xlsx を書き出す（0018 の2・4）。マクロは使わない。
// - 回答のセルに Excel の「名前の定義」（項目キー、繰り返しは _n）を付ける
// - 回答の状態は値のセルの隣の「状態のセル」で選ぶ（わからない・該当なし）
// - 入力規則（選択肢・数・文字数）、記入例、転記の手引きを入れる。回答のセル以外を保護する（パスワードなし）
// - 管理の値を3か所に書く: 隠したシート _lifeplan（非常に隠す）・文書のユーザー設定のプロパティ・1枚目の管理欄
// - 世帯の内部ID・名前の欄・聞かない項目の欄は作らない（0012）
import { HEARING_FORMAT, answerKey, type Answer, type Management } from "../answers.ts";
import { MONTH_LABELS, STATE_LABELS, itemByKey, yearLabel, type LayoutRow, type SheetDefinition, type SheetItem } from "../definition.ts";
import { ANSWER_HEADER_ROW, MANAGE_LABEL_COL, MANAGE_ROWS, MANAGE_VALUE_COL } from "../layout.ts";
import { text } from "../../../xlsx/src/cells.ts";
import { escapeXml } from "../../../xlsx/src/xml.ts";
import { buildStyles, lines, Lists, LIST_SHEET, META_SHEET, metaSheetXml, PROPERTY_PREFIX, SheetBuilder, STYLE, validation, writeBook } from "../../../xlsx/src/write.ts";

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

export { META_SHEET, PROPERTY_PREFIX };

/** 管理の値のキー（隠したシート・ユーザー設定のプロパティで共通） */
export const MANAGE_KEYS = ["format", "formatVersion", "sheetId", "sheetVersion", "requestId", "customerNo", "layoutDigest", "appVersion", "exportedOn"] as const;

// 書式の番号（共通の書式の並び。xlsx/ の STYLE）
const S = STYLE;

function unitText(item: SheetItem): string {
  if (item.type === "money" && item.unit !== undefined) {
    const basis = { monthly: "月額", annual: "年額", once: "" }[item.unit.basis];
    return `${item.unit.scale === "manYen" ? "万円" : "円"}${basis === "" ? "" : `（${basis}）`}`;
  }
  if (item.type === "percent") return "%";
  return item.unitLabel ?? "";
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

  const sheets = [
    { name: def.layout.introSheet, xml: intro.xml({ widths, protect: true }) },
    { name: def.layout.answerSheet, xml: ans.xml({ widths, protect: true, freezeRows: ANSWER_HEADER_ROW }) },
    { name: LIST_SHEET, xml: lists.sheetXml(), state: "hidden" as const },
    { name: META_SHEET, xml: metaSheetXml(MANAGE_KEYS.map((k) => [k, String(m[k])] as const)), state: "veryHidden" as const },
  ];
  return writeBook({
    sheets,
    definedNames: names,
    styles: STYLES,
    title: def.title,
    application: HEARING_FORMAT,
    properties: MANAGE_KEYS.map((k) => [k, String(m[k])] as const),
    date: m.exportedOn,
  });
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

const STYLES = buildStyles();

// 返ってきたヒアリングシート（.xlsx）を読む（0018 の2・4・5・6）。AI を使わず、決まった手順で読む。
// - 受け付けるのは .xlsx だけ。マクロ・外部リンク・埋め込みのオブジェクトは読まず、実行もしない。数式は評価しない
// - 読むのは管理の値と、シート定義が指すセルだけ（ほかのセル・ほかのシートは読まない）
// - 管理の値は3か所から読み、食い違えば止める。どのシート定義で読むかは、アプリの側の依頼の記録を正にする
// - 回答のセルは名前の定義で探し、シート定義の固定の位置と照らし合わせる。食い違いは「要確認」にして黙って使わない
import { HEARING_FORMAT, HEARING_FORMAT_VERSION, type Answer, type AnswerStatus, type FilledSheet, type Management, type RawValue } from "../answers.ts";
import { STATE_LABELS, answerCells, cellName, colIndex, colLetter, itemByKey, type SheetDefinition } from "../definition.ts";
import { issue, type Issue } from "../issues.ts";
import { MANAGE_LABEL_COL, MANAGE_ROWS, MANAGE_VALUE_COL, layoutDigest } from "../layout.ts";
import { MANAGE_KEYS, META_SHEET, PROPERTY_PREFIX } from "./write.ts";
import { child, childrenNamed, parseXml, textOf, XmlError, type XmlElement } from "./xml.ts";
import { DEFAULT_LIMITS, ZipError, ZipReader, type ZipLimits } from "./zip.ts";

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

interface RawCell {
  readonly t?: string;
  readonly v?: string;
  readonly f: boolean;
  readonly inline?: string;
}

type Sheet = Map<string, RawCell>;

const fail = (issues: Issue[], i: Issue): ReadResult => ({ ok: false, issues: [...issues, i] });

/** ファイルの先頭のバイトから、.xlsx 以外の形を見分ける */
function sniff(bytes: Uint8Array): Issue | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return null;
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return issue("error", "H_FILE_XLS", "古い Excel の形式（.xls）か、パスワードの付いたファイルです。パスワードを外し、「Excel ブック（.xlsx）」で保存し直してから取り込んでください");
  }
  return issue("error", "H_FILE_NOT_XLSX", "Excel のファイル（.xlsx）ではありません。「Excel ブック（.xlsx）」で保存し直してから取り込んでください");
}

function zipIssue(e: unknown): Issue {
  if (e instanceof ZipError) {
    if (e.kind === "tooLarge") return issue("error", "H_FILE_TOO_LARGE", `ファイルが大きすぎるため読みませんでした（${e.message}）`);
    if (e.kind === "encrypted") return issue("error", "H_FILE_ENCRYPTED", "暗号化されたファイルは読みません。パスワードを外して保存し直してください");
    return issue("error", "H_FILE_BROKEN", `ファイルが壊れているため読めません（${e.message}）`);
  }
  if (e instanceof XmlError) return issue("error", "H_FILE_BROKEN", `ファイルの中身が壊れているため読めません（${e.message}）`);
  return issue("error", "H_FILE_BROKEN", "ファイルを読めませんでした");
}

/** 返ってきた .xlsx を読み、回答の一覧にする */
export async function readSheetXlsx(bytes: Uint8Array, options: ReadOptions): Promise<ReadResult> {
  const issues: Issue[] = [];
  const s = sniff(bytes);
  if (s !== null) return fail(issues, s);
  try {
    return await readZip(new ZipReader(bytes, options.limits ?? DEFAULT_LIMITS), options, issues);
  } catch (e) {
    return fail(issues, zipIssue(e));
  }
}

async function readZip(zip: ZipReader, options: ReadOptions, issues: Issue[]): Promise<ReadResult> {
  const names = zip.names();
  if (zip.has("mimetype")) {
    const mt = await zip.readText("mimetype");
    if (mt?.includes("opendocument") === true) return fail(issues, issue("error", "H_FILE_ODS", "OpenDocument の形式（.ods）です。「Excel ブック（.xlsx）」で保存し直してから取り込んでください"));
  }
  if (names.some((n) => n.startsWith("Index/") && n.endsWith(".iwa"))) return fail(issues, issue("error", "H_FILE_NUMBERS", "Numbers の形式です。Numbers の「書き出す」から Excel（.xlsx）を選んで保存し直してください"));
  if (!zip.has("xl/workbook.xml")) return fail(issues, issue("error", "H_FILE_NOT_XLSX", "Excel のファイル（.xlsx）ではありません"));
  if (names.some((n) => /vbaProject\.bin$/i.test(n))) issues.push(issue("info", "H_FILE_MACRO_IGNORED", "マクロが入っていましたが、読まず・実行もしていません"));
  if (names.some((n) => n.startsWith("xl/externalLinks/"))) issues.push(issue("info", "H_FILE_EXTERNAL_IGNORED", "ほかのファイルへのリンクが入っていましたが、読んでいません"));
  if (names.some((n) => n.startsWith("xl/embeddings/") || n.startsWith("xl/activeX/"))) issues.push(issue("info", "H_FILE_EMBEDDED_IGNORED", "埋め込みのオブジェクトが入っていましたが、読んでいません"));

  // ブックの目次
  const wb = parseXml((await zip.readText("xl/workbook.xml")) as string);
  const rels = await readRels(zip, "xl/_rels/workbook.xml.rels");
  const sheetEls = childrenNamed(child(wb, "sheets") ?? wb, "sheet");
  const sheets = sheetEls.map((e) => ({ name: e.attrs.name ?? "", state: e.attrs.state ?? "visible", path: rels.get(e.attrs.id ?? "")?.path ?? null }));
  const definedNames = new Map<string, string>();
  for (const d of childrenNamed(child(wb, "definedNames") ?? wb, "definedName")) {
    if (d.attrs.localSheetId !== undefined) continue;
    definedNames.set((d.attrs.name ?? "").toLowerCase(), textOf(d).trim());
  }
  const sstPath = [...rels.values()].find((r) => r.type.endsWith("/sharedStrings"))?.path ?? "xl/sharedStrings.xml";
  const shared = await readShared(zip, sstPath);
  const cache = new Map<string, Sheet | null>();
  const sheetByName = async (name: string): Promise<Sheet | null> => {
    if (cache.has(name)) return cache.get(name) ?? null;
    const sh = sheets.find((x) => x.name === name);
    const loaded = sh?.path == null ? null : await readSheet(zip, sh.path);
    cache.set(name, loaded);
    return loaded;
  };
  const textAt = (sheet: Sheet | null, ref: string): string | null => {
    const c = sheet?.get(ref);
    if (c === undefined) return null;
    const r = cellRaw(c, shared);
    return r === null ? null : r.kind === "bool" ? String(r.value) : r.text;
  };

  // 管理の値（3か所）
  const sources: { where: string; values: Partial<Record<(typeof MANAGE_KEYS)[number], string>> }[] = [];
  const meta = await sheetByName(META_SHEET);
  if (meta !== null) {
    const values: Record<string, string> = {};
    for (let r = 1; r <= 50; r++) {
      const k = textAt(meta, `A${r}`);
      if (k !== null && (MANAGE_KEYS as readonly string[]).includes(k)) values[k] = textAt(meta, `B${r}`) ?? "";
    }
    sources.push({ where: "隠したシート", values });
  }
  const custom = await zip.readText("docProps/custom.xml");
  if (custom !== null) {
    const values: Record<string, string> = {};
    for (const p of childrenNamed(parseXml(custom), "property")) {
      const n = p.attrs.name ?? "";
      if (!n.startsWith(PROPERTY_PREFIX)) continue;
      const k = n.slice(PROPERTY_PREFIX.length);
      if ((MANAGE_KEYS as readonly string[]).includes(k)) values[k] = textOf(p).trim();
    }
    if (Object.keys(values).length > 0) sources.push({ where: "文書のプロパティ", values });
  }
  const firstVisible = sheets.find((x) => x.state === "visible");
  if (firstVisible !== undefined) {
    const sh = await sheetByName(firstVisible.name);
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
    const named = parseRef(definedNames.get(cellName(cell.key, cell.index).toLowerCase()));
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
      const c = sh.get(`${colLetter(pos.col + dc)}${pos.row}`);
      if (c === undefined) return { raw: null, formula: false, noValue: false };
      const raw = cellRaw(c, shared);
      return { raw, formula: c.f, noValue: c.f && raw === null };
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

/** 名前の定義の参照（'シート'!$C$12）を読む。範囲・#REF! は null */
function parseRef(ref: string | undefined): { sheet: string; col: number; row: number } | null {
  if (ref === undefined) return null;
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref.trim());
  if (m === null) return null;
  const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] as string);
  return { sheet, col: colIndex(m[3] as string), row: Number(m[4]) };
}

async function readRels(zip: ZipReader, path: string): Promise<Map<string, { path: string; type: string }>> {
  const out = new Map<string, { path: string; type: string }>();
  const t = await zip.readText(path);
  if (t === null) return out;
  for (const r of childrenNamed(parseXml(t), "Relationship")) {
    if (r.attrs.TargetMode === "External") continue;
    const target = r.attrs.Target ?? "";
    const p = target.startsWith("/") ? target.slice(1) : `xl/${target}`.replace(/\/\.\//g, "/");
    out.set(r.attrs.Id ?? "", { path: p, type: r.attrs.Type ?? "" });
  }
  return out;
}

async function readShared(zip: ZipReader, path: string): Promise<string[]> {
  const t = await zip.readText(path);
  if (t === null) return [];
  return childrenNamed(parseXml(t), "si").map(textOf);
}

async function readSheet(zip: ZipReader, path: string): Promise<Sheet> {
  const t = await zip.readText(path);
  const out: Sheet = new Map();
  if (t === null) return out;
  const root = parseXml(t);
  const data = child(root, "sheetData");
  if (data === undefined) return out;
  for (const row of childrenNamed(data, "row")) {
    for (const c of childrenNamed(row, "c")) {
      const ref = c.attrs.r;
      if (ref === undefined) continue;
      const v = child(c, "v");
      const is = child(c, "is");
      out.set(ref, {
        ...(c.attrs.t !== undefined ? { t: c.attrs.t } : {}),
        ...(v !== undefined ? { v: textOf(v) } : {}),
        f: child(c, "f") !== undefined,
        ...(is !== undefined ? { inline: textOf(is as XmlElement) } : {}),
      });
    }
  }
  return out;
}

/** セルの生の値（空なら null）。数式は評価せず、保存されている結果だけを見る */
function cellRaw(c: RawCell, shared: readonly string[]): RawValue | null {
  switch (c.t) {
    case "s": {
      const s = c.v === undefined ? undefined : shared[Number(c.v)];
      return s === undefined || s.trim() === "" ? null : { kind: "text", text: s };
    }
    case "inlineStr":
      return c.inline === undefined || c.inline.trim() === "" ? null : { kind: "text", text: c.inline };
    case "str":
      return c.v === undefined || c.v.trim() === "" ? null : { kind: "text", text: c.v };
    case "b":
      return c.v === undefined ? null : { kind: "bool", value: c.v === "1" };
    case "e":
      return c.v === undefined ? null : { kind: "text", text: c.v };
    case "d":
      return c.v === undefined ? null : { kind: "text", text: c.v };
    default:
      return c.v === undefined || c.v.trim() === "" ? null : { kind: "number", text: c.v.trim() };
  }
}

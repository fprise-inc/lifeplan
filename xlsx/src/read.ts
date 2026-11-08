// 返ってきた表計算のファイル（.xlsx）を読む土台。返ってきたファイルは信用しない（0018 の6）:
// - 受け付けるのは .xlsx だけ（古い形式・OpenDocument・別のソフトの形は、保存し直すよう案内する）
// - マクロ・外部リンク・埋め込みのオブジェクトは読まず、実行もしない（入っていたことだけを知らせる）
// - 数式は評価しない（保存されている計算結果だけを見て、数式だったことを返す）
// - 大きさ・中のファイル数・展開した後の大きさに上限を置く（zip.ts）。DOCTYPE を含む XML は読まない（xml.ts）
// - 読むのは、使う側が指したシートとセルだけ（シートは指されたときに初めて展開する）
// - セルの書式は、数がパーセントの書式で表示されているか（percent）だけを見る。Excel は「0.625%」と打つと値を 0.00625 にして
//   パーセントの書式を付けるので、値だけを見ると 100分の1 に読み違える
import type { CellValue } from "./cells.ts";
import { child, childrenNamed, decodeXstring, parseXml, textOf, XmlError, type XmlElement } from "./xml.ts";
import { DEFAULT_LIMITS, ZipError, ZipReader, type ZipLimits } from "./zip.ts";

/** 読めなかった理由 */
export type FileProblemCode = "xls" | "notXlsx" | "ods" | "numbers" | "tooLarge" | "encrypted" | "broken";
export interface FileProblem {
  readonly code: FileProblemCode;
  readonly message: string;
}

/** 読まなかったものの知らせ */
export type FileNoteCode = "macro" | "external" | "embedded";
export interface FileNote {
  readonly code: FileNoteCode;
  readonly message: string;
}

/** ファイルの先頭のバイトから、.xlsx 以外の形を見分ける（.xlsx の形なら null） */
export function sniff(bytes: Uint8Array): FileProblem | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return null;
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return { code: "xls", message: "古い Excel の形式（.xls）か、パスワードの付いたファイルです。パスワードを外し、「Excel ブック（.xlsx）」で保存し直してから取り込んでください" };
  }
  return { code: "notXlsx", message: "Excel のファイル（.xlsx）ではありません。「Excel ブック（.xlsx）」で保存し直してから取り込んでください" };
}

/** 読んでいる途中で止まった理由（zip・XML の例外）を知らせの形に */
export function problemOf(e: unknown): FileProblem {
  if (e instanceof ZipError) {
    if (e.kind === "tooLarge") return { code: "tooLarge", message: `ファイルが大きすぎるため読みませんでした（${e.message}）` };
    if (e.kind === "encrypted") return { code: "encrypted", message: "暗号化されたファイルは読みません。パスワードを外して保存し直してください" };
    return { code: "broken", message: `ファイルが壊れているため読めません（${e.message}）` };
  }
  if (e instanceof XmlError) return { code: "broken", message: `ファイルの中身が壊れているため読めません（${e.message}）` };
  return { code: "broken", message: "ファイルを読めませんでした" };
}

export interface RawCell {
  readonly t?: string;
  readonly v?: string;
  readonly f: boolean;
  readonly inline?: string;
  /** セルの書式の番号（styles.xml の cellXfs の並び） */
  readonly s?: number;
}

/** シートのセル（参照 → 生のセル） */
export type Sheet = ReadonlyMap<string, RawCell>;

/** セルを読んだ結果 */
export interface CellRead {
  /** 値（空なら null） */
  readonly raw: CellValue | null;
  /** 数式のセルか（保存されている計算結果を読んだ） */
  readonly formula: boolean;
  /** 数式のセルに計算結果が保存されていない */
  readonly noValue: boolean;
  /** 数のセルが、パーセントの書式（「0.00%」など）で表示されている（値は 100 で割った数。0.625% なら 0.00625） */
  readonly percent: boolean;
}

export interface BookSheetInfo {
  readonly name: string;
  /** visible・hidden・veryHidden */
  readonly state: string;
  readonly path: string | null;
}

export type OpenResult = { readonly ok: true; readonly book: Book; readonly notes: readonly FileNote[] } | { readonly ok: false; readonly problem: FileProblem; readonly notes: readonly FileNote[] };

export class Book {
  readonly sheets: readonly BookSheetInfo[];
  /** 名前の定義（名前を小文字にしたもの → 参照）。シートの中だけの名前は読まない */
  readonly definedNames: ReadonlyMap<string, string>;
  private readonly zip: ZipReader;
  private readonly shared: readonly string[];
  /** パーセントの書式のセルの書式の番号 */
  private readonly percentStyles: ReadonlySet<number>;
  private readonly cache = new Map<string, Sheet | null>();

  private constructor(zip: ZipReader, sheets: readonly BookSheetInfo[], definedNames: ReadonlyMap<string, string>, shared: readonly string[], percentStyles: ReadonlySet<number>) {
    this.zip = zip;
    this.sheets = sheets;
    this.definedNames = definedNames;
    this.shared = shared;
    this.percentStyles = percentStyles;
  }

  /** ファイルを開く（目次・名前の定義・共有文字列だけを読む。シートは指されたときに読む） */
  static async open(bytes: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): Promise<OpenResult> {
    const notes: FileNote[] = [];
    const s = sniff(bytes);
    if (s !== null) return { ok: false, problem: s, notes };
    try {
      const zip = new ZipReader(bytes, limits);
      const names = zip.names();
      if (zip.has("mimetype")) {
        const mt = await zip.readText("mimetype");
        if (mt?.includes("opendocument") === true) return { ok: false, problem: { code: "ods", message: "OpenDocument の形式（.ods）です。「Excel ブック（.xlsx）」で保存し直してから取り込んでください" }, notes };
      }
      if (names.some((n) => n.startsWith("Index/") && n.endsWith(".iwa"))) return { ok: false, problem: { code: "numbers", message: "Numbers の形式です。Numbers の「書き出す」から Excel（.xlsx）を選んで保存し直してください" }, notes };
      if (!zip.has("xl/workbook.xml")) return { ok: false, problem: { code: "notXlsx", message: "Excel のファイル（.xlsx）ではありません" }, notes };
      if (names.some((n) => /vbaProject\.bin$/i.test(n))) notes.push({ code: "macro", message: "マクロが入っていましたが、読まず・実行もしていません" });
      if (names.some((n) => n.startsWith("xl/externalLinks/"))) notes.push({ code: "external", message: "ほかのファイルへのリンクが入っていましたが、読んでいません" });
      if (names.some((n) => n.startsWith("xl/embeddings/") || n.startsWith("xl/activeX/"))) notes.push({ code: "embedded", message: "埋め込みのオブジェクトが入っていましたが、読んでいません" });

      const wb = parseXml((await zip.readText("xl/workbook.xml")) as string);
      const rels = await readRels(zip, "xl/_rels/workbook.xml.rels");
      const sheets = childrenNamed(child(wb, "sheets") ?? wb, "sheet").map((e) => ({ name: e.attrs.name ?? "", state: e.attrs.state ?? "visible", path: rels.get(e.attrs.id ?? "")?.path ?? null }));
      const definedNames = new Map<string, string>();
      for (const d of childrenNamed(child(wb, "definedNames") ?? wb, "definedName")) {
        if (d.attrs.localSheetId !== undefined) continue;
        definedNames.set((d.attrs.name ?? "").toLowerCase(), textOf(d).trim());
      }
      const sstPath = [...rels.values()].find((r) => r.type.endsWith("/sharedStrings"))?.path ?? "xl/sharedStrings.xml";
      const shared = await readShared(zip, sstPath);
      const stylesPath = [...rels.values()].find((r) => r.type.endsWith("/styles"))?.path ?? "xl/styles.xml";
      const percentStyles = await readPercentStyles(zip, stylesPath);
      return { ok: true, book: new Book(zip, sheets, definedNames, shared, percentStyles), notes };
    } catch (e) {
      return { ok: false, problem: problemOf(e), notes };
    }
  }

  /** 最初の見えるシートの名前 */
  firstVisible(): string | undefined {
    return this.sheets.find((x) => x.state === "visible")?.name;
  }

  /** シートを読む（無ければ null）。壊れていれば例外（problemOf で知らせの形にする） */
  async sheet(name: string): Promise<Sheet | null> {
    if (this.cache.has(name)) return this.cache.get(name) ?? null;
    const sh = this.sheets.find((x) => x.name === name);
    const loaded = sh?.path == null ? null : await readSheet(this.zip, sh.path);
    this.cache.set(name, loaded);
    return loaded;
  }

  /** セルを読む（数式は評価しない） */
  cell(sheet: Sheet | null, ref: string): CellRead {
    const c = sheet?.get(ref);
    if (c === undefined) return { raw: null, formula: false, noValue: false, percent: false };
    const raw = cellRaw(c, this.shared);
    const percent = raw?.kind === "number" && c.s !== undefined && this.percentStyles.has(c.s);
    return { raw, formula: c.f, noValue: c.f && raw === null, percent };
  }

  /** セルの文字（真偽は true・false の文字。空なら null） */
  text(sheet: Sheet | null, ref: string): string | null {
    const r = this.cell(sheet, ref).raw;
    return r === null ? null : r.kind === "bool" ? String(r.value) : r.text;
  }

  /** キーと値の2列のシート（管理の値の隠したシート）を読む。シートが無ければ null。知らないキーは読まない */
  async keyValues(sheetName: string, keys: readonly string[], maxRows = 50): Promise<Record<string, string> | null> {
    const sh = await this.sheet(sheetName);
    if (sh === null) return null;
    const values: Record<string, string> = {};
    for (let r = 1; r <= maxRows; r++) {
      const k = this.text(sh, `A${r}`);
      if (k !== null && keys.includes(k)) values[k] = this.text(sh, `B${r}`) ?? "";
    }
    return values;
  }

  /** 文書のユーザー設定のプロパティ（接頭辞の付いたもの）を読む。無ければ空。知らないキーは読まない */
  async properties(prefix: string, keys: readonly string[]): Promise<Record<string, string>> {
    const values: Record<string, string> = {};
    const custom = await this.zip.readText("docProps/custom.xml");
    if (custom === null) return values;
    for (const p of childrenNamed(parseXml(custom), "property")) {
      const n = p.attrs.name ?? "";
      if (!n.startsWith(prefix)) continue;
      const k = n.slice(prefix.length);
      if (keys.includes(k)) values[k] = textOf(p).trim();
    }
    return values;
  }
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
  return childrenNamed(parseXml(t), "si").map((si) => decodeXstring(textOf(si)));
}

/** 組み込みのパーセントの書式の番号（9「0%」・10「0.00%」） */
const BUILTIN_PERCENT = new Set([9, 10]);

/**
 * 書式の文字がパーセントの書式か（引用 "…"・逃がし \・幅の _x・埋め *x・角かっこ […] の外に「%」がある）。
 * 「0.000"%"」のように「%」を文字として添えただけの書式は、値を 100 倍して見せないのでパーセントの書式でない
 */
export function isPercentFormat(code: string): boolean {
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') {
      const j = code.indexOf('"', i + 1);
      if (j < 0) return false;
      i = j;
    } else if (ch === "\\" || ch === "_" || ch === "*") i++;
    else if (ch === "[") {
      const j = code.indexOf("]", i + 1);
      if (j < 0) return false;
      i = j;
    } else if (ch === "%") return true;
  }
  return false;
}

/** パーセントの書式のセルの書式の番号（cellXfs の並び）。書式の表が無い・読めないときは空（書式なしとして読む） */
async function readPercentStyles(zip: ZipReader, path: string): Promise<Set<number>> {
  const out = new Set<number>();
  try {
    const t = await zip.readText(path);
    if (t === null) return out;
    const root = parseXml(t);
    const custom = new Map<number, string>();
    for (const f of childrenNamed(child(root, "numFmts") ?? root, "numFmt")) custom.set(Number(f.attrs.numFmtId), f.attrs.formatCode ?? "");
    const xfs = childrenNamed(child(root, "cellXfs") ?? root, "xf");
    xfs.forEach((xf, i) => {
      const id = Number(xf.attrs.numFmtId ?? "0");
      const code = custom.get(id);
      if (code !== undefined ? isPercentFormat(code) : BUILTIN_PERCENT.has(id)) out.add(i);
    });
  } catch (e) {
    if (e instanceof ZipError && e.kind === "tooLarge") throw e;
  }
  return out;
}

async function readSheet(zip: ZipReader, path: string): Promise<Map<string, RawCell>> {
  const t = await zip.readText(path);
  const out = new Map<string, RawCell>();
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
        // 文字のセル（数式の結果の文字 str・セルの中の文字 inlineStr）は「_xHHHH_」を戻す（共有文字列は readShared で戻す）
        ...(v !== undefined ? { v: c.attrs.t === "str" ? decodeXstring(textOf(v)) : textOf(v) } : {}),
        f: child(c, "f") !== undefined,
        ...(is !== undefined ? { inline: decodeXstring(textOf(is as XmlElement)) } : {}),
        ...(c.attrs.s !== undefined && /^\d+$/.test(c.attrs.s) ? { s: Number(c.attrs.s) } : {}),
      });
    }
  }
  return out;
}

/** セルの生の値（空なら null）。数式は評価せず、保存されている結果だけを見る */
function cellRaw(c: RawCell, shared: readonly string[]): CellValue | null {
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

/** 行ごとにセルの参照を並べる（行の番号 → その行の参照）。シートの中のセルを表として見るときに使う */
export function rowsOf(sheet: Sheet): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const ref of sheet.keys()) {
    const m = /^[A-Z]{1,3}(\d+)$/.exec(ref);
    if (m === null) continue;
    const r = Number(m[1]);
    const list = out.get(r) ?? [];
    list.push(ref);
    out.set(r, list);
  }
  return out;
}

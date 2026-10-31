// 読み手（0034 の3）。明細のファイルを「欄の表」にする部品を差し替えられる形にする。
// - 段階1: CSV（カード・銀行・家計簿アプリ）と、文字の入った PDF
// - 段階2（会計ソフトの試算表）・段階3（スクショ・写真の文字認識）は、同じ形の読み手を DEFAULT_READERS に足す
// - 読み手は、表のすべての欄を maskCell に通してから返す。そのあと見出しを見て、番号の列を列ごと消す（maskNumberColumns）。
//   元のファイルのバイト列は readStatement の外へ出さず、指紋（SHA-256）と大きさだけを返す（元のファイルは保存しない）
import { CsvError, parseCsv } from "./csv/parse.ts";
import { issue, type Issue } from "./issues.ts";
import { PdfError } from "./pdf/objects.ts";
import { extractPdfLines } from "./pdf/text.ts";
import { checkMapping, findHeaderRow, guessMapping, headerFingerprint, maskNumberColumns, tableToRows, upgradeLearnedMapping, type ColumnMapping, type LearnedFormat, type ReadRow, type SourceKind, type Table } from "./table.ts";
import { decodeText, type Encoding } from "./text/decode.ts";
import { maskCell } from "./text/mask.ts";
import { parseAmount, parseDate, parsePlan } from "./text/values.ts";

/** 1つのファイルの大きさの上限（10MB。ヒアリングシートと同じ） */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface ReaderTable {
  readonly table: Table;
  readonly encoding?: Encoding;
  readonly issues: readonly Issue[];
  /** 読み手が決めた対応付け（PDF の見出しの無い明細を、日付・店・金額の形で読んだとき） */
  readonly fixedMapping?: ColumnMapping;
  /** 明細に書かれた日付（お支払日・発行日など）。年の無い日付の年を補い、この日より後にならないようにする */
  readonly statementDate?: string;
}

/** 読み手（差し替えられる部品） */
export interface StatementReader {
  readonly id: string;
  /** 読み方を変えたら上げる（取り込みの記録に残す） */
  readonly version: number;
  readonly label: string;
  /** このファイルを読めるか（0〜1。一番大きい読み手を使う） */
  accepts(bytes: Uint8Array, fileName?: string): number;
  table(bytes: Uint8Array, kind: SourceKind): Promise<ReaderTable>;
}

function maskTable(cells: string[][]): { cells: string[][]; masked: number } {
  let masked = 0;
  const out = cells.map((r) =>
    r.map((c) => {
      const m = maskCell(c);
      if (m.masked) masked++;
      return m.text;
    }),
  );
  return { cells: out, masked };
}

const startsWith = (b: Uint8Array, s: string) => s.split("").every((ch, i) => b[i] === ch.charCodeAt(0));

export const csvReader: StatementReader = {
  id: "csv",
  version: 1,
  label: "CSV（カード・銀行・家計簿アプリ）",
  accepts(bytes, fileName) {
    if (startsWith(bytes, "%PDF") || startsWith(bytes, "PK")) return 0;
    if (fileName !== undefined && /\.(csv|tsv|txt)$/iu.test(fileName)) return 0.9;
    // UTF-16（BOM つき）の CSV は 0 のバイトを含む
    if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return 0.9;
    // 文字だけのファイル（制御文字が無い）なら読んでみる
    const head = bytes.subarray(0, 512);
    return head.some((c) => c < 0x09) ? 0 : 0.5;
  },
  async table(bytes) {
    const dec = decodeText(bytes);
    const issues: Issue[] = [];
    let parsed: { cells: string[][]; lines: number[] };
    try {
      parsed = parseCsv(dec.text);
    } catch (e) {
      if (e instanceof CsvError) return { table: { cells: [], lines: [], masked: 0 }, encoding: dec.encoding, issues: [issue("error", "S_TOO_MANY_ROWS", "行か列が多すぎるため読みませんでした（2万行・100列まで）")] };
      throw e;
    }
    if (dec.text.includes("�")) issues.push(issue("warning", "S_ENCODING", "読めない文字がありました。文字コードを確かめてください"));
    const m = maskTable(parsed.cells);
    return { table: { cells: m.cells, lines: parsed.lines, masked: m.masked }, encoding: dec.encoding, issues };
  },
};

/** PDF の行のうち、明細の行らしいもの（最初の欄が日付・最後の欄が金額）を [日付, 店, 支払い方法, 金額] の表にする */
function pdfFallback(lines: string[][]): { cells: string[][]; lines: number[] } {
  const cells: string[][] = [];
  const at: number[] = [];
  lines.forEach((ln, i) => {
    if (ln.length < 2) return;
    let first = ln[0] as string;
    let rest = ln.slice(1);
    // 「10/03 セブン-イレブン」のように日付と店が1つの欄にくっついたとき
    const glued = /^(\S+)\s+(.+)$/u.exec(first);
    if (parseDate(first, 2000) === null && glued !== null && parseDate(glued[1] as string, 2000) !== null) {
      first = glued[1] as string;
      rest = [glued[2] as string, ...rest];
    }
    const last = rest[rest.length - 1] as string;
    if (parseDate(first, 2000) === null || parseAmount(last) === null || rest.length < 2) return;
    const middle = rest.slice(0, -1);
    const planAt = middle.findIndex((c, k) => k > 0 && c.length <= 8 && parsePlan(c) !== null);
    const plan = planAt >= 0 ? (middle[planAt] as string) : "";
    const merchant = middle.filter((_, k) => k !== planAt && !(k > 0 && parseAmount(middle[k] as string) !== null)).join(" ");
    cells.push([first, merchant, plan, last]);
    at.push(i + 1);
  });
  return { cells, lines: at };
}

export const pdfTextReader: StatementReader = {
  id: "pdfText",
  version: 1,
  label: "PDF（文字の入ったもの）",
  accepts(bytes) {
    return startsWith(bytes, "%PDF") ? 0.95 : 0;
  },
  async table(bytes) {
    let ex: { lines: string[][]; pages: number; chars: number };
    try {
      ex = await extractPdfLines(bytes);
    } catch (e) {
      if (e instanceof PdfError) {
        const msg =
          e.code === "encrypted"
            ? issue("error", "S_PDF_ENCRYPTED", "パスワードのかかった PDF は読めません。パスワードを外して保存し直してから取り込んでください")
            : e.code === "limit"
              ? issue("error", "S_PDF_LIMIT", "PDF が大きすぎるか、ページ・中身が多すぎるため読みませんでした")
              : e.code === "filter"
                ? issue("error", "S_PDF_FILTER", "この PDF の圧縮の形は読めません")
                : issue("error", "S_PDF_BROKEN", "PDF を読めませんでした（壊れているか、PDF ではありません）");
        return { table: { cells: [], lines: [], masked: 0 }, issues: [msg] };
      }
      throw e;
    }
    if (ex.chars === 0) return { table: { cells: [], lines: [], masked: 0 }, issues: [issue("error", "S_PDF_NO_TEXT", "この PDF には文字が入っていません（画像だけの PDF）。写真・スクショの文字の読み取りは今後の版で対応します")] };
    const masked = maskTable(ex.lines);
    const table: Table = { cells: masked.cells, lines: ex.lines.map((_, i) => i + 1), masked: masked.masked };
    const statementDate = findStatementDate(masked.cells);
    const sd = statementDate !== undefined ? { statementDate } : {};
    if (findHeaderRow(table, "card") !== null || findHeaderRow(table, "bank") !== null) return { table, issues: [], ...sd };
    const fb = pdfFallback(masked.cells);
    return {
      table: { cells: fb.cells, lines: fb.lines, masked: masked.masked },
      issues: [],
      fixedMapping: { headerRow: null, columns: { date: 0, merchant: 1, plan: 2, amount: 3 }, sign: "expensePositive" },
      ...sd,
    };
  },
};

/** 明細の見出しの部分に書かれた日付（「2026年10月10日お支払い分」など。表の行より前の行の最初の年月日） */
function findStatementDate(lines: readonly (readonly string[])[]): string | undefined {
  for (const ln of lines.slice(0, 15)) {
    for (const c of ln) {
      const m = /((?:19|20)\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/u.exec(c);
      if (m !== null && ln.length === 1) {
        const d = parseDate(`${m[1] as string}/${m[2] as string}/${m[3] as string}`);
        if (d !== null) return d.date;
      }
    }
  }
  return undefined;
}

/** 段階1の読み手（段階2・3の読み手はここに足す） */
export const DEFAULT_READERS: readonly StatementReader[] = [pdfTextReader, csvReader];

export interface ReadContext {
  readonly kind: SourceKind;
  /** 事務所で覚えた形（見出しの並びの指紋 → 対応付け） */
  readonly formats?: readonly LearnedFormat[];
  /** FP が選んだ対応付け（選び直したとき） */
  readonly mapping?: ColumnMapping;
  /** 年の書かれていない日付の年 */
  readonly yearHint?: number;
  readonly fileName?: string;
  readonly readers?: readonly StatementReader[];
}

export type ReadOutcome =
  | {
      readonly ok: true;
      readonly reader: { readonly id: string; readonly version: number };
      readonly file: { readonly sha256: string; readonly bytes: number };
      readonly encoding?: Encoding;
      /** 番号を消した後の表（対応付けの画面の見本に使う） */
      readonly table: Table;
      readonly mapping: ColumnMapping;
      /** 対応付けの出どころ: FP が選んだ・覚えた形・推し量った・読み手が決めた */
      readonly mappingSource: "fp" | "learned" | "guessed" | "reader";
      readonly fingerprint: string;
      /** FP に対応付けを確かめてもらう（初めての形・推し量りが足りない） */
      readonly needsMapping: boolean;
      readonly rows: readonly ReadRow[];
      readonly skipped: number;
      readonly issues: readonly Issue[];
    }
  | { readonly ok: false; readonly issues: readonly Issue[] };

export async function fileDigest(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return `sha256:${[...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** 明細のファイルを読む（PC の中だけで動く。外に送らない） */
export async function readStatement(bytes: Uint8Array, ctx: ReadContext): Promise<ReadOutcome> {
  if (bytes.length === 0) return { ok: false, issues: [issue("error", "S_FILE_EMPTY", "空のファイルです")] };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, issues: [issue("error", "S_FILE_TOO_LARGE", "ファイルが大きすぎます（10MBまで）。期間を分けて書き出してください")] };
  const readers = ctx.readers ?? DEFAULT_READERS;
  let best: StatementReader | undefined;
  let score = 0;
  for (const r of readers) {
    const s = r.accepts(bytes, ctx.fileName);
    if (s > score) [best, score] = [r, s];
  }
  if (best === undefined) return { ok: false, issues: [issue("error", "S_FORMAT_UNKNOWN", "読めないファイルの形です（CSV か、文字の入った PDF を選んでください）")] };
  const sha256 = await fileDigest(bytes);
  const rt = await best.table(bytes, ctx.kind);
  if (rt.issues.some((i) => i.level === "error")) return { ok: false, issues: rt.issues };
  // 読み手が消していても、もう一度すべての欄を通す（差し替えた読み手が消し忘れても、ここより外へ番号を出さない）
  const again = maskTable(rt.table.cells.map((r) => [...r]));
  const headerGuess = rt.fixedMapping?.headerRow ?? findHeaderRow({ ...rt.table, cells: again.cells }, ctx.kind);
  const nc = maskNumberColumns(again.cells, headerGuess);
  const table: Table = { cells: nc.cells, lines: rt.table.lines, masked: rt.table.masked + again.masked + nc.masked };
  const issues: Issue[] = [...rt.issues];
  if (table.masked > 0) issues.push(issue("info", "S_MASKED", `カード番号・口座番号らしき数字を ${table.masked} か所で消しました（保存しません）`));
  let mapping: ColumnMapping;
  let source: "fp" | "learned" | "guessed" | "reader";
  let fingerprint = await headerFingerprint(table, headerGuess, ctx.kind);
  const learned = ctx.formats?.find((f) => f.fingerprint === fingerprint && f.kind === ctx.kind);
  if (ctx.mapping !== undefined) {
    mapping = ctx.mapping;
    source = "fp";
    fingerprint = await headerFingerprint(table, mapping.headerRow, ctx.kind);
  } else if (rt.fixedMapping !== undefined) {
    mapping = rt.fixedMapping;
    source = "reader";
  } else if (learned !== undefined) {
    mapping = upgradeLearnedMapping(learned.mapping, table, ctx.kind);
    source = "learned";
  } else {
    mapping = guessMapping(table, ctx.kind);
    source = "guessed";
  }
  const width = Math.max(0, ...table.cells.map((r) => r.length));
  const problems = checkMapping(mapping, width);
  if (problems.length > 0) {
    issues.push(issue(source === "fp" ? "error" : "warning", source === "fp" ? "S_MAPPING_INVALID" : "S_MAPPING_NEEDED", problems.join("。")));
    return { ok: true, reader: { id: best.id, version: best.version }, file: { sha256, bytes: bytes.length }, ...(rt.encoding !== undefined ? { encoding: rt.encoding } : {}), table, mapping, mappingSource: source, fingerprint, needsMapping: true, rows: [], skipped: 0, issues };
  }
  const tr = tableToRows(table, mapping, ctx.kind, { ...(ctx.yearHint !== undefined ? { year: ctx.yearHint } : rt.statementDate !== undefined ? { year: Number(rt.statementDate.slice(0, 4)) } : {}), ...(rt.statementDate !== undefined ? { notAfter: rt.statementDate } : {}) });
  issues.push(...tr.issues);
  const needsMapping = source === "guessed" || tr.rows.length === 0;
  return { ok: true, reader: { id: best.id, version: best.version }, file: { sha256, bytes: bytes.length }, ...(rt.encoding !== undefined ? { encoding: rt.encoding } : {}), table, mapping, mappingSource: source, fingerprint, needsMapping, rows: tr.rows, skipped: tr.skipped, issues };
}

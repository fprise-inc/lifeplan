// 文字認識で読める度合いを測る（0034 の段階3。0221）: OS の文字認識の結果（crates/statement-ocr の ocr_measure の JSON）を、架空の明細の正解と比較する。
//   node scripts/ocr-measure.ts <文字認識の結果.json> [--md 表.md] [--json 結果.json] [--lines]
// 画像ごとに次を出す:
// - 文字: 正解の日付・金額・店の名前の文字が、読んだ文字の中にいくつあるか（空白を除き NFKC でそろえて数える。表の形に関係しない読める度合い）
// - 直す前: 読んだ文字の塊を前の組み立て（toLines() → linesToTable。文字の入った PDF の読み手の版 1 と同じ）に通した行を、正解の行と比較する
// - 直した後: アプリと同じ写真・スクショの読み手（src/ocr.ts の createImageReader。傾きを座標で直す・行を上下の中心で・見出しの位置で欄・
//   スマホのスクショの1件が2行・数字の読み違い直し・Windows の英語の読み直し）と readStatement に通した行を、正解の行と比較する。
//   「理想」は描いた文字の塊（文字が完全に読めたとき）を同じ組み立てに通した結果
// - 読み取りが不確かの印: 正しく読めなかった行のうち印の付いた割合（多いほどよい）と、正しく読めた行のうち印の付いた割合（確かめの手間）
// 比較は、正解の行と読んだ行を順番を保って対にし、日付・金額・店の名前がすべて正しい行の割合を出す
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assemble } from "../src/layout.ts";
import { createImageReader, type OcrBox, type OcrPage } from "../src/ocr.ts";
import { toLines, type TextItem } from "../src/pdf/text.ts";
import { csvReader, linesToTable, readStatement, type StatementReader } from "../src/readers.ts";
import type { ReadRow, SourceKind } from "../src/table.ts";

const DIR = join(import.meta.dirname, "..", "test", "fixtures", "ocr");
const YEAR = 2026;

interface OcrReport {
  backend: string;
  /** 読んだ言語（ja: 画面の命令と同じ読み方、en: 英語だけ。比較用） */
  language?: string;
  languages: string[];
  images: { file: string; ms: number; boxes?: OcrBox[]; page?: OcrPage; error?: string }[];
}
interface TruthRow {
  date: string;
  dateText: string;
  merchant: string;
  amountText: string;
  amount: number;
}
interface Truth {
  images: { file: string; doc: string; label: string; pre: string | null; from?: string }[];
  docs: Record<string, { label: string; kind: "card" | "bank" | "invoice"; rows: TruthRow[]; items: TextItem[] }>;
}

/** 画像の幅と高さ（PNG の IHDR・JPEG の SOF） */
export function imageSize(b: Uint8Array): { width: number; height: number } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] === 0x89 && b[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1] as number;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      i += 2 + dv.getUint16(i + 2);
    }
  }
  throw new Error("画像の大きさが分かりません");
}

/** 読んだ文字の塊（左上が原点・割合）を、toLines() の文字の塊（下が 0・上向きが正の画素）にする（直す前の組み立て用） */
function rawItems(boxes: readonly OcrBox[], width: number, height: number): TextItem[] {
  return boxes.map((b) => ({ x: b.x * width, y: (1 - b.y - b.h) * height, width: b.w * width, size: Math.max(1, b.h * height), text: b.text }));
}

// ---- 比較のしかた ----

const norm = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[−‐‑–—]/gu, "-")
    .replace(/\s+/gu, "");

function count(hay: string, needle: string): number {
  if (needle === "") return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** 正解の文字（日付・金額・店）が、完全に読めたときの文字にある数のうち、読んだ文字にもある割合 */
function textRecall(perfect: string, got: string, fields: readonly string[]): number {
  let want = 0;
  let found = 0;
  for (const f of new Set(fields.map(norm))) {
    const e = count(perfect, f);
    want += e;
    found += Math.min(e, count(got, f));
  }
  return want === 0 ? NaN : found / want;
}

function lev(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length] as number;
}
const sim = (a: string, b: string) => {
  const p = norm(a);
  const q = norm(b);
  const m = Math.max([...p].length, [...q].length);
  return m === 0 ? 1 : 1 - lev(p, q) / m;
};

export interface RowScore {
  expected: number;
  got: number;
  /** 正解の行と対にできた行 */
  paired: number;
  date: number;
  amount: number;
  merchant: number;
  /** 日付・金額・店の名前がすべて正しい行 */
  exact: number;
  /** 正しく読めなかった読んだ行（違う値の行・余計な行）と、そのうち「読み取りが不確か」の印のある行 */
  wrong: number;
  wrongFlagged: number;
  /** 正しく読めた行のうち、印のある行 */
  exactFlagged: number;
}

/** 正解の行と読んだ行を、順番を保って対にする（日付の一致1・金額の一致1・店の名前の似ている度合い0〜1。1.5 以上を対にする） */
function compareRows(expected: readonly ReadRow[], got: readonly ReadRow[]): RowScore {
  const score = (e: ReadRow, g: ReadRow) => (e.date === g.date ? 1 : 0) + (e.amount === g.amount ? 1 : 0) + sim(e.merchant, g.merchant);
  const n = expected.length;
  const m = got.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const s = score(expected[i - 1] as ReadRow, got[j - 1] as ReadRow);
      const row = dp[i] as number[];
      const up = dp[i - 1] as number[];
      row[j] = Math.max(up[j] as number, row[j - 1] as number, s >= 1.5 ? (up[j - 1] as number) + s : -Infinity);
    }
  const pairs: [ReadRow, ReadRow][] = [];
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const v = (dp[i] as number[])[j];
    if (v === (dp[i - 1] as number[])[j]) i--;
    else if (v === (dp[i] as number[])[j - 1]) j--;
    else {
      pairs.push([expected[i - 1] as ReadRow, got[j - 1] as ReadRow]);
      i--;
      j--;
    }
  }
  const ok = (e: ReadRow, g: ReadRow) => ({ d: e.date === g.date, a: e.amount === g.amount, m: norm(e.merchant) === norm(g.merchant) });
  const exactPairs = pairs.filter(([e, g]) => Object.values(ok(e, g)).every(Boolean));
  const exactGot = new Set(exactPairs.map(([, g]) => g));
  const wrongGot = got.filter((g) => !exactGot.has(g));
  return {
    expected: n,
    got: m,
    paired: pairs.length,
    date: pairs.filter(([e, g]) => ok(e, g).d).length,
    amount: pairs.filter(([e, g]) => ok(e, g).a).length,
    merchant: pairs.filter(([e, g]) => ok(e, g).m).length,
    exact: exactPairs.length,
    wrong: wrongGot.length,
    wrongFlagged: wrongGot.filter((g) => g.readUncertain === true).length,
    exactFlagged: exactPairs.filter(([, g]) => g.readUncertain === true).length,
  };
}

/** 行と欄を、前の組み立ての後半（linesToTable）と readStatement に通す */
async function readLines(lines: string[][], kind: SourceKind): Promise<readonly ReadRow[]> {
  const reader: StatementReader = { id: "ocrBefore", version: 0, label: "直す前の組み立て", accepts: () => 1, table: async () => linesToTable(lines) };
  const out = await readStatement(new TextEncoder().encode(JSON.stringify(lines)), { kind, readers: [reader], yearHint: YEAR, today: "2026-11-17" });
  return out.ok ? out.rows : [];
}

/** アプリと同じ写真・スクショの読み手に、文字認識の結果を渡して読む */
async function readPage(bytes: Uint8Array, page: OcrPage, kind: SourceKind): Promise<readonly ReadRow[]> {
  const reader = createImageReader(async () => page);
  const out = await readStatement(bytes, { kind, readers: [reader], yearHint: YEAR, today: "2026-11-17" });
  return out.ok ? out.rows : [];
}

/** 正解の行（正解の日付・店・金額を、同じ取り込みの流れ〔番号を消す・振込の相手の名前を外すなど〕で読んだもの） */
async function truthRows(rows: readonly TruthRow[], kind: SourceKind): Promise<readonly ReadRow[]> {
  const q = (s: string) => `"${s.replace(/"/gu, '""')}"`;
  const csv = ["日付,内容,金額", ...rows.map((r) => [r.date, q(r.merchant), String(r.amount)].join(","))].join("\n");
  const out = await readStatement(new TextEncoder().encode(csv), { kind, readers: [csvReader], mapping: { headerRow: 0, columns: { date: 0, merchant: 1, amount: 2 }, sign: "expensePositive" } });
  if (!out.ok || out.rows.length !== rows.length) throw new Error("正解の行を読めません");
  return out.rows;
}

/** 描いた文字の塊（下が 0 の画素）を、文字認識の結果の形（割合・左上が原点。確からしさ 1）にする（理想） */
function perfectPage(items: readonly TextItem[], width: number, height: number, engine: string): OcrPage {
  return { width, height, engine, boxes: items.map((i) => ({ text: i.text, x: i.x / width, y: 1 - (i.y + i.size) / height, w: i.width / width, h: i.size / height, conf: 1 })) };
}

export interface ImageResult {
  file: string;
  label: string;
  pre: string | null;
  rows: number;
  ms: number | null;
  error?: string;
  text: { date: number; amount: number; merchant: number };
  /** 直す前（toLines → linesToTable） */
  before?: RowScore;
  /** 直した後（アプリの読み手）。ideal は文字が完全に読めたとき */
  after?: { ideal: RowScore; read: RowScore };
}

const pct = (x: number) => (Number.isNaN(x) ? "—" : `${Math.round(x * 100)}%`);
const rate = (s: RowScore, k: "exact" | "date" | "amount" | "merchant") => pct(s[k] / s.expected);
const miss = (s: RowScore) => pct((s.expected - s.paired) / s.expected);
const flagged = (s: RowScore) => `${s.wrong === 0 ? "—" : `${s.wrongFlagged}/${s.wrong}`}・${s.exact === 0 ? "—" : `${s.exactFlagged}/${s.exact}`}`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const reportPath = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--md" && args[i - 1] !== "--json");
  if (reportPath === undefined) throw new Error("文字認識の結果の JSON を渡してください");
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as OcrReport;
  const truth = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8")) as Truth;
  const results: ImageResult[] = [];
  for (const img of truth.images) {
    const doc = truth.docs[img.doc];
    if (doc === undefined) continue;
    const kind: SourceKind = doc.kind === "bank" ? "bank" : "card";
    const perfectLines = toLines(doc.items);
    const perfect = perfectLines.map((l) => norm(l.join(""))).join("\n");
    const ocr = report.images.find((r) => r.file === img.file);
    const base = { file: img.file, label: img.label, pre: img.pre, rows: doc.rows.length };
    if (ocr === undefined || ocr.boxes === undefined) {
      results.push({ ...base, ms: ocr?.ms ?? null, error: ocr?.error ?? "結果なし", text: { date: NaN, amount: NaN, merchant: NaN } });
      continue;
    }
    const bytes = new Uint8Array(readFileSync(join(DIR, img.file)));
    const { width, height } = imageSize(bytes);
    const lines = toLines(rawItems(ocr.boxes, width, height));
    const got = lines.map((l) => norm(l.join(""))).join("\n");
    const r: ImageResult = {
      ...base,
      ms: ocr.ms,
      text: {
        date: textRecall(perfect, got, doc.rows.map((x) => x.dateText)),
        amount: textRecall(perfect, got, doc.rows.map((x) => x.amountText)),
        merchant: textRecall(perfect, got, doc.rows.map((x) => x.merchant)),
      },
    };
    const page: OcrPage = ocr.page ?? { width, height, engine: report.backend, boxes: ocr.boxes };
    if (args.includes("--lines")) {
      console.log(`--- ${img.file}（直す前）\n${lines.map((l) => l.join(" | ")).join("\n")}`);
      const a = assemble(rawItems(page.boxes, width, height), kind, { deskew: true, joinSpace: true });
      console.log(`--- ${img.file}（直した後の組み立て・傾き ${a.angle}度）\n${a.lines.map((l) => l.join(" | ")).join("\n")}`);
    }
    if (doc.kind !== "invoice") {
      const want = await truthRows(doc.rows, kind);
      // 理想: 描いた文字の塊は、前処理の前の画像の大きさの座標
      const src = img.from ?? img.file;
      const size = imageSize(new Uint8Array(readFileSync(join(DIR, src))));
      r.before = compareRows(want, await readLines(lines, kind));
      r.after = { ideal: compareRows(want, await readPage(bytes, perfectPage(doc.items, size.width, size.height, report.backend), kind)), read: compareRows(want, await readPage(bytes, page, kind)) };
    }
    results.push(r);
  }
  const md = [
    `文字認識: ${report.backend}・読んだ言語: ${report.language === "en" ? "英語だけ（比較用）" : "日本語（画面の命令と同じ。Windows は英語でもう1回読んだ数字も使う）"}（OS が読める言語のうち日本語・英語: ${report.languages.filter((l) => /^(ja|en)/iu.test(l)).join("・") || "なし"}）`,
    "",
    "文字＝正解の文字が読んだ文字の中にある割合（日本語の1回目の読み）。表＝日付・金額・店の名前がすべて正しい行の割合（理想＝文字が完全に読めたとき）。取りこぼし＝正解の行と対にできなかった割合。印＝正しく読めなかった行のうち「読み取りが不確か」の印のある行・正しく読めた行のうち印のある行",
    "",
    "| 画像 | 件数 | 文字: 日付 | 文字: 金額 | 文字: 店 | 直す前 | 直した後: 理想 | 直した後 | 取りこぼし | 日付 | 金額 | 店 | 印（誤り・正しい） | 時間 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...results.map((r) => {
      if (r.error !== undefined) return `| ${r.label} | ${r.rows} | 読めない（${r.error}） | | | | | | | | | | | |`;
      const b = r.before;
      const a = r.after;
      const tab = b === undefined || a === undefined ? "（請求書。表の形ではない。次の作業） | | | | | | | |" : `${rate(b, "exact")} | ${rate(a.ideal, "exact")} | ${rate(a.read, "exact")} | ${miss(a.read)} | ${rate(a.read, "date")} | ${rate(a.read, "amount")} | ${rate(a.read, "merchant")} | ${flagged(a.read)} |`;
      return `| ${r.label} | ${r.rows} | ${pct(r.text.date)} | ${pct(r.text.amount)} | ${pct(r.text.merchant)} | ${tab} ${r.ms ?? ""}ms |`;
    }),
  ].join("\n");
  console.log(md);
  const mdPath = opt("--md");
  if (mdPath !== undefined) writeFileSync(mdPath, md + "\n");
  const jsonPath = opt("--json");
  if (jsonPath !== undefined) writeFileSync(jsonPath, JSON.stringify({ backend: report.backend, language: report.language ?? "ja", languages: report.languages, results }, null, 1) + "\n");
}

await main();

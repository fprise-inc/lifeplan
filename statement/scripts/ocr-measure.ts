// 文字認識の試し（0034 の段階3）: OS の文字認識の結果（crates/statement-ocr の ocr_measure の JSON）を、架空の明細の正解と比べる。
//   node scripts/ocr-measure.ts <文字認識の結果.json> [--md 表.md] [--json 結果.json] [--lines]
// 画像ごとに次を出す:
// - 文字: 正解の日付・金額・店の名前の文字が、読んだ文字の中にいくつあるか（空白を除き NFKC でそろえて数える。表の形に関係しない読める度合い）
// - 表（今の組み立て）: 読んだ文字の塊を toLines() で行と欄にし、PDF と同じ読み手の後半（linesToTable）と readStatement に通した行を、
//   正解の行（正解の日付・店・金額を同じ取り込みの流れで読んだもの）と比べる。「理想」は描いた文字の塊（文字が完全に読めたとき）を通した結果
// - 表（組み立ての試し）: 次の PR の読み手の候補として、(1) 文字の塊の並びから傾きを推し量って座標を回す、(2) 行は塊の上下の中心でまとめる、
//   (3) 見出しの行の塊の位置で欄を決め、各行の塊を重なる欄に入れる（空の欄を詰めない）、を足した組み立て（src/ には入れない。ここだけの試し）
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toLines, type TextItem } from "../src/pdf/text.ts";
import { csvReader, linesToTable, readStatement, type StatementReader } from "../src/readers.ts";
import { findHeaderRow, type ReadRow, type SourceKind } from "../src/table.ts";

const DIR = join(import.meta.dirname, "..", "test", "fixtures", "ocr");
const YEAR = 2026;

interface OcrBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf?: number;
}
interface OcrReport {
  backend: string;
  /** 読んだ言語（ja: 日本語と英数字、en: 英語だけ。比べ用） */
  language?: string;
  languages: string[];
  images: { file: string; ms: number; boxes?: OcrBox[]; error?: string }[];
}
interface TruthRow {
  date: string;
  dateText: string;
  merchant: string;
  amountText: string;
  amount: number;
}
interface Truth {
  images: { file: string; doc: string; label: string; pre: string | null }[];
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

/** 読んだ文字の塊（左上が原点・割合）を、toLines() の文字の塊（下が 0・上向きが正の画素）にする */
export function boxesToItems(boxes: readonly OcrBox[], width: number, height: number): TextItem[] {
  return boxes.map((b) => ({ x: b.x * width, y: (1 - b.y - b.h) * height, width: b.w * width, size: Math.max(1, b.h * height), text: b.text }));
}

// ---- 組み立ての試し ----

/** 文字の塊の中心の並びから傾きを推し量り（-6〜6度・0.1度ごと。行の高さの半分の幅で数えた幅の二乗の和が最大の角度）、座標を回して返す */
export function deskewItems(items: readonly TextItem[]): { items: TextItem[]; angle: number } {
  if (items.length < 4) return { items: [...items], angle: 0 };
  const sizes = items.map((i) => i.size).sort((a, b) => a - b);
  const bin = Math.max(1, (sizes[Math.floor(sizes.length / 2)] as number) * 0.5);
  const centers = items.map((i) => ({ x: i.x + i.width / 2, y: i.y + i.size / 2, w: i.width }));
  let best = 0;
  let bestScore = -1;
  for (let k = -60; k <= 60; k++) {
    const t = ((k / 10) * Math.PI) / 180;
    const hist = new Map<number, number>();
    for (const c of centers) {
      const b = Math.round((c.y * Math.cos(t) - c.x * Math.sin(t)) / bin);
      hist.set(b, (hist.get(b) ?? 0) + c.w);
    }
    let score = 0;
    for (const v of hist.values()) score += v * v;
    // 同じ点数なら 0 度に近い方
    if (score > bestScore * (1 + 1e-9) || (score >= bestScore * (1 - 1e-9) && Math.abs(k / 10) < Math.abs(best))) [best, bestScore] = [k / 10, Math.max(score, bestScore)];
  }
  const t = (best * Math.PI) / 180;
  const rot = items.map((i) => {
    const cx = i.x + i.width / 2;
    const cy = i.y + i.size / 2;
    const x = cx * Math.cos(t) + cy * Math.sin(t);
    const y = cy * Math.cos(t) - cx * Math.sin(t);
    return { ...i, x: x - i.width / 2, y: y - i.size / 2 };
  });
  return { items: rot, angle: best };
}

/** 文字の塊を行にまとめる（上下の中心が、その行の中心から高さの半分以内なら同じ行。字の上下の出っ張りで箱の下端がずれても分けない） */
function groupLines(items: readonly TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y + b.size / 2 - (a.y + a.size / 2) || a.x - b.x);
  const lines: { cy: number; size: number; items: TextItem[] }[] = [];
  for (const it of sorted) {
    const cy = it.y + it.size / 2;
    const last = lines[lines.length - 1];
    if (last !== undefined && Math.abs(last.cy - cy) <= Math.max(last.size, it.size) * 0.5) {
      last.items.push(it);
      last.cy = last.items.reduce((s, i) => s + i.y + i.size / 2, 0) / last.items.length;
      last.size = Math.max(last.size, it.size);
    } else lines.push({ cy, size: it.size, items: [it] });
  }
  return lines.map((l) => l.items.sort((a, b) => a.x - b.x));
}

/** 組み立ての試し: 傾きを直し、行をまとめ、見出しの行の塊の位置で欄を決めて、各行の塊を重なりのいちばん大きい欄（重ならなければいちばん近い欄）に入れる */
export function assembleByColumns(items: readonly TextItem[], kind: SourceKind): { lines: string[][]; angle: number } {
  const { items: rot, angle } = deskewItems(items);
  const lines = groupLines(rot);
  // 行の中は、今と同じ横の隙間で欄に分ける（見出しの行と、見出しより前の行）
  const gapCells = lines.map((l) => toLines(l.map((i) => ({ ...i, y: 0 })))[0] ?? []);
  const h = findHeaderRow({ cells: gapCells, lines: gapCells.map((_, i) => i + 1), masked: 0 }, kind);
  if (h === null) return { lines: gapCells, angle };
  const head = lines[h] as TextItem[];
  const bands = head.map((i) => [i.x, i.x + i.width] as const);
  const out = gapCells.map((cells, i) => {
    if (i < h) return cells;
    if (i === h) return head.map((it) => it.text);
    const cols: string[] = bands.map(() => "");
    for (const it of lines[i] as TextItem[]) {
      let at = 0;
      let bestScore = -Infinity;
      bands.forEach(([a, b], k) => {
        const overlap = Math.min(b, it.x + it.width) - Math.max(a, it.x);
        const score = overlap > 0 ? overlap : -Math.abs((a + b) / 2 - (it.x + it.width / 2));
        if (score > bestScore) [at, bestScore] = [k, score];
      });
      cols[at] = cols[at] === "" ? it.text : `${cols[at] as string} ${it.text}`;
    }
    return cols;
  });
  return { lines: out, angle };
}

// ---- 比べ方 ----

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
  /** 対にできた行の、店の名前の文字の一致の度合い（1 − 編集距離 ÷ 長さ）の平均 */
  merchantSim: number;
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
  return {
    expected: n,
    got: m,
    paired: pairs.length,
    date: pairs.filter(([e, g]) => ok(e, g).d).length,
    amount: pairs.filter(([e, g]) => ok(e, g).a).length,
    merchant: pairs.filter(([e, g]) => ok(e, g).m).length,
    exact: pairs.filter(([e, g]) => Object.values(ok(e, g)).every(Boolean)).length,
    merchantSim: pairs.length === 0 ? NaN : pairs.reduce((s, [e, g]) => s + sim(e.merchant, g.merchant), 0) / pairs.length,
  };
}

/** 行と欄を、PDF の読み手の後半（linesToTable）と readStatement に通す */
async function readRows(lines: string[][], kind: SourceKind): Promise<readonly ReadRow[]> {
  const reader: StatementReader = { id: "ocrTrial", version: 0, label: "文字認識の試し", accepts: () => 1, table: async () => linesToTable(lines) };
  const out = await readStatement(new TextEncoder().encode(JSON.stringify(lines)), { kind, readers: [reader], yearHint: YEAR, today: "2026-11-17" });
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

export interface ImageResult {
  file: string;
  label: string;
  pre: string | null;
  rows: number;
  ms: number | null;
  error?: string;
  text: { date: number; amount: number; merchant: number };
  /** 今の組み立て（toLines → linesToTable）。ideal は文字が完全に読めたとき */
  current?: { ideal: RowScore; read: RowScore };
  /** 組み立ての試し（傾き・行・見出しの位置の欄） */
  trial?: { ideal: RowScore; read: RowScore; angle: number };
}

const pct = (x: number) => (Number.isNaN(x) ? "—" : `${Math.round(x * 100)}%`);
const rate = (s: RowScore, k: "exact" | "date" | "amount" | "merchant") => pct(s[k] / s.expected);
const miss = (s: RowScore) => pct((s.expected - s.paired) / s.expected);

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
    const { width, height } = imageSize(readFileSync(join(DIR, img.file)));
    const items = boxesToItems(ocr.boxes, width, height);
    const lines = toLines(items);
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
    const asm = assembleByColumns(items, kind);
    if (args.includes("--lines")) {
      console.log(`--- ${img.file}（今の組み立て）\n${lines.map((l) => l.join(" | ")).join("\n")}`);
      console.log(`--- ${img.file}（組み立ての試し・傾き ${asm.angle}度）\n${asm.lines.map((l) => l.join(" | ")).join("\n")}`);
    }
    if (doc.kind !== "invoice") {
      const want = await truthRows(doc.rows, kind);
      r.current = { ideal: compareRows(want, await readRows(perfectLines, kind)), read: compareRows(want, await readRows(lines, kind)) };
      r.trial = { ideal: compareRows(want, await readRows(assembleByColumns(doc.items, kind).lines, kind)), read: compareRows(want, await readRows(asm.lines, kind)), angle: asm.angle };
    }
    results.push(r);
  }
  const md = [
    `文字認識: ${report.backend}・読んだ言語: ${report.language === "en" ? "英語だけ（比べ用）" : "日本語"}（OS が読める言語のうち日本語・英語: ${report.languages.filter((l) => /^(ja|en)/iu.test(l)).join("・") || "なし"}）`,
    "",
    "文字＝正解の文字が読んだ文字の中にある割合。表＝日付・金額・店の名前がすべて正しい行の割合（理想＝文字が完全に読めたとき）。取りこぼし＝正解の行と対にできなかった割合",
    "",
    "| 画像 | 件数 | 文字: 日付 | 文字: 金額 | 文字: 店 | 今の組み立て: 理想 | 今の組み立て: 読んだ | 試し: 理想 | 試し: 読んだ | 試し: 取りこぼし | 試し: 日付 | 試し: 金額 | 試し: 店 | 時間 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...results.map((r) => {
      if (r.error !== undefined) return `| ${r.label} | ${r.rows} | 読めない（${r.error}） | | | | | | | | | | | |`;
      const c = r.current;
      const t = r.trial;
      const tab = c === undefined || t === undefined ? "（請求書。表の形ではない） | | | | | | | |" : `${rate(c.ideal, "exact")} | ${rate(c.read, "exact")} | ${rate(t.ideal, "exact")} | ${rate(t.read, "exact")} | ${miss(t.read)} | ${rate(t.read, "date")} | ${rate(t.read, "amount")} | ${rate(t.read, "merchant")} |`;
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

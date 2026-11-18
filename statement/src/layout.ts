// 位置つきの文字の塊を、行と欄にまとめる（0034 の3。文字の入った PDF と、写真・スクショの文字認識の結果で同じ組み立てを使う）。
// - 行: 塊の上下の中心でまとめる（字の上下の出っ張りや、字の大きさの違いで箱の下端がずれても分けない）
// - 欄: 見出しの行（使った日・店・金額などの言葉が2つ以上ある行）が見つかれば、見出しの塊の位置で欄を決め、各行の塊を重なる欄に入れる
//   （空の欄を詰めない。銀行の明細の出金・入金のどちらかが空でも列がずれない）。見出しどうしが近くても、見出しの言葉ごとに欄を分ける
// - 見出しが無ければ、今までどおり横の隙間で欄に分ける（PDF の読み手の「最初の欄が日付・最後の欄が金額」の行に乗る）
// - 傾き（写真・スキャン）: 塊の中心の並びから角度を推し量り、座標を回してから行にまとめる（画像は回さない）。文字の入った PDF は傾かないので回さない
// - 複数のページ: 見出しのあるページの欄の位置を、見出しの無い次のページにも使う
import type { TextItem } from "./pdf/text.ts";
import { findHeaderRow, splitHeaderWords, type SourceKind, type Table } from "./table.ts";

/** 文字の塊（PDF の座標: 下が 0・上向きが正。y は塊の下端、size は字の高さ） */
export interface LayoutItem extends TextItem {
  /** 文字認識の確からしさ（0〜1。無ければ 1） */
  readonly conf?: number;
  /** 読み違えを直した・2回の読みが食い違った（読み取りが不確か） */
  readonly doubt?: boolean;
  /** 2回の読み（日本語と英語）が同じだった数字 */
  readonly agree?: boolean;
}

/** 欄ごとの読み取りの確かさ（文字の入った PDF はすべて確か） */
export interface CellMeta {
  /** 欄に入った塊の確からしさのいちばん低い値 */
  readonly conf: number;
  /** 欄に、直した・食い違った塊がある */
  readonly doubt: boolean;
  /** 欄のすべての塊が、2回の読みで同じだった（Windows の数字） */
  readonly agree: boolean;
}

export interface Layout {
  readonly lines: string[][];
  readonly meta: CellMeta[][];
  /** 推し量った傾き（度） */
  readonly angle: number;
  /** 欄の位置を決めた見出しの行（lines の中の位置。無ければ null） */
  readonly header: number | null;
  /** 見出しの塊の位置（次のページに使う） */
  readonly bands: readonly Band[] | null;
}

export interface Band {
  readonly x0: number;
  readonly x1: number;
}

export interface LayoutOptions {
  /** 傾きを推し量って座標を回す（写真・スキャン） */
  readonly deskew?: boolean;
  /** 塊をつなぐとき、離れた塊の間に空白をはさむ（文字認識の結果。PDF は文字の空白をそのまま使う） */
  readonly joinSpace?: boolean;
  /** 見出しの無いページに使う欄の位置（前のページの見出しから） */
  readonly bands?: readonly Band[] | null;
}

const SURE: CellMeta = { conf: 1, doubt: false, agree: true };

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : (s[Math.floor(s.length / 2)] as number);
};

/** 傾きを推し量る（-6〜6度・0.1度ごと。字の高さの半分の幅で数えた、塊の幅の二乗の和が最大の角度。同じなら 0 度に近い方） */
export function estimateSkew(items: readonly TextItem[]): number {
  if (items.length < 4) return 0;
  const bin = Math.max(1, median(items.map((i) => i.size)) * 0.5);
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
    const a = k / 10;
    if (score > bestScore * (1 + 1e-9) || (score >= bestScore * (1 - 1e-9) && Math.abs(a) < Math.abs(best))) [best, bestScore] = [a, Math.max(score, bestScore)];
  }
  return best;
}

/** 座標を回す（塊の中心を回し、幅と高さはそのまま） */
export function rotateItems<T extends TextItem>(items: readonly T[], angle: number): T[] {
  if (angle === 0) return [...items];
  const t = (angle * Math.PI) / 180;
  return items.map((i) => {
    const cx = i.x + i.width / 2;
    const cy = i.y + i.size / 2;
    const x = cx * Math.cos(t) + cy * Math.sin(t);
    const y = cy * Math.cos(t) - cx * Math.sin(t);
    return { ...i, x: x - i.width / 2, y: y - i.size / 2 };
  });
}

/** 行にまとめる（上から。上下の中心が、その行の中心から字の高さの半分以内なら同じ行）。行の中は左から */
export function groupLines<T extends TextItem>(items: readonly T[]): T[][] {
  const sorted = [...items].sort((a, b) => b.y + b.size / 2 - (a.y + a.size / 2) || a.x - b.x);
  const lines: { cy: number; size: number; items: T[] }[] = [];
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

interface Chunk {
  readonly items: LayoutItem[];
  readonly x0: number;
  readonly x1: number;
}

/** 1行を横の隙間で欄に分ける（隙間が字の高さの 0.9 倍を超えたら別の欄。toLines と同じ） */
function chunks(line: readonly LayoutItem[], gapRatio = 0.9): Chunk[] {
  const out: { items: LayoutItem[]; x0: number; x1: number }[] = [];
  for (const it of line) {
    const last = out[out.length - 1];
    if (last !== undefined && it.x - last.x1 <= it.size * gapRatio) {
      last.items.push(it);
      last.x1 = Math.max(last.x1, it.x + it.width);
    } else out.push({ items: [it], x0: it.x, x1: it.x + it.width });
  }
  return out;
}

const isWide = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  return c > 0x24f && !(c >= 0xff61 && c <= 0xff9f);
};

/** 空白を含む塊（文字認識が1つの塊で返した、欄をまたぐ文字）を、空白の前後で分ける。位置は字の数（全角は1、半角は0.5）で割り振る */
export function splitAtSpaces(it: LayoutItem): LayoutItem[] {
  const parts = it.text.split(/(\s+)/u).filter((p) => p !== "");
  if (parts.filter((p) => p.trim() !== "").length < 2) return [it];
  const w = (s: string) => [...s].reduce((n, ch) => n + (isWide(ch) ? 1 : 0.5), 0);
  const total = w(it.text) || 1;
  const out: LayoutItem[] = [];
  let at = 0;
  for (const p of parts) {
    const pw = (w(p) / total) * it.width;
    if (p.trim() !== "") out.push({ ...it, x: it.x + at, width: pw, text: p });
    at += pw;
  }
  return out;
}

/** 塊をつないだ文字（離れた塊の間に空白をはさむかは joinSpace） */
function joinItems(items: readonly LayoutItem[], joinSpace: boolean): string {
  let s = "";
  let end = -Infinity;
  for (const it of items) {
    if (s !== "" && joinSpace && it.x - end > it.size * 0.25 && !/\s$/u.test(s) && !/^\s/u.test(it.text)) s += " ";
    s += it.text;
    end = Math.max(end, it.x + it.width);
  }
  return s.trim();
}

function metaOf(items: readonly LayoutItem[]): CellMeta {
  if (items.length === 0) return SURE;
  return {
    conf: Math.min(...items.map((i) => i.conf ?? 1)),
    doubt: items.some((i) => i.doubt === true),
    agree: items.every((i) => i.agree !== false),
  };
}

/**
 * 見出しの行の塊から欄の位置を決める（見出しの言葉ごと）。1字ずつの塊（PDF）は、隙間が字の高さの半分を超えたら別の見出し。
 * 文字認識の塊（1つの塊が語）はつながない。近い見出しが1つの塊になっていたら（「ご利用日ご利用店名」）、見出しの言葉ごとに分ける
 */
function headerBands(line: readonly LayoutItem[], ocr: boolean): { bands: Band[]; texts: string[] } {
  const pieces = line.flatMap(splitAtSpaces).sort((a, b) => a.x - b.x);
  const groups = chunks(pieces, ocr ? 0 : 0.5);
  const bands: Band[] = [];
  const texts: string[] = [];
  for (const g of groups) {
    const text = joinItems(g.items, false);
    const parts = splitHeaderWords(text);
    if (parts === null) {
      bands.push({ x0: g.x0, x1: g.x1 });
      texts.push(text);
      continue;
    }
    const total = parts.reduce((n, p) => n + [...p].length, 0);
    let at = g.x0;
    for (const p of parts) {
      const w = ((g.x1 - g.x0) * [...p].length) / total;
      bands.push({ x0: at, x1: at + w });
      texts.push(p);
      at += w;
    }
  }
  return { bands, texts };
}

/** 塊を入れる欄（重なりのいちばん大きい欄。どれにも重ならなければ、いちばん近い欄） */
function bandOf(bands: readonly Band[], x0: number, x1: number): number {
  let at = 0;
  let best = -Infinity;
  bands.forEach((b, k) => {
    const overlap = Math.min(b.x1, x1) - Math.max(b.x0, x0);
    const score = overlap > 0 ? overlap : -Math.max(b.x0 - x1, x0 - b.x1, 0);
    if (score > best) [at, best] = [k, score];
  });
  return at;
}

/** 塊が重なる欄（重なりのいちばん大きい欄。どれにも重ならなければ null） */
function overlapBand(bands: readonly Band[], x0: number, x1: number): number | null {
  let at: number | null = null;
  let best = 0;
  bands.forEach((b, k) => {
    const overlap = Math.min(b.x1, x1) - Math.max(b.x0, x0);
    if (overlap > best) [at, best] = [k, overlap];
  });
  return at;
}

/** 1行を見出しの欄に入れる。1つの欄にしか入らない行（表の外の文字）は、1つの欄の行のまま返す */
function banded(line: readonly LayoutItem[], bands: readonly Band[], joinSpace: boolean): { cells: string[]; meta: CellMeta[] } {
  const cols: LayoutItem[][] = bands.map(() => []);
  // 欄の中で、元の隙間の欄（chunk）ごとにまとめて空白でつなぐ
  const cellChunks: LayoutItem[][][] = bands.map(() => []);
  for (const c of chunks(line)) {
    // 空白をはさんだ塊は、空白の前後が別の欄の見出しに重なるときだけ分ける（見出しに重ならない所は、前の所と同じ欄）
    const pieces: { it: LayoutItem; k: number }[] = c.items.flatMap((it) => {
      const k0 = bandOf(bands, it.x, it.x + it.width);
      const split = splitAtSpaces(it);
      const over = split.map((p) => overlapBand(bands, p.x, p.x + p.width));
      if (split.length < 2 || new Set(over.filter((k) => k !== null)).size < 2) return [{ it, k: k0 }];
      let last = over.find((k) => k !== null) as number;
      return split.map((p, i) => {
        last = over[i] ?? last;
        return { it: p, k: last };
      });
    });
    let cur: { k: number; items: LayoutItem[] } | null = null;
    for (const { it: p, k } of pieces) {
      if (cur === null || cur.k !== k) {
        cur = { k, items: [] };
        (cellChunks[k] as LayoutItem[][]).push(cur.items);
      }
      cur.items.push(p);
      (cols[k] as LayoutItem[]).push(p);
    }
  }
  const filled = cols.filter((c) => c.length > 0).length;
  if (filled <= 1) {
    const all = [...line];
    return { cells: [joinItems(all, joinSpace)].filter((t) => t !== ""), meta: [metaOf(all)] };
  }
  return {
    cells: cellChunks.map((cs) => cs.map((items) => joinItems(items, joinSpace)).filter((t) => t !== "").join(" ")),
    meta: cols.map(metaOf),
  };
}

/** 1ページの文字の塊を、行と欄にする */
export function assemble(items: readonly LayoutItem[], kind: SourceKind, opts: LayoutOptions = {}): Layout {
  const joinSpace = opts.joinSpace === true;
  const angle = opts.deskew === true ? estimateSkew(items) : 0;
  const lines = groupLines(rotateItems(items, angle));
  const gap = lines.map((l) => chunks(l));
  const gapCells = gap.map((cs) => cs.map((c) => joinItems(c.items, joinSpace)).filter((t) => t !== ""));
  const gapMeta = gap.map((cs) => cs.filter((c) => joinItems(c.items, joinSpace) !== "").map((c) => metaOf(c.items)));
  const table: Table = { cells: gapCells, lines: gapCells.map((_, i) => i + 1), masked: 0 };
  const other: SourceKind = kind === "bank" ? "card" : "bank";
  const h = findHeaderRow(table, kind) ?? findHeaderRow(table, other);
  let bands: readonly Band[] | null = null;
  let headerTexts: string[] | null = null;
  if (h !== null) {
    const hb = headerBands(lines[h] as LayoutItem[], joinSpace);
    if (hb.bands.length >= 2) [bands, headerTexts] = [hb.bands, hb.texts];
  }
  const use = bands ?? (opts.bands !== undefined && opts.bands !== null && opts.bands.length >= 2 ? opts.bands : null);
  if (use === null) return { lines: gapCells, meta: gapMeta, angle, header: null, bands: null };
  const start = bands !== null ? (h as number) : -1;
  const outLines: string[][] = [];
  const outMeta: CellMeta[][] = [];
  lines.forEach((l, i) => {
    if (i < start) {
      outLines.push(gapCells[i] as string[]);
      outMeta.push(gapMeta[i] as CellMeta[]);
    } else if (i === start) {
      outLines.push(headerTexts as string[]);
      outMeta.push((headerTexts as string[]).map(() => SURE));
    } else {
      const b = banded(l, use, joinSpace);
      outLines.push(b.cells);
      outMeta.push(b.meta);
    }
  });
  return { lines: outLines, meta: outMeta, angle, header: bands !== null ? h : null, bands: use };
}

/** 複数のページを、行と欄にする（見出しのあるページの欄の位置を、見出しの無い次のページにも使う） */
export function assemblePages(pages: readonly (readonly LayoutItem[])[], kind: SourceKind, opts: Omit<LayoutOptions, "bands"> = {}): { lines: string[][]; meta: CellMeta[][]; angles: number[]; header: boolean } {
  const lines: string[][] = [];
  const meta: CellMeta[][] = [];
  const angles: number[] = [];
  let carry: readonly Band[] | null = null;
  let header = false;
  for (const items of pages) {
    const l = assemble(items, kind, { ...opts, bands: carry });
    if (l.header !== null) {
      carry = l.bands;
      header = true;
    }
    lines.push(...l.lines);
    meta.push(...l.meta);
    angles.push(l.angle);
  }
  return { lines, meta, angles, header };
}

// 明細の写真・スクショ・画像だけの PDF の読み手（0034 の段階3。設計は 0221）。
// - 文字を読むのは OS の文字認識（macOS は Vision、Windows は Windows.Media.Ocr）で、アプリ本体が PC の中で行う。この部品は OS を呼ばない:
//   読む関数（OcrFn）を外から受け取り、読んだ文字の塊（位置つき）を行と欄にして、今の読み手の流れ（linesToTable → readStatement）に乗せる。
//   画像のバイト列も読んだ文字も、外へ送らない
// - 数字の読み違いを直す: 英字の O・I・l を 0・1 に（日付・金額・支払い方法として読める形になるときだけ）、「数字.3桁」を「数字,3桁」に
// - Windows は同じ画像を英語でもう1回読み（アプリ本体が行う）、数字の塊は英語の読みを使う。2回の読みが食い違った数字は「読み取りが不確か」
// - 番号を消すのは英字の O・I・l も数字とみなす形（maskCellLoose。消し過ぎの側に倒す）。readStatement でももう一度通す
// - 「読み取りが不確か」の行（迷う行）: 直した・食い違った数字、確からしさの低い文字、読めない字のある行。Windows の写真・スキャンは、
//   2回の読みで同じにならなかった数字のある行すべて（確かめを強める）
// - 形の違う明細: 見出しのある表・見出しの無い「日付…金額」の行・スマホのスクショ（1件が2行: 店と金額、その下に日付）を読み分ける
import { issue, type Issue } from "./issues.ts";
import { assemblePages, type CellMeta, type LayoutItem } from "./layout.ts";
import { merchantKey } from "./merchant.ts";
import { linesToTable, type ReaderTable, type StatementReader } from "./readers.ts";
import type { ColumnMapping, ReadRow, SourceKind } from "./table.ts";
import { DATE_LIKE, maskCellLoose } from "./text/mask.ts";
import { nfkc } from "./text/normalize.ts";
import { parseAmount, parseDate, parsePlan, type PaymentPlan } from "./text/values.ts";

/** 読んだ文字の塊（位置は画像の幅・高さに対する 0〜1 の割合。左上が原点・下向きが正） */
export interface OcrBox {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 確からしさ（0〜1。Vision だけ） */
  readonly conf?: number;
}

/** 1枚の画像を読んだ結果（アプリ本体の命令 statement_ocr が返す形） */
export interface OcrPage {
  /** 画像の幅・高さ（画素。写真の向きを直した後） */
  readonly width: number;
  readonly height: number;
  /** どの文字認識か（vision・windows-media-ocr など。記録・確かめの強さに使う） */
  readonly engine: string;
  /** 日本語で読んだ塊 */
  readonly boxes: readonly OcrBox[];
  /** 英語でもう1回読んだ塊（Windows だけ。数字の読み直しに使う） */
  readonly digits?: readonly OcrBox[];
}

/** 画像を読む関数（アプリ本体の命令を呼ぶ。読めないときは OcrFailure を投げる） */
export type OcrFn = (image: Uint8Array) => Promise<OcrPage>;

/** 画像だけの PDF をページごとの画像（PNG など）にする関数（画面が pdf.js で描く） */
export type RasterizeFn = (pdf: Uint8Array, maxPages: number) => Promise<{ readonly pages: readonly Uint8Array[]; readonly total: number }>;

/** 読めなかった理由（アプリ本体のコード: E_OCR_UNSUPPORTED・E_OCR_NO_LANGUAGE・E_OCR_OLD_MAC・E_OCR_IMAGE・E_OCR_TOO_LARGE・E_OCR_FAILED） */
export class OcrFailure extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** 画像だけの PDF で読むページの上限 */
export const MAX_SCAN_PAGES = 30;
/** 「読み取りが不確か」にする確からしさ（Vision の値。これより低い文字のある行） */
export const CONF_MIN = 0.5;
/** 小さい字と知らせる字の高さ（画素） */
export const SMALL_TEXT_PX = 14;

export type ImageType = "png" | "jpeg" | "heic" | "bmp" | "tiff" | "gif";
/** 写真か、スクショか、スキャン（画像だけの PDF）か。読み取りの確かめの強さを変える */
export type ImageSource = "screenshot" | "photo" | "scan";

/** 画像の形（先頭の印で見分ける。アプリ本体の statement-ocr と同じ） */
export function imageType(b: Uint8Array): ImageType | null {
  const at = (s: string, off = 0) => [...s].every((ch, i) => b[off + i] === ch.charCodeAt(0));
  if (b[0] === 0x89 && at("PNG\r\n\u001a\n", 1)) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (at("BM")) return "bmp";
  if (at("II*\u0000") || at("MM\u0000*")) return "tiff";
  if (at("GIF8")) return "gif";
  if (b.length >= 12 && at("ftyp", 4) && ["heic", "heix", "mif1", "msf1"].some((k) => at(k, 8))) return "heic";
  return null;
}

/** 画像の形から、写真かスクショかを見積もる（PNG・BMP・GIF はスクショ、JPEG・HEIC・TIFF は写真） */
export const sourceOf = (t: ImageType): ImageSource => (t === "png" || t === "bmp" || t === "gif" ? "screenshot" : "photo");

// ---- 数字の読み違いを直す ----

/** 1つの語を、日付・金額・支払い方法として読めるか */
const readable = (t: string) => parseAmount(t) !== null || DATE_LIKE.test(t) || parsePlan(t) !== null;

/**
 * 文字認識の読み違いを直す（語ごと）。直すのは、そのままでは日付・金額・支払い方法として読めず、直すと読める語だけ:
 * - 英字の O・o を 0、I・l・| を 1 に（「2O26/1O/O1」→「2026/10/01」・「l回払い」→「1回払い」）
 * - 「数字.3桁」を「数字,3桁」に（桁の区切りのカンマを点と読む。「5.412」→「5,412」。円の明細に小数は無い）
 */
export function fixDigits(text: string): { text: string; fixed: boolean } {
  let fixed = false;
  const out = nfkc(text)
    .split(/(\s+)/u)
    .map((t) => {
      if (t.trim() === "" || readable(t)) return t;
      const c = t.replace(/[Oo]/gu, "0").replace(/[Il|]/gu, "1");
      const d = c.replace(/(\d)\.(\d{3})(?!\d)/gu, "$1,$2");
      for (const cand of [c, d]) {
        if (cand !== t && /\d/u.test(cand) && readable(cand)) {
          fixed = true;
          return cand;
        }
      }
      return t;
    })
    .join("");
  return { text: out, fixed };
}

/**
 * 決済サービスの前置きの「*」（「PAYPAY*そらまめカフェ」）を、引用符・記号と読んだものを「*」に戻す（店の鍵の前置きの外し方に乗せるため）。
 * 英大文字が2字以上続いた後ろの、引用符・®・中黒などだけ
 */
export function fixSymbols(text: string): string {
  return text.replace(/(^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,})[”“"'’‘`´®°·•]+(?=[^\s”“"'’‘`´®°·•])/gu, "$1$2*");
}

/**
 * 振込・振替・送金の言葉と相手の名前の間の空白を、文字認識が落としたとき（「振込ミドリ タロウ」）に空白を戻す（銀行・家計簿アプリの明細）。
 * 空白があれば、今の取り込みの流れが相手の名前を外す（0034 の2）。「振込手数料」など、言葉の後ろがカタカナでないものはそのまま
 */
export function separateTransfer(text: string): string {
  return nfkc(text).replace(/^(振込|振替|送金|フリコミ|フリカエ|ソウキン|仕送り)(?=[\u30a1-\u30fa\u30fc])(?!手数料)/u, "$1 ");
}

/** 数字の塊か（すべての語が日付・金額・数字として読める） */
function numericText(t: string): boolean {
  const tokens = nfkc(t).trim().split(/\s+/u);
  return /\d/u.test(t) && tokens.every((x) => readable(x) || /^[\d,./:-]+$/u.test(x));
}

const squash = (s: string) => nfkc(s).replace(/\s+/gu, "");

export interface MarkedBox extends OcrBox {
  readonly doubt?: boolean;
  readonly agree?: boolean;
}

/**
 * Windows の2回の読みを合わせる: 英語で読んだ数字の塊が、日本語の塊（1つか、いくつか）をすっぽり覆うなら、日本語の塊を英語の塊に置き換える
 * （日本語の文字認識は数字を「」」「田」などと読むことがあるため）。2回の読みが同じなら agree、違えば doubt。
 * 日本語の塊の一部だけに重なる（店の名前とつながった）英語の塊は使わない。日本語で読めなかった数字は英語の塊を足す（確かめていないので agree にしない）
 */
export function mergeDigits(page: OcrPage): MarkedBox[] {
  const ja: MarkedBox[] = page.boxes.map((b) => {
    const f = fixDigits(fixSymbols(b.text));
    return { ...b, text: f.text, ...(f.fixed ? { doubt: true } : {}) };
  });
  if (page.digits === undefined) return ja;
  const W = page.width;
  const H = page.height;
  const px = (b: OcrBox) => ({ x0: b.x * W, x1: (b.x + b.w) * W, y0: b.y * H, y1: (b.y + b.h) * H });
  const used = new Set<number>();
  const added: MarkedBox[] = [];
  for (const raw of page.digits) {
    const f = fixDigits(raw.text);
    if (!numericText(f.text)) continue;
    const e = px(raw);
    const eh = e.y1 - e.y0;
    const tol = eh * 0.5;
    const over: number[] = [];
    let partial = false;
    ja.forEach((j, k) => {
      const p = px(j);
      const vy = Math.min(e.y1, p.y1) - Math.max(e.y0, p.y0);
      const hx = Math.min(e.x1, p.x1) - Math.max(e.x0, p.x0);
      if (vy < Math.min(eh, p.y1 - p.y0) * 0.5 || hx <= 0) return;
      if (p.x0 >= e.x0 - tol && p.x1 <= e.x1 + tol) over.push(k);
      else partial = true;
    });
    if (partial || over.some((k) => used.has(k))) continue;
    const jaText = over.map((k) => (ja[k] as MarkedBox).text).join("");
    for (const k of over) used.add(k);
    const agree = over.length > 0 && squash(jaText) === squash(f.text);
    added.push({ ...raw, text: f.text, ...(agree ? { agree: true } : over.length > 0 ? { doubt: true, agree: false } : { agree: false }) });
  }
  // 英語の読みで確かめられなかった日本語の数字の塊
  const rest = ja.flatMap((j, k) => (used.has(k) ? [] : [numericText(j.text) ? { ...j, agree: false } : j]));
  return [...rest, ...added];
}

/** 読んだ塊（割合・左上が原点）を、行と欄にまとめる塊（画素・下が 0）にする */
export function boxesToItems(boxes: readonly MarkedBox[], width: number, height: number): LayoutItem[] {
  return boxes
    .filter((b) => b.text.trim() !== "")
    .map((b) => ({
      x: b.x * width,
      y: (1 - b.y - b.h) * height,
      width: b.w * width,
      size: Math.max(1, b.h * height),
      text: b.text,
      ...(b.conf !== undefined ? { conf: b.conf } : {}),
      ...(b.doubt === true ? { doubt: true } : {}),
      ...(b.agree !== undefined ? { agree: b.agree } : {}),
    }));
}

// ---- 読み取りが不確かな行 ----

const isNumberCell = (c: string) => /\d/u.test(c) && (parseAmount(c) !== null || parseDate(c, 2000) !== null);

/** 行が「読み取りが不確か」か（strict: Windows の写真・スキャン。2回の読みで同じにならなかった数字のある行も） */
export function lineUncertain(cells: readonly string[], meta: readonly CellMeta[], strict: boolean): boolean {
  return cells.some((c, k) => {
    const m = meta[k];
    if (m === undefined || c === "") return false;
    if (m.doubt || m.conf < CONF_MIN) return true;
    if (/[�?？]/u.test(c)) return true;
    return strict && isNumberCell(c) && !m.agree;
  });
}

// ---- スマホのスクショ（1件が2行） ----

const WEEKDAY = /\s*[(（][月火水木金土日][)）]\s*$/u;
const dateOf = (c: string) => parseDate(nfkc(c).replace(WEEKDAY, ""), 2000);
const amountLine = (cells: readonly string[]) => cells.length >= 2 && parseAmount(cells[cells.length - 1] as string) !== null && dateOf(cells[0] as string) === null && parseAmount(cells[0] as string) === null;
const dateLine = (cells: readonly string[]) => cells.length >= 1 && dateOf(cells[0] as string) !== null && !cells.slice(1).some((c) => parseAmount(c) !== null && parsePlan(c) === null);

interface TwoLine {
  readonly cells: string[][];
  readonly lines: number[];
  readonly uncertain: number[];
}

/**
 * スマホのスクショの形（1件が2行）を [日付, 店, 支払い方法, 金額] の行にする。2つの並びを試し、多く読めた方を使う:
 * - 店と金額の行の下に、日付（と支払い方法）の行
 * - 日付だけの行の下に、その日の店と金額の行が1つ以上（日付ごとにまとめた画面）
 */
export function twoLineRows(lines: readonly (readonly string[])[], meta: readonly (readonly CellMeta[])[], strict: boolean): TwoLine {
  const unsure = (i: number) => lineUncertain(lines[i] as string[], meta[i] as CellMeta[], strict);
  const below: TwoLine = { cells: [], lines: [], uncertain: [] };
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i] as string[];
    const b = lines[i + 1] as string[];
    if (!amountLine(a) || !dateLine(b)) continue;
    below.cells.push([nfkc(b[0] as string).replace(WEEKDAY, ""), a.slice(0, -1).join(" "), b.slice(1).join(" "), a[a.length - 1] as string]);
    below.lines.push(i + 1);
    if (unsure(i) || unsure(i + 1)) below.uncertain.push(i + 1);
    i++;
  }
  const grouped: TwoLine = { cells: [], lines: [], uncertain: [] };
  let day: { text: string; at: number } | null = null;
  lines.forEach((l, i) => {
    if (l.length === 1 && dateOf(l[0] as string) !== null) {
      day = { text: nfkc(l[0] as string).replace(WEEKDAY, ""), at: i };
      return;
    }
    if (day === null || !amountLine(l)) return;
    grouped.cells.push([day.text, l.slice(0, -1).join(" "), "", l[l.length - 1] as string]);
    grouped.lines.push(i + 1);
    if (unsure(i) || unsure(day.at)) grouped.uncertain.push(i + 1);
  });
  return grouped.cells.length > below.cells.length ? grouped : below;
}

// ---- 明細の合計 ----

const TOTAL_WORDS = /(合計|総額|お支払(?:い)?金額|お支払(?:い)?額|ご請求(?:金)?額|今回(?:の)?お支払|ご利用金額合計)/u;
const NOT_TOTAL = /(件数|ポイント|残高|限度|可能額|手数料率)/u;

/** 明細に書かれた合計（「お支払金額 69,522円」「ご利用合計 … 69,522」。同じ行の最後の金額か、次の行の金額だけの行） */
export function findTotals(lines: readonly (readonly string[])[]): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => {
    const text = nfkc(l.join(" "));
    if (!TOTAL_WORDS.test(text) || NOT_TOTAL.test(text)) return;
    const tokens = l.flatMap((c) => nfkc(c).split(/\s+/u));
    const same = tokens.map((t) => parseAmount(t)).filter((n): n is number => n !== null && n > 0);
    if (same.length > 0) {
      out.push(same[same.length - 1] as number);
      return;
    }
    const next = lines[i + 1];
    if (next !== undefined && next.length === 1) {
      const n = parseAmount(next[0] as string);
      if (n !== null && n > 0) out.push(n);
    }
  });
  return [...new Set(out)];
}

/**
 * 明細の合計と、読んだ行の和を照らし合わせる（カード・家計簿アプリの明細。銀行の明細の合計は残高なので見ない）。
 * 何枚かのスクショは、同じ行（使った日・店・金額）を枚ごとに数え、いちばん多い枚の数だけ足す（スクショの重なりを2回足さない）
 */
export function totalCheck(sets: readonly { readonly rows: readonly Pick<ReadRow, "date" | "merchant" | "amount">[]; readonly totals: readonly number[] }[], kind: SourceKind): { totals: number[]; sum: number; ok: boolean } | null {
  if (kind === "bank") return null;
  const totals = [...new Set(sets.flatMap((s) => s.totals))];
  if (totals.length === 0) return null;
  const most = new Map<string, { n: number; amount: number }>();
  for (const s of sets) {
    const here = new Map<string, number>();
    for (const r of s.rows) {
      const k = `${r.date}|${merchantKey(r.merchant)}|${r.amount}`;
      here.set(k, (here.get(k) ?? 0) + 1);
    }
    for (const [k, n] of here) {
      const amount = Number(k.slice(k.lastIndexOf("|") + 1));
      if ((most.get(k)?.n ?? 0) < n) most.set(k, { n, amount });
    }
  }
  const sum = [...most.values()].reduce((s, v) => s + v.n * v.amount, 0);
  return { totals, sum, ok: totals.includes(sum) };
}

// ---- 読み手 ----

export const OCR_MESSAGES: Readonly<Record<string, string>> = {
  E_OCR_UNSUPPORTED: "この PC では写真・スクショの文字を読めません（Mac と Windows で読めます）。CSV か、文字の入った PDF を選んでください",
  E_OCR_NO_LANGUAGE:
    "この Windows には日本語の文字認識が入っていません。Windows の「設定」→「時刻と言語」→「言語と地域」で「日本語」を追加し、日本語の「…」→「言語のオプション」の「光学式文字認識」を入れてから、もう一度選んでください（日本語の Windows なら、ふつうは初めから入っています）",
  E_OCR_OLD_MAC: "この Mac の OS では日本語の文字を読めません（macOS 13 以降で読めます）。OS を新しくするか、CSV・文字の入った PDF を選んでください",
  E_OCR_IMAGE: "画像として読めませんでした。PNG・JPEG（Mac は HEIC も）の写真・スクショを選んでください",
  E_OCR_TOO_LARGE: "画像が大きすぎます（10MBまで）",
};

function failure(e: unknown): Issue {
  const code = e instanceof OcrFailure ? e.code : typeof e === "string" ? e : "E_OCR_FAILED";
  const msg = OCR_MESSAGES[code];
  return issue("error", code === "E_OCR_NO_LANGUAGE" ? "S_OCR_NO_LANGUAGE" : code === "E_OCR_UNSUPPORTED" ? "S_OCR_UNSUPPORTED" : code === "E_OCR_OLD_MAC" ? "S_OCR_OLD_MAC" : "S_OCR_FAILED", msg ?? `文字を読めませんでした（${code}）`);
}

const empty = (issues: Issue[]): ReaderTable => ({ table: { cells: [], lines: [], masked: 0 }, issues });

/** 読んだ結果の形（見出しのある表・見出しの無い「日付…金額」の行・スマホのスクショの1件が2行） */
export type OcrLayout = "table" | "rows" | "twoLine";

/** 読み手が返す、文字認識の結果の補い（readStatement が読んだ結果に載せる） */
export interface OcrInfo {
  readonly layout: OcrLayout;
  readonly source: ImageSource;
  readonly engine: string;
  /** 明細に書かれた合計 */
  readonly totals: readonly number[];
  /** 推し量った傾き（度。ページごと） */
  readonly angles: readonly number[];
  /** 字の高さの中ほどの値（画素） */
  readonly textPx: number;
}

/**
 * 読んだページ（1枚の画像、または画像だけの PDF のページ）を、読み手の表にする。
 * 番号は英字の O・I・l も数字とみなして消す（linesToTable の loose）。読み取りが不確かな行は uncertain（表の行の番号）
 */
export function ocrTable(pages: readonly OcrPage[], kind: SourceKind, source: ImageSource): ReaderTable {
  const strict = source !== "screenshot" && pages.some((p) => p.digits !== undefined);
  // 番号は塊ごとに先に消す（1つの塊の中の番号が、欄に分けるときに2つの欄に割れて、どちらの欄でも消し方に当たらなくなるのを防ぐ）
  const perPage = pages.map((p) => boxesToItems(mergeDigits(p).map((b) => ({ ...b, text: maskCellLoose(b.text).text })), p.width, p.height));
  if (perPage.every((p) => p.length === 0)) return empty([issue("error", "S_OCR_NO_TEXT", "文字が見つかりませんでした。明るい所で、真上から、文字が大きく写るように撮り直してください")]);
  const raw = assemblePages(perPage, kind, { deskew: true, joinSpace: true });
  // 銀行・家計簿アプリの明細は、振込の相手の名前を外せるように、振込の言葉の後ろの空白を戻す
  const asm = kind === "card" ? raw : { ...raw, lines: raw.lines.map((l) => l.map(separateTransfer)) };
  const heights = perPage.flat().map((i) => i.size);
  const textPx = [...heights].sort((a, b) => a - b)[Math.floor(heights.length / 2)] ?? 0;
  const engine = pages[0]?.engine ?? "";
  const totals = findTotals(asm.lines);
  const info = (layout: OcrLayout): OcrInfo => ({ layout, source, engine, totals, angles: asm.angles, textPx });
  const notes: Issue[] = [];
  if (textPx > 0 && textPx < SMALL_TEXT_PX) notes.push(issue("warning", "S_OCR_SMALL_TEXT", "字が小さいため、読み違えやすくなっています。画面を拡大してからスクショを撮るか、文字が大きく写るように撮り直すと確かになります"));
  // 1. 見出しのある表・見出しの無い「日付…金額」の行（文字の入った PDF と同じ流れ）
  const base = linesToTable(asm.lines, { loose: true });
  const tableRows = base.fixedMapping !== undefined ? base.table.cells.length : countHeaderRows(asm.lines);
  // 2. スマホのスクショ（1件が2行）
  const two = twoLineRows(asm.lines, asm.meta, strict);
  if (two.cells.length > tableRows) {
    const statementDate = base.statementDate;
    let masked = 0;
    const cells = two.cells.map((r) =>
      r.map((c) => {
        const m = maskCellLoose(c);
        if (m.masked) masked++;
        return m.text;
      }),
    );
    return {
      table: { cells, lines: two.lines, masked },
      issues: notes,
      fixedMapping: FIXED,
      loose: true,
      uncertain: two.uncertain,
      ocr: info("twoLine"),
      ...(statementDate !== undefined ? { statementDate } : {}),
    };
  }
  const uncertain = base.table.lines.filter((n) => lineUncertain(asm.lines[n - 1] ?? [], asm.meta[n - 1] ?? [], strict));
  return { ...base, issues: [...base.issues, ...notes], loose: true, uncertain, ocr: info(base.fixedMapping !== undefined ? "rows" : "table") };
}

const FIXED: ColumnMapping = { headerRow: null, columns: { date: 0, merchant: 1, plan: 2, amount: 3 }, sign: "expensePositive" };

/** 見出しのある表で、明細の行らしい行（日付と金額の欄がある）の数 */
function countHeaderRows(lines: readonly (readonly string[])[]): number {
  return lines.filter((l) => l.some((c) => dateOf(c) !== null) && l.some((c) => parseAmount(c) !== null && dateOf(c) === null)).length;
}

/** 写真・スクショの読み手（1枚の画像を1つの明細として読む）。文字を読む関数はアプリ本体の命令 */
export function createImageReader(ocr: OcrFn): StatementReader {
  return {
    id: "image",
    version: 1,
    label: "写真・スクショ（PC の中の文字認識）",
    accepts: (bytes) => (imageType(bytes) !== null ? 0.95 : 0),
    async table(bytes, kind) {
      const t = imageType(bytes);
      if (t === null) return empty([issue("error", "S_OCR_FAILED", OCR_MESSAGES.E_OCR_IMAGE as string)]);
      let page: OcrPage;
      try {
        page = await ocr(bytes);
      } catch (e) {
        return empty([failure(e)]);
      }
      return ocrTable([page], kind, sourceOf(t));
    },
  };
}

/**
 * 画像だけの PDF の読み手（スキャンした明細など）。ページを画像に描き（画面の pdf.js。30ページまで）、ページごとに文字を読む。
 * 文字の入った PDF の読み手が「文字が入っていない」と返したときに使う（readStatement が次の読み手に回す）
 */
export function createPdfScanReader(ocr: OcrFn, rasterize: RasterizeFn): StatementReader {
  return {
    id: "pdfScan",
    version: 1,
    label: "画像だけの PDF（PC の中の文字認識）",
    accepts: (bytes) => (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? 0.5 : 0),
    async table(bytes, kind) {
      let r: Awaited<ReturnType<RasterizeFn>>;
      try {
        r = await rasterize(bytes, MAX_SCAN_PAGES);
      } catch {
        return empty([issue("error", "S_PDF_BROKEN", "PDF のページを絵にできませんでした（壊れているか、読めない形の画像です）")]);
      }
      const pages: OcrPage[] = [];
      for (const img of r.pages.slice(0, MAX_SCAN_PAGES)) {
        try {
          pages.push(await ocr(img));
        } catch (e) {
          return empty([failure(e)]);
        }
      }
      const out = ocrTable(pages, kind, "scan");
      if (r.total > MAX_SCAN_PAGES) return { ...out, issues: [...out.issues, issue("warning", "S_OCR_PAGES", `ページが多いため、最初の ${MAX_SCAN_PAGES}ページだけを読みました（全部で ${r.total}ページ）。残りは PDF を分けて取り込んでください`)] };
      return out;
    },
  };
}

/** FP が画像の横で直した行（日付は YYYY-MM-DD、金額は円の整数。支払い方法は読んだときの文字のまま） */
export interface EditedRow {
  readonly line: number;
  readonly date: string;
  readonly merchant: string;
  readonly amount: number;
  readonly plan?: string;
  /** まだ確かめていない「読み取りが不確か」の行 */
  readonly uncertain?: boolean;
}

/**
 * FP が直した行を、もう一度今の取り込みの流れに通す読み手（readStatement に元の画像のバイト列と一緒に渡す。指紋は元の画像のもの）。
 * 番号は readStatement の中でもう一度消す（直した店の名前に番号を書いても残らない）
 */
export function createEditedReader(base: { readonly id: string; readonly version: number }, rows: readonly EditedRow[]): StatementReader {
  return {
    id: base.id,
    version: base.version,
    label: "画像の横で直した行",
    accepts: () => 1,
    table: async (_bytes, kind) => ({
      table: { cells: rows.map((r) => [r.date, kind === "card" ? r.merchant : separateTransfer(r.merchant), r.plan ?? "", String(r.amount)]), lines: rows.map((r) => r.line), masked: 0 },
      issues: [],
      fixedMapping: FIXED,
      loose: true,
      uncertain: rows.filter((r) => r.uncertain === true).map((r) => r.line),
    }),
  };
}


/** 支払い方法を、読み直せる文字にする（画像の横で直した行を、今の取り込みの流れにもう一度通すため） */
export function planToText(p: PaymentPlan | undefined): string {
  if (p === undefined) return "";
  if (p.kind === "lump") return "1回払い";
  if (p.kind === "revolving") return "リボ";
  if (p.kind === "bonus") return "ボーナス一括";
  return p.index !== undefined ? `${p.count}回中${p.index}回目` : `分割${p.count}回`;
}

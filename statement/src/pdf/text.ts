// PDF のページから文字を取り出し、行と欄にする（0034 の3）。
// - 文字コード→文字は、フォントの ToUnicode（CMap）で引く。無ければ1バイトのフォントは Latin-1 として読む（日本語は ToUnicode が要る）
// - 位置は文字の行列（Tm・Td・TD・T*）と変換の行列（cm・q・Q）から出す。同じ高さの文字を1行にまとめ、横の隙間で欄に分ける
// - 文字の幅はフォントの幅の表を読まずに見積もる（1バイトは文字の大きさの0.5、2バイトは1.0）。欄の分け方にだけ使う
import { Lexer, PdfDocument, PdfError, PdfName, PdfString, isStream, nameOf, num, type PdfDict, type PdfValue, type Token } from "./objects.ts";

interface Font {
  /** 文字コードのバイト数（ToUnicode の codespacerange から。無ければ Type0 は2、ほかは1） */
  readonly widths: readonly number[];
  readonly map: Map<string, string>;
  readonly twoByte: boolean;
  /** 文字コード → 幅（1000分の1の文字の大きさ）。フォントの幅の表（W・Widths）から */
  readonly glyph: Map<number, number>;
  /** 表に無い文字の幅（DW）。幅の表が無いフォントは null（文字から見積もる） */
  readonly dw: number | null;
}

function hexKey(bytes: Uint8Array, from: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += (bytes[from + i] as number).toString(16).padStart(2, "0");
  return s;
}

function utf16be(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(((bytes[i] as number) << 8) | (bytes[i + 1] as number));
  return s;
}

/** ToUnicode の CMap を読む（codespacerange・bfchar・bfrange） */
export function parseToUnicode(data: Uint8Array): { map: Map<string, string>; lengths: number[] } {
  const lx = new Lexer(data);
  const map = new Map<string, string>();
  const lengths = new Set<number>();
  const toks: Token[] = [];
  for (let t = lx.next(); t !== null; t = lx.next()) {
    toks.push(t);
    if (toks.length > 2_000_000) break;
  }
  const strAt = (i: number): Uint8Array | null => {
    const t = toks[i];
    return t?.t === "str" ? t.v : null;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i] as Token;
    if (t.t !== "kw") continue;
    if (t.v === "begincodespacerange") {
      for (let k = i + 1; k + 1 < toks.length; k += 2) {
        const a = strAt(k);
        if (a === null) break;
        lengths.add(a.length);
      }
    } else if (t.v === "beginbfchar") {
      for (let k = i + 1; k + 1 < toks.length; k += 2) {
        const src = strAt(k);
        const dst = strAt(k + 1);
        if (src === null || dst === null) break;
        map.set(hexKey(src, 0, src.length), utf16be(dst));
      }
    } else if (t.v === "beginbfrange") {
      let k = i + 1;
      while (k + 2 < toks.length) {
        const lo = strAt(k);
        const hi = strAt(k + 1);
        if (lo === null || hi === null) break;
        const lov = parseInt(hexKey(lo, 0, lo.length), 16);
        const hiv = parseInt(hexKey(hi, 0, hi.length), 16);
        const third = toks[k + 2] as Token;
        if (hiv - lov > 0xffff || hiv < lov) break;
        if (third.t === "str") {
          const base = utf16be(third.v);
          const last = base.charCodeAt(base.length - 1);
          for (let v = lov; v <= hiv; v++) map.set(v.toString(16).padStart(lo.length * 2, "0"), base.slice(0, -1) + String.fromCharCode(last + (v - lov)));
          k += 3;
        } else if (third.t === "punct" && third.v === "[") {
          let v = lov;
          k += 3;
          while (k < toks.length && !((toks[k] as Token).t === "punct" && (toks[k] as Token).v === "]")) {
            const s = strAt(k);
            if (s !== null && v <= hiv) map.set((v++).toString(16).padStart(lo.length * 2, "0"), utf16be(s));
            k++;
          }
          k++;
        } else break;
      }
    }
  }
  return { map, lengths: [...lengths].sort((a, b) => b - a) };
}

/** フォントの幅の表を読む（Type0 は子のフォントの W と DW、ほかは FirstChar と Widths） */
function glyphWidths(doc: PdfDocument, d: PdfDict | undefined, type0: boolean): { glyph: Map<number, number>; dw: number | null } {
  const glyph = new Map<number, number>();
  if (type0) {
    const kids = doc.get(d?.get("DescendantFonts"));
    const cid = doc.dict(Array.isArray(kids) ? kids[0] : undefined);
    const w = doc.get(cid?.get("W"));
    if (Array.isArray(w)) {
      for (let i = 0; i < w.length && glyph.size < 100_000; ) {
        const first = num(doc.get(w[i]));
        const next = doc.get(w[i + 1]);
        if (first === undefined) break;
        if (Array.isArray(next)) {
          next.forEach((x, k) => glyph.set(first + k, num(doc.get(x)) ?? 1000));
          i += 2;
        } else {
          const last = num(next);
          const width = num(doc.get(w[i + 2]));
          if (last === undefined || width === undefined || last - first > 65535) break;
          for (let c = first; c <= last; c++) glyph.set(c, width);
          i += 3;
        }
      }
      return { glyph, dw: num(doc.get(cid?.get("DW"))) ?? 1000 };
    }
    return { glyph, dw: null };
  }
  const firstChar = num(doc.get(d?.get("FirstChar")));
  const ws = doc.get(d?.get("Widths"));
  if (firstChar !== undefined && Array.isArray(ws)) {
    ws.forEach((x, k) => glyph.set(firstChar + k, num(doc.get(x)) ?? 500));
    return { glyph, dw: 500 };
  }
  return { glyph, dw: null };
}

async function loadFont(doc: PdfDocument, ref: PdfValue): Promise<Font> {
  const d = doc.dict(ref);
  const type0 = nameOf(d?.get("Subtype")) === "Type0";
  const { glyph, dw } = glyphWidths(doc, d, type0);
  const tu = doc.get(d?.get("ToUnicode"));
  if (isStream(tu)) {
    try {
      const { map, lengths } = parseToUnicode(await doc.decode(tu));
      const widths = lengths.length > 0 ? lengths : [type0 ? 2 : 1];
      return { widths, map, twoByte: widths.includes(2), glyph, dw };
    } catch (e) {
      if (e instanceof PdfError && e.code === "limit") throw e;
    }
  }
  return { widths: [type0 ? 2 : 1], map: new Map(), twoByte: type0, glyph, dw };
}

/** 幅の表が無いときの見積もり: 半角の文字は 0.5、ほかは 1.0（1000分の1の単位で返す） */
function guessWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    w += c < 0x2000 || (c >= 0xff61 && c <= 0xff9f) ? 500 : 1000;
  }
  return w;
}

function decodeString(font: Font | undefined, bytes: Uint8Array): { text: string; width: number } {
  if (font === undefined) {
    const text = String.fromCharCode(...bytes);
    return { text, width: guessWidth(text) };
  }
  let text = "";
  let width = 0;
  let i = 0;
  const advance = (code: number, u: string) => {
    width += font.dw === null ? guessWidth(u === "" ? " " : u) : (font.glyph.get(code) ?? font.dw);
  };
  while (i < bytes.length) {
    let done = false;
    for (const w of font.widths) {
      if (i + w > bytes.length) continue;
      const key = hexKey(bytes, i, w);
      const u = font.map.get(key);
      if (u !== undefined) {
        text += u;
        advance(parseInt(key, 16), u);
        i += w;
        done = true;
        break;
      }
    }
    if (done) continue;
    const w = font.widths[font.widths.length - 1] ?? 1;
    let u = "";
    if (w === 1 && font.map.size === 0) {
      const c = bytes[i] as number;
      u = c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : c >= 0xa0 ? String.fromCharCode(c) : "";
      text += u;
    }
    const step = Math.max(1, Math.min(w, bytes.length - i));
    let code = 0;
    for (let k = 0; k < step; k++) code = code * 256 + (bytes[i + k] as number);
    advance(code, u);
    i += step;
  }
  return { text, width };
}

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const ID: M = [1, 0, 0, 1, 0, 0];

export interface TextItem {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly size: number;
  readonly text: string;
}

/** 1ページの内容のストリームを読んで、文字の塊（位置つき）にする */
export async function pageItems(doc: PdfDocument, page: { dict: PdfDict; resources: PdfDict }): Promise<TextItem[]> {
  const data = await doc.contents(page.dict);
  const fontDict = doc.dict(page.resources.get("Font"));
  const fonts = new Map<string, Font>();
  const items: TextItem[] = [];
  const lx = new Lexer(data);
  const stack: PdfValue[] = [];
  let ctm: M = ID;
  const saved: M[] = [];
  let tm: M = ID;
  let tlm: M = ID;
  let font: Font | undefined;
  let size = 10;
  let leading = 0;
  const show = (bytes: Uint8Array) => {
    const { text, width: w1000 } = decodeString(font, bytes);
    const m = mul(tm, ctm);
    const scale = Math.hypot(m[0], m[1]) || 1;
    const fs = size * scale;
    const width = (w1000 / 1000) * fs;
    if (text.trim() !== "") items.push({ x: m[4], y: m[5], width, size: fs, text });
    // 次の文字の位置へ進める（文字の空間の単位で）
    tm = mul([1, 0, 0, 1, (w1000 / 1000) * size, 0], tm);
  };
  for (let tok = lx.next(); tok !== null; tok = lx.next()) {
    if (tok.t !== "kw") {
      try {
        stack.push(parseValue2(lx, tok));
      } catch {
        stack.length = 0;
      }
      if (stack.length > 10_000) stack.length = 0;
      continue;
    }
    const op = tok.v;
    const n = (i: number) => num(stack[stack.length - i]) ?? 0;
    switch (op) {
      case "q":
        saved.push(ctm);
        break;
      case "Q":
        ctm = saved.pop() ?? ID;
        break;
      case "cm":
        ctm = mul([n(6), n(5), n(4), n(3), n(2), n(1)], ctm);
        break;
      case "BT":
        tm = ID;
        tlm = ID;
        break;
      case "Tf": {
        const name = nameOf(stack[stack.length - 2]);
        size = n(1);
        if (name !== undefined && fontDict !== undefined) {
          if (!fonts.has(name)) fonts.set(name, await loadFont(doc, fontDict.get(name) as PdfValue));
          font = fonts.get(name);
        }
        break;
      }
      case "TL":
        leading = n(1);
        break;
      case "Td":
        tlm = mul([1, 0, 0, 1, n(2), n(1)], tlm);
        tm = tlm;
        break;
      case "TD":
        leading = -n(1);
        tlm = mul([1, 0, 0, 1, n(2), n(1)], tlm);
        tm = tlm;
        break;
      case "Tm":
        tlm = [n(6), n(5), n(4), n(3), n(2), n(1)];
        tm = tlm;
        break;
      case "T*":
        tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        break;
      case "Tj": {
        const s = stack[stack.length - 1];
        if (s instanceof PdfString) show(s.bytes);
        break;
      }
      case "'":
      case '"': {
        tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        const s = stack[stack.length - 1];
        if (s instanceof PdfString) show(s.bytes);
        break;
      }
      case "TJ": {
        const arr = stack[stack.length - 1];
        if (Array.isArray(arr)) {
          for (const el of arr) {
            if (el instanceof PdfString) show(el.bytes);
            else if (typeof el === "number") tm = mul([1, 0, 0, 1, (-el / 1000) * size, 0], tm);
          }
        }
        break;
      }
      case "BI":
        // 埋め込みの画像は読まない（EI まで飛ばす）
        for (let t = lx.next(); t !== null && !(t.t === "kw" && t.v === "EI"); t = lx.next());
        break;
      default:
        break;
    }
    stack.length = 0;
  }
  return items;
}

/** 内容のストリームの中の値（辞書・配列も読む） */
function parseValue2(lx: Lexer, tok: Token): PdfValue {
  if (tok.t === "num") return tok.v;
  if (tok.t === "name") return new PdfName(tok.v);
  if (tok.t === "str") return new PdfString(tok.v);
  if (tok.t === "punct" && tok.v === "[") {
    const arr: PdfValue[] = [];
    for (let t = lx.next(); t !== null && !(t.t === "punct" && t.v === "]"); t = lx.next()) arr.push(parseValue2(lx, t));
    return arr;
  }
  if (tok.t === "punct" && tok.v === "<<") {
    const d = new Map<string, PdfValue>();
    let key: string | null = null;
    for (let t = lx.next(); t !== null && !(t.t === "punct" && t.v === ">>"); t = lx.next()) {
      if (key === null && t.t === "name") key = t.v;
      else if (key !== null) {
        d.set(key, parseValue2(lx, t));
        key = null;
      }
    }
    return d;
  }
  return null;
}

/** 文字の塊を、行（上から）と欄（左から）にまとめる */
export function toLines(items: readonly TextItem[]): string[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last !== undefined && Math.abs((last[0] as TextItem).y - it.y) <= Math.max(1, Math.min((last[0] as TextItem).size, it.size) * 0.4)) last.push(it);
    else lines.push([it]);
  }
  return lines.map((ln) => {
    const xs = [...ln].sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let cur = "";
    let end = -Infinity;
    for (const it of xs) {
      const gap = it.x - end;
      if (cur !== "" && gap > it.size * 0.9) {
        cells.push(cur.trim());
        cur = "";
      }
      cur += it.text;
      end = Math.max(end, it.x + it.width);
    }
    if (cur.trim() !== "") cells.push(cur.trim());
    return cells;
  });
}

/** PDF の文字を、すべてのページの行と欄にする */
export async function extractPdfLines(bytes: Uint8Array): Promise<{ lines: string[][]; pages: number; chars: number }> {
  const doc = await PdfDocument.open(bytes);
  const pages = doc.pages();
  const lines: string[][] = [];
  let chars = 0;
  for (const p of pages) {
    const items = await pageItems(doc, p);
    chars += items.reduce((n, i) => n + i.text.length, 0);
    lines.push(...toLines(items));
  }
  return { lines, pages: pages.length, chars };
}

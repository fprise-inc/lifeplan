// PDF の中身の読み方（文字の入った明細の PDF から文字を取り出すのに要る分だけ。0034 の3）。
// - 外の部品を使わない（画面でも Node でも動く）。FlateDecode は DecompressionStream で展開する
// - 読むのは、間接オブジェクト・オブジェクトストリーム・ページの木・フォント（ToUnicode）・内容のストリームだけ。
//   JavaScript・埋め込みファイル・フォーム・注釈は読まない・実行しない
// - 暗号化された PDF（/Encrypt）は読まない（パスワードを外して保存し直すよう案内する）
// - 大きさ・オブジェクトの数・展開した後の大きさに上限を置く

export type PdfValue = null | boolean | number | string | PdfName | PdfString | PdfRef | PdfValue[] | PdfDict;

export class PdfName {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}
export class PdfString {
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
}
export class PdfRef {
  readonly num: number;
  readonly gen: number;
  constructor(num: number, gen: number) {
    this.num = num;
    this.gen = gen;
  }
}
export type PdfDict = Map<string, PdfValue>;

export class PdfError extends Error {
  readonly code: "broken" | "encrypted" | "limit" | "filter";
  constructor(code: "broken" | "encrypted" | "limit" | "filter") {
    super(code);
    this.code = code;
  }
}

export interface PdfLimits {
  readonly maxFileBytes: number;
  readonly maxObjects: number;
  readonly maxInflatedBytes: number;
  readonly maxPages: number;
}

export const PDF_LIMITS: PdfLimits = { maxFileBytes: 10 * 1024 * 1024, maxObjects: 200_000, maxInflatedBytes: 60 * 1024 * 1024, maxPages: 200 };

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

export type Token = { t: "num"; v: number } | { t: "name"; v: string } | { t: "str"; v: Uint8Array } | { t: "kw"; v: string } | { t: "punct"; v: "[" | "]" | "<<" | ">>" | "{" | "}" };

/** 字句の読み手（内容のストリームとオブジェクトの両方で使う） */
export class Lexer {
  pos: number;
  readonly b: Uint8Array;
  readonly end: number;
  constructor(b: Uint8Array, start = 0, end = b.length) {
    this.b = b;
    this.pos = start;
    this.end = end;
  }

  private skipWs(): void {
    const b = this.b;
    while (this.pos < this.end) {
      const c = b[this.pos] as number;
      if (WS.has(c)) this.pos++;
      else if (c === 0x25) {
        while (this.pos < this.end && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  next(): Token | null {
    this.skipWs();
    const b = this.b;
    if (this.pos >= this.end) return null;
    const c = b[this.pos] as number;
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      this.pos++;
      return { t: "punct", v: String.fromCharCode(c) as "[" | "]" | "{" | "}" };
    }
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return { t: "punct", v: "<<" };
      }
      return { t: "str", v: this.hexString() };
    }
    if (c === 0x3e) {
      if (b[this.pos + 1] === 0x3e) {
        this.pos += 2;
        return { t: "punct", v: ">>" };
      }
      this.pos++;
      return this.next();
    }
    if (c === 0x28) return { t: "str", v: this.literalString() };
    if (c === 0x2f) {
      this.pos++;
      let s = "";
      while (this.pos < this.end && !WS.has(b[this.pos] as number) && !DELIM.has(b[this.pos] as number)) {
        const ch = b[this.pos] as number;
        if (ch === 0x23 && this.pos + 2 < this.end) {
          s += String.fromCharCode(parseInt(String.fromCharCode(b[this.pos + 1] as number, b[this.pos + 2] as number), 16));
          this.pos += 3;
        } else {
          s += String.fromCharCode(ch);
          this.pos++;
        }
      }
      return { t: "name", v: s };
    }
    let s = "";
    while (this.pos < this.end && !WS.has(b[this.pos] as number) && !DELIM.has(b[this.pos] as number)) s += String.fromCharCode(b[this.pos++] as number);
    if (s === "") {
      this.pos++;
      return this.next();
    }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(s)) return { t: "num", v: Number(s) };
    return { t: "kw", v: s };
  }

  private hexString(): Uint8Array {
    this.pos++;
    let hex = "";
    while (this.pos < this.end && this.b[this.pos] !== 0x3e) {
      const ch = String.fromCharCode(this.b[this.pos] as number);
      if (/[0-9a-fA-F]/u.test(ch)) hex += ch;
      this.pos++;
    }
    this.pos++;
    if (hex.length % 2 === 1) hex += "0";
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  private literalString(): Uint8Array {
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    const b = this.b;
    while (this.pos < this.end) {
      const c = b[this.pos++] as number;
      if (c === 0x5c) {
        const n = b[this.pos++] as number;
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
        if (map[n] !== undefined) out.push(map[n] as number);
        else if (n >= 0x30 && n <= 0x37) {
          let v = n - 0x30;
          for (let k = 0; k < 2 && (b[this.pos] as number) >= 0x30 && (b[this.pos] as number) <= 0x37; k++) v = v * 8 + ((b[this.pos++] as number) - 0x30);
          out.push(v & 0xff);
        } else if (n === 0x0d) {
          if (b[this.pos] === 0x0a) this.pos++;
        } else if (n !== 0x0a) out.push(n);
        continue;
      }
      if (c === 0x28) depth++;
      if (c === 0x29) {
        depth--;
        if (depth === 0) break;
      }
      out.push(c);
    }
    return Uint8Array.from(out);
  }
}

/** 字句の並びから値を1つ読む（間接参照 `n g R` もここで読む） */
export function parseValue(lx: Lexer, first?: Token | null): PdfValue {
  const tok = first === undefined ? lx.next() : first;
  if (tok === null) throw new PdfError("broken");
  switch (tok.t) {
    case "num": {
      const save = lx.pos;
      const t2 = lx.next();
      if (t2?.t === "num" && Number.isInteger(tok.v) && Number.isInteger(t2.v)) {
        const t3 = lx.next();
        if (t3?.t === "kw" && t3.v === "R") return new PdfRef(tok.v, t2.v);
      }
      lx.pos = save;
      return tok.v;
    }
    case "name":
      return new PdfName(tok.v);
    case "str":
      return new PdfString(tok.v);
    case "kw":
      if (tok.v === "true") return true;
      if (tok.v === "false") return false;
      if (tok.v === "null") return null;
      return tok.v;
    case "punct":
      if (tok.v === "[") {
        const arr: PdfValue[] = [];
        for (;;) {
          const t = lx.next();
          if (t === null) throw new PdfError("broken");
          if (t.t === "punct" && t.v === "]") return arr;
          arr.push(parseValue(lx, t));
          if (arr.length > 100_000) throw new PdfError("limit");
        }
      }
      if (tok.v === "<<") {
        const d: PdfDict = new Map();
        for (;;) {
          const t = lx.next();
          if (t === null) throw new PdfError("broken");
          if (t.t === "punct" && t.v === ">>") return d;
          if (t.t !== "name") throw new PdfError("broken");
          d.set(t.v, parseValue(lx));
        }
      }
      return null;
  }
}

const latin1 = (b: Uint8Array, from: number, to: number): string => {
  let s = "";
  for (let i = from; i < to; i++) s += String.fromCharCode(b[i] as number);
  return s;
};

function indexOf(b: Uint8Array, needle: string, from: number): number {
  const n = needle.length;
  outer: for (let i = from; i <= b.length - n; i++) {
    for (let k = 0; k < n; k++) if (b[i + k] !== needle.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

export interface PdfStream {
  readonly dict: PdfDict;
  readonly raw: Uint8Array;
}

/** PDF の文書（間接オブジェクトを番号で引ける） */
export class PdfDocument {
  private readonly objects = new Map<number, PdfValue | PdfStream>();
  private inflated = 0;
  trailer: PdfDict = new Map();

  readonly bytes: Uint8Array;
  readonly limits: PdfLimits;
  private constructor(bytes: Uint8Array, limits: PdfLimits) {
    this.bytes = bytes;
    this.limits = limits;
  }

  static async open(bytes: Uint8Array, limits: PdfLimits = PDF_LIMITS): Promise<PdfDocument> {
    if (bytes.length > limits.maxFileBytes) throw new PdfError("limit");
    if (latin1(bytes, 0, Math.min(1024, bytes.length)).indexOf("%PDF-") < 0) throw new PdfError("broken");
    const doc = new PdfDocument(bytes, limits);
    doc.scan();
    await doc.expandObjectStreams();
    doc.findTrailer();
    if (doc.trailer.has("Encrypt")) throw new PdfError("encrypted");
    return doc;
  }

  /** 「n g obj」を前から順に探す（後に出たものが同じ番号の前の定義を置き換える＝追記の更新） */
  private scan(): void {
    const b = this.bytes;
    const text = latin1(b, 0, b.length);
    const re = /(\d+)\s+(\d+)\s+obj\b/gu;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(text)) !== null) {
      if (++count > this.limits.maxObjects) throw new PdfError("limit");
      const num = Number(m[1]);
      const lx = new Lexer(b, m.index + m[0].length);
      let value: PdfValue;
      try {
        value = parseValue(lx);
      } catch (e) {
        if (e instanceof PdfError && e.code === "limit") throw e;
        continue;
      }
      const save = lx.pos;
      const t = lx.next();
      if (value instanceof Map && t?.t === "kw" && t.v === "stream") {
        let start = lx.pos;
        if (b[start] === 0x0d) start++;
        if (b[start] === 0x0a) start++;
        const len = value.get("Length");
        let end = -1;
        if (typeof len === "number" && Number.isInteger(len) && len >= 0 && start + len <= b.length) {
          let k = start + len;
          while (k < b.length && WS.has(b[k] as number)) k++;
          if (latin1(b, k, Math.min(b.length, k + 9)) === "endstream") end = start + len;
        }
        if (end < 0) {
          const e = indexOf(b, "endstream", start);
          if (e < 0) continue;
          end = e;
          while (end > start && (b[end - 1] === 0x0a || b[end - 1] === 0x0d)) end--;
        }
        this.objects.set(num, { dict: value, raw: b.subarray(start, end) });
        re.lastIndex = Math.max(re.lastIndex, end);
      } else {
        lx.pos = save;
        this.objects.set(num, value);
      }
    }
  }

  private async expandObjectStreams(): Promise<void> {
    for (const [, v] of [...this.objects]) {
      if (!isStream(v) || nameOf(v.dict.get("Type")) !== "ObjStm") continue;
      let data: Uint8Array;
      try {
        data = await this.decode(v);
      } catch (e) {
        if (e instanceof PdfError && e.code === "limit") throw e;
        continue;
      }
      const n = num(v.dict.get("N")) ?? 0;
      const first = num(v.dict.get("First")) ?? 0;
      const lx = new Lexer(data);
      const pairs: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = lx.next();
        const o = lx.next();
        if (a?.t !== "num" || o?.t !== "num") break;
        pairs.push([a.v, o.v]);
      }
      for (const [objNum, off] of pairs) {
        if (this.objects.has(objNum) && !isStream(this.objects.get(objNum))) continue;
        try {
          this.objects.set(objNum, parseValue(new Lexer(data, first + off)));
        } catch {
          // 壊れたオブジェクトは飛ばす
        }
      }
    }
  }

  private findTrailer(): void {
    const b = this.bytes;
    const text = latin1(b, 0, b.length);
    let at = text.lastIndexOf("trailer");
    while (at >= 0) {
      try {
        const v = parseValue(new Lexer(b, at + 7));
        if (v instanceof Map) {
          this.trailer = v;
          return;
        }
      } catch {
        // 次を探す
      }
      at = text.lastIndexOf("trailer", at - 1);
    }
    // 相互参照ストリームの PDF: 見出しの辞書（/Type /XRef）を trailer の代わりにする
    for (const v of this.objects.values()) {
      if (isStream(v) && nameOf(v.dict.get("Type")) === "XRef") this.trailer = v.dict;
    }
    if (!this.trailer.has("Root")) {
      for (const v of this.objects.values()) if (v instanceof Map && nameOf(v.get("Type")) === "Catalog") this.trailer = new Map([["Root", v]]);
    }
  }

  get(v: PdfValue | undefined, depth = 0): PdfValue | PdfStream | undefined {
    if (v instanceof PdfRef) {
      if (depth > 32) return undefined;
      const o = this.objects.get(v.num);
      return o instanceof PdfRef ? this.get(o, depth + 1) : o;
    }
    return v;
  }

  dict(v: PdfValue | undefined): PdfDict | undefined {
    const o = this.get(v);
    if (o instanceof Map) return o;
    if (isStream(o)) return o.dict;
    return undefined;
  }

  /** ストリームを展開する（FlateDecode・ASCIIHexDecode・フィルターなし。ほかは読まない） */
  async decode(s: PdfStream): Promise<Uint8Array> {
    const f = this.get(s.dict.get("Filter"));
    const filters = (Array.isArray(f) ? f : f === undefined || f === null ? [] : [f]).map((x) => nameOf(this.get(x as PdfValue) as PdfValue));
    let data = s.raw;
    for (const name of filters) {
      if (name === "FlateDecode" || name === "Fl") data = await this.inflate(data);
      else if (name === "ASCIIHexDecode" || name === "AHx") data = new Lexer(Uint8Array.from([0x3c, ...data, 0x3e])).next()?.v as Uint8Array;
      else throw new PdfError("filter");
    }
    const parms = this.dict(s.dict.get("DecodeParms") as PdfValue);
    const predictor = num(parms?.get("Predictor")) ?? 1;
    if (predictor >= 10) data = unpredictPng(data, num(parms?.get("Columns")) ?? 1);
    return data;
  }

  private async inflate(data: Uint8Array): Promise<Uint8Array> {
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    writer.write(data as Uint8Array<ArrayBuffer>).catch(() => undefined);
    writer.close().catch(() => undefined);
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        this.inflated += value.length;
        if (this.inflated > this.limits.maxInflatedBytes) {
          await reader.cancel().catch(() => undefined);
          throw new PdfError("limit");
        }
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof PdfError) throw e;
      // 末尾の壊れた圧縮: 読めたところまで使う
    }
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }

  /** ページを順に（ページの木をたどる。リソースは親から受け継ぐ） */
  pages(): { dict: PdfDict; resources: PdfDict }[] {
    const root = this.dict(this.trailer.get("Root"));
    const out: { dict: PdfDict; resources: PdfDict }[] = [];
    const seen = new Set<PdfDict>();
    const walk = (node: PdfDict | undefined, res: PdfDict | undefined, depth: number) => {
      if (node === undefined || seen.has(node) || depth > 64) return;
      seen.add(node);
      const r = this.dict(node.get("Resources")) ?? res;
      const type = nameOf(node.get("Type"));
      if (type === "Page" || (type === undefined && node.has("Contents"))) {
        if (out.length >= this.limits.maxPages) throw new PdfError("limit");
        out.push({ dict: node, resources: r ?? new Map() });
        return;
      }
      const kids = this.get(node.get("Kids"));
      if (Array.isArray(kids)) for (const k of kids) walk(this.dict(k), r, depth + 1);
    };
    walk(this.dict(root?.get("Pages")), undefined, 0);
    return out;
  }

  /** ページの内容のストリームを展開してつなぐ */
  async contents(page: PdfDict): Promise<Uint8Array> {
    const c = this.get(page.get("Contents"));
    const list = Array.isArray(c) ? c.map((x) => this.get(x)) : [c];
    const parts: Uint8Array[] = [];
    for (const s of list) if (isStream(s)) parts.push(await this.decode(s), Uint8Array.of(0x0a));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const x of parts) {
      out.set(x, p);
      p += x.length;
    }
    return out;
  }
}

function unpredictPng(data: Uint8Array, columns: number): Uint8Array {
  const rowLen = columns + 1;
  const rows = Math.floor(data.length / rowLen);
  const out = new Uint8Array(rows * columns);
  const prev = new Uint8Array(columns);
  for (let r = 0; r < rows; r++) {
    const type = data[r * rowLen] as number;
    for (let i = 0; i < columns; i++) {
      const x = data[r * rowLen + 1 + i] as number;
      const a = i > 0 ? (out[r * columns + i - 1] as number) : 0;
      const b = prev[i] as number;
      const c = i > 0 ? (r > 0 ? (out[(r - 1) * columns + i - 1] as number) : 0) : 0;
      let v = x;
      if (type === 1) v = x + a;
      else if (type === 2) v = x + b;
      else if (type === 3) v = x + ((a + b) >> 1);
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[r * columns + i] = v & 0xff;
    }
    prev.set(out.subarray(r * columns, (r + 1) * columns));
  }
  return out;
}

export function isStream(v: unknown): v is PdfStream {
  return typeof v === "object" && v !== null && "raw" in v && "dict" in v;
}
export function nameOf(v: unknown): string | undefined {
  return v instanceof PdfName ? v.name : undefined;
}
export function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

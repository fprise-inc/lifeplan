// 最小限の zip（.xlsx の入れ物）。書き出しは無圧縮（決まった入力から決まったバイト列になる）、読み込みは無圧縮と deflate だけ。
// 返ってきたファイルは信用しない（0018 の6）: 大きさ・中のファイル数・展開した後の大きさに上限を置き、展開しながら上限を超えたら止める。
// 暗号化された zip・zip64・知らない圧縮方式は読まない

export interface ZipLimits {
  /** ファイル全体の大きさ */
  readonly maxFileBytes: number;
  /** 中のファイル数 */
  readonly maxEntries: number;
  /** 1つのファイルを展開した後の大きさ */
  readonly maxEntryBytes: number;
  /** 読んだファイルを展開した後の大きさの合計 */
  readonly maxTotalBytes: number;
}

/** 上限の既定（0018 の未確定「ファイルの上限の値」の仮の値。書き出すシートは 100KB ほど） */
export const DEFAULT_LIMITS: ZipLimits = { maxFileBytes: 10 * 1024 * 1024, maxEntries: 1000, maxEntryBytes: 20 * 1024 * 1024, maxTotalBytes: 60 * 1024 * 1024 };

export class ZipError extends Error {
  readonly kind: "broken" | "tooLarge" | "encrypted" | "unsupported";
  constructor(kind: "broken" | "tooLarge" | "encrypted" | "unsupported", message: string) {
    super(message);
    this.kind = kind;
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (CRC_TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- 書き出し ----

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** 無圧縮の zip を作る。日時は date（"YYYY-MM-DD"）の 0時 */
export function writeZip(entries: readonly ZipEntry[], date: string): Uint8Array {
  const enc = new TextEncoder();
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const dosDate = ((Math.max(1980, y) - 1980) << 9) | (mo << 5) | d;
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // 名前は UTF-8
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, e.data);
    centrals.push(central);
    offset += local.length + e.data.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// ---- 読み込み ----

interface CentralEntry {
  readonly name: string;
  readonly method: number;
  readonly crc: number;
  readonly compSize: number;
  readonly size: number;
  readonly localOffset: number;
}

export class ZipReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly entries = new Map<string, CentralEntry>();
  private readonly limits: ZipLimits;
  private total = 0;

  constructor(bytes: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS) {
    this.bytes = bytes;
    this.limits = limits;
    if (bytes.length > limits.maxFileBytes) throw new ZipError("tooLarge", "ファイルが大きすぎます");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = this.findEnd();
    const count = this.view.getUint16(eocd + 10, true);
    const cdSize = this.view.getUint32(eocd + 12, true);
    const cdOffset = this.view.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError("unsupported", "zip64 は読みません");
    if (count > limits.maxEntries) throw new ZipError("tooLarge", "中のファイルが多すぎます");
    if (cdOffset + cdSize > bytes.length) throw new ZipError("broken", "ファイルが壊れています（目次）");
    const dec = new TextDecoder("utf-8", { fatal: false });
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > bytes.length || this.view.getUint32(p, true) !== 0x02014b50) throw new ZipError("broken", "ファイルが壊れています（目次の項目）");
      const flags = this.view.getUint16(p + 8, true);
      const method = this.view.getUint16(p + 10, true);
      const crc = this.view.getUint32(p + 16, true);
      const compSize = this.view.getUint32(p + 20, true);
      const size = this.view.getUint32(p + 24, true);
      const nameLen = this.view.getUint16(p + 28, true);
      const extraLen = this.view.getUint16(p + 30, true);
      const commentLen = this.view.getUint16(p + 32, true);
      const localOffset = this.view.getUint32(p + 42, true);
      if (p + 46 + nameLen > bytes.length) throw new ZipError("broken", "ファイルが壊れています（名前）");
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (flags & 1) throw new ZipError("encrypted", "暗号化されています");
      this.entries.set(name, { name, method, crc, compSize, size, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  private findEnd(): number {
    const min = Math.max(0, this.bytes.length - 22 - 65535);
    for (let p = this.bytes.length - 22; p >= min; p--) if (this.view.getUint32(p, true) === 0x06054b50) return p;
    throw new ZipError("broken", "zip の形ではありません");
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** 中のファイルを読む（無ければ null）。展開しながら上限を確かめる */
  async read(name: string): Promise<Uint8Array | null> {
    const e = this.entries.get(name);
    if (e === undefined) return null;
    const lp = e.localOffset;
    if (lp + 30 > this.bytes.length || this.view.getUint32(lp, true) !== 0x04034b50) throw new ZipError("broken", `ファイルが壊れています（${name}）`);
    const start = lp + 30 + this.view.getUint16(lp + 26, true) + this.view.getUint16(lp + 28, true);
    if (start + e.compSize > this.bytes.length) throw new ZipError("broken", `ファイルが壊れています（${name}）`);
    const comp = this.bytes.subarray(start, start + e.compSize);
    let data: Uint8Array;
    if (e.method === 0) data = comp;
    else if (e.method === 8) data = await this.inflate(comp);
    else throw new ZipError("unsupported", `知らない圧縮方式です（${name}）`);
    if (data.length > this.limits.maxEntryBytes) throw new ZipError("tooLarge", `展開すると大きすぎます（${name}）`);
    this.total += data.length;
    if (this.total > this.limits.maxTotalBytes) throw new ZipError("tooLarge", "展開すると大きすぎます");
    if (crc32(data) !== e.crc) throw new ZipError("broken", `ファイルが壊れています（${name} の検査の値が合いません）`);
    return data;
  }

  async readText(name: string): Promise<string | null> {
    const b = await this.read(name);
    return b === null ? null : new TextDecoder("utf-8").decode(b);
  }

  private async inflate(comp: Uint8Array): Promise<Uint8Array> {
    const max = Math.min(this.limits.maxEntryBytes, this.limits.maxTotalBytes - this.total);
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const pump = (async () => {
      for (;;) {
        const r = await reader.read();
        if (r.done) return;
        size += r.value.length;
        if (size > max) throw new ZipError("tooLarge", "展開すると大きすぎます");
        chunks.push(r.value);
      }
    })();
    // 書き込みは待たずに進め（読む側が止まると書き込みも止まるため）、読む側の結果で判断する
    const write = (async () => {
      await writer.write(comp as Uint8Array<ArrayBuffer>);
      await writer.close();
    })().catch(() => undefined);
    try {
      await pump;
    } catch (err) {
      await reader.cancel().catch(() => undefined);
      await write;
      if (err instanceof ZipError) throw err;
      throw new ZipError("broken", "ファイルが壊れています（展開できません）");
    }
    await write;
    const out = new Uint8Array(size);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }
}

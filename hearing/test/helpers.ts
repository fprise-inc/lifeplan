// テストの共通部分: シート定義・モデル世帯・本物の計算エンジン（engine/dist/engine.js）・.xlsx の書き換え
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { deflateRawSync } from "node:zlib";
import { OFFICIAL_SHEETS, type SheetDefinition } from "../src/index.ts";
import type { EngineRequest } from "../src/types.ts";
import { crc32, ZipReader } from "../src/xlsx/zip.ts";

export const HEARING_DIR = join(import.meta.dirname, "..");
export const REPO_DIR = join(HEARING_DIR, "..");
export const ENGINE_DIST = join(REPO_DIR, "engine", "dist");

export const basic = (): SheetDefinition => OFFICIAL_SHEETS.find((d) => d.sheetId === "basic" && d.version === 1) as SheetDefinition;

export const OFFICE = { name: "【架空】みらいFP事務所", purpose: "ライフプランの作成と、家計・保険・資産運用のご相談のため", privacyContact: "【架空】みらいFP事務所 個人情報の窓口（privacy@example.invalid）" };

export function modelNames(): string[] {
  return readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

/** 架空のモデル世帯（data/modelHouseholds。CC0） */
export function modelHousehold(name: string): EngineRequest {
  return JSON.parse(readFileSync(join(REPO_DIR, "data", "modelHouseholds", `${name}.json`), "utf8")) as EngineRequest;
}

/** 決まった文字列から作る UUID 第4版の形の ID の列（テストの結果を毎回同じにする） */
export function idSeq(seed: string): () => string {
  let i = 0;
  return () => {
    const h = createHash("sha256").update(`financia-hearing-test:${seed}:${i++}`).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[Number.parseInt(h[16] as string, 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
}

interface WebEngine {
  runBatch(requests: string, packs: string, options: string): string;
}
let cached: { engine: WebEngine; packs: string } | null = null;

export const engineAvailable = (): boolean => existsSync(join(ENGINE_DIST, "engine.js"));

/** 本物の計算エンジンで計算する（画面と同じまとめた JS）。エラーなら投げる */
export function preview(req: EngineRequest): { error?: unknown } & Record<string, unknown> {
  if (cached === null) {
    const ctx: Record<string, unknown> = {};
    vm.createContext(ctx);
    vm.runInContext(readFileSync(join(ENGINE_DIST, "engine.js"), "utf8") + ";globalThis.FinanciaEngine=FinanciaEngine;", ctx);
    const dir = join(ENGINE_DIST, "regulation");
    const packs = `[${readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => readFileSync(join(dir, f), "utf8")).join(",")}]`;
    cached = { engine: ctx.FinanciaEngine as WebEngine, packs };
  }
  const out = JSON.parse(cached.engine.runBatch(JSON.stringify([req]), cached.packs, '{"preview":true}')) as ({ error?: unknown } & Record<string, unknown>)[];
  return out[0] as { error?: unknown } & Record<string, unknown>;
}

// ---- .xlsx の書き換え（顧客の手元での編集・別のソフトでの保存し直しを試す） ----

export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const z = new ZipReader(bytes);
  const out = new Map<string, Uint8Array>();
  for (const n of z.names()) out.set(n, (await z.read(n)) as Uint8Array);
  return out;
}

/** zip を作り直す（deflate で圧縮する。Excel が保存したファイルと同じ形） */
export function rezip(files: Map<string, Uint8Array>, opts: { stored?: boolean } = {}): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nm = Buffer.from(enc.encode(name));
    const comp = opts.stored === true ? Buffer.from(data) : deflateRawSync(data);
    const method = opts.stored === true ? 0 : 8;
    const crc = crc32(data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(0x0800, 6);
    l.writeUInt16LE(method, 8);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(comp.length, 18);
    l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nm.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(l, nm, comp);
    centrals.push(c, nm);
    offset += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

export const text = (b: Uint8Array | undefined): string => new TextDecoder().decode(b);
export const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/** 中の文書を書き換える */
export async function editXlsx(src: Uint8Array, edit: (files: Map<string, Uint8Array>) => void): Promise<Uint8Array> {
  const files = await unzip(src);
  edit(files);
  return rezip(files);
}

/**
 * Excel で行を挿入したのと同じ書き換え: 記入欄のシートの at 行より下を1行ずらし、名前の定義もずらす
 */
export function insertRow(files: Map<string, Uint8Array>, sheetPath: string, sheetName: string, at: number): void {
  const shift = (ref: string) => ref.replace(/([A-Z]+)(\d+)/g, (m, col: string, row: string) => (Number(row) >= at ? `${col}${Number(row) + 1}` : m));
  let s = text(files.get(sheetPath));
  s = s.replace(/<row r="(\d+)"/g, (m, r: string) => (Number(r) >= at ? `<row r="${Number(r) + 1}"` : m));
  s = s.replace(/ (r|sqref|ref)="([^"]+)"/g, (_m, a: string, ref: string) => ` ${a}="${shift(ref)}"`);
  files.set(sheetPath, bytes(s));
  let wb = text(files.get("xl/workbook.xml"));
  wb = wb.replace(/(<definedName [^>]*>)([^<]+)(<\/definedName>)/g, (m, a: string, ref: string, b: string) => {
    const quoted = `'${sheetName}'!`;
    if (!ref.startsWith(quoted)) return m;
    return a + quoted + ref.slice(quoted.length).replace(/\$([A-Z]+)\$(\d+)/, (_x, col: string, row: string) => `$${col}$${Number(row) >= at ? Number(row) + 1 : row}`) + b;
  });
  files.set("xl/workbook.xml", bytes(wb));
}

/** Excel・Google スプレッドシートで保存し直したのと同じ書き換え: 文字のセルを共有文字列にする */
export function toSharedStrings(files: Map<string, Uint8Array>): void {
  const sst: string[] = [];
  for (const [name, data] of files) {
    if (!name.startsWith("xl/worksheets/")) continue;
    const s = text(data).replace(/<c r="([A-Z]+\d+)" s="(\d+)" t="inlineStr"><is><t xml:space="preserve">([^<]*)<\/t><\/is><\/c>/g, (_m, r: string, st: string, t: string) => {
      sst.push(t);
      return `<c r="${r}" s="${st}" t="s"><v>${sst.length - 1}</v></c>`;
    });
    files.set(name, bytes(s));
  }
  files.set("xl/sharedStrings.xml", bytes(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map((t) => `<si><t>${t}</t><rPh sb="0" eb="1"><t>ルビ</t></rPh></si>`).join("")}</sst>`));
  let rels = text(files.get("xl/_rels/workbook.xml.rels"));
  rels = rels.replace("</Relationships>", '<Relationship Id="rIdSst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
  files.set("xl/_rels/workbook.xml.rels", bytes(rels));
}

/** セルの値を書き換える（顧客の記入）。値が null なら空にする */
export function setCell(files: Map<string, Uint8Array>, sheetPath: string, ref: string, xml: string | null): void {
  let s = text(files.get(sheetPath));
  const re = new RegExp(`<c r="${ref}" s="(\\d+)"(?: t="[a-zA-Z]+")?(?:/>|>.*?</c>)`);
  const m = re.exec(s);
  if (m === null) throw new Error(`セルが無い: ${ref}`);
  const st = m[1] as string;
  s = s.replace(re, xml === null ? `<c r="${ref}" s="${st}"/>` : xml.replace(/^<c\b/, `<c r="${ref}" s="${st}"`));
  files.set(sheetPath, bytes(s));
}

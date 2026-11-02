// 開発用のサーバーだけ（本番のビルドには入らない）: 本体のカスタム層の命令（custom_texts_*・custom_dir_*）の代わり。
// カスタム層は FINANCIA_DEV_CUSTOM_DIR（無ければ OS の一時フォルダの financia-dev-custom）。承認はメモリの中だけで、台帳の改ざん検出は無い。
// 検査は形・一覧の id・できる操作・同じ id の行だけの簡単な物（正の検査は本体の custom-layer。画面の見え方を確かめるための物）。
// 種類（kind）は説明の文（settings/texts.json）・名前（settings/terms.json）・欄の見せ方（settings/fields.json）。中の行の形は本体と同じ
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_DIR } from "./lib.ts";
import type { CatalogEntry } from "./textsCatalog.ts";

type Kind = "texts" | "terms" | "fields";
const KINDS: readonly Kind[] = ["texts", "terms", "fields"];

/** 一覧（prepare-assets が作る。textsCatalog.ts の CATALOG_PATH などと同じ場所。画面の定義を読み込まないように、ここでは場所だけ持つ） */
const catalogPath = (k: Kind): string => join(APP_DIR, "src", "generated", `${k}-catalog.json`);

type Op = "replace" | "append" | "hide" | "order";
interface Row {
  id: string;
  do: Op;
  text?: string;
  basedOn: string;
  order?: number;
}
interface Issue {
  row: number | null;
  id: string | null;
  code: string;
  message: string;
}

const dir = (): string => process.env.FINANCIA_DEV_CUSTOM_DIR ?? join(tmpdir(), "financia-dev-custom");
const file = (k: Kind): string => join(dir(), "settings", `${k}.json`);
const fp = (b: Buffer): string => `sha256:${createHash("sha256").update(b).digest("hex")}`;
const catalog = (k: Kind): Map<string, CatalogEntry> => new Map((JSON.parse(readFileSync(catalogPath(k), "utf8")) as { entries: CatalogEntry[] }).entries.map((e) => [e.id, e]));

const approvedOf: Record<Kind, { fingerprint: string; rows: Row[]; at: number } | null> = { texts: null, terms: null, fields: null };
const declinedOf: Record<Kind, string | null> = { texts: null, terms: null, fields: null };

const DEFAULT_KEYS = ["default", "defaults", "defaultValue", "value", "values", "initial", "initialValue"];

/** ファイルの行を中の形にする（名前は text、欄の見せ方は hide → do: hide・order） */
function toRows(k: Kind, list: unknown[], errors: Issue[]): Row[] {
  if (k === "texts") return list as Row[];
  if (k === "terms") return (list as { id: string; name?: string; basedOn: string }[]).map((r) => ({ id: r.id, do: "replace", text: r.name ?? "", basedOn: r.basedOn }));
  return (list as Record<string, unknown>[]).map((r, i) => {
    for (const key of Object.keys(r)) if (DEFAULT_KEYS.includes(key)) errors.push({ row: i, id: String(r.id), code: "E_FIELDS_DEFAULT", message: "既定の値はカスタム層では変えられません。アプリの「事務所の既定値」の画面で変えてください" });
    return { id: String(r.id), do: r.hide === true ? "hide" : "order", basedOn: "", ...(typeof r.order === "number" ? { order: r.order } : {}) };
  });
}

/** 中の形をファイルの形にする */
function fromRows(k: Kind, rows: Row[]): unknown[] {
  if (k === "texts") return rows;
  if (k === "terms") return rows.map((r) => ({ id: r.id, name: r.text ?? "", basedOn: r.basedOn }));
  return rows.map((r) => ({ id: r.id, ...(r.do === "hide" ? { hide: true } : {}), ...(r.order !== undefined ? { order: r.order } : {}) }));
}

function read(k: Kind): { bytes: Buffer | null; rows: Row[] | null; errors: Issue[]; unused: string[] } {
  if (!existsSync(file(k))) return { bytes: null, rows: null, errors: [], unused: [] };
  const bytes = readFileSync(file(k));
  const errors: Issue[] = [];
  const unused: string[] = [];
  let v: unknown;
  try {
    v = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { bytes, rows: null, errors: [{ row: null, id: null, code: "E_TEXTS_JSON", message: "JSON として読めません" }], unused };
  }
  const o = v as { schema?: unknown; entries?: unknown };
  if (o.schema !== `${k}@1.0`) errors.push({ row: null, id: null, code: "E_SCHEMA", message: `schema は "${k}@1.0" にしてください` });
  if (!Array.isArray(o.entries)) return { bytes, rows: null, errors: [...errors, { row: null, id: null, code: "E_ENTRIES", message: "entries（行の並び）がありません" }], unused };
  const cat = catalog(k);
  const seen = new Set<string>();
  const rows = toRows(k, o.entries as unknown[], errors);
  rows.forEach((r, i) => {
    if (seen.has(r.id)) errors.push({ row: i, id: r.id, code: "E_TEXTS_DUPLICATE", message: "同じ id の行が2つあります（1つにまとめてください）" });
    seen.add(r.id);
    const e = cat.get(r.id);
    if (e === undefined) return void unused.push(r.id);
    if (k !== "fields" && !e.ops.includes(r.do)) errors.push({ row: i, id: r.id, code: "E_TEXTS_NOT_HIDEABLE", message: "この文は消せません。言い方は書き換えられます" });
  });
  return { bytes, rows, errors, unused };
}

function status(k: Kind): unknown {
  const cat = catalog(k);
  const f = read(k);
  const approved = approvedOf[k];
  const declined = declinedOf[k];
  const cur = f.bytes === null ? "none" : fp(f.bytes);
  const approvedFp = approved?.fingerprint ?? "none";
  const state = cur === approvedFp ? (approved !== null ? "approved" : "none") : declined === cur ? "declined" : "pending";
  const text = (r: Row | undefined) => (r === undefined ? null : { do: r.do, text: r.text ?? null, ...(r.order !== undefined ? { order: r.order } : {}) });
  const curRows = approved?.rows ?? [];
  const nextRows = f.rows ?? (f.bytes === null ? [] : curRows);
  const ids = [...new Set([...nextRows.map((r) => r.id), ...curRows.map((r) => r.id)])];
  const rows = ids.map((id) => {
    const e = cat.get(id);
    const c = text(curRows.find((r) => r.id === id));
    const n = text(nextRows.find((r) => r.id === id));
    return { id, where: e?.where ?? "", audience: e?.audience ?? null, official: e?.text ?? null, current: c, next: n, changed: JSON.stringify(c) !== JSON.stringify(n), unused: e === undefined };
  });
  const updates = curRows.flatMap((r) => {
    const e = cat.get(r.id);
    return e === undefined || r.basedOn === "" || e.hash === r.basedOn ? [] : [{ id: r.id, nowId: r.id, where: e.where, before: null, official: e.text, office: text(r), stopped: false, reason: null }];
  });
  const effective = curRows.flatMap((r) => {
    const e = cat.get(r.id);
    return e === undefined ? [] : [{ id: r.id, do: r.do, text: r.text ?? null, ...(r.order !== undefined ? { order: r.order } : {}), official: e.text, officialChanged: r.basedOn !== "" && e.hash !== r.basedOn }];
  });
  return { kind: k, dir: dir(), isDefaultDir: process.env.FINANCIA_DEV_CUSTOM_DIR === undefined, folderExists: existsSync(dir()), file: f.bytes === null ? "none" : "present", fingerprint: cur, state, errors: f.errors, warnings: [], unused: f.unused, approved: approved === null ? null : { fingerprint: approved.fingerprint, approvedAt: approved.at }, ledgerReset: false, approvedMissing: false, rows, updates, effective, catalogSize: cat.size };
}

/** 命令の代わり。失敗は符号を投げる */
export function devCustom(op: string, args: Record<string, unknown>): unknown {
  const k = (KINDS as readonly unknown[]).includes(args.kind) ? (args.kind as Kind) : "texts";
  const f = read(k);
  const cur = f.bytes === null ? "none" : fp(f.bytes);
  const approved = approvedOf[k];
  switch (op) {
    case "status":
      return status(k);
    case "approve":
      if (args.fingerprint !== cur) throw "E_CUSTOM_CHANGED";
      if (f.errors.length > 0) throw "E_CUSTOM_INVALID";
      approvedOf[k] = f.rows === null ? null : { fingerprint: cur, rows: f.rows, at: Math.floor(Date.now() / 1000) };
      declinedOf[k] = null;
      return status(k);
    case "decline":
      if (args.fingerprint !== cur) throw "E_CUSTOM_CHANGED";
      declinedOf[k] = cur;
      return status(k);
    case "revert":
      approvedOf[k] = null;
      declinedOf[k] = cur === "none" ? null : cur;
      return status(k);
    case "rows": {
      if (approved === null || approved.fingerprint !== cur) throw "E_CUSTOM_PENDING";
      const ids = args.ids as string[];
      const cat = catalog(k);
      const rows = args.keep === true ? approved.rows.map((r) => (ids.includes(r.id) ? { ...r, basedOn: cat.get(r.id)?.hash ?? r.basedOn } : r)) : approved.rows.filter((r) => !ids.includes(r.id));
      const bytes = Buffer.from(`${JSON.stringify({ schema: `${k}@1.0`, entries: fromRows(k, rows) }, null, 2)}\n`);
      writeFileSync(file(k), bytes);
      approvedOf[k] = { fingerprint: fp(bytes), rows, at: Math.floor(Date.now() / 1000) };
      return status(k);
    }
    case "resetLedger":
      for (const x of KINDS) {
        approvedOf[x] = null;
        declinedOf[x] = null;
      }
      return status(k);
    case "chooseDir":
    case "resetDir":
      return status(k);
    case "createDir":
      mkdirSync(join(dir(), "settings"), { recursive: true });
      return status(k);
  }
  throw "E_DEV_UNKNOWN";
}

// 開発用のサーバーだけ（本番のビルドには入らない）: 本体のカスタム層の命令（custom_texts_*・custom_dir_*）の代わり。
// カスタム層は FINANCIA_DEV_CUSTOM_DIR（無ければ OS の一時フォルダの financia-dev-custom）。承認はメモリの中だけで、台帳の改ざん検出は無い。
// 検査は形・一覧の id・できる操作・同じ id の行だけの簡単な物（正の検査は本体の custom-layer。画面の見え方を確かめるための物）
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_DIR } from "./lib.ts";
import type { CatalogEntry } from "./textsCatalog.ts";

/** 説明の一覧（prepare-assets が作る。textsCatalog.ts の CATALOG_PATH と同じ場所。画面の定義を読み込まないように、ここでは場所だけ持つ） */
const CATALOG_PATH = join(APP_DIR, "src", "generated", "texts-catalog.json");

type Op = "replace" | "append" | "hide";
interface Row {
  id: string;
  do: Op;
  text?: string;
  basedOn: string;
}
interface Issue {
  row: number | null;
  id: string | null;
  code: string;
  message: string;
}

const dir = (): string => process.env.FINANCIA_DEV_CUSTOM_DIR ?? join(tmpdir(), "financia-dev-custom");
const file = (): string => join(dir(), "settings", "texts.json");
const fp = (b: Buffer): string => `sha256:${createHash("sha256").update(b).digest("hex")}`;
const catalog = (): Map<string, CatalogEntry> => new Map((JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as { entries: CatalogEntry[] }).entries.map((e) => [e.id, e]));

let approved: { fingerprint: string; rows: Row[]; at: number } | null = null;
let declined: string | null = null;

function read(): { bytes: Buffer | null; rows: Row[] | null; errors: Issue[]; unused: string[] } {
  if (!existsSync(file())) return { bytes: null, rows: null, errors: [], unused: [] };
  const bytes = readFileSync(file());
  const errors: Issue[] = [];
  const unused: string[] = [];
  let v: unknown;
  try {
    v = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { bytes, rows: null, errors: [{ row: null, id: null, code: "E_TEXTS_JSON", message: "JSON として読めません" }], unused };
  }
  const o = v as { schema?: unknown; entries?: unknown };
  if (o.schema !== "texts@1.0") errors.push({ row: null, id: null, code: "E_TEXTS_SCHEMA", message: 'schema は "texts@1.0" にしてください' });
  if (!Array.isArray(o.entries)) return { bytes, rows: null, errors: [...errors, { row: null, id: null, code: "E_TEXTS_ENTRIES", message: "entries（行の並び）がありません" }], unused };
  const cat = catalog();
  const seen = new Set<string>();
  const rows = o.entries as Row[];
  rows.forEach((r, i) => {
    if (seen.has(r.id)) errors.push({ row: i, id: r.id, code: "E_TEXTS_DUPLICATE", message: "同じ id の行が2つあります（1つにまとめてください）" });
    seen.add(r.id);
    const e = cat.get(r.id);
    if (e === undefined) return void unused.push(r.id);
    if (!e.ops.includes(r.do)) errors.push({ row: i, id: r.id, code: "E_TEXTS_NOT_HIDEABLE", message: "この文は消せません。言い方は書き換えられます" });
  });
  return { bytes, rows, errors, unused };
}

function status(): unknown {
  const cat = catalog();
  const f = read();
  const cur = f.bytes === null ? "none" : fp(f.bytes);
  const approvedFp = approved?.fingerprint ?? "none";
  const state = cur === approvedFp ? (approved !== null ? "approved" : "none") : declined === cur ? "declined" : "pending";
  const text = (r: Row | undefined) => (r === undefined ? null : { do: r.do, text: r.text ?? null });
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
    return e === undefined || e.hash === r.basedOn ? [] : [{ id: r.id, nowId: r.id, where: e.where, before: null, official: e.text, office: text(r), stopped: false, reason: null }];
  });
  const effective = curRows.flatMap((r) => {
    const e = cat.get(r.id);
    return e === undefined ? [] : [{ id: r.id, do: r.do, text: r.text ?? null, official: e.text, officialChanged: e.hash !== r.basedOn }];
  });
  return { dir: dir(), isDefaultDir: process.env.FINANCIA_DEV_CUSTOM_DIR === undefined, folderExists: existsSync(dir()), file: f.bytes === null ? "none" : "present", fingerprint: cur, state, errors: f.errors, warnings: [], unused: f.unused, approved: approved === null ? null : { fingerprint: approved.fingerprint, approvedAt: approved.at }, ledgerReset: false, approvedMissing: false, rows, updates, effective, catalogSize: cat.size };
}

/** 命令の代わり。失敗は符号を投げる */
export function devCustom(op: string, args: Record<string, unknown>): unknown {
  const f = read();
  const cur = f.bytes === null ? "none" : fp(f.bytes);
  switch (op) {
    case "status":
      return status();
    case "approve":
      if (args.fingerprint !== cur) throw "E_CUSTOM_CHANGED";
      if (f.errors.length > 0) throw "E_CUSTOM_INVALID";
      approved = f.rows === null ? null : { fingerprint: cur, rows: f.rows, at: Math.floor(Date.now() / 1000) };
      declined = null;
      return status();
    case "decline":
      if (args.fingerprint !== cur) throw "E_CUSTOM_CHANGED";
      declined = cur;
      return status();
    case "revert":
      approved = null;
      declined = cur === "none" ? null : cur;
      return status();
    case "rows": {
      if (approved === null || approved.fingerprint !== cur) throw "E_CUSTOM_PENDING";
      const ids = args.ids as string[];
      const cat = catalog();
      const rows = args.keep === true ? approved.rows.map((r) => (ids.includes(r.id) ? { ...r, basedOn: cat.get(r.id)?.hash ?? r.basedOn } : r)) : approved.rows.filter((r) => !ids.includes(r.id));
      const bytes = Buffer.from(`${JSON.stringify({ schema: "texts@1.0", entries: rows }, null, 2)}\n`);
      writeFileSync(file(), bytes);
      approved = { fingerprint: fp(bytes), rows, at: Math.floor(Date.now() / 1000) };
      return status();
    }
    case "resetLedger":
      approved = null;
      declined = null;
      return status();
    case "chooseDir":
    case "resetDir":
      return status();
    case "createDir":
      mkdirSync(join(dir(), "settings"), { recursive: true });
      return status();
  }
  throw "E_DEV_UNKNOWN";
}

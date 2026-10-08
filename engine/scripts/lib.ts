// ビルド用の道具の共通部分（Node で動かす。エンジン本体には入らない）
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE_DIR = fileURLToPath(new URL("..", import.meta.url));
export const REPO_DIR = join(ENGINE_DIR, "..");

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** キーを辞書順に並べた JSON（正規化の形）。数は整数だけを許す */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  if (typeof v === "number" && !Number.isSafeInteger(v)) throw new Error("整数でない数、または安全な整数の範囲外の数があります");
  return v;
}

export function listFiles(dir: string, filter: (path: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (filter(p)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** OS に依らない相対パス（指紋の計算に使う） */
export function posixRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Ajv の共通の設定。型と required の書き漏れの警告は if/then の部分スキーマで誤検知するので切る */
export const AJV_OPTIONS = { strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true } as const;

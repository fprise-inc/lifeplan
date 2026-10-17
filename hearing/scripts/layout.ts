// シート定義の配置（layout.rows）を、項目の並びから決まった手順で作る（0018 の4: 回答のセルの位置はシートIDと版ごとに固定し、シート定義に書く）。
// 開発中（status: draft）のシート定義だけを扱う。公開した版（published・retired）は書いてある配置が正で、作り直さない
// （作る手順を後から変えても、公開した版の配置は変わらない。中身の決まりは test/definition.test.ts で確かめる）。
//   node scripts/layout.ts          … draft の配置を作り直して書く
//   node scripts/layout.ts --check  … draft の配置が項目の並びと食い違っていないかを確かめる（CI）
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLayoutRows } from "../src/layout.ts";
import type { SheetDefinition } from "../src/definition.ts";

/** 読みやすい JSON（短い物・配列は1行に。配置の行・選択肢を1行ずつ見られるように） */
export function prettyJson(v: unknown, indent = ""): string {
  const flat = JSON.stringify(v);
  if (v === null || typeof v !== "object" || flat.length + indent.length <= 140) return flat;
  const next = indent + "  ";
  if (Array.isArray(v)) return `[\n${v.map((x) => next + prettyJson(x, next)).join(",\n")}\n${indent}]`;
  const o = v as Record<string, unknown>;
  const body = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .map((k) => `${next}${JSON.stringify(k)}: ${prettyJson(o[k], next)}`);
  return `{\n${body.join(",\n")}\n${indent}}`;
}

const check = process.argv.includes("--check");
const root = join(import.meta.dirname, "..", "sheets");
let bad = 0;
for (const id of readdirSync(root)) {
  for (const f of readdirSync(join(root, id)).filter((x) => x.endsWith(".json"))) {
    const path = join(root, id, f);
    const text = readFileSync(path, "utf8");
    const def = JSON.parse(text) as SheetDefinition;
    if (def.status !== "draft") continue;
    const rows = buildLayoutRows(def);
    const next = { ...def, layout: { ...def.layout, rows } };
    const out = prettyJson(next) + "\n";
    if (out === text) continue;
    if (check) {
      console.error(`${id}/${f}: 配置が項目の並びと食い違っている（npm run layout で作り直す）`);
      bad++;
      continue;
    }
    writeFileSync(path, out);
    console.log(`${id}/${f}: 配置を作り直した（${rows.length}行）`);
  }
}
if (bad > 0) process.exit(1);

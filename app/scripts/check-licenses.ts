// 0021: 画面の npm の依存のライセンスの検査。許可の一覧にないものが入ったら止める。
// 配布物（画面のまとめた JS・フォント）に入る依存（package.json の dependencies とその依存）は、許可の一覧だけ（フォントは OFL-1.1 も）。
// 開発だけで使う道具の依存は、MPL-2.0 を改変しない場合に許す（0021 の追記）
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR } from "./lib.ts";

const ALLOWED = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unicode-3.0", "Unicode-DFS-2016", "Unlicense", "CC0-1.0", "0BSD", "BSL-1.0", "BlueOak-1.0.0"]);
const DEV_ONLY = new Set(["MPL-2.0"]);
const FONT_ONLY = new Set(["OFL-1.1"]);

type Pkg = { name: string; version: string; license?: unknown; licenses?: unknown; dependencies?: Record<string, string> };

function satisfied(expr: string, extra: Set<string>): boolean {
  const s = expr.trim().replace(/^\((.*)\)$/, "$1");
  const ors = s.split(/\s+OR\s+/);
  if (ors.length > 1) return ors.some((x) => satisfied(x, extra));
  const ands = s.split(/\s+AND\s+/);
  if (ands.length > 1) return ands.every((x) => satisfied(x, extra));
  return ALLOWED.has(s) || extra.has(s);
}

function licenseOf(p: Pkg): string | null {
  if (typeof p.license === "string") return p.license;
  if (p.license !== null && typeof p.license === "object" && typeof (p.license as { type?: unknown }).type === "string") return (p.license as { type: string }).type;
  if (Array.isArray(p.licenses)) return p.licenses.map((l: { type?: string }) => l.type ?? "").join(" OR ");
  return null;
}

const nm = join(APP_DIR, "node_modules");
const read = (name: string, base = nm): Pkg | null => {
  const pj = join(base, name, "package.json");
  return existsSync(pj) ? (JSON.parse(readFileSync(pj, "utf8")) as Pkg) : null;
};

// 配布物に入る依存の集まり（dependencies をたどる）
const root = JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf8")) as Pkg;
const runtime = new Set<string>();
const todo = Object.keys(root.dependencies ?? {});
while (todo.length > 0) {
  const n = todo.pop() as string;
  if (runtime.has(n)) continue;
  runtime.add(n);
  for (const d of Object.keys(read(n)?.dependencies ?? {})) todo.push(d);
}

const problems: string[] = [];
let count = 0;
const walk = (dir: string, prefix: string): void => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    if (name.startsWith("@")) {
      walk(join(dir, name), `${name}/`);
      continue;
    }
    const full = prefix + name;
    const p = read(name, dir);
    if (p === null) continue;
    walk(join(dir, name, "node_modules"), "");
    count++;
    const lic = licenseOf(p);
    const id = `${p.name}@${p.version}`;
    if (lic === null) {
      problems.push(`${id}: ライセンスの表示が無い`);
      continue;
    }
    const extra = runtime.has(full) ? (full.startsWith("@fontsource/") ? FONT_ONLY : new Set<string>()) : DEV_ONLY;
    if (!satisfied(lic, extra)) problems.push(`${id}: ${lic}（${runtime.has(full) ? "配布物に入る" : "開発だけ"}）`);
  }
};
walk(nm, "");
if (problems.length > 0) {
  console.error("許可の一覧にないライセンス（0021）:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`ライセンスの検査: ${count} 件 OK（配布物に入る依存 ${runtime.size} 件）`);

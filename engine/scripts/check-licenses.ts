// 0021: npm の依存のライセンスの検査。許可の一覧にないものが入ったら止める
// エンジンのまとめた JS（配布物）には npm の依存のコードは入らない（scripts/build.ts で確かめる）。
// ここでは開発の道具を含めて、node_modules のすべてを調べる
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_DIR } from "./lib.ts";

const ALLOWED = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unicode-3.0", "Unicode-DFS-2016",
  "Unlicense", "CC0-1.0", "0BSD", "BSL-1.0", "BlueOak-1.0.0",
]);

/**
 * 0021 の追記: 開発だけで使う道具の依存（配布物に入らないもの）は、MPL-2.0 を改変しない場合に許す。
 * この npm の依存はすべて開発の道具（テスト・lint・ビルド）で、配布物（dist/engine.js）には入らない（scripts/build.ts で確かめる）
 */
const DEV_ONLY_ALLOWED = new Set(["MPL-2.0"]);

const FORBIDDEN = /\b(A?GPL|LGPL|SSPL)|\bNC\b|NonCommercial/i;

/** SPDX の式（OR・AND・括弧）を、許可の一覧で満たせるか */
export function satisfied(expr: string, devOnly = false): boolean {
  const s = expr.trim().replace(/^\((.*)\)$/, "$1");
  const ors = s.split(/\s+OR\s+/);
  if (ors.length > 1) return ors.some((x) => satisfied(x, devOnly));
  const ands = s.split(/\s+AND\s+/);
  if (ands.length > 1) return ands.every((x) => satisfied(x, devOnly));
  return ALLOWED.has(s) || (devOnly && DEV_ONLY_ALLOWED.has(s));
}

function licenseOf(pkg: { license?: unknown; licenses?: unknown }): string | null {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license !== null && typeof pkg.license === "object" && typeof (pkg.license as { type?: unknown }).type === "string") {
    return (pkg.license as { type: string }).type;
  }
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l: { type?: string }) => l.type ?? "").join(" OR ");
  return null;
}

/** node_modules を調べ、問題の一覧とライセンスごとの件数を返す */
export function checkLicenses(nodeModules: string): { problems: string[]; seen: Map<string, string> } {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      if (name.startsWith("@")) {
        walk(p);
        continue;
      }
      const pj = join(p, "package.json");
      if (existsSync(pj)) {
        const pkg = JSON.parse(readFileSync(pj, "utf8")) as { name: string; version: string; license?: unknown; licenses?: unknown };
        const lic = licenseOf(pkg);
        const id = `${pkg.name}@${pkg.version}`;
        seen.set(id, lic ?? "(なし)");
        if (lic === null) problems.push(`${id}: ライセンスの表示が無い`);
        else if (FORBIDDEN.test(lic) && !satisfied(lic, true)) problems.push(`${id}: 禁止のライセンス ${lic}`);
        else if (!satisfied(lic, true)) problems.push(`${id}: 許可の一覧に無いライセンス ${lic}`);
      }
      walk(join(p, "node_modules"));
    }
  };
  walk(nodeModules);
  return { problems, seen };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, seen } = checkLicenses(join(ENGINE_DIR, "node_modules"));
  const counts = new Map<string, number>();
  for (const l of seen.values()) counts.set(l, (counts.get(l) ?? 0) + 1);
  console.log(`npm の依存 ${seen.size} 件: ${[...counts.entries()].map(([l, n]) => `${l} ${n}`).join(", ")}`);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
}

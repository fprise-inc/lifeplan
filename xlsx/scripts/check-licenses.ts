// 0021: npm の依存のライセンスの検査。表計算のファイルの部品（src/）は npm の依存を使わないので、node_modules はすべて開発の道具。
// 許可の一覧にないものが入ったら止める（開発だけの道具は MPL-2.0 を改変しない場合に許す。0021 の追記）
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unicode-3.0", "Unicode-DFS-2016", "Unlicense", "CC0-1.0", "0BSD", "BSL-1.0", "BlueOak-1.0.0", "MPL-2.0"]);

function satisfied(expr: string): boolean {
  const s = expr.trim().replace(/^\((.*)\)$/, "$1");
  const ors = s.split(/\s+OR\s+/);
  if (ors.length > 1) return ors.some((x) => satisfied(x));
  const ands = s.split(/\s+AND\s+/);
  if (ands.length > 1) return ands.every((x) => satisfied(x));
  return ALLOWED.has(s);
}

const dir = join(import.meta.dirname, "..");
const own = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
if (Object.keys(own.dependencies ?? {}).length > 0) {
  console.error("xlsx/ の dependencies は空にする（src/ は npm の依存を使わない）");
  process.exit(1);
}
const nm = join(dir, "node_modules");
const bad: string[] = [];
let count = 0;
function walk(base: string): void {
  if (!existsSync(base)) return;
  for (const name of readdirSync(base)) {
    if (name.startsWith(".")) continue;
    const p = join(base, name);
    if (name.startsWith("@")) {
      walk(p);
      continue;
    }
    const pj = join(p, "package.json");
    if (existsSync(pj)) {
      const pkg = JSON.parse(readFileSync(pj, "utf8")) as { name?: string; version?: string; license?: unknown };
      if (pkg.name !== undefined) {
        count++;
        const lic = typeof pkg.license === "string" ? pkg.license : null;
        if (lic === null || !satisfied(lic)) bad.push(`${pkg.name}@${pkg.version}: ${String(lic)}`);
      }
    }
    walk(join(p, "node_modules"));
  }
}
walk(nm);
if (bad.length > 0) {
  console.error(`許可の一覧にないライセンス:\n${bad.join("\n")}`);
  process.exit(1);
}
console.log(`npm の依存 ${count} 個のライセンスを確かめた（すべて開発の道具）`);

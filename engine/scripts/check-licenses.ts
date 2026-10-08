// 0021: npm の依存のライセンスの検査。許可の一覧にないものが入ったら止める
// エンジンのまとめた JS（配布物）には npm の依存のコードは入らない（scripts/build.ts で確かめる）。
// ここでは開発の道具を含めて、node_modules のすべてを調べる
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_DIR } from "./lib.ts";

const ALLOWED = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unicode-3.0", "Unicode-DFS-2016",
  "Unlicense", "CC0-1.0", "0BSD", "BSL-1.0",
]);

/** 部品ごとの例外（名前を一つずつ載せる）。どれも開発の道具の依存で、配布物には入らない */
const EXCEPTIONS: Readonly<Record<string, { license: string; reason: string }>> = {
  // 0021: MPL-2.0 は改変せずに使う場合だけ、部品ごとに許す（vitest → vite が使う CSS の処理）
  lightningcss: { license: "MPL-2.0", reason: "テストの道具（vitest）の依存。改変しない" },
  "lightningcss-linux-x64-gnu": { license: "MPL-2.0", reason: "同上（Linux 用のバイナリ）" },
  "lightningcss-linux-arm64-gnu": { license: "MPL-2.0", reason: "同上" },
  "lightningcss-darwin-arm64": { license: "MPL-2.0", reason: "同上（macOS 用）" },
  "lightningcss-darwin-x64": { license: "MPL-2.0", reason: "同上（macOS 用）" },
  "lightningcss-win32-x64-msvc": { license: "MPL-2.0", reason: "同上（Windows 用）" },
  // BlueOak-1.0.0 は許可の一覧に無いが、MIT と同じ程度に緩い。ESLint（0002 で使う）の依存
  minimatch: { license: "BlueOak-1.0.0", reason: "lint の道具（eslint・typescript-eslint）の依存" },
};

const FORBIDDEN = /\b(A?GPL|LGPL|SSPL)|\bNC\b|NonCommercial/i;

/** SPDX の式（OR・AND・括弧）を、許可の一覧で満たせるか */
export function satisfied(expr: string): boolean {
  const s = expr.trim().replace(/^\((.*)\)$/, "$1");
  const ors = s.split(/\s+OR\s+/);
  if (ors.length > 1) return ors.some(satisfied);
  const ands = s.split(/\s+AND\s+/);
  if (ands.length > 1) return ands.every(satisfied);
  return ALLOWED.has(s);
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
        // lightningcss は OS・CPU ごとのバイナリの部品（-linux-x64-musl など）が増えるので、接頭辞でまとめて扱う
        const ex = EXCEPTIONS[pkg.name] ?? (pkg.name.startsWith("lightningcss-") ? EXCEPTIONS["lightningcss"] : undefined);
        if (lic === null) problems.push(`${id}: ライセンスの表示が無い`);
        else if (ex !== undefined && ex.license === lic) {
          // 例外の一覧にある
        } else if (FORBIDDEN.test(lic) && !satisfied(lic)) problems.push(`${id}: 禁止のライセンス ${lic}`);
        else if (!satisfied(lic)) problems.push(`${id}: 許可の一覧に無いライセンス ${lic}`);
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

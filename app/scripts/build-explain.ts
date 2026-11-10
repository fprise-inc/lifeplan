// AI接続口（crates/lifeplan）に同梱する「数字の根拠」の読み方（src/connector/explain.ts。0183）と計算の前の処理（src/connector/prepare.ts。0184）と主な数字（src/connector/summary.ts。0194）を、
// 1つの JS（crates/lifeplan/dist/explain.js）にまとめる。
// - 接続口はこれを計算と同じ固めた実行環境（quickjs-ng）で動かす。画面の根拠のパネルと同じ関数なので、根拠の文が画面とずれない
// - 外の部品（npm のパッケージ）を1つも入れない（入ったら止める）。動的な import をしない（1つの iife）
// - 中身が変わっていなければ作り直さない（src/・report/src/・hearing/src/ の指紋で見る）
// 直接流すとき: npm run build:explain（先に prepare-assets で src/generated を作る）
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { build } from "vite";
import { APP_DIR, REPO_DIR } from "./lib.ts";

export const EXPLAIN_OUT = join(REPO_DIR, "crates", "lifeplan", "dist");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|json)$/.test(name)) out.push(p);
  }
  return out;
}

function inputDigest(): string {
  const h = createHash("sha256");
  const list = [...files(join(APP_DIR, "src")), ...files(join(REPO_DIR, "report", "src")), ...files(join(REPO_DIR, "hearing", "src")), join(APP_DIR, "package-lock.json"), join(APP_DIR, "scripts", "build-explain.ts")].sort();
  for (const f of list) {
    h.update(relative(REPO_DIR, f));
    h.update("\0");
    h.update(readFileSync(f));
  }
  return h.digest("hex");
}

export async function buildExplain(force = false): Promise<void> {
  const digest = inputDigest();
  const stamp = join(EXPLAIN_OUT, ".digest");
  const js = join(EXPLAIN_OUT, "explain.js");
  if (!force && existsSync(stamp) && readFileSync(stamp, "utf8") === digest && existsSync(js)) return;
  const out = await build({
    configFile: false,
    root: APP_DIR,
    logLevel: "warn",
    publicDir: false,
    mode: "production",
    define: { "import.meta.env.DEV": "false", "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: EXPLAIN_OUT,
      emptyOutDir: true,
      target: "es2022",
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      lib: { entry: join(APP_DIR, "src", "connector", "explain.ts"), formats: ["iife"], name: "FinanciaExplain", fileName: () => "explain.js" },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as { output?: { moduleIds?: string[] }[] }[];
  const ids = outputs.flatMap((o) => o.output ?? []).flatMap((c) => c.moduleIds ?? []);
  if (ids.length === 0) throw new Error("まとめた JS の中身の一覧が取れませんでした");
  const outside = ids.filter((id) => id.replaceAll("\\", "/").includes("/node_modules/") || id.startsWith("\0"));
  if (outside.length > 0) throw new Error(`AI接続口の根拠の読み方に、外の部品が入りました（画面の部品を読まないようにする）: ${outside.join(", ")}`);
  const text = readFileSync(js, "utf8");
  if (/\bimport\s*\(/.test(text)) throw new Error("AI接続口の根拠の読み方に、動的な import があります");
  writeFileSync(stamp, digest);
}

if (import.meta.url === `file://${process.argv[1]}`) await buildExplain(process.argv.includes("--force"));

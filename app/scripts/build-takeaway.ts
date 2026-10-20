// 持ち帰り用のレポート（0030）の画面の部品を、HTML に埋め込める1つの JS（public/takeaway/viewer.js）と1つの CSS（viewer.css）にまとめる。
// - 入口は src/takeaway/viewer/main.tsx。Preact と提示層の部品・計算結果から提示用の値を作る部品だけが入る（本体の命令・保存・AI の部品は lint で止める）
// - 外のファイルを読まない形にする: 画像・フォントを入れない、動的な import をしない（1つの iife）、data: の URI を作らない
// - まとめた JS に入った npm の依存のライセンスの文（各パッケージの LICENSE をそのまま）と、提供元の LICENSE を licenses.txt にまとめる
//   （HTML の末尾に入れる。MIT は写しにライセンスの文を含めることを求めるため）
// - 中身が変わっていなければ作り直さない（src/・report/src/ と依存の指紋で見る）
// 直接流すとき: node scripts/build-takeaway.ts
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { build } from "vite";
import { APP_DIR, REPO_DIR } from "./lib.ts";

export const TAKEAWAY_OUT = join(APP_DIR, "public", "takeaway");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|css|json)$/.test(name)) out.push(p);
  }
  return out;
}

function inputDigest(): string {
  const h = createHash("sha256");
  const list = [...files(join(APP_DIR, "src")), ...files(join(REPO_DIR, "report", "src")), join(APP_DIR, "package-lock.json"), join(APP_DIR, "scripts", "build-takeaway.ts")].sort();
  for (const f of list) {
    h.update(relative(REPO_DIR, f));
    h.update("\0");
    h.update(readFileSync(f));
  }
  return h.digest("hex");
}

export async function buildTakeaway(force = false): Promise<void> {
  const digest = inputDigest();
  const stamp = join(TAKEAWAY_OUT, ".digest");
  if (!force && existsSync(stamp) && readFileSync(stamp, "utf8") === digest && existsSync(join(TAKEAWAY_OUT, "viewer.js")) && existsSync(join(TAKEAWAY_OUT, "viewer.css")) && existsSync(join(TAKEAWAY_OUT, "licenses.txt"))) return;
  const out = await build({
    configFile: false,
    root: APP_DIR,
    logLevel: "warn",
    publicDir: false,
    mode: "production",
    define: { "import.meta.env.DEV": "false", "process.env.NODE_ENV": JSON.stringify("production") },
    oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
    build: {
      outDir: TAKEAWAY_OUT,
      emptyOutDir: true,
      target: "es2022",
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      minify: true,
      sourcemap: false,
      reportCompressedSize: false,
      lib: { entry: join(APP_DIR, "src", "takeaway", "viewer", "main.tsx"), formats: ["iife"], name: "FinanciaTakeaway", fileName: () => "viewer.js", cssFileName: "viewer" },
    },
  });
  // まとめた JS に入った npm のパッケージ（node_modules の下のもの）
  const outputs = (Array.isArray(out) ? out : [out]) as { output?: { moduleIds?: string[] }[] }[];
  const ids = outputs.flatMap((o) => o.output ?? []).flatMap((c) => c.moduleIds ?? []);
  const pkgs = [...new Set(ids.map((id) => /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id.replaceAll("\\", "/"))?.[1]).filter((x): x is string => x !== undefined))].sort();
  if (pkgs.length === 0 && ids.length === 0) throw new Error("まとめた JS の中身の一覧が取れませんでした");
  const notices = [`ファイナンシア（提供元 FPRISE, INC.）のコード\n\n${readFileSync(join(REPO_DIR, "LICENSE"), "utf8").trim()}`];
  for (const name of pkgs) {
    const dir = join(APP_DIR, "node_modules", name);
    const file = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"].map((f) => join(dir, f)).find((f) => existsSync(f));
    const version = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version;
    if (file === undefined) throw new Error(`${name} の LICENSE がありません`);
    notices.push(`${name}@${version}\n\n${readFileSync(file, "utf8").trim()}`);
  }
  writeFileSync(join(TAKEAWAY_OUT, "licenses.txt"), notices.join("\n\n----\n\n") + "\n");
  const js = readFileSync(join(TAKEAWAY_OUT, "viewer.js"), "utf8");
  const css = readFileSync(join(TAKEAWAY_OUT, "viewer.css"), "utf8");
  // 外のファイルを読む書き方が紛れ込んでいないこと（HTML に入れる前にも確かめる。test/takeaway.test.ts）
  if (/\bimport\s*\(/.test(js) || /url\((?!\s*["']?#)/i.test(css) || /@import/i.test(css)) throw new Error("持ち帰り用のレポートの部品に、外のファイルを読む書き方があります");
  writeFileSync(stamp, digest);
}

if (import.meta.url === `file://${process.argv[1]}`) await buildTakeaway(process.argv.includes("--force"));

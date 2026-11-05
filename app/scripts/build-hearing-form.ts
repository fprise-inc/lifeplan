// お客さまのページ（0125。Web のヒアリング）を、受け付けのサーバーが配る静的なファイルにまとめる（dist-hearing-form/h/）。
// - 入口は h/index.html（src/hearingForm/main.tsx）。外のスクリプト・フォント・画像を読まない形（CSP の meta はそのまま。サーバーも同じ見出しを付ける）
// - 配るファイルの指紋（SHA-256）を fingerprints.json に書き、HTML の script・link には完全性の印（integrity）を付ける。
//   公開した指紋と配られているファイルを比べれば、ページがすり替えられていないかを誰でも確かめられる（0125 の決定の5）
// - まとめた JS に入った npm の依存のライセンスの文を licenses.txt にまとめる
// 流し方: npm run build:hearing-form
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { build } from "vite";
import { APP_DIR, REPO_DIR } from "./lib.ts";

export const FORM_OUT = join(APP_DIR, "dist-hearing-form");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const sri = (b: Buffer) => `sha384-${createHash("sha384").update(b).digest("base64")}`;

export async function buildHearingForm(): Promise<void> {
  const out = await build({
    configFile: false,
    root: APP_DIR,
    base: "/",
    logLevel: "warn",
    publicDir: false,
    mode: "production",
    define: { "import.meta.env.DEV": "false", "process.env.NODE_ENV": JSON.stringify("production") },
    oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
    build: {
      outDir: FORM_OUT,
      emptyOutDir: true,
      target: "es2022",
      assetsDir: "h/assets",
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      modulePreload: false,
      minify: true,
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: { input: join(APP_DIR, "h", "index.html") },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as { output?: { moduleIds?: string[] }[] }[];
  const ids = outputs.flatMap((o) => o.output ?? []).flatMap((c) => c.moduleIds ?? []);
  const pkgs = [...new Set(ids.map((id) => /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id.replaceAll("\\", "/"))?.[1]).filter((x): x is string => x !== undefined))].sort();
  const notices = [`ファイナンシア（提供元 FPRISE, INC.）のコード\n\n${readFileSync(join(REPO_DIR, "LICENSE"), "utf8").trim()}`];
  for (const name of pkgs) {
    const dir = join(APP_DIR, "node_modules", name);
    const file = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"].map((f) => join(dir, f)).find((f) => existsSync(f));
    if (file === undefined) throw new Error(`${name} の LICENSE がありません`);
    const version = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version;
    notices.push(`${name}@${version}\n\n${readFileSync(file, "utf8").trim()}`);
  }
  writeFileSync(join(FORM_OUT, "h", "licenses.txt"), notices.join("\n\n----\n\n") + "\n");
  // HTML の script・link に完全性の印を付ける
  const htmlPath = join(FORM_OUT, "h", "index.html");
  let html = readFileSync(htmlPath, "utf8");
  html = html.replace(/<(script|link)([^>]*?)(src|href)="(\/h\/assets\/[^"]+)"([^>]*)>/g, (_m, tag: string, a: string, attr: string, url: string, b: string) => {
    const bytes = readFileSync(join(FORM_OUT, url.slice(1)));
    return `<${tag}${a}${attr}="${url}" integrity="${sri(bytes)}"${b}>`;
  });
  writeFileSync(htmlPath, html);
  const js = walk(join(FORM_OUT, "h", "assets")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(f, "utf8")).join("\n");
  if (/\bimport\s*\(/.test(js) || /https?:\/\/(?!www\.w3\.org)/.test(js.replace(/"[^"]*licen[^"]*"/gi, ""))) throw new Error("お客さまのページに、外のファイルを読む書き方があります");
  const files = walk(FORM_OUT).filter((f) => !f.endsWith("fingerprints.json"));
  const prints = Object.fromEntries(files.map((f): [string, string] => [`/${relative(FORM_OUT, f).replaceAll("\\", "/")}`, createHash("sha256").update(readFileSync(f)).digest("hex")]).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  writeFileSync(join(FORM_OUT, "h", "fingerprints.json"), JSON.stringify({ files: prints }, null, 2) + "\n");
  console.log(`お客さまのページ: ${files.length} ファイル（${relative(REPO_DIR, FORM_OUT)}/h/）`);
}

if (import.meta.url === `file://${process.argv[1]}`) await buildHearingForm();

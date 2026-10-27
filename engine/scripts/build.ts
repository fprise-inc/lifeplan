// エンジンを1つの JS（dist/engine.js）にまとめる（0005 の1）。グローバルに FinanciaEngine を置く iife
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_DIR, writeGenerated } from "./lib.ts";

// 書き出しは自分でする（途中まで書いたファイルを、テストの側が読まないように。lib.ts の writeGenerated）
const outfile = join(ENGINE_DIR, "dist", "engine.js");
const result = await build({
  absWorkingDir: ENGINE_DIR,
  entryPoints: [join(ENGINE_DIR, "src", "entry.ts")],
  outfile,
  write: false,
  bundle: true,
  format: "iife",
  globalName: "FinanciaEngine",
  platform: "neutral",
  target: "es2022",
  charset: "utf8",
  legalComments: "none",
  logLevel: "warning",
  metafile: true,
});
const [out] = result.outputFiles;
if (out === undefined || result.outputFiles.length !== 1) throw new Error("まとめた JS が1つになっていません");
mkdirSync(join(ENGINE_DIR, "dist"), { recursive: true });
writeGenerated(outfile, out.text);
// 配布物に入るのは src/ のコード（と、そこから作った検査器）だけ。npm の依存のコードを入れない（0021）
const outside = Object.keys(result.metafile.inputs).filter((p) => !p.startsWith("src/"));
if (outside.length > 0) throw new Error(`src/ の外のコードがまとめた JS に入っています: ${outside.join(", ")}`);
console.log(`dist/engine.js（入力 ${Object.keys(result.metafile.inputs).length} ファイル）`);

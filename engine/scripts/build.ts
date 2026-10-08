// エンジンを1つの JS（dist/engine.js）にまとめる（0005 の1）。グローバルに FinanciaEngine を置く iife
import { build } from "esbuild";
import { join } from "node:path";
import { ENGINE_DIR } from "./lib.ts";

const result = await build({
  absWorkingDir: ENGINE_DIR,
  entryPoints: [join(ENGINE_DIR, "src", "entry.ts")],
  outfile: join(ENGINE_DIR, "dist", "engine.js"),
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
// 配布物に入るのは src/ のコード（と、そこから作った検査器）だけ。npm の依存のコードを入れない（0021）
const outside = Object.keys(result.metafile.inputs).filter((p) => !p.startsWith("src/"));
if (outside.length > 0) throw new Error(`src/ の外のコードがまとめた JS に入っています: ${outside.join(", ")}`);
console.log(`dist/engine.js（入力 ${Object.keys(result.metafile.inputs).length} ファイル）`);

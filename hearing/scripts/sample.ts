// 見本のシート（架空の記入例）を作る: samples/<シートID>-<版>-sample.json → samples/<シートID>-<版>-sample.xlsx（0018 の7）。
// 決まった入力から決まったバイト列になる（無圧縮の zip・日時は書き出した日）。
//   node scripts/sample.ts          … 見本の .xlsx を作り直す
//   node scripts/sample.ts --check  … リポジトリの見本が、作り直したものと同じかを確かめる（CI）。公開した版の見本は消さない
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sampleBytes, type SampleFile } from "../test/sample.ts";

const check = process.argv.includes("--check");
const dir = join(import.meta.dirname, "..", "samples");
let bad = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith("-sample.json"))) {
  const sample = JSON.parse(readFileSync(join(dir, f), "utf8")) as SampleFile;
  const out = join(dir, f.replace(/\.json$/, ".xlsx"));
  const bytes = await sampleBytes(f, sample);
  if (existsSync(out) && Buffer.compare(readFileSync(out), Buffer.from(bytes)) === 0) continue;
  if (check) {
    console.error(`${f}: 見本の .xlsx が作り直したものと違う（npm run sample で作り直す）`);
    bad++;
    continue;
  }
  writeFileSync(out, bytes);
  console.log(`${f}: 見本の .xlsx を作った（${bytes.length} バイト）`);
}
if (bad > 0) process.exit(1);

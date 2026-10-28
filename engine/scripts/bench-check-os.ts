// 速さの計測の時間の警告（0005 の追記 2026-10-28）: ubuntu と macOS の結果（scripts/bench.ts の result.json の compare）をそろえ、
// 同じ計測が両方の OS で前の値（最小値）の 1.5倍を超えたら警告、3倍を超えたら失敗にする。片方だけの遅れは実行環境の揺れが多いので知らせない。
// 使い方: node scripts/bench-check-os.ts <ubuntu の result.json> <macOS の result.json>
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { type Compared, crossOsTime, TIME_FAIL, TIME_WARN } from "./bench-compare.ts";

const [a, b] = process.argv.slice(2) as [string, string];
for (const f of [a, b]) {
  if (!existsSync(f)) {
    console.log(`::notice::速さ: ${f} が無いので、時間は比べませんでした（計測のジョブが途中で止まった）`);
    process.exit(0);
  }
}
const read = (f: string) => ((JSON.parse(readFileSync(f, "utf8")) as { compare?: Compared[] }).compare ?? []);
const rows = crossOsTime(read(a), read(b));
const mark = { ok: "", warning: "警告", error: "失敗" } as const;
const table = `### 時間（最小）の前の値との比（ubuntu・macOS）\n\n両方が ${TIME_WARN}倍を超えたら警告、${TIME_FAIL}倍を超えたら失敗\n\n| 計測 | ubuntu | macOS | |\n|---|---|---|---|\n${rows.map((r) => `| ${r.key} | ${r.ratios[0].toFixed(2)} | ${r.ratios[1].toFixed(2)} | ${mark[r.level]} |`).join("\n")}\n`;
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
let failed = false;
for (const r of rows) {
  if (r.level === "ok") continue;
  if (r.level === "error") failed = true;
  console.log(`::${r.level}::速さ: ${r.key} が両方の OS で前の値の ${Math.min(...r.ratios).toFixed(1)} 倍以上（ubuntu ${r.ratios[0].toFixed(2)}・macOS ${r.ratios[1].toFixed(2)}）`);
}
if (failed) process.exit(1);

// 0005 の「速さの回帰」と、0005 の追記（2回目の見直し）の目標: 100年分のモデル世帯の5案×4想定（scripts/bench-requests.ts）で、
// Node（V8）・JavaScriptCore（Bun）・Rust 組込みの quickjs-ng の時間を測り、dist/bench/result.json に記録する。
// - 画面側（V8・JavaScriptCore）: スライダーの1刻み（世帯の入力・案の前提を動かし、見ている1案×4想定を先出し）と、手を離した後のほかの16枠の先出し
//   （測り方は scripts/bench-js.js。Node と Bun で同じ手順）
// - 本体（quickjs-ng。engine-bench）: バイトコードから読み込み、計算ごとに新しい実行環境で、1案×4想定・5案×4想定の正の計算と、
//   必要保障額の推移（夫婦2人。protection。0005 の追記 2026-10-09 の目安: Apple シリコンで3秒以内）
// bench/baseline.json（前に測った値）と比べ、大きく遅くなったら知らせる（GitHub Actions では警告の注記と、3倍を超えたら失敗）。目標に届いたかも表にする。
// 使い方: node scripts/bench.ts [--engine dist/engine.js] [--repeat N] [--no-quickjs] [--no-jsc] [--check] [--update-baseline]
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { measure } from "./bench-js.js";
import { benchRequests, protectionRequest, SLIDERS } from "./bench-requests.ts";
import { ENGINE_DIR, REPO_DIR } from "./lib.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const enginePath = opt("--engine") ?? join(ENGINE_DIR, "dist", "engine.js");
const repeat = Number(opt("--repeat") ?? "5");
const outDir = join(ENGINE_DIR, "dist", "bench");
mkdirSync(outDir, { recursive: true });

const packDir = join(ENGINE_DIR, "dist", "regulation");
const packsJson = `[${readdirSync(packDir).filter((f) => f.endsWith(".json")).sort().map((f) => readFileSync(join(packDir, f), "utf8").trim()).join(",")}]`;
const packsPath = join(outDir, "packs.json");
writeFileSync(packsPath, packsJson);
const requests = benchRequests();
const requestsPath = join(outDir, "requests.json");
writeFileSync(requestsPath, JSON.stringify(requests));
// スライダーの刻みごとの20件（同じ値に戻らないよう、測る回数より多く作る）
const ticks = repeat * 3 + 3 + Math.max(3, Math.ceil(repeat / 2)) + 2;
const data = {
  requests,
  sliders: Object.fromEntries(Object.entries(SLIDERS).map(([name, f]) => [name, Array.from({ length: ticks }, (_, k) => benchRequests((r) => f(r, k)))])),
};
const protection = protectionRequest();
const protectionPath = join(outDir, "protection.json");
writeFileSync(protectionPath, JSON.stringify(protection));
(data as Record<string, unknown>).protection = protection;
const dataPath = join(outDir, "data.json");
writeFileSync(dataPath, JSON.stringify(data));

type Stat = { median: number; min: number };

// Node（V8）: 同じまとめた JS を読み込む
vm.runInThisContext(readFileSync(enginePath, "utf8"), { filename: "engine.js" });
const engine = (globalThis as unknown as { FinanciaEngine: { run(a: string, b: string, c: string): string } }).FinanciaEngine;
for (const r of requests) {
  const out = engine.run(JSON.stringify(r), packsJson, "{}");
  if (out.startsWith('{"error":')) throw new Error(`計測の要求がエラーになりました: ${out}`);
}
const result: Record<string, unknown> = { node: measure(engine, packsJson, data, repeat) as Record<string, Stat> };

if (!args.includes("--no-jsc")) {
  const j = spawnSync("bun", [join(ENGINE_DIR, "scripts", "jsc-bench.js"), enginePath, packsPath, dataPath, String(repeat)], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (j.status === 0) result.jsc = JSON.parse(j.stdout);
  else console.log(`JavaScriptCore（Bun）は測れませんでした: ${(j.stderr ?? String(j.error)).slice(0, 300)}`);
}
if (!args.includes("--no-quickjs")) {
  const exe = process.platform === "win32" ? ".exe" : "";
  const bin = join(REPO_DIR, "target", "release", `engine-bench${exe}`);
  if (!existsSync(bin)) throw new Error("engine-bench がありません。先に cargo build --release を流してください");
  const q = spawnSync(bin, ["--engine", enginePath, "--packs", packsPath, "--requests", requestsPath, "--protection", protectionPath, "--repeat", String(Math.max(3, Math.ceil(repeat / 2)))], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (q.status !== 0) throw new Error(`engine-bench が失敗しました: ${q.stderr.slice(0, 500)}`);
  result.quickjs = JSON.parse(q.stdout);
}
result.machine = { platform: process.platform, arch: process.arch, node: process.version };
writeFileSync(join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);

// 表にして出す
const rows: string[] = ["| エンジン | 計測 | 中央値（ミリ秒） | 最小 |", "|---|---|---|---|"];
for (const [eng, r] of Object.entries(result)) {
  if (eng === "machine") continue;
  for (const [k, v] of Object.entries(r as Record<string, Stat | number>)) if (typeof v === "object") rows.push(`| ${eng} | ${k} | ${v.median} | ${v.min} |`);
}
const table = rows.join("\n");
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 速さ（lifetime100Plan、5案×4想定）\n\n${table}\n`);

// 目標（0005 の追記）と比べて表に出し、前に測った値（bench/baseline.json の同じ OS・CPU の欄）と比べる。
// 1.5倍を超えたら警告、3倍を超えたら失敗（--check）。--update-baseline で今の値を前の値として書く
const basePath = join(ENGINE_DIR, "bench", "baseline.json");
const machine = `${process.platform}-${process.arch}`;
const file = JSON.parse(readFileSync(basePath, "utf8")) as {
  targets: Record<string, { ms: Readonly<Record<string, number>>; note: string }>;
  baseline: Record<string, Record<string, Record<string, Stat>>>;
};
const valueOf = (key: string): number | undefined => {
  const [eng, k] = key.split(".") as [string, string];
  return ((result[eng] as Record<string, Stat> | undefined) ?? {})[k]?.median;
};
const targetRows = ["| 目標 | 中身 | 目標（ミリ秒） | 今回 | |", "|---|---|---|---|---|"];
for (const [key, t] of Object.entries(file.targets)) {
  const ms = t.ms[machine];
  const v = valueOf(key);
  targetRows.push(`| ${key} | ${t.note} | ${ms ?? "（この機械の目標なし）"} | ${v ?? "—"} | ${v === undefined || ms === undefined ? "" : v <= ms ? "達成" : "未達"} |`);
}
console.log(targetRows.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### 目標（${machine}）\n\n${targetRows.join("\n")}\n`);
if (args.includes("--update-baseline")) {
  const keep: Record<string, Record<string, Stat>> = {};
  for (const [eng, r] of Object.entries(result)) if (eng !== "machine") keep[eng] = Object.fromEntries(Object.entries(r as Record<string, unknown>).filter(([, v]) => typeof v === "object")) as Record<string, Stat>;
  file.baseline[machine] = keep;
  writeFileSync(basePath, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`bench/baseline.json の ${machine} を書き換えました`);
}
if (args.includes("--check")) {
  const baseline = file.baseline[machine];
  let failed = false;
  if (baseline === undefined) console.log(`::notice::速さ: ${machine} の前の値が bench/baseline.json に無いので、比べませんでした`);
  for (const [eng, r] of Object.entries(baseline ?? {})) {
    for (const [k, b] of Object.entries(r)) {
      const now = valueOf(`${eng}.${k}`);
      if (now === undefined) continue;
      const ratio = now / b.median;
      if (ratio > 3) {
        failed = true;
        console.log(`::error::速さ: ${eng} ${k} が前の値の ${ratio.toFixed(1)} 倍（${b.median} → ${now} ミリ秒）`);
      } else if (ratio > 1.5) console.log(`::warning::速さ: ${eng} ${k} が前の値の ${ratio.toFixed(1)} 倍（${b.median} → ${now} ミリ秒）`);
    }
  }
  if (failed) process.exit(1);
}

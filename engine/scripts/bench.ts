// 0005 の「速さの回帰」: 100年分のモデル世帯の5案×4想定（scripts/bench-requests.ts）で、Node（V8）・JavaScriptCore（Bun）・
// Rust 組込みの quickjs-ng の計算の時間を測り、dist/bench/result.json に記録する。bench/baseline.json（前に測った値）と比べ、
// 大きく遅くなったら知らせる（GitHub Actions では警告の注記と、3倍を超えたら失敗）。目標（0005）に届いたかも表にする。
// 使い方: node scripts/bench.ts [--engine dist/engine.js] [--repeat N] [--no-quickjs] [--no-jsc] [--check] [--update-baseline]
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { benchRequests } from "./bench-requests.ts";
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
const reqJson = requests.map((r) => JSON.stringify(r));

type Stat = { median: number; min: number };
const stat = (xs: number[]): Stat => {
  const s = [...xs].sort((a, b) => a - b);
  return { median: Math.round((s[Math.floor(s.length / 2)] as number) * 10) / 10, min: Math.round((s[0] as number) * 10) / 10 };
};

// Node（V8）: 同じまとめた JS を読み込む
vm.runInThisContext(readFileSync(enginePath, "utf8"), { filename: "engine.js" });
interface EngineApi {
  run(a: string, b: string, c: string): string;
  runBatch?(a: string, b: string, c: string): string;
  createSession?(packs: string, options?: string): { runBatch(requests: string, options?: string): string };
}
const engine = (globalThis as unknown as { FinanciaEngine: EngineApi }).FinanciaEngine;
for (const r of reqJson) {
  const out = engine.run(r, packsJson, "{}");
  if (out.startsWith('{"error":')) throw new Error(`計測の要求がエラーになりました: ${out}`);
}
const node: Record<string, Stat> = {};
const time = (name: string, f: () => void) => {
  f();
  f();
  const xs: number[] = [];
  for (let i = 0; i < repeat; i++) {
    const t = performance.now();
    f();
    xs.push(performance.now() - t);
  }
  node[name] = stat(xs);
};
time("single", () => engine.run(reqJson[0] as string, packsJson, "{}"));
time("seq20", () => reqJson.forEach((r) => engine.run(r, packsJson, "{}")));
if (typeof engine.runBatch === "function") {
  const runBatch = engine.runBatch.bind(engine);
  const four = `[${reqJson.slice(0, 4).join(",")}]`;
  const all = `[${reqJson.join(",")}]`;
  time("batch4", () => runBatch(four, packsJson, "{}"));
  time("batch20", () => runBatch(all, packsJson, "{}"));
  time("preview20", () => runBatch(all, packsJson, '{"preview":true}'));
}
// スライダーを動かしている間（0005 の5・7）: 変わった1案×4想定を、セッション（呼び出しをまたいで部品の結果を使い回す）で先出しする1回の時間。
// sliderReturn は運用利回り（案の前提だけが変わる）、sliderSalary は配偶者の年収（その構成員に関わる部品が変わる）を1刻みずつ動かす
if (typeof engine.createSession === "function") {
  const session = engine.createSession(packsJson);
  const four = requests.slice(0, 4);
  session.runBatch(JSON.stringify(four), '{"preview":true}');
  let tick = 0;
  const slide = (change: (r: Record<string, unknown>, k: number) => void) => () => {
    tick++;
    const reqs = four.map((r) => {
      const c = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
      change(c, tick);
      return c;
    });
    session.runBatch(JSON.stringify(reqs), '{"preview":true}');
  };
  const input = (r: Record<string, unknown>) => r.input as { assumptions: Record<string, unknown>; household: { employmentPeriods: { salary: { annual: { value: number } } }[] } };
  time("sliderReturn", slide((r, k) => {
    input(r).assumptions.investmentReturn = { default: `0.0${100 + k}` };
  }));
  time("sliderSalary", slide((r, k) => {
    (input(r).household.employmentPeriods[1] as { salary: { annual: { value: number } } }).salary.annual.value = 3800000 + k * 10000;
  }));
}

const result: Record<string, unknown> = { node };

if (!args.includes("--no-jsc")) {
  const j = spawnSync("bun", [join(ENGINE_DIR, "scripts", "jsc-bench.js"), enginePath, packsPath, requestsPath, String(repeat)], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (j.status === 0) result.jsc = JSON.parse(j.stdout);
  else console.log(`JavaScriptCore（Bun）は測れませんでした: ${(j.stderr ?? String(j.error)).slice(0, 300)}`);
}
if (!args.includes("--no-quickjs")) {
  const exe = process.platform === "win32" ? ".exe" : "";
  const bin = join(REPO_DIR, "target", "release", `engine-bench${exe}`);
  if (!existsSync(bin)) throw new Error("engine-bench がありません。先に cargo build --release を流してください");
  const q = spawnSync(bin, ["--engine", enginePath, "--packs", packsPath, "--requests", requestsPath, "--repeat", String(Math.max(3, Math.ceil(repeat / 2)))], { encoding: "utf8", maxBuffer: 1 << 30 });
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
if (process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 速さ（lifetime100、5案×4想定）\n\n${table}\n`);

// 目標（0005）と比べて表に出し、前に測った値（bench/baseline.json の同じ OS・CPU の欄）と比べる。
// 1.5倍を超えたら警告、3倍を超えたら失敗（--check）。--update-baseline で今の値を前の値として書く
const basePath = join(ENGINE_DIR, "bench", "baseline.json");
const machine = `${process.platform}-${process.arch}`;
const file = JSON.parse(readFileSync(basePath, "utf8")) as {
  targets: Record<string, { ms: number; note: string }>;
  baseline: Record<string, Record<string, Record<string, Stat>>>;
};
const valueOf = (key: string): number | undefined => {
  const [eng, k] = key.split(".") as [string, string];
  return ((result[eng] as Record<string, Stat> | undefined) ?? {})[k]?.median;
};
const targetRows = ["| 目標 | 中身 | 目標（ミリ秒） | 今回 | |", "|---|---|---|---|---|"];
for (const [key, t] of Object.entries(file.targets)) {
  const v = valueOf(key);
  targetRows.push(`| ${key} | ${t.note} | ${t.ms} | ${v ?? "—"} | ${v === undefined ? "" : v <= t.ms ? "達成" : "未達"} |`);
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

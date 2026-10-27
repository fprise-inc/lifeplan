// 0005 の「速さの回帰」と、0005 の追記（2回目の見直し）の目標: 100年分のモデル世帯の5案×4想定（scripts/bench-requests.ts）で、
// Node（V8）・JavaScriptCore（Bun）・Rust 組込みの quickjs-ng の時間を測り、dist/bench/result.json に記録する。
// - 画面側（V8・JavaScriptCore）: スライダーの1刻み（世帯の入力・案の前提を動かし、見ている1枠を先出し）と、手を離した後のほかの19枠
//   （測り方は scripts/bench-js.js。Node と Bun で同じ手順）
// - 本体（quickjs-ng。engine-bench）: バイトコードから読み込み、計算ごとに新しい実行環境で、1案×4想定・5案×4想定の正の計算と、
//   必要保障額の推移（夫婦2人。protection。0005 の追記 2026-10-09 の目安: Apple シリコンで3秒以内）
// 時間のほかに、揺れない物差しを2つ記録する（0005 の追記 2026-10-28）:
// - 部品の呼び出しの回数（scripts/bench-count.js。決まった値で、OS によらない）
// - 実行した命令の数（百万）。macOS の /usr/bin/time -l が数えられる所（作業の Mac）では V8 の手順（scripts/bench-js の形を
//   scripts/bench-ins.js で n 回と0回）と quickjs-ng の読み込みと1件、valgrind のある Linux（CI の ubuntu）では quickjs-ng の
//   読み込みと1件を cachegrind で（CI の実行環境はどちらの OS もハードウェアの数え口が無い）
// 前の値（--history の毎晩の計測の中央値か bench/baseline.json。比べ方は scripts/bench-compare.ts）と比べ、--check で知らせる:
// 呼び出しの回数と cachegrind の命令の数は +5% で警告・+10% で失敗、time -l の命令の数は警告だけ。時間は1つの OS の中では知らせず、
// 比を result.json に書く（両方の OS をそろえて scripts/bench-check-os.ts が 1.5倍で警告・3倍で失敗）。目標に届いたかも表にする。
// 負荷の平均（1分）が論理コア数の半分を超えていたら、表に「揺れが大きい」と出す。
// 使い方: node scripts/bench.ts [--engine dist/engine.js] [--repeat N] [--no-quickjs] [--no-jsc] [--no-instructions]
//   [--history <毎晩の結果の置き場所>] [--check] [--update-baseline]
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { availableParallelism, loadavg } from "node:os";
import vm from "node:vm";
import { measure } from "./bench-js.js";
import { compareAll, type BenchResult, type Compared, type HistoryEntry, noisyLoad } from "./bench-compare.ts";
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
const quickjsBin = join(REPO_DIR, "target", "release", `engine-bench${process.platform === "win32" ? ".exe" : ""}`);
if (!args.includes("--no-quickjs")) {
  const bin = quickjsBin;
  if (!existsSync(bin)) throw new Error("engine-bench がありません。先に cargo build --release を流してください");
  const q = spawnSync(bin, ["--engine", enginePath, "--packs", packsPath, "--requests", requestsPath, "--protection", protectionPath, "--repeat", String(Math.max(3, Math.ceil(repeat / 2)))], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (q.status !== 0) throw new Error(`engine-bench が失敗しました: ${q.stderr.slice(0, 500)}`);
  result.quickjs = JSON.parse(q.stdout);
}

// 部品の呼び出しの回数（決まった値）
{
  const c = spawnSync(process.execPath, [join(ENGINE_DIR, "scripts", "bench-count.js"), enginePath, packsPath, dataPath], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (c.status !== 0) throw new Error(`部品の呼び出しの回数を数えられませんでした: ${c.stderr.slice(0, 500)}`);
  const counts = JSON.parse(c.stdout) as Record<string, { total: number; byComponent?: Record<string, number> }>;
  result.counts = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.total]));
  result.countsByComponent = counts.single?.byComponent;
}

// 実行した命令の数（百万）
const M = 1_000_000;
/** /usr/bin/time -l の instructions retired（数えられないときは undefined） */
const timeL = (cmd: string, cmdArgs: string[]): number | undefined => {
  const r = spawnSync("/usr/bin/time", ["-l", cmd, ...cmdArgs], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`${cmd} が失敗しました: ${r.stderr.slice(-500)}`);
  const m = /(\d+)\s+instructions retired/.exec(r.stderr);
  return m === null ? undefined : Number(m[1]);
};
/** valgrind の cachegrind の I refs（命令の数） */
const cachegrind = (cmd: string, cmdArgs: string[]): number => {
  const r = spawnSync("valgrind", ["--tool=cachegrind", "--cache-sim=no", "--cachegrind-out-file=/dev/null", cmd, ...cmdArgs], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`valgrind が失敗しました: ${r.stderr.slice(-500)}`);
  const m = /I\s+refs:\s+([\d,]+)/.exec(r.stderr);
  if (m === null) throw new Error(`valgrind の出力に I refs がありません: ${r.stderr.slice(-300)}`);
  return Number(m[1]!.replaceAll(",", ""));
};
// quickjs-ng: バイトコードへの変換・パックの確かめ・1件（engine-bench --repeat 0）
const quickjsOnce = ["--engine", enginePath, "--packs", packsPath, "--requests", requestsPath, "--repeat", "0"];
if (!args.includes("--no-instructions")) {
  const has = (cmd: string) => spawnSync(cmd, ["--version"], { encoding: "utf8" }).status === 0;
  const canTimeL = process.platform === "darwin" && existsSync("/usr/bin/time") && timeL("/usr/bin/true", []) !== undefined;
  if (canTimeL) {
    // V8: n 回と0回の差を n で割る（読み込みと準備の分を除く）
    const ins = (scenario: string, n: number) => {
      const run = (k: number) => timeL(process.execPath, [join(ENGINE_DIR, "scripts", "bench-ins.js"), enginePath, packsPath, dataPath, scenario, String(k)])!;
      const a = run(0);
      return Math.round((run(n) - a) / n / M);
    };
    const values: Record<string, number> = {
      "node.single": ins("single", 5),
      "node.protection": ins("protection", 3),
      "node.sliderSalary": ins("slide:salary", 10),
      "node.sliderRetire": ins("slide:retire", 10),
      "node.sliderReturn": ins("slide:return", 10),
      "node.afterRelease19": ins("release:salary", 2),
    };
    if (existsSync(quickjsBin)) values["quickjs.startupSingle"] = Math.round(timeL(quickjsBin, quickjsOnce)! / M);
    result.instructions = { tool: "time -l", values };
  } else if (process.platform === "linux" && has("valgrind") && existsSync(quickjsBin)) {
    result.instructions = { tool: "cachegrind", values: { "quickjs.startupSingle": Math.round(cachegrind(quickjsBin, quickjsOnce) / M) } };
  } else console.log("実行した命令の数は数えられませんでした（macOS の /usr/bin/time -l か、Linux の valgrind と engine-bench が要ります）");
}

const cores = availableParallelism();
const load1 = Math.round(loadavg()[0]! * 100) / 100;
const noisy = process.platform !== "win32" && noisyLoad(load1, cores);
result.machine = { platform: process.platform, arch: process.arch, node: process.version, cores, load1, measuredAt: new Date().toISOString() };

// 表にして出す
const summary: string[] = [];
const out = (text: string) => {
  console.log(text);
  summary.push(text);
};
const loadNote = `負荷の平均（1分） ${load1}・論理コア ${cores}${noisy ? "。**揺れが大きい**（負荷の平均が論理コア数の半分を超えている。時間は当てにしない）" : ""}`;
const rows: string[] = ["| エンジン | 計測 | 中央値（ミリ秒） | 最小 |", "|---|---|---|---|"];
for (const eng of ["node", "jsc", "quickjs"]) {
  for (const [k, v] of Object.entries((result[eng] ?? {}) as Record<string, Stat | number | null>)) if (v !== null && typeof v === "object") rows.push(`| ${eng} | ${k} | ${v.median} | ${v.min} |`);
}
out(`### 速さ（lifetime100Plan、5案×4想定）\n\n${loadNote}\n\n${rows.join("\n")}\n`);
const counts = result.counts as Record<string, number>;
out(`### 部品の呼び出しの回数\n\n| 計測 | 回数 |\n|---|---|\n${Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}\n`);
const instructions = result.instructions as BenchResult["instructions"];
if (instructions !== undefined) {
  out(`### 実行した命令の数（百万。${instructions.tool}）\n\n| 計測 | 命令の数 |\n|---|---|\n${Object.entries(instructions.values).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}\n`);
}

// 目標（0005 の追記）と比べて表に出す
const basePath = join(ENGINE_DIR, "bench", "baseline.json");
const machine = `${process.platform}-${process.arch}`;
type BaseFile = {
  targets: Record<string, { ms: Readonly<Record<string, number>>; note: string }>;
  baseline: Record<string, Record<string, Record<string, Stat>>>;
  baselineUpdatedAt?: Record<string, string>;
  counts?: { updatedAt: string; values: Record<string, number> };
  instructions?: Record<string, { updatedAt: string; values: Record<string, number> }>;
};
const file = JSON.parse(readFileSync(basePath, "utf8")) as BaseFile;
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
out(`### 目標（${machine}）\n\n${targetRows.join("\n")}\n`);

// 前の値: --history の置き場所の下の「<計測した時刻>/result.json」（同じ OS・CPU の物）か、bench/baseline.json
const history: HistoryEntry[] = [];
const historyDir = opt("--history");
if (historyDir !== undefined && existsSync(historyDir)) {
  for (const d of readdirSync(historyDir)) {
    const f = join(historyDir, d, "result.json");
    if (!existsSync(f)) continue;
    const r = JSON.parse(readFileSync(f, "utf8")) as BenchResult;
    if (`${r.machine?.platform}-${r.machine?.arch}` !== machine) continue;
    history.push({ at: r.machine?.measuredAt ?? d, result: r });
  }
}
const baseTime = file.baseline[machine];
const compared: Compared[] = compareAll(result as BenchResult, history, {
  time:
    baseTime === undefined
      ? undefined
      : {
          updatedAt: file.baselineUpdatedAt?.[machine],
          min: Object.fromEntries(Object.entries(baseTime).flatMap(([eng, r]) => Object.entries(r).map(([k, v]) => [`${eng}.${k}`, v.min]))),
        },
  counts: file.counts,
  instructions: instructions === undefined ? undefined : (() => {
    const b = file.instructions?.[`${machine} ${instructions.tool}`];
    return b === undefined ? undefined : { ...b, tool: instructions.tool };
  })(),
});
result.compare = compared;
writeFileSync(join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
const kindName = { time: "時間（最小）", count: "呼び出しの回数", instructions: "命令の数" } as const;
const mark = { ok: "", warning: "警告", error: "失敗" } as const;
out(
  `### 前の値との比（${machine}。毎晩の計測 ${history.length} 回分を読んだ）\n\n| 物差し | 計測 | 前の値 | 今回 | 比 | 前の値の出どころ | |\n|---|---|---|---|---|---|---|\n` +
    compared.map((c) => `| ${kindName[c.kind]} | ${c.key} | ${c.prev} | ${c.now} | ${c.ratio.toFixed(3)} | ${c.from} | ${mark[c.level]} |`).join("\n") +
    "\n\n時間は両方の OS の比をそろえて決める（両方が 1.5倍を超えたら警告、3倍を超えたら失敗）。\n",
);
if (process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);

if (args.includes("--update-baseline")) {
  const keep: Record<string, Record<string, Stat>> = {};
  for (const eng of ["node", "jsc", "quickjs"]) {
    const r = result[eng] as Record<string, unknown> | undefined;
    if (r !== undefined) keep[eng] = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && typeof v === "object")) as Record<string, Stat>;
  }
  const at = (result.machine as { measuredAt: string }).measuredAt;
  file.baseline[machine] = keep;
  file.baselineUpdatedAt = { ...file.baselineUpdatedAt, [machine]: at };
  file.counts = { updatedAt: at, values: counts };
  if (instructions !== undefined) file.instructions = { ...file.instructions, [`${machine} ${instructions.tool}`]: { updatedAt: at, values: instructions.values } };
  writeFileSync(basePath, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`bench/baseline.json の ${machine} を書き換えました`);
}
if (args.includes("--check")) {
  if (compared.length === 0) console.log(`::notice::速さ: ${machine} の前の値が無いので、比べませんでした`);
  let failed = false;
  for (const c of compared) {
    if (c.level === "ok") continue;
    if (c.level === "error") failed = true;
    console.log(`::${c.level}::速さ: ${kindName[c.kind]} ${c.key} が前の値の ${((c.ratio - 1) * 100).toFixed(1)}% 増（${c.prev} → ${c.now}。${c.from}）`);
  }
  if (failed) process.exit(1);
}

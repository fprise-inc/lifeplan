// 0005 の6: 一致テスト。同じ入力を Node（V8）・Rust 組込みの quickjs-ng・JavaScriptCore（Bun）で計算し、出力の SHA-256 を比べる
// 使い方: node scripts/parity.ts [engine-host のパス] [--jsc]（--jsc は Bun が無ければ失敗にする。無指定なら Bun があるときだけ比べる）
// 入力は、モデル世帯（data/modelHouseholds）すべてと test/fixtures/parity（エラーになる入力）× 根拠の記録3種
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { ENGINE_DIR, REPO_DIR, sha256 } from "./lib.ts";

const args = process.argv.slice(2);
const requireJsc = args.includes("--jsc");
const exe = process.platform === "win32" ? ".exe" : "";
const host =
  args.find((a) => !a.startsWith("--")) ??
  [join(REPO_DIR, "target", "release", `engine-host${exe}`), join(REPO_DIR, "target", "debug", `engine-host${exe}`)].find((p) => existsSync(p));
if (host === undefined || !existsSync(host)) throw new Error("engine-host がありません。先に cargo build を流してください");
const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
const hasBun = bun.status === 0;
if (requireJsc && !hasBun) throw new Error("bun がありません（--jsc）");

const enginePath = join(ENGINE_DIR, "dist", "engine.js");
const packDir = join(ENGINE_DIR, "dist", "regulation");
const packFiles = readdirSync(packDir).filter((f) => f.endsWith(".json")).sort().map((f) => join(packDir, f));
const packsJson = `[${packFiles.map((f) => readFileSync(f, "utf8").trim()).join(",")}]`;
const packsPath = join(ENGINE_DIR, "dist", "parity-packs.json");
writeFileSync(packsPath, packsJson);
const options = JSON.stringify({ checkInternal: true });

// Node 側: 同じまとめた JS を読み込む（隔離には使わない。速く回すためだけ）
vm.runInThisContext(readFileSync(enginePath, "utf8"), { filename: "engine.js" });
const engine = (globalThis as unknown as { FinanciaEngine: { run(a: string, b: string, c: string): string } }).FinanciaEngine;

const inputs: [string, string][] = [
  ...readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f): [string, string] => [f.replace(/\.json$/, ""), join(REPO_DIR, "data", "modelHouseholds", f)]),
  ...readdirSync(join(ENGINE_DIR, "test", "fixtures", "parity"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f): [string, string] => [f.replace(/\.json$/, ""), join(ENGINE_DIR, "test", "fixtures", "parity", f)]),
];
const results: Record<string, string> = {};
let failed = 0;
for (const [name, file] of inputs) {
  const expectError = name.startsWith("error-");
  for (const trace of ["none", "summary", "full"] as const) {
    const req = JSON.parse(readFileSync(file, "utf8")) as { trace: string };
    req.trace = trace;
    const reqJson = JSON.stringify(req);
    const nodeOut = engine.run(reqJson, packsJson, options);
    const q = spawnSync(host, ["--engine", enginePath, ...packFiles.flatMap((p) => ["--pack", p]), "--check-internal"], { input: reqJson, encoding: "utf8", maxBuffer: 1 << 30 });
    const qjsOut = (expectError ? q.stderr : q.stdout).trim();
    const hn = sha256(nodeOut);
    const hq = sha256(qjsOut);
    let hj = "（Bun なし）";
    let jscOk = true;
    if (hasBun) {
      const j = spawnSync("bun", [join(ENGINE_DIR, "scripts", "jsc-run.js"), enginePath, packsPath, options], { input: reqJson, encoding: "utf8", maxBuffer: 1 << 30 });
      hj = sha256(j.stdout.trim());
      jscOk = j.status === 0 && hj === hn;
      if (j.status !== 0) console.log(j.stderr.slice(0, 500));
    }
    const isError = nodeOut.startsWith('{"error":');
    const ok =
      hn === hq &&
      jscOk &&
      isError === expectError &&
      q.status === (expectError ? 1 : 0) &&
      !/-0[,}\]]|\d\.\d|\de[+-]?\d/.test(nodeOut.replace(/"[^"]*"/g, '""'));
    const key = `${name}/${trace}`;
    results[key] = hn;
    console.log(`${ok ? "ok  " : "NG  "} ${key.padEnd(32)} node=${hn.slice(0, 12)} quickjs=${hq.slice(0, 12)} jsc=${hj.slice(0, 12)} ${nodeOut.length}B`);
    if (!ok) {
      failed++;
      if (q.status !== 0 && !expectError) console.log(q.stderr.slice(0, 500));
    }
  }
}
writeFileSync(join(ENGINE_DIR, "dist", "parity-hashes.json"), `${JSON.stringify(results, null, 2)}\n`);
if (failed > 0) {
  console.error(`一致しなかった: ${failed}`);
  process.exit(1);
}
console.log(`すべて一致（${inputs.length} 件 × 3）${hasBun ? "。JavaScriptCore（Bun）も比べた" : ""}`);

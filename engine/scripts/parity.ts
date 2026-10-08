// 0005 の6: 一致テスト。同じ入力を Node（V8）と Rust 組込みの quickjs-ng で計算し、出力の SHA-256 を比べる
// 使い方: node scripts/parity.ts [engine-host のパス]（既定は ../target/release/engine-host、無ければ debug）
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { ENGINE_DIR, REPO_DIR, sha256 } from "./lib.ts";

const exe = process.platform === "win32" ? ".exe" : "";
const host =
  process.argv[2] ??
  [join(REPO_DIR, "target", "release", `engine-host${exe}`), join(REPO_DIR, "target", "debug", `engine-host${exe}`)].find((p) => existsSync(p));
if (host === undefined || !existsSync(host)) throw new Error("engine-host がありません。先に cargo build を流してください");

const enginePath = join(ENGINE_DIR, "dist", "engine.js");
const packDir = join(ENGINE_DIR, "dist", "regulation");
const packFiles = readdirSync(packDir).filter((f) => f.endsWith(".json")).sort().map((f) => join(packDir, f));
const packsJson = `[${packFiles.map((f) => readFileSync(f, "utf8").trim()).join(",")}]`;

// Node 側: 同じまとめた JS を読み込む（隔離には使わない。速く回すためだけ）
vm.runInThisContext(readFileSync(enginePath, "utf8"), { filename: "engine.js" });
const engine = (globalThis as unknown as { FinanciaEngine: { run(a: string, b: string, c: string): string } }).FinanciaEngine;

const fixturesDir = join(ENGINE_DIR, "test", "fixtures", "households");
const results: Record<string, string> = {};
let failed = 0;
for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith(".json")).sort()) {
  const name = file.replace(/\.json$/, "");
  const expectError = name.startsWith("error-");
  for (const trace of ["none", "summary", "full"] as const) {
    const req = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as { trace: string };
    req.trace = trace;
    const reqJson = JSON.stringify(req);
    const nodeOut = engine.run(reqJson, packsJson, JSON.stringify({ checkInternal: true }));
    const args = ["--engine", enginePath, ...packFiles.flatMap((p) => ["--pack", p]), "--check-internal"];
    const q = spawnSync(host, args, { input: reqJson, encoding: "utf8", maxBuffer: 1 << 30 });
    const qjsOut = (expectError ? q.stderr : q.stdout).trim();
    const isError = nodeOut.startsWith('{"error":');
    const hn = sha256(nodeOut);
    const hq = sha256(qjsOut);
    const ok = hn === hq && isError === expectError && q.status === (expectError ? 1 : 0) && !/-0[,}\]]|\d\.\d|\de[+-]?\d/.test(nodeOut.replace(/"[^"]*"/g, '""'));
    const key = `${name}/${trace}`;
    results[key] = hn;
    console.log(`${ok ? "ok  " : "NG  "} ${key.padEnd(24)} node=${hn.slice(0, 16)} quickjs=${hq.slice(0, 16)} ${nodeOut.length}B`);
    if (!ok) {
      failed++;
      if (q.status !== 0) console.log(q.stderr.slice(0, 500));
    }
  }
}
writeFileSync(join(ENGINE_DIR, "dist", "parity-hashes.json"), `${JSON.stringify(results, null, 2)}\n`);
if (failed > 0) {
  console.error(`一致しなかった: ${failed}`);
  process.exit(1);
}

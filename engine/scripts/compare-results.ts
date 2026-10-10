// 速さの見直しで「結果を1円も変えていない」ことを確かめる（0005 の追記）。2つのまとめた JS（前と後）で同じ要求を計算し、
// 数字の部分（お金の動き・年ごとの行・表・要約・必要保障額・見出しの知らせ・データの版・万一とストレステストの見出し。エラーは全体）の
// ハッシュと、見出しのエンジンの版・部品表を除いた出力全体（根拠の記録を含む）のハッシュを比べる。
// 要求: モデル世帯すべて（data/modelHouseholds）とエラーの例（test/fixtures/parity）× 根拠の記録3種 × 内部の検査の有無、
// 速さの計測の20件（5案×4想定）と必要保障額の推移の1件、20件のまとめて計算（runBatch。出力全体と先出し）。
// 使い方: node scripts/compare-results.ts <前の engine.js> [後の engine.js（省略は dist/engine.js）]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { benchRequests, protectionRequest } from "./bench-requests.ts";
import { ENGINE_DIR, REPO_DIR, sha256 } from "./lib.ts";

interface Engine {
  run(a: string, b: string, c: string): string;
  runBatch(a: string, b: string, c: string): string;
}

const [beforePath, afterPath = join(ENGINE_DIR, "dist", "engine.js")] = process.argv.slice(2);
if (beforePath === undefined) throw new Error("使い方: node scripts/compare-results.ts <前の engine.js> [後の engine.js]");

function load(path: string): Engine {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
  return (context as { FinanciaEngine: Engine }).FinanciaEngine;
}
const before = load(beforePath);
const after = load(afterPath);

const packDir = join(ENGINE_DIR, "dist", "regulation");
const packsJson = `[${readdirSync(packDir).filter((f) => f.endsWith(".json")).sort().map((f) => readFileSync(join(packDir, f), "utf8").trim()).join(",")}]`;

type Out = Record<string, unknown>;
/** 数字の部分 */
function numeric(o: Out): unknown {
  if ("error" in o) return o;
  const h = (o.header ?? {}) as Out;
  return {
    flows: o.flows,
    annual: o.annual,
    table: o.table,
    summary: o.summary,
    protection: o.protection,
    notices: h.notices,
    data: h.data,
    contingency: h.contingency,
    stressTest: h.stressTest,
  };
}
/** 見出しのエンジンの版・部品表を除いた全体 */
function whole(o: Out): unknown {
  if ("error" in o || o.header === undefined) return o;
  const rest: Out = { ...(o.header as Out) };
  delete rest.engine;
  delete rest.components;
  return { ...o, header: rest };
}

let cases = 0;
let numericNg = 0;
let wholeNg = 0;
function compare(key: string, a: string, b: string): void {
  const pa = JSON.parse(a) as Out | Out[];
  const pb = JSON.parse(b) as Out | Out[];
  const la = Array.isArray(pa) ? pa : [pa];
  const lb = Array.isArray(pb) ? pb : [pb];
  const hn = (l: Out[]) => sha256(JSON.stringify(l.map(numeric)));
  const hw = (l: Out[]) => sha256(JSON.stringify(l.map(whole)));
  const n = la.length === lb.length && hn(la) === hn(lb);
  const w = la.length === lb.length && hw(la) === hw(lb);
  cases++;
  if (!n) numericNg++;
  if (!w) wholeNg++;
  console.log(`${n ? "ok  " : "NG  "}${w ? "ok  " : "NG  "} ${key.padEnd(44)} ${hn(la).slice(0, 12)} ${a.length}B`);
}

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
for (const checkInternal of [false, true]) {
  const opts = JSON.stringify({ checkInternal });
  for (const [name, file] of inputs) {
    for (const trace of ["none", "summary", "full"] as const) {
      const req = JSON.parse(readFileSync(file, "utf8")) as { trace: string };
      req.trace = trace;
      const s = JSON.stringify(req);
      compare(`${name}/${trace}${checkInternal ? "/checkInternal" : ""}`, before.run(s, packsJson, opts), after.run(s, packsJson, opts));
    }
  }
}
const bench = benchRequests();
bench.forEach((r, i) => {
  const s = JSON.stringify(r);
  compare(`bench/${i}`, before.run(s, packsJson, "{}"), after.run(s, packsJson, "{}"));
});
const p = JSON.stringify(protectionRequest());
compare("bench/protection", before.run(p, packsJson, "{}"), after.run(p, packsJson, "{}"));
const all = JSON.stringify(bench);
compare("bench/runBatch", before.runBatch(all, packsJson, "{}"), after.runBatch(all, packsJson, "{}"));
compare("bench/runBatch-preview", before.runBatch(all, packsJson, '{"preview":true}'), after.runBatch(all, packsJson, '{"preview":true}'));

console.log(`${cases} 件: 数字の部分の不一致 ${numericNg}、出力全体（見出しのエンジンの版・部品表を除く）の不一致 ${wholeNg}`);
if (numericNg > 0) process.exit(1);

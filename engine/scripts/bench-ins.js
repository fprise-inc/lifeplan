// 速さの計測の「実行した命令の数」の V8 側（0005 の追記 2026-10-28）: 決まった手順を n 回流すだけのプロセス。scripts/bench.ts が
// /usr/bin/time -l（macOS の instructions retired）で n 回と0回の命令の数を数え、差を n で割る（読み込みと準備の分を除く）。
// 使い方: node scripts/bench-ins.js <engine.js> <packs.json> <data.json> <single|protection|slide:名前|release:名前> <n>
import { readFileSync } from "node:fs";
import vm from "node:vm";

const [enginePath, packsPath, dataPath, scenario, nArg] = process.argv.slice(2);
const n = Number(nArg);
vm.runInThisContext(readFileSync(enginePath, "utf8"), { filename: "engine.js" });
const engine = globalThis.FinanciaEngine;
const packsJson = readFileSync(packsPath, "utf8");
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const slotId = (i) => `p${Math.floor(i / 4)}/s${i % 4}`;
let step;
if (scenario === "single") {
  const r0 = JSON.stringify(data.requests[0]);
  step = () => engine.run(r0, packsJson, "{}");
} else if (scenario === "protection") {
  const p = JSON.stringify(data.protection);
  step = () => engine.run(p, packsJson, "{}");
} else {
  const [kind, name] = scenario.split(":");
  const ticks = data.sliders[name];
  if (ticks === undefined) throw new Error(`スライダー ${name} がありません`);
  const slots = (k) => JSON.stringify(Object.fromEntries(ticks[k % ticks.length].map((r, i) => [slotId(i), r])));
  const session = engine.createSession(packsJson);
  session.set(slots(0));
  session.release();
  let k = 0;
  step =
    kind === "slide"
      ? () => session.slide(slots(++k), slotId(0))
      : () => {
          session.slide(slots(++k), slotId(0));
          return session.release();
        };
}
// 温める（0回のときも同じだけ流す）
step();
step();
for (let i = 0; i < n; i++) {
  const r = step();
  if (typeof r === "string" && r.startsWith('{"error"')) throw new Error(r.slice(0, 300));
}

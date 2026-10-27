// 速さの計測の「部品の呼び出しの回数」（0005 の追記 2026-10-28）: まとめた JS の写しの、部品を呼ぶ所（registry/ctx.ts の
// impl.def.compute）に数える行を足して、決まった手順の中で部品が何回呼ばれたかを数える。時間と違い、実行環境によらず決まった値になる。
// 計算そのものは変えない（数えるのは写しの中だけで、出力は同じ）。
// 使い方: node scripts/bench-count.js <engine.js> <packs.json> <data.json>  → { 計測: { total, byComponent? } }
import { readFileSync } from "node:fs";
import vm from "node:vm";

const [enginePath, packsPath, dataPath] = process.argv.slice(2);
const NEEDLE = "output = impl.def.compute(input, ctx);";
const src = readFileSync(enginePath, "utf8");
if (src.split(NEEDLE).length !== 2) {
  throw new Error("まとめた JS に部品を呼ぶ所が1か所だけ見つかりません（registry/ctx.ts を変えたら scripts/bench-count.js の NEEDLE を合わせる）");
}
globalThis.__benchCalls = {};
vm.runInThisContext(
  src.replace(NEEDLE, `{ const __c = globalThis.__benchCalls; __c[impl.def.id] = (__c[impl.def.id] ?? 0) + 1; ${NEEDLE} }`),
  { filename: "engine.js" },
);
const engine = globalThis.FinanciaEngine;
const packsJson = readFileSync(packsPath, "utf8");
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const slotId = (i) => `p${Math.floor(i / 4)}/s${i % 4}`;
const check = (r) => {
  if (r.startsWith('{"error"')) throw new Error(r.slice(0, 300));
};
const out = {};
const grab = (name, f, detail = false) => {
  globalThis.__benchCalls = {};
  f();
  const c = globalThis.__benchCalls;
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  out[name] = detail ? { total, byComponent: Object.fromEntries(Object.entries(c).sort(([a], [b]) => (a < b ? -1 : 1))) } : { total };
};
const r0 = JSON.stringify(data.requests[0]);
grab("single", () => check(engine.run(r0, packsJson, "{}")), true);
if (data.protection !== undefined) grab("protection", () => check(engine.run(JSON.stringify(data.protection), packsJson, "{}")));
for (const [name, ticks] of Object.entries(data.sliders)) {
  const session = engine.createSession(packsJson);
  const slots = (k) => JSON.stringify(Object.fromEntries(ticks[k].map((r, i) => [slotId(i), r])));
  session.set(slots(0));
  check(session.release());
  const key = `slider${name[0].toUpperCase()}${name.slice(1)}`;
  // 動かしている間の6刻み（見ている1枠）と、指を離した後の19枠
  grab(key, () => {
    for (let k = 1; k <= 6; k++) check(session.slide(slots(k), slotId(0)));
  });
  grab(`${key}Release`, () => check(session.release()));
}
process.stdout.write(JSON.stringify(out));

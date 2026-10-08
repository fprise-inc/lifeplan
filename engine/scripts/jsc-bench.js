// 速さの計測の JavaScriptCore 側: Bun（配布しない CI の道具）でまとめた JS を動かす
// 使い方: bun scripts/jsc-bench.js <engine.js> <packs.json> <requests.json> <repeat>
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const [enginePath, packsPath, requestsPath, repeatArg] = process.argv.slice(2);
const engine = new Function(`${readFileSync(enginePath, "utf8")}\nreturn FinanciaEngine;`)();
const packs = readFileSync(packsPath, "utf8");
const requests = JSON.parse(readFileSync(requestsPath, "utf8")).map((r) => JSON.stringify(r));
const repeat = Number(repeatArg ?? "5");
const now = () => performance.now();
const stat = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { median: Math.round(s[Math.floor(s.length / 2)] * 10) / 10, min: Math.round(s[0] * 10) / 10 };
};
const out = {};
const time = (name, f) => {
  f();
  f();
  const xs = [];
  for (let i = 0; i < repeat; i++) {
    const t = now();
    f();
    xs.push(now() - t);
  }
  out[name] = stat(xs);
};
time("single", () => engine.run(requests[0], packs, "{}"));
time("seq20", () => requests.forEach((r) => engine.run(r, packs, "{}")));
if (typeof engine.runBatch === "function") {
  const four = `[${requests.slice(0, 4).join(",")}]`;
  const all = `[${requests.join(",")}]`;
  time("batch4", () => engine.runBatch(four, packs, "{}"));
  time("batch20", () => engine.runBatch(all, packs, "{}"));
  time("preview20", () => engine.runBatch(all, packs, '{"preview":true}'));
}
// scripts/bench.ts と同じスライダーの計測
if (typeof engine.createSession === "function") {
  const session = engine.createSession(packs);
  const four = JSON.parse(readFileSync(requestsPath, "utf8")).slice(0, 4);
  session.runBatch(JSON.stringify(four), '{"preview":true}');
  let tick = 0;
  const slide = (change) => () => {
    tick++;
    const reqs = four.map((r) => {
      const c = JSON.parse(JSON.stringify(r));
      change(c, tick);
      return c;
    });
    session.runBatch(JSON.stringify(reqs), '{"preview":true}');
  };
  time("sliderReturn", slide((r, k) => {
    r.input.assumptions.investmentReturn = { default: `0.0${100 + k}` };
  }));
  time("sliderSalary", slide((r, k) => {
    r.input.household.employmentPeriods[1].salary.annual.value = 3800000 + k * 10000;
  }));
}
process.stdout.write(JSON.stringify(out));

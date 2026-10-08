// 速さの計測の JavaScriptCore 側: Bun（配布しない CI の道具）でまとめた JS を動かす（測り方は scripts/bench-js.js。Node と同じ）
// 使い方: bun scripts/jsc-bench.js <engine.js> <packs.json> <data.json> <repeat>
import { readFileSync } from "node:fs";
import { measure } from "./bench-js.js";

const [enginePath, packsPath, dataPath, repeatArg] = process.argv.slice(2);
const engine = new Function(`${readFileSync(enginePath, "utf8")}\nreturn FinanciaEngine;`)();
const packs = readFileSync(packsPath, "utf8");
const data = JSON.parse(readFileSync(dataPath, "utf8"));
process.stdout.write(JSON.stringify(measure(engine, packs, data, Number(repeatArg ?? "5"))));

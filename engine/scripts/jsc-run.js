// 一致テスト（0005 の6）の JavaScriptCore 側: Bun（配布しない CI の道具。0005・0015 の追記）でまとめた JS を動かす
// 使い方: bun scripts/jsc-run.js <engine.js> <packs.json> <options.json> [--batch] < 要求.json（--batch は要求の配列を runBatch で）
import { readFileSync } from "node:fs";

const [enginePath, packsPath, optionsJson, mode] = process.argv.slice(2);
// まとめた JS は iife で FinanciaEngine を作る。関数の中で読み込んで取り出す（Node の vm.runInThisContext に当たる）
const engine = new Function(`${readFileSync(enginePath, "utf8")}\nreturn FinanciaEngine;`)();
const request = readFileSync(0, "utf8");
const packs = readFileSync(packsPath, "utf8");
process.stdout.write(mode === "--batch" ? engine.runBatch(request, packs, optionsJson) : engine.run(request, packs, optionsJson));

// 対応範囲の一覧（docs/coverage/*.yaml。0183）を確かめ、AI接続口（crates/lifeplan）が埋め込む dist/coverage.json に書き出す（CI でも流す）
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadCoverage, shipCoverage } from "./coverage.ts";
import { ENGINE_DIR, writeGenerated } from "./lib.ts";

const list = loadCoverage();
mkdirSync(join(ENGINE_DIR, "dist"), { recursive: true });
writeGenerated(join(ENGINE_DIR, "dist", "coverage.json"), `${JSON.stringify(shipCoverage(list))}\n`);
const count = (s: string) => list.areas.reduce((n, a) => n + a.entries.filter((e) => e.status === s).length, 0);
console.log(`対応範囲の一覧 ${list.version}: ${list.areas.length} 分野・入っている ${count("included")}・近似 ${count("approximated")}・まだ ${count("notYet")}`);

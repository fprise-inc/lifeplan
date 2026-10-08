// 制度データの全パックを dist/regulation/<packId>.json に書き出す（CI でも流す）
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_DIR } from "./lib.ts";
import { buildPack, packDirs, serializePack } from "./regulation.ts";

const outDir = join(ENGINE_DIR, "dist", "regulation");
mkdirSync(outDir, { recursive: true });
for (const dir of packDirs()) {
  const pack = buildPack(dir);
  const file = join(outDir, `${String(pack.pack.packId)}.json`);
  writeFileSync(file, serializePack(pack));
  console.log(`${String(pack.pack.packId)} ${String(pack.pack.version)} ${pack.digest}`);
}

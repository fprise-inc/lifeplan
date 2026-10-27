// 制度データの全パックを dist/regulation/<packId>.json に書き出す（CI でも流す）
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_DIR, writeGenerated } from "./lib.ts";
import { buildPack, packDirs, pendingReviewEntries, serializePack } from "./regulation.ts";

const outDir = join(ENGINE_DIR, "dist", "regulation");
mkdirSync(outDir, { recursive: true });
for (const dir of packDirs()) {
  const pack = buildPack(dir);
  const file = join(outDir, `${String(pack.pack.packId)}.json`);
  writeGenerated(file, serializePack(pack));
  const pending = pendingReviewEntries(pack);
  const onePath = pending.filter((p) => p.paths < 2).length;
  console.log(`${String(pack.pack.packId)} ${String(pack.pack.version)} ${pack.digest}（原本での確認待ち ${pending.length} 行、うち1経路だけ ${onePath} 行）`);
}

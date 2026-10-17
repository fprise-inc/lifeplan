// 0021: npm の依存のライセンスの検査（エンジンと同じ規則。ここの依存はすべて開発の道具で、配布物には入らない）
import { join } from "node:path";
import { checkLicenses } from "../../engine/scripts/check-licenses.ts";
import { REPORT_DIR } from "./engine.ts";

const { problems, seen } = checkLicenses(join(REPORT_DIR, "node_modules"));
const counts = new Map<string, number>();
for (const l of seen.values()) counts.set(l, (counts.get(l) ?? 0) + 1);
console.log(`npm の依存 ${seen.size} 件: ${[...counts.entries()].map(([l, n]) => `${l} ${n}`).join(", ")}`);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

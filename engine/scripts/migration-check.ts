// 0113 の7・11: 公開側の読み取り規則・用語辞書と書き方の見本の検査（npm run migration:check。CI）
import { join } from "node:path";
import { REPO_DIR } from "./lib.ts";
import { checkPublicFiles, jsonFiles } from "./migrationRules.ts";

const problems = checkPublicFiles();
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
const count = (d: string) => jsonFiles(join(REPO_DIR, "migration", d)).length;
console.log(`migration: 規則 ${count("rules")}・辞書 ${count("dictionaries")}・書き方の見本 ${count(join("schema", "examples"))}（公開側の規則の reads.product はすべて null）`);

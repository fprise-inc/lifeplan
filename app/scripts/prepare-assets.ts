// 画面のビルドの前に流す（npm run prepare-assets。dev・build・typecheck・lint・test が先に呼ぶ）
// 1. 計算エンジンのまとめた JS（engine/dist/engine.js）を public/engine/ に写す。本体（Rust）が埋め込むものと同じファイル（0005 の5: 二本立て）
// 2. 登録簿（registry/rows.yaml・params.yaml）から、表の行と制度の値の名前の表（src/generated/labels.ts）を作る
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { APP_DIR, ENGINE_DIST, REPO_DIR } from "./lib.ts";

const engineJs = join(ENGINE_DIST, "engine.js");
if (!existsSync(engineJs)) {
  console.error("engine/dist/engine.js がありません。先に engine/ で `npm ci && npm run build` を流してください");
  process.exit(1);
}
mkdirSync(join(APP_DIR, "public", "engine"), { recursive: true });
copyFileSync(engineJs, join(APP_DIR, "public", "engine", "engine.js"));

type Entry = { id: string; label?: string; status?: string };
const labels = (file: string): Record<string, string> => {
  const doc = parse(readFileSync(join(REPO_DIR, "registry", file), "utf8")) as { entries: Entry[] };
  const out: Record<string, string> = {};
  for (const e of doc.entries) if (typeof e.label === "string" && e.status !== "removed") out[e.id] = e.label;
  return out;
};
mkdirSync(join(APP_DIR, "src", "generated"), { recursive: true });
const text = [
  "// 自動生成（scripts/prepare-assets.ts）。手で書き換えない。登録簿（registry/）の名前",
  `export const ROW_LABELS: Readonly<Record<string, string>> = ${JSON.stringify(labels("rows.yaml"), null, 1)};`,
  `export const PARAM_LABELS: Readonly<Record<string, string>> = ${JSON.stringify(labels("params.yaml"), null, 1)};`,
  "",
].join("\n");
const target = join(APP_DIR, "src", "generated", "labels.ts");
if (!existsSync(target) || readFileSync(target, "utf8") !== text) writeFileSync(target, text);

// 画面のビルドの前に流す（npm run prepare-assets。dev・build・typecheck・lint・test が先に呼ぶ）
// 1. 計算エンジンのまとめた JS（engine/dist/engine.js）を public/engine/ に写す。本体（Rust）が埋め込むものと同じファイル（0005 の5: 二本立て）
// 2. 登録簿（registry/rows.yaml・params.yaml・items.yaml）から、表の行・制度の値・入力項目の名前の表（src/generated/labels.ts）を作る
// 3. 持ち帰り用のレポートの画面の部品を1つの JS・CSS にまとめる（scripts/build-takeaway.ts）
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
/** 入力項目の名前の短い形: 説明の括弧（「（」から後ろ）を外し、「案」を画面の呼び方の「プラン」にする */
const shortItemLabels = (all: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(all).map(([id, l]) => [id, (l.includes("（") ? l.slice(0, l.indexOf("（")) : l).replaceAll("案", "プラン")]));
mkdirSync(join(APP_DIR, "src", "generated"), { recursive: true });
const text = [
  "// 自動生成（scripts/prepare-assets.ts）。手で書き換えない。登録簿（registry/）の名前",
  `export const ROW_LABELS: Readonly<Record<string, string>> = ${JSON.stringify(labels("rows.yaml"), null, 1)};`,
  `export const PARAM_LABELS: Readonly<Record<string, string>> = ${JSON.stringify(labels("params.yaml"), null, 1)};`,
  "// 入力項目IDの短い名前（AIに渡す項目・AIからの候補の項目の表示に使う。説明の括弧を外し、画面の呼び方「プラン」にそろえる）",
  `export const ITEM_LABELS: Readonly<Record<string, string>> = ${JSON.stringify(shortItemLabels(labels("items.yaml")), null, 1)};`,
  "",
].join("\n");
const target = join(APP_DIR, "src", "generated", "labels.ts");
if (!existsSync(target) || readFileSync(target, "utf8") !== text) writeFileSync(target, text);

// 3. 持ち帰り用のレポート（0030）の画面の部品（public/takeaway/viewer.js・viewer.css）。中身が変わっていなければ作り直さない
await (await import("./build-takeaway.ts")).buildTakeaway();

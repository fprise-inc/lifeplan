// 画面のビルドの前に流す（npm run prepare-assets。dev・build・typecheck・lint・test が先に呼ぶ）
// 1. 計算エンジンのまとめた JS（engine/dist/engine.js）を public/engine/ に写す。本体（Rust）が埋め込むものと同じファイル（0005 の5: 二本立て）
// 2. 登録簿（registry/rows.yaml・params.yaml・items.yaml）から、表の行・制度の値・入力項目の名前の表（src/generated/labels.ts）を作る
//    入力項目の場所と読み替え表（registry/items.yaml・readings.yaml）から src/generated/readings.ts を作る（0035 の9）
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

// 2b. 入力項目ID の場所（registry/items.yaml の collection・path）と読み替え表（registry/readings.yaml）→ src/generated/readings.ts（0035 の9）
type Place = { id: string; status: string; replacedBy?: string | null; collection?: string | null; path?: string[] };
const itemDoc = parse(readFileSync(join(REPO_DIR, "registry", "items.yaml"), "utf8")) as { entries: Place[] };
const places: Record<string, { collection: string | null; path: string[]; status: string; replacedBy: string | null }> = {};
for (const e of itemDoc.entries) if (e.path !== undefined) places[e.id] = { collection: e.collection ?? null, path: e.path, status: e.status, replacedBy: e.replacedBy ?? null };
const readingDoc = parse(readFileSync(join(REPO_DIR, "registry", "readings.yaml"), "utf8")) as { kind: string; entries: unknown[] };
if (readingDoc.kind !== "reading") throw new Error("registry/readings.yaml: kind は reading");
// 物の集まりの名前（エンジンの入力のスキーマの x-collection）→ 世帯の欄の名前と、構成員を指す欄（x-owner。プランの差分の足す先と相手の確かめ。0036 の2・7）
const engineInput = JSON.parse(readFileSync(join(REPO_DIR, "engine", "schemas", "engine.input.json"), "utf8")) as { $defs: { household: { properties: Record<string, { "x-collection"?: string; "x-owner"?: string[] }> } } };
const collections: Record<string, { field: string; owners: string[] }> = {};
for (const [field, def] of Object.entries(engineInput.$defs.household.properties)) if (def["x-collection"] !== undefined) collections[def["x-collection"]] = { field, owners: def["x-owner"] ?? [] };
// 入力項目の値の中で値の箱を持つ場所と、省けない場所（並びの要素は *。"" は入力項目の値そのもの）。差分を書くときに、値の無い欄を
// 箱で書くか・「該当なし」で欄を消してよいかを決める（0036 の4・0035 の3）
type SchemaNode = { $ref?: string; properties?: Record<string, SchemaNode>; required?: string[]; items?: SchemaNode; oneOf?: SchemaNode[]; anyOf?: SchemaNode[]; allOf?: SchemaNode[]; then?: SchemaNode; "x-item"?: string };
const schemaDefs = (engineInput as unknown as { $defs: Record<string, SchemaNode> }).$defs;
const boxed: Record<string, Set<string>> = {};
const required: Record<string, Set<string>> = {};
function walkPlaces(node: SchemaNode | undefined, item: string, path: string[], depth: number): void {
  if (node === undefined || depth > 12) return;
  if (node.$ref !== undefined) {
    if (/common#\/\$defs\/box[A-Z]/.test(node.$ref)) (boxed[item] ??= new Set()).add(path.join("/"));
    else if (node.$ref.startsWith("#/$defs/")) walkPlaces(schemaDefs[node.$ref.slice("#/$defs/".length)], item, path, depth + 1);
  }
  for (const [k, v] of Object.entries(node.properties ?? {})) {
    if ((node.required ?? []).includes(k)) (required[item] ??= new Set()).add([...path, k].join("/"));
    walkPlaces(v, item, [...path, k], depth + 1);
  }
  if (node.items !== undefined) walkPlaces(node.items, item, [...path, "*"], depth + 1);
  for (const v of [...(node.oneOf ?? []), ...(node.anyOf ?? []), ...(node.allOf ?? []), ...(node.then !== undefined ? [node.then] : [])]) walkPlaces(v, item, path, depth + 1);
}
function findItems(node: SchemaNode | undefined, depth: number, seen: Set<SchemaNode>): void {
  if (node === undefined || depth > 30 || seen.has(node)) return;
  seen.add(node);
  for (const [k, v] of Object.entries(node.properties ?? {})) {
    if (v["x-item"] !== undefined) {
      if ((node.required ?? []).includes(k)) (required[v["x-item"]] ??= new Set()).add("");
      walkPlaces(v, v["x-item"], [], 0);
    }
    findItems(v, depth + 1, seen);
  }
  if (node.items !== undefined) findItems(node.items, depth + 1, seen);
  for (const v of [...(node.oneOf ?? []), ...(node.anyOf ?? []), ...(node.allOf ?? []), ...(node.then !== undefined ? [node.then] : [])]) findItems(v, depth + 1, seen);
}
const seenNodes = new Set<SchemaNode>();
// 要求の入力のいちばん上の項目（前提条件・遺したい額・相続税の設定など）も歩く
findItems(engineInput as unknown as SchemaNode, 0, seenNodes);
for (const d of Object.values(schemaDefs)) findItems(d, 0, seenNodes);
const sortedPlaces = (m: Record<string, Set<string>>) => Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, [...v].sort()]));
const boxedOut = sortedPlaces(boxed);
const requiredOut = sortedPlaces(required);
const readingsText = [
  "// 自動生成（scripts/prepare-assets.ts）。手で書き換えない。登録簿（registry/items.yaml・readings.yaml。0035 の6・9）",
  'import type { ReadingEntry } from "../workspace/store/readings.ts";',
  `export const BOXED_PLACES: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(boxedOut, null, 1)};`,
  `export const REQUIRED_PLACES: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(requiredOut, null, 1)};`,
  `export const COLLECTIONS: Readonly<Record<string, { field: string; owners: readonly string[] }>> = ${JSON.stringify(collections, null, 1)};`,
  `export const ITEM_PLACES: Readonly<Record<string, { collection: string | null; path: readonly string[]; status: string; replacedBy: string | null }>> = ${JSON.stringify(places, null, 1)};`,
  `export const READING_ENTRIES: readonly ReadingEntry[] = ${JSON.stringify(readingDoc.entries, null, 1)} as unknown as readonly ReadingEntry[];`,
  "",
].join("\n");
const readingsTarget = join(APP_DIR, "src", "generated", "readings.ts");
if (!existsSync(readingsTarget) || readFileSync(readingsTarget, "utf8") !== readingsText) writeFileSync(readingsTarget, readingsText);

// 3. 持ち帰り用のレポート（0030）の画面の部品（public/takeaway/viewer.js・viewer.css）。中身が変わっていなければ作り直さない
await (await import("./build-takeaway.ts")).buildTakeaway();

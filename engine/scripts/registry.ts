// 0004 の5: 登録簿を、それぞれの正本から作る（npm run gen の後半。--check は書き換えずに食い違いを知らせる）
// - 入力項目ID: データモデルの JSON Schema（engine.input.json の x-item。src/generated/items.json）
// - 計算部品ID: 公式部品のマニフェスト
// - 制度の値ID: 製品の制度データ（data/regulation。架空の見本は入れない）
// 一度載せた ID は消さない。正本から消えた ID は deprecated か removed にしてから外す（0004 の3）
// あわせて、種類をまたいで同じ文字列の ID が無いことを確かめる（0004 の2）
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OFFICIAL_DEFINITIONS } from "../src/components/index.ts";
import { CONVENTIONS } from "../src/money/conventions.ts";
import { SLOTS } from "../src/registry/slots.ts";
import { ENGINE_DIR, REPO_DIR } from "./lib.ts";
import { buildPack, packDirs, parseStrictYaml } from "./regulation.ts";

interface Entry {
  id: string;
  status: string;
  label: string;
  since: string;
  aliases: string[];
  replacedBy: string | null;
}

const check = process.argv.includes("--check");
const problems: string[] = [];

function load(file: string, kind: string): Entry[] {
  const path = join(REPO_DIR, "registry", file);
  if (!existsSync(path)) return [];
  const doc = parseStrictYaml(readFileSync(path, "utf8"), `registry/${file}`) as unknown as { kind: string; entries: Entry[] };
  if (doc.kind !== kind) throw new Error(`registry/${file}: kind は ${kind}`);
  return doc.entries;
}

const q = (s: string) => JSON.stringify(s);
function render(kind: string, header: string, entries: Entry[]): string {
  const lines = [header, `kind: ${kind}`, "entries:"];
  for (const e of entries) {
    lines.push(`  - id: ${e.id}`, `    status: ${e.status}`, `    label: ${q(e.label)}`, `    since: ${e.since}`, `    aliases: [${e.aliases.join(", ")}]`, `    replacedBy: ${e.replacedBy ?? "null"}`);
  }
  return `${lines.join("\n")}\n`;
}

function sync(file: string, kind: string, header: string, source: ReadonlyMap<string, string>): string[] {
  const old = load(file, kind);
  const byId = new Map(old.map((e) => [e.id, e]));
  const out: Entry[] = [];
  for (const [id, label] of [...source].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const prev = byId.get(id);
    out.push(prev === undefined ? { id, status: "active", label, since: "draft", aliases: [], replacedBy: null } : { ...prev, label });
  }
  for (const e of old) {
    if (source.has(e.id)) continue;
    if (e.status === "active") problems.push(`registry/${file}: ${e.id} が正本から消えました（登録簿から消さず、deprecated か removed にする）`);
    out.push(e);
  }
  out.sort((a, b) => (a.id < b.id ? -1 : 1));
  const text = render(kind, header, out);
  const path = join(REPO_DIR, "registry", file);
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current !== text) {
    if (check) problems.push(`registry/${file}: 正本と食い違っています（npm run gen で作り直す）`);
    else writeFileSync(path, text);
  }
  return out.flatMap((e) => [e.id, ...e.aliases]);
}

const SINCE = "# since は公開の約束の版の初期値（0.x。0001 の追記）を β公開で 1.0 にするまで draft とする";
const items = JSON.parse(readFileSync(join(ENGINE_DIR, "src", "generated", "items.json"), "utf8")) as { items: Record<string, { title: string }> };
const itemIds = sync(
  "items.yaml",
  "item",
  `# 0004 の5: 入力項目IDの登録簿。正本は engine/schemas/engine.input.json の x-item（scripts/registry.ts が作る。手で書き換えない）\n${SINCE}`,
  new Map(Object.entries(items.items).map(([id, v]) => [id, v.title])),
);
const componentIds = sync(
  "components.yaml",
  "component",
  `# 0004 の5: 計算部品IDの登録簿。正本は公式部品のマニフェスト（scripts/registry.ts が作る。手で書き換えない）\n${SINCE}`,
  new Map(OFFICIAL_DEFINITIONS.map((d) => [d.id, d.title ?? d.id])),
);
const params = new Map<string, string>();
for (const dir of packDirs()) for (const v of buildPack(dir).values) params.set(v.id as string, v.title as string);
const paramIds = sync(
  "params.yaml",
  "param",
  `# 0004 の5: 制度の値IDの登録簿。正本は data/regulation の制度データ（scripts/registry.ts が作る。手で書き換えない）\n${SINCE}`,
  params,
);
// 部品が読む制度の値のうち、製品の制度データにまだ無いもの（推測で埋めずに置いていないもの）も、値IDとして予約する
const declared = new Set(OFFICIAL_DEFINITIONS.flatMap((d) => d.params));
const rowsDoc = parseStrictYaml(readFileSync(join(REPO_DIR, "registry", "rows.yaml"), "utf8"), "registry/rows.yaml") as unknown as { entries: Entry[] };
const kinds: Record<string, readonly string[]> = {
  row: rowsDoc.entries.flatMap((e) => [e.id, ...e.aliases]),
  item: itemIds,
  component: componentIds,
  param: [...new Set([...paramIds, ...[...declared].filter((p) => !p.startsWith("conv."))])],
  slot: [...SLOTS.keys()],
  convention: Object.keys(CONVENTIONS),
};
const owner = new Map<string, string>();
for (const [kind, ids] of Object.entries(kinds)) {
  for (const id of ids) {
    const o = owner.get(id);
    if (o !== undefined && o !== kind) problems.push(`ID ${id} が ${o} と ${kind} の両方にあります（0004 の2）`);
    owner.set(id, kind);
  }
}
const missing = [...declared].filter((p) => !p.startsWith("conv.") && !params.has(p)).sort();
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`registry: ${itemIds.length} items, ${componentIds.length} components, ${paramIds.length} params（部品が読むが制度データにまだ無い値 ${missing.length}: ${missing.join(", ")}）`);

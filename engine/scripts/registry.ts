// 0004 の5: 登録簿を、それぞれの正本から作る（npm run gen の後半。--check は書き換えずに食い違いを知らせる）
// - 入力項目ID: データモデルの JSON Schema（engine.input.json の x-item。src/generated/items.json）と、画面の側の区画のスキーマ（app/schemas。0035 の6）
// - 計算部品ID: 公式部品のマニフェスト
// - 制度の値ID: 製品の制度データ（data/regulation。架空の見本は入れない）
// 一度載せた ID は消さない。正本から消えた ID は deprecated か removed にしてから外す（0004 の3）
// あわせて、種類をまたいで同じ文字列の ID が無いこと（0004 の2）と、読み替え表の形（0035 の9）を確かめる
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  /** 入力項目ID だけ: 物の集まり（x-collection。null は要求の入力の直下・前提）と、その物の中の欄の道（0035 の6・9: 当て先から値を引く） */
  collection?: string | null;
  path?: string[];
  /** 入力項目ID だけ: 時点のある値（x-pointInTime。0113 の7）。印の無い項目は欄を書かない */
  pointInTime?: true;
  /** 計算部品ID だけ: 差し替えを許す公式部品（マニフェストの replaceable。0119）。許さない部品は欄を書かない */
  replaceable?: true;
}

/** 入力項目ID の場所（items.json の collection・path）と時点のある値の印 */
type Place = { collection: string | null; path: string[]; pointInTime?: true };

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
    if (e.path !== undefined) lines.push(`    collection: ${e.collection ?? "null"}`, `    path: [${e.path.join(", ")}]`);
    if (e.pointInTime === true) lines.push("    pointInTime: true");
    if (e.replaceable === true) lines.push("    replaceable: true");
  }
  return `${lines.join("\n")}\n`;
}

function sync(
  file: string,
  kind: string,
  header: string,
  source: ReadonlyMap<string, string>,
  places?: ReadonlyMap<string, Place>,
  replaceable?: ReadonlySet<string>,
): string[] {
  const old = load(file, kind);
  const byId = new Map(old.map((e) => [e.id, e]));
  const out: Entry[] = [];
  for (const [id, label] of [...source].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const prev = byId.get(id);
    const place = places?.get(id);
    const { replaceable: _wasReplaceable, ...kept } = prev ?? ({} as Partial<Entry>);
    void _wasReplaceable;
    const flag = replaceable?.has(id) === true ? { replaceable: true as const } : {};
    const base: Entry = prev === undefined ? { id, status: "active", label, since: "draft", aliases: [], replacedBy: null, ...flag } : { ...(kept as Entry), label, ...flag };
    if (place === undefined) out.push(base);
    else {
      const { pointInTime: _was, ...rest } = base as Entry;
      void _was;
      out.push({ ...rest, collection: place.collection, path: place.path, ...(place.pointInTime === true ? { pointInTime: true as const } : {}) });
    }
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
const items = JSON.parse(readFileSync(join(ENGINE_DIR, "src", "generated", "items.json"), "utf8")) as { items: Record<string, Place & { title: string }> };
// 0035 の6: 画面の側の値の入力項目ID（世帯ファイルの本文の画面の側の区画のスキーマの x-item）。物の集まりの名前の代わりに区画の名前を書き、
// 場所はその区画の中の欄の名前（例: 万一の前提 contingencyPremise.* → app/schemas/household.contingency.json の直下の欄。0071）
for (const [file, section] of [["household.contingency.json", "contingencyPremise"]] as const) {
  const doc = JSON.parse(readFileSync(join(REPO_DIR, "app", "schemas", file), "utf8")) as { properties: Record<string, { title?: string; "x-item"?: string }> };
  for (const [name, node] of Object.entries(doc.properties)) {
    const id = node["x-item"];
    if (id === undefined) continue;
    if (!id.startsWith(`${section}.`)) problems.push(`app/schemas/${file}: ${id} は ${section}. で始めます`);
    if (items.items[id] !== undefined) problems.push(`app/schemas/${file}: ${id} が engine.input.json にもあります`);
    items.items[id] = { collection: section, path: [name], title: node.title ?? "" };
  }
}
const itemIds = sync(
  "items.yaml",
  "item",
  `# 0004 の5: 入力項目IDの登録簿。正本は engine/schemas/engine.input.json の x-item と、画面の側の区画のスキーマ app/schemas/*.json の x-item（scripts/registry.ts が作る。手で書き換えない）\n# collection・path は値の場所（物の集まりと、物の中の欄の道。collection が null なら要求の入力から）。当て先から値を引くのに使う（0035 の6・9）\n# pointInTime は時点のある値（ある時点の値として持ち、時間が経つと違う値になる入力項目。正本は x-pointInTime。0113 の7）\n${SINCE}`,
  new Map(Object.entries(items.items).map(([id, v]) => [id, v.title])),
  new Map(Object.entries(items.items).map(([id, v]) => [id, { collection: v.collection, path: v.path, ...(v.pointInTime === true ? { pointInTime: true as const } : {}) }])),
);
const componentIds = sync(
  "components.yaml",
  "component",
  `# 0004 の5: 計算部品IDの登録簿。正本は公式部品のマニフェスト（scripts/registry.ts が作る。手で書き換えない）\n# replaceable は差し替えを許す公式部品（マニフェストの replaceable。一覧と理由は設計記録 0119・SDK の docs/extension-points.md）\n${SINCE}`,
  new Map(OFFICIAL_DEFINITIONS.map((d) => [d.id, d.title ?? d.id])),
  undefined,
  new Set(OFFICIAL_DEFINITIONS.filter((d) => d.replaceable === true).map((d) => d.id)),
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
// 0035 の9: 読み替え表（registry/readings.yaml）の形と、当て先の入力項目ID が登録簿にあること
type ReadingStep = string | { n?: number; nth?: number; id?: number; where?: Record<string, string> };
const readingsDoc = parseStrictYaml(readFileSync(join(REPO_DIR, "registry", "readings.yaml"), "utf8"), "registry/readings.yaml") as unknown as {
  kind: string;
  entries: { from: string; until: string; to: { target?: string; find?: string; item?: string; at?: ReadingStep[]; method?: string; lever?: string; object?: boolean; member?: boolean; unresolved?: string } }[];
};
if (readingsDoc.kind !== "reading") problems.push("registry/readings.yaml: kind は reading");
const fromSeen = new Set<string>();
const itemSet = new Set(itemIds);
for (const e of readingsDoc.entries) {
  const where = `registry/readings.yaml: ${e.from}`;
  if (typeof e.from !== "string" || fromSeen.has(e.from)) problems.push(`${where}: from が無いか重なっています`);
  fromSeen.add(e.from);
  if (e.until !== "0.16") problems.push(`${where}: until は読み替える鍵を書いた最後の形式の版（0.16）`);
  const to = e.to;
  const kinds = [to.item !== undefined, to.lever !== undefined, to.unresolved !== undefined].filter(Boolean).length;
  if (kinds !== 1) {
    problems.push(`${where}: to は当て先・合成の対策・読み替えられないの1つだけ`);
    continue;
  }
  const count = (name: string) => e.from.split(`{${name}}`).length - 1;
  if (to.item !== undefined) {
    if (!itemSet.has(to.item)) problems.push(`${where}: 入力項目ID ${to.item} が登録簿にありません`);
    if (!["object", "member", "assumptions", "input"].includes(to.target ?? "")) problems.push(`${where}: target は object・member・assumptions・input`);
    if (to.target === "object" && to.find === undefined && count("object") !== 1) problems.push(`${where}: target が object なら from に {object} が1つ`);
    if (to.target === "member" && count("member") !== 1) problems.push(`${where}: target が member なら from に {member} が1つ`);
    if (to.find !== undefined && (to.find !== "currentPeriod" || count("member") !== 1)) problems.push(`${where}: find は currentPeriod（from に {member} が1つ）`);
    for (const st of to.at ?? []) {
      if (typeof st === "string") continue;
      if (st.n !== undefined && (st.n < 1 || st.n > count("n"))) problems.push(`${where}: {n: ${st.n}} に当たる番号が from にありません`);
      if (st.id !== undefined && (st.id < 1 || st.id > count("id"))) problems.push(`${where}: {id: ${st.id}} に当たる ID が from にありません`);
    }
  }
}
// 本体（crates/household-store）の 0.16 → 0.17 の変換の段が組み込む写し（JSON。YAML の正本から作る。手で書き換えない）
{
  const places = Object.fromEntries(
    load("items.yaml", "item")
      .filter((e) => e.path !== undefined)
      .map((e) => [e.id, { collection: e.collection ?? null, path: e.path }]),
  );
  const text = `${JSON.stringify({ $comment: "0035 の9: registry/readings.yaml と registry/items.yaml の値の場所の写し（engine の npm run gen が作る。手で書き換えない）", entries: readingsDoc.entries, places }, null, 1)}\n`;
  const path = join(REPO_DIR, "crates", "household-store", "data", "readings.json");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current !== text) {
    if (check) problems.push("crates/household-store/data/readings.json: 読み替え表と食い違っています（npm run gen で作り直す）");
    else {
      mkdirSync(join(REPO_DIR, "crates", "household-store", "data"), { recursive: true });
      writeFileSync(path, text);
    }
  }
}
const missing = [...declared].filter((p) => !p.startsWith("conv.") && !params.has(p)).sort();
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`registry: ${readingsDoc.entries.length} readings, ${itemIds.length} items, ${componentIds.length} components, ${paramIds.length} params（部品が読むが制度データにまだ無い値 ${missing.length}: ${missing.join(", ")}）`);

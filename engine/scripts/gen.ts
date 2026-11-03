// ビルドの前に作るもの（src/generated/。コミットしない）
// 1. 科目の木の登録簿（YAML）→ JSON
// 2. JSON Schema → 検査器のコード（Ajv の standalone。実行環境ではコードを作らない。0006 の5）
// 2b. 入力項目ID（engine.input.json の x-item・x-collection・x-owner・x-pointInTime）→ items.json
// 3. 版と、ソース・部品の指紋
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { checkId } from "../src/ids/ids.ts";
import { AJV_OPTIONS, ENGINE_DIR, listFiles, posixRelative, readJson, REPO_DIR, sha256, writeGenerated } from "./lib.ts";
import { parseStrictYaml } from "./regulation.ts";

const OUT = join(ENGINE_DIR, "src", "generated");
mkdirSync(OUT, { recursive: true });

// 1. 登録簿
type Entry = { id: string; status: string; label: string; since: string; aliases: string[]; replacedBy: string | null };
const rowsPath = join(REPO_DIR, "registry", "rows.yaml");
const rows = parseStrictYaml(readFileSync(rowsPath, "utf8"), "registry/rows.yaml") as unknown as { kind: string; entries: Entry[] };
if (rows.kind !== "row") throw new Error("registry/rows.yaml: kind は row");
const seen = new Set<string>();
for (const e of rows.entries) {
  checkId("row", e.id);
  if (seen.has(e.id)) throw new Error(`registry/rows.yaml: 重複 ${e.id}`);
  seen.add(e.id);
  if (!["active", "deprecated", "removed"].includes(e.status)) throw new Error(`registry/rows.yaml: status ${e.id}`);
  const parent = e.id.slice(0, e.id.lastIndexOf("."));
  if (parent !== "cf" && !seen.has(parent)) throw new Error(`registry/rows.yaml: 親の行が先にありません ${e.id}`);
  for (const a of e.aliases) checkId("row", a);
}
writeGenerated(join(OUT, "rows.json"), `${JSON.stringify(rows, null, 2)}\n`);

// 2. 検査器
const schemaFiles = listFiles(join(ENGINE_DIR, "schemas"), (p) => p.endsWith(".json"));
const ajv = new Ajv2020({ ...AJV_OPTIONS, inlineRefs: true, code: { source: true, esm: true, lines: false } });
ajv.addKeyword({ keyword: "x-unit", schemaType: "string" });
ajv.addKeyword({ keyword: "x-item", schemaType: "string" });
ajv.addKeyword({ keyword: "x-collection", schemaType: "string" });
ajv.addKeyword({ keyword: "x-owner", schemaType: "array" });
ajv.addKeyword({ keyword: "x-pointInTime", schemaType: "boolean" });
const mapping: Record<string, string> = {};
const keys: Record<string, string> = {};
for (const f of schemaFiles) {
  const schema = readJson(f) as { $id: string };
  ajv.addSchema(schema);
  const key = basename(f, ".json");
  if (key === "common") continue;
  const exportName = `v_${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
  mapping[exportName] = schema.$id;
  keys[key] = exportName;
}
// Ajv は文字数の補助関数を require で読むので、同じ中身の関数に置き換える（まとめた JS を自己完結にする）
const UCS2LENGTH =
  "(function(s){let n=0,p=0,v;const l=s.length;while(p<l){n++;v=s.charCodeAt(p++);if(v>=0xd800&&v<=0xdbff&&p<l){v=s.charCodeAt(p);if((v&0xfc00)===0xdc00)p++;}}return n;})";
let code = standaloneCode(ajv, mapping).split('require("ajv/dist/runtime/ucs2length").default').join(UCS2LENGTH);
code += `\nexport const byKey = {${Object.entries(keys)
  .map(([k, v]) => `${JSON.stringify(k)}: ${v}`)
  .join(", ")}};\n`;
if (/require\(/.test(code)) throw new Error("検査器のコードに require が残っています");
// 0005 の追記（速さ）: お金の動きの行・月・構成員の ID など、同じ文字列を何度も同じ正規表現で確かめるので、正規表現ごとに結果を覚える
// （正規表現は g・y の印を持たないので、同じ文字列なら同じ結果）
if (/new RegExp\([^)]*"[^"]*[gy][^"]*"\)/.test(code)) throw new Error("検査器の正規表現に g・y の印があります（結果を覚えられません）");
code = code.replace(/\b(pattern\d+)\.test\(/g, "__memoTest($1, ");
// 0005 の追記（2026-10-10 の速さの見直し）: 内側の検査器の呼び出しのたびに作る引数の物（instancePath・parentData・parentDataProperty・
// rootData・dynamicAnchors）をやめ、使っている instancePath だけを位置の引数で渡す（お金の動き1件ごとに物を作って分解すると、内蔵の
// quickjs-ng では出力の検査の時間の半分を占めた）。ほかの4つは誤りの形にも使っていない（下で確かめる）ので、検査の結果と誤りは同じ
const HEADER = '(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={})';
const headers = code.split(HEADER).length - 1;
code = code.split(HEADER).join('(data, instancePath = "")');
code = code.replace(/\{instancePath:([^{}]*?),parentData:[^{},]*,parentDataProperty:[^{},]*,rootData,dynamicAnchors\}/g, "$1");
code = code.split("{instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}").join("instancePath");
if (headers === 0 || /\b(parentData|parentDataProperty|rootData|dynamicAnchors)\b/.test(code)) {
  throw new Error("検査器のコードの形が想定と違います（引数の書き換えを見直してください）");
}
code =
  "const __memo = new Map();\n" +
  "function __memoTest(re, s) { if (typeof s !== \"string\") return re.test(s); let m = __memo.get(re); if (m === undefined) { m = new Map(); __memo.set(re, m); } let v = m.get(s); if (v === undefined) { v = re.test(s); if (m.size < 50000) m.set(s, v); } return v; }\n" +
  code;
writeGenerated(join(OUT, "validators.js"), `// 自動生成（scripts/gen.ts）。編集しない\n${code}`);
writeGenerated(
  join(OUT, "validators.d.ts"),
  "// 自動生成（scripts/gen.ts）\nexport declare const byKey: Readonly<Record<string, (data: unknown) => boolean>>;\n",
);

// 2b. 入力項目ID（0004 の5: 正本はデータモデルの JSON Schema。x-item と x-collection から作る）
type SchemaNode = Record<string, unknown>;
const inputSchema = readJson(join(ENGINE_DIR, "schemas", "engine.input.json")) as SchemaNode;
const items: Record<string, { collection: string | null; path: string[]; title: string; pointInTime?: true }> = {};
const collections: Record<string, string[]> = {};
// 集まりの物がどの構成員の物か（x-owner。0006 の追記: 構成員ごとの依存）
const owners: Record<string, string[]> = {};
const resolveLocal = (ref: string): SchemaNode => {
  if (!ref.startsWith("#/$defs/")) throw new Error(`engine.input.json: 外の $ref の中は x-item を探しません ${ref}`);
  return (inputSchema.$defs as Record<string, SchemaNode>)[ref.slice("#/$defs/".length)] as SchemaNode;
};
const walkSchema = (node: SchemaNode, collection: string | null, path: string[], seen: readonly string[]): void => {
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    if (seen.includes(node.$ref)) return;
    walkSchema(resolveLocal(node.$ref), collection, path, [...seen, node.$ref]);
  }
  const item = node["x-item"];
  if (typeof item === "string") {
    checkId("item", item);
    const prev = items[item];
    if (prev !== undefined && (prev.collection !== collection || prev.path.join(".") !== path.join("."))) {
      throw new Error(`engine.input.json: 入力項目ID ${item} が別の場所にもあります`);
    }
    if (collection !== null && !item.startsWith(`${collection}.`)) throw new Error(`engine.input.json: ${item} は ${collection}. で始めます`);
    if (prev === undefined || (prev.title === "" && typeof node.title === "string")) {
      items[item] = { collection, path, title: typeof node.title === "string" ? node.title : "", ...(prev?.pointInTime === true ? { pointInTime: true as const } : {}) };
    }
    // 時点のある値の印（x-pointInTime。0113 の7: 移行元のプランの時点と今の計算基準月が違えば、書類待ちか推定 migrated にする）
    if (node["x-pointInTime"] === true) (items[item] as { pointInTime?: true }).pointInTime = true;
    else if (node["x-pointInTime"] !== undefined) throw new Error(`engine.input.json: ${item} の x-pointInTime は true だけ`);
  }
  const props = node.properties as Record<string, SchemaNode> | undefined;
  for (const [k, child] of Object.entries(props ?? {})) {
    if (typeof child === "object" && child !== null) walkSchema(child, collection, [...path, k], seen);
  }
  if (typeof node["x-collection"] === "string") {
    const c = node["x-collection"];
    collections[c] = path;
    if (Array.isArray(node["x-owner"])) owners[c] = node["x-owner"] as string[];
    walkSchema(node.items as SchemaNode, c, [], seen);
  }
  for (const k of ["oneOf", "anyOf", "allOf"]) for (const sub of (node[k] as SchemaNode[] | undefined) ?? []) walkSchema(sub, collection, path, seen);
};
walkSchema(inputSchema, null, [], []);
for (const [id, it] of Object.entries(items)) if (it.title === "") throw new Error(`engine.input.json: ${id} に title がありません`);
const sortedItems = Object.fromEntries(Object.entries(items).sort(([a], [b]) => (a < b ? -1 : 1)));
writeGenerated(join(OUT, "items.json"), `${JSON.stringify({ collections, owners, items: sortedItems }, null, 2)}\n`);


// 3. 版と指紋（ソースの指紋は src と schemas と登録簿。部品の指紋は部品のフォルダの中身）
const pkg = readJson(join(ENGINE_DIR, "package.json")) as { version: string };
const digestOf = (files: string[], root: string) =>
  `sha256:${sha256(files.map((f) => `${posixRelative(root, f)}\u0000${sha256(readFileSync(f))}\n`).join(""))}`;
const sources = [
  ...listFiles(join(ENGINE_DIR, "src"), (p) => p.endsWith(".ts") && !p.includes(`${join("src", "generated")}`)),
  ...schemaFiles,
  rowsPath,
];
const components: Record<string, string> = {};
for (const f of listFiles(join(ENGINE_DIR, "src", "components"), (p) => p.endsWith(`${join("", "index.ts")}`))) {
  const dir = dirname(f);
  const id = basename(dir);
  if (id === "components") continue;
  checkId("component", id);
  components[id] = digestOf(
    listFiles(dir, () => true),
    dir,
  );
}
writeGenerated(
  join(OUT, "build-info.json"),
  `${JSON.stringify({ version: pkg.version, sourceDigest: digestOf(sources, ENGINE_DIR), components }, null, 2)}\n`,
);
console.log(
  `generated: ${Object.keys(keys).length} validators, ${rows.entries.length} rows, ${Object.keys(items).length} items, ${Object.keys(components).length} components`,
);

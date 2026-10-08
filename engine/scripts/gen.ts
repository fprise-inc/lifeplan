// ビルドの前に作るもの（src/generated/。コミットしない）
// 1. 科目の木の登録簿（YAML）→ JSON
// 2. JSON Schema → 検査器のコード（Ajv の standalone。実行環境ではコードを作らない。0006 の5）
// 3. 版と、ソース・部品の指紋
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { checkId } from "../src/ids/ids.ts";
import { AJV_OPTIONS, ENGINE_DIR, listFiles, posixRelative, readJson, REPO_DIR, sha256 } from "./lib.ts";
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
writeFileSync(join(OUT, "rows.json"), `${JSON.stringify(rows, null, 2)}\n`);

// 2. 検査器
const schemaFiles = listFiles(join(ENGINE_DIR, "schemas"), (p) => p.endsWith(".json"));
const ajv = new Ajv2020({ ...AJV_OPTIONS, inlineRefs: false, code: { source: true, esm: true, lines: false } });
ajv.addKeyword({ keyword: "x-unit", schemaType: "string" });
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
writeFileSync(join(OUT, "validators.js"), `// 自動生成（scripts/gen.ts）。編集しない\n${code}`);
writeFileSync(
  join(OUT, "validators.d.ts"),
  "// 自動生成（scripts/gen.ts）\nexport declare const byKey: Readonly<Record<string, (data: unknown) => boolean>>;\n",
);

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
writeFileSync(
  join(OUT, "build-info.json"),
  `${JSON.stringify({ version: pkg.version, sourceDigest: digestOf(sources, ENGINE_DIR), components }, null, 2)}\n`,
);
console.log(`generated: ${Object.keys(keys).length} validators, ${rows.entries.length} rows, ${Object.keys(components).length} components`);

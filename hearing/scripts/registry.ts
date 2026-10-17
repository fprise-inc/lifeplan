// 0004 の5: ヒアリング項目のキーの登録簿（registry/hearing.yaml）を、同梱したすべての版のシート定義から作る。
// 一度載せたキーは消さない（0018 の3: キーは変えない・使い回さない・消さない）。すべての版で廃止したキーは deprecated にする。
//   node scripts/registry.ts          … 登録簿を作り直す
//   node scripts/registry.ts --check  … 登録簿がシート定義と食い違っていないかを確かめる（CI）
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { OFFICIAL_SHEETS } from "../src/index.ts";

interface Entry {
  id: string;
  status: string;
  label: string;
  since: string;
  aliases: string[];
  replacedBy: string | null;
}

const check = process.argv.includes("--check");
const path = join(import.meta.dirname, "..", "..", "registry", "hearing.yaml");
const old = existsSync(path) ? ((parse(readFileSync(path, "utf8")) as { entries: Entry[] }).entries ?? []) : [];
const byId = new Map(old.map((e) => [e.id, e]));
const problems: string[] = [];

// 新しい版の表示名を使う。どれかの版で廃止されていない（retiredIn が null）なら active
const source = new Map<string, { label: string; active: boolean }>();
for (const def of [...OFFICIAL_SHEETS].sort((a, b) => a.version - b.version)) {
  for (const i of def.items) {
    const prev = source.get(i.key);
    source.set(i.key, { label: i.label, active: (prev?.active ?? false) || i.retiredIn === null });
  }
}
const out: Entry[] = [];
for (const [id, s] of source) {
  const prev = byId.get(id);
  const status = s.active ? "active" : "deprecated";
  out.push(prev === undefined ? { id, status, label: s.label, since: "draft", aliases: [], replacedBy: null } : { ...prev, status: prev.status === "removed" ? "removed" : status, label: s.label });
}
for (const e of old) {
  if (source.has(e.id)) continue;
  if (e.status === "active") problems.push(`registry/hearing.yaml: ${e.id} がシート定義から消えました（キーは消さず、廃止として定義に残す。0018 の3）`);
  out.push(e);
}
out.sort((a, b) => (a.id < b.id ? -1 : 1));
const q = (s: string) => JSON.stringify(s);
const lines = [
  "# 0004 の5: ヒアリング項目のキーの登録簿。正本は hearing/sheets/ のシート定義（hearing/scripts/registry.ts が作る。手で書き換えない）",
  "# since は公開の約束の版の初期値（0.x。0001 の追記）を β公開で 1.0 にするまで draft とする",
  "kind: hearingKey",
  "entries:",
];
for (const e of out) lines.push(`  - id: ${e.id}`, `    status: ${e.status}`, `    label: ${q(e.label)}`, `    since: ${e.since}`, `    aliases: [${e.aliases.join(", ")}]`, `    replacedBy: ${e.replacedBy ?? "null"}`);
const text = `${lines.join("\n")}\n`;
const current = existsSync(path) ? readFileSync(path, "utf8") : "";
if (current !== text) {
  if (check) problems.push("registry/hearing.yaml: シート定義と食い違っています（hearing/ で npm run registry を流す）");
  else writeFileSync(path, text);
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`registry: ヒアリング項目のキー ${out.length}`);

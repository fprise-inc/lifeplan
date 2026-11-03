// 0113 の4・5・11: 他のソフトの帳票の読み取り規則（migration-rule@1.0）と用語辞書（term-dictionary@1.0）の検査。
// - 形は migration/schema/ の JSON Schema（知らない欄・プログラムらしき文字を断る）
// - JSON Schema で書けない決まり: 区画の ID の重なり、table の区画の物の種類、辞書の対応先の ID が登録簿にあって deprecated でないこと
//   （registry/items.yaml・rows.yaml）、前提条件・表の行・移行メモの値の読み方
// - 公開側の規則と辞書（migration/rules/・migration/dictionaries/）: 作成者は official、ファイル名は <id>.json、規則の reads.product は null
//   （製品ごとの規則は非公開のリポジトリにだけ置く。0113 の11）、規則が挙げた辞書が公開側にあること
// - 書き方の見本（migration/schema/examples/）も同じ検査に通す（過去の版の書き方がいつまでも読めること）
// `npm run migration:check`（scripts/migration-check.ts。CI。0113 の7）。単体テストは test/migration-schema.test.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { AJV_OPTIONS, REPO_DIR } from "./lib.ts";
import { parseStrictYaml } from "./regulation.ts";

type Obj = Record<string, unknown>;

/** 登録簿から引く対応先の ID（状態）と、物の集まりの名前 */
export interface MigrationContext {
  readonly items: ReadonlyMap<string, { readonly status: string; readonly collection: string | null }>;
  readonly rows: ReadonlyMap<string, string>;
  readonly collections: ReadonlySet<string>;
}

export interface MigrationValidators {
  readonly rule: ValidateFunction;
  readonly dictionary: ValidateFunction;
}

export function loadContext(repoDir: string = REPO_DIR): MigrationContext {
  const read = (file: string) =>
    (parseStrictYaml(readFileSync(join(repoDir, "registry", file), "utf8"), `registry/${file}`) as unknown as { entries: { id: string; status: string; aliases?: string[]; collection?: string | null }[] }).entries;
  const items = new Map<string, { status: string; collection: string | null }>();
  for (const e of read("items.yaml")) items.set(e.id, { status: e.status, collection: e.collection ?? null });
  const rows = new Map<string, string>();
  for (const e of read("rows.yaml")) rows.set(e.id, e.status);
  const collections = new Set([...items.values()].map((v) => v.collection).filter((c): c is string => c !== null));
  return { items, rows, collections };
}

export function compileValidators(repoDir: string = REPO_DIR): MigrationValidators {
  const ajv = new Ajv2020({ ...AJV_OPTIONS, allErrors: false });
  const dir = join(repoDir, "migration", "schema");
  const rule = JSON.parse(readFileSync(join(dir, "migration-rule.schema.json"), "utf8")) as Obj;
  const dictionary = JSON.parse(readFileSync(join(dir, "term-dictionary.schema.json"), "utf8")) as Obj;
  ajv.addSchema(rule);
  ajv.addSchema(dictionary);
  return { rule: ajv.getSchema(rule.$id as string) as ValidateFunction, dictionary: ajv.getSchema(dictionary.$id as string) as ValidateFunction };
}

const schemaProblem = (v: ValidateFunction, where: string): string => {
  const e = v.errors?.[0];
  return `${where}: 形が合いません（${e?.instancePath === "" ? "/" : (e?.instancePath ?? "/")} ${e?.keyword ?? "?"}${e?.message !== undefined ? ` ${e.message}` : ""}）`;
};

/** 読み取り規則を確かめる（問題の一覧。空なら合格） */
export function checkRule(doc: unknown, ctx: MigrationContext, v: MigrationValidators, where: string): string[] {
  if (!v.rule(doc)) return [schemaProblem(v.rule, where)];
  const r = doc as { detect: { allWords: string[]; anyWords: string[]; minHits: number }; blocks: { id: string; kind: string; object?: string }[] };
  const out: string[] = [];
  const ids = new Set<string>();
  for (const b of r.blocks) {
    if (ids.has(b.id)) out.push(`${where}: 区画の ID ${b.id} が重なっています`);
    ids.add(b.id);
    if (b.kind === "table" && !ctx.collections.has(b.object as string)) out.push(`${where}: 区画 ${b.id} の物の種類 ${b.object} はエンジンの入力の物の集まりにありません`);
  }
  if (r.detect.minHits > r.detect.anyWords.length) out.push(`${where}: detect.minHits が anyWords の数より大きい`);
  if (r.detect.allWords.length === 0 && r.detect.minHits === 0) out.push(`${where}: detect に当てはまる言葉がありません（allWords か、minHits が1以上の anyWords）`);
  return out;
}

/** 用語辞書を確かめる（問題の一覧。空なら合格） */
export function checkDictionary(doc: unknown, ctx: MigrationContext, v: MigrationValidators, where: string): string[] {
  if (!v.dictionary(doc)) return [schemaProblem(v.dictionary, where)];
  type To = { item?: string; member?: string; object?: string; row?: string; memo?: true; drop?: true };
  const d = doc as { entries: { words: string[]; to: To; value?: { unit: string } }[] };
  const out: string[] = [];
  d.entries.forEach((e, i) => {
    const at = `${where}: entries[${i}]（${e.words[0] ?? ""}）`;
    const to = e.to;
    if (to.item !== undefined) {
      const it = ctx.items.get(to.item);
      if (it === undefined) out.push(`${at}: 入力項目ID ${to.item} が登録簿にありません`);
      else if (it.status !== "active") out.push(`${at}: 入力項目ID ${to.item} は ${it.status}（使えません）`);
      if (to.item.startsWith("assumptions.") && (to.member !== undefined || to.object !== undefined)) out.push(`${at}: 前提条件には member・object を付けません`);
      if (to.object !== undefined) {
        if (!ctx.collections.has(to.object)) out.push(`${at}: 物の種類 ${to.object} はエンジンの入力の物の集まりにありません`);
        else if (it !== undefined && it.collection !== to.object) out.push(`${at}: ${to.item} は物の種類 ${to.object} の入力項目ではありません`);
      }
      if (e.value?.unit === "text") out.push(`${at}: 文字のまま（text）は移行メモにだけ使えます`);
    }
    if (to.row !== undefined) {
      const st = ctx.rows.get(to.row);
      if (st === undefined) out.push(`${at}: 行ID ${to.row} が登録簿にありません`);
      else if (st !== "active") out.push(`${at}: 行ID ${to.row} は ${st}（使えません）`);
      if (e.value !== undefined && e.value.unit !== "money" && e.value.unit !== "yen") out.push(`${at}: 表の行（参照値）の値は money か yen`);
    }
    if (to.memo === true && e.value !== undefined && e.value.unit !== "text") out.push(`${at}: 移行メモの値は text だけ`);
  });
  return out;
}

export const jsonFiles = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []);

/** 公開側の規則・辞書と書き方の見本を確かめる（問題の一覧） */
export function checkPublicFiles(repoDir: string = REPO_DIR, ctx: MigrationContext = loadContext(repoDir), v: MigrationValidators = compileValidators(repoDir)): string[] {
  const out: string[] = [];
  const read = (path: string, where: string): unknown => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      out.push(`${where}: JSON として読めません`);
      return undefined;
    }
  };
  const base = join(repoDir, "migration");
  // 公開側の辞書
  const dictIds = new Set<string>();
  for (const f of jsonFiles(join(base, "dictionaries"))) {
    const where = `migration/dictionaries/${f}`;
    const doc = read(join(base, "dictionaries", f), where);
    if (doc === undefined) continue;
    const problems = checkDictionary(doc, ctx, v, where);
    out.push(...problems);
    if (problems.length > 0) continue;
    const id = (doc as { id: string }).id;
    if (!id.startsWith("official.")) out.push(`${where}: 公開側の辞書の作成者は official`);
    if (f !== `${id}.json`) out.push(`${where}: ファイル名は <id>.json（${id}.json）`);
    dictIds.add(id);
  }
  // 公開側の規則（reads.product は null。0113 の11）
  for (const f of jsonFiles(join(base, "rules"))) {
    const where = `migration/rules/${f}`;
    const doc = read(join(base, "rules", f), where);
    if (doc === undefined) continue;
    const problems = checkRule(doc, ctx, v, where);
    out.push(...problems);
    if (problems.length > 0) continue;
    const r = doc as { id: string; reads: { product: string | null }; dictionaries?: string[] };
    if (r.reads.product !== null) out.push(`${where}: 公開側の規則の reads.product は null（製品ごとの規則は非公開のリポジトリにだけ置く。0113 の11）`);
    if (!r.id.startsWith("official.")) out.push(`${where}: 公開側の規則の作成者は official`);
    if (f !== `${r.id}.json`) out.push(`${where}: ファイル名は <id>.json（${r.id}.json）`);
    for (const d of r.dictionaries ?? []) if (!dictIds.has(d)) out.push(`${where}: 辞書 ${d} が公開側（migration/dictionaries/）にありません`);
  }
  // 書き方の見本（版ごとに1つ。消さない）
  const ex = join(base, "schema", "examples");
  for (const f of jsonFiles(ex)) {
    const where = `migration/schema/examples/${f}`;
    const doc = read(join(ex, f), where);
    if (doc === undefined) continue;
    const kind = (doc as { format?: unknown }).format;
    if (kind === "lifeplan.migrationRule") {
      out.push(...checkRule(doc, ctx, v, where));
      if ((doc as { reads?: { product?: unknown } }).reads?.product !== null) out.push(`${where}: 見本の reads.product は null`);
    } else if (kind === "lifeplan.termDictionary") out.push(...checkDictionary(doc, ctx, v, where));
    else out.push(`${where}: format が規則でも辞書でもありません`);
  }
  return out;
}

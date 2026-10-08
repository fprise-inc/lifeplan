// 0007: 制度データの YAML の正本を検査し、正規化した JSON（配る形）にする道具
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isAlias, isMap, isScalar, parseDocument, visit } from "yaml";
import { compareDate, daysInMonth, isValidDate, nextDay, parseDate, formatDate } from "../src/time/civil.ts";
import { normalizeBasis } from "../src/time/basis.ts";
import { checkId } from "../src/ids/ids.ts";
import { AJV_OPTIONS, canonicalJson, ENGINE_DIR, readJson, REPO_DIR, sha256 } from "./lib.ts";

export const REGULATION_DIR = join(REPO_DIR, "data", "regulation");
export const SUPPORTED_FORMAT_MAJOR = 1;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

export interface PackJson {
  format: "financia.regulationPack";
  pack: Obj;
  values: Obj[];
  digest: string;
}

export class DataError extends Error {}

function schemaAjv() {
  const ajv = new Ajv2020({ ...AJV_OPTIONS, allErrors: true });
  ajv.addKeyword({ keyword: "x-unit", schemaType: "string" });
  for (const f of ["common.json", "regulation.value.json", "regulation.packHeader.json", "regulation.pack.json"]) {
    ajv.addSchema(readJson(join(ENGINE_DIR, "schemas", f)) as object);
  }
  return ajv;
}

/** YAML 1.2 のうち JSON に1対1で写せる範囲だけを許す（0007 の2） */
export function parseStrictYaml(text: string, where: string): Json {
  const doc = parseDocument(text, { version: "1.2", schema: "core", merge: false, uniqueKeys: true });
  if (doc.errors.length > 0) throw new DataError(`${where}: YAML を読めません: ${doc.errors[0]?.message}`);
  visit(doc, (_key, node) => {
    if (isAlias(node)) throw new DataError(`${where}: エイリアスは使えません`);
    if (node === null || typeof node !== "object") return;
    const n = node as { anchor?: string; tag?: string };
    if (n.anchor !== undefined) throw new DataError(`${where}: アンカーは使えません`);
    if (n.tag !== undefined) throw new DataError(`${where}: タグは使えません`);
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== "string") throw new DataError(`${where}: キーは文字列だけです`);
        if (pair.key.value === "<<") throw new DataError(`${where}: マージキーは使えません`);
      }
    }
  });
  const value = doc.toJS() as Json;
  walkNumbers(value, where);
  return value;
}

function walkNumbers(v: Json, where: string): void {
  if (typeof v === "number" && !Number.isSafeInteger(v)) {
    throw new DataError(`${where}: 小数や範囲外の数は書けません（率は文字列で書く）`);
  }
  if (Array.isArray(v)) v.forEach((x) => walkNumbers(x, where));
  else if (v !== null && typeof v === "object") Object.values(v).forEach((x) => walkNumbers(x, where));
}

export function comparePackVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 値の定義を正規の形にする（basis を目的語つきの形に、省略できる欄を明示） */
function normalizeValue(v: Obj): Obj {
  return {
    ...v,
    basis: normalizeBasis(v.basis) as unknown as Obj,
    ageSwitch: v.ageSwitch ?? null,
    rounding: v.rounding ?? null,
    linkage: v.linkage ?? "none",
  };
}

function endOfMonth(text: string): boolean {
  const d = parseDate(text);
  return d.day === daysInMonth(d.year, d.month);
}

/** basis と適用期間の揃いを確かめる（0007 の4） */
function checkAlignment(v: Obj, e: Obj, where: string): void {
  const basis = v.basis as Obj;
  const from = parseDate(e.appliesFrom as string);
  const to = e.appliesTo === null ? null : parseDate(e.appliesTo as string);
  const fail = () => {
    throw new DataError(`${where}: 適用期間が basis（${String(basis.type)}）の区切りに揃っていません`);
  };
  switch (basis.type) {
    case "incomeYear":
      if (from.month !== 1 || from.day !== 1) fail();
      if (to !== null && (to.month !== 12 || to.day !== 31)) fail();
      break;
    case "fiscalYear":
    case "priorYearIncome": {
      const start = (basis.type === "fiscalYear" ? basis.startMonth : basis.switchMonth) as number;
      if (from.month !== start || from.day !== 1) fail();
      if (to !== null) {
        const n = nextDay(to);
        if (n.month !== start || n.day !== 1) fail();
      }
      break;
    }
    case "month":
      if (from.day !== 1) fail();
      if (to !== null && !endOfMonth(e.appliesTo as string)) fail();
      break;
    default:
      break;
  }
}

/** 同じ条件・管轄の行の、適用期間の重なりと空白を拒む（0007 の4） */
function checkPeriods(v: Obj, where: string): void {
  const groups = new Map<string, Obj[]>();
  for (const e of v.entries as Obj[]) {
    if (e.supersededIn !== null) continue;
    const key = canonicalJson([e.jurisdiction, e.conditions, e.status, e.scenarioId ?? null]);
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => compareDate(a.appliesFrom as string, b.appliesFrom as string));
    for (let i = 0; i + 1 < list.length; i++) {
      const cur = list[i] as Obj;
      const next = list[i + 1] as Obj;
      if (cur.appliesTo === null) continue; // 次の行の前日まで
      const expected = formatDate(nextDay(parseDate(cur.appliesTo as string)));
      if (expected !== next.appliesFrom) {
        throw new DataError(`${where}: r${String(cur.rev)} と r${String(next.rev)} の適用期間が重なるか、空白があります`);
      }
    }
  }
}

function checkValue(v: Obj, packVersion: string, fictional: boolean, where: string): void {
  const id = v.id as string;
  checkId("param", id);
  if (id.startsWith("test.") !== fictional) {
    throw new DataError(`${where}: test. の値は架空の見本のパックだけに、架空の見本のパックには test. の値だけを置きます`);
  }
  const revs = new Set<number>();
  for (const e of v.entries as Obj[]) {
    const w = `${where} r${String(e.rev)}`;
    if (revs.has(e.rev as number)) throw new DataError(`${w}: rev が重複しています`);
    revs.add(e.rev as number);
    for (const k of ["appliesFrom", "appliesTo", "enforcedOn"]) {
      if (typeof e[k] === "string" && !isValidDate(e[k] as string)) throw new DataError(`${w}: ${k} が暦にない日付です`);
    }
    if (e.appliesTo !== null && compareDate(e.appliesFrom as string, e.appliesTo as string) > 0) {
      throw new DataError(`${w}: 適用開始が適用終了より後です`);
    }
    if (comparePackVersion(e.recordedIn as string, packVersion) > 0) throw new DataError(`${w}: recordedIn がパックの版より新しい`);
    if (e.supersededIn !== null) {
      const s = e.supersededIn as string;
      if (comparePackVersion(s, e.recordedIn as string) <= 0 || comparePackVersion(s, packVersion) > 0) {
        throw new DataError(`${w}: supersededIn が recordedIn とパックの版の間にありません`);
      }
    }
    const sources = e.sources as Obj[];
    const fictionalSource = sources.some((s) => s.type === "fictional");
    if (fictionalSource !== fictional) throw new DataError(`${w}: 出典 fictional は架空の見本データだけに使います`);
    if (!fictional && e.approval === undefined) throw new DataError(`${w}: approval がありません`);
    for (const c of e.conditions as Obj[]) {
      if (c.key === "birthDate") {
        for (const k of ["from", "to"]) {
          if (c[k] !== null && c[k] !== undefined && !(typeof c[k] === "string" && isValidDate(c[k] as string))) {
            throw new DataError(`${w}: 条件 birthDate の ${k} は日付で書きます`);
          }
        }
      }
    }
    if (v.kind === "bracketTable" && Array.isArray(e.value)) {
      const rows = e.value as Obj[];
      rows.forEach((r, i) => {
        const last = i === rows.length - 1;
        if ((r.upTo === null) !== last) throw new DataError(`${w}: 段階表は最後の段だけ upTo が null です`);
        if (i > 0 && !last && (r.upTo as number) <= ((rows[i - 1] as Obj).upTo as number)) {
          throw new DataError(`${w}: 段階表の upTo が昇順ではありません`);
        }
      });
    }
    checkAlignment(v, e, w);
  }
  checkPeriods(v, where);
}

/** 1つの分野のフォルダから、配る形のパックを作る */
export function buildPack(dir: string): PackJson {
  const ajv = schemaAjv();
  const folder = basename(dir);
  const headerPath = join(dir, "pack.yaml");
  if (!existsSync(headerPath)) throw new DataError(`${folder}: pack.yaml がありません`);
  if (!existsSync(join(dir, "LICENSE"))) throw new DataError(`${folder}: LICENSE がありません（0021）`);
  const pack = parseStrictYaml(readFileSync(headerPath, "utf8"), `${folder}/pack.yaml`) as Obj;
  if (!ajv.validate("urn:financia:schema:regulation.packHeader", pack)) {
    throw new DataError(`${folder}/pack.yaml: 形式の誤り ${ajv.errorsText()}`);
  }
  if (pack.packId !== `regulation.${folder}`) throw new DataError(`${folder}/pack.yaml: packId はフォルダ名と同じ regulation.${folder}`);
  const major = Number((pack.formatVersion as string).split(".")[0]);
  if (major !== SUPPORTED_FORMAT_MAJOR) throw new DataError(`${folder}/pack.yaml: 形式の大の版が違います`);
  const fictional = pack.fictional === true;

  const values: Obj[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "pack.yaml" || name === "LICENSE" || statSync(join(dir, name)).isDirectory()) continue;
    if (!name.endsWith(".yaml")) throw new DataError(`${folder}/${name}: 値のファイルは .yaml だけです`);
    const where = `${folder}/${name}`;
    const raw = parseStrictYaml(readFileSync(join(dir, name), "utf8"), where) as Obj;
    if (!ajv.validate("urn:financia:schema:regulation.value", raw)) {
      throw new DataError(`${where}: 形式の誤り ${ajv.errorsText()}`);
    }
    if (`${String(raw.id)}.yaml` !== name) throw new DataError(`${where}: ファイル名は「値ID.yaml」にします`);
    const v = normalizeValue(raw);
    checkValue(v, pack.version as string, fictional, where);
    values.push(v);
  }
  // 端数処理の規則IDは、同じパックの kind: rounding の値を指す
  const byId = new Map(values.map((v) => [v.id as string, v]));
  for (const v of values) {
    if (v.rounding !== null && byId.get(v.rounding as string)?.kind !== "rounding") {
      throw new DataError(`${folder}/${String(v.id)}.yaml: rounding が kind: rounding の値を指していません`);
    }
  }
  const body = { pack, values };
  const out: PackJson = { format: "financia.regulationPack", pack, values, digest: `sha256:${sha256(canonicalJson(body))}` };
  if (!ajv.validate("urn:financia:schema:regulation.pack", out)) throw new DataError(`${folder}: 出力の形式の誤り ${ajv.errorsText()}`);
  return out;
}

export function packDirs(root = REGULATION_DIR): string[] {
  return readdirSync(root)
    .sort()
    .map((n) => join(root, n))
    .filter((p) => statSync(p).isDirectory());
}

/** 正規化した JSON の文字列（キーは辞書順、末尾に改行） */
export function serializePack(p: PackJson): string {
  return `${canonicalJson(p)}\n`;
}

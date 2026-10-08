// 0007: 制度データの YAML の正本を検査し、正規化した JSON（配る形）にする道具
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isAlias, isMap, isScalar, parseDocument, visit } from "yaml";
import { compareDate, daysInMonth, isValidDate, nextDay, parseDate, formatDate } from "../src/time/civil.ts";
import { normalizeBasis } from "../src/time/basis.ts";
import { checkId } from "../src/ids/ids.ts";
import { isReadableFormat } from "../src/regulation/format.ts";
import { AJV_OPTIONS, canonicalJson, ENGINE_DIR, readJson, REPO_DIR, sha256 } from "./lib.ts";

export const REGULATION_DIR = join(REPO_DIR, "data", "regulation");

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
  ajv.addKeyword({ keyword: "x-item", schemaType: "string" });
  ajv.addKeyword({ keyword: "x-collection", schemaType: "string" });
  ajv.addKeyword({ keyword: "x-owner", schemaType: "array" });
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
    // 0007 の追記: 施行日が分からず「遅くともこの日には施行済み」だけが分かる行
    const eo = e.enforcedOn;
    if (eo !== null && typeof eo === "object" && !isValidDate((eo as Obj).notAfter as string)) throw new DataError(`${w}: enforcedOn.notAfter が暦にない日付です`);
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
    if (e.enforcedOn === null && (e.approval as Obj | undefined)?.method !== "pendingReview") {
      throw new DataError(`${w}: 施行日（enforcedOn）を null にできるのは原本での確認待ち（pendingReview）の行だけです`);
    }
    // 0007 の追記: reviewed は公式の原本と照らし合わせたこと。原本の指紋（sha256）のある出典を持つ
    if ((e.approval as Obj | undefined)?.method === "reviewed" && !sources.some((s) => typeof s.sha256 === "string")) {
      throw new DataError(`${w}: reviewed の行は、原本の指紋（sha256）のある出典を持ちます`);
    }
    for (const c of e.conditions as Obj[]) {
      if (c.key === "birthDate") {
        for (const k of ["from", "to"]) {
          if (c[k] !== null && c[k] !== undefined && !(typeof c[k] === "string" && isValidDate(c[k] as string))) {
            throw new DataError(`${w}: 条件 birthDate の ${k} は日付で書きます`);
          }
        }
      }
    }
    if (v.kind === "gradeTable" && Array.isArray(e.value)) {
      // 0007 の追記: 等級は1から1ずつ、範囲は 0 から隙間なく続き、最後の行だけ上限なし
      const rows = e.value as Obj[];
      rows.forEach((r, i) => {
        const last = i === rows.length - 1;
        if (r.grade !== i + 1) throw new DataError(`${w}: 等級表の grade は1から1ずつ増やします`);
        if (r.from !== (i === 0 ? 0 : (rows[i - 1] as Obj).below)) throw new DataError(`${w}: 等級表の from は前の行の below と同じにします（最初は 0）`);
        if ((r.below === null) !== last) throw new DataError(`${w}: 等級表は最後の行だけ below が null です`);
        if (!last && (r.below as number) <= (r.from as number)) throw new DataError(`${w}: 等級表の範囲が空です`);
        if (i > 0 && (r.amount as number) <= ((rows[i - 1] as Obj).amount as number)) throw new DataError(`${w}: 等級表の額が昇順ではありません`);
      });
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

/** 原本で人が確かめる前の行（approval.method が pendingReview）の一覧。CI で数を出し、配布の前にゼロにする */
export function pendingReviewEntries(p: PackJson): { id: string; rev: number; paths: number }[] {
  const out: { id: string; rev: number; paths: number }[] = [];
  for (const v of p.values) {
    for (const e of v.entries as Obj[]) {
      const a = e.approval as Obj | undefined;
      if (a?.method === "pendingReview") out.push({ id: v.id as string, rev: e.rev as number, paths: a.paths as number });
    }
  }
  return out;
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
  // 制度データは regulation.<フォルダ名>、マスタデータは master.<フォルダ名>（0007 の1・追記）
  if (pack.packId !== `regulation.${folder}` && pack.packId !== `master.${folder}`) {
    throw new DataError(`${folder}/pack.yaml: packId はフォルダ名と同じ regulation.${folder}（マスタデータは master.${folder}）`);
  }
  if (!isReadableFormat(pack.formatVersion as string)) throw new DataError(`${folder}/pack.yaml: このエンジンが読めない形式の版です`);
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

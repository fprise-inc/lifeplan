// 対応範囲の一覧（docs/coverage/*.yaml。0183）を読み、形と参照を確かめて、AI接続口に同梱する1つの JSON（dist/coverage.json）にする道具。
// - 形: docs/coverage/coverage.schema.json
// - 参照: 入力項目ID（registry/items.yaml）・制度の値ID（registry/params.yaml）・表の行ID（registry/rows.yaml）・計算の部品（registry/components.yaml）・
//   関係する項目の鍵が、どれも今あること
// - 部品の revision との照合（ずれたら見直しを促す）は、エンジンの部品を読むテスト（test/coverage.test.ts）で行う（ビルドは止めない）
// - 公開する一覧なので、社内の判断の経緯の番号・言葉が紛れ込んでいないことも確かめる
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { AJV_OPTIONS, canonicalJson, readJson, REPO_DIR, sha256 } from "./lib.ts";

export const COVERAGE_DIR = join(REPO_DIR, "docs", "coverage");

export type CoverageStatus = "included" | "approximated" | "notYet";

export interface CoverageEntry {
  id: string;
  title: string;
  status: CoverageStatus;
  summary: string;
  how?: string;
  approximation?: string;
  reason?: string;
  instead?: string;
  keywords: string[];
  items?: string[];
  fields?: string[];
  rules?: string[];
  regulation?: string[];
  rows?: string[];
  components?: Record<string, number>;
  related?: string[];
}

export interface CoverageArea {
  area: string;
  title: string;
  order?: number;
  entries: CoverageEntry[];
}

export interface CoverageList {
  format: "financia.coverage";
  /** 中身の指紋（sha256 の先頭12桁。答えに添えて、どの版の一覧で答えたかを残す） */
  version: string;
  areas: { area: string; title: string; entries: CoverageEntry[] }[];
}

export class CoverageError extends Error {}

/** 公開する一覧に書かない言葉（社内の判断の経緯・番号）。設計記録の番号（4桁）・内部の決定の番号も書かない */
const FORBIDDEN: readonly { re: RegExp; why: string }[] = [
  { re: /設計記録/, why: "社内の記録の名前" },
  { re: /(?<![A-Za-z0-9])[DP]-\d/, why: "内部の決定の番号" },
  { re: /(?<![0-9０-９.])0\d{3}(?![0-9０-９])/, why: "設計記録の番号らしい4桁" },
  { re: /TODO|FIXME/, why: "作業の印" },
];

function registryLabels(file: string): Map<string, string> {
  const doc = parse(readFileSync(join(REPO_DIR, "registry", file), "utf8")) as { entries: { id: string; status?: string; label?: string }[] };
  return new Map(doc.entries.filter((e) => e.status !== "removed").map((e) => [e.id, e.label ?? ""]));
}

function registryIds(file: string): Set<string> {
  return new Set(registryLabels(file).keys());
}

function texts(e: CoverageEntry): string[] {
  return [e.title, e.summary, e.how, e.approximation, e.reason, e.instead, ...e.keywords, ...(e.fields ?? []), ...(e.rules ?? [])].filter((x): x is string => x !== undefined);
}

/** 一覧を読んで確かめる（間違いはまとめて CoverageError で返す） */
export function loadCoverage(dir: string = COVERAGE_DIR): CoverageList {
  const ajv = new Ajv2020({ ...AJV_OPTIONS, allErrors: true });
  const validate = ajv.compile(readJson(join(dir, "coverage.schema.json")) as object);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  if (files.length === 0) throw new CoverageError(`${dir} に一覧の YAML がありません`);
  const errors: string[] = [];
  const areas: CoverageArea[] = [];
  for (const f of files) {
    const doc = parse(readFileSync(join(dir, f), "utf8")) as unknown;
    if (!validate(doc)) {
      errors.push(`${f}: ${ajv.errorsText(validate.errors, { separator: "\n  " })}`);
      continue;
    }
    const a = doc as CoverageArea;
    if (a.area !== basename(f, ".yaml")) errors.push(`${f}: area（${a.area}）はファイル名と同じにする`);
    areas.push(a);
  }
  const items = registryIds("items.yaml");
  const params = registryIds("params.yaml");
  const rows = registryIds("rows.yaml");
  const components = registryIds("components.yaml");
  const all = new Map<string, string>();
  for (const a of areas) for (const e of a.entries) {
    if (all.has(e.id)) errors.push(`${e.id}: 鍵が ${all.get(e.id)} と重なっています`);
    all.set(e.id, a.area);
  }
  for (const a of areas)
    for (const e of a.entries) {
      const at = `${a.area}.yaml の ${e.id}`;
      if (!e.id.startsWith(`${a.area}.`)) errors.push(`${at}: 鍵の先頭は分野の鍵（${a.area}.）にする`);
      for (const id of e.items ?? []) if (!items.has(id)) errors.push(`${at}: 入力項目ID ${id} が登録簿（registry/items.yaml）にありません`);
      for (const id of e.regulation ?? []) if (!params.has(id)) errors.push(`${at}: 制度の値ID ${id} が登録簿（registry/params.yaml）にありません`);
      for (const id of e.rows ?? []) if (!rows.has(id)) errors.push(`${at}: 表の行ID ${id} が登録簿（registry/rows.yaml）にありません`);
      for (const id of Object.keys(e.components ?? {})) if (!components.has(id)) errors.push(`${at}: 計算の部品 ${id} が登録簿（registry/components.yaml）にありません`);
      for (const id of e.related ?? []) if (!all.has(id)) errors.push(`${at}: 関係する項目 ${id} が一覧にありません`);
      for (const t of texts(e)) for (const f of FORBIDDEN) if (f.re.test(t)) errors.push(`${at}: 公開する一覧に${f.why}を書かない（「${t.slice(0, 40)}…」）`);
    }
  if (errors.length > 0) throw new CoverageError(`対応範囲の一覧（docs/coverage）に間違いがあります:\n${errors.join("\n")}`);
  const sorted = [...areas].sort((x, y) => (x.order ?? 999) - (y.order ?? 999) || x.area.localeCompare(y.area));
  const body = sorted.map((a) => ({ area: a.area, title: a.title, entries: a.entries }));
  return { format: "financia.coverage", version: sha256(canonicalJson(body)).slice(0, 12), areas: body };
}

/** 項目の鍵 → 部品と、書いたときの revision */
export function componentRefs(list: CoverageList): { entry: string; component: string; revision: number }[] {
  return list.areas.flatMap((a) => a.entries.flatMap((e) => Object.entries(e.components ?? {}).map(([component, revision]) => ({ entry: e.id, component, revision }))));
}

/** AI接続口に同梱する形（dist/coverage.json）: 入力項目ID・制度の値ID・表の行ID・部品に登録簿の名前を添える。部品の revision は入れない（照合はテストだけ） */
export function shipCoverage(list: CoverageList): unknown {
  const items = registryLabels("items.yaml");
  const params = registryLabels("params.yaml");
  const rows = registryLabels("rows.yaml");
  const components = registryLabels("components.yaml");
  // YAML の折り返し（>-）で日本語の行の間に入る空白を取る（英数字・記号どうしの間の空白は残す）
  const tidy = (t: string | undefined) => t?.replace(/(?<=[^ -~])\s+|\s+(?=[^ -~])/g, "");
  const named = (ids: readonly string[] | undefined, names: Map<string, string>) => (ids ?? []).map((id) => ({ id, label: names.get(id) ?? "" }));
  return {
    format: list.format,
    version: list.version,
    areas: list.areas.map((a) => ({
      area: a.area,
      title: a.title,
      entries: a.entries.map((e) => ({
        ...e,
        summary: tidy(e.summary),
        ...(e.how !== undefined ? { how: tidy(e.how) } : {}),
        ...(e.approximation !== undefined ? { approximation: tidy(e.approximation) } : {}),
        ...(e.reason !== undefined ? { reason: tidy(e.reason) } : {}),
        ...(e.instead !== undefined ? { instead: tidy(e.instead) } : {}),
        items: named(e.items, items),
        regulation: named(e.regulation, params),
        rows: named(e.rows, rows),
        components: named(Object.keys(e.components ?? {}), components),
      })),
    })),
  };
}

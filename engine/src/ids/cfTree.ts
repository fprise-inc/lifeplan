// 0004 の6: キャッシュフロー表の科目の木。正本は registry/rows.yaml（ビルドで JSON にする）
import { EngineError } from "../errors.ts";
import rowsRegistry from "../generated/rows.json" with { type: "json" };
import { isDottedId } from "./ids.ts";

export interface RegistryEntry {
  readonly id: string;
  readonly status: "active" | "deprecated" | "removed";
  readonly label: string;
  readonly since: string;
  readonly aliases: readonly string[];
  readonly replacedBy: string | null;
}

const ENTRIES = rowsRegistry.entries as readonly RegistryEntry[];
const BY_ID = new Map<string, RegistryEntry>();
const ALIASES = new Map<string, string>();
for (const e of ENTRIES) {
  BY_ID.set(e.id, e);
  for (const a of e.aliases) ALIASES.set(a, e.id);
}

export function rowEntries(): readonly RegistryEntry[] {
  return ENTRIES;
}

/** 別名を新しい行IDに置き換える（0004 の3） */
export function canonicalRow(id: string): string {
  return ALIASES.get(id) ?? id;
}

/** 行IDの段（cf.income → 1、cf.income.salary → 2） */
export function rowDepth(id: string): number {
  return id.split(".").length - 1;
}

/** row が branch そのもの、またはその下にあるか */
export function isUnder(row: string, branch: string): boolean {
  return row === branch || row.startsWith(`${branch}.`);
}

const EXT_PATTERN = /^(cf(?:\.[a-z][a-zA-Z0-9]*)+)\.ext\.[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

// 確かめた行ID（登録簿は変わらないので、同じ行IDの判定は同じ。お金の動きの行は同じ ID が何千回も出る）
const CHECKED = new Map<string, string>();

/** 登録簿にある有効な行か、登録簿の枝の下の拡張の行（…ext.<作成者>.<キー>）か */
export function checkRow(id: string): string {
  const hit = CHECKED.get(id);
  if (hit !== undefined) return hit;
  const row = checkRowUncached(id);
  CHECKED.set(id, row);
  return row;
}

function checkRowUncached(id: string): string {
  if (!isDottedId(id) || !id.startsWith("cf.")) throw new EngineError("E_ID_FORMAT", ["row", id]);
  const row = canonicalRow(id);
  const e = BY_ID.get(row);
  if (e !== undefined) {
    if (e.status === "removed") throw new EngineError("E_ROW_UNKNOWN", [id]);
    return row;
  }
  const m = EXT_PATTERN.exec(row);
  if (m !== null && BY_ID.has(m[1] as string)) return row;
  throw new EngineError("E_ROW_UNKNOWN", [id]);
}

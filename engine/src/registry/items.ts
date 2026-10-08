// 0004 の5・0006 の1: 入力項目ID。部品にはマニフェストの reads に書いた項目だけを渡す（0016 の5）
import itemsJson from "../generated/items.json" with { type: "json" };
import { EngineError } from "../errors.ts";

export interface ItemDef {
  readonly collection: string | null;
  readonly path: readonly string[];
  readonly title: string;
}

export interface ItemTable {
  /** 集まりの名前 → 入力の中の場所（例 member → household.members） */
  readonly collections: Readonly<Record<string, readonly string[]>>;
  readonly items: Readonly<Record<string, ItemDef>>;
  /** 集まり → その物がどの構成員の物かを表す欄（x-owner。0006 の追記）。無い集まりは世帯の物 */
  readonly owners: Readonly<Record<string, readonly string[]>>;
}

export const ITEMS: ItemTable = itemsJson as unknown as ItemTable;

export function isKnownItem(id: string): boolean {
  return ITEMS.items[id] !== undefined;
}

function at(root: unknown, path: readonly string[]): unknown {
  let cur = root;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function setAt(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let cur = target;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i] as string;
    let next = cur[k] as Record<string, unknown> | undefined;
    if (next === undefined) {
      next = {};
      cur[k] = next;
    }
    cur = next;
  }
  cur[path[path.length - 1] as string] = value;
}

/** 物が構成員 member の物か（x-owner の欄のどれかが member） */
export function ownedBy(table: ItemTable, collection: string, obj: unknown, member: string): boolean {
  const fields = table.owners[collection];
  if (fields === undefined) return false;
  const o = obj as Record<string, unknown>;
  for (const f of fields) if (o[f] === member) return true;
  return false;
}

/**
 * 集まりの各物を、reads に書いた入力項目だけに絞った写しにする。物の ID（id）はいつも渡す。
 * 入力に無い任意の項目は写さない（部品は欠けていることを前提に書く）。
 * member を渡すと、その構成員の物（x-owner）だけにする（マニフェストの memberScope。0006 の追記）
 */
export function projectCollection(
  table: ItemTable,
  input: Record<string, unknown>,
  collection: string,
  reads: ReadonlySet<string>,
  component: string,
  member: string | null = null,
): Record<string, unknown>[] {
  const where = table.collections[collection];
  if (where === undefined) throw new EngineError("E_ARGUMENT", [component, `collection.${collection}`]);
  const declared = [...reads].filter((r) => table.items[r]?.collection === collection);
  if (declared.length === 0) throw new EngineError("E_READ_UNDECLARED", [component, collection]);
  const all = at(input, where);
  if (!Array.isArray(all)) return [];
  const source = member === null ? all : all.filter((obj: unknown) => ownedBy(table, collection, obj, member));
  return source.map((obj: unknown) => {
    const o = obj as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (o.id !== undefined) out.id = o.id;
    for (const item of declared) {
      const v = at(o, (table.items[item] as ItemDef).path);
      if (v !== undefined) setAt(out, (table.items[item] as ItemDef).path, v);
    }
    return out;
  });
}

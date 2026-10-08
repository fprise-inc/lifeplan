// 0004: ID の6種類と書式の検査
import { EngineError } from "../errors.ts";

export const DOTTED_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type IdKind = "item" | "component" | "param" | "row" | "hsKey" | "object" | "slot" | "convention" | "formula";

type Branded<K extends IdKind> = string & { readonly __idKind: K };
export type InputItemId = Branded<"item">;
export type ComponentId = Branded<"component">;
export type ParamId = Branded<"param">;
export type RowId = Branded<"row">;
export type HsKey = Branded<"hsKey">;
export type ObjectId = Branded<"object">;
export type SlotId = Branded<"slot">;

/** 予約の接頭辞（0004 の2）。それぞれの種類だけが使える */
const RESERVED: ReadonlyArray<readonly [prefix: string, kind: IdKind]> = [
  ["cf.", "row"],
  ["hs.", "hsKey"],
  ["conv.", "convention"],
  ["slot.", "slot"],
];

export function isDottedId(s: unknown): s is string {
  return typeof s === "string" && DOTTED_ID_PATTERN.test(s);
}

export function isUuidV4(s: unknown): s is string {
  return typeof s === "string" && UUID_V4_PATTERN.test(s);
}

export function isTestId(s: string): boolean {
  return s.startsWith("test.");
}

/** ext.<作成者>.<…> の形か（利用者の拡張） */
export function isExtensionId(s: string): boolean {
  return /^ext\.[a-z][a-zA-Z0-9]*\.[a-z]/.test(s) || /\.ext\.[a-z][a-zA-Z0-9]*\.[a-z]/.test(s);
}

/** 書式と予約の接頭辞を確かめる。数式ID（formula）は部品の中の名前で、予約の接頭辞を使わない */
export function checkId(kind: IdKind, s: unknown): string {
  if (kind === "object") {
    if (!isUuidV4(s)) throw new EngineError("E_ID_FORMAT", [kind]);
    return s;
  }
  if (!isDottedId(s)) throw new EngineError("E_ID_FORMAT", [kind]);
  for (const [prefix, owner] of RESERVED) {
    const has = s.startsWith(prefix);
    // 予約の種類はその接頭辞で始まり、他の種類はその接頭辞を使わない
    if ((owner === kind && !has) || (owner !== kind && has)) throw new EngineError("E_ID_FORMAT", [kind, s]);
  }
  return s;
}

export const componentId = (s: string) => checkId("component", s) as ComponentId;
export const paramId = (s: string) => checkId("param", s) as ParamId;
export const rowId = (s: string) => checkId("row", s) as RowId;
export const itemId = (s: string) => checkId("item", s) as InputItemId;
export const hsKey = (s: string) => checkId("hsKey", s) as HsKey;
export const objectId = (s: string) => checkId("object", s) as ObjectId;
export const slotId = (s: string) => checkId("slot", s) as SlotId;

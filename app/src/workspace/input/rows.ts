// 値の状態の欄（valueStates。0035 の3）の行の読み書き。値の箱を持たない値の状態（推定・わからない・該当なし・確定と承認・確かさ）は、
// その値を持つ物（物の集まりの1件・構成員）か要求の入力の valueStates に、当て先の「入力項目ID/場所」の鍵で持つ。
// 画面の中では、推定（出どころ auto）の行は仮の印（household.assumed）に戻して持つ（store/format017.ts）。ここが扱うのは、それ以外の行
// （わからない・該当なし・確定・承認・確かさ）と、仮の印に戻せない推定の行。
// 決まり（0041）: FP が値を変えたら（打った・選んだ・ボタンで変えた）、値が変わった所の前からの行は外す（その値の状態ではなくなるため）
import { findObject, readAt, type Address, type Target } from "../store/readings.ts";
import type { WorkingHousehold } from "./household.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

/** 値の状態の1行（スキーマ common.json の valueState） */
export interface StateRow {
  state: "estimated" | "unknown" | "notApplicable" | "confirmed";
  origin: { kind: string; [k: string]: unknown };
  estimate?: { method: string; basis: string };
  approval?: unknown;
  certainty?: string;
}

export const isRow = (v: unknown): v is StateRow => isObj(v) && typeof v.state === "string" && isObj(v.origin);

/** 行の鍵（0035 の3: `入力項目ID[/場所...]`） */
export const rowKey = (a: Address): string => [a.item, ...a.at].join("/");

/** 鍵を当て先に戻す（向き先は行を持つ物から） */
export function addressOfRow(key: string, target: (item: string) => Target): Address {
  const [item, ...at] = key.split("/");
  return { target: target(item as string), item: item as string, at };
}

/** 当て先の行を持つ物（要求の入力・物・構成員）。万一の前提（画面の側）はここでは扱わない */
export function holderOf(input: Obj, t: Target): Obj | undefined {
  if ("plan" in t) return t.plan === "contingency" ? undefined : input;
  return findObject(input, "object" in t ? t.object : t.member);
}

/** 当て先の行（無ければ undefined） */
export function rowAt(input: Obj, a: Address): StateRow | undefined {
  const h = holderOf(input, a.target);
  const states = h?.valueStates;
  const row = isObj(states) ? states[rowKey(a)] : undefined;
  return isRow(row) ? row : undefined;
}

/** 当て先の行を書く（undefined は消す。空になった欄も消す）。物が無ければ false。input をそのまま書き換える */
export function putRow(input: Obj, a: Address, row: StateRow | undefined): boolean {
  const h = holderOf(input, a.target);
  if (h === undefined) return false;
  const states = isObj(h.valueStates) ? h.valueStates : {};
  if (row === undefined) delete states[rowKey(a)];
  else states[rowKey(a)] = structuredClone(row);
  if (Object.keys(states).length === 0) delete h.valueStates;
  else h.valueStates = states;
  return true;
}

/** 行を持てる所の全部: 要求の入力と、世帯の物の集まりの1件（構成員を含む）。target は行の鍵の入力項目ID から向き先を作る */
export function rowHolders(input: Obj): { holder: Obj; target: (item: string) => Target }[] {
  const out: { holder: Obj; target: (item: string) => Target }[] = [{ holder: input, target: (item) => ({ plan: item.startsWith("assumptions.") ? "assumptions" : "input" }) }];
  const h = input.household;
  if (!isObj(h)) return out;
  for (const [coll, v] of Object.entries(h)) {
    if (!Array.isArray(v)) continue;
    for (const x of v) {
      if (!isObj(x) || typeof x.id !== "string") continue;
      const id = x.id;
      out.push({ holder: x, target: () => (coll === "members" ? { member: id } : { object: id }) });
    }
  }
  return out;
}

/** 世帯の中の全部の行（鍵・当て先・行） */
export function allRows(input: Obj): { address: Address; row: StateRow }[] {
  const out: { address: Address; row: StateRow }[] = [];
  for (const { holder, target } of rowHolders(input)) {
    const states = holder.valueStates;
    if (!isObj(states)) continue;
    for (const [k, row] of Object.entries(states)) if (isRow(row)) out.push({ address: addressOfRow(k, target), row });
  }
  return out;
}

/**
 * 値を変えた後に、値が変わった所の前からの行を外す（0041）。前と同じ行で、その当て先の値が前と違うものだけを外す
 * （この変更で新しく書いた行・書き換えた行は残す。値の状態の操作は行を書き換えるので外れない）。変わらなければ同じ世帯を返す
 */
export function dropStaleRows(before: WorkingHousehold, after: WorkingHousehold): WorkingHousehold {
  const bi = before.request.input as unknown as Obj;
  const ai = after.request.input as unknown as Obj;
  if (bi === ai) return after;
  const stale: Address[] = [];
  for (const { address, row } of allRows(ai)) {
    const prev = rowAt(bi, address);
    if (prev === undefined || !same(prev, row)) continue;
    if (same(readAt(bi, address), readAt(ai, address))) continue;
    stale.push(address);
  }
  if (stale.length === 0) return after;
  const request = structuredClone(after.request);
  for (const a of stale) putRow(request.input as unknown as Obj, a, undefined);
  return { ...after, request };
}

/**
 * 物を置き換えたとき（ヒアリングの取り込みで、同じ ID の物を取り込んだ物にする）に、前の物の行のうち、取り込んだ物に同じ鍵の行が無く、
 * その値が前と同じものを、取り込んだ物に写す（FP が決めた「該当なし」「わからない」・確定の記録を、取り込みで値が変わらない所では残す。0041）。
 * 値が変わった所の行は写さない（取り込んだ値と承認の記録が正）。next はそのまま書き換える
 */
export function carryRows(prev: Obj, next: Obj, target: Target): void {
  const states = prev.valueStates;
  if (!isObj(states)) return;
  const wrap = (o: Obj): Obj => ({ household: { list: [o] } });
  for (const [k, row] of Object.entries(states)) {
    if (!isRow(row)) continue;
    if (isObj(next.valueStates) && next.valueStates[k] !== undefined) continue;
    const a = addressOfRow(k, () => target);
    if (!same(readAt(wrap(prev), a), readAt(wrap(next), a))) continue;
    putRow(wrap(next), a, row);
  }
}

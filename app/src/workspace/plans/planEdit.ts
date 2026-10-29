// 入力画面でプランを直す（0036 の8・0043）。入力の部品は現状の編集と同じものを使い、書く先だけを変える:
// - 画面に見せるのは、そのプランの中身（現状に土台から順に差分を当てた作業中の世帯。planView）
// - 部品が返した新しい作業中の世帯と、直す前の作業中の世帯を比べ、違いをそのプランの差分にする（recordPlanEdit）。
//   値が変わった所は値を変える差分（set）、物・並びの要素が増えた所は足す差分（add）、無くなった所は外す差分（remove）、
//   物の種類が変わった所（賃貸⇄持ち家・働き方の種類など）は置き換えの組（同じ pair の remove と add）
// - 現状と違う所の印・戻す・違いの一覧（diffRows）・カードごとの数もここで作る
// 欄のキーは差分に書かない（当て先だけ。0036 の2）。世帯ファイルの形は変えない
import type { Proposal } from "./plans.ts";
import { acknowledge, applyPlan, chainOf, diffKey, dropChange, findPlan, rowKeyOf, setPlanValue, type Review } from "./plans.ts";
import { addressOf, boxAt, isLever, sameJson, type DiffBox, type PlanDiff } from "./diffs.ts";
import { fieldText, type Catalog, type ItemValue } from "./items.ts";
import { COLLECTIONS, ITEM_PLACES } from "../../generated/readings.ts";
import { ITEM_LABELS } from "../../generated/labels.ts";
import { findObject, readAt, resolveAssumedKey, unbox, type Address, type Target } from "../store/readings.ts";
import { inferPostRetirement, newId, type WorkingHousehold } from "../input/household.ts";
import { allFields, type FieldDef, type GroupDef } from "../input/form.ts";
import { inputItems, itemStage } from "../input/items.ts";
import { fieldAddress, fieldStatus } from "../input/valueState.ts";
import { formatYearMonth } from "../input/units.ts";
import { memberLabel } from "../input/labels.ts";
import { premiseDiffText } from "../contingency/planPremise.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isBox = (v: unknown): boolean => isObj(v) && typeof v.state === "string" && isObj(v.origin);
const inputOf = (wh: WorkingHousehold): Obj => wh.request.input as unknown as Obj;

// ---- 当て先の比べ方 ----

/** 欄の当て先（欄の読み方が物を見つけられないときは null） */
function safeAddress(f: FieldDef, wh: WorkingHousehold): Address | null {
  try {
    return fieldAddress(f, wh);
  } catch {
    return null;
  }
}

const targetKey = (t: unknown): string => JSON.stringify(t);
const addressKey = (a: Address): string => `${targetKey(a.target)}|${a.item}|${a.at.join("/")}`;
const isPrefix = (a: readonly string[], b: readonly string[]) => a.length <= b.length && a.every((x, i) => b[i] === x);
/** 2つの当て先が同じ値か、片方がもう片方の中の値か（入力項目の値の全体と、その中の値） */
export const overlaps = (a: Address, b: Address): boolean => a.item === b.item && sameJson(a.target, b.target) && (isPrefix(a.at, b.at) || isPrefix(b.at, a.at));
const objectIdOf = (t: unknown): string | null => (isObj(t) ? (typeof t.object === "string" ? t.object : typeof t.member === "string" ? t.member : null) : null);

// ---- プランの中身（作業中の世帯） ----

const viewCache = new WeakMap<WorkingHousehold, Map<string, { cat: Catalog; view: WorkingHousehold }>>();

/**
 * 入力画面に見せるプランの中身: 現状に土台から順に差分を当てた作業中の世帯（0036 の6）。画面の中の仮の印（assumed）のうち、
 * このプランか土台で値を変えた欄の印は外す（プランの値は仮の値ではない）
 */
export function planView(wh: WorkingHousehold, cat: Catalog, id: string): WorkingHousehold {
  const hit = viewCache.get(wh)?.get(id);
  if (hit !== undefined && hit.cat === cat) return hit.view;
  const { request } = applyPlan(wh, id, cat);
  const sets = chainOf(wh.proposals, id)
    .flatMap((p) => p.diffs.filter((d) => d.enabled))
    .map(addressOf)
    .filter((a): a is Address => a !== null);
  const assumed = Object.fromEntries(
    Object.entries(wh.assumed).filter(([k]) => {
      const r = resolveAssumedKey(k, inputOf(wh));
      return r === null || r.kind !== "address" || !sets.some((a) => overlaps(a, r.address));
    }),
  );
  // 定年後の予定（画面の側の値）は、プランで働き方の期間を変えた人だけ、プランの中身の期間から読み直す
  const post = { ...wh.postRetirement };
  for (const m of request.input.household.members) {
    if (m.kind !== "self" && m.kind !== "spouse") continue;
    const mine = (h: typeof request.input.household) => (h.employmentPeriods ?? []).filter((p) => p.member === m.id);
    if (sameJson(mine(request.input.household), mine(wh.request.input.household))) continue;
    const p = inferPostRetirement(request.input.household, m);
    if (p !== null) post[m.id] = { ...p, ...(p.type === wh.postRetirement[m.id]?.type && p.annualSalary === null ? { annualSalary: wh.postRetirement[m.id]?.annualSalary ?? null } : {}) };
  }
  const view: WorkingHousehold = { ...wh, request, assumed, postRetirement: post };
  const m = viewCache.get(wh) ?? new Map<string, { cat: Catalog; view: WorkingHousehold }>();
  m.set(id, { cat, view });
  viewCache.set(wh, m);
  return view;
}

// ---- 2つの作業中の世帯の違い ----

type Change =
  | { kind: "addObject"; collection: string; obj: Obj }
  | { kind: "removeObject"; target: Target; collection: string; obj: Obj }
  | { kind: "replaceObject"; target: Target; collection: string; before: Obj; obj: Obj }
  | { kind: "set"; address: Address }
  /** 入力項目の値が無くなった（省いた）: 自分の差分を消す。消す差分が無ければ物を置き換える */
  | { kind: "clear"; address: Address; collection: string | null }
  | { kind: "addElement"; target: Target; item: string; at: string[]; el: Obj }
  | { kind: "removeElement"; target: Target; item: string; at: string[]; el: Obj };

/** 物の集まりの名前 → 入力項目ID（物の中の場所の短い順） */
const ITEMS_BY_COLLECTION: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [item, p] of Object.entries(ITEM_PLACES)) {
    if (p.collection === null) continue;
    const l = m.get(p.collection) ?? [];
    l.push(item);
    m.set(p.collection, l);
  }
  return m;
})();
/** 要求の入力の項目（前提条件・表の最後の年。計算の基準の月はプランで変えない。0036 の2） */
const PLAN_ITEMS: readonly string[] = Object.entries(ITEM_PLACES)
  .filter(([item, p]) => p.collection === null && item !== "plan.baseMonth")
  .map(([item]) => item);

const getPath = (o: unknown, path: readonly string[]): unknown => path.reduce<unknown>((n, k) => (isObj(n) ? n[k] : undefined), o);
function deletePath(o: Obj, path: readonly string[]): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    delete o[head];
    return;
  }
  const next = o[head];
  if (!isObj(next)) return;
  deletePath(next, rest);
  if (Object.keys(next).length === 0) delete o[head];
}

/** 物の種類を決める欄（変わると物の形が変わる。置き換えの組にする） */
const isKindItem = (item: string): boolean => {
  const p = ITEM_PLACES[item];
  return p !== undefined && p.path.length === 1 && (p.path[0] === "kind" || p.path[0] === "type");
};

/** 世帯の物の集まりの1件ずつ（ID → 名前と物） */
function objectsOf(input: Obj): Map<string, { collection: string; obj: Obj }> {
  const out = new Map<string, { collection: string; obj: Obj }>();
  const h = isObj(input.household) ? input.household : {};
  for (const [name, c] of Object.entries(COLLECTIONS)) {
    const list = h[c.field];
    if (!Array.isArray(list)) continue;
    for (const o of list) if (isObj(o) && typeof o.id === "string") out.set(o.id, { collection: name, obj: o });
  }
  return out;
}

const targetFor = (collection: string, id: string): Target => (collection === "member" ? { member: id } : { object: id });

/**
 * 入力項目の値の中の違い（場所ごと）。"up" は一つ上で全体を変える（値が無くなった）、"whole" は入力項目の値の全体を変える
 * （ID を持たない並び。0036 の2）
 */
function walk(a: unknown, b: unknown, at: string[], out: (at: string[], c: Omit<Change & { kind: "addElement" | "removeElement" }, "target" | "item"> | null) => void): "ok" | "up" | "whole" {
  if (sameJson(a, b)) return "ok";
  if (b === undefined) return "up";
  const container = (v: unknown) => (Array.isArray(v) || isObj(v)) && !isBox(v);
  if (a === undefined || !container(a) || !container(b) || Array.isArray(a) !== Array.isArray(b)) {
    out(at, null);
    return "ok";
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const withIds = (x: unknown[]) => x.every((e) => isObj(e) && typeof e.id === "string");
    if (!withIds(a) || !withIds(b)) return "whole";
    const aIds = a.map((e) => (e as Obj).id as string);
    const bIds = b.map((e) => (e as Obj).id as string);
    const kept = aIds.filter((x) => bIds.includes(x));
    const added = bIds.filter((x) => !aIds.includes(x));
    // 並びの順が変わった（足した要素が途中に入った・並べ替えた）ときは、並びの全体を変える
    if ([...kept, ...added].join(",") !== bIds.join(",")) {
      out(at, null);
      return "ok";
    }
    for (const e of a as Obj[]) if (!bIds.includes(e.id as string)) out([...at, e.id as string], { kind: "removeElement", at: [...at, e.id as string], el: e });
    for (const e of b as Obj[]) if (!aIds.includes(e.id as string)) out(at, { kind: "addElement", at, el: e });
    for (const id of kept) {
      const x = (a as Obj[]).find((e) => e.id === id);
      const y = (b as Obj[]).find((e) => e.id === id);
      const r = walk(x, y, [...at, id], out);
      if (r === "whole") return "whole";
      if (r === "up") out([...at, id], null);
    }
    return "ok";
  }
  const x = a as Obj;
  const y = b as Obj;
  const sub: [string[], Parameters<typeof out>[1]][] = [];
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const r = walk(x[k], y[k], [...at, k], (p, c) => void sub.push([p, c]));
    if (r === "whole") return "whole";
    if (r === "up") {
      out(at, null);
      return "ok";
    }
  }
  for (const [p, c] of sub) out(p, c);
  return "ok";
}

/** 1つの物（か要求の入力）の中の違い。物の形が変わったら null（置き換え） */
function ownerChanges(a: Obj, b: Obj, target: Target, items: readonly string[], out: Change[]): boolean {
  const local: Change[] = [];
  const covered: Address[] = [];
  for (const item of items) {
    const place = ITEM_PLACES[item];
    if (place === undefined) continue;
    const x = getPath(a, place.path);
    const y = getPath(b, place.path);
    if (sameJson(x, y)) continue;
    if (isKindItem(item) && "object" in target) return false;
    if ("member" in target && isKindItem(item)) return false;
    const r = walk(x, y, [], (at, c) => {
      const address: Address = { target, item, at };
      covered.push(address);
      if (c === null) local.push({ kind: "set", address });
      else local.push({ ...c, target, item } as Change);
    });
    if (r === "up") {
      local.push({ kind: "clear", address: { target, item, at: [] }, collection: null });
      covered.push({ target, item, at: [] });
      continue;
    }
    if (r === "whole") {
      for (let i = local.length - 1; i >= 0; i--) {
        const c = local[i] as Change;
        if (("address" in c && c.address.item === item) || ("item" in c && c.item === item)) local.splice(i, 1);
      }
      local.push({ kind: "set", address: { target, item, at: [] } });
      covered.push({ target, item, at: [] });
    }
  }
  // 値の状態の行だけが変わった所（確定・わからない・該当なしなど。値は同じ）
  const rowsA = isObj(a.valueStates) ? a.valueStates : {};
  const rowsB = isObj(b.valueStates) ? b.valueStates : {};
  for (const key of new Set([...Object.keys(rowsA), ...Object.keys(rowsB)])) {
    if (sameJson(rowsA[key], rowsB[key])) continue;
    const [item, ...at] = key.split("/");
    if (item === undefined || !items.includes(item)) continue;
    const address: Address = { target, item, at };
    if (covered.some((c) => overlaps(c, address) && isPrefix(c.at, at))) continue;
    local.push({ kind: "set", address });
  }
  out.push(...local);
  return true;
}

/** 物の中の、どの入力項目にも入らない欄が違うか（違えば物の置き換えにする） */
function restDiffers(a: Obj, b: Obj, items: readonly string[]): boolean {
  const strip = (o: Obj) => {
    const c = structuredClone(o);
    delete c.id;
    delete c.valueStates;
    for (const item of items) {
      const p = ITEM_PLACES[item];
      if (p !== undefined) deletePath(c, p.path);
    }
    return c;
  };
  return !sameJson(strip(a), strip(b));
}

/** 直す前と後の作業中の世帯（要求の入力）の違い */
export function householdChanges(before: Obj, after: Obj): Change[] {
  const out: Change[] = [];
  const a = objectsOf(before);
  const b = objectsOf(after);
  for (const [id, x] of a) {
    const y = b.get(id);
    const target = targetFor(x.collection, id);
    if (y === undefined) {
      out.push({ kind: "removeObject", target, collection: x.collection, obj: x.obj });
      continue;
    }
    if (sameJson(x.obj, y.obj)) continue;
    const items = ITEMS_BY_COLLECTION.get(x.collection) ?? [];
    const local: Change[] = [];
    if (restDiffers(x.obj, y.obj, items) || !ownerChanges(x.obj, y.obj, target, items, local)) out.push({ kind: "replaceObject", target, collection: x.collection, before: x.obj, obj: y.obj });
    else out.push(...local);
  }
  for (const [id, y] of b) if (!a.has(id)) out.push({ kind: "addObject", collection: y.collection, obj: y.obj });
  // 前提条件・表の最後の年（要求の入力の値）
  for (const item of PLAN_ITEMS) {
    const p = ITEM_PLACES[item];
    if (p === undefined) continue;
    const target: Target = p.path[0] === "assumptions" ? { plan: "assumptions" } : { plan: "input" };
    const sub = { [item]: getPath(before, p.path), valueStates: rowsFor(before, item) };
    const sub2 = { [item]: getPath(after, p.path), valueStates: rowsFor(after, item) };
    if (sameJson(sub, sub2)) continue;
    // 要求の入力の項目は、その項目だけを持つ入れ物として比べる（場所はその項目の値の中）
    ownerChangesPlan(sub, sub2, target, item, out);
  }
  return out;
}

const rowsFor = (input: Obj, item: string): Obj => {
  const rows = isObj(input.valueStates) ? input.valueStates : {};
  return Object.fromEntries(Object.entries(rows).filter(([k]) => k === item || k.startsWith(`${item}/`)));
};

function ownerChangesPlan(a: Obj, b: Obj, target: Target, item: string, out: Change[]): void {
  const local: Change[] = [];
  const r = walk(a[item], b[item], [], (at, c) => {
    if (c === null) local.push({ kind: "set", address: { target, item, at } });
    else local.push({ ...c, target, item } as Change);
  });
  if (r !== "ok") {
    // 値が無くなった（既定の値に戻した）・ID の無い並び: 入力項目の値の全体を変える
    out.push(b[item] !== undefined ? { kind: "set", address: { target, item, at: [] } } : { kind: "clear", address: { target, item, at: [] }, collection: null });
    return;
  }
  const rowsA = isObj(a.valueStates) ? a.valueStates : {};
  const rowsB = isObj(b.valueStates) ? b.valueStates : {};
  for (const key of new Set([...Object.keys(rowsA), ...Object.keys(rowsB)])) {
    if (sameJson(rowsA[key], rowsB[key])) continue;
    const [, ...at] = key.split("/");
    const address: Address = { target, item, at };
    if (local.some((c) => c.kind === "set" && isPrefix(c.address.at, at))) continue;
    local.push({ kind: "set", address });
  }
  out.push(...local);
}

// ---- 違いをプランの差分にする ----

const manual = { kind: "manual" as const };
const isCollectionAdd = (d: PlanDiff, id: string) => d.op === "add" && "collection" in d.target && isObj(d.value) && d.value.id === id;
const isCollectionRemove = (d: PlanDiff, id: string) => d.op === "remove" && d.item === null && objectIdOf(d.target) === id;
const isNestedAdd = (d: PlanDiff, target: Target, item: string, elId: string) => d.op === "add" && !("collection" in d.target) && d.item === item && sameJson(d.target, target) && isObj(d.value) && d.value.id === elId;
const isNestedRemove = (d: PlanDiff, target: Target, item: string, at: readonly string[]) => d.op === "remove" && d.item === item && sameJson(d.target, target) && d.at !== null && sameJson(d.at, at);
/** 物（か並びの要素）を向き先・場所に持つ差分（外した物への差分を残さない。0036 の8） */
const pointsInto = (d: PlanDiff, id: string, item?: string, at?: readonly string[]): boolean => {
  if (objectIdOf(d.target) !== id || (d.op === "remove" && d.item === null)) return false;
  if (item === undefined || at === undefined) return true;
  return d.item === item && d.at !== null && isPrefix(at, d.at);
};

export interface RecordOptions {
  /** 一緒に外した物 → きっかけの物（外したときの連鎖。0036 の8） */
  causes?: ReadonlyMap<string, string>;
}

function withDiffs(wh: WorkingHousehold, id: string, f: (diffs: PlanDiff[]) => PlanDiff[]): WorkingHousehold {
  return { ...wh, proposals: wh.proposals.map((p) => (p.id === id ? { ...p, diffs: f(p.diffs) } : p)) };
}

/** 違いの1回分を、そのプランの差分にする */
function applyChanges(wh: WorkingHousehold, cat: Catalog, pid: string, changes: readonly Change[], after: Obj, opts: RecordOptions): WorkingHousehold {
  const now = inputOf(wh);
  let w = wh;
  const plan = () => findPlan(w.proposals, pid) as Proposal;
  const edit = (f: (diffs: PlanDiff[]) => PlanDiff[]) => {
    w = withDiffs(w, pid, f);
  };
  /** このプランで足した物は、足す差分の物をまるごと直す（set を重ねない） */
  const refreshedAdds = new Set<string>();
  const refreshAdd = (id: string): boolean => {
    const add = plan().diffs.find((d) => isCollectionAdd(d, id));
    if (add === undefined) return false;
    if (refreshedAdds.has(add.id)) return true;
    refreshedAdds.add(add.id);
    const obj = findObject(after, id);
    if (obj === undefined) return true;
    const cur = findObject(now, id);
    // 置き換えの組で、物が現状と同じに戻った: 組ごと消す
    const pairRemove = add.pair != null ? plan().diffs.find((d) => d.pair === add.pair && d.op === "remove" && objectIdOf(d.target) === id) : undefined;
    if (pairRemove !== undefined && cur !== undefined && sameJson(cur, obj)) {
      edit((ds) => ds.filter((d) => d.id !== add.id && d.id !== pairRemove.id));
      return true;
    }
    edit((ds) => ds.map((d) => (d.id === add.id ? { ...d, value: structuredClone(obj) } : d)));
    return true;
  };
  /** このプランで足した並びの要素の中なら、その足す差分の要素を直す */
  const refreshNested = (target: Target, item: string, at: readonly string[]): boolean => {
    for (let i = 0; i < at.length; i++) {
      const elId = at[i] as string;
      const add = plan().diffs.find((d) => isNestedAdd(d, target, item, elId));
      if (add === undefined) continue;
      if (refreshedAdds.has(add.id)) return true;
      refreshedAdds.add(add.id);
      const el = readAt(after, { target, item, at: at.slice(0, i + 1) });
      if (isObj(el)) edit((ds) => ds.map((d) => (d.id === add.id ? { ...d, value: structuredClone(el) } : d)));
      return true;
    }
    return false;
  };
  const removedIds = new Map<string, string>(); // 物の ID → 外す差分の ID
  const pairable: { remove: string; add: string; collection: string }[] = [];
  const removes: { diff: string; collection: string }[] = [];
  const adds: { diff: string; collection: string }[] = [];

  for (const c of changes) {
    switch (c.kind) {
      case "removeObject": {
        const id = objectIdOf(c.target) as string;
        const add = plan().diffs.find((d) => isCollectionAdd(d, id));
        if (add !== undefined) {
          // このプランで足した物を外した: その足す差分を消す（置き換えの組なら、外す差分だけが残る）
          edit((ds) => ds.filter((d) => d.id !== add.id).map((d) => (add.pair != null && d.pair === add.pair ? { ...d, pair: null } : d)));
          break;
        }
        const d: PlanDiff = { id: newId(), op: "remove", target: c.target, item: null, at: [], value: null, before: structuredClone(findObject(now, id) ?? c.obj), enabled: true, origin: manual, note: null };
        edit((ds) => [...ds.filter((x) => !pointsInto(x, id)), d]);
        removedIds.set(id, d.id);
        removes.push({ diff: d.id, collection: c.collection });
        break;
      }
      case "addObject": {
        const id = c.obj.id as string;
        const rm = plan().diffs.find((d) => isCollectionRemove(d, id));
        if (rm !== undefined) {
          // このプランで外した物を戻した
          edit((ds) => ds.filter((d) => d.id !== rm.id).map((d) => (rm.pair != null && d.pair === rm.pair ? { ...d, pair: null } : d)));
          break;
        }
        const d: PlanDiff = { id: newId(), op: "add", target: { collection: c.collection }, item: null, at: [], value: structuredClone(c.obj), before: null, enabled: true, origin: manual, note: null };
        edit((ds) => [...ds, d]);
        adds.push({ diff: d.id, collection: c.collection });
        break;
      }
      case "replaceObject": {
        const id = objectIdOf(c.target) as string;
        if (refreshAdd(id)) break;
        const pair = newId();
        const rm: PlanDiff = { id: newId(), op: "remove", target: c.target, item: null, at: [], value: null, before: structuredClone(findObject(now, id) ?? c.before), pair, enabled: true, origin: manual, note: null };
        const add: PlanDiff = { id: newId(), op: "add", target: { collection: c.collection }, item: null, at: [], value: structuredClone(c.obj), before: null, pair, enabled: true, origin: manual, note: null };
        edit((ds) => [...ds.filter((x) => !pointsInto(x, id)), rm, add]);
        refreshedAdds.add(add.id);
        break;
      }
      case "clear": {
        const a = c.address;
        const id = objectIdOf(a.target);
        if (id !== null && refreshAdd(id)) break;
        const mine = plan().diffs.filter((d) => {
          const x = addressOf(d);
          return x !== null && overlaps(x, a);
        });
        if (mine.length > 0) {
          const ids = new Set(mine.map((d) => d.id));
          edit((ds) => ds.filter((d) => !ids.has(d.id)));
          break;
        }
        // 現状（土台）にある値を省いた: 省くことは値を変える差分で書けないので、物を置き換える
        const before = id === null ? undefined : findObject(inputOf(planView(w, cat, pid)), id);
        const obj = id === null ? undefined : findObject(after, id);
        const col = id === null ? null : collectionIn(now, id);
        if (id === null || before === undefined || obj === undefined || col === null) break;
        const pair = newId();
        const target = targetFor(col, id);
        const rm: PlanDiff = { id: newId(), op: "remove", target, item: null, at: [], value: null, before: structuredClone(findObject(now, id) ?? before), pair, enabled: true, origin: manual, note: null };
        const add: PlanDiff = { id: newId(), op: "add", target: { collection: col }, item: null, at: [], value: structuredClone(obj), before: null, pair, enabled: true, origin: manual, note: null };
        edit((ds) => [...ds.filter((x) => !pointsInto(x, id)), rm, add]);
        refreshedAdds.add(add.id);
        break;
      }
      case "addElement": {
        const id = objectIdOf(c.target) as string;
        if (refreshAdd(id) || refreshNested(c.target, c.item, c.at)) break;
        const elId = c.el.id as string;
        const rm = plan().diffs.find((d) => isNestedRemove(d, c.target, c.item, [...c.at, elId]));
        if (rm !== undefined) {
          edit((ds) => ds.filter((d) => d.id !== rm.id));
          break;
        }
        edit((ds) => [...ds, { id: newId(), op: "add", target: c.target, item: c.item, at: [...c.at], value: structuredClone(c.el), before: null, enabled: true, origin: manual, note: null }]);
        break;
      }
      case "removeElement": {
        const id = objectIdOf(c.target) as string;
        if (refreshAdd(id) || refreshNested(c.target, c.item, c.at.slice(0, -1))) break;
        const elId = c.at.at(-1) as string;
        const add = plan().diffs.find((d) => isNestedAdd(d, c.target, c.item, elId));
        if (add !== undefined) {
          edit((ds) => ds.filter((d) => d.id !== add.id && !pointsInto(d, id, c.item, c.at)));
          break;
        }
        const cur = readAt(now, { target: c.target, item: c.item, at: c.at });
        edit((ds) => [...ds.filter((d) => !pointsInto(d, id, c.item, c.at)), { id: newId(), op: "remove", target: c.target, item: c.item, at: [...c.at], value: null, before: structuredClone(isObj(cur) ? cur : c.el), enabled: true, origin: manual, note: null }]);
        break;
      }
      case "set": {
        const a = c.address;
        const id = objectIdOf(a.target);
        if (id !== null && (refreshAdd(id) || refreshNested(a.target, a.item, a.at))) break;
        // このプランが入力項目の値の全体を変えていれば、その全体を直す（全体と中の値を重ねない。0036 の2）
        // （このプランが、この値を含む値の全体を変えていれば、その全体の差分を直す）
        const outer = plan().diffs.find((d) => d.op === "set" && d.item === a.item && sameJson(d.target, a.target) && d.at !== null && d.at.length < a.at.length && isPrefix(d.at, a.at));
        const addr: Address = outer !== undefined ? { ...a, at: [...(outer.at as string[])] } : a;
        const box = boxAt(after, addr);
        if (box === null) break;
        w = setPlanValue(w, cat, pid, addr, box as DiffBox);
        // 中の値の差分は、この値の差分に入る（全体と中の値を重ねない）
        edit((ds) => ds.filter((d) => !(d.op === "set" && d.item === addr.item && sameJson(d.target, addr.target) && d.at !== null && d.at.length > addr.at.length && isPrefix(addr.at, d.at))));
        break;
      }
    }
  }
  // 同じ物の集まりで1件外して1件足した（賃貸の住まいを持ち家の住まいに替えたなど）: 置き換えの組にする
  for (const name of new Set(removes.map((r) => r.collection))) {
    const rs = removes.filter((r) => r.collection === name);
    const as = adds.filter((x) => x.collection === name);
    if (rs.length === 1 && as.length === 1) pairable.push({ remove: (rs[0] as { diff: string }).diff, add: (as[0] as { diff: string }).diff, collection: name });
  }
  for (const p of pairable) {
    const pair = newId();
    edit((ds) => ds.map((d) => (d.id === p.remove || d.id === p.add ? { ...d, pair } : d)));
  }
  // 外したときの連鎖: 一緒に外した物の外す差分に、きっかけの外す差分の ID を書く（0036 の4 の cause）
  for (const [id, diffId] of removedIds) {
    let trigger = opts.causes?.get(id);
    if (trigger === undefined) {
      // 選んでいなくても、外した物がほかの外した物を指していれば、その物がきっかけ（子を外すと、その子の進路も外れるなど）
      const obj = findObject(now, id) ?? (plan().diffs.find((d) => d.id === diffId)?.before as Obj | undefined);
      trigger = [...removedIds.keys()].find((x) => x !== id && obj !== undefined && refersTo(obj, x));
    }
    const causeId = trigger === undefined ? undefined : removedIds.get(trigger);
    if (causeId !== undefined && causeId !== diffId) edit((ds) => ds.map((d) => (d.id === diffId ? { ...d, cause: causeId } : d)));
  }
  return w;
}

/** 物の中に、ほかの物の ID を指す値があるか（自分の ID は除く） */
export function refersTo(obj: unknown, id: string, top = true): boolean {
  if (typeof obj === "string") return obj === id;
  if (Array.isArray(obj)) return obj.some((x) => refersTo(x, id, false));
  if (!isObj(obj)) return false;
  return Object.entries(obj).some(([k, v]) => !(top && k === "id") && k !== "valueStates" && refersTo(v, id, false));
}

/**
 * 入力の部品で直した作業中の世帯を、そのプランの差分にする（0036 の8）。before は直す前の作業中の世帯（planView）、after は部品が返した世帯。
 * 違いを差分にしてから当て直し、まだ違う所があればもう一度（足した物を戻した後の中の値など）。現状（request）は変えない
 */
export function recordPlanEdit(wh: WorkingHousehold, cat: Catalog, pid: string, before: WorkingHousehold, after: WorkingHousehold, opts: RecordOptions = {}): WorkingHousehold {
  if (findPlan(wh.proposals, pid) === undefined) return wh;
  const to = inputOf(after);
  let w = wh;
  let from = inputOf(before);
  for (let i = 0; i < 4; i++) {
    const changes = householdChanges(from, to);
    if (changes.length === 0) break;
    const next = applyChanges(w, cat, pid, changes, to, opts);
    if (sameJson(next.proposals, w.proposals)) break;
    w = next;
    from = inputOf(planView(w, cat, pid));
  }
  // 画面の側の値: このプランで足した構成員の呼び名と、足した項目のカード（物はプランの差分。カードの記録は世帯に1つ）
  const nowMembers = new Set((wh.request.input.household.members ?? []).map((m) => m.id));
  const labels = Object.entries(after.labelsByMember).filter(([id, l]) => !nowMembers.has(id) && w.labelsByMember[id] !== l);
  if (labels.length > 0) w = { ...w, labelsByMember: { ...w.labelsByMember, ...Object.fromEntries(labels) } };
  const items = after.addedItems.filter((a) => !w.addedItems.some((x) => x.id === a.id));
  if (items.length > 0) w = { ...w, addedItems: [...w.addedItems, ...items] };
  // ローンの入れ方の区分（見せ方。0052）は世帯に1つ: プランで直しても世帯の側に書く
  if (JSON.stringify(after.loanEntry ?? {}) !== JSON.stringify(before.loanEntry ?? {})) {
    const next = { ...(w.loanEntry ?? {}) };
    for (const id of new Set([...Object.keys(before.loanEntry ?? {}), ...Object.keys(after.loanEntry ?? {})])) {
      const v = after.loanEntry?.[id];
      if (v === undefined) delete next[id];
      else next[id] = v;
    }
    const { loanEntry: _old, ...rest } = w;
    void _old;
    w = Object.keys(next).length === 0 ? rest : { ...rest, loanEntry: next };
  }
  if (w.proposals !== wh.proposals) {
    const t = new Date().toISOString();
    w = { ...w, proposals: w.proposals.map((p) => (p.id === pid && p !== findPlan(wh.proposals, pid) ? { ...p, updatedAt: t } : p)) };
  }
  return w;
}

/**
 * 欄の値が土台（土台が無ければ現状）と同じに戻ったら、その欄を指す自分の差分を消す（0036 の8）。欄が省いた値を既定の値で見せる
 * ときは、既定の値を打ち直すと世帯の値は「省いた」から「既定の値」に変わるが、欄の見え方と計算は同じなので差分にしない。
 * 同じ差分を指すほかの欄の値・状態も変わらないときだけ消す
 */
export function settleFields(wh: WorkingHousehold, cat: Catalog, pid: string, fields: readonly FieldDef[]): WorkingHousehold {
  let w = wh;
  const look = (v: WorkingHousehold, f: FieldDef) => {
    try {
      return JSON.stringify([f.get(v).value, fieldStatus(f, v).status]);
    } catch {
      return null;
    }
  };
  for (const f of fields) {
    const p = findPlan(w.proposals, pid);
    if (p === undefined) return w;
    const view = planView(w, cat, pid);
    const a = safeAddress(f, view);
    if (a === null) continue;
    const addr = a;
    const mine = p.diffs.filter((d) => {
      const x = addressOf(d);
      return x !== null && overlaps(x, addr);
    });
    if (mine.length === 0) continue;
    const ids = new Set(mine.map((d) => d.id));
    const w2 = withDiffs(w, pid, (ds) => ds.filter((d) => !ids.has(d.id)));
    const v2 = planView(w2, cat, pid);
    const touched = fields.filter((g) => {
      try {
        const b = fieldAddress(g, view);
        return b !== null && mine.some((d) => overlaps(addressOf(d) as Address, b));
      } catch {
        return false;
      }
    });
    if (touched.every((g) => look(view, g) !== null && look(view, g) === look(v2, g))) w = w2;
  }
  return w;
}

// ---- 外したときの連鎖 ----

export interface Referrer {
  id: string;
  collection: string;
  label: string;
  /** 指している外す物 */
  refersTo: string;
}

/** 外す物を指す物（外すと指す先が無くなる物。0036 の8 の連鎖）。作業中の世帯の物から */
export function referrersOf(wh: WorkingHousehold, removed: readonly string[]): Referrer[] {
  const out: Referrer[] = [];
  const gone = new Set(removed);
  for (const [id, x] of objectsOf(inputOf(wh))) {
    if (gone.has(id)) continue;
    const hit = removed.find((r) => refersTo(x.obj, r));
    if (hit !== undefined) out.push({ id, collection: x.collection, label: objectLabel(wh, x.collection, x.obj), refersTo: hit });
  }
  return out;
}

/** 作業中の世帯から物を外す（連鎖で選んだ物） */
export function withoutObjects(wh: WorkingHousehold, ids: readonly string[]): WorkingHousehold {
  if (ids.length === 0) return wh;
  const request = structuredClone(wh.request);
  const h = request.input.household as unknown as Obj;
  for (const c of Object.values(COLLECTIONS)) {
    const list = h[c.field];
    if (Array.isArray(list)) h[c.field] = list.filter((o) => !(isObj(o) && typeof o.id === "string" && ids.includes(o.id)));
  }
  return { ...wh, request };
}

/** 直す前と後で無くなった物の ID */
export function removedObjects(before: WorkingHousehold, after: WorkingHousehold): string[] {
  const b = objectsOf(inputOf(after));
  return [...objectsOf(inputOf(before)).keys()].filter((id) => !b.has(id));
}

// ---- 物と値の見せ方 ----

/** 物の集まりの呼び名（違いの一覧の「何を」） */
const COLLECTION_LABELS: Readonly<Record<string, string>> = {
  member: "家族",
  relation: "家族の関係",
  event: "出来事",
  employment: "働き方",
  account: "口座",
  insurance: "保険",
  residentTaxAssessment: "住民税の決定額",
  pensionRecord: "年金の記録",
  premiumAssessment: "保険料の決定額",
  premiumRate: "保険料率",
  debt: "ローン",
  residence: "住まい",
  livingExpense: "生活費",
  periodicExpense: "支出",
  car: "車",
  advisoryFee: "FP顧問料",
  savingsCheck: "貯まり方の控え",
  retirementBenefit: "退職金",
  goal: "教育・目標",
  care: "介護",
  donor: "贈与",
};

/** 物の呼び名（例: 「車（1台目）」ではなく「車「ミニバン」」のように、物が名前を持てば添える） */
export function objectLabel(wh: WorkingHousehold, collection: string, obj: Obj): string {
  const base = COLLECTION_LABELS[collection] ?? collection;
  if (collection === "member" && typeof obj.id === "string") {
    const known = wh.request.input.household.members.some((m) => m.id === obj.id);
    return known ? `${base}「${memberLabel(wh, obj.id)}」` : `${base}（${typeof obj.kind === "string" ? (KIND_TEXT[obj.kind] ?? obj.kind) : "新しい人"}）`;
  }
  const name = typeof obj.label === "string" ? obj.label : typeof obj.name === "string" ? obj.name : null;
  const kind = typeof obj.kind === "string" ? (KIND_TEXT[obj.kind] ?? null) : typeof obj.type === "string" ? (KIND_TEXT[obj.type] ?? null) : null;
  const who = typeof obj.member === "string" ? memberLabel(wh, obj.member) : typeof obj.owner === "string" ? memberLabel(wh, obj.owner) : null;
  return `${base}${kind !== null ? `（${kind}）` : ""}${name !== null ? `「${name}」` : who !== null && who !== "（いない家族）" ? `（${who}）` : ""}`;
}

const KIND_TEXT: Readonly<Record<string, string>> = {
  rent: "賃貸",
  own: "持ち家",
  owned: "持ち家",
  company: "社宅",
  parents: "実家",
  mortgage: "住宅ローン",
  self: "ご本人",
  spouse: "配偶者",
  child: "子",
  parent: "親",
  grandparent: "祖父母",
  employee: "会社員",
  civilServant: "公務員",
  selfEmployed: "自営業",
  partTime: "パート",
  contract: "契約社員",
  none: "働かない",
};

/** 時点を短く（例: 2030年4月・本人60歳・出来事から） */
function whenText(wh: WorkingHousehold, v: Obj): string {
  if (typeof v.at === "string") return formatYearMonth(v.at);
  if (isObj(v.memberAge) && typeof v.memberAge.member === "string") return `${memberLabel(wh, v.memberAge.member)}${String(v.memberAge.years ?? "")}歳`;
  if (typeof v.event === "string") return "出来事から";
  return "—";
}

/** 欄の値を言葉で（現状: ○○・違いの一覧の 現状 → プラン） */
export function fieldValueText(f: FieldDef | undefined, v: unknown, wh: WorkingHousehold): string {
  if (v === null || v === undefined) return "なし";
  if (f !== undefined) {
    if (f.kind === "select") return f.options.find((o) => o.value === v)?.label ?? String(v);
    if (f.kind === "bool") return v === true ? "はい" : "いいえ";
    if (f.kind === "ym" && typeof v === "string") return formatYearMonth(v);
    if (f.kind === "when" && isObj(v)) return whenText(wh, v);
    if (f.kind === "yen" || f.kind === "pct" || f.kind === "int" || f.kind === "decimal") return fieldText(f, v as number | string);
    if (f.kind === "text") return String(v);
  }
  if (isObj(v) && (typeof v.at === "string" || isObj(v.memberAge) || typeof v.event === "string")) return whenText(wh, v);
  const s = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/** 値の箱を言葉で（わからない・該当なしも） */
function boxText(f: FieldDef | undefined, box: unknown, wh: WorkingHousehold): string {
  if (box === null || box === undefined) return "なし";
  if (isBox(box)) {
    const b = box as Obj;
    if (b.state === "notApplicable") return "該当なし";
    if (b.state === "unknown") return `わからない（${fieldValueText(f, unbox(box), wh)}）`;
    const t = fieldValueText(f, b.value, wh);
    return b.state === "estimated" ? `${t}（推定）` : t;
  }
  return fieldValueText(f, box, wh);
}

// ---- 欄・物とカードの対応 ----

export interface FieldEntry {
  card: string;
  field: FieldDef;
  /** 欄のまとまり・区画の見出し */
  where: string | undefined;
}

export interface PlanIndex {
  /** 当て先 → 欄 */
  fields: Map<string, FieldEntry>;
  /** 向き先＋入力項目ID → カード */
  items: Map<string, string>;
  /** 向き先 → カード */
  targets: Map<string, string>;
  /** カードの ID → 名前 */
  cards: Map<string, string>;
}

/** 欄の定義から、当て先とカードの対応を作る（現状とプランの中身の両方から。外した物は現状の、足した物はプランの中身の欄） */
export function planIndex(whs: readonly WorkingHousehold[]): PlanIndex {
  const out: PlanIndex = { fields: new Map(), items: new Map(), targets: new Map(), cards: new Map() };
  for (const wh of whs)
    for (const card of inputItems(wh)) {
      out.cards.set(card.id, card.label);
      const stage = itemStage(wh, card.id);
      if (stage === null) continue;
      for (const s of stage.sections)
        for (const g of s.groups)
          for (const f of g.fields) {
            const a = safeAddress(f, wh);
            if (a === null) continue;
            const k = addressKey(a);
            if (!out.fields.has(k)) out.fields.set(k, { card: card.id, field: f, where: g.title ?? s.title });
            const ik = `${targetKey(a.target)}|${a.item}`;
            if (!out.items.has(ik)) out.items.set(ik, card.id);
            const tk = targetKey(a.target);
            if (!out.targets.has(tk)) out.targets.set(tk, card.id);
          }
    }
  return out;
}

/** 物の集まり → カード（欄から引けないとき） */
const COLLECTION_CARDS: Readonly<Record<string, string>> = {
  member: "family",
  relation: "family",
  event: "family",
  donor: "inheritance",
  employment: "work",
  retirementBenefit: "retirement",
  residentTaxAssessment: "work",
  premiumAssessment: "work",
  pensionRecord: "pension",
  account: "savings",
  savingsCheck: "living",
  insurance: "insurance",
  debt: "housing",
  residence: "housing",
  livingExpense: "living",
  periodicExpense: "events",
  care: "care",
  car: "car",
  advisoryFee: "fee",
  goal: "education",
  premiumRate: "assumptions",
};

/** 合成の対策 → カード */
const LEVER_CARDS: Readonly<Record<string, string>> = {
  retireAge: "work",
  mainEndAge: "work",
  workEndAge: "work",
  residentTaxThisYear: "work",
  spouseWork: "work",
  pensionAge: "pension",
  pensionClaimAge: "pension",
  pensionClaimAgeBasic: "pension",
  pensionClaimAgeEmployee: "pension",
  nisaMonthly: "savings",
  investMonthly: "savings",
  investReturnShift: "savings",
  investStopAge: "savings",
  drawdownStart: "savings",
  drawdownAmount: "savings",
  drawdownRate: "savings",
  firstContributionMonthly: "savings",
  payoutAge: "savings",
  livingMonthly: "living",
  surplusRatio: "living",
  surplusChangeAge: "living",
  advisoryFee: "fee",
  loanRateShift: "housing",
  loanPrepay: "housing",
  loanRate: "housing",
  loanTermYears: "housing",
  insurancePayUntilAge: "insurance",
  carDownPayment: "car",
  carFirstPurchase: "car",
  carLoanYears: "car",
  carUntilAge: "car",
};

/** 万一の前提の差分の行の置き場所（入力のホームのカードではない。万一のタブ） */
export const CONTINGENCY_CARD = "contingency";

function cardOf(d: PlanDiff, index: PlanIndex, now: Obj, view: Obj): string | null {
  const t = d.target;
  if (isLever(t)) {
    const own = objectIdOf(t);
    return (own !== null ? index.targets.get(targetKey(targetForId(now, view, own))) : undefined) ?? LEVER_CARDS[t.lever] ?? null;
  }
  if ("collection" in t) {
    const id = isObj(d.value) && typeof d.value.id === "string" ? d.value.id : null;
    return (id !== null ? index.targets.get(targetKey(targetFor(t.collection, id))) : undefined) ?? COLLECTION_CARDS[t.collection] ?? null;
  }
  if (d.item !== null) {
    const hit = index.items.get(`${targetKey(t)}|${d.item}`);
    if (hit !== undefined) return hit;
  }
  const hit = index.targets.get(targetKey(t));
  if (hit !== undefined) return hit;
  if ("plan" in t) return t.plan === "assumptions" || t.plan === "input" ? "assumptions" : t.plan === "contingency" ? CONTINGENCY_CARD : null;
  const id = objectIdOf(t);
  const col = id === null ? null : (collectionIn(now, id) ?? collectionIn(view, id));
  return col !== null ? (COLLECTION_CARDS[col] ?? null) : null;
}
/** 世帯の物の全部と、その物を出すカード・呼び名（世帯の中身の一覧。0074）。並びは物の集まりの順 */
export function objectCards(wh: WorkingHousehold): { id: string; collection: string; card: string | null; label: string; obj: Obj }[] {
  const index = planIndex([wh]);
  const out: { id: string; collection: string; card: string | null; label: string; obj: Obj }[] = [];
  for (const [id, o] of objectsOf(inputOf(wh))) out.push({ id, collection: o.collection, card: index.targets.get(targetKey(targetFor(o.collection, id))) ?? COLLECTION_CARDS[o.collection] ?? null, label: objectLabel(wh, o.collection, o.obj), obj: o.obj });
  return out;
}
const collectionIn = (input: Obj, id: string): string | null => objectsOf(input).get(id)?.collection ?? null;
const targetForId = (now: Obj, view: Obj, id: string): Target => targetFor(collectionIn(now, id) ?? collectionIn(view, id) ?? "", id);

// ---- 違いの一覧 ----

export type RowKind = "set" | "add" | "remove" | "replace" | "lever" | "unresolved";

export interface DiffRow {
  /** 一覧の1行の印（置き換えの組は組の ID、ほかは差分の ID） */
  key: string;
  diffs: PlanDiff[];
  /** 差分を持つプラン */
  plan: string;
  /** 土台のプランから来た差分 */
  inherited: boolean;
  /** 差分を持つプランの名前（土台のとき） */
  planName: string;
  card: string | null;
  cardLabel: string;
  kind: RowKind;
  /** 何を（例: 「住宅ローン: 借入額」「足す: 車」） */
  label: string;
  from: string;
  to: string;
  enabled: boolean;
  /** 要確認（オフの差分・確かめるものが無い差分は null） */
  review: Review | null;
  /** 出どころ（例: 入力で直した・結果のタブで動かした・AIの候補） */
  origin: string;
  /** 連鎖で一緒に外した差分の、きっかけの行の印 */
  cause: string | null;
  /** この行がきっかけで一緒に外した行の数 */
  followers: number;
}

const ORIGIN_TEXT = (d: PlanDiff): string => (d.origin.kind === "ai" ? "AIの候補（承認済み）" : d.origin.kind === "result" ? "結果のタブで動かした" : "入力で直した");

/** 違いの一覧（0036 の8）: 差分1件ずつ（置き換えの組は1件）。オフの差分・連鎖で一緒に外す差分も出す。要確認を上に、カードの順 */
export function diffRows(wh: WorkingHousehold, cat: Catalog, pid: string, index: PlanIndex = planIndex([wh, planView(wh, cat, pid)])): DiffRow[] {
  const chain = chainOf(wh.proposals, pid);
  if (chain.length === 0) return [];
  const view = planView(wh, cat, pid);
  const now = inputOf(wh);
  const applied = applyPlan(wh, pid, cat);
  // 同じ当て先（同じ動かす項目のキー）は後のプランが勝つ。オフの差分はそのプランの行として残す
  const effective = new Map<string, { diffs: PlanDiff[]; plan: Proposal }>();
  const off: { diffs: PlanDiff[]; plan: Proposal }[] = [];
  for (const p of chain) {
    const groups = new Map<string, PlanDiff[]>();
    for (const d of p.diffs) {
      const g = d.pair ?? d.id;
      groups.set(g, [...(groups.get(g) ?? []), d]);
    }
    for (const ds of groups.values()) {
      const first = ds[0] as PlanDiff;
      if (!first.enabled) {
        if (p.id === pid) off.push({ diffs: ds, plan: p });
        continue;
      }
      const a = first.pair == null ? addressOf(first) : null;
      const k = a !== null && diffKey(first, wh) === null ? `a:${addressKey(a)}` : rowKeyOf(first, wh);
      effective.set(k, { diffs: ds, plan: p });
    }
  }
  const rows: DiffRow[] = [];
  const label = (p: Proposal) => p.name;
  for (const { diffs, plan } of [...effective.values(), ...off]) {
    const d = diffs[0] as PlanDiff;
    const card = cardOf(d, index, now, inputOf(view));
    const review = d.enabled ? (diffs.map((x) => applied.reviews.get(x.id)).find((r) => r !== undefined && r.state !== "ok") ?? null) : null;
    const base = { key: d.pair ?? d.id, diffs, plan: plan.id, inherited: plan.id !== pid, planName: label(plan), card, cardLabel: card === null ? "そのほか" : (index.cards.get(card) ?? (card === CONTINGENCY_CARD ? "万一の前提（万一のタブ）" : card)), enabled: d.enabled, review, origin: ORIGIN_TEXT(d), cause: null as string | null, followers: 0 };
    rows.push({ ...base, ...describe(d, diffs, wh, view, cat, index) });
  }
  // 連鎖: きっかけの差分の行を指す
  const byDiff = new Map<string, DiffRow>();
  for (const r of rows) for (const d of r.diffs) byDiff.set(d.id, r);
  for (const r of rows) {
    const c = r.diffs.find((d) => d.cause != null)?.cause;
    const trigger = c != null ? byDiff.get(c) : undefined;
    if (trigger !== undefined && trigger !== r) {
      r.cause = trigger.key;
      trigger.followers++;
    }
  }
  const order = [...index.cards.keys()];
  const pos = (r: DiffRow) => (r.card === null ? order.length : Math.max(0, order.indexOf(r.card)));
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(b.r.review !== null && b.r.review.state !== "ok") - Number(a.r.review !== null && a.r.review.state !== "ok") || pos(a.r) - pos(b.r) || a.i - b.i)
    .map((x) => x.r);
}

function describe(d: PlanDiff, group: readonly PlanDiff[], wh: WorkingHousehold, view: WorkingHousehold, cat: Catalog, index: PlanIndex): Pick<DiffRow, "kind" | "label" | "from" | "to"> {
  const now = inputOf(wh);
  if (d.unresolved === true) return { kind: "unresolved", label: `読み替えられなかった差分（${d.legacy?.key ?? d.item ?? "—"}）`, from: "—", to: "—" };
  const key = diffKey(d, wh);
  const it = key === null ? undefined : cat.byKey.get(key);
  if (isLever(d.target)) {
    if (it !== undefined) return { kind: "lever", label: it.label, from: it.text(it.read(wh)), to: it.text(unbox(d.value) as ItemValue) };
    return { kind: "lever", label: `対策: ${d.target.lever}`, from: "—", to: fieldValueText(undefined, unbox(d.value), wh) };
  }
  if (group.length > 1 || d.pair != null) {
    const rm = group.find((x) => x.op === "remove");
    const add = group.find((x) => x.op === "add");
    const col = add !== undefined && "collection" in add.target ? add.target.collection : (rm !== undefined ? collectionIn(now, objectIdOf(rm.target) ?? "") : null) ?? "物";
    const from = rm !== undefined && isObj(rm.before) ? objectLabel(wh, col, rm.before) : "—";
    const to = add !== undefined && isObj(add.value) ? objectLabel(view, col, add.value) : "なし";
    return { kind: "replace", label: `置き換え: ${COLLECTION_LABELS[col] ?? col}`, from, to };
  }
  if (d.op === "add") {
    if ("collection" in d.target) {
      const obj = isObj(d.value) ? d.value : {};
      return { kind: "add", label: `足す: ${objectLabel(view, d.target.collection, obj)}`, from: "なし", to: "足す" };
    }
    const owner = ownerLabel(d.target, wh, view);
    const el = isObj(d.value) && typeof d.value.id === "string" && d.at !== null ? whereOf(index, d.target, d.item, [...d.at, d.value.id]) : null;
    return { kind: "add", label: `足す: ${ITEM_LABELS[d.item ?? ""] ?? d.item ?? "要素"}${el !== null ? `「${el}」` : ""}（${owner}）`, from: "なし", to: "足す" };
  }
  if (d.op === "remove") {
    if (d.item === null) {
      const id = objectIdOf(d.target) ?? "";
      const col = collectionIn(now, id) ?? (("member" in d.target) ? "member" : "物");
      const obj = isObj(d.before) ? d.before : (findObject(now, id) ?? {});
      return { kind: "remove", label: `外す: ${objectLabel(wh, col, obj)}`, from: "あり", to: "外す" };
    }
    const el = d.at !== null ? whereOf(index, d.target, d.item, d.at) : null;
    return { kind: "remove", label: `外す: ${ITEM_LABELS[d.item] ?? d.item}${el !== null ? `「${el}」` : ""}（${ownerLabel(d.target, wh, view)}）`, from: "あり", to: "外す" };
  }
  const premise = premiseDiffText(d, wh);
  if (premise !== null) return { kind: "set", ...premise };
  const a = addressOf(d);
  if (a === null) return { kind: "set", label: ITEM_LABELS[d.item ?? ""] ?? d.item ?? "—", from: "—", to: fieldValueText(undefined, unbox(d.value), wh) };
  const entry = index.fields.get(addressKey(a));
  if (entry !== undefined) {
    const where = entry.where !== undefined && entry.where !== entry.field.label ? `${entry.where}: ` : "";
    return { kind: "set", label: `${where}${entry.field.label}`, from: boxText(entry.field, boxAt(now, a), wh), to: boxText(entry.field, d.value, view) };
  }
  if (it !== undefined) return { kind: "set", label: it.label, from: it.text(it.read(wh)), to: it.text(unbox(d.value) as ItemValue) };
  const name = ITEM_LABELS[a.item] ?? a.item;
  return { kind: "set", label: `${name}（${ownerLabel(a.target, wh, view)}）`, from: boxText(undefined, boxAt(now, a), wh), to: boxText(undefined, d.value, view) };
}

/** 並びの要素の呼び名（その要素の欄のまとまりの見出し。例: 「退職後」） */
function whereOf(index: PlanIndex, target: PlanDiff["target"], item: string | null, at: readonly string[]): string | null {
  if (item === null) return null;
  const head = `${targetKey(target)}|${item}|${at.join("/")}`;
  for (const [k, e] of index.fields) if ((k === head || k.startsWith(`${head}/`)) && e.where !== undefined) return e.where;
  return null;
}

function ownerLabel(t: PlanDiff["target"], wh: WorkingHousehold, view: WorkingHousehold): string {
  if ("plan" in t) return t.plan === "assumptions" ? "前提条件" : t.plan === "contingency" ? "万一の前提" : "計算の設定";
  const id = objectIdOf(t);
  if (id === null) return "—";
  for (const w of [wh, view]) {
    const hit = objectsOf(inputOf(w)).get(id);
    if (hit !== undefined) return objectLabel(w, hit.collection, hit.obj);
  }
  return "無くなった物";
}

/** カードごとの違う所の数（オンの差分の行。入力のホームのカードの札） */
export function countsByCard(rows: readonly DiffRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) if (r.enabled && r.card !== null) out.set(r.card, (out.get(r.card) ?? 0) + 1);
  return out;
}

// ---- 一覧の行の操作 ----

/** 連鎖で一緒に外した差分も含めた、行の差分の ID */
function withFollowers(p: Proposal, ids: ReadonlySet<string>): Set<string> {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of p.diffs) if (d.cause != null && out.has(d.cause) && !out.has(d.id)) {
      out.add(d.id);
      grew = true;
    }
  }
  return out;
}

/** 行をオン・オフにする（自分の差分だけ。置き換えの組は組ごと、連鎖で一緒に外した差分もいっしょに） */
export function toggleRow(wh: WorkingHousehold, pid: string, row: DiffRow, enabled: boolean): WorkingHousehold {
  if (row.inherited) return wh;
  const p = findPlan(wh.proposals, pid);
  if (p === undefined) return wh;
  const ids = withFollowers(p, new Set(row.diffs.map((d) => d.id)));
  return withDiffs(wh, pid, (ds) => ds.map((d) => (ids.has(d.id) ? { ...d, enabled } : d)));
}

/**
 * 行を戻す（現状に戻す）: 自分の差分は消す（組は組ごと、連鎖で一緒に外した差分も）。土台のプランから来た差分は、このプランに現状へ
 * 戻す差分を作る（0036 の8。plans.ts の dropChange）
 */
export function revertRow(wh: WorkingHousehold, cat: Catalog, pid: string, row: DiffRow): WorkingHousehold {
  const p = findPlan(wh.proposals, pid);
  if (p === undefined) return wh;
  if (!row.inherited) {
    const ids = withFollowers(p, new Set(row.diffs.map((d) => d.id)));
    return withDiffs(wh, pid, (ds) => ds.filter((d) => !ids.has(d.id)));
  }
  return dropChange(wh, cat, pid, rowKeyOf(row.diffs[0] as PlanDiff, wh));
}

/** 要確認を「確認した（このまま）」にする（plans.ts の acknowledge） */
export function acknowledgeRow(wh: WorkingHousehold, cat: Catalog, pid: string, row: DiffRow): WorkingHousehold {
  return acknowledge(wh, cat, pid, rowKeyOf(row.diffs[0] as PlanDiff, wh));
}

// ---- 欄・まとまりの印 ----

export interface FieldMark {
  /** own: このプランで変えた・base: 土台のプランで変えた・lever: 結果のタブの対策（合成の対策）で変わっている */
  kind: "own" | "base" | "lever";
  /** 現状の値（例: 「3,000万円」） */
  current: string;
  /** 土台のプランの名前（kind base のとき） */
  planName: string | null;
}

/** 欄の印（現状と違う欄。0036 の8）。足した物の中の欄は、まとまりの印にするので出さない */
export function fieldMark(wh: WorkingHousehold, cat: Catalog, pid: string, f: FieldDef, view: WorkingHousehold): FieldMark | null {
  const a = safeAddress(f, view);
  if (a === null) return null;
  if (a === null || f.readOnly !== undefined) return null;
  const now = inputOf(wh);
  const id = objectIdOf(a.target);
  if (id !== null && findObject(now, id) === undefined) return null;
  const covers = (d: PlanDiff) => {
    const x = addressOf(d);
    return d.enabled && x !== null && overlaps(x, a);
  };
  const chain = chainOf(wh.proposals, pid);
  const own = chain.at(-1);
  const current = (): string => {
    try {
      const st = f.get(wh);
      if (f.kind === "when" && st.when !== undefined) return st.when.read;
      return fieldValueText(f, st.value, wh);
    } catch {
      return fieldValueText(f, unbox(readAt(now, a)), wh);
    }
  };
  if (own !== undefined && own.id === pid && own.diffs.some(covers)) return { kind: "own", current: current(), planName: null };
  const base = [...chain].reverse().find((p) => p.id !== pid && p.diffs.some(covers));
  if (base !== undefined) return { kind: "base", current: current(), planName: base.name };
  if (!sameJson(unbox(readAt(inputOf(view), a)), unbox(readAt(now, a)))) return { kind: "lever", current: current(), planName: null };
  return null;
}

/** 欄を現状に戻す: この欄を指す自分の差分を消し、まだ現状と違えば（土台のプランで変えたなど）現状の値の差分を作る */
export function revertField(wh: WorkingHousehold, cat: Catalog, pid: string, f: FieldDef, view: WorkingHousehold): WorkingHousehold {
  const a = fieldAddress(f, view);
  if (a === null) return wh;
  let w = withDiffs(wh, pid, (ds) => ds.filter((d) => {
    const x = addressOf(d);
    return x === null || !overlaps(x, a);
  }));
  const now = boxAt(inputOf(wh), a);
  const v = planView(w, cat, pid);
  if (now !== null && !sameJson(unbox(boxAt(inputOf(v), a)), unbox(now))) w = setPlanValue(w, cat, pid, a, now);
  return w;
}

export interface GroupMark {
  kind: "own" | "base";
  planName: string | null;
}

/** まとまり（物1件）の印: このプランで足した物・土台のプランで足した物 */
export function groupMark(wh: WorkingHousehold, pid: string, g: GroupDef, view: WorkingHousehold): GroupMark | null {
  let id: string | null = null;
  for (const f of g.fields) {
    const a = safeAddress(f, view);
    id = a === null ? null : objectIdOf(a.target);
    if (id !== null) break;
  }
  if (id === null || findObject(inputOf(wh), id) !== undefined) return null;
  const chain = chainOf(wh.proposals, pid);
  const owner = [...chain].reverse().find((p) => p.diffs.some((d) => d.enabled && isCollectionAdd(d, id)));
  if (owner === undefined) return null;
  return owner.id === pid ? { kind: "own", planName: null } : { kind: "base", planName: owner.name };
}

/** カードの外した物（現状にあって、このプランか土台で外した物）。パネルに薄く見せる */
export function removedRows(rows: readonly DiffRow[], card: string): DiffRow[] {
  return rows.filter((r) => r.card === card && r.enabled && (r.kind === "remove" || r.kind === "replace") && r.diffs.some((d) => d.op === "remove"));
}

/** 欄の定義の全部（テストと一覧用） */
export const fieldsOfCard = (wh: WorkingHousehold, card: string): FieldDef[] => {
  const s = itemStage(wh, card);
  return s === null ? [] : allFields(s);
};

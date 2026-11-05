// プランの差分（0036）: 3つの種類（値を変える set・物を足す add・物を外す remove）と当て先（向き先＋入力項目ID＋場所）。
// ここは世帯の要求の入力（エンジンの入力の形）に1件ずつ当てる部品だけを持つ。当てる順番・合成の対策・要確認の一覧は plans.ts。
// 当て先の歩き方（並びの要素は ID、ID の無い要素は決まった ID）は読み替え表と同じ（store/readings.ts）
import { BOXED_PLACES, COLLECTIONS, ITEM_PLACES, REQUIRED_PLACES } from "../../generated/readings.ts";
import { findObject, readAt, unbox, type Address, type Target } from "../store/readings.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** 差分の向き先（0036 の2）: 物・構成員・前提・要求の入力・万一の前提、足す先の物の集まり、合成の対策 */
export type DiffTarget = Target | { collection: string } | { lever: string; object?: string; member?: string };

/** 値の箱（0008 の5）。差分の値はいつも値の箱 */
export interface DiffBox {
  value?: unknown;
  state: string;
  origin: { kind: string; [k: string]: unknown };
  [k: string]: unknown;
}

/** 差分の出どころ（0036 の4）。`ai` の `ref` は候補の ID、`connector` は AI のアプリが名乗った名前（自己申告） */
export type DiffOrigin = { kind: "manual" } | { kind: "result" } | { kind: "ai"; ref: string; connector: string | null };

/** 差分（0036 の4 の形。世帯ファイルにもこの形で書く） */
export interface PlanDiff {
  id: string;
  op: "set" | "add" | "remove";
  target: DiffTarget;
  /** 入力項目ID（物の集まりへ足す・物の集まりの1件を外すときは null） */
  item: string | null;
  /** 入力項目の値の中の道（読み替えられなかった差分は null） */
  at: string[] | null;
  /** set: 新しい値の値の箱。add: 足す物の全体。remove: null */
  value: unknown;
  /** set: 作った時点の現状の値の値の箱（現状に無ければ null）。add: null。remove: 外した時点の現状の物の全体 */
  before: unknown;
  /** 置き換えの組（同じ組の remove と add） */
  pair?: string | null;
  /** 連鎖（一緒に外した差分の、きっかけの差分） */
  cause?: string | null;
  enabled: boolean;
  origin: DiffOrigin;
  /** 外から来た値（AI）は、FP が承認した記録を持つ（0008 の2） */
  approval?: { by: "fp"; at: string; candidate: string };
  note: string | null;
  /** 形式 0.16 から読み替えた差分の、もとの手がかり（0036 の4） */
  legacy?: { key: string; target: unknown; item: unknown };
  /** 読み替えられなかった差分（当てない。0036 の5・7） */
  unresolved?: boolean;
}

export const isLever = (t: DiffTarget): t is { lever: string; object?: string; member?: string } => "lever" in t;

/**
 * どのプランにも共通の入力項目（世帯で1つの値。プランの差分にしない。0043 の追記 2026-11-05）: 表の最後の年。プランの表はいつも現状と同じ年で終わる。
 * プランを直している間にこの欄を変えると現状に書き（planEdit.ts の recordPlanEdit）、前の版で作った差分は読むときに外して知らせる（plans/sharedItems.ts）
 */
export const PLAN_SHARED_ITEMS: ReadonlySet<string> = new Set(["plan.endYear"]);

/** 表の最後の年を人の年齢で入れる欄の合成の対策（0036 の追記 2026-10-29。共通の項目なのでプランには持たない） */
export const PLAN_SHARED_LEVERS: ReadonlySet<string> = new Set(["endYearAge"]);

/** どのプランにも共通の項目を変える差分か（当て先が要求の入力の共通の項目・その合成の対策） */
export function isSharedDiff(d: Pick<PlanDiff, "target" | "item">): boolean {
  if (isLever(d.target)) return PLAN_SHARED_LEVERS.has(d.target.lever);
  return "plan" in d.target && d.target.plan === "input" && d.item !== null && PLAN_SHARED_ITEMS.has(d.item);
}

/** 差分の当て先（値を変える差分で、合成の対策でも読み替えられなかった差分でもないもの） */
export function addressOf(d: PlanDiff): Address | null {
  if (d.op !== "set" || d.unresolved === true || isLever(d.target) || "collection" in d.target || d.item === null || d.at === null) return null;
  return { target: d.target, item: d.item, at: d.at };
}

const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

const isBox = (v: unknown): v is DiffBox => isObj(v) && typeof v.state === "string" && isObj(v.origin);
const plainBox = (b: DiffBox) => b.state === "confirmed" && b.origin.kind === "manual" && Object.keys(b).every((k) => k === "value" || k === "state" || k === "origin");

/** 物の集まりの1件を探す: 世帯の欄の名前・番号と物 */
function locateObject(input: Obj, id: string): { list: unknown[]; index: number; field: string } | null {
  const h = input.household;
  if (!isObj(h)) return null;
  for (const [field, v] of Object.entries(h)) {
    if (!Array.isArray(v)) continue;
    const index = v.findIndex((x) => isObj(x) && x.id === id);
    if (index >= 0) return { list: v, index, field };
  }
  return null;
}

/** 物の集まりの名前（x-collection）。物が無ければ null */
export function collectionOf(input: Obj, id: string): string | null {
  const at = locateObject(input, id);
  if (at === null) return null;
  return Object.entries(COLLECTIONS).find(([, c]) => c.field === at.field)?.[0] ?? null;
}

/**
 * 当て先の入れ物（書くため）: 値を持つ物か並びと、その中の欄の名前か番号。途中の欄が無ければ作る（物の中の欄だけ）。
 * 向き先の物・途中の並びの要素が無ければ null
 */
function locate(input: Obj, a: Address, create: boolean): { holder: Obj | unknown[]; key: string | number; owner: Obj; pattern: string } | null {
  const place = ITEM_PLACES[a.item];
  if (place === undefined) return null;
  const t = a.target;
  let owner: Obj | undefined;
  if ("plan" in t) {
    if (t.plan === "contingency") return null;
    owner = input;
  } else owner = findObject(input, "object" in t ? t.object : t.member);
  if (owner === undefined) return null;
  const steps = [...place.path, ...a.at];
  let holder: Obj | unknown[] = owner;
  const pattern: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as string;
    let key: string | number = step;
    if (i >= place.path.length) pattern.push(Array.isArray(holder) ? "*" : step);
    if (Array.isArray(holder)) {
      // 並びの要素は ID で（ID の無い要素は読み替え表と同じ決まった ID）。決まった ID は readAt と同じ歩き方で確かめる
      const arr = holder;
      const prefix = { target: a.target, item: a.item, at: steps.slice(place.path.length, i) } as Address;
      const index = arr.findIndex((e, j) => (isObj(e) && e.id === step) || (!(isObj(e) && typeof e.id === "string") && readAt(input, { ...prefix, at: [...prefix.at, step] }) === arr[j]));
      if (index < 0) return null;
      key = index;
    }
    if (i === steps.length - 1) return { holder, key, owner, pattern: pattern.join("/") };
    const next: unknown = Array.isArray(holder) ? holder[key as number] : holder[key as string];
    if (next === undefined && create && !Array.isArray(holder)) {
      const made: Obj = {};
      holder[key as string] = made;
      holder = made;
      continue;
    }
    if (!isObj(next) && !Array.isArray(next)) return null;
    holder = next;
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 当て先の物と、道の中の並びの要素が世帯にあるか（欄の値そのものは無くてもよい）。外した要素・物への差分を、0.16 の番号で当てる
 * 逃げ道に回さないために使う（0036 の7）
 */
export function placeExists(input: Obj, a: Address): boolean {
  const place = ITEM_PLACES[a.item];
  if (place === undefined) return false;
  const t = a.target;
  const owner = "plan" in t ? (t.plan === "contingency" ? undefined : input) : findObject(input, "object" in t ? t.object : t.member);
  if (owner === undefined) return false;
  const steps = [...place.path, ...a.at];
  let node: unknown = owner;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as string;
    if (Array.isArray(node)) {
      const prefix = steps.slice(place.path.length, i);
      const arr = node;
      const el = arr.find((e) => (isObj(e) && e.id === step) || (!(isObj(e) && typeof e.id === "string") && readAt(input, { target: a.target, item: a.item, at: [...prefix, step] }) === e));
      if (el === undefined) return false;
      node = el;
      continue;
    }
    const next: unknown = isObj(node) ? node[step] : undefined;
    if (next === undefined) return !steps.slice(i + 1).some((x) => UUID.test(x));
    node = next;
  }
  return true;
}

/** 当て先の今の値（値の箱ならその箱）。無ければ undefined */
export function currentAt(input: Obj, a: Address): unknown {
  return readAt(input, a);
}

/** 値の状態の行の名前（0035 の3: `item[/at...]`） */
const stateKey = (a: Address) => [a.item, ...a.at].join("/");

/**
 * 値を変える差分を当てる（0036 の4）。値の箱を持つ欄へは箱をそのまま書く。値の箱を持たない欄へは箱の値を書き、箱のほかの欄は
 * 向き先の物の `valueStates` の行に書く（手で入れた確定の値なら行を消す）。当てられなければ false
 */
export function writeAt(input: Obj, a: Address, box: DiffBox): boolean {
  const loc = locate(input, a, true);
  if (loc === null) return false;
  const { holder, key, owner, pattern } = loc;
  const cur: unknown = Array.isArray(holder) ? holder[key as number] : holder[key as string];
  // 今の値が無い欄は、エンジンの入力のスキーマで値の箱を持つ場所なら箱で書く
  const raw = cur !== undefined ? !isBox(cur) : !(BOXED_PLACES[a.item] ?? []).includes(pattern);
  if (!raw) {
    if (Array.isArray(holder)) holder[key as number] = structuredClone(box);
    else holder[key as string] = structuredClone(box);
    return true;
  }
  // わからないは代わりの値を、該当なしは欄を省く（省けない欄は 0。0035 の3）
  const sub = isObj(box.substitute) ? box.substitute : null;
  const mustKeep = Array.isArray(holder) || (REQUIRED_PLACES[a.item] ?? []).includes(pattern);
  const value = box.state === "unknown" ? sub?.value : box.state === "notApplicable" ? (mustKeep ? 0 : undefined) : box.value;
  if (Array.isArray(holder)) holder[key as number] = structuredClone(value ?? 0);
  else if (value === undefined) delete holder[key as string];
  else holder[key as string] = structuredClone(value);
  const states = isObj(owner.valueStates) ? owner.valueStates : null;
  if (plainBox(box)) {
    if (states !== null) {
      delete states[stateKey(a)];
      if (Object.keys(states).length === 0) delete owner.valueStates;
    }
  } else {
    const { value: _v, substitute: _s, ...row } = box;
    void _v;
    void _s;
    // わからないの行は、欄に入れた代わりの値の根拠を持つ（0035 の3）
    if (box.state === "unknown" && row.estimate === undefined && sub !== null && isObj(sub.estimate)) row.estimate = structuredClone(sub.estimate);
    const next = states ?? {};
    next[stateKey(a)] = row;
    owner.valueStates = next;
  }
  return true;
}

/**
 * 当て先の今の値を値の箱で（差分の value・before はいつも値の箱。0036 の4）。値の箱を持つ欄はその箱。値の箱を持たない欄は、
 * 欄の値と向き先の物の `valueStates` の行から組み立てる（行が無ければ記録の無い確定）。値が無ければ null
 */
export function boxAt(input: Obj, a: Address): DiffBox | null {
  const cur = readAt(input, a);
  if (isBox(cur)) return structuredClone(cur);
  const t = a.target;
  const owner = "plan" in t ? input : findObject(input, "object" in t ? t.object : t.member);
  const row = owner !== undefined && isObj(owner.valueStates) ? owner.valueStates[stateKey(a)] : undefined;
  if (isObj(row) && typeof row.state === "string" && isObj(row.origin)) {
    const r = structuredClone(row) as DiffBox;
    if (r.state === "notApplicable") return r;
    if (cur === undefined) return null;
    if (r.state === "unknown") {
      const { estimate, ...rest } = r;
      return { ...rest, substitute: { value: structuredClone(cur), state: "estimated", origin: { kind: "auto" }, ...(estimate !== undefined ? { estimate } : {}) } };
    }
    return { ...r, value: structuredClone(cur) };
  }
  if (cur === undefined) return null;
  return { value: structuredClone(cur), state: "confirmed", origin: { kind: "manual" } };
}

/** 物の集まりの中の、物の番号（無ければ -1） */
export function indexOfObject(input: Obj, id: string): number {
  return locateObject(input, id)?.index ?? -1;
}

/**
 * 物を足す差分を当てる（0036 の4）。足せたら "ok"、同じ ID がもうあれば "exists"、足す先・相手が無ければ "noTarget"・"noOwner"。
 * index は物の集まりの中の入れる番号（置き換えの組で、外した物のあった所に入れる。省くと最後）
 */
export function addAt(input: Obj, d: PlanDiff, index?: number): "ok" | "exists" | "noTarget" | "noOwner" {
  const obj = d.value;
  if (!isObj(obj)) return "noTarget";
  const id = typeof obj.id === "string" ? obj.id : null;
  if ("collection" in d.target) {
    const c = COLLECTIONS[d.target.collection];
    const h = input.household;
    if (c === undefined || !isObj(h)) return "noTarget";
    if (id !== null && findObject(input, id) !== undefined) return "exists";
    // 構成員を指す欄（x-owner）の相手が作業中の世帯にあること（構成員そのものと関係の当人は除く）
    if (d.target.collection !== "member") {
      for (const f of c.owners) {
        const ref = obj[f];
        if (typeof ref === "string" && findObject(input, ref) === undefined) return "noOwner";
      }
    }
    const list = Array.isArray(h[c.field]) ? (h[c.field] as unknown[]) : [];
    if (index !== undefined && index >= 0 && index <= list.length) list.splice(index, 0, structuredClone(obj));
    else list.push(structuredClone(obj));
    h[c.field] = list;
    return "ok";
  }
  if (isLever(d.target) || d.item === null || d.at === null) return "noTarget";
  const a: Address = { target: d.target, item: d.item, at: d.at };
  const loc = locate(input, a, true);
  if (loc === null) return "noTarget";
  const { holder, key } = loc;
  let arr: unknown = Array.isArray(holder) ? holder[key as number] : holder[key as string];
  if (arr === undefined && !Array.isArray(holder)) {
    arr = [];
    holder[key as string] = arr;
  }
  if (!Array.isArray(arr)) return "noTarget";
  if (id !== null && arr.some((e) => isObj(e) && e.id === id)) return "exists";
  arr.push(structuredClone(obj));
  return "ok";
}

/** 物を外す差分を当てる（0036 の4）。外したら外した物、外す物が無ければ null */
export function removeAt(input: Obj, d: PlanDiff): unknown {
  if (isLever(d.target) || "collection" in d.target) return null;
  if (d.item === null) {
    if (!("object" in d.target || "member" in d.target)) return null;
    const at = locateObject(input, "object" in d.target ? d.target.object : d.target.member);
    if (at === null) return null;
    return at.list.splice(at.index, 1)[0] ?? null;
  }
  if (d.at === null || d.at.length === 0) return null;
  const loc = locate(input, { target: d.target, item: d.item, at: d.at }, false);
  if (loc === null || !Array.isArray(loc.holder)) return null;
  return loc.holder.splice(loc.key as number, 1)[0] ?? null;
}

/** 外す差分の今の物（作業中の世帯の）。無ければ undefined */
export function removedNow(input: Obj, d: PlanDiff): unknown {
  if (isLever(d.target) || "collection" in d.target) return undefined;
  if (d.item === null) return "object" in d.target ? findObject(input, d.target.object) : "member" in d.target ? findObject(input, d.target.member) : undefined;
  if (d.at === null) return undefined;
  return readAt(input, { target: d.target, item: d.item, at: d.at });
}

/** 値の箱の値（比べるため。箱でなければそのまま） */
export const valueOfBox = (v: unknown): unknown => unbox(v);

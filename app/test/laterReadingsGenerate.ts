// 0.17 より後に足した入力の欄の、画面の鍵 → 当て先の表（src/workspace/store/laterFields.ts）を、今の画面の欄の定義から作る
// （field-items-save.test.ts が使う。0036 の追記 2026-10-29）。0.16 の読み替え表（registry/readings.yaml。凍結）の作り方
// （readingsGenerate.ts）と同じく、見本の世帯で欄に値を書き、「世帯のどの1つの値が変わるか」を調べて行にする。
// 1つの値をそのまま書かない欄は行を作らない（合成の対策の行を readings.ts の LATER_ENTRIES に手で足すか、動かす項目に出さない）
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "../scripts/lib.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { allFields, type ActionDef, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { writeAt } from "../src/workspace/plans/diffs.ts";
import { fieldSkips } from "../src/workspace/plans/items.ts";
import { fromBody } from "../src/workspace/store/body.ts";
import { matchKey, resolveKey, unbox, type AtStep, type ReadingEntry } from "../src/workspace/store/readings.ts";

type Json = Record<string, unknown>;
type To = ReadingEntry["to"];
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
/** 動かす項目にする欄の種類（plans/items.ts の fieldItems と同じ） */
export const NUMERIC = new Set(["yen", "int", "pct", "decimal"]);

/** 動かす項目にする欄（plans/items.ts の fieldItems と同じ選び方。読み替えられるかは見ない） */
export function movableFields(wh: WorkingHousehold): FieldDef[] {
  const self = wh.request.input.household.members.find((m) => m.kind === "self")?.id ?? "";
  const skip = fieldSkips(wh, self);
  return buildStages(wh)
    .flatMap((s) => allFields(s))
    .filter((f) => NUMERIC.has(f.kind) && f.readOnly === undefined && f.structural !== true && !skip.has(f.key));
}

function actionsOf(stages: StageDef[]): ActionDef[] {
  return stages.flatMap((s) => s.sections.flatMap((sec) => [...sec.actions, ...sec.groups.flatMap((g) => g.actions)]));
}

/** 見本の世帯: 形式の見本・モデル世帯と、画面の「＋ 足す」の操作で物を足した世帯（ID は決まった並びで振る） */
export function households(): Map<string, WorkingHousehold> {
  const out = new Map<string, WorkingHousehold>();
  const fx = join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "household-format");
  for (const v of readdirSync(fx).filter((v) => /^\d+\.\d+$/.test(v)).sort()) out.set(`format-${v}`, fromBody(readFileSync(join(fx, v, "body.json"), "utf8")).wh);
  const dir = join(REPO_DIR, "data", "modelHouseholds");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) out.set(`model-${f.slice(0, -5)}`, fromRequest(JSON.parse(readFileSync(join(dir, f), "utf8")) as EngineRequest));
  let seq = 0;
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const bases: [string, WorkingHousehold][] = [["blank", blankHousehold("2026-10", id)], ...["dualAssetsTwoKids", "housingPurchase", "elderCare", "advisoryFeeProposal", "investmentCouple"].map((n): [string, WorkingHousehold] => [n, out.get(`model-${n}`) as WorkingHousehold])];
  const realId = crypto.randomUUID;
  try {
    (crypto as { randomUUID: () => string }).randomUUID = id as () => `${string}-${string}-${string}-${string}-${string}`;
    for (const [name, wh] of bases) {
      let n = 0;
      for (const a of actionsOf(buildStages(wh))) {
        if (a.danger === true || /remove|delete|clear|reset/i.test(a.key)) continue;
        let next: WorkingHousehold;
        try {
          next = a.run(wh);
        } catch {
          continue;
        }
        if (next !== wh) out.set(`added-${name}-${String(++n).padStart(3, "0")}`, next);
      }
    }
  } finally {
    (crypto as { randomUUID: typeof realId }).randomUUID = realId;
  }
  return out;
}

/** 欄の今の値から少し動かした値 */
export function bump(f: FieldDef, v: unknown): number | string {
  if (f.kind === "yen") return typeof v === "number" ? v + 12000 : 12000;
  if (f.kind === "int") {
    const n = typeof v === "number" ? v : ((f as { min?: number }).min ?? 1);
    return n + 1 <= ((f as { max?: number }).max ?? 1e9) ? n + 1 : n - 1;
  }
  const s = typeof v === "string" ? Number(v) : 0.01;
  return String(Math.round((s + 0.0125) * 10000) / 10000);
}

const itemsJson = JSON.parse(readFileSync(join(REPO_DIR, "engine", "src", "generated", "items.json"), "utf8")) as {
  collections: Record<string, string[]>;
  items: Record<string, { collection: string | null; path: string[] }>;
};
const collectionOfArray = new Map(Object.entries(itemsJson.collections).map(([c, p]) => [p.join("/"), c]));

function leaves(o: unknown, p: string[], out: Map<string, unknown>): void {
  if (Array.isArray(o)) {
    out.set([...p, "#len"].join("\u0000"), o.length);
    o.forEach((x, i) => leaves(x, [...p, String(i)], out));
  } else if (isObj(o)) for (const [k, v] of Object.entries(o)) leaves(v, [...p, k], out);
  else out.set(p.join("\u0000"), o);
}

/** 変わった値の場所（値の箱は箱の場所にまとめる。値の状態の行は writeAt が書くので数えない） */
function changedPlaces(before: Json, after: Json): string[][] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  leaves(before, [], a);
  leaves(after, [], b);
  const out = new Map<string, string[]>();
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (JSON.stringify(a.get(k)) === JSON.stringify(b.get(k))) continue;
    let path = k.split("\u0000");
    if (path.includes("valueStates")) continue;
    for (let i = path.length - 1; i > 0; i--) {
      const node = path.slice(0, i).reduce<unknown>((n, s) => (isObj(n) || Array.isArray(n) ? (n as Json)[s] : undefined), after);
      if (isObj(node) && typeof node.state === "string" && isObj(node.origin)) {
        path = path.slice(0, i);
        break;
      }
    }
    out.set(path.join("/"), path);
  }
  return [...out.values()];
}

/** 鍵の中の ID・番号を型に置き換える */
function patternOf(key: string, objectId: string | null, memberIds: ReadonlySet<string>): string {
  return key
    .replace(UUID, (u) => (u === objectId ? (memberIds.has(u) ? "{member}" : "{object}") : objectId === null && memberIds.has(u) ? "{member}" : "{id}"))
    .replace(/(?<=\/|^|:)\d+(?=\/|$|:)/g, "{n}");
}

/** 1つの値をそのまま書いた場所から、表の行を作る（作れないときは理由） */
function autoEntry(key: string, path: string[], input: Json): { from: string; to: To } | string {
  const memberIds = new Set(((input.household as Json).members as Json[]).map((m) => m.id as string));
  let target: "object" | "member" | "assumptions" | "input";
  let collection: string | null;
  let rest: string[];
  let objectId: string | null = null;
  let node: unknown;
  if (path[0] === "household") {
    const arr = path[1] as string;
    collection = collectionOfArray.get(`household/${arr}`) ?? null;
    if (collection === null) return `物の集まりが分かりません: ${arr}`;
    const obj = ((input.household as Json)[arr] as Json[])[Number(path[2])] as Json;
    objectId = obj.id as string;
    target = arr === "members" ? "member" : "object";
    rest = path.slice(3);
    node = obj;
  } else {
    collection = null;
    target = path[0] === "assumptions" ? "assumptions" : "input";
    rest = path;
    node = input;
  }
  const keyIds: string[] = key.match(UUID) ?? [];
  if (objectId !== null && !keyIds.includes(objectId)) return "物の ID が鍵にありません";
  const cands = Object.entries(itemsJson.items).filter(([, p]) => p.collection === collection && p.path.every((s, i) => rest[i] === s));
  if (cands.length === 0) return `入力項目ID がありません: ${rest.join("/")}`;
  const [item, place] = cands.sort((x, y) => y[1].path.length - x[1].path.length)[0] as [string, { path: string[] }];
  for (const s of place.path) node = isObj(node) ? node[s] : undefined;
  const otherIds = keyIds.filter((u) => u !== objectId);
  const keyNums = [...key.matchAll(/(?<=\/|^|:)(\d+)(?=\/|$|:)/g)].map((m) => Number(m[1]));
  let used = 0;
  const at: AtStep[] = [];
  for (const seg of rest.slice(place.path.length)) {
    if (Array.isArray(node)) {
      const i = Number(seg);
      const el = node[i];
      // 要素の ID が鍵にあればその ID、無ければ鍵の番号、それも無ければ決まった番号の要素
      const k = isObj(el) && typeof el.id === "string" ? otherIds.indexOf(el.id) : -1;
      if (k >= 0) at.push({ id: k + 1 });
      else if (used < keyNums.length) {
        if (keyNums[used] !== i) return `鍵の番号（${keyNums[used]}）と並びの番号（${i}）が違います`;
        used++;
        at.push({ n: used });
      } else at.push({ nth: i });
      node = el;
    } else {
      at.push(seg);
      node = isObj(node) ? node[seg] : undefined;
    }
  }
  if (used !== keyNums.length) return "鍵の番号の数が並びの数と合いません";
  return { from: patternOf(key, objectId, memberIds), to: { target, item, at } };
}

/** 値の状態の行（valueStates）を除いて同じか（欄の並びの順は問わない） */
export function sameExceptStates(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameExceptStates(x, b[i]));
  if (!isObj(a) || !isObj(b)) return false;
  const ka = Object.keys(a).filter((k) => k !== "valueStates" && a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => k !== "valueStates" && b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameExceptStates(a[k], b[k]));
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b) || (typeof a === "string" && typeof b === "string" && /^-?\d+(\.\d+)?$/.test(a) && Number(a) === Number(b));

export interface LaterResult {
  /** 作った行（型の順） */
  entries: ReadingEntry[];
  /** 行を作れなかった欄の型と理由（動かす項目に出さない） */
  unsaved: Map<string, string>;
}

/**
 * 表の行を作る。`known` は先に引く表（0.16 の読み替え表と手で足した合成の対策）で、これに合う欄は作らない。`until` は前に作った行の版を
 * 引き継ぎ、新しい行は `version`
 */
export function generateLater(known: readonly ReadingEntry[], previous: readonly ReadingEntry[], version: string): LaterResult {
  const rows = new Map<string, To>();
  const bad = new Map<string, string>();
  const checks: { name: string; key: string; input: Json; v1: unknown; after: Json }[] = [];
  const hs = households();
  for (const [name, wh] of hs) {
    const input = wh.request.input as unknown as Json;
    const memberIds = new Set(wh.request.input.household.members.map((m) => m.id));
    for (const f of movableFields(wh)) {
      const key = `field:${f.key}`;
      if (matchKey(key, known) !== null) continue;
      const fallback = patternOf(key, (key.match(UUID) ?? [])[0] ?? null, memberIds);
      const v0 = f.get(wh).value;
      const v1 = bump(f, v0);
      let after: WorkingHousehold;
      try {
        after = f.set(wh, v1);
      } catch {
        bad.set(fallback, `書けません（${name}）`);
        continue;
      }
      const ch = changedPlaces(input, after.request.input as unknown as Json);
      if (ch.length === 0) continue;
      const one = ch.length === 1 && !(ch[0] as string[]).includes("#len") ? (ch[0] as string[]) : null;
      const stored = one === null ? undefined : unbox(one.reduce<unknown>((n, s) => (isObj(n) || Array.isArray(n) ? (n as Json)[s] : undefined), after.request.input));
      if (one === null || !sameValue(stored, v1)) {
        bad.set(fallback, `1つの値をそのまま書きません（${ch.length}か所。${name}）`);
        continue;
      }
      const auto = autoEntry(key, one, input);
      if (typeof auto === "string") {
        bad.set(fallback, `${auto}（${name}）`);
        continue;
      }
      const prev = rows.get(auto.from);
      if (prev !== undefined && JSON.stringify(prev) !== JSON.stringify(auto.to)) bad.set(auto.from, `世帯で行が違います（${name}）`);
      else rows.set(auto.from, auto.to);
      checks.push({ name, key, input, v1, after: after.request.input as unknown as Json });
    }
  }
  // 1つの世帯でも1つの値をそのまま書かなかった型は、行を作らない
  for (const p of bad.keys()) rows.delete(p);
  const until = new Map(previous.map((e) => [e.from, e.until]));
  const entries: ReadingEntry[] = [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([from, to]) => ({ from, until: until.get(from) ?? version, to }));
  // 行で当て先に書くと、欄に書いたのと同じ世帯になること（値の状態の行は比べない: 欄は、書いた値を含む並び全体の推定の行〔標準の
  // 進路の型など〕も外すことがあるが、当て先に書く差分は当て先の行だけを書く。0.16 の欄の行と同じ）
  for (const c of checks) {
    const r = resolveKey(c.key, c.input, [...known, ...entries]);
    const m = matchKey(c.key, entries);
    if (m === null) continue;
    if (r === null || r.kind !== "address") {
      bad.set(m.entry.from, `表で読めません（${c.name}）`);
      continue;
    }
    const w = structuredClone(c.input);
    if (!writeAt(w, r.address, { value: c.v1, state: "confirmed", origin: { kind: "manual" } }) || !sameExceptStates(w, c.after)) bad.set(m.entry.from, `当て先に書くと欄に書いたのと違います（${c.name}）`);
  }
  return { entries: entries.filter((e) => !bad.has(e.from)), unsaved: bad };
}

// 読み替え表（0035 の9・0036 の5）: 世帯ファイルの形式 0.16 までに保存された鍵を、当て先（向き先＋入力項目ID＋場所。0036 の2）か
// 合成の対策（0036 の3）に読み替える。読み替える鍵は3つ:
// - 差分の鍵と対策に足した項目（`field:<欄のキー>`・`lever:retireAge` などの動かす項目のキー）
// - 仮の印（household.assumed）の欄のキー（`assumed:` の型で引き、無ければ `field:` の型で引く）
// 表は registry/readings.yaml の1か所（prepare-assets が src/generated/readings.ts にする）。本体の 0.16 → 0.17 の変換の段も
// 同じ表と同じ決まりで読み、凍結した見本（crates/household-store/tests/fixtures/readings/0.16/）で同じ結果になることを確かめる。
// 0.16 の世帯のデータには、並びの要素の ID が無い。ID の無い要素は、変換の段が振るのと同じ決まった ID（migrationId）で指す
import { ITEM_PLACES, READING_ENTRIES } from "../../generated/readings.ts";

/** 向き先（0036 の2。足す先の物の集まり・合成の対策は読み替えでは作らない） */
export type Target = { object: string } | { member: string } | { plan: "assumptions" | "input" | "contingency" };

/** 当て先（0036 の2） */
export interface Address {
  target: Target;
  item: string;
  at: string[];
}

export type Reading =
  | { kind: "address"; address: Address; method?: string }
  | { kind: "lever"; lever: string; object?: string; member?: string }
  | { kind: "unresolved"; reason: string };

/**
 * 表の場所の1段: 欄の名前（文字）、並びの要素（`{n: k}` は鍵の k 番目の番号、`{nth: i}` は決まった番号 i、`{id: k}` は鍵の k 番目の
 * `{id}`、`{where: {...}}` は欄の値が合う最初の要素）
 */
export type AtStep = string | { n: number } | { nth: number } | { id: number } | { where: Record<string, string> };

export interface ReadingEntry {
  /** 古い鍵の型。`{object}`・`{member}`・`{id}` は ID、`{n}` は並びの番号の入る所 */
  from: string;
  /** その鍵を世帯ファイルに書いた最後の形式の版 */
  until: string;
  to:
    | { target: "object" | "member" | "assumptions" | "input"; find?: "currentPeriod"; item: string; at: AtStep[]; method?: string }
    | { lever: string; object?: boolean; member?: boolean; element?: { target: "object" | "assumptions"; item: string; at: AtStep[] } }
    | { unresolved: string };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// ---- 決まった ID（0035 の10 の1） ----

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256（同期。決まった ID を作るためだけに使う） */
export function sha256(bytes: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(total - 4, bits >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const S1 = (((e as number) >>> 6) | ((e as number) << 26)) ^ (((e as number) >>> 11) | ((e as number) << 21)) ^ (((e as number) >>> 25) | ((e as number) << 7));
      const ch = ((e as number) & (f as number)) ^ (~(e as number) & (g as number));
      const t1 = ((hh as number) + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = (((a as number) >>> 2) | ((a as number) << 30)) ^ (((a as number) >>> 13) | ((a as number) << 19)) ^ (((a as number) >>> 22) | ((a as number) << 10));
      const mj = ((a as number) & (b as number)) ^ ((a as number) & (c as number)) ^ ((b as number) & (c as number));
      const t2 = (S0 + mj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = ((d as number) + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] as number) + (a as number)) >>> 0;
    h[1] = ((h[1] as number) + (b as number)) >>> 0;
    h[2] = ((h[2] as number) + (c as number)) >>> 0;
    h[3] = ((h[3] as number) + (d as number)) >>> 0;
    h[4] = ((h[4] as number) + (e as number)) >>> 0;
    h[5] = ((h[5] as number) + (f as number)) >>> 0;
    h[6] = ((h[6] as number) + (g as number)) >>> 0;
    h[7] = ((h[7] as number) + (hh as number)) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i] as number);
  return out;
}

/**
 * 0.17 の変換の段が古い要素に振る ID（0035 の10 の1）: 文字列 `lifeplan.migrate.0.17:<場所>` の SHA-256 の先頭16バイトに、
 * UUID 第4版の版と変種のビットを立て、小文字・ハイフンつきの36文字にする。場所は `<親の物の ID>/<親から並びまでの欄の名前>/<番号>`
 */
export function migrationId(place: string): string {
  const d = sha256(new TextEncoder().encode(`lifeplan.migrate.0.17:${place}`)).slice(0, 16);
  d[6] = ((d[6] as number) & 0x0f) | 0x40;
  d[8] = ((d[8] as number) & 0x3f) | 0x80;
  const hex = [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---- 世帯のデータの中を歩く ----

/** 世帯の物の集まりから ID で物を探す（ID は世帯ファイルの中で一意。0004 の4） */
export function findObject(input: Obj, id: string): Obj | undefined {
  const h = input.household;
  if (!isObj(h)) return undefined;
  for (const v of Object.values(h)) if (Array.isArray(v)) for (const x of v) if (isObj(x) && x.id === id) return x;
  return undefined;
}

/** 物の中を歩く位置: 今の値と、決まった ID を作るときの親（ID を持ついちばん近い物か `assumptions`）と、そこからの欄の名前 */
interface Cursor {
  node: unknown;
  parent: string;
  segs: string[];
}

const placeOf = (c: Cursor, index: number) => [c.parent, ...c.segs, String(index)].join("/");

/** 並びの要素へ進む（要素が ID を持てばそれ、無ければ決まった ID） */
function enterElement(c: Cursor, index: number): { cur: Cursor; id: string } {
  const arr = Array.isArray(c.node) ? c.node : [];
  const el = arr[index];
  const own = isObj(el) && typeof el.id === "string" ? el.id : null;
  const id = own ?? migrationId(placeOf(c, index));
  return { id, cur: own !== null ? { node: el, parent: own, segs: [] } : { node: el, parent: c.parent, segs: [...c.segs, String(index)] } };
}

function startCursor(input: Obj, target: Target, item: string): Cursor | null {
  const place = ITEM_PLACES[item];
  if (place === undefined) return null;
  if ("plan" in target) {
    if (target.plan === "contingency") return null;
    const [head, ...rest] = place.path;
    // 前提の列の親は `assumptions`（0035 の10 の1）
    const node = place.path.reduce<unknown>((n, k) => (isObj(n) ? n[k] : undefined), input);
    return head === "assumptions" ? { node, parent: "assumptions", segs: rest } : { node, parent: "input", segs: [...place.path] };
  }
  const id = "object" in target ? target.object : target.member;
  const obj = findObject(input, id);
  const node = place.path.reduce<unknown>((n, k) => (isObj(n) ? n[k] : undefined), obj);
  return { node, parent: id, segs: [...place.path] };
}

/** 当て先の値（値の箱ならその箱）。無ければ undefined */
export function readAt(input: Obj, a: Address): unknown {
  let c = startCursor(input, a.target, a.item);
  if (c === null) return undefined;
  for (const step of a.at) {
    if (Array.isArray(c.node)) {
      const arr = c.node;
      let found: Cursor | null = null;
      for (let i = 0; i < arr.length; i++) {
        const e = enterElement(c, i);
        if (e.id === step) {
          found = e.cur;
          break;
        }
      }
      if (found === null) return undefined;
      c = found;
    } else c = { node: isObj(c.node) ? c.node[step] : undefined, parent: c.parent, segs: [...c.segs, step] };
  }
  return c.node;
}

/** 値の箱の値（わからないは代わりの値）。箱でなければそのまま */
export function unbox(v: unknown): unknown {
  if (isObj(v) && typeof v.state === "string" && isObj(v.origin)) {
    if (v.state === "unknown") return isObj(v.substitute) ? v.substitute.value : undefined;
    return v.value;
  }
  return v;
}

// ---- 今の働き方の期間（表の find: currentPeriod） ----

/** 計算基準月にしている働き方の期間。無ければ次に始まる期間、それも無ければ最後の期間（0.16 の画面と同じ決まり） */
export function currentPeriodId(input: Obj, member: string): string | null {
  const h = isObj(input.household) ? input.household : {};
  const base = typeof input.baseMonth === "string" ? input.baseMonth : "";
  const fromAt = (p: Obj) => (isObj(p.from) && typeof p.from.at === "string" ? p.from.at : "");
  const toAt = (p: Obj) => (p.to === null ? null : isObj(p.to) && typeof p.to.at === "string" ? p.to.at : "9999-12");
  const ps = (Array.isArray(h.employmentPeriods) ? h.employmentPeriods : [])
    .filter((p): p is Obj => isObj(p) && p.member === member)
    .map((p, i) => ({ p, i }))
    .sort((x, y) => (fromAt(x.p) < fromAt(y.p) ? -1 : fromAt(x.p) > fromAt(y.p) ? 1 : x.i - y.i))
    .map((x) => x.p);
  const cur = ps.find((p) => fromAt(p) <= base && (toAt(p) === null || (toAt(p) as string) >= base)) ?? ps.find((p) => fromAt(p) > base) ?? ps.at(-1);
  return cur !== undefined && typeof cur.id === "string" ? cur.id : null;
}

// ---- 鍵を読む ----

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

interface Compiled {
  entry: ReadingEntry;
  re: RegExp;
  slots: ("object" | "member" | "id" | "n")[];
}

const compiledTables = new WeakMap<readonly ReadingEntry[], Compiled[]>();
function table(entries: readonly ReadingEntry[]): Compiled[] {
  const done = compiledTables.get(entries);
  if (done !== undefined) return done;
  const compiled = entries.map((entry) => {
    const slots: Compiled["slots"] = [];
    const src = entry.from.replace(/\{(object|member|id|n)\}|[.*+?^$()|[\]\\]/g, (m, name: string | undefined) => {
      if (name === undefined) return `\\${m}`;
      slots.push(name as Compiled["slots"][number]);
      return name === "n" ? "(\\d+)" : `(${UUID})`;
    });
    return { entry, re: new RegExp(`^${src}$`), slots };
  });
  compiledTables.set(entries, compiled);
  return compiled;
}

/** 鍵に合う表の行と、入っている ID・番号 */
export function matchKey(key: string, entries: readonly ReadingEntry[] = READING_ENTRIES): { entry: ReadingEntry; object?: string; member?: string; ids: string[]; ns: number[] } | null {
  for (const c of table(entries)) {
    const m = c.re.exec(key);
    if (m === null) continue;
    const out: { entry: ReadingEntry; object?: string; member?: string; ids: string[]; ns: number[] } = { entry: c.entry, ids: [], ns: [] };
    c.slots.forEach((s, i) => {
      const v = m[i + 1] as string;
      if (s === "object") out.object = v;
      else if (s === "member") out.member = v;
      else if (s === "id") out.ids.push(v);
      else out.ns.push(Number(v));
    });
    return out;
  }
  return null;
}

/** 古い鍵を読み替える（表に無い鍵は null）。input は 0.16 の世帯の要求の `input` */
export function resolveKey(key: string, input: Obj, entries: readonly ReadingEntry[] = READING_ENTRIES): Reading | null {
  const m = matchKey(key, entries);
  if (m === null) return null;
  const to = m.entry.to;
  if ("unresolved" in to) return { kind: "unresolved", reason: to.unresolved };
  if ("lever" in to) {
    // 並びの要素を動かす対策は、その要素の ID を物として持つ
    if (to.element !== undefined) {
      const el = resolveKey(key, input, [{ from: m.entry.from, until: m.entry.until, to: { target: to.element.target, item: to.element.item, at: to.element.at } }]);
      if (el === null || el.kind !== "address") return el ?? null;
      const last = el.address.at.at(-1);
      return last === undefined ? null : { kind: "lever", lever: to.lever, object: last };
    }
    return { kind: "lever", lever: to.lever, ...(to.object === true && m.object !== undefined ? { object: m.object } : {}), ...(to.member === true && m.member !== undefined ? { member: m.member } : {}) };
  }
  let target: Target;
  if (to.target === "assumptions" || to.target === "input") target = { plan: to.target };
  else if (to.find === "currentPeriod") {
    const id = m.member === undefined ? null : currentPeriodId(input, m.member);
    if (id === null) return { kind: "unresolved", reason: "今の働き方の期間がありません" };
    target = { object: id };
  } else if (to.target === "member") {
    if (m.member === undefined) return null;
    target = { member: m.member };
  } else {
    if (m.object === undefined) return null;
    target = { object: m.object };
  }
  let c = startCursor(input, target, to.item);
  if (c === null) return { kind: "unresolved", reason: `入力項目 ${to.item} の場所がありません` };
  const at: string[] = [];
  for (const step of to.at) {
    if (typeof step === "string") {
      at.push(step);
      c = { node: isObj(c.node) ? c.node[step] : undefined, parent: c.parent, segs: [...c.segs, step] };
      continue;
    }
    let index: number;
    if ("n" in step) index = m.ns[step.n - 1] ?? -1;
    else if ("nth" in step) index = step.nth;
    else if ("id" in step) {
      const want = m.ids[step.id - 1];
      const arr = Array.isArray(c.node) ? c.node : [];
      index = arr.findIndex((e) => isObj(e) && e.id === want);
      if (index < 0) {
        // 要素が無くなっていても、鍵の ID のまま当て先にする（当てるときに要確認になる。0036 の7）
        at.push(want as string);
        c = { node: undefined, parent: want as string, segs: [] };
        continue;
      }
    } else {
      const arr = Array.isArray(c.node) ? c.node : [];
      index = arr.findIndex((e) => isObj(e) && Object.entries(step.where).every(([k, v]) => e[k] === v));
      if (index < 0) return { kind: "unresolved", reason: `当てはまる要素がありません（${Object.entries(step.where).map(([k, v]) => `${k}=${v}`).join("・")}）` };
    }
    if (index < 0) return null;
    const e = enterElement(c, index);
    at.push(e.id);
    c = e.cur;
  }
  return { kind: "address", address: { target, item: to.item, at }, ...(to.method !== undefined ? { method: to.method } : {}) };
}

/** 仮の印の欄のキーを読み替える（`assumed:` の型を先に〔推定の出し方を持つ〕、無ければ `field:` の型） */
export function resolveAssumedKey(key: string, input: Obj, entries: readonly ReadingEntry[] = READING_ENTRIES): Reading | null {
  return resolveKey(`assumed:${key}`, input, entries) ?? resolveKey(`field:${key}`, input, entries);
}

// ---- 当て先から鍵へ戻す（0.17 の形の世帯ファイルを、入力画面を作り直すまでの画面の鍵で読むため） ----

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/** 表の行の `from` に ID・番号を入れて鍵にする（入れる値が足りなければ null） */
function fill(from: string, v: { object?: string; member?: string; ids: string[]; ns: number[] }): string | null {
  let ok = true;
  let i = 0;
  let j = 0;
  const out = from.replace(/\{(object|member|id|n)\}/g, (_m, name: string) => {
    const x = name === "object" ? v.object : name === "member" ? v.member : name === "id" ? v.ids[i++] : v.ns[j++] === undefined ? undefined : String(v.ns[j - 1]);
    if (x === undefined) ok = false;
    return x ?? "";
  });
  return ok ? out : null;
}

/** 当て先の場所の要素の ID から、表の場所の段の値（番号・ID）を集める。合わなければ null */
function matchSteps(input: Obj, target: Target, item: string, steps: readonly AtStep[], at: readonly string[]): { ids: string[]; ns: number[] } | null {
  if (steps.length !== at.length) return null;
  let c = startCursor(input, target, item);
  if (c === null) return null;
  const ids: string[] = [];
  const ns: number[] = [];
  for (let k = 0; k < steps.length; k++) {
    const step = steps[k] as AtStep;
    const want = at[k] as string;
    if (typeof step === "string") {
      if (step !== want) return null;
      c = { node: isObj(c.node) ? c.node[step] : undefined, parent: c.parent, segs: [...c.segs, step] };
      continue;
    }
    const arr = Array.isArray(c.node) ? c.node : [];
    let index = -1;
    let cur: Cursor | null = null;
    for (let i = 0; i < arr.length; i++) {
      const e = enterElement(c, i);
      if (e.id === want) {
        index = i;
        cur = e.cur;
        break;
      }
    }
    if ("id" in step) {
      ids[step.id - 1] = want;
      c = cur ?? { node: undefined, parent: want, segs: [] };
      continue;
    }
    if (index < 0 || cur === null) return null;
    if ("n" in step) ns[step.n - 1] = index;
    else if ("nth" in step && step.nth !== index) return null;
    c = cur;
  }
  return { ids, ns };
}

/**
 * 当て先・合成の対策を、0.16 の画面の鍵に戻す。`kind` が "assumed" なら仮の印の欄のキー（前置きなし）、"item" なら差分の key・対策に
 * 足した項目の鍵。戻した鍵を表で読み直して同じになるものだけを返す（同じ当て先になる鍵が複数あれば、探す決まりの順で最初のもの:
 * 合成の対策は欄でない鍵を先に、当て先は働き方の期間を探さない鍵を先に）
 */
export function keyOf(reading: Reading, input: Obj, kind: "item" | "assumed" = "item", entries: readonly ReadingEntry[] = READING_ENTRIES): string | null {
  if (reading.kind === "unresolved") return null;
  const rank = (e: ReadingEntry): number => {
    if (kind === "assumed") return e.from.startsWith("assumed:") ? 0 : e.from.startsWith("field:") ? 1 : 9;
    if (e.from.startsWith("assumed:")) return 9;
    if ("lever" in e.to) return e.from.startsWith("field:") ? 1 : 0;
    return "find" in e.to && e.to.find !== undefined ? 1 : 0;
  };
  const order = [...entries].filter((e) => rank(e) < 9).sort((a, b) => rank(a) - rank(b));
  for (const e of order) {
    const to = e.to;
    let candidate: string | null;
    if (reading.kind === "lever") {
      if (!("lever" in to) || to.lever !== reading.lever) continue;
      if (to.element !== undefined) {
        if (reading.object === undefined) continue;
        const target: Target = to.element.target === "assumptions" ? { plan: "assumptions" } : { object: reading.object };
        const at = to.element.at.map((s) => (typeof s === "string" ? s : reading.object as string));
        const got = matchSteps(input, target, to.element.item, to.element.at, at);
        if (got === null) continue;
        candidate = fill(e.from, { ...got });
      } else candidate = fill(e.from, { ...(reading.object !== undefined ? { object: reading.object } : {}), ...(reading.member !== undefined ? { member: reading.member } : {}), ids: [], ns: [] });
    } else {
      if (!("item" in to) || to.item !== reading.address.item) continue;
      const t = reading.address.target;
      const v: { object?: string; member?: string } = {};
      if (to.target === "assumptions" || to.target === "input") {
        if (!("plan" in t) || t.plan !== to.target) continue;
      } else if (to.find === "currentPeriod") {
        if (!("object" in t)) continue;
        const period = findObject(input, t.object);
        const member = period !== undefined && typeof period.member === "string" ? period.member : undefined;
        if (member === undefined || currentPeriodId(input, member) !== t.object) continue;
        v.member = member;
      } else if (to.target === "member") {
        if (!("member" in t)) continue;
        v.member = t.member;
      } else {
        if (!("object" in t)) continue;
        v.object = t.object;
      }
      const got = matchSteps(input, t, to.item, to.at, reading.address.at);
      if (got === null) continue;
      candidate = fill(e.from, { ...v, ...got });
    }
    if (candidate === null) continue;
    const back = resolveKey(candidate, input, entries);
    // 合成の対策は、表の行が持たせる物（object・member・element）だけを比べる（ほかに書いてある物は、画面の差分の向き先の控え）
    const strip = (r: Reading | null): unknown => {
      if (r === null) return null;
      if (r.kind === "address") return { kind: r.kind, address: r.address };
      if (r.kind !== "lever" || !("lever" in to)) return r;
      const keepObject = to.object === true || to.element !== undefined;
      return { lever: r.lever, ...(keepObject ? { object: r.object } : {}), ...(to.member === true ? { member: r.member } : {}) };
    };
    if (back !== null && sameJson(strip(back), strip(reading))) {
      if (kind === "assumed") return candidate.replace(/^(assumed|field):/, "");
      return candidate;
    }
  }
  return null;
}

// 世帯ファイルの形式 0.17（0035・0036）と、画面の中の形の読み替え。
// 入力画面を作り直す（欄の定義が当て先を持ち、差分を当て先で作る）までは、画面の中では 0.16 と同じ形を使う:
// - プランの差分は世帯ファイルと同じ当て先の形（0036 の4）で持つ（plans/plans.ts・diffs.ts）。直さない
// - 仮の印は欄のキーで持つ（household.assumed）
// - 贈与者は donors で持つ
// 世帯ファイルとの読み書きの所（body.ts の fromBody・bodyObject）で、次のように直す（どれも読み替え表 registry/readings.yaml で）:
// - 差分: 動かす項目のキー（key）で持つ古い形の差分（形式 0.16 の画面の中の形）が来たら、当て先・合成の対策に直す（0036 の4）
// - 仮の印 ⇄ 物の値の状態の欄（valueStates の推定の行。0035 の3）
// - 贈与者 ⇄ 世帯の外の家族の構成員（生年月・性別なし。0035 の4）
// - 対策に足した項目: 鍵 ⇄ 当て先
// - 保存するときに、ID の無い並びの要素に ID を振る（0035 の5。場所から決まった ID で、保存のたびに同じになる）
import { giveElementIds } from "./elementIds.ts";
import { findObject, keyOf, keysOf, readAt, resolveKey, type Address, type Reading, type Target } from "./readings.ts";

export { giveElementIds } from "./elementIds.ts";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** 世帯ファイルに書くプランの差分（0036 の4） */
export interface StoredDiff {
  id: string;
  op: "set" | "add" | "remove";
  target: Json;
  item: string | null;
  at: string[] | null;
  value: unknown;
  before: unknown;
  enabled: boolean;
  origin: unknown;
  approval?: unknown;
  note: string | null;
  /** 0.16 から読み替えた差分の、もとの手がかり */
  legacy?: { key: string; target: unknown; item: unknown };
  /** 読み替えられなかった差分（当てない。0036 の5） */
  unresolved?: true;
  [k: string]: unknown;
}

// ---- 値の状態の欄 ⇄ 仮の印 ----

const isBox = (v: unknown): boolean => isObj(v) && typeof v.state === "string" && isObj(v.origin);
const stateKey = (a: Address): string => (a.at.length === 0 ? a.item : `${a.item}/${a.at.join("/")}`);

/** 値の状態の欄を持てる物（世帯の物の集まりの1件）と、要求の入力 */
function holders(input: Json): { holder: Json; target: (item: string) => Target }[] {
  const out: { holder: Json; target: (item: string) => Target }[] = [{ holder: input, target: (item) => ({ plan: item.startsWith("assumptions.") ? "assumptions" : "input" }) }];
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

/** 値の状態の欄の推定（出どころ auto）の行を、仮の印に戻す。戻した行は物から外す（保存するときに仮の印から作り直す） */
function statesToAssumed(input: Json, assumed: Record<string, string>): void {
  for (const { holder, target } of holders(input)) {
    const states = holder.valueStates;
    if (!isObj(states)) continue;
    for (const [k, row] of Object.entries(states)) {
      if (!isObj(row) || row.state !== "estimated" || !isObj(row.origin) || row.origin.kind !== "auto" || !isObj(row.estimate)) continue;
      const [item, ...at] = k.split("/");
      const address: Address = { target: target(item as string), item: item as string, at };
      const key = keyOf({ kind: "address", address }, input, "assumed");
      if (key === null) continue;
      // 仮の印から作り直すと同じ行になるものだけを戻す（ほかの出し方・確かさなどを持つ行は、そのまま持つ）
      const again = resolveKeyAssumed(key, input);
      const method = again !== null && again.kind === "address" ? (again.method ?? "standard") : null;
      const plain = Object.keys(row).every((x) => x === "state" || x === "origin" || x === "estimate") && Object.keys(row.origin).length === 1;
      if (!plain || row.estimate.method !== method || typeof row.estimate.basis !== "string") continue;
      assumed[key] = row.estimate.basis;
      delete states[k];
    }
    if (Object.keys(states).length === 0) delete holder.valueStates;
  }
}

/** 仮の印を、当て先の物の値の状態の欄の推定の行にする。当て先が値の箱なら書かない（箱の状態が正）。読み替えられない印は残す */
function assumedToStates(input: Json, assumed: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [k, basis] of Object.entries(assumed)) {
    const r = resolveKeyAssumed(k, input);
    if (r === null || r.kind !== "address") {
      kept[k] = basis;
      continue;
    }
    const cur = readAt(input, r.address);
    // 値の無い場所（無くなった要素・まだ入れていない欄）には行を書かない。値の箱を持つ値は、箱の状態が正
    if (cur === undefined || cur === null || isBox(cur)) continue;
    const t = r.address.target;
    const holder = "plan" in t ? input : findObject(input, "object" in t ? t.object : t.member);
    if (holder === undefined) {
      kept[k] = basis;
      continue;
    }
    const states = (isObj(holder.valueStates) ? holder.valueStates : (holder.valueStates = {})) as Json;
    states[stateKey(r.address)] = { state: "estimated", origin: { kind: "auto" }, estimate: { method: r.method ?? "standard", basis: basis === "" ? "仮の値" : basis } };
  }
  return kept;
}

function resolveKeyAssumed(key: string, input: Json): Reading | null {
  return resolveKey(`assumed:${key}`, input) ?? resolveKey(`field:${key}`, input);
}

// ---- 贈与者 ⇄ 世帯の外の家族 ----

/**
 * 本文の中で、贈与者に戻した世帯の外の家族の元の構成員を持ち運ぶ欄（画面の中だけ。保存するときに戻して消す）。贈与者の形
 * （ID・種類・誰の家族か）に入らない欄（性別・期間・勤め先の健康保険・値の状態など）を失わないため
 */
export const OUTSIDE_KEPT = "outsideKept";

const donorKind = (k: unknown): string => (k === "parent" || k === "grandparent" ? k : "other");

/** 生年月の無い世帯の外の家族を、画面の中の贈与者（donors）に戻す。戻り値は元の構成員（ID → 構成員） */
function outsideToDonors(input: Json): Record<string, Json> {
  const kept: Record<string, Json> = {};
  const h = input.household;
  if (!isObj(h) || !Array.isArray(h.members)) return kept;
  const donors: Json[] = Array.isArray(h.donors) ? [...(h.donors as Json[])] : [];
  const members: unknown[] = [];
  for (const m of h.members as unknown[]) {
    if (isObj(m) && isObj(m.outside) && m.birth === undefined && typeof m.id === "string") {
      const of = m.outside.of;
      donors.push({ id: m.id, kind: donorKind(m.kind), ...(typeof of === "string" ? { of } : {}) });
      kept[m.id] = structuredClone(m);
    } else members.push(m);
  }
  if (donors.length === 0) return kept;
  h.members = members;
  h.donors = donors;
  return kept;
}

/** 画面の中の贈与者を、世帯の外の家族の構成員（生年月・性別なし）にする。元の構成員があれば、それに贈与者の種類・誰の家族かを当てる */
function donorsToOutside(input: Json, kept: Record<string, unknown>): void {
  const h = input.household;
  if (!isObj(h) || !Array.isArray(h.donors)) return;
  const members = Array.isArray(h.members) ? (h.members as unknown[]) : [];
  for (const d of h.donors as unknown[]) {
    if (!isObj(d)) continue;
    const before = typeof d.id === "string" ? kept[d.id] : undefined;
    if (isObj(before) && isObj(before.outside)) {
      const m = structuredClone(before);
      if (donorKind(m.kind) !== d.kind) m.kind = d.kind;
      const outside = m.outside as Json;
      if (typeof d.of === "string") outside.of = d.of;
      else delete outside.of;
      members.push(m);
      continue;
    }
    members.push({ id: d.id, kind: d.kind, joins: null, leaves: null, expected: false, outside: { ...(typeof d.of === "string" ? { of: d.of } : {}), periods: [] } });
  }
  h.members = members;
  delete h.donors;
}

/**
 * 世帯の外の家族の印が無い親・祖父母（印を付ける前の画面で足した人など）に、保存するとき世帯の外の家族の印を付ける（0035 の4。
 * 変換の段と同じ決まり: 誰の家族かは、親とする関係の子のうち世帯の中にいる人、無ければ本人）。家族のカードで足すときは、足すときに付ける
 */
function markOutsideFamily(input: Json): void {
  const h = input.household;
  if (!isObj(h) || !Array.isArray(h.members)) return;
  const members = h.members.filter(isObj);
  const rels = Array.isArray(h.relations) ? h.relations.filter(isObj) : [];
  const converts = (m: Json) => (m.kind === "parent" || m.kind === "grandparent") && m.outside === undefined;
  const inside = new Set(members.filter((m) => !converts(m) && m.outside === undefined).map((m) => m.id));
  const self = members.find((m) => m.kind === "self")?.id;
  for (const m of members) {
    if (!converts(m)) continue;
    const child = rels.find((r) => r.type === "parentOf" && r.parent === m.id && inside.has(r.child))?.child;
    const of = typeof child === "string" ? child : typeof self === "string" ? self : undefined;
    m.outside = { ...(of !== undefined ? { of } : {}), periods: [] };
  }
}

// ---- 差分・対策に足した項目 ⇄ 鍵 ----

function readingOfStored(s: { target: Json; item: string | null; at: string[] | null }): Reading | null {
  const t = s.target;
  if (typeof t.lever === "string") return { kind: "lever", lever: t.lever, ...(typeof t.object === "string" ? { object: t.object } : {}), ...(typeof t.member === "string" ? { member: t.member } : {}) };
  if (s.item === null || s.at === null) return null;
  return { kind: "address", address: { target: t as unknown as Target, item: s.item, at: s.at } };
}

/** 当て先の形にする。合成の対策が物を持たないときは、画面の差分の向き先（その対策が動かす物・構成員）を書いておく（読み戻すときに使う） */
function storedTarget(r: Reading, item: string | null, memory?: Json): { target: Json; item: string | null; at: string[] } | null {
  if (r.kind === "address") return { target: r.address.target as unknown as Json, item: r.address.item, at: r.address.at };
  if (r.kind === "lever") {
    const own = r.object !== undefined || r.member !== undefined;
    const extra = !own && memory !== undefined && !("plan" in memory) ? memory : {};
    return { target: { lever: r.lever, ...(r.object !== undefined ? { object: r.object } : {}), ...(r.member !== undefined ? { member: r.member } : {}), ...extra }, item, at: [] };
  }
  return null;
}

/** 動かす項目のキーで持つ古い形の差分（画面の中の形 0.16） */
interface KeyedDiff {
  id: string;
  key: string;
  target: Json;
  item: string;
  value: unknown;
  before: unknown;
  enabled: boolean;
  origin: unknown;
  approval?: unknown;
  note: string | null;
  legacy?: { key: string; target: unknown; item: unknown };
}

/** 古い形の差分を、当て先・合成の対策の形にする（表に無い鍵は、読み替えられなかった差分として残す。0036 の5） */
function fromKeyed(d: KeyedDiff, input: Json): StoredDiff {
  const base = {
    id: d.id,
    op: "set" as const,
    value: d.value,
    before: d.before,
    enabled: d.enabled,
    origin: d.origin,
    ...(d.approval !== undefined ? { approval: d.approval } : {}),
    note: d.note,
    ...(d.legacy !== undefined ? { legacy: d.legacy } : {}),
  };
  const r = resolveKey(d.key, input);
  const t = r === null ? null : storedTarget(r, d.item, d.target);
  if (t !== null) return { ...base, ...t };
  return { ...base, target: d.target, item: d.item, at: null, unresolved: true, legacy: d.legacy ?? { key: d.key, target: d.target, item: d.item } };
}

const keyedToStored = (d: unknown, input: Json): unknown => (isObj(d) && typeof d.key === "string" ? fromKeyed(d as unknown as KeyedDiff, input) : d);

// ---- 本文の全体 ----

/** 世帯ファイルの本文（0.17）を、画面の中の形に（読むとき。古い版の形の本文もそのまま読める） */
export function fromStoredBody(body: Json): Json {
  const b = structuredClone(body);
  const h = isObj(b.household) ? b.household : null;
  const input = h !== null && isObj(h.request) && isObj(h.request.input) ? h.request.input : null;
  if (h === null || input === null) return b;
  const assumed: Record<string, string> = isObj(h.assumed) ? (h.assumed as Record<string, string>) : {};
  statesToAssumed(input, assumed);
  if (Object.keys(assumed).length > 0) h.assumed = assumed;
  if (Array.isArray(b.proposals)) {
    for (const p of b.proposals) {
      if (!isObj(p) || !Array.isArray(p.diffs)) continue;
      p.diffs = p.diffs.map((d) => keyedToStored(d, input));
    }
  }
  if (isObj(b.workspace) && Array.isArray(b.workspace.shownItems)) {
    b.workspace.shownItems = b.workspace.shownItems.flatMap((x) => {
      if (typeof x === "string") return [x];
      if (!isObj(x) || !isObj(x.target)) return [];
      const r = readingOfStored({ target: x.target, item: typeof x.item === "string" ? x.item : null, at: Array.isArray(x.at) ? (x.at as string[]) : null });
      // 同じ当て先に戻る鍵が複数あれば、どれも残す（結果のタブは動かす項目の一覧にある鍵だけを出す。保存では同じ当て先にまとまる）
      return r === null ? [] : keysOf(r, input);
    });
    b.workspace.shownItems = [...new Set(b.workspace.shownItems as string[])];
  }
  const kept = outsideToDonors(input);
  if (Object.keys(kept).length > 0) b[OUTSIDE_KEPT] = kept;
  return b;
}

/** 画面の中の形の本文を、世帯ファイルの本文（0.17）に（保存するとき） */
export function toStoredBody(body: Json): Json {
  const b = structuredClone(body);
  const h = isObj(b.household) ? b.household : null;
  const input = h !== null && isObj(h.request) && isObj(h.request.input) ? h.request.input : null;
  if (h === null || input === null) return b;
  giveElementIds(input);
  if (Array.isArray(b.proposals)) {
    for (const p of b.proposals) {
      if (!isObj(p) || !Array.isArray(p.diffs)) continue;
      p.diffs = p.diffs.map((d) => keyedToStored(d, input));
    }
  }
  if (isObj(b.workspace) && Array.isArray(b.workspace.shownItems)) {
    const seen = new Set<string>();
    b.workspace.shownItems = b.workspace.shownItems.flatMap((k) => {
      if (typeof k !== "string") return isObj(k) ? [k] : [];
      const r = resolveKey(k, input);
      const t = r === null ? null : storedTarget(r, null);
      if (t === null || seen.has(JSON.stringify(t))) return [];
      seen.add(JSON.stringify(t));
      return [t];
    });
  }
  if (isObj(h.assumed)) {
    const kept = assumedToStates(input, h.assumed as Record<string, string>);
    if (Object.keys(kept).length > 0) h.assumed = kept;
    else delete h.assumed;
  }
  markOutsideFamily(input);
  donorsToOutside(input, isObj(b[OUTSIDE_KEPT]) ? (b[OUTSIDE_KEPT] as Record<string, unknown>) : {});
  delete b[OUTSIDE_KEPT];
  return b;
}

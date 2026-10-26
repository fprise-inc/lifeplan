// 世帯ファイルの形式 0.17（0035・0036）と、画面の中の形の読み替え。
// 入力画面を作り直す（欄の定義が当て先を持ち、差分を当て先で作る）までは、画面の中では 0.16 と同じ形を使う:
// - プランの差分は動かす項目のキー（key）で持ち、動かす項目の一覧で当てる（plans/plans.ts）
// - 仮の印は欄のキーで持つ（household.assumed）
// - 贈与者は donors で持つ
// 世帯ファイルとの読み書きの所（body.ts の fromBody・bodyObject）で、次のように直す（どれも読み替え表 registry/readings.yaml で）:
// - 差分: 鍵 ⇄ 当て先・合成の対策（0036 の4）。鍵に戻せない差分は、読んだ形のまま持って書き戻す（失わない）
// - 仮の印 ⇄ 物の値の状態の欄（valueStates の推定の行。0035 の3）
// - 贈与者 ⇄ 世帯の外の家族の構成員（生年月・性別なし。0035 の4）
// - 対策に足した項目: 鍵 ⇄ 当て先
// - 保存するときに、ID の無い並びの要素に ID を振る（0035 の5。場所から決まった ID で、保存のたびに同じになる）
import type { PlanDiff } from "../plans/plans.ts";
import { findObject, keyOf, migrationId, readAt, resolveKey, type Address, type Reading, type Target } from "./readings.ts";

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

// ---- 並びの要素の ID（0035 の5） ----

const ELEMENT_LISTS: readonly [string, readonly (readonly string[])[]][] = [
  ["livingExpenses", [["stages"], ["categories"]]],
  ["accounts", [["contributions"]]],
  ["debts", [["rateSchedule"], ["prepayments"]]],
  ["residences", [["purchase", "gifts"]]],
  ["insuranceContracts", [["renewals"]]],
  ["goals", [["education", "stages"], ["education", "lessons"], ["education", "scholarships"], ["education", "loans"], ["education", "gifts"]]],
  ["advisoryFees", [["terms", "oneTime"], ["terms", "recurring", "revision", "steps"]]],
];
const ASSUMPTION_LISTS: readonly (readonly string[])[] = [["marketShocks"], ["loanRateShifts"], ["incomeShocks"], ["returnShifts"], ["surplusSaving", "changes"]];

const getPath = (o: unknown, path: readonly string[]): unknown => path.reduce<unknown>((n, k) => (isObj(n) ? n[k] : undefined), o);

/** 場所から決まった ID（変換の段と同じ作り方）。同じ並びにもうある ID なら、場所に数を足して作り直す（保存のたびに同じ ID になる） */
function freshId(place: string, used: Set<string>): string {
  let id = migrationId(place);
  for (let n = 1; used.has(id); n++) id = migrationId(`${place}/${n}`);
  used.add(id);
  return id;
}

/** ID の無い要素に ID を振る */
function giveIds(list: unknown, place: string): void {
  if (!Array.isArray(list)) return;
  const used = new Set(list.flatMap((e) => (isObj(e) && typeof e.id === "string" ? [e.id] : [])));
  list.forEach((e, i) => {
    if (isObj(e) && typeof e.id !== "string") e.id = freshId(`${place}/${i}`, used);
  });
}

/** 並びの要素に ID を振る（世帯の要求の input を書き換える。0035 の5） */
export function giveElementIds(input: Json): void {
  const h = input.household;
  if (isObj(h)) {
    for (const [coll, paths] of ELEMENT_LISTS) {
      for (const obj of Array.isArray(h[coll]) ? (h[coll] as unknown[]) : []) {
        if (!isObj(obj) || typeof obj.id !== "string") continue;
        for (const p of paths) giveIds(getPath(obj, p), `${obj.id}/${p.join("/")}`);
      }
    }
    const rels = Array.isArray(h.relations) ? h.relations : [];
    const used = new Set(rels.flatMap((r) => (isObj(r) && typeof r.id === "string" ? [r.id] : [])));
    rels.forEach((r, i) => {
      if (!isObj(r) || typeof r.id === "string") return;
      const a = typeof r.a === "string" ? r.a : typeof r.parent === "string" ? r.parent : "";
      const b = typeof r.b === "string" ? r.b : typeof r.child === "string" ? r.child : "";
      r.id = freshId(`relations/${i}/${a}/${b}`, used);
    });
  }
  for (const p of ASSUMPTION_LISTS) giveIds(getPath(input.assumptions, p), `assumptions/${p.join("/")}`);
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
    if (isBox(readAt(input, r.address))) continue;
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

/** 生年月の無い世帯の外の家族を、画面の中の贈与者（donors）に戻す */
function outsideToDonors(input: Json): void {
  const h = input.household;
  if (!isObj(h) || !Array.isArray(h.members)) return;
  const donors: Json[] = Array.isArray(h.donors) ? [...(h.donors as Json[])] : [];
  const members: unknown[] = [];
  for (const m of h.members as unknown[]) {
    if (isObj(m) && isObj(m.outside) && m.birth === undefined) {
      const of = m.outside.of;
      donors.push({ id: m.id, kind: m.kind === "parent" || m.kind === "grandparent" ? m.kind : "other", ...(typeof of === "string" ? { of } : {}) });
    } else members.push(m);
  }
  if (donors.length === 0) return;
  h.members = members;
  h.donors = donors;
}

/** 画面の中の贈与者を、世帯の外の家族の構成員（生年月・性別なし）にする */
function donorsToOutside(input: Json): void {
  const h = input.household;
  if (!isObj(h) || !Array.isArray(h.donors)) return;
  const members = Array.isArray(h.members) ? (h.members as unknown[]) : [];
  for (const d of h.donors as unknown[]) {
    if (!isObj(d)) continue;
    members.push({ id: d.id, kind: d.kind, joins: null, leaves: null, expected: false, outside: { ...(typeof d.of === "string" ? { of: d.of } : {}), periods: [] } });
  }
  h.members = members;
  delete h.donors;
}

// ---- 差分・対策に足した項目 ⇄ 鍵 ----

function readingOfStored(s: { target: Json; item: string | null; at: string[] | null }): Reading | null {
  const t = s.target;
  if (typeof t.lever === "string") return { kind: "lever", lever: t.lever, ...(typeof t.object === "string" ? { object: t.object } : {}), ...(typeof t.member === "string" ? { member: t.member } : {}) };
  if (s.item === null || s.at === null) return null;
  return { kind: "address", address: { target: t as unknown as Target, item: s.item, at: s.at } };
}

/** 当て先の形にする。合成の対策が物を持たないときは、画面の差分の向き先（その対策が動かす物・構成員）を書いておく（読み戻すときに使う） */
function storedTarget(r: Reading, item: string | null, memory?: PlanDiff["target"]): { target: Json; item: string | null; at: string[] } | null {
  if (r.kind === "address") return { target: r.address.target as unknown as Json, item: r.address.item, at: r.address.at };
  if (r.kind === "lever") {
    const own = r.object !== undefined || r.member !== undefined;
    const extra = !own && memory !== undefined && !("plan" in memory) ? memory : {};
    return { target: { lever: r.lever, ...(r.object !== undefined ? { object: r.object } : {}), ...(r.member !== undefined ? { member: r.member } : {}), ...extra }, item, at: [] };
  }
  return null;
}

/** 世帯ファイルの差分を、画面の中の差分（動かす項目のキー）に */
function memoryDiff(s: StoredDiff, input: Json): PlanDiff {
  const legacy = s.legacy;
  const r = s.unresolved === true || s.op !== "set" ? null : readingOfStored(s);
  let key = r === null ? null : keyOf(r, input);
  if (key === null && s.unresolved === true && legacy !== undefined) key = legacy.key;
  key ??= `stored:${s.id}`;
  const lt = legacy?.target;
  const t = s.target;
  const own = typeof t.object === "string" ? { object: t.object } : typeof t.member === "string" ? { member: t.member } : null;
  const target = (isObj(lt) ? lt : own ?? (typeof t.plan === "string" ? { plan: "assumptions" } : { plan: "assumptions" })) as PlanDiff["target"];
  return {
    id: s.id,
    key,
    target,
    item: s.item ?? (typeof legacy?.item === "string" ? legacy.item : "screen"),
    op: "set",
    value: s.value as PlanDiff["value"],
    before: s.before as PlanDiff["before"],
    enabled: s.enabled,
    origin: s.origin as PlanDiff["origin"],
    ...(s.approval !== undefined ? { approval: s.approval as NonNullable<PlanDiff["approval"]> } : {}),
    note: s.note,
    ...(legacy !== undefined ? { legacy } : {}),
    // 鍵に戻せない差分・値を変える差分でないもの（足す・外す）は、読んだ形のまま書き戻す
    ...(r === null || key.startsWith("stored:") ? { stored: s } : {}),
  };
}

/** 画面の中の差分を、世帯ファイルの差分に */
function storedDiff(d: PlanDiff, input: Json): StoredDiff {
  if (d.stored !== undefined && (d.key.startsWith("stored:") || (d.stored as StoredDiff).op !== "set")) return { ...(d.stored as StoredDiff), enabled: d.enabled };
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
  return { ...base, target: d.target as unknown as Json, item: d.item, at: null, unresolved: true, legacy: d.legacy ?? { key: d.key, target: d.target, item: d.item } };
}

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
      p.diffs = p.diffs.map((d) => (isObj(d) && typeof d.key !== "string" ? memoryDiff(d as unknown as StoredDiff, input) : d));
    }
  }
  if (isObj(b.workspace) && Array.isArray(b.workspace.shownItems)) {
    b.workspace.shownItems = b.workspace.shownItems.flatMap((x) => {
      if (typeof x === "string") return [x];
      if (!isObj(x) || !isObj(x.target)) return [];
      const r = readingOfStored({ target: x.target, item: typeof x.item === "string" ? x.item : null, at: Array.isArray(x.at) ? (x.at as string[]) : null });
      const k = r === null ? null : keyOf(r, input);
      return k === null ? [] : [k];
    });
  }
  outsideToDonors(input);
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
      p.diffs = p.diffs.map((d) => storedDiff(d as PlanDiff, input));
    }
  }
  if (isObj(b.workspace) && Array.isArray(b.workspace.shownItems)) {
    b.workspace.shownItems = b.workspace.shownItems.flatMap((k) => {
      if (typeof k !== "string") return isObj(k) ? [k] : [];
      const r = resolveKey(k, input);
      const t = r === null ? null : storedTarget(r, null);
      return t === null ? [] : [t];
    });
  }
  if (isObj(h.assumed)) {
    const kept = assumedToStates(input, h.assumed as Record<string, string>);
    if (Object.keys(kept).length > 0) h.assumed = kept;
    else delete h.assumed;
  }
  donorsToOutside(input);
  return b;
}

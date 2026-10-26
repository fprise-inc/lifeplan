// プラン（0008 の5 のプランの層の「提案」。0036 の差分の型）: 現状からの差分だけを持つ。保存できるプランの数に上限は付けない。
// - 差分は3つの種類（値を変える set・物を足す add・物を外す remove）で、当て先（向き先＋入力項目ID＋場所）で当てる（diffs.ts）
// - プランは土台（別のプラン）を持てる。プランの中身＝現状に、土台のいちばん下から順に差分を当てた世帯（作業中の世帯。0036 の6）
//   プランごとに 外す → 足す → 値を変える、そのあと合成の対策（同じ名前は後のプランが勝つ。欄 → 対策 → FP顧問料の順）
// - 入力（現状）を直すと、全部のプランに反映される（差分を新しい現状に当て直す）。当て先が無くなった・作った時点の値と今の現状が
//   違う、などは「要確認」（0036 の7。保存しない。保存するのは読み替えられなかった差分の印だけ）
// - 「このプランを現状に反映する」は、作業中の世帯を現状にする
// 結果のタブの対策・動かす項目は、入力画面を作り直すまで 0.16 の動かす項目のキー（Values）で動かす。キーと差分は読み替え表で
// 行き来する（store/readings.ts の resolveKey・keyOf）。キーに戻せない差分（足す・外すなど）は Values の `@plan` で持ち、当てるときに足す
import type { EngineRequest } from "../../engine/types.ts";
import { man } from "../../presentation/format.ts";
import { ITEM_LABELS } from "../../generated/labels.ts";
import { ITEM_PLACES } from "../../generated/readings.ts";
import { newId, type WorkingHousehold } from "../input/household.ts";
import { applyAdvisoryFee, applyLevers, LEVER_KEYS, type LeverValues } from "../levers.ts";
import { findObject, keyOf, readAt, resolveKey, unbox, type Reading } from "../store/readings.ts";
import type { MixPart } from "./allocation.ts";
import { pctText } from "./decimal.ts";
import { addAt, addressOf, collectionOf, isLever, removeAt, removedNow, sameJson, writeAt, type DiffBox, type PlanDiff } from "./diffs.ts";
import { reemploymentFor, type Catalog, type ItemValue, type MovableItem, type RateShift } from "./items.ts";

export type { DiffOrigin, PlanDiff } from "./diffs.ts";

/** 動かした値（動かす項目のキー → 値）。現状と同じ値の項目は持たない（土台が動かした項目を現状に戻すときは持つ）。`@plan` はキーに戻せない差分を持つプラン */
export type Values = Record<string, ItemValue>;

/** キーに戻せない差分を持つプランの ID を入れる Values の欄 */
export const PLAN_SLOT = "@plan";

/** プラン（0008 の5 の proposals の1件） */
export interface Proposal {
  id: string;
  /** 例: 「プランB 借入を500万円減らす」 */
  name: string;
  /** 作った日時（ISO 8601） */
  createdAt: string;
  updatedAt: string;
  /** 土台のプラン（null は現状） */
  base: string | null;
  /** 印（まとめ。フォルダの代わり） */
  tags: string[];
  diffs: PlanDiff[];
  /** 現状に反映した日時 */
  reflectedAt?: string;
  /** AIからの候補を FP がプランとして保存したもの（候補の ID） */
  source?: { kind: "ai"; candidate: string };
}

type Input = Record<string, unknown>;
const inputOf = (wh: WorkingHousehold): Input => wh.request.input as unknown as Input;
const box = (value: ItemValue): DiffBox => ({ value, state: "confirmed", origin: { kind: "manual" } });

export function findPlan(list: readonly Proposal[], id: string | null): Proposal | undefined {
  return id === null ? undefined : list.find((p) => p.id === id);
}

/** 土台のいちばん下から、このプランまで（土台が回っていても止まる） */
export function chainOf(list: readonly Proposal[], id: string | null): Proposal[] {
  const chain: Proposal[] = [];
  const seen = new Set<string>();
  let cur = findPlan(list, id);
  while (cur !== undefined && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = findPlan(list, cur.base);
  }
  return chain;
}

// ---- 差分と動かす項目のキー ----

/** 差分の読み替え表の読み（合成の対策か当て先）。足す・外す・読み替えられなかった差分は null */
function readingOf(d: PlanDiff): Reading | null {
  if (d.op !== "set" || d.unresolved === true) return null;
  if (isLever(d.target)) return { kind: "lever", lever: d.target.lever, ...(d.target.object !== undefined ? { object: d.target.object } : {}), ...(d.target.member !== undefined ? { member: d.target.member } : {}) };
  const a = addressOf(d);
  return a === null ? null : { kind: "address", address: a };
}

/** 差分の動かす項目のキー（結果のタブで動かせる差分）。キーに戻せない差分は null */
export function diffKey(d: PlanDiff, wh: WorkingHousehold): string | null {
  const input = inputOf(wh);
  const hit = keyCache.get(d);
  if (hit !== undefined && hit.input === input) return hit.key;
  const r = readingOf(d);
  const key = r === null ? null : keyOf(r, input);
  keyCache.set(d, { input, key });
  return key;
}
/** 差分 → 動かす項目のキー（差分と現状の入力が同じ間は同じ） */
const keyCache = new WeakMap<PlanDiff, { input: Input; key: string | null }>();

/** 一覧の1行の印: 動かす項目のキーか、`diff:<差分の ID>`（置き換えの組は組の ID） */
export function rowKeyOf(d: PlanDiff, wh: WorkingHousehold): string {
  return diffKey(d, wh) ?? `diff:${d.pair ?? d.id}`;
}

/** 動かす項目の値から差分を作る（当て先か合成の対策。表に無いキーは null） */
function diffFromValue(it: MovableItem, v: ItemValue, wh: WorkingHousehold, prev: PlanDiff | undefined): PlanDiff | null {
  const r = resolveKey(it.key, inputOf(wh));
  if (r === null || r.kind === "unresolved") return null;
  // 合成の対策が物を持たないときは、その対策が動かす物・構成員を向き先に書いておく（読み戻すときの控え。0036 の追記）
  const memory = "plan" in it.target ? {} : it.target;
  const place =
    r.kind === "address"
      ? { target: r.address.target, item: r.address.item, at: r.address.at }
      : { target: { lever: r.lever, ...(r.object === undefined && r.member === undefined ? memory : {}), ...(r.object !== undefined ? { object: r.object } : {}), ...(r.member !== undefined ? { member: r.member } : {}) }, item: it.item, at: [] };
  const now = it.read(wh);
  const keep = prev !== undefined && it.same(unbox(prev.value) as ItemValue, v);
  return {
    id: prev?.id ?? newId(),
    op: "set",
    ...place,
    value: box(v),
    before: prev !== undefined ? prev.before : box(now),
    enabled: true,
    // 前と同じ値のままの差分は、出どころ（AIの候補を承認したものなど）を引き継ぐ。動かした差分は手で動かした値になる
    ...(keep ? { origin: prev.origin, ...(prev.approval !== undefined ? { approval: prev.approval } : {}) } : { origin: { kind: "manual" as const } }),
    note: keep ? prev.note : null,
    ...(prev?.legacy !== undefined ? { legacy: prev.legacy } : {}),
  };
}

/** プランの差分の一覧（土台から順に重ねた結果）。一覧の1行の印 → 差分（置き換えの組は組のすべて）と、その差分を持つプラン */
export function effectiveDiffs(wh: WorkingHousehold, id: string | null): Map<string, { diff: PlanDiff; group: PlanDiff[]; owner: string }> {
  const out = new Map<string, { diff: PlanDiff; group: PlanDiff[]; owner: string }>();
  for (const p of chainOf(wh.proposals, id))
    for (const d of p.diffs) {
      if (!d.enabled) continue;
      const k = rowKeyOf(d, wh);
      const cur = out.get(k);
      if (cur !== undefined && cur.owner === p.id && d.pair != null) cur.group.push(d);
      else out.set(k, { diff: d, group: [d], owner: p.id });
    }
  return out;
}

/** プランの中身（動かした値）。キーに戻せない差分があれば `@plan` にプランの ID を入れる */
export function effectiveValues(wh: WorkingHousehold, id: string | null): Values {
  const out: Values = {};
  let other = false;
  for (const [k, { diff }] of effectiveDiffs(wh, id)) {
    if (k.startsWith("diff:")) other = true;
    else out[k] = unbox(diff.value) as ItemValue;
  }
  if (other && id !== null) out[PLAN_SLOT] = id;
  return out;
}

// ---- 当てる（0036 の6・7） ----

export type ReviewState = "ok" | "changed" | "missing" | "gone" | "exists" | "noOwner" | "retired" | "unresolved";

export interface Review {
  state: ReviewState;
  note: string | null;
}

const REVIEW_NOTES: Record<Exclude<ReviewState, "ok" | "changed">, string> = {
  missing: "この差分が指していた物が、入力（現状）から無くなりました",
  gone: "外す物がもうありません",
  exists: "もう入っています",
  noOwner: "足す物の相手がありません",
  retired: "意味の変わった欄です",
  unresolved: "読み替えられなかった差分です",
};
const review = (state: ReviewState, note: string | null = null): Review => ({ state, note: state === "ok" || state === "changed" ? note : (note ?? REVIEW_NOTES[state]) });

/** 当てた結果: 作業中の世帯の要求と、差分ごとの要確認（差分の ID → 要確認） */
export interface Applied {
  request: EngineRequest;
  reviews: Map<string, Review>;
}

const shortText = (v: unknown): string => {
  const x = unbox(v);
  const s = x === undefined || x === null ? "なし" : typeof x === "string" ? x : JSON.stringify(x);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

/**
 * 差分を現状に当てる（0036 の6）: 土台のいちばん下からプランごとに 外す → 足す → 値を変える。そのあと、動かす項目のキーに戻せる
 * 値の差分（当て先の set）と合成の対策を、同じキーは後のプランが勝つように重ね、欄 → 対策 → FP顧問料の順（欄どうしは動かす項目の
 * 一覧の順）で1回ずつ当てる（合成の対策は今の値からの増減で当てるものがあるので、0.16 と同じ順に当てる）。`extra` は結果のタブで
 * 動かしている値（最後に勝つ）。要確認（0036 の7）は、当て先・外す物を作業中の世帯で、作った時点の値を現状で比べる
 */
export function applyDiffs(wh: WorkingHousehold, plans: readonly { id: string; diffs: readonly PlanDiff[] }[], cat: Catalog, extra: Values = {}): Applied {
  const now = inputOf(wh);
  const input = structuredClone(now);
  const reviews = new Map<string, Review>();
  /** 動かす項目のキー → 値と、その値の差分（結果のタブの値は差分を持たない） */
  const keyed = new Map<string, { value: ItemValue; diff: PlanDiff | null }>();
  const setOne = (d: PlanDiff, target: Input): void => {
    const a = addressOf(d);
    if (a === null) return void reviews.set(d.id, review("missing"));
    if (ITEM_PLACES[a.item]?.status !== "active") return void reviews.set(d.id, review("retired"));
    if (!writeAt(target, a, d.value as DiffBox)) return void reviews.set(d.id, review("missing"));
    const base = readAt(now, a);
    const changed = d.before !== null && d.before !== undefined && !sameJson(unbox(base), unbox(d.before));
    reviews.set(d.id, changed ? review("changed", `入力（現状）が ${shortText(d.before)}→${shortText(base)} に変わりました`) : review("ok"));
  };
  for (const p of plans) {
    const live = p.diffs.filter((d) => d.enabled);
    for (const d of live) if (d.unresolved === true) reviews.set(d.id, review("unresolved"));
    const ok = live.filter((d) => d.unresolved !== true);
    for (const d of ok.filter((x) => x.op === "remove")) {
      const cur = removedNow(input, d);
      if (cur === undefined) {
        reviews.set(d.id, review("gone"));
        continue;
      }
      const base = removedNow(now, d);
      reviews.set(d.id, base !== undefined && d.before !== null && !sameJson(base, d.before) ? review("changed", "外す物が変わっていました") : review("ok"));
      removeAt(input, d);
    }
    for (const d of ok.filter((x) => x.op === "add")) {
      const r = addAt(input, d);
      reviews.set(d.id, r === "ok" ? review("ok") : r === "exists" ? review("exists") : r === "noOwner" ? review("noOwner") : review("missing", "足す先がありません"));
    }
    for (const d of ok.filter((x) => x.op === "set")) {
      const k = diffKey(d, wh);
      if (k !== null && cat.byKey.has(k)) {
        keyed.set(k, { value: unbox(d.value) as ItemValue, diff: d });
        continue;
      }
      if (isLever(d.target)) reviews.set(d.id, review("missing"));
      else setOne(d, input);
    }
  }
  for (const [k, v] of Object.entries(extra)) {
    if (cat.byKey.has(k)) {
      keyed.set(k, { value: v, diff: null });
      continue;
    }
    // 動かす項目の一覧に無い欄の値（入力画面で直した欄など）は、当て先へそのまま書く
    const r = k === PLAN_SLOT ? null : resolveKey(k, now);
    if (r !== null && r.kind === "address") writeAt(input, r.address, box(v));
  }
  let w: WorkingHousehold = { ...wh, request: { ...wh.request, input: input as unknown as EngineRequest["input"] } };
  for (const it of cat.items) {
    const e = it.phase === "field" ? keyed.get(it.key) : undefined;
    if (e === undefined) continue;
    // 当て先の項目は当て先へ書く。合成の対策は 0.16 の当て方で（入力画面の作り直しで当て先に寄せる。0036 の3）
    const d = e.diff ?? diffFromValue(it, e.value, wh, undefined);
    if (d !== null && !isLever(d.target)) {
      const req = structuredClone(w.request);
      setOne(d, req.input as unknown as Input);
      if (reviews.get(d.id)?.state !== "missing") {
        w = { ...w, request: req };
        continue;
      }
      // 並びの要素がまだ無いなど、当て先へ書けない値は 0.16 の当て方で当てる（向き先の物が無ければ何もしない）
      if (e.diff !== null && "object" in d.target && findObject(inputOf(w), d.target.object) === undefined) continue;
      reviews.delete(d.id);
    }
    w = it.apply(w, e.value);
    if (e.diff !== null && !reviews.has(e.diff.id)) reviews.set(e.diff.id, review("ok"));
  }
  const lv: Partial<LeverValues> = {};
  for (const k of LEVER_KEYS) {
    const e = keyed.get(`lever:${k}`);
    if (e !== undefined && typeof e.value === "number") lv[k] = e.value;
  }
  const r = reemploymentFor(wh, cat.selfId);
  let req = Object.keys(lv).length > 0 ? applyLevers(w.request, cat.selfId, lv, r !== undefined ? { reemployment: r } : {}) : w.request;
  const fee = keyed.get("lever:fee")?.value;
  if (typeof fee === "boolean") req = applyAdvisoryFee(req, fee);
  for (const [k, e] of keyed) if (e.diff !== null && !reviews.has(e.diff.id) && cat.byKey.get(k)?.phase !== "field") reviews.set(e.diff.id, review("ok"));
  return { request: req, reviews };
}

/** プランを当てる（土台から順に） */
export function applyPlan(wh: WorkingHousehold, id: string | null, cat: Catalog): Applied {
  return applyDiffs(wh, chainOf(wh.proposals, id), cat);
}

/**
 * 動かした値を現状に当てて、計算の要求を作る（現状は変えない）。`@plan` があれば、そのプランのキーに戻せない差分を先に当てる。
 * 今の一覧に無い項目は当てない
 */
export function applyValues(wh: WorkingHousehold, values: Values, cat: Catalog): EngineRequest {
  const planId = values[PLAN_SLOT];
  const plans = typeof planId === "string" ? chainOf(wh.proposals, planId).map((p) => ({ id: p.id, diffs: p.diffs.filter((d) => d.enabled && diffKey(d, wh) === null) })) : [];
  return applyDiffs(wh, plans, cat, values).request;
}

/** 項目の今の値（動かした値があればそれ、無ければ現状） */
export function valueOf(item: MovableItem, values: Values, wh: WorkingHousehold): ItemValue {
  return Object.hasOwn(values, item.key) ? (values[item.key] ?? null) : item.read(wh);
}

/**
 * 動かした値を整える: 一覧に無い項目を外し、現状と同じ値の項目を外す（土台が動かした項目は、現状に戻した値として残す）
 */
export function normalizeValues(values: Values, baseValues: Values, wh: WorkingHousehold, cat: Catalog): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(values)) {
    const it = cat.byKey.get(k);
    if (it === undefined) continue;
    if (!Object.hasOwn(baseValues, k) && it.same(v, it.read(wh))) continue;
    out[k] = v;
  }
  return out;
}

export function sameValues(a: Values, b: Values, cat: Catalog): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (Object.hasOwn(a, k) !== Object.hasOwn(b, k)) return false;
    const it = cat.byKey.get(k);
    const x = a[k] ?? null;
    const y = b[k] ?? null;
    if (!(it !== undefined ? it.same(x, y) : JSON.stringify(x) === JSON.stringify(y))) return false;
  }
  return true;
}

/**
 * プランの自分の差分を作る: 土台の中身と違う値だけ（当て先か合成の対策の set）。前と同じキーの差分は ID と before を引き継ぐ。
 * 前の差分のうちキーに戻せないもの（足す・外すなど）はそのまま残す
 */
function ownDiffs(values: Values, baseValues: Values, wh: WorkingHousehold, cat: Catalog, prev: readonly PlanDiff[]): PlanDiff[] {
  const prevByKey = new Map<string, PlanDiff>();
  const kept: PlanDiff[] = [];
  for (const d of prev) {
    const k = diffKey(d, wh);
    if (k === null) kept.push(d);
    else prevByKey.set(k, d);
  }
  const out: PlanDiff[] = [];
  for (const [k, v] of Object.entries(values)) {
    const it = cat.byKey.get(k);
    if (it === undefined) continue;
    if (Object.hasOwn(baseValues, k) ? it.same(v, baseValues[k] ?? null) : it.same(v, it.read(wh))) continue;
    const d = diffFromValue(it, v, wh, prevByKey.get(k));
    if (d !== null) out.push(d);
  }
  return [...kept, ...out];
}

export interface SaveInput {
  name: string;
  tags?: string[];
  /** 土台のプラン（null は現状） */
  base: string | null;
  values: Values;
  now: string;
}

/** 新しいプランとして保存する。戻り値は新しい世帯とプランの ID */
export function savePlan(wh: WorkingHousehold, cat: Catalog, input: SaveInput): { wh: WorkingHousehold; id: string } {
  const id = newId();
  const baseValues = effectiveValues(wh, input.base);
  const p: Proposal = { id, name: input.name.trim() || "名前のないプラン", createdAt: input.now, updatedAt: input.now, base: input.base, tags: input.tags ?? [], diffs: ownDiffs(input.values, baseValues, wh, cat, []) };
  return { wh: { ...wh, proposals: [...wh.proposals, p] }, id };
}

/** 開いているプランを上書きする */
export function overwritePlan(wh: WorkingHousehold, cat: Catalog, id: string, values: Values, now: string): WorkingHousehold {
  return {
    ...wh,
    proposals: wh.proposals.map((p) => (p.id === id ? { ...p, updatedAt: now, diffs: ownDiffs(values, effectiveValues(wh, p.base), wh, cat, p.diffs) } : p)),
  };
}

export function renamePlan(wh: WorkingHousehold, id: string, name: string, tags: string[]): WorkingHousehold {
  return { ...wh, proposals: wh.proposals.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name, tags } : p)) };
}

/** プランを外す。このプランを土台にしていたプランは、このプランの差分を自分に写して、このプランの土台に付け替える（中身は変わらない） */
export function deletePlan(wh: WorkingHousehold, id: string): WorkingHousehold {
  const gone = findPlan(wh.proposals, id);
  if (gone === undefined) return wh;
  const proposals = wh.proposals
    .filter((p) => p.id !== id)
    .map((p) => {
      if (p.base !== id) return p;
      const own = new Set(p.diffs.map((d) => rowKeyOf(d, wh)));
      // 写す差分は新しい ID にする（置き換えの組・連鎖の ID も付け直す）
      const ids = new Map<string, string>();
      const re = (x: string | null | undefined) => (x == null ? x : (ids.get(x) ?? (ids.set(x, newId()), ids.get(x) as string)));
      const copied = gone.diffs.filter((d) => !own.has(rowKeyOf(d, wh))).map((d) => ({ ...d, id: re(d.id) as string, ...(d.pair != null ? { pair: re(d.pair) } : {}), ...(d.cause != null ? { cause: re(d.cause) } : {}) }));
      return { ...p, base: gone.base, diffs: [...copied, ...p.diffs] };
    });
  return { ...wh, proposals };
}

export interface ChangeRow {
  /** 一覧の1行の印（動かす項目のキーか `diff:<ID>`） */
  key: string;
  label: string;
  /** 例: 「3,200万円」 */
  from: string;
  to: string;
  /** 土台のプランから引き継いだ差分 */
  inherited: boolean;
  state: ReviewState;
  /** 要確認のときの説明 */
  reviewNote: string | null;
}

/** キーに戻せない差分の一覧の名前（例: 「足す: 負債」） */
function otherLabel(d: PlanDiff, wh: WorkingHousehold): string {
  const own = ("object" in d.target ? d.target.object : "member" in d.target ? d.target.member : null) ?? null;
  const name = d.item !== null ? (ITEM_LABELS[d.item] ?? d.item) : ((own !== null ? collectionOf(inputOf(wh), own) : null) ?? ("collection" in d.target ? d.target.collection : "物"));
  if (d.unresolved === true) return `読み替えられなかった差分（${d.legacy?.key ?? name}）`;
  if (d.pair != null) return `置き換え: ${name}`;
  return d.op === "add" ? `足す: ${name}` : d.op === "remove" ? `外す: ${name}` : name;
}

/** プランの「変えたこと」の一覧と要確認（現状に照らす） */
export function changesOf(list: readonly Proposal[], id: string, wh: WorkingHousehold, cat: Catalog): ChangeRow[] {
  const w = list === wh.proposals ? wh : { ...wh, proposals: [...list] };
  const applied = applyPlan(w, id, cat);
  const out: ChangeRow[] = [];
  for (const [k, { diff, group, owner }] of effectiveDiffs(w, id)) {
    const inherited = owner !== id;
    const rv = group.map((d) => applied.reviews.get(d.id)).find((r) => r !== undefined && r.state !== "ok") ?? applied.reviews.get(diff.id) ?? review("ok");
    const it = k.startsWith("diff:") ? undefined : cat.byKey.get(k);
    if (it === undefined) {
      const missing = !k.startsWith("diff:");
      out.push({ key: k, label: missing ? (diff.item ?? k) : otherLabel(diff, w), from: "—", to: "—", inherited, state: missing ? "missing" : rv.state, reviewNote: missing ? REVIEW_NOTES.missing : rv.note });
      continue;
    }
    const now = it.read(w);
    const v = unbox(diff.value) as ItemValue;
    const changed = !it.same(unbox(diff.before) as ItemValue, now);
    out.push({
      key: k,
      label: it.label,
      from: it.text(now),
      to: it.text(v),
      inherited,
      state: changed ? "changed" : "ok",
      reviewNote: changed ? `入力（現状）が ${it.text(unbox(diff.before) as ItemValue)}→${it.text(now)} に変わりました${it.same(v, now) ? "（このプランと同じ値になりました）" : ""}` : null,
    });
  }
  return out;
}

/** 動かしている値の一覧（保存する前のプラン。主画面の「変えたこと」） */
export function changesOfValues(values: Values, wh: WorkingHousehold, cat: Catalog): ChangeRow[] {
  const out: ChangeRow[] = [];
  for (const it of cat.items) {
    if (!Object.hasOwn(values, it.key)) continue;
    const now = it.read(wh);
    const v = values[it.key] ?? null;
    if (it.same(v, now)) continue;
    out.push({ key: it.key, label: it.label, from: it.text(now), to: it.text(v), inherited: false, state: "ok", reviewNote: null });
  }
  return out;
}

export function reviewCount(list: readonly Proposal[], id: string, wh: WorkingHousehold, cat: Catalog): number {
  return changesOf(list, id, wh, cat).filter((c) => c.state !== "ok").length;
}

/** 要確認を確かめた（このまま）: 差分を持つプランの before を今の現状の値（外す差分は今の現状の物）にする */
export function acknowledge(wh: WorkingHousehold, cat: Catalog, id: string, key: string): WorkingHousehold {
  const e = effectiveDiffs(wh, id).get(key);
  if (e === undefined) return wh;
  const it = cat.byKey.get(key);
  const nowOf = (d: PlanDiff): unknown => {
    if (it !== undefined) return box(it.read(wh));
    if (d.op === "remove") return structuredClone(removedNow(inputOf(wh), d) ?? d.before);
    const a = addressOf(d);
    return a === null ? d.before : structuredClone(readAt(inputOf(wh), a) ?? null);
  };
  const ids = new Set(e.group.map((d) => d.id));
  return { ...wh, proposals: wh.proposals.map((p) => (p.id === e.owner ? { ...p, diffs: p.diffs.map((d) => (ids.has(d.id) && d.op !== "add" ? { ...d, before: nowOf(d) } : d)) } : p)) };
}

/**
 * プランから差分を外す。自分の差分は消す（置き換えの組は組ごと）。土台から引き継いだ差分は、このプランで現状に戻す差分を足す
 * （値を変える差分は現状の値の set、土台で足した物は同じ物の remove、土台で外した物は足し戻す add。0036 の8）。向き先が無い差分は消す
 */
export function dropChange(wh: WorkingHousehold, cat: Catalog, id: string, key: string): WorkingHousehold {
  const p = findPlan(wh.proposals, id);
  if (p === undefined) return wh;
  const e = effectiveDiffs(wh, id).get(key);
  const ownIds = new Set(p.diffs.filter((d) => rowKeyOf(d, wh) === key).map((d) => d.id));
  const drop = (x: Proposal) => ({ ...x, diffs: x.diffs.filter((d) => !ownIds.has(d.id)) });
  if (ownIds.size > 0 || e === undefined) return { ...wh, proposals: wh.proposals.map((x) => (x.id === id ? drop(x) : x)) };
  const back: PlanDiff[] = [];
  const it = cat.byKey.get(key);
  const pair = e.group.length > 1 ? newId() : null;
  for (const d of e.group) {
    const base = { id: newId(), enabled: true, origin: { kind: "manual" as const }, note: null, ...(pair !== null ? { pair } : {}) };
    if (it !== undefined) {
      const restored = diffFromValue(it, it.read(wh), wh, undefined);
      if (restored !== null) back.push({ ...restored, ...base });
    } else if (d.op === "set") {
      const a = addressOf(d);
      if (a !== null) back.push({ ...d, ...base, value: structuredClone(readAt(inputOf(wh), a) ?? null), before: structuredClone(readAt(inputOf(wh), a) ?? null) });
    } else if (d.op === "add" && isObjLike(d.value) && typeof d.value.id === "string") {
      const nested = "collection" in d.target ? null : d.at;
      back.push({ ...base, op: "remove", target: "collection" in d.target ? { object: d.value.id } : d.target, item: nested === null ? null : d.item, at: nested === null ? [] : [...nested, d.value.id], value: null, before: structuredClone(d.value) });
    } else if (d.op === "remove" && isObjLike(d.before)) {
      const nested = d.item !== null && d.at !== null && d.at.length > 0;
      const col = "object" in d.target && typeof d.target.object === "string" ? collectionOf(inputOf(wh), d.target.object) : "member" in d.target ? "member" : null;
      if (nested) back.push({ ...base, op: "add", target: d.target, item: d.item, at: (d.at as string[]).slice(0, -1), value: structuredClone(d.before), before: null });
      else if (col !== null) back.push({ ...base, op: "add", target: { collection: col }, item: null, at: [], value: structuredClone(d.before), before: null });
    }
  }
  if (back.length === 0) return wh;
  return { ...wh, proposals: wh.proposals.map((x) => (x.id === id ? { ...x, diffs: [...x.diffs, ...back] } : x)) };
}

const isObjLike = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * このプランを現状に反映する: 作業中の世帯（土台を含む）を入力（現状）にする。反映したプランは差分が無くなり（現状と同じ）、土台を外す。
 * ほかのプランは差分のまま残り、当て先が無くなった・現状が変わった差分は「要確認」になる
 */
export function reflectPlan(wh: WorkingHousehold, cat: Catalog, id: string, now: string): WorkingHousehold {
  const { request } = applyPlan(wh, id, cat);
  return { ...wh, request, proposals: wh.proposals.map((p) => (p.id === id ? { ...p, base: null, diffs: [], reflectedAt: now, updatedAt: now } : p)) };
}

// ---- プランの名前 ----

const LETTERS = "BCDEFGHIJKLMNOPQRSTUVWXYZ";

/** プランの呼び名（例: 「プランB」） */
export const planLabel = (letter: string): string => `プラン${letter}`;

/** 名前の頭のプランの文字（「プランB」。以前の「B案」も読む） */
export const HEAD = /^(?:プラン([A-Z])|([A-Z])案)(?:\s+|$)/;

/** 名前の中の以前の呼び方「B案」を「プランB」に直す（例: 「プランB＋金利が上がる」。英大文字の後の「案」だけ） */
export function modernPlanName(name: string): string {
  return name.replace(/([A-Z])案/g, "プラン$1");
}

/** 名前の頭のプランの文字（後ろに空白が無くてもよい。無ければ undefined） */
export function headLetter(name: string): string | undefined {
  const m = /^(?:プラン([A-Z])|([A-Z])案)/.exec(name);
  return m === null ? undefined : (m[1] ?? m[2]);
}

function phrase(it: MovableItem, v: ItemValue, now: ItemValue): string {
  if (it.key.endsWith(":prepay") && typeof v === "number") return `借入を${man(v)}万円減らす`;
  if (typeof v === "number" && typeof now === "number" && (it.control.kind === "range" || (it.control.kind === "field" && it.control.field.kind === "yen") || it.key === "lever:livingMonthly" || it.key === "lever:nisaMonthly")) {
    const d = v - now;
    return `${it.short}を${man(Math.abs(d))}万円${d < 0 ? "減らす" : "増やす"}`;
  }
  if (it.key === "lever:retireAge" && typeof v === "number") return `${v}歳まで働く`;
  if (it.key === "lever:pensionAge" && typeof v === "number") return `年金を${v}歳から`;
  if (it.key === "lever:fee") return v === true ? "FP顧問料を入れる" : "FP顧問料を入れない";
  if (it.control.kind === "rate" && typeof v === "string") return `金利${pctText(v)}`;
  if (it.control.kind === "shift") {
    const s = v as RateShift | null;
    return s === null ? "金利が上がらない" : `金利が${Number(s.from.slice(0, 4))}年から+${pctText(s.add)}`;
  }
  if (it.control.kind === "mix") {
    const eq = Array.isArray(v) ? (v as MixPart[]).filter((m) => m.assetClass.startsWith("equity.")).reduce((s, m) => s + Math.round(Number(m.share) * 100), 0) : 0;
    return `株式${eq}%の配分`;
  }
  return `${it.short}を${it.text(v)}に`;
}

/**
 * プランの名前の例（例: 「プランB 借入を500万円減らす」）。土台のプランがあれば、土台から変えたことで名前を作る。
 * 足した項目（借入・金利・配分など）を、対策の固定の項目より先に使う
 */
export function suggestName(list: readonly Proposal[], values: Values, wh: WorkingHousehold, cat: Catalog, base: string | null = null): string {
  const used = new Set(list.map((p) => headLetter(p.name)).filter((x): x is string => x !== undefined));
  const letter = [...LETTERS].find((l) => !used.has(l)) ?? String(list.length + 2);
  const baseValues = effectiveValues(list === wh.proposals ? wh : { ...wh, proposals: [...list] }, base);
  const ref = (it: MovableItem) => (Object.hasOwn(baseValues, it.key) ? (baseValues[it.key] ?? null) : it.read(wh));
  const rows = cat.items.filter((it) => Object.hasOwn(values, it.key) && !it.same(values[it.key] ?? null, ref(it))).sort((a, b) => Number(a.builtin) - Number(b.builtin));
  const first = rows[0];
  const baseLetter = headLetter(findPlan(list, base)?.name ?? "");
  const head = baseLetter !== undefined ? `${planLabel(letter)} ${planLabel(baseLetter)}＋` : `${planLabel(letter)} `;
  if (first === undefined) return planLabel(letter);
  const p = phrase(first, values[first.key] ?? null, ref(first));
  return `${head}${p}${rows.length > 1 ? ` ほか${rows.length - 1}件` : ""}`;
}

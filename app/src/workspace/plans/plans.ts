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
import type { ContingencyPlan } from "../contingency/planData.ts";
import { applyPremiseDiffs, premisePath, readPath } from "../contingency/premiseItems.ts";
import { applyAdvisoryFee, applyLevers, LEVER_KEYS, type LeverValues } from "../levers.ts";
import { keyOf, readAt, resolveKey, unbox, type Address, type Reading } from "../store/readings.ts";
import type { MixPart } from "./allocation.ts";
import { pctText } from "./decimal.ts";
import { addAt, addressOf, boxAt, collectionOf, indexOfObject, isLever, isSharedDiff, placeExists, removeAt, removedNow, sameJson, writeAt, type DiffBox, type PlanDiff } from "./diffs.ts";
import { catalogKeysOf, reemploymentFor, type Catalog, type ItemValue, type MovableItem, type RateShift } from "./items.ts";
import { COLLECTION_LABELS, diffRows, type DiffRow } from "./planEdit.ts";
import { stackDiffs } from "./stack.ts";

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
  const listed = catalogKeysOf(input);
  const hit = keyCache.get(d);
  if (hit !== undefined && hit.input === input && hit.listed === listed) return hit.key;
  const r = readingOf(d);
  // 同じ当て先に戻る鍵が複数あれば、動かす項目の一覧にある鍵を選ぶ（住宅ローンの借入額など。一覧に無い鍵を選ぶと結果のタブから見えない）
  const key = r === null ? null : keyOf(r, input, "item", undefined, listed === undefined ? undefined : (k) => listed.has(k));
  keyCache.set(d, { input, listed, key });
  return key;
}
/** 差分 → 動かす項目のキー（差分と現状の入力と動かす項目の一覧が同じ間は同じ） */
const keyCache = new WeakMap<PlanDiff, { input: Input; listed: ReadonlySet<string> | undefined; key: string | null }>();

/** 一覧の1行の印: 動かす項目のキーか、`diff:<差分の ID>`（置き換えの組は組の ID） */
export function rowKeyOf(d: PlanDiff, wh: WorkingHousehold): string {
  return diffKey(d, wh) ?? `diff:${d.pair ?? d.id}`;
}

/** 動かす項目の値から差分を作る（当て先か合成の対策。表に無いキーは null） */
function diffFromValue(it: MovableItem | undefined, key: string, v: ItemValue, wh: WorkingHousehold, prev: PlanDiff | undefined): PlanDiff | null {
  const r = resolveKey(key, inputOf(wh));
  if (r === null || r.kind === "unresolved") return null;
  // 動かす項目の一覧に無い鍵は、当て先の欄だけ差分にする（合成の対策は一覧の項目でしか当てられない）
  if (it === undefined && r.kind !== "address") return null;
  // 合成の対策は、表の行が持たせる物（object・member）だけを向き先に書く（本体の変換の段と同じ形。0036 の追記）
  const place =
    r.kind === "address"
      ? { target: r.address.target, item: r.address.item, at: r.address.at }
      : { target: { lever: r.lever, ...(r.object !== undefined ? { object: r.object } : {}), ...(r.member !== undefined ? { member: r.member } : {}) }, item: it?.item ?? null, at: [] };
  const same = (a: unknown, b: unknown) => (it !== undefined ? it.same(a as ItemValue, b as ItemValue) : sameJson(a, b));
  const keep = prev !== undefined && same(unbox(prev.value), v);
  const before = prev !== undefined ? prev.before : it !== undefined ? box(it.read(wh)) : r.kind === "address" ? boxAt(inputOf(wh), r.address) : null;
  return {
    id: prev?.id ?? newId(),
    op: "set",
    ...place,
    // 前と同じ値のままの差分は、値の箱（入力画面で付けた状態を含む）と出どころ（AIの候補を承認したもの・入力で直したものなど）を
    // 引き継ぐ。動かした差分は、結果のタブで動かした値になる（0036 の4 の出どころ result）
    value: keep ? structuredClone(prev.value) : box(v),
    before,
    enabled: true,
    ...(keep ? { origin: prev.origin, ...(prev.approval !== undefined ? { approval: prev.approval } : {}) } : { origin: { kind: "result" as const } }),
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

// 要確認の文は FP がお客さまに画面を見せても分かる言葉にする。現状（入力の画面の値）は、ここでは「現状のプラン」と呼ぶ
const REVIEW_NOTES: Record<Exclude<ReviewState, "ok" | "changed">, string> = {
  missing: "現状のプランから、この物が無くなりました",
  gone: "このプランで外していた物は、現状のプランでももう無くなっています",
  exists: "このプランで足していた物は、現状のプランにもう入っています",
  noOwner: "この物に関わる家族（名義・契約者など）が、現状のプランにいません",
  retired: "アプリの更新で、この欄の意味が変わりました",
  unresolved: "アプリの更新で、この違いを今の形に読み替えられませんでした",
};
/** 現状の値が、差分を作った時点から変わったときの文 */
const changedNote = (was: string, now: string): string => `現状のプランが ${was}→${now} に変わりました`;
const review = (state: ReviewState, note: string | null = null): Review => ({ state, note: state === "ok" || state === "changed" ? note : (note ?? REVIEW_NOTES[state]) });

/** 当てた結果: 作業中の世帯の要求と、そのプランの万一の前提、差分ごとの要確認（差分の ID → 要確認） */
export interface Applied {
  request: EngineRequest;
  /** 全プラン共通の万一の前提に、万一の前提の差分を当てたもの（0036 の6 の3・0071） */
  contingency: ContingencyPlan;
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
 * 動かしている値（最後に勝つ）。要確認（0036 の7）は、当て先・外す物を作業中の世帯で、作った時点の値を現状で比較する
 */
export function applyDiffs(wh: WorkingHousehold, plans: readonly { id: string; diffs: readonly PlanDiff[] }[], cat: Catalog, extra: Values = {}): Applied {
  const now = inputOf(wh);
  const input = structuredClone(now);
  const reviews = new Map<string, Review>();
  /** 動かす項目のキー → 値と、その値の差分（結果のタブの値は差分を持たない） */
  const keyed = new Map<string, { value: ItemValue; diff: PlanDiff | null }>();
  /** 当て先へ書いた値（差分と、結果のタブで動かした一覧に無い欄の値）。入力の欄の項目を欄の書き方で当てたあと、書き直す（差分に書いた値が勝つ） */
  const written: { address: Address; value: DiffBox }[] = [];
  const setOne = (d: PlanDiff, target: Input): void => {
    const a = addressOf(d);
    if (a === null) return void reviews.set(d.id, review("missing"));
    // 万一の前提（全プラン共通の前提をこのプランだけ上書きする。0036 の6 の3）は、要求ではなく前提に当てる（下の applyPremiseDiffs）。
    // ここでは要確認だけを決める: 共通の前提の値が、差分を作った時点の値から変わっていれば「入力が変わりました」
    if ("plan" in a.target && a.target.plan === "contingency") {
      const path = ITEM_PLACES[a.item]?.status === "active" ? premisePath(a) : null;
      if (path === null) return void reviews.set(d.id, review("retired"));
      const base = readPath(wh.contingency, path);
      const was = d.before === null || d.before === undefined ? undefined : (unbox(d.before) ?? undefined);
      const changed = d.before !== undefined && !sameJson(was ?? null, base ?? null);
      return void reviews.set(d.id, changed ? review("changed", `全プラン共通の前提が ${shortText(was ?? null)}→${shortText(base ?? null)} に変わりました`) : review("ok"));
    }
    if (ITEM_PLACES[a.item]?.status !== "active") return void reviews.set(d.id, review("retired"));
    // どのプランにも共通の項目（表の最後の年）は当てない（前の版の差分は読むときに外す。ここは残った物の守り。0043 の追記 2026-11-05）
    if (isSharedDiff(d)) return void reviews.set(d.id, review("retired"));
    if (!writeAt(target, a, d.value as DiffBox)) return void reviews.set(d.id, review("missing"));
    written.push({ address: a, value: d.value as DiffBox });
    const base = readAt(now, a);
    const changed = d.before !== null && d.before !== undefined && !sameJson(unbox(base), unbox(d.before));
    reviews.set(d.id, changed ? review("changed", changedNote(shortText(d.before), shortText(base))) : review("ok"));
  };
  for (const p of plans) {
    const live = p.diffs.filter((d) => d.enabled);
    for (const d of live) if (d.unresolved === true) reviews.set(d.id, review("unresolved"));
    const ok = live.filter((d) => d.unresolved !== true);
    /** 置き換えの組の、外した物のあった所（足す物を同じ所に入れる。並びの順を変えない） */
    const slots = new Map<string, number>();
    /** 外す物がまだ無い外す（組でないもの）: 同じプランで足す物の中にあれば、足したあとで外す（土台の差分を写して重ねたプラン。stack.ts） */
    const later: PlanDiff[] = [];
    for (const d of ok.filter((x) => x.op === "remove")) {
      const cur = removedNow(input, d);
      if (cur === undefined) {
        if (d.pair == null) later.push(d);
        else reviews.set(d.id, review("gone"));
        continue;
      }
      const base = removedNow(now, d);
      reviews.set(d.id, base !== undefined && d.before !== null && !sameJson(base, d.before) ? review("changed", "このプランで外していた物の中身が、現状のプランで変わりました") : review("ok"));
      const t = d.target as { object?: unknown; member?: unknown };
      const own = d.item === null ? (typeof t.object === "string" ? t.object : typeof t.member === "string" ? t.member : null) : null;
      if (d.pair != null && own !== null) slots.set(d.pair, indexOfObject(input, own));
      removeAt(input, d);
    }
    for (const d of ok.filter((x) => x.op === "add")) {
      const r = addAt(input, d, d.pair != null ? slots.get(d.pair) : undefined);
      reviews.set(d.id, r === "ok" ? review("ok") : r === "exists" ? review("exists") : r === "noOwner" ? review("noOwner") : review("missing", "このプランで足していた物の入れ先が、現状のプランにありません"));
    }
    for (const d of later) {
      if (removedNow(input, d) === undefined) {
        reviews.set(d.id, review("gone"));
        continue;
      }
      reviews.set(d.id, review("ok"));
      removeAt(input, d);
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
    if (r !== null && r.kind === "address" && !isSharedDiff({ target: r.address.target, item: r.address.item }) && writeAt(input, r.address, box(v))) written.push({ address: r.address, value: box(v) });
  }
  let w: WorkingHousehold = { ...wh, request: { ...wh.request, input: input as unknown as EngineRequest["input"] } };
  /**
   * 入力の欄の項目を、欄の書き方で当てる。欄の書き方が書き換えた所のうち、それまでに当て先へ書いた値（差分）の所は差分の値に戻し、
   * この差分の値は値の箱のまま書く（差分に書いた値が勝つ。欄の書き方が書き換えなかった所は、前に当てた対策の当て方のまま）
   */
  const asField = (cur: WorkingHousehold, it: MovableItem, v: ItemValue): WorkingHousehold => {
    const next = it.apply(cur, v);
    const was = cur.request.input as unknown as Input;
    const req = structuredClone(next.request);
    const target = req.input as unknown as Input;
    const own = written.at(-1);
    for (const x of written)
      if (x === own || (placeExists(target, x.address) && !sameJson(readAt(was, x.address), readAt(target, x.address)))) writeAt(target, x.address, x.value);
    return { ...next, request: req };
  };
  for (const it of cat.items) {
    const e = it.phase === "field" ? keyed.get(it.key) : undefined;
    if (e === undefined) continue;
    // 当て先の項目は当て先へ書く。合成の対策は 0.16 の当て方で（入力画面の作り直しで当て先に寄せる。0036 の3）
    const d = e.diff ?? diffFromValue(it, it.key, e.value, wh, undefined);
    if (d !== null && !isLever(d.target)) {
      const req = structuredClone(w.request);
      const mark = written.length;
      setOne(d, req.input as unknown as Input);
      if (reviews.get(d.id)?.state !== "missing") {
        // 入力の欄の項目は、入力の画面でその欄を直したのと同じ書き方で当てる（欄が一緒に変える値〔下取り額・もう片方の標準報酬月額など〕も
        // 変える。0036 の追記 2026-10-29 の2）。そのあと、それまでに当てた当て先の値とこの差分の値を書き直す（差分に書いた値が勝つ）
        w = it.control.kind === "field" && written.length > mark ? asField(w, it, e.value) : { ...w, request: req };
        continue;
      }
      // 現状にある物・要素を、作業中の世帯で外していたら当てない（0.16 の番号の当て方に回すと、別の要素に当たる。0036 の7）。
      // 当て先へ書けないのは現状にもまだ無い場所のときだけで、そのときだけ 0.16 の当て方で当てる
      const a = addressOf(d);
      if (a === null || placeExists(now, a)) continue;
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
  // プランの表はいつも現状と同じ年で終わる（表の最後の年はどのプランにも共通。0043 の追記 2026-11-05）
  if (req.input.endYear !== wh.request.input.endYear) req = { ...req, input: { ...req.input, endYear: wh.request.input.endYear } };
  return { request: req, contingency: applyPremiseDiffs(wh.contingency, plans), reviews };
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
 * 動かした値を整える: 現状と同じ値の項目を外す（土台が動かした項目は、現状に戻した値として残す）。一覧に無い項目は外すが、
 * `@plan`（キーに戻せない差分を持つプラン）と、当て先に読める鍵（一覧に無い欄の差分）は残す（外すと、その差分を当てずに計算する）
 */
export function normalizeValues(values: Values, baseValues: Values, wh: WorkingHousehold, cat: Catalog): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(values)) {
    const it = cat.byKey.get(k);
    if (it === undefined) {
      if (k === PLAN_SLOT || resolveKey(k, inputOf(wh))?.kind === "address") out[k] = v;
      continue;
    }
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
  // 今の一覧に無く、当て先の欄にも読めない鍵（現状から物を外している間の、その物の対策。FP顧問料の契約を外している間の顧問料など）。
  // 画面では動かせないので値から作り直さず、前の差分をそのまま残す（物を現状に戻すと、また当たる）
  const unlisted = (k: string) => !cat.byKey.has(k) && resolveKey(k, inputOf(wh))?.kind !== "address";
  for (const [k, v] of Object.entries(values)) {
    if (k === PLAN_SLOT) continue;
    const it = cat.byKey.get(k);
    if (it !== undefined && (Object.hasOwn(baseValues, k) ? it.same(v, baseValues[k] ?? null) : it.same(v, it.read(wh)))) continue;
    if (it === undefined) {
      if (unlisted(k)) continue;
      // 一覧に無い欄の値（入力画面で直した欄の差分）: 土台・現状と同じなら差分にしない
      const r = resolveKey(k, inputOf(wh));
      // どのプランにも共通の項目（表の最後の年）は差分にしない（0043 の追記 2026-11-05）
      if (r === null || r.kind !== "address" || isSharedDiff({ target: r.address.target, item: r.address.item })) continue;
      if (Object.hasOwn(baseValues, k) ? sameJson(v, baseValues[k]) : sameJson(v, unbox(boxAt(inputOf(wh), r.address)))) continue;
    }
    const d = diffFromValue(it, k, v, wh, prevByKey.get(k));
    if (d !== null) out.push(d);
  }
  // オフにした差分（Values に出ない）は、同じキーを動かしていなければ残す（0036 の4 の enabled）。今の一覧に無い鍵の差分も残す（上）
  const now = new Set(out.map((d) => diffKey(d, wh)));
  const off = [...prevByKey.entries()].filter(([k, d]) => (!d.enabled || unlisted(k)) && !now.has(k)).map(([, d]) => d);
  return [...kept, ...off, ...out].filter((d) => !isSharedDiff(d));
}

export interface SaveInput {
  name: string;
  tags?: string[];
  /** 土台のプラン（null は現状） */
  base: string | null;
  values: Values;
  now: string;
}

/** 差分を写す（新しい ID にし、置き換えの組・連鎖の ID も付け直す） */
function copyWithNewIds(diffs: readonly PlanDiff[]): PlanDiff[] {
  const ids = new Map<string, string>();
  const re = (x: string): string => {
    const got = ids.get(x);
    if (got !== undefined) return got;
    const n = newId();
    ids.set(x, n);
    return n;
  };
  return diffs.map((d) => ({ ...d, id: re(d.id), ...(d.pair != null ? { pair: re(d.pair) } : {}), ...(d.cause != null ? { cause: re(d.cause) } : {}) }));
}

/** 新しいプランとして保存する。戻り値は新しい世帯とプランの ID */
export function savePlan(wh: WorkingHousehold, cat: Catalog, input: SaveInput): { wh: WorkingHousehold; id: string } {
  const id = newId();
  const baseValues = effectiveValues(wh, input.base);
  // 値の元のプラン（@plan）のキーに戻せない差分のうち、土台から来ないものを写す（写さないと、足す・外すの差分が落ちる）
  const src = input.values[PLAN_SLOT];
  const inBase = new Set(chainOf(wh.proposals, input.base).map((p) => p.id));
  // プランをまたいで写す差分は、土台から順に重ね、土台で足した物を上のプランで外した組を打ち消す（1つのプランの中は 外す → 足す の順に当てるため。stack.ts）
  const carried =
    typeof src === "string" && !inBase.has(src)
      ? chainOf(wh.proposals, src)
          .filter((p) => !inBase.has(p.id))
          .reduce<PlanDiff[]>((acc, p) => stackDiffs(acc, copyWithNewIds(p.diffs.filter((d) => d.enabled && diffKey(d, wh) === null))), [])
      : [];
  const p: Proposal = { id, name: input.name.trim() || "名前のないプラン", createdAt: input.now, updatedAt: input.now, base: input.base, tags: input.tags ?? [], diffs: [...carried, ...ownDiffs(input.values, baseValues, wh, cat, [])] };
  return { wh: { ...wh, proposals: [...wh.proposals, p] }, id };
}

/**
 * プランを複製する（入力の画面の「このプランを複製」）: 土台・印・差分をそのまま写す。値から作り直さないので、オフにした差分・値の箱の状態
 * （推定など）・差分の出どころ・要確認の材料（作った時点の値）も元のプランのまま残る。差分の ID は付け直す
 */
export function copyPlan(wh: WorkingHousehold, src: Proposal, name: string, now: string): { wh: WorkingHousehold; id: string } {
  const id = newId();
  const p: Proposal = { id, name: name.trim() || "名前のないプラン", createdAt: now, updatedAt: now, base: src.base, tags: [...src.tags], diffs: structuredClone(copyWithNewIds(src.diffs)) };
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
      // 自分で上書きしている所（オンの差分だけ。オフにした差分は中身に効かないので、土台の差分の代わりにならない。オフの差分は残す）
      const own = new Set(p.diffs.filter((d) => d.enabled).map((d) => rowKeyOf(d, wh)));
      // 写す差分は新しい ID にする（置き換えの組・連鎖の ID も付け直す）
      const copied = copyWithNewIds(gone.diffs.filter((d) => !own.has(rowKeyOf(d, wh))));
      // 土台で足した物を自分で外している組は打ち消す（そのまま並べると、外すが先に空振りして足すが物を戻す。stack.ts）
      return { ...p, base: gone.base, diffs: stackDiffs(copied, p.diffs) };
    });
  return { ...wh, proposals };
}

/**
 * 入力画面でプランの1つの値を直す（0036 の8。値の状態の操作もこれで書く）: このプランで足した物の中の値なら、その足す差分の物を直す
 * （set を重ねない）。そうでなければ、その当て先の自分の set を作る・直す。土台の中身（土台が無ければ現状）と同じ値の箱に戻したら、
 * 自分の差分を消す。box はいつも値の箱（0036 の4）
 */
export function setPlanValue(
  wh: WorkingHousehold,
  cat: Catalog,
  id: string,
  a: Address,
  box: DiffBox,
  /** 値の箱の読み方（画面の中の仮の印を推定の箱として読むときに渡す。省くと boxAt） */
  read: (w: WorkingHousehold) => DiffBox | null = (w) => boxAt(inputOf(w), a),
): WorkingHousehold {
  const p = findPlan(wh.proposals, id);
  if (p === undefined) return wh;
  const ownerId = "object" in a.target ? a.target.object : "member" in a.target ? a.target.member : null;
  const added = ownerId === null ? undefined : p.diffs.find((d) => d.op === "add" && isObjLike(d.value) && d.value.id === ownerId);
  if (added !== undefined) {
    const obj = structuredClone(added.value) as Record<string, unknown>;
    if (!writeAt({ household: { list: [obj] } }, a, box)) return wh;
    return { ...wh, proposals: wh.proposals.map((x) => (x.id === id ? { ...x, diffs: x.diffs.map((d) => (d.id === added.id ? { ...d, value: obj } : d)) } : x)) };
  }
  const sameAddress = (d: PlanDiff) => d.op === "set" && d.unresolved !== true && !isLever(d.target) && !("collection" in d.target) && d.item === a.item && sameJson(d.target, a.target) && sameJson(d.at, a.at);
  const baseBox = read(p.base === null ? wh : { ...wh, request: applyPlan(wh, p.base, cat).request });
  const own = p.diffs.find(sameAddress);
  const rest = p.diffs.filter((d) => !sameAddress(d));
  const diffs: PlanDiff[] =
    baseBox !== null && sameJson(baseBox, box)
      ? rest
      : [...rest, { id: own?.id ?? newId(), op: "set", target: a.target, item: a.item, at: [...a.at], value: structuredClone(box), before: own?.before ?? read(wh), enabled: true, origin: { kind: "manual" }, note: own?.note ?? null }];
  return { ...wh, proposals: wh.proposals.map((x) => (x.id === id ? { ...x, diffs } : x)) };
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
  const col = (own !== null ? collectionOf(inputOf(wh), own) : null) ?? ("collection" in d.target ? d.target.collection : null);
  const name = d.item !== null ? (ITEM_LABELS[d.item] ?? "入力項目の値") : col !== null ? (COLLECTION_LABELS[col] ?? "物") : "物";
  if (d.unresolved === true) return `読み替えられなかった差分（${d.legacy?.key ?? name}）`;
  if (d.pair != null) return `置き換え: ${name}`;
  return d.op === "add" ? `足す: ${name}` : d.op === "remove" ? `外す: ${name}` : name;
}

/** プランの「変えたこと」の一覧と要確認（現状に照らす） */
export function changesOf(list: readonly Proposal[], id: string, wh: WorkingHousehold, cat: Catalog): ChangeRow[] {
  const w = list === wh.proposals ? wh : { ...wh, proposals: [...list] };
  const applied = applyPlan(w, id, cat);
  const out: ChangeRow[] = [];
  // 入力で直した差分（動かす項目の一覧に無い差分）は、入力のホームの違いの一覧と同じ文にする（欄の名前・選択肢の言葉。0043）
  let listed: Map<string, DiffRow> | null = null;
  const listedRow = (d: PlanDiff): DiffRow | undefined => {
    if (listed === null) {
      listed = new Map();
      for (const r of diffRows(w, cat, id)) for (const x of r.diffs) listed.set(x.id, r);
    }
    return listed.get(d.id);
  };
  for (const [k, { diff, group, owner }] of effectiveDiffs(w, id)) {
    const inherited = owner !== id;
    const rv = group.map((d) => applied.reviews.get(d.id)).find((r) => r !== undefined && r.state !== "ok") ?? applied.reviews.get(diff.id) ?? review("ok");
    const it = k.startsWith("diff:") ? undefined : cat.byKey.get(k);
    if (it === undefined) {
      const missing = !k.startsWith("diff:");
      const row = missing ? undefined : listedRow(diff);
      if (row !== undefined) {
        out.push({ key: k, label: row.label, from: row.from, to: row.to, inherited, state: rv.state, reviewNote: rv.note });
        continue;
      }
      out.push({ key: k, label: missing ? (ITEM_LABELS[diff.item ?? ""] ?? "動かす項目") : otherLabel(diff, w), from: "—", to: "—", inherited, state: missing ? "missing" : rv.state, reviewNote: missing ? REVIEW_NOTES.missing : rv.note });
      continue;
    }
    const now = it.read(w);
    const v = unbox(diff.value) as ItemValue;
    // 当てられなかった差分（指す物・要素を土台のプランで外したなど。0036 の7）は、一覧にある項目でもその要確認を出す
    if (rv.state !== "ok" && rv.state !== "changed") {
      out.push({ key: k, label: it.label, from: it.text(now), to: it.text(v), inherited, state: rv.state, reviewNote: rv.note });
      continue;
    }
    const changed = !it.same(unbox(diff.before) as ItemValue, now);
    out.push({
      key: k,
      label: it.label,
      from: it.text(now),
      to: it.text(v),
      inherited,
      state: changed ? "changed" : "ok",
      reviewNote: changed ? `${changedNote(it.text(unbox(diff.before) as ItemValue), it.text(now))}${it.same(v, now) ? "（このプランと同じ値になりました）" : ""}` : null,
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
  // 入力で直した差分（動かす項目の一覧に無い差分。値の中では @plan で指す）も、違いの一覧と同じ文で足す（提案書・持ち帰り用のレポートの変更点にも入る）
  const planId = values[PLAN_SLOT];
  if (typeof planId === "string" && findPlan(wh.proposals, planId) !== undefined)
    for (const r of diffRows(wh, cat, planId)) {
      if (!r.enabled || r.diffs.some((d) => diffKey(d, wh) !== null)) continue;
      out.push({ key: `diff:${r.key}`, label: r.label, from: r.from, to: r.to, inherited: r.inherited, state: "ok", reviewNote: null });
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
    return a === null ? d.before : boxAt(inputOf(wh), a);
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
  const mine = p.diffs.filter((d) => rowKeyOf(d, wh) === key);
  const ownIds = new Set(mine.map((d) => d.id));
  const drop = (x: Proposal) => ({ ...x, diffs: x.diffs.filter((d) => !ownIds.has(d.id)) });
  // 自分のオンの差分があれば消す（同じ所のオフの差分も一緒に）。オフの差分しか無いときは、中身は土台から来ているので、下で現状に戻す差分を足す
  if (mine.some((d) => d.enabled) || e === undefined) return { ...wh, proposals: wh.proposals.map((x) => (x.id === id ? drop(x) : x)) };
  const back: PlanDiff[] = [];
  const it = cat.byKey.get(key);
  const pair = e.group.length > 1 ? newId() : null;
  for (const d of e.group) {
    const base = { id: newId(), enabled: true, origin: { kind: "manual" as const }, note: null, ...(pair !== null ? { pair } : {}) };
    if (it !== undefined) {
      const restored = diffFromValue(it, key, it.read(wh), wh, undefined);
      if (restored !== null) back.push({ ...restored, ...base });
    } else if (d.op === "set") {
      const a = addressOf(d);
      const now = a === null ? null : boxAt(inputOf(wh), a);
      if (a !== null && now !== null) back.push({ ...d, ...base, value: now, before: structuredClone(now) });
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
  // 同じ所のオフの差分は、現状に戻す差分に置き換える（残すと、オンに戻したときに戻す差分と重なる）
  return { ...wh, proposals: wh.proposals.map((x) => (x.id === id ? { ...x, diffs: [...drop(x).diffs, ...back] } : x)) };
}

const isObjLike = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * このプランを現状に反映する: 作業中の世帯（土台を含む）を入力（現状）にする。反映したプランは差分が無くなり（現状と同じ）、土台を外す。
 * ほかのプランは差分のまま残り、当て先が無くなった・現状が変わった差分は「要確認」になる
 */
export function reflectPlan(wh: WorkingHousehold, cat: Catalog, id: string, now: string): WorkingHousehold {
  const { request, contingency } = applyPlan(wh, id, cat);
  return { ...wh, request, contingency, proposals: wh.proposals.map((p) => (p.id === id ? { ...p, base: null, diffs: [], reflectedAt: now, updatedAt: now } : p)) };
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
  if (it.key === "lever:fee") return v === true ? "FP顧問料を入れる" : v === false ? "FP顧問料を入れない" : "FP顧問料は今の契約だけ";
  if (it.control.kind === "rate" && typeof v === "string") return `金利${pctText(v)}`;
  if (it.control.kind === "outlook") return `金利の見込みを${it.text(v)}に`;
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

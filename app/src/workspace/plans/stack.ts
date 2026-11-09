// 土台のプランの差分と、その上のプランの差分を1つのプランにまとめる（0036 の追記 2026-11-08・0177）。
// プランの中は 外す → 足す → 値を変える の順に当てるので、土台で足した物を上のプランで外している差分をそのまま並べると、外すが先に
// 空振りして、足すが後から物を戻す（土台を外す・別のプランの値から保存すると中身が変わる）。まとめるときに、入力画面で同じプランの中で
// 足した物を外したときと同じように打ち消す:
// - 土台で足した物を外す: 両方とも捨てる（土台で足した物の中への差分も捨てる）。置き換えの組（外す＋足す）なら、土台の足す物を組の足す物にする
// - 土台で足した物の中の並びの要素を外す: 土台の足す物から、その要素を除く
// - 土台で足した並びの要素を外す: 両方とも捨てる（その要素の中への差分も捨てる）
// - 土台で値の全体を変えた所（ID を持たない並びの全体など）の中の並びに要素を足す・外す: 土台のその値に入れる・その値から除く
// 打ち消せなかった組（オフにしてある外すなど）は、当てるときに足したあとでもう一度外す（plans.ts の applyDiffs）
import { removeAt, sameJson, type PlanDiff } from "./diffs.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const objectIdOf = (t: unknown): string | null => (isObj(t) ? (typeof t.object === "string" ? t.object : typeof t.member === "string" ? t.member : null) : null);
const live = (d: PlanDiff) => d.enabled && d.unresolved !== true;
const isCollectionAdd = (d: PlanDiff, id: string) => d.op === "add" && "collection" in d.target && isObj(d.value) && d.value.id === id;
const isPrefix = (a: readonly string[], b: readonly string[]) => a.length <= b.length && a.every((x, i) => b[i] === x);
/** 物（か、その中の並びの要素）を向き先・場所に持つ差分（物を外す差分そのものは除く） */
const pointsInto = (d: PlanDiff, id: string, item?: string, at?: readonly string[]): boolean => {
  if (objectIdOf(d.target) !== id || (d.op === "remove" && d.item === null)) return false;
  if (item === undefined || at === undefined) return true;
  return d.item === item && d.at !== null && isPrefix(at, d.at);
};

/**
 * 土台で値の全体を変えた所（値を変える差分。ID を持たない並びの全体など）の中の並びに、要素を足す・外す。
 * 足せた・外せたら新しい値の箱、その所の中でなければ null
 */
function intoSet(d: PlanDiff, arrAt: readonly string[], op: { add: Obj } | { remove: string }): unknown {
  if (d.at === null) return null;
  const box = structuredClone(d.value) as Obj;
  let holder: Obj | unknown[] = box;
  let key: string | number = "value";
  for (const seg of arrAt.slice(d.at.length)) {
    const cur: unknown = Array.isArray(holder) ? holder[key as number] : holder[key as string];
    if (Array.isArray(cur)) {
      const i = cur.findIndex((e) => isObj(e) && e.id === seg);
      if (i < 0) return null;
      holder = cur;
      key = i;
    } else if (isObj(cur)) {
      holder = cur;
      key = seg;
    } else return null;
  }
  const arr: unknown = Array.isArray(holder) ? holder[key as number] : holder[key as string];
  if ("add" in op) {
    if (arr !== undefined && arr !== null && !Array.isArray(arr)) return null;
    const list = Array.isArray(arr) ? arr : [];
    if (!list.some((e) => isObj(e) && e.id === op.add.id)) list.push(structuredClone(op.add));
    if (Array.isArray(holder)) holder[key as number] = list;
    else holder[key as string] = list;
    return box;
  }
  if (!Array.isArray(arr)) return null;
  const i = arr.findIndex((e) => isObj(e) && e.id === op.remove);
  if (i < 0) return null;
  arr.splice(i, 1);
  return box;
}

/** 土台の差分 lower の上に、上のプランの差分 upper を重ねた1つのプランの差分（中身は、土台 → 上のプランの順に当てたのと同じ） */
export function stackDiffs(lower: readonly PlanDiff[], upper: readonly PlanDiff[]): PlanDiff[] {
  let low = [...lower];
  const dropped = new Set<string>();
  /** 並びの arrAt を中に含む、土台の値を変える差分（どれも当てると全体を書くので、全部に入れる・全部から除く） */
  const setsOver = (c: PlanDiff, arrAt: readonly string[]): PlanDiff[] => low.filter((d) => live(d) && d.op === "set" && d.item === c.item && sameJson(d.target, c.target) && d.at !== null && isPrefix(d.at, arrAt));
  /** 土台の値を変える差分に、要素を足す・外す。1つでも入れられたら true */
  const foldIntoSets = (c: PlanDiff, arrAt: readonly string[], op: { add: Obj } | { remove: string }): boolean => {
    let hit = false;
    for (const over of setsOver(c, arrAt)) {
      const next = intoSet(over, arrAt, op);
      if (next === null) continue;
      low = low.map((d) => (d.id === over.id ? { ...d, value: next } : d));
      hit = true;
    }
    return hit;
  };
  for (const c of upper) {
    if (!live(c) || (c.op !== "remove" && c.op !== "add")) continue;
    if (c.op === "add") {
      // 土台で全体を変えた値の中の並びに足す: その値に入れる（1つのプランの中は 足す → 値を変える の順なので、全体の値が足した要素を消す）
      if ("collection" in c.target || c.item === null || c.at === null || !isObj(c.value)) continue;
      if (foldIntoSets(c, c.at, { add: c.value })) dropped.add(c.id);
      continue;
    }
    const id = objectIdOf(c.target);
    if (id === null) continue;
    if (c.item === null) {
      const add = low.find((d) => live(d) && isCollectionAdd(d, id));
      if (add === undefined) continue;
      const mate = c.pair != null ? upper.find((d) => d.pair === c.pair && d.op === "add" && d.id !== c.id) : undefined;
      if (mate !== undefined) {
        // 土台で足した物を上のプランで置き換えた: 土台の足す物を、置き換えた後の物にする
        low = low.filter((d) => !pointsInto(d, id)).map((d) => (d.id === add.id ? { ...d, value: structuredClone(mate.value) } : d));
        dropped.add(mate.id);
      } else {
        // 土台で足した物を外した: 足すを捨てる（置き換えの組の足すなら、組の外すだけが残る）
        low = low.filter((d) => d.id !== add.id && !pointsInto(d, id)).map((d) => (add.pair != null && d.pair === add.pair ? { ...d, pair: null } : d));
      }
      dropped.add(c.id);
      continue;
    }
    if (c.at === null || c.at.length === 0) continue;
    const item = c.item;
    const at = c.at;
    const elId = at.at(-1) as string;
    let hit = false;
    // 土台で足した物の中の要素: 足す物から除く
    const owner = low.find((d) => live(d) && isCollectionAdd(d, id));
    if (owner !== undefined) {
      const obj = structuredClone(owner.value) as Obj;
      if (removeAt({ household: { list: [obj] } }, c) !== null) {
        low = low.map((d) => (d.id === owner.id ? { ...d, value: obj } : d));
        hit = true;
      }
    }
    // 土台で足した要素: 足すを捨てる
    const el = low.find((d) => live(d) && d.op === "add" && d.item === item && sameJson(d.target, c.target) && d.at !== null && sameJson(d.at, at.slice(0, -1)) && isObj(d.value) && d.value.id === elId);
    if (el !== undefined) {
      low = low.filter((d) => d.id !== el.id);
      hit = true;
    }
    // 土台で全体を変えた値の中の要素: その値から除く
    if (foldIntoSets(c, at.slice(0, -1), { remove: elId })) hit = true;
    if (!hit) continue;
    // その要素の中への差分も捨てる
    low = low.filter((d) => !pointsInto(d, id, item, at));
    dropped.add(c.id);
  }
  return [...low, ...upper.filter((d) => !dropped.has(d.id))];
}

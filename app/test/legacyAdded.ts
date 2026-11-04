// 前の版の入力のホームの「＋ 項目を追加」（2026-11-04 にやめた。0045 の追記）で足した物とピンを、前の版と同じ形で作る（テスト用）。
// 世帯ファイルの形は変えていないので、前の版で保存した世帯にはこの形の物とピン（addedItems の added:…）が入っている。今の版はそれを読んで計算し、ホームに出す。
// 足せたのは、名前を付けた支出（periodic）・留学（abroad。子を選ぶと abroad:子の ID）・介護の費用（care）。
// 子を選んだ留学で、その子の進路に高校・大学などがあったときは、子ども・教育の留学（今もある形）を足していたので、ここでは作らない（子の年齢の行の形だけ）
import type { Member, PeriodicExpense } from "../src/engine/types.ts";
import { mutate, newId, standardBox, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { saveItem } from "../src/workspace/input/items.ts";
import { addMonths, ageAt, ageReachedMonth } from "../src/workspace/levers.ts";

/** 前の版のひな形の仮の値の根拠の文 */
const PRESET_BASIS = "ひな形の仮の値（この世帯の額に直すか、このままなら「この値にする」）";
/** 前の版のひな形の額（留学 350万円・新しい支出 30万円） */
const ABROAD = 3_500_000;
const NEW_ITEM = 300_000;

/** 前の版の「＋ 項目を追加」で1件足した世帯（保存する前の下書き）と、そのピンの ID */
export function legacyAdded(wh: WorkingHousehold, key: string, id: () => string = newId): { wh: WorkingHousehold; itemId: string } {
  const [head, childId] = key.split(":") as [string, string | undefined];
  const base = wh.request.input.baseMonth;
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self") ?? h.members[0];
  if (self === undefined) throw new Error("本人がいない");
  const child: Member | undefined = childId === undefined ? undefined : h.members.find((m) => m.id === childId && m.kind === "child");
  if (childId !== undefined && (child === undefined || head !== "abroad")) throw new Error(key);
  const ref = id();
  let next: WorkingHousehold;
  let kind: "periodic" | "care";
  let art: "abroad" | "events";
  if (head === "abroad" || head === "periodic") {
    kind = "periodic";
    art = head === "abroad" ? "abroad" : "events";
    const at = addMonths(base, head === "abroad" ? 60 : 12);
    const childAt = child === undefined ? null : { memberAge: { member: child.id, years: Math.max(20, ageAt(child, base) + 1) } };
    const p: PeriodicExpense =
      head === "abroad"
        ? { id: ref, label: "留学", ...(childAt !== null ? { kind: "education" as const, row: "cf.expense.education" } : { row: "cf.expense.lumpSum.other", growth: { kind: "none" } }), from: childAt ?? { at }, to: childAt ?? { at }, everyYears: 1, amount: standardBox(ABROAD, PRESET_BASIS) }
        : { id: ref, label: "新しい支出", row: "cf.expense.lumpSum.other", from: { at }, to: { at }, everyYears: 1, growth: { kind: "none" }, amount: standardBox(NEW_ITEM, PRESET_BASIS) };
    next = mutate(wh, (hh) => void (hh.periodicExpenses ??= []).push(p));
  } else if (head === "care") {
    kind = "care";
    art = "events";
    const who: Member = h.members.find((m) => m.kind === "parent") ?? self;
    const at = who.kind === "self" ? ageReachedMonth(who, 80) : addMonths(base, 60);
    next = mutate(wh, (hh) => void (hh.careExpenses ??= []).push({ id: ref, member: who.id, from: { at }, months: 61, place: "home" }));
  } else throw new Error(key);
  const itemId = `added:${id()}`;
  return { wh: { ...next, addedItems: [...next.addedItems, { id: itemId, kind, ref, art }] }, itemId };
}

/** 前の版の「＋ 項目を追加」で足して保存した世帯 */
export function withLegacyAdded(wh: WorkingHousehold, keys: readonly string[], id: () => string = newId): WorkingHousehold {
  let w = wh;
  for (const k of keys) {
    const r = legacyAdded(w, k, id);
    w = saveItem(r.wh, r.itemId);
  }
  return w;
}

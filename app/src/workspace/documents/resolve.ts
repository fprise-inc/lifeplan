// 書類の候補の当て先を、今の世帯の入力の欄に当てる（0148 の2）。欄は入力の画面と同じ定義（form.ts の FieldDef）を使い、
// 入力項目ID・場所 at・人・物で探す。1つに決まらなければ FP が選ぶ（黙って当てない）。
// - 物（object）: その物の欄（当て先の向き先がその物か、欄のキーにその物の ID がある）
// - 人（member）: その人の欄（向き先がその人・その人の物〔member・owner・insured・policyholder がその人〕・欄のキーにその人の ID）。
//   働き方の期間の欄が何本も当たるときは、今の働き方の期間を先にする
// - どちらも無い: 世帯で1つの値（前提条件など。向き先が plan）。世帯で1つの欄が無ければ、その入力項目の欄から FP が物を選ぶ（0152 の3）
// - 場所 at を書かない・明細の ID を除いて書いた候補の欄の選び方は placesOf（0152 の3）
import type { StageId } from "../input/form.ts";
import type { FieldDef, Level } from "../input/form.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { buildStages } from "../input/stages/index.ts";
import { fieldAddress } from "../input/valueState.ts";
import { roles } from "../roles.ts";
import { currentPeriodId, findObject, readAt, type Address } from "../store/readings.ts";
import type { CandidateTarget, DocumentReading } from "./types.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** 入力の欄の1つ（どのカード・まとまりの欄か） */
export interface FieldPlace {
  field: FieldDef;
  card: StageId;
  cardLabel: string;
  /** まとまりの名前: 欄の名前 */
  label: string;
  level: Level;
  address: Address | null;
}

/**
 * 世帯の全部の欄（見せるだけの欄は除く）。同じ当て先の欄が何か所にもあるときは1つにする: 当て先の値をそのまま見せる欄を先に
 * （標準の「年収（賞与込み）」のように2つの値を合わせて見せる欄より、当て先の値そのものの欄）、同じなら詳細の欄（当て先の意味どおりの名前の欄）
 */
export function fieldPlaces(wh: WorkingHousehold): FieldPlace[] {
  const byAddress = new Map<string, FieldPlace[]>();
  const order: string[] = [];
  for (const stage of buildStages(wh)) {
    for (const section of stage.sections)
      for (const group of section.groups)
        for (const f of group.fields) {
          if (f.readOnly !== undefined || f.item === null) continue;
          const address = fieldAddress(f, wh);
          const id = address !== null ? JSON.stringify(address) : `key:${f.key}`;
          const where = group.title ?? section.title;
          const level: Level = section.level === "detail" || group.level === "detail" || f.level === "detail" ? "detail" : "simple";
          const place: FieldPlace = { field: f, card: stage.id, cardLabel: stage.label, label: where !== undefined && where !== f.label ? `${where}: ${f.label}` : f.label, level, address };
          const list = byAddress.get(id);
          if (list === undefined) {
            byAddress.set(id, [place]);
            order.push(id);
          } else list.push(place);
        }
  }
  const input = wh.request.input as unknown as Obj;
  const shown = (p: FieldPlace): boolean => {
    if (p.address === null) return true;
    const raw = readAt(input, p.address);
    const stored = isObj(raw) && typeof raw.state === "string" ? (raw.value ?? (isObj(raw.substitute) ? raw.substitute.value : undefined) ?? null) : (raw ?? null);
    return JSON.stringify(stored) === JSON.stringify(p.field.get(wh).value ?? null);
  };
  return order.map((id) => {
    const list = byAddress.get(id) as FieldPlace[];
    if (list.length === 1) return list[0] as FieldPlace;
    const direct = list.filter(shown);
    const pool = direct.length > 0 ? direct : list;
    return pool.find((p) => p.level === "detail") ?? (pool[0] as FieldPlace);
  });
}

/** 欄の一覧を欄のキーで引く */
export const placeByKey = (places: readonly FieldPlace[], key: string): FieldPlace | undefined => places.find((p) => p.field.key === key);

export type Resolution = { kind: "field"; place: FieldPlace } | { kind: "choose"; places: FieldPlace[] } | { kind: "missing"; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** 候補の人（続柄の鍵・holder・構成員の ID）を構成員の ID にする。決まらなければ null */
export function memberIdOf(wh: WorkingHousehold, reading: Pick<DocumentReading, "holder">, member: string | undefined): string | null {
  if (member === undefined) return null;
  if (member === "holder") return reading.holder ?? null;
  if (UUID.test(member)) return wh.request.input.household.members.some((m) => m.id === member) ? member : null;
  return roles(wh.request).find((r) => r.key === member)?.member.id ?? null;
}

/** 人の物を指す欄（その物がこの人の物か） */
const OWNER_KEYS = ["member", "owner", "insured", "policyholder", "annuitant"] as const;
function belongsTo(wh: WorkingHousehold, objectId: string, memberId: string): boolean {
  const o = findObject(wh.request.input as unknown as Obj, objectId);
  return o !== undefined && OWNER_KEYS.some((k) => o[k] === memberId);
}

const keyHas = (f: FieldDef, id: string): boolean => f.key.split("/").includes(id);
/** 欄のキーの中の ID（当て先の無い欄は、キーの中の物・人の ID で持ち主を見る） */
const keyIds = (f: FieldDef): string[] => f.key.split("/").filter((x) => UUID.test(x));
const sameAt = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
/** 場所から、物の中の明細の ID（保険の保障・ローンの金利の段階など）を除いた形 */
const withoutIds = (a: readonly string[]): string[] => a.filter((x) => !UUID.test(x));

/**
 * 入力項目と場所で欄を選ぶ（0152 の3）:
 * - 場所を書かない候補は、場所の無い欄（当て先の無い欄・場所が空の欄）を先にする（保険の「払い方」と「保険料の額」のように、同じ入力項目に
 *   場所のある欄と無い欄があるとき）。場所の無い欄が無ければ、その入力項目の欄の全部
 * - 場所を書いた候補は、場所の同じ欄。無ければ、欄の場所から明細の ID を除いた形が同じ欄（書類を読む AI は保障・金利の段階の ID を
 *   知らないので ["amount"]・["rate"] のように書く。何本も当たれば FP が選ぶ）
 */
function placesOf(places: readonly FieldPlace[], target: CandidateTarget): FieldPlace[] {
  const all = places.filter((p) => p.field.item === target.item);
  const at = target.at;
  if (at === undefined) {
    const plain = all.filter((p) => p.address === null || p.address.at.length === 0);
    return plain.length > 0 ? plain : all;
  }
  const exact = all.filter((p) => p.address !== null && sameAt(p.address.at, at));
  if (exact.length > 0) return exact;
  return all.filter((p) => p.address !== null && p.address.at.some((x) => UUID.test(x)) && sameAt(withoutIds(p.address.at), at));
}

/**
 * 候補の当て先を欄に当てる。created は新しい物の鍵 → 作った物の ID（足した物だけ）
 */
export function resolveTarget(wh: WorkingHousehold, places: readonly FieldPlace[], reading: DocumentReading, target: CandidateTarget, created: ReadonlyMap<string, string>): Resolution {
  const byItem = placesOf(places, target);
  if (byItem.length === 0) return { kind: "missing", reason: "この世帯に、この値を入れる欄がありません" };
  let objectId: string | null = null;
  if (target.newObject !== undefined) {
    objectId = created.get(target.newObject) ?? null;
    if (objectId === null) return { kind: "missing", reason: "新しい物を足すと入れられます" };
  } else if (target.object !== undefined) {
    if (findObject(wh.request.input as unknown as Obj, target.object) === undefined) return { kind: "missing", reason: "当てる物がこの世帯にありません" };
    objectId = target.object;
  }
  let found: FieldPlace[];
  if (objectId !== null) {
    const id = objectId;
    found = byItem.filter((p) => (p.address !== null && "object" in p.address.target && p.address.target.object === id) || keyHas(p.field, id));
  } else if (target.member !== undefined) {
    const m = memberIdOf(wh, reading, target.member);
    if (m === null) return { kind: "missing", reason: target.member === "holder" ? "書類の名義（どなたの書類か）を選んでください" : "当てる人がこの世帯にいません" };
    found = byItem.filter((p) => {
      const t = p.address?.target;
      if (t !== undefined && "member" in t) return t.member === m;
      // 構成員そのものの欄（申告の仕方など。向き先がその構成員）もその人の欄
      if (t !== undefined && "object" in t) return t.object === m || belongsTo(wh, t.object, m) || keyHas(p.field, m);
      return keyIds(p.field).some((id) => id === m || belongsTo(wh, id, m));
    });
    // 働き方の期間が何本も当たるときは、今の期間を先にする
    if (found.length > 1) {
      const cur = currentPeriodId(wh.request.input as unknown as Obj, m);
      const now = found.filter((p) => cur !== null && p.address !== null && "object" in p.address.target && p.address.target.object === cur);
      if (now.length === 1) found = now;
    }
  } else {
    found = byItem.filter((p) => p.address === null || "plan" in p.address.target);
    // 人も物も書かない候補で、世帯で1つの欄が無い（ローンの残高のように物の欄だけの入力項目）ときは、その入力項目の欄の全部から FP が
    // 物を選ぶ（1本しか無くても選んでもらう。どの物の値かを書類からは決めない。0152 の3）
    if (found.length === 0) return { kind: "choose", places: byItem };
  }
  if (found.length === 0) return { kind: "missing", reason: "この世帯に、この値を入れる欄がありません" };
  if (found.length === 1) return { kind: "field", place: found[0] as FieldPlace };
  return { kind: "choose", places: found };
}

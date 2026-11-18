// Web のヒアリングの届いた知らせを、上の帯のベル（お知らせの一覧。0087）にも出す（0192 の追記 2026-11-18）。
// - 開いている世帯は今まで通り（App.tsx の checkArrivals）。開いていない世帯は、本体に開かずに読んでもらった依頼の欄
//   （store.peekHearing。届いたかの確かめに要る欄だけ。開いた印を変えない）で、受け付けている依頼だけを確かめる
// - 本体に読んでもらうのは、世帯の一覧の更新日時が変わった世帯だけ（毎回すべての世帯ファイルを開かない）
// - 結果はアプリを開いている間だけ覚える（web.ts の arrivals と同じ。世帯ファイルには置かない）
// - ベルの1件は「世帯」の種類・ふつう（件数に数える）。受け取ったら（まだ受け取っていない答え・書類が無くなったら）一覧から消える
import type { StoredHousehold } from "../../engine/host.ts";
import { relay, type RelayTransport } from "../../../../hearing/src/web/protocol.ts";
import { householdKey } from "../notices/center.ts";
import { allArrivals, noteArrival, splitSummary, touchArrivals } from "./web.ts";

/** 開いていない世帯の Web の依頼の1件（本体が返す、確かめに要る欄だけ。答え・書類・選び方・URL は来ない） */
export interface HearingPeek {
  requestId: string;
  serverId: string;
  pickupToken: string;
  expiresAt: string;
  state: string;
  /** 答えをもう受け取ったか */
  received: boolean;
  /** 受け取った書類の送りの名前 */
  batchIds: string[];
}

const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";

/** 本体の返した並びを読む（形の合わない1件は捨てる） */
export function readPeeks(v: unknown): HearingPeek[] {
  if (!Array.isArray(v)) return [];
  const out: HearingPeek[] = [];
  for (const x of v as unknown[]) {
    if (typeof x !== "object" || x === null) continue;
    const o = x as Record<string, unknown>;
    if (!isStr(o.requestId) || !isStr(o.serverId) || !isStr(o.pickupToken) || !isStr(o.expiresAt) || !isStr(o.state)) continue;
    if (o.state === "cancelled") continue;
    const batchIds = Array.isArray(o.batchIds) ? (o.batchIds as unknown[]).filter(isStr) : [];
    out.push({ requestId: o.requestId, serverId: o.serverId, pickupToken: o.pickupToken, expiresAt: o.expiresAt, state: o.state, received: o.received === true, batchIds });
  }
  return out;
}

/** 本体に読んでもらった結果の覚え（世帯の内部ID → 一覧の更新日時と依頼）。アプリを開いている間だけ */
export type PeekCache = Map<string, { updatedAt: string; peeks: HearingPeek[] }>;

const liveOf = (p: HearingPeek, now: Date) => Date.parse(p.expiresAt) > now.getTime();

/** 開いていない世帯のその依頼が、まだ受け付けているか（覚えた欄で。期限の中） */
export function peekedLive(cache: PeekCache, household: string, requestId: string, now: Date): boolean {
  return cache.get(household)?.peeks.some((p) => p.requestId === requestId && liveOf(p, now)) === true;
}

/** 覚えた結果から、その世帯の依頼のうち並びに無いもの（取り消した・受け付けを終えた・期限の過ぎたもの）を忘れる */
function forgetExcept(household: string, keep: ReadonlySet<string>): boolean {
  let changed = false;
  for (const [id, a] of allArrivals()) {
    if (a.household === household && !keep.has(id)) {
      noteArrival(id, null);
      changed = true;
    }
  }
  return changed;
}

/** 1つの世帯の、受け付けている依頼を確かめる（つながらなければ前の結果のまま。サーバーから消えていれば忘れる） */
export async function checkPeeks(household: string, peeks: readonly HearingPeek[], t: RelayTransport, now: Date = new Date()): Promise<void> {
  for (const p of peeks) {
    if (!liveOf(p, now)) continue;
    try {
      const st = await relay.status(t, p.serverId, p.pickupToken);
      const known = new Set(p.batchIds);
      noteArrival(p.requestId, { answers: st.answers && !p.received, batches: st.batches.filter((b) => !known.has(b.batchId)).length, submitted: st.submitted, at: now.toISOString(), household });
    } catch (err) {
      if (err instanceof Error && (err.message === "E_RELAY_GONE" || err.message === "E_RELAY_EXPIRED")) noteArrival(p.requestId, null);
      // つながらない: 前の結果のまま（次の確かめで取り直す）
    }
  }
}

export interface UnopenedCheck {
  /** 保存した世帯の一覧（見本は入れない） */
  list: readonly StoredHousehold[];
  /** 今開いている世帯の内部ID（開いている世帯は App.tsx の checkArrivals で確かめるので飛ばす） */
  current: string | null;
  /** 本体に、開かずに依頼の欄を読んでもらう（返った値は readPeeks で読む） */
  peek: (id: string) => Promise<unknown>;
  call: RelayTransport;
  cache: PeekCache;
  now?: Date;
}

/**
 * 開いていない世帯の、受け付けている Web の依頼を確かめる1回分。一覧の更新日時が前と同じ世帯は本体に読み直してもらわない
 * （依頼の無い世帯は、サーバーにも聞かない）。一覧から消えた世帯の結果は忘れる
 */
export async function checkUnopened(c: UnopenedCheck): Promise<void> {
  const now = c.now ?? new Date();
  const ids = new Set(c.list.map((h) => h.id));
  let changed = false;
  for (const id of [...c.cache.keys()]) {
    if (ids.has(id)) continue;
    c.cache.delete(id);
    if (id !== c.current) changed = forgetExcept(id, new Set()) || changed;
  }
  for (const h of c.list) {
    if (h.id === c.current) continue;
    let got = c.cache.get(h.id);
    if (got === undefined || got.updatedAt !== h.updatedAt) {
      // 読めない世帯（壊れた・鍵が無い・古い本体）は、依頼なしとして覚える（一覧の更新日時が変わったら読み直す）
      const peeks = await c.peek(h.id).then(readPeeks, () => []);
      got = { updatedAt: h.updatedAt, peeks };
      c.cache.set(h.id, got);
    }
    const live = got.peeks.filter((p) => liveOf(p, now));
    changed = forgetExcept(h.id, new Set(live.map((p) => p.requestId))) || changed;
    if (live.length > 0) await checkPeeks(h.id, live, c.call, now);
  }
  if (changed) touchArrivals();
}

/** ベルに出す1件（画面の部品と既読の印は App.tsx で付ける） */
export interface HearingBellItem {
  /** 既読の印の鍵（新しい書類が届けば変わり、また未読になる） */
  key: string;
  householdId: string;
  requestId: string;
  title: string;
  body: string;
  /** 関係する世帯（顧客番号と構成の要約） */
  household: string;
}

/** 世帯の一覧の1件の見せ方（顧客番号と構成の要約。氏名は持たない） */
export function householdLabel(h: Pick<StoredHousehold, "customerNo" | "summary">): string {
  const family = splitSummary(h.summary).family.trim();
  return family === "" ? h.customerNo : `${h.customerNo}（${family}）`;
}

/**
 * ベルに出す届いた知らせ: まだ受け取っていない答えか書類のある依頼ごとに1件。live はその依頼がまだ受け付けているか
 * （開いている世帯は世帯の依頼の記録、開いていない世帯は覚えた欄で）。一覧に無い世帯（見本・消した世帯）は出さない
 */
export function hearingBellItems(households: readonly Pick<StoredHousehold, "id" | "customerNo" | "summary">[], live: (household: string, requestId: string) => boolean): HearingBellItem[] {
  const out: HearingBellItem[] = [];
  for (const [requestId, a] of allArrivals()) {
    if (a.household === undefined || !(a.answers || a.batches > 0) || !live(a.household, requestId)) continue;
    const h = households.find((x) => x.id === a.household);
    if (h === undefined) continue;
    const label = householdLabel(h);
    const docs = a.batches > 0 ? `書類（${a.batches}回分）` : "";
    out.push({
      key: householdKey(h.id, `hearing:${requestId}:${a.answers ? "answers" : "documents"}:${a.batches}`),
      householdId: h.id,
      requestId,
      title: a.answers ? "事前ヒアリングの回答が届きました" : "事前ヒアリングの書類が届きました",
      body: a.answers
        ? `世帯 ${label}の依頼 ${requestId} に、お客さまの回答${docs !== "" ? `と${docs}` : ""}が届いています。「受け取る」を押すと世帯ファイルに入り、そのまま取り込みの候補の画面に進みます。`
        : `世帯 ${label}の依頼 ${requestId} に、待っていた${docs}が届いています。「届いた書類を受け取る」を押すと世帯ファイルに入ります。`,
      household: label,
    });
  }
  return out.sort((x, y) => (x.household < y.household ? -1 : x.household > y.household ? 1 : x.requestId < y.requestId ? -1 : 1));
}

// ---- ベルから「受け取る」へ（依頼の一覧のその行を見せて、受け取るボタンに移す） ----

let focusWanted: string | null = null;

/** 依頼の一覧が出たら、その依頼の行の「受け取る」へ移ってほしい（ベルの知らせから） */
export function askFocus(requestId: string): void {
  focusWanted = requestId;
  touchArrivals();
}

/** 移ってほしい依頼（依頼の一覧が、その行を出したら takeFocus で受け取る） */
export function wantedFocus(): string | null {
  return focusWanted;
}

export function takeFocus(requestId: string): void {
  if (focusWanted === requestId) focusWanted = null;
}

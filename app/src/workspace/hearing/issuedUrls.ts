// 「発行した URL」の表に並べる行（0222 の追記 2026-11-20。利用者の判断で、FP が URL生成で作った URL と、AI が発行してこの世帯に結びついた URL を
// 1つの表にまとめた）。画面（WebRequests.tsx）はこの関数の答えのとおりに並べる。
// - この世帯のファイルにある依頼（FP が作った物も、AI が発行して世帯へ移した物も）: 「URL の一覧に出すか」（web.ts の listed）で選ぶ
//   （取り込み済みで書類待ちも届いた書類も無い依頼は、表の下の「取り込み済みの URL の回答」から見る）
// - AI が発行し、この世帯に結びついているが、まだ世帯のファイルに移っていない依頼（事務所データ。閲覧だけで開いた世帯・保存できなかった世帯）:
//   世帯のファイルに同じ依頼番号があれば、世帯の方だけを出す
// - 世帯の決まっていない、AI が発行した依頼は、どの世帯の表にも入れない（表の下のリンクから開く。unassignedLink）
// - 並び順: 発行の日時の新しい順（同じ日時なら依頼番号の順）
import type { WorkingHousehold } from "../input/household.ts";
import { unassignedAccepting, unassignedArrived, type OfficeHearing } from "./aiHearing.ts";
import { listed, webLog, type WebLogEntry } from "./web.ts";

export interface IssuedRow {
  requestId: string;
  /** 作った側（fp は URL生成で作った依頼、ai は AI が発行した依頼） */
  by: "fp" | "ai";
  /** household はこの世帯のファイルにある依頼（受け取る・取り込むなどの操作ができる）、office は事務所データにある依頼（まだ世帯に移っていない） */
  place: "household" | "office";
  entry: WebLogEntry;
}

/** AI が発行した依頼のうち、表に入れるもの（事務所データと、開いている保存した世帯の内部 ID。見本・保存していない世帯は null） */
export interface IssuedAi {
  store: OfficeHearing;
  householdId: string | null;
}

/** 「発行した URL」の表の行（新しい順） */
export function issuedRows(wh: WorkingHousehold, now: Date, ai?: IssuedAi): IssuedRow[] {
  const log = webLog(wh);
  const inHousehold = new Set(log.map((e) => e.record.requestId));
  const rows: IssuedRow[] = log.filter((e) => listed(e, now, wh)).map((e) => ({ requestId: e.record.requestId, by: e.origin?.kind === "ai" ? "ai" : "fp", place: "household", entry: e }));
  if (ai !== undefined && ai.householdId !== null) {
    for (const r of ai.store.requests) {
      if (r.householdId !== ai.householdId || inHousehold.has(r.entry.record.requestId)) continue;
      rows.push({ requestId: r.entry.record.requestId, by: "ai", place: "office", entry: r.entry });
    }
  }
  return rows.sort((a, b) => (a.entry.record.issuedAt === b.entry.record.issuedAt ? (a.requestId < b.requestId ? -1 : 1) : a.entry.record.issuedAt < b.entry.record.issuedAt ? 1 : -1));
}

/**
 * 表の下に出す「まだ世帯の決まっていない、AI が発行した URL（N件）」のリンクの数（受け付け中の物。0件ならリンクを出さない）と、
 * そのうち答えか書類が届いている数。取り消した・期限の過ぎた依頼は、もう受け取れないので数えない（一覧では見られる）
 */
export function unassignedLink(store: OfficeHearing, now: Date): { count: number; arrived: number } {
  return { count: unassignedAccepting(store, now), arrived: unassignedArrived(store, now) };
}

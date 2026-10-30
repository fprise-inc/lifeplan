// お知らせの一覧（0087）。上の帯のベルを押すと開く一覧の中身を、画面の部品から切り離して決める（テストで確かめる）。
// - 種類は4つ: ファイナンシアから（app）・制度・データの更新（data）・世帯（household）・事務所（office）。宣伝の種類は作らない
// - 急ぎ具合は3段: 重大（帯の札でも出す）・ふつう（件数に数える）・参考（一覧に入るだけで件数に数えない）
// - 開いたものは既読にして一覧に残す（消さない）。既読の印と受付番号は手元（この PC のアプリのデータ）にだけ置き、配信元には何も送り返さない
// - 配信元のお知らせ（app・data）は全員に同じ一覧を配る。受付番号の並びを持つお知らせは、手元に覚えた番号と合うときだけ出す
import { RECEIPT_PATTERN, type Receipt } from "./receipts.ts";

export type NoticeCategory = "app" | "data" | "household" | "office";
export type NoticeUrgency = "critical" | "normal" | "info";

export const CATEGORIES: readonly { id: NoticeCategory; label: string; short: string }[] = [
  { id: "app", label: "ファイナンシアから", short: "ファイナンシア" },
  { id: "data", label: "制度・データの更新", short: "制度・データ" },
  { id: "household", label: "世帯", short: "世帯" },
  { id: "office", label: "事務所", short: "事務所" },
];
export const URGENCY_LABEL: Record<NoticeUrgency, string> = { critical: "重大", normal: "ふつう", info: "参考" };

/** 一覧の1件（画面に出す形） */
export interface CenterItem {
  /** 既読の印の鍵（手元に覚える。一覧の中で重ならない） */
  key: string;
  category: NoticeCategory;
  urgency: NoticeUrgency;
  /** 日付（YYYY-MM-DD）。今の状態の知らせ（世帯・事務所）は null */
  date: string | null;
  /** 何があったか（一覧の1行目・詳しい中身の見出し） */
  title: string;
  /** 何が変わったか */
  body: string;
  /** 関係する世帯（顧客番号など。無ければ null） */
  household: string | null;
  /** 手元に覚えた番号と合った受付番号（あれば「あなたの要望に対応しました」） */
  receipts: string[];
  /** その画面を開くボタン（無ければ null） */
  action: { label: string; run: () => void } | null;
  read: boolean;
}

/** 件数に数えるもの: 未読で、参考でないもの */
export const countsAsUnread = (i: Pick<CenterItem, "read" | "urgency">) => !i.read && i.urgency !== "info";
export const unreadCount = (items: readonly Pick<CenterItem, "read" | "urgency">[]) => items.filter(countsAsUnread).length;

/** 一覧の絞り込み: 未読だけ（参考の未読も見せる）／すべて、と種類 */
export function filterItems<T extends Pick<CenterItem, "read" | "category">>(items: readonly T[], f: { unreadOnly: boolean; category: NoticeCategory | null }): T[] {
  return items.filter((i) => (!f.unreadOnly || !i.read) && (f.category === null || i.category === f.category));
}

const URGENCY_ORDER: Record<NoticeUrgency, number> = { critical: 0, normal: 1, info: 2 };
/** 並び: 重大を先に、次に今の状態の知らせ（日付なし）、配信元のお知らせは新しい順。同じなら元の順 */
export function sortItems<T extends Pick<CenterItem, "urgency" | "date">>(items: readonly T[]): T[] {
  return items
    .map((x, k) => ({ x, k }))
    .sort((a, b) => {
      const u = (a.x.urgency === "critical" ? 0 : 1) - (b.x.urgency === "critical" ? 0 : 1);
      if (u !== 0) return u;
      const da = a.x.date ?? "9999-99-99";
      const db = b.x.date ?? "9999-99-99";
      if (da !== db) return da < db ? 1 : -1;
      return URGENCY_ORDER[a.x.urgency] - URGENCY_ORDER[b.x.urgency] || a.k - b.k;
    })
    .map((v) => v.x);
}

/** 日付の文（2026-10-30 → 2026年10月30日） */
export function dateText(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m === null ? d : `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

// ---- 配信元のお知らせ（形式は app/schemas/notices.json。署名の確認は本体が済ませ、確かめた中身だけを受け取る） ----

/** 配信元のお知らせで開ける画面（関係する画面。「事務所」「世帯」の知らせの画面と同じ名前） */
export const FEED_SCREENS = ["plans", "work", "family", "storage", "office", "households", "recovery"] as const;
export type FeedScreen = (typeof FEED_SCREENS)[number];

export interface FeedNotice {
  id: string;
  kind: "app" | "data";
  urgency: NoticeUrgency;
  date: string;
  title: string;
  body: string;
  /** 対象の版の範囲（どちらも含む。無ければ全部の版） */
  appVersions?: { min?: string; max?: string };
  /** 受付番号の並び（あれば、手元に覚えた番号と合う人にだけ出す） */
  receipts?: string[];
  /** 関係する画面 */
  screen?: FeedScreen;
}

export const FEED_FORMAT = "financia-notices";
/** 読める形式の版の MAJOR（MINOR が上がった一覧は、知らない欄を無視して読む。0001） */
export const FEED_MAJOR = 1;

const isStr = (v: unknown): v is string => typeof v === "string";
const VERSION = /^\d+\.\d+\.\d+$/;

/**
 * 配信元のお知らせの一覧を読む。形の合わない1件は捨てる（全体は捨てない）。知らない種類・急ぎ具合・画面の1件も捨てる
 * （新しい種類を足した一覧を古いアプリが読んでも、知らない物は出さない）。宣伝の種類は無い
 */
export function parseFeed(text: string | null): FeedNotice[] {
  if (text === null || text === "") return [];
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof doc !== "object" || doc === null) return [];
  const d = doc as { format?: unknown; formatVersion?: unknown; notices?: unknown };
  if (d.format !== FEED_FORMAT || !isStr(d.formatVersion) || Number(d.formatVersion.split(".")[0]) !== FEED_MAJOR || !Array.isArray(d.notices)) return [];
  const out: FeedNotice[] = [];
  const seen = new Set<string>();
  for (const raw of d.notices as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const n = raw as Record<string, unknown>;
    if (!isStr(n.id) || n.id === "" || seen.has(n.id)) continue;
    if (n.kind !== "app" && n.kind !== "data") continue;
    if (n.urgency !== "critical" && n.urgency !== "normal" && n.urgency !== "info") continue;
    if (!isStr(n.date) || !/^\d{4}-\d{2}-\d{2}$/.test(n.date) || !isStr(n.title) || n.title === "" || !isStr(n.body)) continue;
    const item: FeedNotice = { id: n.id, kind: n.kind, urgency: n.urgency, date: n.date, title: n.title, body: n.body };
    if (n.appVersions !== undefined) {
      const v = n.appVersions as { min?: unknown; max?: unknown } | null;
      if (typeof v !== "object" || v === null) continue;
      if ((v.min !== undefined && !(isStr(v.min) && VERSION.test(v.min))) || (v.max !== undefined && !(isStr(v.max) && VERSION.test(v.max)))) continue;
      item.appVersions = { ...(isStr(v.min) ? { min: v.min } : {}), ...(isStr(v.max) ? { max: v.max } : {}) };
    }
    if (n.receipts !== undefined) {
      if (!Array.isArray(n.receipts) || n.receipts.length === 0 || !n.receipts.every((r) => isStr(r) && RECEIPT_PATTERN.test(r))) continue;
      item.receipts = n.receipts as string[];
    }
    if (n.screen !== undefined) {
      if (!FEED_SCREENS.includes(n.screen as FeedScreen)) continue;
      item.screen = n.screen as FeedScreen;
    }
    seen.add(n.id);
    out.push(item);
  }
  return out;
}

/** 版の比べ方（x.y.z を数で） */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).slice(0, 3).map(Number);
  const pb = b.split(/[.+-]/).slice(0, 3).map(Number);
  for (let k = 0; k < 3; k++) {
    const d = (pa[k] ?? 0) - (pb[k] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** このアプリの版が対象か */
export function inVersionRange(v: FeedNotice["appVersions"], appVersion: string): boolean {
  if (v === undefined) return true;
  if (v.min !== undefined && compareVersions(appVersion, v.min) < 0) return false;
  if (v.max !== undefined && compareVersions(appVersion, v.max) > 0) return false;
  return true;
}

/**
 * 配信元のお知らせのうち、この PC で出すもの: 対象の版の範囲に入り、受付番号の並びがあるものは手元に覚えた番号と1つでも合うもの。
 * 合った番号を添える（合わない受付番号つきのお知らせは、一覧にも出さない）
 */
export function visibleFeed(feed: readonly FeedNotice[], p: { appVersion: string; receipts: readonly Pick<Receipt, "code">[] }): (FeedNotice & { matched: string[] })[] {
  const mine = new Set(p.receipts.map((r) => r.code));
  const out: (FeedNotice & { matched: string[] })[] = [];
  for (const n of feed) {
    if (!inVersionRange(n.appVersions, p.appVersion)) continue;
    const matched = (n.receipts ?? []).filter((r) => mine.has(r));
    if (n.receipts !== undefined && matched.length === 0) continue;
    out.push({ ...n, matched });
  }
  return out;
}

/** 受付番号に対応したお知らせの見出しに添える文 */
export const RECEIPT_MATCH_TEXT = "あなたの要望に対応しました";

// ---- 手元の状態（既読の印と受付番号）。この PC のアプリのデータに置く（本体の notice_local_*。0087 の4） ----

export interface LocalState {
  /** 既読にした鍵 → 既読にした日（YYYY-MM-DD） */
  read: Record<string, string>;
  receipts: Receipt[];
}
export const EMPTY_LOCAL: LocalState = { read: {}, receipts: [] };
/** 覚えておく既読の印の数の上限（古いものから忘れる） */
export const MAX_READ = 2000;

/** 手元の状態を読む（形の合わない所は捨てる） */
export function readLocal(v: unknown): LocalState {
  if (typeof v !== "object" || v === null) return EMPTY_LOCAL;
  const o = v as { read?: unknown; receipts?: unknown };
  const read: Record<string, string> = {};
  if (typeof o.read === "object" && o.read !== null) for (const [k, d] of Object.entries(o.read as Record<string, unknown>)) if (isStr(d)) read[k] = d;
  const receipts: Receipt[] = [];
  if (Array.isArray(o.receipts))
    for (const r of o.receipts as unknown[]) {
      const x = r as Partial<Receipt> | null;
      if (x === null || typeof x !== "object" || !isStr(x.code) || !RECEIPT_PATTERN.test(x.code) || !isStr(x.on) || receipts.some((y) => y.code === x.code)) continue;
      receipts.push({ code: x.code, on: x.on, ...(x.manual === true ? { manual: true } : {}) });
    }
  return { read, receipts };
}

/** 既読にする（もう既読のものは日を変えない。上限を超えたら古い日のものから忘れる） */
export function markRead(s: LocalState, keys: readonly string[], on: string): LocalState {
  const fresh = keys.filter((k) => s.read[k] === undefined);
  if (fresh.length === 0) return s;
  let entries = [...Object.entries(s.read), ...fresh.map((k) => [k, on] as [string, string])];
  if (entries.length > MAX_READ) entries = entries.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)).slice(entries.length - MAX_READ);
  return { ...s, read: Object.fromEntries(entries) };
}

/** 世帯の知らせの既読の鍵（同じ知らせの ID が別の世帯にもありうるので、世帯の内部 ID を添える） */
export const householdKey = (householdId: string, noticeId: string) => `household:${householdId}:${noticeId}`;
/** 配信元のお知らせの既読の鍵 */
export const feedKey = (id: string) => `feed:${id}`;

/** 今日の日付（この PC の暦で YYYY-MM-DD） */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

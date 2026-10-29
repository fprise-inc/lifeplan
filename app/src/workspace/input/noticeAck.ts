// 確かめの注意の「確認した」（0041・0055 の追記）: 確かめた注意を、その世帯では出さないようにする。世帯ファイルの household.noticeAcks（形式の版 0.35 から）に残す。
// 計算には使わない。値も変えない（注意を出さないだけ）。
// - 印は注意の ID（確かめの一覧の注意の ID。例: insurance/overlap/<被保険者>|medical）と、そのときの中身（注意を作った物の ID の並び。並びは整えて持つ）で持つ。
//   中身が変わったら（物を足した・外した）、同じ ID でも印は当たらず、注意はまた出る
// - 同じ ID の印は1つだけ（付け直すと置き換える）。印が無くなったら欄ごと外す
import type { WorkingHousehold } from "./household.ts";

export interface NoticeAck {
  /** 注意の ID */
  id: string;
  /** 確認したときの中身（注意を作った物の ID。整えた並び） */
  of: string[];
  /** 確認した日（YYYY-MM-DD） */
  on: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sorted = (of: readonly string[]): string[] => [...new Set(of)].sort();
const sameOf = (a: readonly string[], b: readonly string[]): boolean => {
  const x = sorted(a);
  const y = sorted(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** 読んだ値から印の一覧（形の合わない行・同じ ID の2つ目は捨てる） */
export function readNoticeAcks(v: unknown): NoticeAck[] {
  if (!Array.isArray(v)) return [];
  const out: NoticeAck[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    const { id, of, on } = x;
    if (typeof id !== "string" || id === "" || !Array.isArray(of) || of.length === 0 || !of.every((s) => typeof s === "string" && s !== "") || typeof on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(on)) continue;
    if (out.some((a) => a.id === id)) continue;
    out.push({ id, of: sorted(of as string[]), on });
  }
  return out;
}

/** 今日（YYYY-MM-DD。手元の時計の日付） */
export function ackToday(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const noticeAcks = (wh: WorkingHousehold): NoticeAck[] => wh.noticeAcks ?? [];

/** その注意を、今の中身のまま確認したか（確認した印。中身が変わっていれば null） */
export function ackOf(wh: WorkingHousehold, id: string, of: readonly string[]): NoticeAck | null {
  return noticeAcks(wh).find((a) => a.id === id && sameOf(a.of, of)) ?? null;
}

/** 確認した（on は YYYY-MM-DD）・また出す（null）。印が無くなったら欄ごと外す */
export function setNoticeAck(wh: WorkingHousehold, id: string, of: readonly string[], on: string | null): WorkingHousehold {
  const rest = noticeAcks(wh).filter((a) => a.id !== id);
  const next = on === null ? rest : [...rest, { id, of: sorted(of), on }];
  const { noticeAcks: _a, ...base } = wh;
  void _a;
  return next.length === 0 ? base : { ...base, noticeAcks: next };
}

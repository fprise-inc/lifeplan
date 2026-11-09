// 面談の履歴（0182。作業の層）: 世帯ごとに、面談1回ずつの記録を残す。
// - 1件の中身: 面談の日（年月日）と、2つに分けた欄。
//   - お客さまと一緒に見てよい欄 `shared`: 話したこと・決めたこと・次までにやること（と、既定では保険の意向）
//   - FP だけが見る欄 `fpOnly`: FP のメモ（と、FP だけにしたときの保険の意向）。今のメモ（0016 の2）と同じ扱い
// - 保険の意向（当初の意向・最終的な意向・違いがあればその理由。どれも任意）は、どちらか一方の欄に入る（既定はお客さまと見てよい欄）
// - その日の控え（0009）を1つつなげられる（作るときに「この時点を残す」も一緒にできる。控えの ID だけを持つ）
// - 事務所で共有しているときは、書いた人・最後に直した人を残す（メンバーの内部ID。メモの行ごとの書いた人と同じ考え方。0023 の6）
// - 名前・連絡先の欄は作らない（顧客の名前を持たない決まり。0012）
// - 世帯ファイルでは本文の区画 meetings に置く（形式の版 0.74 から。store/body.ts）。提示層・持ち帰り・提案書・AI には渡さない。
//   お客さまと見てよい欄も、今は画面で一緒に見るだけ（持ち帰り・提案書に出すかは後で決める。0182 の未確定）
import type { WorkingHousehold } from "../input/household.ts";

export const MEETING_LOG_VERSION = 1;

/** 欄の長さの上限（1つの欄。読み込みで太らせない） */
export const MEETING_TEXT_MAX = 4000;
/** 記録の数の上限（読み込みで太らせない） */
const MAX_RECORDS = 500;

/** 保険の意向（保険業法の意向把握・意向確認の流れに沿う。どれも任意） */
export interface InsuranceIntent {
  /** 当初の意向（最初にうかがった意向） */
  initial: string;
  /** 最終的な意向（申し込む前に確かめた意向） */
  final: string;
  /** 当初と最終で違いがあれば、その理由 */
  reason: string;
}

/** お客さまと一緒に見てよい欄 */
export interface MeetingShared {
  talked: string;
  decided: string;
  todo: string;
  insurance?: InsuranceIntent;
}

/** FP だけが見る欄 */
export interface MeetingFpOnly {
  note: string;
  insurance?: InsuranceIntent;
}

export interface Meeting {
  id: string;
  /** 面談の日（YYYY-MM-DD） */
  on: string;
  shared: MeetingShared;
  fpOnly: MeetingFpOnly;
  /** つないだ控えの ID（控えを消すと見つからなくなる。記録は残す） */
  snapshot?: string;
  /** 書いた人（事務所のメンバーの内部ID。事務所で共有しているときだけ） */
  by?: string;
  /** 最後に直した人（書いた人と違うときだけ） */
  editedBy?: string;
}

export interface MeetingLog {
  version: number;
  records: Meeting[];
}

export const EMPTY_INTENT: InsuranceIntent = { initial: "", final: "", reason: "" };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const text = (v: unknown): string => (typeof v === "string" ? v.slice(0, MEETING_TEXT_MAX) : "");

/** 日の形（YYYY-MM-DD。月の日数も見る） */
export function isMeetingDate(s: string): boolean {
  const m = DATE.exec(s);
  if (m === null) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCDate() === Number(m[3]);
}

function readIntent(v: unknown): InsuranceIntent | undefined {
  if (!isObj(v)) return undefined;
  return { initial: text(v.initial), final: text(v.final), reason: text(v.reason) };
}

function readMeeting(v: unknown): Meeting | null {
  if (!isObj(v) || typeof v.id !== "string" || !ID.test(v.id) || typeof v.on !== "string" || !isMeetingDate(v.on)) return null;
  const s = isObj(v.shared) ? v.shared : {};
  const f = isObj(v.fpOnly) ? v.fpOnly : {};
  const si = readIntent(s.insurance);
  // 保険の意向はどちらか一方の欄だけ（両方にあれば FP だけの欄を残す。見せる側に広げない）
  const fi = readIntent(f.insurance);
  const out: Meeting = {
    id: v.id,
    on: v.on,
    shared: { talked: text(s.talked), decided: text(s.decided), todo: text(s.todo), ...(si !== undefined && fi === undefined ? { insurance: si } : {}) },
    fpOnly: { note: text(f.note), ...(fi !== undefined ? { insurance: fi } : {}) },
  };
  if (typeof v.snapshot === "string" && v.snapshot.length > 0 && v.snapshot.length <= 64) out.snapshot = v.snapshot;
  if (typeof v.by === "string" && v.by.length > 0 && v.by.length <= 64) out.by = v.by;
  if (typeof v.editedBy === "string" && v.editedBy.length > 0 && v.editedBy.length <= 64) out.editedBy = v.editedBy;
  return out;
}

/** 区画 meetings を読む（形の合わない記録は捨てる。同じ ID の記録は先の1件だけ） */
export function readMeetings(v: unknown): Meeting[] {
  if (!isObj(v) || !Array.isArray(v.records)) return [];
  const seen = new Set<string>();
  return v.records.slice(0, MAX_RECORDS).flatMap((x) => {
    const m = readMeeting(x);
    if (m === null || seen.has(m.id)) return [];
    seen.add(m.id);
    return [m];
  });
}

/** 区画 meetings に書く形（記録が無ければ null＝区画を作らない） */
export function meetingSection(list: readonly Meeting[] | undefined): MeetingLog | null {
  return list === undefined || list.length === 0 ? null : { version: MEETING_LOG_VERSION, records: [...list] };
}

/** 新しい面談の記録（空の欄。保険の意向はお客さまと見てよい欄に置く） */
export function newMeeting(on: string, id: string = crypto.randomUUID()): Meeting {
  return { id, on, shared: { talked: "", decided: "", todo: "", insurance: { ...EMPTY_INTENT } }, fpOnly: { note: "" } };
}

/** 保険の意向（どちらの欄にあっても） */
export function intentOf(m: Meeting): { intent: InsuranceIntent; fpOnly: boolean } {
  if (m.fpOnly.insurance !== undefined) return { intent: m.fpOnly.insurance, fpOnly: true };
  return { intent: m.shared.insurance ?? EMPTY_INTENT, fpOnly: false };
}

/** 保険の意向を入れる（fpOnly で置く欄を選ぶ。もう一方の欄からは外す） */
export function withIntent(m: Meeting, intent: InsuranceIntent, fpOnly: boolean): Meeting {
  const { insurance: _s, ...shared } = m.shared;
  const { insurance: _f, ...fp } = m.fpOnly;
  void _s;
  void _f;
  return fpOnly ? { ...m, shared, fpOnly: { ...fp, insurance: intent } } : { ...m, shared: { ...shared, insurance: intent }, fpOnly: fp };
}

/** 中身のある記録か（日だけの空の記録は保存しない） */
export function hasContent(m: Meeting): boolean {
  const { intent } = intentOf(m);
  return [m.shared.talked, m.shared.decided, m.shared.todo, m.fpOnly.note, intent.initial, intent.final, intent.reason].some((t) => t.trim() !== "") || m.snapshot !== undefined;
}

/** 新しい順（同じ日なら、後に足した物を先に） */
export function sortedMeetings(list: readonly Meeting[]): Meeting[] {
  return list
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.on < b.m.on ? 1 : a.m.on > b.m.on ? -1 : b.i - a.i))
    .map((x) => x.m);
}

/** 前回の面談（いちばん新しい日の記録） */
export function latestMeeting(list: readonly Meeting[]): Meeting | null {
  return sortedMeetings(list)[0] ?? null;
}

/**
 * 記録を足す・直す（同じ ID があれば置き換える）。事務所で共有しているとき（me がある）は、書いた人・直した人を残す:
 * 新しい記録は書いた人を me に、直した記録は書いた人を前のまま、直した人を me にする（書いた人と同じなら付けない）
 */
export function putMeeting(list: readonly Meeting[], m: Meeting, me: string | null): Meeting[] {
  const i = list.findIndex((x) => x.id === m.id);
  const prev = i >= 0 ? list[i] : undefined;
  const { by: _b, editedBy: _e, ...rest } = m;
  void _b;
  void _e;
  const by = prev !== undefined ? prev.by : (me ?? undefined);
  const editedBy = prev === undefined ? undefined : me !== null && me !== by ? me : prev.editedBy;
  const next: Meeting = { ...rest, ...(by !== undefined ? { by } : {}), ...(editedBy !== undefined ? { editedBy } : {}) };
  if (prev === undefined) return [...list, next];
  return list.map((x, j) => (j === i ? next : x));
}

export function withoutMeeting(list: readonly Meeting[], id: string): Meeting[] {
  return list.filter((x) => x.id !== id);
}

/** 世帯に面談の履歴を入れる（空なら欄を持たない） */
export function withMeetings(wh: WorkingHousehold, list: readonly Meeting[]): WorkingHousehold {
  const { meetings: _old, ...rest } = wh;
  void _old;
  return list.length > 0 ? { ...rest, meetings: [...list] } : rest;
}

/** 日の文（例: 2026年11月9日） */
export function meetingDateText(on: string): string {
  const m = DATE.exec(on);
  return m === null ? on : `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 端末の今日（YYYY-MM-DD） */
export function todayText(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 分岐の「両方を残す」（0023 の7）で面談の履歴を重ねる: 相手の記録を土台に、こちらにだけある記録を足す。同じ ID で中身が違う記録は、
 * 別の ID の写しにして足す（どちらも消さない）。形を確かめずに JSON のまま扱う（読むときに readMeetings が確かめる）
 */
export function mergeMeetingSections(theirs: unknown, ours: unknown, newId: () => string): { section: { version: number; records: unknown[] } | null; added: number } {
  const tr = isObj(theirs) && Array.isArray(theirs.records) ? (theirs.records as unknown[]) : [];
  const or = isObj(ours) && Array.isArray(ours.records) ? (ours.records as unknown[]) : [];
  const idOf = (x: unknown) => (isObj(x) && typeof x.id === "string" ? x.id : null);
  const byId = new Map(tr.map((x) => [idOf(x), x]));
  const out = [...tr];
  let added = 0;
  for (const x of or) {
    const id = idOf(x);
    if (id === null) continue;
    const same = byId.get(id);
    if (same === undefined) {
      out.push(x);
      added++;
    } else if (JSON.stringify(same) !== JSON.stringify(x)) {
      out.push({ ...(x as Record<string, unknown>), id: newId() });
      added++;
    }
  }
  return { section: out.length > 0 ? { version: MEETING_LOG_VERSION, records: out } : null, added };
}

/** メモか面談の履歴があるか（見本にするときに外す物があるか） */
export function hasNotes(wh: Pick<WorkingHousehold, "memo" | "meetings">): boolean {
  return wh.memo.length > 0 || (wh.meetings ?? []).length > 0;
}

/**
 * 見本にするとき（0033）に、メモ（行ごとの書いた人を含む）と面談の履歴を外す（0182 の追記）。お客さまの記録を見本の棚に残さず、
 * 見本から作る顧客・見本の写しにも持ち越さない。ほかの中身はそのまま
 */
export function withoutNotes(wh: WorkingHousehold): WorkingHousehold {
  const { memoBy: _by, meetings: _m, ...rest } = wh;
  void _by;
  void _m;
  return { ...rest, memo: [] };
}

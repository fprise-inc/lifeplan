// 日付の書き方を1か所で決める（0241）。画面は、日付・日時を文字にするとき、ここの関数を呼ぶ。
// - 一覧（表・行に並ぶ日時）: 「2026/11/21 01:54」「2026/11/21」（月・日・時・分を2桁にそろえて、縦に並べても読みやすく）
// - 文の中: 「2026年11月21日」「2026年11月21日 01:54」（年月日はゼロ埋めしない。時刻は2桁）
// 読み方は2つ:
// - 端末の時刻で読む（list〜・prose〜）: 時刻つきの文字（ISO 8601）と Date は、端末の時刻に直して出す。
//   日だけの文字（「2026-11-21」）は、書いてある日のまま出す（日時として読むと、時差で前の日にずれるため）
// - 書いてある数字のまま読む（〜Written）: 時差を直さない（控えを作った時刻のように、作った所の時刻のまま残した文字。日だけを切り出していた所）
// 日だけの文字を日時の関数に渡したときは、日だけを出す（無い時刻を作らない）。
// 読めない文字は、渡した文字のまま返す（bad を渡せば、その文字。null・undefined は bad、無ければ空）。
// 年月だけ（「2027年10月」）・年齢や和暦の添え書き・ファイル名・保存する値の形は、ここでは扱わない

type DateInput = string | Date | null | undefined;

interface Parts {
  y: number;
  m: number;
  d: number;
  /** 時刻（HH:MM）。日だけの文字には無い */
  time: string | null;
}

const p2 = (n: number): string => String(n).padStart(2, "0");
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const WRITTEN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

/** 書いてある数字のまま読む（時差を直さない） */
function written(v: DateInput): Parts | null {
  if (typeof v !== "string") return null;
  const m = WRITTEN.exec(v);
  if (m === null) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), time: m[4] !== undefined ? `${m[4]}:${m[5]}` : null };
}

/** 端末の時刻で読む（日だけの文字は、書いてある日のまま） */
function device(v: DateInput): Parts | null {
  if (v == null) return null;
  if (typeof v === "string" && DAY_ONLY.test(v)) return written(v);
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), time: `${p2(d.getHours())}:${p2(d.getMinutes())}` };
}

const unreadable = (v: DateInput, bad: string | undefined): string => bad ?? (typeof v === "string" ? v : "");
const withTime = (day: string, t: Parts): string => (t.time === null ? day : `${day} ${t.time}`);
const slash = (t: Parts): string => `${t.y}/${p2(t.m)}/${p2(t.d)}`;
const kanji = (t: Parts): string => `${t.y}年${t.m}月${t.d}日`;

/**
 * 時刻つきの日時（ISO 8601）として読める文字か。日時らしく読めてしまうだけの文字（「2026」「2026/11/19」）や日だけの文字は、日時として読まない。
 * 書いてある数字のまま出していた所を端末の時刻に直すとき、無い・壊れた値の出し方を変えないための確かめ（読めない文字は 〜Written の方で今までどおり出す）
 */
export function isDateTimeText(v: unknown): v is string {
  return typeof v === "string" && ISO_TIME.test(v) && !Number.isNaN(Date.parse(v));
}

/** 一覧の日（2026/11/21。端末の時刻で） */
export function listDate(v: DateInput, bad?: string): string {
  const t = device(v);
  return t === null ? unreadable(v, bad) : slash(t);
}

/** 一覧の日時（2026/11/21 01:54。端末の時刻で） */
export function listDateTime(v: DateInput, bad?: string): string {
  const t = device(v);
  return t === null ? unreadable(v, bad) : withTime(slash(t), t);
}

/** 文の中の日（2026年11月21日。端末の時刻で） */
export function proseDate(v: DateInput, bad?: string): string {
  const t = device(v);
  return t === null ? unreadable(v, bad) : kanji(t);
}

/** 文の中の日時（2026年11月21日 01:54。端末の時刻で） */
export function proseDateTime(v: DateInput, bad?: string): string {
  const t = device(v);
  return t === null ? unreadable(v, bad) : withTime(kanji(t), t);
}

/** 一覧の日（書いてある日のまま） */
export function listDateWritten(v: DateInput, bad?: string): string {
  const t = written(v);
  return t === null ? unreadable(v, bad) : slash(t);
}

/** 一覧の日時（書いてある時刻のまま。控えを作った時刻など） */
export function listDateTimeWritten(v: DateInput, bad?: string): string {
  const t = written(v);
  return t === null ? unreadable(v, bad) : withTime(slash(t), t);
}

/** 文の中の日（書いてある日のまま） */
export function proseDateWritten(v: DateInput, bad?: string): string {
  const t = written(v);
  return t === null ? unreadable(v, bad) : kanji(t);
}

/** 文の中の日時（書いてある時刻のまま） */
export function proseDateTimeWritten(v: DateInput, bad?: string): string {
  const t = written(v);
  return t === null ? unreadable(v, bad) : withTime(kanji(t), t);
}

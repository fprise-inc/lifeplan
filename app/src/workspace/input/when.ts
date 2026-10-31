// 時点の部品（0038）の読み取りと見せ方。どの「いつ」の欄も、この1つの決まりで読む・書く・見せる。
// 入れ方は4つ: 年月（2041年6月）・人の年齢（本人が60歳になる月）・出来事から（入居から10年後）・今から（5年後）。
// 書く値はエンジンの時点の型（0003 の6）そのもの: 年月と「今から」は {at}、年齢は {memberAge}、出来事からは {event, offset}。
// ここは世帯を変えない純粋な関数だけを持つ（欄の読み書きは form.ts の timepointField、出来事の一覧と作り方は namedEvents.ts）
import type { Household, Timepoint } from "../../engine/types.ts";
import { ageSwitchMonth, monthIndex, monthText, resolveTimepoint, type AgeSwitch } from "../timepoint.ts";
import { parseWareki, wareki } from "./units.ts";

/** 入れ方 */
export type WhenMode = "ym" | "age" | "event" | "now";
export const WHEN_MODES: readonly WhenMode[] = ["age", "ym", "event", "now"];
export const WHEN_MODE_LABEL: Record<WhenMode, string> = { ym: "年月", age: "年齢", event: "出来事から", now: "今から" };

/**
 * 「60歳」と打ったときに、その欄でどの月を指すか（欄ごとに決める）:
 * reach は60歳になる月（既定）、before は60歳になる前の月まで（働く最後・積立の終わりなど「○歳まで」の欄）、
 * after は60歳になった翌月から（年金の受け取り開始。0003 の追記 2026-10-11）
 */
export type AgeMeans = "reach" | "before" | "after";

/** 年齢で入れられる人 */
export interface WhenPerson {
  id: string;
  /** 見せる呼び方（ご本人・配偶者・第1子 など） */
  label: string;
  /** 打った文字で人を見分ける呼び方（本人・妻・夫・配偶者・第1子・下の子・呼び名 など。長い順に照らす） */
  names: string[];
}

/** 出来事から選べる時点（世帯の名前つきイベント。まだ出来事でない物は `candidate` で、選ぶと出来事にする） */
export interface WhenEvent {
  id: string;
  label: string;
  names: string[];
  ym: string | null;
  /** まだ出来事になっていない（選ぶと画面が出来事を作り、元の物の時点をその出来事に向ける） */
  candidate?: boolean;
}

export interface WhenCtx {
  h: Pick<Household, "members" | "events">;
  baseMonth: string;
  people: readonly WhenPerson[];
  /** 既定の人（年齢の入れ方で人を書かなかったとき） */
  person: string | null;
  events: readonly WhenEvent[];
  /** この欄で使える入れ方（既定は4つとも） */
  modes: readonly WhenMode[];
  /** 既定の入れ方（欄ごとに決める。既定は人の年齢） */
  defaultMode: WhenMode;
  ageMeans: AgeMeans;
  /**
   * 年月の形の読みの言い方。年月の形は、どの欄も欄に「2048-04」、読みに和暦と今の読み（「今から5年後・ご本人60歳（令和13年4月）」）を出す。
   * birth は欄の人そのものの日付（加わる時期・独立の時期）で、読みを生年月の欄と同じ「23歳（令和30年4月）」にする
   */
  dateStyle?: "birth";
  /** 空にできる（空は「最後まで」など、欄ごとの意味） */
  optional: boolean;
  /** 終わりの欄の始まり（「10年間」を読む・「始まりから10年間」と見せる） */
  start?: Timepoint | null;
  /** 今の値（出来事の形を見せているときに「10年後」を、その出来事からと読む） */
  current?: Timepoint | null;
  /** 今見せている入れ方（打った文字の読み方が変わる: 年齢なら「60」を60歳、今からなら「5」を5年後） */
  mode?: WhenMode;
}

export type WhenParse = { ok: true; tp: Timepoint | null; via: WhenMode | "duration" | "empty" } | { ok: false; reason: string };

// ---- 文字をそろえる ----

/** 全角を半角に、空白を除き、「ヶ月・カ月・ケ月・ヵ月」を「か月」に、数字の間のダッシュ・波線を「-」にそろえる */
export function normalizeWhenText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\s/g, "")
    .replace(/才|さい/g, "歳")
    .replace(/[ヶケヵカ]月/g, "か月")
    .replace(/ヶ年|カ年|か年/g, "年")
    .replace(/(?<=\d)[ー−‐―–—~〜](?=\d)/g, "-");
}

const NONE_WORDS = new Set(["最後まで", "ずっと", "終身", "なし", "無し", "未定", "-", "—", "空欄"]);

// ---- 年齢の形 ----

/** 構成員のその月の、年齢の形（reachMonth で読んだ通しの月数。生まれる前は負） */
function reachMonths(h: WhenCtx["h"], memberId: string, ym: string): number | null {
  const m = h.members.find((x) => x.id === memberId);
  if (m === undefined) return null;
  return monthIndex(ym) - monthIndex(ageSwitchMonth(m, 0, 0, "reachMonth"));
}

const ageOf = (total: number) => ({ years: Math.floor(total / 12), months: total % 12 });

/** 年齢の時点を作る（欄の決まり ageMeans で。total は「○歳○か月」の通しの月数） */
function ageTimepoint(member: string, total: number, means: AgeMeans, rule?: AgeSwitch): Timepoint | null {
  if (rule !== undefined && rule !== "reachMonth") {
    if (total < 0) return null;
    return { memberAge: { member, ...ageOf(total), ageSwitch: rule } };
  }
  if (means === "after") return total < 0 ? null : { memberAge: { member, ...ageOf(total), ageSwitch: "monthAfterReach" } };
  const t = means === "before" ? total - 1 : total;
  return t < 0 ? null : { memberAge: { member, ...ageOf(t) } };
}

const clean = (tp: Timepoint): Timepoint => {
  if (tp.memberAge === undefined) return tp;
  const { months, ageSwitch, ...rest } = tp.memberAge;
  return { memberAge: { ...rest, ...(months !== undefined && months !== 0 ? { months } : {}), ...(ageSwitch !== undefined && ageSwitch !== "reachMonth" ? { ageSwitch } : {}) } };
};

// ---- 出来事のずらし ----

/** 月数 → ずらし（年と月。符号はそろえる。0 は省く） */
export function offsetOf(total: number): Timepoint["offset"] | undefined {
  if (total === 0) return undefined;
  const years = Math.trunc(total / 12);
  const months = total - years * 12;
  return { ...(years !== 0 ? { years } : {}), ...(months !== 0 ? { months } : {}) };
}
const offsetMonths = (tp: Timepoint) => (tp.offset?.years ?? 0) * 12 + (tp.offset?.months ?? 0);
const eventTp = (event: string, total: number): Timepoint => {
  const offset = offsetOf(total);
  return offset === undefined ? { event } : { event, offset };
};

/** 「10年」「3か月」「1年6か月」の月数。読めなければ null */
function spanMonths(s: string): number | null {
  const m = /^(?:(\d+)年)?(?:(\d+)か月)?$/.exec(s);
  if (m === null || (m[1] === undefined && m[2] === undefined)) return null;
  return Number(m[1] ?? 0) * 12 + Number(m[2] ?? 0);
}

/** 出来事の後ろの文字（「から10年後」「の翌月」「の2年前」「」）→ ずらしの月数。読めなければ null、読めるが持てない形は理由 */
function offsetText(rest: string): number | string | null {
  const r = rest.replace(/(から|より)?$/, "");
  if (r === "" || r === "の月" || r === "と同じ月" || r === "そのまま") return 0;
  const fixed: Record<string, number> = { の翌月: 1, の前月: -1, の翌年: 12, の前年: -12, の次の月: 1 };
  if (fixed[r] !== undefined) return fixed[r];
  const m = /^(?:から|の)?(.+?)(後|前)$/.exec(r);
  if (m !== null) {
    const n = spanMonths(m[1] as string);
    if (n !== null) return m[2] === "前" ? -n : n;
  }
  if (/^の(翌|次の|同じ|その)?年の\d+月$/.test(r) || /^の年度末$/.test(r)) return "「出来事の年の○月」はまだ入れられません。「入居から1年後」のように月数で入れるか、人の年齢（例: 第1子が22歳になった後の4月 → 「第1子22歳の4月」）で入れてください";
  return null;
}

/** 出来事の形のときに打った「10年後」「翌月」「3か月前」（出来事の名前を書かない） */
function bareOffset(s: string): number | null {
  const fixed: Record<string, number> = { 翌月: 1, 前月: -1, 翌年: 12, 前年: -12, そのまま: 0, 同じ月: 0, "0": 0 };
  if (fixed[s] !== undefined) return fixed[s];
  const m = /^(.+?)(後|前)$/.exec(s);
  if (m === null) return null;
  const n = spanMonths(m[1] as string);
  return n === null ? null : m[2] === "前" ? -n : n;
}

// ---- 読み取り ----

const allowed = (ctx: WhenCtx, mode: WhenMode) => ctx.modes.includes(mode);

const examples = (ctx: WhenCtx): string => {
  const ex: string[] = [];
  if (allowed(ctx, "ym")) ex.push("2041-06", "2041年6月", "令和23年6月");
  if (allowed(ctx, "age") && ctx.people.length > 0) {
    // 既定の人が子なら子の年齢の例（今20歳未満の人は22歳）
    const young = ctx.person !== null && (reachMonths(ctx.h, ctx.person, ctx.baseMonth) ?? 0) < 20 * 12;
    const other = ctx.people.find((p) => p.id !== ctx.person);
    ex.push(young ? "22歳" : "60歳", other !== undefined ? `${other.names[0] ?? other.label}65歳` : "60歳3か月");
  }
  if (allowed(ctx, "event") && ctx.events.length > 0) ex.push(`${ctx.events[0]?.label}の翌月`);
  if (allowed(ctx, "now")) ex.push("5年後");
  if (ctx.start !== undefined) ex.push("10年間");
  return ex.join("・");
};

const notAllowed = (ctx: WhenCtx, mode: WhenMode): WhenParse => ({
  ok: false,
  reason: `この欄は${ctx.modes.map((m) => WHEN_MODE_LABEL[m]).join("・")}で入れます（${WHEN_MODE_LABEL[mode]}では入れられません）`,
});

/** 人の呼び方を頭から外す（長い呼び方から照らす）。人が書かれていなければ null */
function personPrefix(ctx: WhenCtx, s: string): { id: string; rest: string } | null {
  const names = ctx.people.flatMap((p) => p.names.map((n) => ({ id: p.id, n }))).sort((a, b) => b.n.length - a.n.length);
  for (const { id, n } of names) {
    if (n === "" || !s.startsWith(n)) continue;
    const rest = s.slice(n.length).replace(/^(が|の|は)/, "");
    if (/^\d/.test(rest)) return { id, rest };
  }
  return null;
}

/** 年齢の文字（「60歳」「60歳3か月」「60歳の前月」「22歳の年度末」）。人は personPrefix で外してから */
function parseAge(ctx: WhenCtx, member: string, s: string): WhenParse | null {
  const m = /^(\d{1,3})歳(?:(\d{1,2})か月)?(の前月|になる前の月|の翌月|になった翌月|になった次の月|になる月|になった月|の誕生月の翌月|の誕生月|の年度末|になった後の最初の3月|の4月|になった後の最初の4月)?(から|まで|以降|以後)?$/.exec(s);
  if (m === null) return null;
  const years = Number(m[1]);
  const months = Number(m[2] ?? 0);
  if (years > 130) return { ok: false, reason: "年齢は130歳までで入れてください" };
  if (months > 11) return { ok: false, reason: "か月は0〜11で入れてください（例: 60歳3か月）" };
  const total = years * 12 + months;
  const suffix = m[3];
  let tp: Timepoint | null;
  switch (suffix) {
    case "の前月":
    case "になる前の月":
      tp = ageTimepoint(member, total, "before");
      break;
    case "の翌月":
    case "になった翌月":
    case "になった次の月":
      tp = ageTimepoint(member, total, "after");
      break;
    case "になる月":
    case "になった月":
      tp = ageTimepoint(member, total, "reach");
      break;
    case "の誕生月":
      tp = ageTimepoint(member, total, "reach", "birthdayMonth");
      break;
    case "の誕生月の翌月":
      tp = ageTimepoint(member, total, "reach", "monthAfterBirthday");
      break;
    case "の年度末":
    case "になった後の最初の3月":
      tp = ageTimepoint(member, total, "reach", "firstMarch31AfterReach");
      break;
    case "の4月":
    case "になった後の最初の4月":
      tp = ageTimepoint(member, total, "reach", "schoolYear");
      break;
    default:
      tp = ageTimepoint(member, total, ctx.ageMeans);
  }
  if (tp === null) return { ok: false, reason: "0歳より前の月は年齢では入れられません。年月で入れてください" };
  return { ok: true, tp: clean(tp), via: "age" };
}

/** 年月の文字（西暦・和暦）。年だけ・月の無い和暦は理由を返す */
function parseMonth(s: string): WhenParse | null {
  const t = s.replace(/(から|まで|頃|ごろ|以降|以後)$/, "");
  const w = parseWareki(t);
  if (w !== null) return { ok: true, tp: { at: w }, via: "ym" };
  if (/^(令和|平成|昭和|大正|明治|[rhstm])(元|\d{1,2})年?$/i.test(t)) return { ok: false, reason: "月も入れてください（例: 令和23年4月）" };
  const m = /^(\d{4})(?:年|[.\-/])?(\d{1,2})月?$/.exec(t);
  if (m !== null) {
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return { ok: false, reason: "月は1〜12で入れてください" };
    return { ok: true, tp: { at: `${m[1]}-${String(mo).padStart(2, "0")}` }, via: "ym" };
  }
  if (/^\d{4}年?$/.test(t)) return { ok: false, reason: `月も入れてください（例: ${t.replace(/年$/, "")}年4月）` };
  return null;
}

/** 今からの文字（「5年後」「今から3か月後」「今月」「来月」「来年4月」） */
function parseNow(ctx: WhenCtx, s: string): WhenParse | null {
  const base = monthIndex(ctx.baseMonth);
  const y = Math.floor(base / 12);
  if (s === "今" || s === "今月" || s === "今から") return { ok: true, tp: { at: ctx.baseMonth }, via: "now" };
  if (s === "来月") return { ok: true, tp: { at: monthText(base + 1) }, via: "now" };
  const ny = /^(今年|来年|再来年)(\d{1,2})月$/.exec(s);
  if (ny !== null) {
    const mo = Number(ny[2]);
    if (mo < 1 || mo > 12) return { ok: false, reason: "月は1〜12で入れてください" };
    const add = ny[1] === "今年" ? 0 : ny[1] === "来年" ? 1 : 2;
    return { ok: true, tp: { at: monthText((y + add) * 12 + mo - 1) }, via: "now" };
  }
  const m = /^(今から)?(.+?)後$/.exec(s);
  if (m === null) return null;
  const n = spanMonths(m[2] as string);
  if (n === null) return null;
  return { ok: true, tp: { at: monthText(base + n) }, via: "now" };
}

/** 終わりの欄の「10年間」「6か月間」: 始まりから n か月（始まりの月を含む）の最後の月を、始まりと同じ形で持つ */
export function durationEnd(ctx: Pick<WhenCtx, "h">, start: Timepoint | null | undefined, months: number): Timepoint | null {
  if (start == null || months < 1) return null;
  const add = months - 1;
  if (start.at !== undefined) return { at: monthText(monthIndex(start.at) + add) };
  if (start.event !== undefined) return eventTp(start.event, offsetMonths(start) + add);
  if (start.memberAge !== undefined) {
    const a = start.memberAge;
    const rule = (a.ageSwitch ?? "reachMonth") as AgeSwitch;
    if (rule === "reachMonth" || rule === "monthAfterReach") {
      const total = a.years * 12 + (a.months ?? 0) + add;
      return clean({ memberAge: { member: a.member, ...ageOf(total), ageSwitch: rule } });
    }
    const ym = resolveTimepoint(ctx.h, start);
    return ym === null ? null : { at: monthText(monthIndex(ym) + add) };
  }
  return null;
}

/**
 * 打った文字を読む。読めた時点はエンジンの時点の型のまま返す（年齢・出来事を年月に直さない。今からは年月にする）。
 * 読めなければ、欄の下に出す1行の理由を返す
 */
export function parseWhen(text: string, ctx: WhenCtx): WhenParse {
  const s = normalizeWhenText(text);
  if (s === "" || NONE_WORDS.has(s)) return ctx.optional ? { ok: true, tp: null, via: "empty" } : { ok: false, reason: "空にはできません。時点を入れてください" };

  // 終わりの欄の「10年間」
  const dur = /^(.+?)間$/.exec(s);
  if (dur !== null) {
    const n = spanMonths(dur[1] as string);
    if (n !== null) {
      if (ctx.start === undefined) return { ok: false, reason: "「10年間」のような入れ方は、終わりの欄だけで使えます" };
      if (n < 1) return { ok: false, reason: "1か月以上で入れてください" };
      const tp = durationEnd(ctx, ctx.start, n);
      return tp === null ? { ok: false, reason: "始まりが決まっていないので「10年間」のような入れ方はできません。終わりの時点で入れてください" } : { ok: true, tp, via: "duration" };
    }
  }

  // 出来事の形を見せているときの「10年後」「翌月」は、その出来事から
  const cur = ctx.current;
  if (ctx.mode === "event" && cur?.event !== undefined && !s.startsWith("今")) {
    const n = bareOffset(s);
    if (n !== null) return { ok: true, tp: eventTp(cur.event, n), via: "event" };
  }

  // 今から
  const now = parseNow(ctx, s);
  if (now !== null) return now.ok && !allowed(ctx, "now") && !allowed(ctx, "ym") ? notAllowed(ctx, "now") : now;

  // 年月（西暦・和暦）
  const month = parseMonth(s);
  if (month !== null) return month.ok && !allowed(ctx, "ym") && !allowed(ctx, "now") ? notAllowed(ctx, "ym") : month;

  // 出来事から（名前の長い順に照らす）
  const evNames = ctx.events.flatMap((e) => e.names.map((n) => ({ e, n }))).sort((a, b) => b.n.length - a.n.length);
  for (const { e, n } of evNames) {
    if (n === "" || !s.startsWith(n)) continue;
    const off = offsetText(s.slice(n.length));
    if (off === null) continue;
    if (typeof off === "string") return { ok: false, reason: off };
    return allowed(ctx, "event") ? { ok: true, tp: eventTp(e.id, off), via: "event" } : notAllowed(ctx, "event");
  }

  // 人の年齢
  const who = personPrefix(ctx, s);
  const bare = /^\d{1,3}$/.test(s);
  if (bare && ctx.mode === "now" && allowed(ctx, "now")) return { ok: true, tp: { at: monthText(monthIndex(ctx.baseMonth) + Number(s) * 12) }, via: "now" };
  const ageText = who !== null ? who.rest : bare ? `${s}歳` : s;
  if (/^\d{1,3}歳/.test(ageText)) {
    if (!allowed(ctx, "age")) return notAllowed(ctx, "age");
    const member = who?.id ?? ctx.person;
    if (member === null) return { ok: false, reason: ctx.people.length === 0 ? "年齢で入れるには、家族の項目で生年月を入れてください" : "誰の年齢か書いてください（例: ご本人60歳・配偶者65歳）" };
    const r = parseAge(ctx, member, ageText);
    if (r !== null) return r;
  }
  if (/歳/.test(s) && who === null && /^[^\d]+\d/.test(s)) return { ok: false, reason: `「${s.replace(/\d.*$/, "")}」が誰か分かりません。${ctx.people.map((p) => p.names[0]).filter(Boolean).slice(0, 4).join("・")}のように書いてください` };
  return { ok: false, reason: `読めませんでした。例: ${examples(ctx)}` };
}

// ---- 見せ方 ----

const span = (total: number): string => {
  const a = Math.abs(total);
  const y = Math.floor(a / 12);
  const m = a % 12;
  return y > 0 && m > 0 ? `${y}年${m}か月` : y > 0 ? `${y}年` : `${m}か月`;
};
const ageText = (total: number): string => (total % 12 === 0 ? `${total / 12}歳` : `${Math.floor(total / 12)}歳${total % 12}か月`);

/** 時点の今の入れ方（年月は欄の既定の入れ方に合わせて年齢・今からでも見せる） */
export function modeOf(tp: Timepoint | null | undefined, ctx: WhenCtx): WhenMode {
  if (tp == null) return ctx.mode ?? ctx.defaultMode;
  if (tp.event !== undefined) return "event";
  if (tp.memberAge !== undefined) return "age";
  const want = ctx.mode ?? ctx.defaultMode;
  if (want === "now" && tp.at !== undefined && tp.at >= ctx.baseMonth) return "now";
  if (want === "age" && ctx.person !== null && tp.at !== undefined) {
    const total = reachMonths(ctx.h, ctx.person, tp.at);
    if (total !== null && wholeAge(total, ctx.ageMeans)) return "age";
  }
  return "ym";
}

/** その欄の決まりで「○歳」と言える月か（reach・after は○歳ちょうど、before は○歳になる前の月） */
function wholeAge(total: number, means: AgeMeans): boolean {
  const t = means === "before" ? total + 1 : means === "after" ? total - 1 : total;
  return t >= 0 && t % 12 === 0;
}

/** 入れ方ごとの「○歳」の文字（欄の決まりに合う形は「60歳」、合わない形は「60歳になる月」のように言葉を足す） */
function ageWords(a: NonNullable<Timepoint["memberAge"]>, means: AgeMeans): string {
  const total = a.years * 12 + (a.months ?? 0);
  switch (a.ageSwitch ?? "reachMonth") {
    case "monthAfterReach":
      return means === "after" ? ageText(total) : `${ageText(total)}の翌月`;
    case "birthdayMonth":
      return `${ageText(total)}の誕生月`;
    case "monthAfterBirthday":
      return `${ageText(total)}の誕生月の翌月`;
    case "firstMarch31AfterReach":
      return `${ageText(total)}の年度末`;
    case "schoolYear":
      return `${ageText(total)}の4月`;
    default:
      // 欄の決まりで「○歳」と言える月はその形、言えない月は「○歳になる月」と書く（打ち直すと同じ時点に読める）
      if (means === "before") return (total + 1) % 12 === 0 ? ageText(total + 1) : `${ageText(total)}になる月`;
      if (means === "after") return total >= 1 && (total - 1) % 12 === 0 ? ageText(total - 1) : `${ageText(total)}になる月`;
      return ageText(total);
  }
}

const personLabel = (ctx: WhenCtx, id: string) => ctx.people.find((p) => p.id === id);
const shortName = (ctx: WhenCtx, id: string) => personLabel(ctx, id)?.names[0] ?? personLabel(ctx, id)?.label ?? "（いない家族）";

/** 出来事の名前（無い出来事は「（無い出来事）」） */
const eventLabel = (ctx: WhenCtx, id: string) => ctx.events.find((e) => e.id === id)?.label ?? "（無い出来事）";

/** 出来事からの文字（「入居」「入居の翌月」「入居から10年後」「入居の2年前」） */
function eventWords(label: string, total: number): string {
  if (total === 0) return label;
  if (total === 1) return `${label}の翌月`;
  if (total === -1) return `${label}の前月`;
  return total > 0 ? `${label}から${span(total)}後` : `${label}の${span(total)}前`;
}

/** 欄に見せる文字（打ち直すと同じ時点に読める形） */
export function showWhen(tp: Timepoint | null | undefined, ctx: WhenCtx): string {
  if (tp == null) return "";
  const mode = modeOf(tp, ctx);
  if (tp.event !== undefined) return eventWords(eventLabel(ctx, tp.event), offsetMonths(tp));
  if (tp.memberAge !== undefined) {
    const words = ageWords(tp.memberAge, ctx.ageMeans);
    return tp.memberAge.member === ctx.person ? words : `${shortName(ctx, tp.memberAge.member)}${words}`;
  }
  const at = tp.at as string;
  if (mode === "now") {
    const d = monthIndex(at) - monthIndex(ctx.baseMonth);
    return d === 0 ? "今月" : `${span(d)}後`;
  }
  if (mode === "age" && ctx.person !== null) {
    const total = reachMonths(ctx.h, ctx.person, at) as number;
    const t = ctx.ageMeans === "before" ? total + 1 : ctx.ageMeans === "after" ? total - 1 : total;
    return ageText(t);
  }
  return at;
}

/** 年月だけの欄（時点の部品でない「2041-06」の欄）の読み: 「今から5年後（令和13年4月）」。今月より前・今月は和暦だけ */
export function readYearMonth(ym: string, baseMonth: string): string {
  const d = monthIndex(ym) - monthIndex(baseMonth);
  return d > 0 ? `今から${span(d)}後（${wareki(ym)}）` : wareki(ym);
}

/** 欄の下に出す読み替えた形（例: 「ご本人が60歳になる月（2046年4月）」「入居から10年後（2038年4月）」） */
export function readWhen(tp: Timepoint | null | undefined, ctx: WhenCtx, nullText?: string): string {
  if (tp == null) return nullText ?? "空欄";
  const ym = resolveTimepoint(ctx.h, tp);
  const when = ym === null ? "（解けない時点）" : wareki(ym);
  let out: string;
  if (tp.memberAge !== undefined) {
    const a = tp.memberAge;
    const who = personLabel(ctx, a.member)?.label ?? "（いない家族）";
    const total = a.years * 12 + (a.months ?? 0);
    const rule = a.ageSwitch ?? "reachMonth";
    const phrase =
      rule === "monthAfterReach"
        ? `${ageText(total)}になった翌月`
        : rule === "birthdayMonth"
          ? `${ageText(total)}の誕生日の月`
          : rule === "monthAfterBirthday"
            ? `${ageText(total)}の誕生日の翌月`
            : rule === "firstMarch31AfterReach"
              ? `${ageText(total)}になった後の最初の3月`
              : rule === "schoolYear"
                ? `${ageText(total)}になった後の最初の4月`
                : ctx.ageMeans === "before"
                  ? `${ageText(total + 1)}になる前の月`
                  : ctx.ageMeans === "after" && total >= 1
                    ? `${ageText(total - 1)}になった翌月`
                    : `${ageText(total)}になる月`;
    out = `${who}が${phrase}（${when}）`;
  } else if (tp.event !== undefined) {
    const e = ctx.events.find((x) => x.id === tp.event);
    const d = offsetMonths(tp);
    const base = e?.ym != null ? wareki(e.ym) : "（解けない時点）";
    out = d === 0 ? `${eventLabel(ctx, tp.event)}の月（${when}）` : `${eventWords(eventLabel(ctx, tp.event), d)}（${eventLabel(ctx, tp.event)}は${base}・${when}）`;
  } else if (ctx.dateStyle === "birth") {
    // 生年月の欄と同じ読み: 欄の人の年齢（和暦）。年齢が出せなければ和暦だけ
    const total = ctx.person !== null ? reachMonths(ctx.h, ctx.person, tp.at as string) : null;
    out = total !== null && total >= 0 ? `${Math.floor(total / 12)}歳（${when}）` : when;
  } else {
    // 生まれる予定の欄と同じ形: 「今から5年後・ご本人60歳（令和13年4月）」。言えることが無ければ和暦だけ
    const at = tp.at as string;
    const parts: string[] = [];
    const d = monthIndex(at) - monthIndex(ctx.baseMonth);
    if (d > 0) parts.push(`今から${span(d)}後`);
    if (ctx.person !== null) {
      const total = reachMonths(ctx.h, ctx.person, at);
      const who = personLabel(ctx, ctx.person)?.label ?? "";
      // 欄の決まりで「○歳」と言える月は、その言い方で（働く最後: 60歳になる前の月、受け取り開始: 65歳になった翌月）
      if (total !== null && total >= 0 && ctx.ageMeans !== "reach" && wholeAge(total, ctx.ageMeans)) parts.push(ctx.ageMeans === "before" ? `${who}が${(total + 1) / 12}歳になる前の月` : `${who}が${(total - 1) / 12}歳になった翌月`);
      else if (total !== null && total >= 0) parts.push(`${who}${Math.floor(total / 12)}歳`);
    }
    out = parts.length > 0 ? `${parts.join("・")}（${when}）` : when;
  }
  if (ctx.start !== undefined && ym !== null) {
    const s = resolveTimepoint(ctx.h, ctx.start);
    if (s !== null && monthIndex(ym) >= monthIndex(s)) out += `。始まりから${span(monthIndex(ym) - monthIndex(s) + 1)}間`;
  }
  return out;
}

// ---- 入れ方を変える ----

/**
 * 時点を別の入れ方に直す（同じ月のまま）。年齢は人（省略は今の人か既定の人）、出来事は選んだ出来事から。
 * 直せなければ（生まれる前の月を年齢に、など）null
 */
export function convertWhen(tp: Timepoint | null | undefined, mode: WhenMode, ctx: WhenCtx, opts: { person?: string; event?: string } = {}): Timepoint | null {
  const ym = resolveTimepoint(ctx.h, tp);
  if (mode === "event") {
    const id = opts.event ?? tp?.event;
    if (id === undefined) return null;
    const e = ctx.events.find((x) => x.id === id);
    if (e === undefined) return null;
    if (ym === null || e.ym === null) return { event: id };
    return eventTp(id, monthIndex(ym) - monthIndex(e.ym));
  }
  if (ym === null) return null;
  if (mode === "ym" || mode === "now") return { at: ym };
  const member = opts.person ?? tp?.memberAge?.member ?? ctx.person;
  if (member == null) return null;
  const total = reachMonths(ctx.h, member, ym);
  if (total === null) return null;
  // 年齢の形は、その月そのものを年齢で書く（欄の決まり after だけは「なった翌月」の規則で）
  const tpAge = ctx.ageMeans === "after" ? ageTimepoint(member, total - 1, "after") : ageTimepoint(member, total, "reach");
  return tpAge === null ? null : clean(tpAge);
}

/** 人を変える（年齢の数はそのまま、人だけ変える。年齢の形でなければ、その人の年齢に直す） */
export function withPerson(tp: Timepoint | null | undefined, person: string, ctx: WhenCtx): Timepoint | null {
  if (tp?.memberAge !== undefined) return clean({ memberAge: { ...tp.memberAge, member: person } });
  return convertWhen(tp, "age", ctx, { person });
}

/**
 * 使える入れ方だけで見せる欄（WhenSpec.strictModes。0101）で、入っている時点がほかの形（年齢・出来事から）のとき、同じ月の既定の入れ方の形と、
 * 欄に添える1行。使える入れ方の形なら null。過ぎた年月（「今から」で言えない月）は年月のまま見せる（欄の知らせで直してもらう）
 */
export function strictShown(tp: Timepoint | null | undefined, ctx: WhenCtx): { tp: Timepoint; note: string } | null {
  if (tp == null) return null;
  const actual = modeOf(tp, { ...ctx, mode: ctx.defaultMode });
  if (ctx.modes.includes(actual)) return null;
  if (tp.at !== undefined) return null;
  const conv = convertWhen(tp, ctx.defaultMode, ctx);
  if (conv === null) return null;
  const how = WHEN_MODE_LABEL[ctx.defaultMode];
  const note =
    tp.event !== undefined
      ? `出来事（${showWhen(tp, { ...ctx, mode: "event" })}）から決めた時点です。直すと「${how}」の形にし、出来事から切り離します`
      : `年齢（${showWhen(tp, { ...ctx, mode: "age" })}）で入っています。直すと「${how}」の形で入れ直します`;
  return { tp: conv, note };
}

/** 時点どうしが同じ形・同じ値か（キーの順や省略できる 0 の違いは見ない） */
export function sameWhen(a: Timepoint | null | undefined, b: Timepoint | null | undefined): boolean {
  if (a == null || b == null) return a == b;
  const norm = (t: Timepoint) =>
    t.at !== undefined
      ? `at:${t.at}`
      : t.memberAge !== undefined
        ? `age:${t.memberAge.member}:${t.memberAge.years * 12 + (t.memberAge.months ?? 0)}:${t.memberAge.ageSwitch ?? "reachMonth"}`
        : `ev:${t.event ?? ""}:${offsetMonths(t)}`;
  return norm(a) === norm(b);
}

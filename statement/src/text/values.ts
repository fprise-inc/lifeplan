// 欄の値の読み方（0034 の3）: 金額（カンマ・円・マイナス・括弧・△）、日付（区切り・8桁・和暦・年の無い月日）、支払い方法（回数・リボ）、利用者（本人・家族）
import { nfkc } from "./normalize.ts";

/** 金額の上限（9桁。これより大きい数は金額として読まない。カード番号を金額と取り違えないため） */
export const MAX_AMOUNT = 999_999_999;

/** 金額を円の整数に（読めなければ null）。負は返品・取り消し・入金 */
export function parseAmount(raw: string): number | null {
  let s = nfkc(raw).replace(/\s+/g, "");
  if (s === "") return null;
  let neg = false;
  if (/^[(（].*[)）]$/u.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/^(?:-|−|△|▲|マイナス)/u.test(s)) {
    neg = !neg;
    s = s.replace(/^(?:-|−|△|▲|マイナス)/u, "");
  }
  if (/[-−]$/u.test(s)) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  s = s.replace(/^[¥￥\\]/u, "").replace(/円$/u, "").replace(/^[¥￥\\]/u, "");
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.0+)?$/u.test(s)) return null;
  const digits = s.replace(/,/g, "").replace(/\.0+$/u, "");
  if (digits.length > 9) return null;
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n > MAX_AMOUNT) return null;
  return neg ? (n === 0 ? 0 : -n) : n;
}

const ERA: Record<string, number> = { 令和: 2018, R: 2018, 平成: 1988, H: 1988, 昭和: 1925, S: 1925 };

const pad = (n: number) => String(n).padStart(2, "0");

function valid(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export interface DateResult {
  /** YYYY-MM-DD */
  readonly date: string;
  /** 年が書かれていなかった（補った） */
  readonly yearGuessed: boolean;
}

/**
 * 日付を YYYY-MM-DD に（読めなければ null）。年の無い月日（10/03）は yearHint で補う（補ったことを返す）。
 * 2桁の年は 2000 年代として読む。日の無い年月は読まない（使った日が要るため）
 */
export function parseDate(raw: string, yearHint?: number): DateResult | null {
  const s = nfkc(raw).replace(/\s+/g, "").replace(/\(.\)$/u, "").replace(/（.）$/u, "");
  if (s === "") return null;
  let m = /^(令和|平成|昭和|[RHS])(\d{1,2}|元)[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?$/iu.exec(s);
  if (m !== null) {
    const era = ERA[(m[1] as string).toUpperCase()] ?? ERA[m[1] as string];
    if (era === undefined) return null;
    const y = era + (m[2] === "元" ? 1 : Number(m[2]));
    const d = valid(y, Number(m[3]), Number(m[4]));
    return d === null ? null : { date: d, yearGuessed: false };
  }
  m = /^(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?(?:\d{1,2}:\d{2}(?::\d{2})?)?$/u.exec(s);
  if (m !== null) {
    const d = valid(Number(m[1]), Number(m[2]), Number(m[3]));
    return d === null ? null : { date: d, yearGuessed: false };
  }
  m = /^((?:19|20)\d{2})(\d{2})(\d{2})$/u.exec(s);
  if (m !== null) {
    const d = valid(Number(m[1]), Number(m[2]), Number(m[3]));
    return d === null ? null : { date: d, yearGuessed: false };
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/u.exec(s);
  if (m !== null) {
    const d = valid(Number(m[3]), Number(m[1]), Number(m[2]));
    return d === null ? null : { date: d, yearGuessed: false };
  }
  m = /^(\d{2})[/.-](\d{1,2})[/.-](\d{1,2})$/u.exec(s);
  if (m !== null) {
    const d = valid(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
    return d === null ? null : { date: d, yearGuessed: false };
  }
  m = /^(\d{1,2})[/.\-月](\d{1,2})日?$/u.exec(s);
  if (m !== null && yearHint !== undefined) {
    const d = valid(yearHint, Number(m[1]), Number(m[2]));
    return d === null ? null : { date: d, yearGuessed: true };
  }
  return null;
}

/** 年月を YYYY-MM に（支払月の欄。「2026年11月」「2026/11」「202611」「11月」＋年の手がかり） */
export function parseYearMonth(raw: string, yearHint?: number): string | null {
  const s = nfkc(raw).replace(/\s+/g, "").replace(/(?:支払|払い|分|請求)+$/u, "");
  if (s === "") return null;
  let m = /^(\d{4})[/.\-年](\d{1,2})月?(?:[/.-]\d{1,2}日?)?$/u.exec(s);
  if (m === null) m = /^((?:19|20)\d{2})(\d{2})(?:\d{2})?$/u.exec(s);
  if (m !== null) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 ? `${y}-${pad(mo)}` : null;
  }
  m = /^(\d{2})[/.-](\d{1,2})$/u.exec(s);
  if (m !== null) {
    const mo = Number(m[2]);
    return mo >= 1 && mo <= 12 ? `${2000 + Number(m[1])}-${pad(mo)}` : null;
  }
  m = /^(\d{1,2})月$/u.exec(s);
  if (m !== null && yearHint !== undefined) {
    const mo = Number(m[1]);
    return mo >= 1 && mo <= 12 ? `${yearHint}-${pad(mo)}` : null;
  }
  return null;
}

/** 支払い方法 */
export type PaymentPlan =
  | { readonly kind: "lump" }
  | { readonly kind: "installment"; readonly count: number; readonly index?: number }
  | { readonly kind: "revolving" }
  | { readonly kind: "bonus" };

const KANJI_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 支払い方法・回数の欄（「1回」「一括」「分割3回」「3回中2回目」「2/3」「リボ」「ボーナス一括」） */
export function parsePlan(raw: string): PaymentPlan | null {
  const s = nfkc(raw).replace(/\s+/g, "").replace(/[一二三四五六七八九十]/gu, (c) => String(KANJI_NUM[c] ?? c));
  if (s === "") return null;
  if (/リボ|ﾘﾎﾞ|REVO/iu.test(s)) return { kind: "revolving" };
  if (/ボーナス|ﾎﾞｰﾅｽ|BONUS/iu.test(s)) return { kind: "bonus" };
  let m = /(\d{1,3})回中(\d{1,3})回目?/u.exec(s);
  if (m !== null) return installment(Number(m[1]), Number(m[2]));
  m = /^(\d{1,3})\/(\d{1,3})(?:回)?$/u.exec(s);
  if (m !== null) return installment(Number(m[2]), Number(m[1]));
  if (/一括|1括|^1回|^1$|^01$|^1回払い?/u.test(s)) return { kind: "lump" };
  m = /(?:分割)?(\d{1,3})回(?:払い?)?$/u.exec(s) ?? /^分割(\d{1,3})$/u.exec(s) ?? /^(\d{1,3})$/u.exec(s);
  if (m !== null) return installment(Number(m[1]));
  return null;
}

function installment(count: number, index?: number): PaymentPlan | null {
  if (!Number.isInteger(count) || count < 1 || count > 120) return null;
  if (count === 1) return { kind: "lump" };
  if (index !== undefined && (index < 1 || index > count)) return { kind: "installment", count };
  return index !== undefined ? { kind: "installment", count, index } : { kind: "installment", count };
}

/** 利用者の欄（本人・家族）。名前が書かれていても名前は読まない・残さない（0012） */
export function parseUser(raw: string): "self" | "family" | null {
  const s = nfkc(raw);
  if (/家族/u.test(s)) return "family";
  if (/本人/u.test(s)) return "self";
  return null;
}

/** 「はい」と読める印（振替の印・計算対象の印など） */
export function truthy(raw: string): boolean {
  const s = nfkc(raw).toLowerCase();
  return s === "1" || s === "○" || s === "◯" || s === "true" || s === "yes" || s === "はい" || s === "y" || s === "対象";
}

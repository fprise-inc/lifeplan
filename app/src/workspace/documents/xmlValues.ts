// 控除証明書の電子データ（XML）の値の読み方（0153 の2・0154 の1）。証明書の種類をまたいで同じ書き方の値（金額・日付・区分・文字）を読む。
// - 金額: 整数の円（カンマ・空白・「円」は外す）
// - 日付: 西暦の子の要素（yyyy・mm・dd）、和暦の子の要素（era・yy・mm・dd。era は元号の番号〔1 明治・2 大正・3 昭和・4 平成・5 令和〕か元号の文字）、
//   20180401・2018-04-01・令和6年8月4日 の形の文字。月だけ・年だけの形も読む（年分・期間の月）
// - 区分: 区分の番号と名前の子の要素（kubun_CD・kubun_NM）か、ただの文字
// - 文字: 番号らしい所を消して短くし、消した数を数える（読み取りの記録の dropped に足す）
import { cleanText } from "./privacy.ts";
import { childOf, textOf, type XmlElement } from "./xml.ts";

/** 金額（整数の円）。無い・読めなければ null */
export function amountOf(e: XmlElement | undefined): number | null {
  const s = textOf(e).normalize("NFKC").replace(/[,\s円]/gu, "");
  if (!/^-?\d{1,13}$/u.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** 0 以上の整数（年数・月数）。読めなければ null */
export function countOf(e: XmlElement | undefined): number | null {
  const s = textOf(e).normalize("NFKC").trim();
  if (!/^\d{1,4}$/u.test(s)) return null;
  return Number(s);
}

export interface Ymd {
  y: number;
  m: number;
  d: number | null;
}

/** 元号の始まりの年の前の年（元号の n 年 = この年 + n） */
const ERA_BASE: Readonly<Record<string, number>> = { "1": 1867, "2": 1911, "3": 1925, "4": 1988, "5": 2018, 明治: 1867, 大正: 1911, 昭和: 1925, 平成: 1988, 令和: 2018, M: 1867, T: 1911, S: 1925, H: 1988, R: 2018 };

const num = (e: XmlElement | undefined): number | null => {
  const s = textOf(e).normalize("NFKC").trim();
  if (s === "元") return 1;
  return /^\d{1,4}$/u.test(s) ? Number(s) : null;
};

function valid(y: number, m: number | null, d: number | null): Ymd | null {
  if (!Number.isInteger(y) || y < 1900 || y > 2200) return null;
  if (m === null || !Number.isInteger(m) || m < 1 || m > 12) return null;
  if (d !== null && (!Number.isInteger(d) || d < 1 || d > 31)) return { y, m, d: null };
  return { y, m, d };
}

/** 年（西暦か和暦の子の要素・文字）。読めなければ null */
export function yearOf(e: XmlElement | undefined): number | null {
  if (e === undefined) return null;
  const yyyy = childOf(e, "yyyy");
  if (yyyy !== undefined) return num(yyyy);
  const era = childOf(e, "era");
  if (era !== undefined) {
    const base = ERA_BASE[textOf(era).normalize("NFKC").trim()];
    const yy = num(childOf(e, "yy"));
    return base === undefined || yy === null ? null : base + yy;
  }
  const s = textOf(e).normalize("NFKC").replace(/\s/gu, "");
  const w = /^(明治|大正|昭和|平成|令和)(\d{1,2}|元)年?/u.exec(s);
  if (w !== null) return (ERA_BASE[w[1] as string] as number) + (w[2] === "元" ? 1 : Number(w[2]));
  const m = /^(\d{4})年?$/u.exec(s);
  return m !== null ? Number(m[1]) : null;
}

/**
 * 日付（年・月・日）。月の無い形は読めない（null）。日の無い形は d が null。
 * 西暦の子の要素（yyyy・mm・dd）・和暦の子の要素（era・yy・mm・dd）・文字（20180401・2018-04-01・2018年4月1日・令和6年8月4日・201804）
 */
export function dateOf(e: XmlElement | undefined): Ymd | null {
  if (e === undefined) return null;
  if (childOf(e, "yyyy") !== undefined || childOf(e, "era") !== undefined) {
    const y = yearOf(e);
    if (y === null) return null;
    return valid(y, num(childOf(e, "mm")), childOf(e, "dd") !== undefined ? num(childOf(e, "dd")) : null);
  }
  const s = textOf(e).normalize("NFKC").replace(/\s/gu, "");
  const w = /^(明治|大正|昭和|平成|令和)(\d{1,2}|元)年(\d{1,2})月(?:(\d{1,2})日)?$/u.exec(s);
  if (w !== null) return valid((ERA_BASE[w[1] as string] as number) + (w[2] === "元" ? 1 : Number(w[2])), Number(w[3]), w[4] !== undefined ? Number(w[4]) : null);
  const m = /^(\d{4})[-/年.]?(\d{1,2})(?:[-/月.]?(\d{1,2})日?)?$/u.exec(s);
  if (m === null) return null;
  return valid(Number(m[1]), Number(m[2]), m[3] !== undefined ? Number(m[3]) : null);
}

export const ym = (d: { y: number; m: number }): string => `${d.y}-${String(d.m).padStart(2, "0")}`;
export const dateText = (d: Ymd): string => `${d.y}年${d.m}月${d.d !== null ? `${d.d}日` : ""}`;

/** 区分（区分の名前の子があればその名前、無ければ文字） */
export function kubunOf(e: XmlElement | undefined): { code: string | null; name: string } {
  if (e === undefined) return { code: null, name: "" };
  const cd = childOf(e, "kubun_CD");
  const nm = childOf(e, "kubun_NM");
  if (cd !== undefined || nm !== undefined) return { code: textOf(cd).normalize("NFKC").trim() || null, name: textOf(nm) };
  return { code: null, name: textOf(e) };
}

/** 番号らしい所を消した数（読み取りの記録の dropped に足す） */
export interface Count {
  masked: number;
}

/** 文字（会社名・保険の種類など）: 番号らしい所を消し、短くする。消した数を数える */
export const shortIn =
  (count: Count) =>
  (s: string, max = 60): string => {
    const c = cleanText(s, max);
    if (c.masked) count.masked++;
    return c.text;
  };

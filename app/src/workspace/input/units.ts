// 入力欄の単位と書式（P: 単位は欄ごとに示し、万円・円、月額・年額を切り替えられる。保存は円の整数・率は10進の文字列。0002）
// 浮動小数点で丸めると往復で1円ずれることがあるので、率と万円の換算は10進の文字列の桁移動で行う

/** 全角の数字・記号を半角に、桁区切りと空白を取り除く */
export function normalizeNumberText(s: string): string {
  return s
    .replace(/[０-９．－，]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ー−‐]/g, "-")
    .replace(/[,\s、]/g, "")
    .trim();
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** 10進の文字列の小数点を n 桁動かす（n>0 で大きく）。結果は余分な0を除いた形 */
export function shiftDecimal(s: string, n: number): string {
  if (!DECIMAL.test(s)) throw new Error("E_DECIMAL");
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [int = "0", frac = ""] = body.split(".");
  const digits = int + frac;
  let point = int.length + n;
  let d = digits;
  if (point <= 0) {
    d = "0".repeat(1 - point) + d;
    point = 1;
  } else if (point > d.length) d = d + "0".repeat(point - d.length);
  let i = d.slice(0, point).replace(/^0+(?=\d)/, "");
  const f = d.slice(point).replace(/0+$/, "");
  if (i === "") i = "0";
  const out = f === "" ? i : `${i}.${f}`;
  return neg && out !== "0" ? `-${out}` : out;
}

/** 率（"0.0065"）→ 百分率の表示（"0.65"） */
export function pctFromRate(rate: string): string {
  return shiftDecimal(rate, 2);
}

/** 百分率の入力（"0.65"・"０．６５"）→ 率（"0.0065"）。読めなければ null */
export function rateFromPct(text: string): string | null {
  const t = normalizeNumberText(text).replace(/%$/, "");
  if (!DECIMAL.test(t)) return null;
  return shiftDecimal(t, -2);
}

/** 1から率を引いた率（"0.2" → "0.8"）。10進の文字列のまま（浮動小数点を使わない） */
export function oneMinus(rate: string): string {
  if (!DECIMAL.test(rate)) throw new Error("E_DECIMAL");
  const frac = rate.split(".")[1]?.length ?? 0;
  const scaled = BigInt(shiftDecimal(rate, frac));
  const one = 10n ** BigInt(frac);
  return shiftDecimal(String(one - scaled), -frac);
}

/** 率どうしが同じ値か（"0.010" と "0.01"） */
export function sameRate(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a == b;
  if (!DECIMAL.test(a) || !DECIMAL.test(b)) return a === b;
  return shiftDecimal(a, 0) === shiftDecimal(b, 0);
}

export type YenUnit = "man" | "yen";
/** 保存している額の期間（月額・年額・1回の額） */
export type YenBasis = "monthly" | "annual" | "once";
/** 画面で見せる期間 */
export type YenPeriod = "monthly" | "annual";

const group3 = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** 円の整数を、万円（小数は必要な桁まで）か円で書く */
export function formatYen(v: number, unit: YenUnit): string {
  if (!Number.isInteger(v)) throw new Error("E_YEN_NOT_INTEGER");
  if (unit === "yen") return (v < 0 ? "-" : "") + group3(String(Math.abs(v)));
  const s = shiftDecimal(String(v), -4);
  const neg = s.startsWith("-");
  const [i = "0", f] = (neg ? s.slice(1) : s).split(".");
  return (neg ? "-" : "") + group3(i) + (f !== undefined ? `.${f}` : "");
}

/** 入力の文字を円の整数にする。万円は小数4桁まで（1円まで）。読めなければ null */
export function parseYen(text: string, unit: YenUnit): number | null {
  const t = normalizeNumberText(text).replace(/(万円|万|円)$/, "");
  if (!DECIMAL.test(t)) return null;
  const s = unit === "man" ? shiftDecimal(t, 4) : t;
  if (s.includes(".")) {
    // 1円未満は四捨五入（画面の入力の便宜。保存は円の整数）
    return Math.round(Number(s));
  }
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** 保存の期間の額を、見せる期間の額にする（月額→年額は12倍。年額→月額は12で割り切れるときだけ） */
export function toPeriod(v: number, basis: YenBasis, period: YenPeriod): number | null {
  if (basis === "once" || basis === period) return v;
  if (basis === "monthly") return v * 12;
  return v % 12 === 0 ? v / 12 : null;
}

/** 見せる期間の額を、保存の期間の額に戻す（年額→月額は1円未満を四捨五入） */
export function fromPeriod(v: number, basis: YenBasis, period: YenPeriod): number {
  if (basis === "once" || basis === period) return v;
  if (basis === "monthly") return Math.round(v / 12);
  return v * 12;
}

/** 整数の入力。読めなければ null */
export function parseInteger(text: string): number | null {
  const t = normalizeNumberText(text).replace(/(歳|か月|ヶ月|ケ月|年|月|人|時間)$/, "");
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/** 年月の入力（2041-06・2041/6・2041年6月・204106）→ "YYYY-MM"。読めなければ null */
export function parseYearMonth(text: string): string | null {
  const t = normalizeNumberText(text).replace(/[／/.年]/g, "-").replace(/月$/, "");
  const m = /^(\d{4})-?(\d{1,2})$/.exec(t);
  if (m === null) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return `${m[1]}-${String(mo).padStart(2, "0")}`;
}

/** 年月を「2041年6月」と書く */
export function formatYearMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
}

/** 和暦（生年月の補助の表示。年の途中の改元は月で分ける） */
export function wareki(ym: string): string {
  const [ys, ms] = ym.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const at = y * 100 + m;
  const era = at >= 201905 ? ["令和", 2018] : at >= 198901 ? ["平成", 1988] : at >= 192612 ? ["昭和", 1925] : at >= 191207 ? ["大正", 1911] : ["明治", 1867];
  const n = y - (era[1] as number);
  return `${era[0] as string}${n === 1 ? "元" : n}年${m}月`;
}

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

/**
 * 円・万円の欄の読み取りの結果。ok なら円の整数（yen）。note は、打った単位が欄の単位と違うなどで読み替えたときの1行（「15万円（150,000円）として入れました」）。
 * bare は単位を付けずに数字だけで打った（欄の単位で読んだ）こと。読めなければ reason（欄の下に出す言葉）
 */
export type YenRead = { ok: true; yen: number; bare: boolean; note: string | null } | { ok: false; reason: string };

/** 10進の文字列を、小数 SCALE 桁の整数（BigInt）にする */
const SCALE = 12;
function scaled(s: string, shift: number): bigint {
  const t = shiftDecimal(s, shift + SCALE);
  if (t.includes(".")) throw new Error("E_DECIMAL_SCALE");
  return BigInt(t);
}

/** 円の額を、端数の無い万円なら「15万円」「1億2,000万円」、そうでなければ「4,500円」と書く（読み替えの知らせの言葉。丸めない） */
function exactYenWords(v: number): string {
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 100_000_000 && a % 10000 === 0) {
    const oku = Math.floor(a / 100_000_000);
    const man = (a % 100_000_000) / 10000;
    return `${sign}${group3(String(oku))}億${man > 0 ? `${group3(String(man))}万` : ""}円`;
  }
  if (a >= 10000 && a % 10000 === 0) return `${sign}${group3(String(a / 10000))}万円`;
  return `${sign}${group3(String(a))}円`;
}

/**
 * 入力の文字を円の整数として読む（欄の単位 unit は、数字だけで打ったときの単位）。
 * - 末尾の単位を見て換算する: 「15万」「15万円」→150,000円、「4500円」「¥4,500」→4,500円、「1.5億」「1億2000万」「1万5000円」「5千円」も読む
 * - 桁区切り（1,200）・全角の数字（１５万）・空白は読み飛ばす
 * - 万円の欄の数字だけ（「12.5」）は万円、円の欄の数字だけ（「125000」）は円。万円で1円未満になる分は四捨五入（保存は円の整数）
 * - 円で書いた額の1円未満の端数（「0.5円」、円の欄の「0.5」）・「1億2000」（万が抜けた形）・漢数字・月額年額の言葉などは読めないとして理由を返す
 */
export function readYen(text: string, unit: YenUnit): YenRead {
  const t0 = normalizeNumberText(text.normalize("NFKC"));
  const fail = (reason: string): YenRead => ({ ok: false, reason });
  const example = unit === "man" ? "例: 12.5・15万・4,500円" : "例: 150000・15万・150,000円";
  if (t0 === "") return fail(`数字で入れてください（${example}）`);
  if (/[〇一二三四五六七八九十百]/.test(t0)) return fail(`数字は 0〜9 で入れてください（${example}）`);
  if (/[月年]/.test(t0)) return fail(`月額・年額は欄の横のボタンで切り替えます。数字と単位だけで入れてください（${example}）`);
  let t = t0;
  let yenMark = false;
  if (/^[¥\\]/.test(t)) {
    yenMark = true;
    t = t.slice(1);
  }
  const m = /^(-)?(?:(\d+(?:\.\d+)?)億)?(?:(\d+(?:\.\d+)?)万)?(?:(\d+(?:\.\d+)?)千)?(\d+(?:\.\d+)?)?(円)?$/.exec(t);
  if (m === null) return fail(`数字で入れてください（${example}）`);
  const [, neg, oku, man, sen, rest, en] = m;
  if (oku === undefined && man === undefined && sen === undefined && rest === undefined) return fail(`数字で入れてください（${example}）`);
  const named = oku !== undefined || man !== undefined || sen !== undefined;
  const explicitYen = en !== undefined || yenMark;
  // 「1億2000」は1億2000万円のつもりのことが多いので、読まずに聞き直す（「1万5000」は1万5000円と読む）
  if (oku !== undefined && man === undefined && sen === undefined && rest !== undefined && !explicitYen) return fail(`「${oku}億${rest}万」のように、万まで書いてください`);
  // 単位の付かない最後の数字の単位: 億・万・千の後や「円」付きなら円、数字だけなら欄の単位
  const restUnit: YenUnit = named || explicitYen ? "yen" : unit;
  if (rest !== undefined && restUnit === "yen" && rest.includes(".") && !/^\d+\.0*$/.test(rest)) return fail("1円未満の端数は入れられません（万円なら「0.5万」のように「万」を付けてください）");
  let total = 0n;
  if (oku !== undefined) total += scaled(oku, 8);
  if (man !== undefined) total += scaled(man, 4);
  if (sen !== undefined) total += scaled(sen, 3);
  if (rest !== undefined) total += scaled(rest, restUnit === "man" ? 4 : 0);
  // 1円未満は四捨五入（万円で打った小さな端数。画面の入力の便宜。保存は円の整数）
  const unitScale = 10n ** BigInt(SCALE);
  const whole = (total + unitScale / 2n) / unitScale;
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) return fail("額が大きすぎます。桁を確かめてください");
  const yen = Number(whole) * (neg !== undefined ? -1 : 1);
  const bare = !named && !explicitYen;
  // 欄の単位と違う形で打った（円の欄の「15万」、万円の欄の「4500円」、どちらの欄でも「1.5億」「1万5000」など）なら、読んだ額を1回知らせる
  const sameAsField = bare || (unit === "man" && man !== undefined && oku === undefined && sen === undefined && rest === undefined && !yenMark) || (unit === "yen" && !named && explicitYen);
  const note = sameAsField ? null : `${exactYenWords(yen)}${unit === "man" ? (yen % 10000 === 0 ? "" : `（${formatYen(yen, "man")}万円）`) : yen % 10000 === 0 && yen !== 0 ? `（${group3(String(Math.abs(yen)))}円）` : ""}として入れました`;
  return { ok: true, yen, bare, note };
}

/** 入力の文字を円の整数にする（readYen の額だけ）。読めなければ null */
export function parseYen(text: string, unit: YenUnit): number | null {
  const r = readYen(text, unit);
  return r.ok ? r.yen : null;
}

/**
 * 打った額の桁が明らかにおかしいときの知らせ（書けるが、欄の下に1回出す）。おかしくなければ null。
 * - 万円の欄に数字だけで10億円以上（円で書いてある書類の額を、円を付けずに写したとき。「478200」→47億8,200万円）
 * - 円の欄に数字だけで1,000円未満（万円のつもりで「15」と打ったとき）
 * - 欄ごとの目安の上限（typicalMax。保存の期間の額）か、月額で1,000万円・年額で1億円を超える額
 */
export function amountWarning(r: Extract<YenRead, { ok: true }>, unit: YenUnit, o: { basis: YenBasis; stored: number; typicalMax?: number | undefined; text: string }): string | null {
  const digits = normalizeNumberText(o.text.normalize("NFKC"));
  if (r.bare && unit === "man" && r.yen >= 1_000_000_000) return `${exactYenWords(r.yen)}として入れました。書類に円で書いてある額なら「${group3(digits.replace(/^-/, ""))}円」のように「円」を付けて打ってください`;
  if (r.bare && unit === "yen" && r.yen > 0 && r.yen < 1000) return `${group3(String(r.yen))}円として入れました。万円のつもりなら「${digits}万」と打ってください`;
  const limit = o.typicalMax ?? (o.basis === "monthly" ? 10_000_000 : o.basis === "annual" ? 100_000_000 : null);
  if (limit !== null && o.stored > limit) return `${o.basis === "monthly" ? "月" : o.basis === "annual" ? "年" : ""}${exactYenWords(o.stored)}として入れました。桁を確かめてください`;
  return null;
}

/**
 * 欄の外（見出しの要約・欄の横のヒント・一覧）の額の書き方。欄の中は入れた値のまま（formatYen）。
 * 1万円以上は万円で小数1桁まで（「8.3万円」「1,234万円」。四捨五入）、1万円未満は円（「4,500円」）。
 * per を付けると「月5万円」「年120万円」（「月」「年」を前）。マイナスは「▲」（結果の画面と同じ）
 */
export function amountText(v: number, per?: "month" | "year"): string {
  if (!Number.isInteger(v)) throw new Error("E_YEN_NOT_INTEGER");
  const a = Math.abs(v);
  let body: string;
  if (a < 10000) body = `${group3(String(a))}円`;
  else {
    // 千円の位で四捨五入して、万円の小数1桁（浮動小数点を使わない）
    const tenths = Math.floor(a / 1000) + (a % 1000 >= 500 ? 1 : 0);
    const i = Math.floor(tenths / 10);
    const f = tenths % 10;
    body = `${group3(String(i))}${f > 0 ? `.${f}` : ""}万円`;
  }
  const head = per === "month" ? "月" : per === "year" ? "年" : "";
  return `${v < 0 && a > 0 ? "▲" : ""}${head}${body}`;
}

/** 欄の外の率の書き方: 百分率で小数2桁まで（"0.0124703" → "1.25%"、"0.01" → "1%"。四捨五入） */
export function rateText(rate: string): string {
  if (!DECIMAL.test(rate)) throw new Error("E_DECIMAL");
  const neg = rate.startsWith("-");
  const pct = shiftDecimal(neg ? rate.slice(1) : rate, 2);
  const [i = "0", f = ""] = pct.split(".");
  let hundredths = BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
  if ((f[2] ?? "0") >= "5") hundredths += 1n;
  const out = shiftDecimal(String(hundredths), -2);
  return `${neg && out !== "0" ? "-" : ""}${out}%`;
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

/** 年月の入力（2041-06・2041/6・2041年6月・204106・令和23年6月・R23.6）→ "YYYY-MM"。読めなければ null */
export function parseYearMonth(text: string): string | null {
  const w = parseWareki(text);
  if (w !== null) return w;
  const t = normalizeNumberText(text).replace(/[／/.年]/g, "-").replace(/月$/, "");
  const m = /^(\d{4})-?(\d{1,2})$/.exec(t);
  if (m === null) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return `${m[1]}-${String(mo).padStart(2, "0")}`;
}

/** 元号の初めの年の前の年（西暦＝これ＋和暦の年） */
const ERAS: readonly (readonly [RegExp, number])[] = [
  [/^(令和|令|r)/i, 2018],
  [/^(平成|平|h)/i, 1988],
  [/^(昭和|昭|s)/i, 1925],
  [/^(大正|大|t)/i, 1911],
  [/^(明治|明|m)/i, 1867],
];

/**
 * 和暦の年月（令和23年6月・R23.6・r23/6・平成元年4月・H31.4）→ "YYYY-MM"。和暦でなければ null。
 * 年は元号の初めの年からの足し算で読む（平成31年5月・令和元年4月のような、改元をまたいだ書き方もそのまま足す）
 */
export function parseWareki(text: string): string | null {
  const t = text.normalize("NFKC").replace(/\s/g, "");
  for (const [re, base] of ERAS) {
    const head = re.exec(t);
    if (head === null) continue;
    const m = /^(元|\d{1,2})(?:年|[.\-/])(\d{1,2})月?$/.exec(t.slice(head[0].length));
    if (m === null) return null;
    const n = m[1] === "元" ? 1 : Number(m[1]);
    const mo = Number(m[2]);
    if (n < 1 || mo < 1 || mo > 12) return null;
    return `${base + n}-${String(mo).padStart(2, "0")}`;
  }
  return null;
}

/** 年月を「2041年6月」と書く */
export function formatYearMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
}

/** 和暦の年だけ（「令和18年」「令和元年」。年の途中の改元は月で分ける） */
export function eraYear(ym: string): string {
  return wareki(ym).replace(/\d+月$/, "");
}

/** 欄の外の年月: 西暦を主に、和暦の年を添える（「2036年11月・令和18年」） */
export function ymWithEra(ym: string): string {
  return `${formatYearMonth(ym)}・${eraYear(ym)}`;
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

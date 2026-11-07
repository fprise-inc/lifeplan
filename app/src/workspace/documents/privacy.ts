// 書類の読み取りで読まない・残さないもの（0148 の3）: 個人番号（マイナンバー）・基礎年金番号・証券番号・口座番号などの番号。
// FP は個人番号を集めて持つ立場に無いので、読み手や AI の答えに入っていても、候補に入る前に落とす（読み口 proposal.ts と、
// 世帯ファイルから読むとき log.ts の両方で通す）。
// - 候補ごと落とす: 値が個人番号らしい（12桁の数。区切りがあっても）・見出しの言葉が番号の欄（個人番号・基礎年金番号・証券番号など）
// - 文字を消す: 元の場所の文字・添え書き・文字の値の中の番号らしい所（明細の取り込みの maskText〔10字以上の数字の並び・番号の見出しの後・
//   7桁以上の数字〕に、12桁の数〔点・スラッシュの区切りも〕と個人番号の見出しの後の数字を足した）
// - 消した所は「●●●●」にし、何桁あったかも残さない。消した数だけ読み取りの記録に残す
import { MASK, maskText } from "../../../../statement/src/index.ts";

/** 番号の欄の見出しの言葉（この見出しの値は候補にしない） */
export const NUMBER_FIELD_WORDS = /(個人番号|マイナンバー|基礎年金番号|年金手帳の番号|被保険者番号|被保険者記号|証券番号|保険証券番号|記号番号|口座番号|カード番号|共済契約者番号|法人番号|お客様番号|お客さま番号|契約者番号|会員番号)/u;

/** 12桁の数（区切りは1字まで: 空白・ハイフン・点・スラッシュ・中黒） */
const SEP = "[\\s\\-‐－―ー.．/／・]";
const TWELVE = new RegExp(`(?<!\\d)\\d(?:${SEP}?\\d){11}(?!${SEP}?\\d)`, "gu");
/** 番号の見出しのすぐ後の数字（4字以上） */
const LABELED = new RegExp(`${NUMBER_FIELD_WORDS.source}\\s*[:：]?\\s*[0-9*X×●•\\-‐－\\s]{4,}`, "gu");
// 制御文字（改行・タブを含む）は空白にする
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "gu");

const nfkc = (s: string): string => s.normalize("NFKC");

/** 文字の中に個人番号らしい12桁の数があるか */
export function hasPersonalNumber(s: string): boolean {
  TWELVE.lastIndex = 0;
  return TWELVE.test(nfkc(s));
}

/** 値が個人番号らしいか（12桁の整数〔千億円以上の額は読み違いとみなす〕・12桁の数を含む文字） */
export function isPersonalNumberValue(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v) && Math.abs(v) >= 1e11 && Math.abs(v) < 1e12;
  if (typeof v === "string") return hasPersonalNumber(v);
  return false;
}

/** 見出しの言葉が番号の欄か */
export const isNumberField = (where: string | undefined): boolean => where !== undefined && NUMBER_FIELD_WORDS.test(nfkc(where));

/**
 * 文字を整える: NFKC・制御文字を空白に・番号らしい所を消す・長さを切る。masked は番号らしい所を消したか
 */
export function cleanText(raw: string, max: number): { text: string; masked: boolean } {
  let s = nfkc(raw).replace(CONTROL, " ").replace(/\s+/gu, " ").trim();
  let masked = false;
  s = s.replace(LABELED, (m, label: string) => {
    if (/\d/u.test(m)) masked = true;
    return `${label} ${MASK}${/\s$/u.test(m) ? " " : ""}`;
  });
  s = s.replace(TWELVE, () => {
    masked = true;
    return MASK;
  });
  const r = maskText(s);
  if (r.masked) masked = true;
  s = r.text;
  if ([...s].length > max) s = `${[...s].slice(0, max - 1).join("")}…`;
  return { text: s, masked };
}

/** 数として読む文字（円・万円・カンマ・小数・%・年月の形）。番号の確かめ（12桁）だけをして、伏せ字にしない */
const NUMBERISH = /^[-+−]?[0-9,.\s]+(円|万円|%|か月|ヶ月|月)?$|^[0-9]{4}[-/年][0-9]{1,2}月?$/u;

/**
 * 候補の文字の値を整える: 数の形（金額・年月など。40字まで）はそのまま、ほかの文字は cleanText（200字まで）。
 * 12桁の数（個人番号らしい）を含む値は呼ぶ側が先に落とす（isPersonalNumberValue）
 */
export function cleanValue(raw: string, max: number): { text: string; masked: boolean } {
  const s = nfkc(raw).trim();
  // 区切りの無い10桁以上の数字（基礎年金番号・口座番号など）は数の形とみなさず、伏せ字にする
  if (NUMBERISH.test(s) && s.length <= 40 && !/\d{10,}/u.test(s)) return { text: s, masked: false };
  return cleanText(s, max);
}

// カード番号・口座番号らしき数字を、読んだ時点で消す（0034 の2）。
// - 読み手は、表のすべての文字の欄をここに通してから外へ返す。元のファイルのバイト列は読み手の外へ出さない
// - 消し方は「●●●●」に置き換える（NFKC で形が変わらない字）（何桁あったかも残さない）
// - 消すもの:
//   A. 数字と伏せ字（* X ● など）が区切り（空白・ハイフン）をはさんで10字以上続くもの（カード番号・伏せ字つきのカード番号・電話番号）
//   B. 「口座番号」「カード番号」「お客様番号」などの見出しのすぐ後の数字（4字以上）
//   C. 区切りの無い7桁以上の数字（口座番号は7桁）
// - 消さないもの: 日付・金額として読める欄（金額は9桁まで。10桁以上は金額として読まない）
import { nfkc } from "./normalize.ts";

export const MASK = "●●●●";

const MASK_CHARS = "0-9*X×●•○◆■#";
const RUN_A = new RegExp(`[${MASK_CHARS}](?:[${MASK_CHARS}]|[\\s\\-‐－―ー](?=[${MASK_CHARS}])){9,}`, "giu");
const LABELED = /(口座番号|口座No\.?|口座|カード番号|カードNo\.?|会員番号|会員No\.?|お客様番号|お客さま番号|顧客番号|契約番号|加入者番号|証券番号|口座記号番号)\s*[:：]?\s*[0-9*X×●•\-‐－\s]{4,}/giu;
const RUN_C = /\d{7,}/g;

function digitsOf(s: string): number {
  let n = 0;
  for (const ch of s) if (/[0-9*X×●•○◆■#]/iu.test(ch)) n++;
  return n;
}

/** 文字の欄の中の番号らしき数字を消す。消したかどうかも返す */
export function maskText(raw: string): { text: string; masked: boolean } {
  const s = nfkc(raw);
  let masked = false;
  // 消した印（●●●●）や、もとから伏せ字（****）だけのところは、もう一度消したとは数えない
  let t = s.replace(LABELED, (m, label: string) => {
    if (/\d/u.test(m)) masked = true;
    return `${label} ${MASK}`;
  });
  t = t.replace(RUN_A, (m) => {
    if (digitsOf(m) < 10) return m;
    if (/\d/u.test(m)) masked = true;
    return MASK;
  });
  t = t.replace(/\*{4,}/gu, MASK);
  t = t.replace(RUN_C, () => {
    masked = true;
    return MASK;
  });
  return { text: t, masked };
}

/** 日付として読める形（区切りあり・8桁の年月日・和暦） */
export const DATE_LIKE = /^(?:\d{2,4}[/.\-年]\d{1,2}(?:[/.\-月]\d{1,2}日?)?|(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])|\d{1,2}[/.\-月]\d{1,2}日?|(?:令和|平成|昭和|[RHS])\s*\d{1,2}[/.\-年]\d{1,2}(?:[/.\-月]\d{1,2}日?)?)$/u;
/** 金額として読める形（9桁まで・カンマ・円・符号・括弧） */
export const AMOUNT_LIKE = /^[-−△▲(（]?\s*[¥￥\\]?\s*(?:\d{1,3}(?:,\d{3}){0,2}|\d{1,9})(?:\.0+)?\s*円?\s*[)）-]?$/u;

/** 表の1つの欄を消す（日付・金額として読める欄はそのまま） */
export function maskCell(raw: string): { text: string; masked: boolean } {
  const s = nfkc(raw);
  if (s === "") return { text: "", masked: false };
  if (DATE_LIKE.test(s) || AMOUNT_LIKE.test(s)) return { text: s, masked: false };
  return maskText(s);
}

/** 見出しから、列ごと消す列か（口座番号・カード番号などの列） */
export const NUMBER_HEADER = /(口座|番号)/u;

/**
 * 文字認識の結果の欄を消す（0034 の段階3）。数字の 0・1 を英字の O・I・l と読むことがある（カード番号の「0000」を「OOOO」など）ので、
 * 英字の O・o・I・l・| も数字とみなして A〜C の消し方で探し、見つかった所を元の文字から消す（消し過ぎの側に倒す）。
 * 日付・金額として読める欄はそのまま。英字を数字とみなして初めて当たる所だけでなく、ふつうの消し方で当たる所も消す
 */
export function maskCellLoose(raw: string): { text: string; masked: boolean } {
  const s = nfkc(raw);
  if (s === "") return { text: "", masked: false };
  if (DATE_LIKE.test(s) || AMOUNT_LIKE.test(s)) return { text: s, masked: false };
  const plain = maskText(s);
  // 英字を数字に置き換えた影の文字（1字は1字のまま。位置がそろう）
  const shadow = [...s].map((ch) => (/[Oo]/u.test(ch) ? "0" : /[Il|]/u.test(ch) ? "1" : ch)).join("");
  if (shadow === s) return plain;
  const chars = [...s];
  const sh = [...shadow];
  // 影の文字で消す所（コードポイントの位置）を集める
  const spans: [number, number, string][] = [];
  const at = (re: RegExp, label: (m: RegExpExecArray) => string | null) => {
    const str = sh.join("");
    re.lastIndex = 0;
    for (let m = re.exec(str); m !== null; m = re.exec(str)) {
      const keep = label(m);
      if (keep === null) continue;
      const from = [...str.slice(0, m.index)].length;
      spans.push([from, from + [...m[0]].length, keep]);
      if (m[0] === "") re.lastIndex++;
    }
  };
  at(new RegExp(LABELED.source, "giu"), (m) => (/\d/u.test(m[0]) ? `${m[1] as string} ${MASK}` : null));
  at(new RegExp(RUN_A.source, "giu"), (m) => (digitsOf(m[0]) >= 10 && /\d/u.test(m[0]) ? MASK : null));
  at(new RegExp(RUN_C.source, "gu"), () => MASK);
  if (spans.length === 0) return plain;
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = "";
  let i = 0;
  for (const [from, to, keep] of spans) {
    if (to <= i) continue;
    out += chars.slice(i, Math.max(i, from)).join("");
    out += from >= i ? keep : MASK;
    i = to;
  }
  out += chars.slice(i).join("");
  // 残りの所もふつうの消し方で消す（伏せ字の並びなど）
  const rest = maskText(out);
  return { text: rest.text, masked: true };
}

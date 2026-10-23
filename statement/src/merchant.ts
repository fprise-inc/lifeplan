// 店の名前をそろえる（0034 の4）。辞書の引き当ても、FP が直した結果を覚えるのも、このそろえた形（店の鍵）で行う。
// 1. NFKC（全角・半角）、英字は大文字、ひらがな→カタカナ、小さいカナ→大きいカナ
// 2. 決済の前置き（「PAYPAY*」「SQ*」「楽天ペイ」「ID」など）を取る
// 3. 支店名（空白の後の「〇〇店」「〇〇支店」など）、末尾の店の番号を取る
// 4. 空白・区切りの記号を取る。長さは 64 字まで
import { MASK } from "./text/mask.ts";
import { foldKana, nfkc } from "./text/normalize.ts";

/** 店の鍵の長さの上限 */
export const MAX_KEY = 64;

/** 決済の前置き（後ろに区切りがあるときだけ取る。前置きの名前は決済の手段の一般の呼び名） */
const PREFIXES = [
  "PAYPAY",
  "ペイペイ",
  "SQ",
  "SQUARE",
  "STRIPE",
  "PAYPAL",
  "楽天ペイ",
  "ラクテンペイ",
  "RAKUTENPAY",
  "RPAY",
  "AUPAY",
  "AU PAY",
  "D払い",
  "D払",
  "Dバライ",
  "メルペイ",
  "APPLE PAY",
  "APPLEPAY",
  "GOOGLE PAY",
  "GOOGLEPAY",
  "QUICPAY",
  "クイックペイ",
  "ID",
  "アイディ",
  "VISAデビット",
  "デビット",
  "JDEBIT",
  "J-DEBIT",
  "EDY",
  "エディ",
  "WAON",
  "ワオン",
  "NANACO",
  "ナナコ",
  "SUICA",
  "スイカ",
  "PASMO",
  "パスモ",
  "モバイルSUICA",
  "ネット",
  "WEB",
  "インターネット",
];

const SEP = "[\\s*＊:：/／\\-ー・.]+";
const PREFIX_RE = new RegExp(`^(?:${PREFIXES.map((p) => foldKana(p).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/ /gu, "\\s?")).join("|")})${SEP}`, "u");

/** 支店名（空白の後ろの「〇〇店」など）。空白が無い名前は取らない（店の名前を削りすぎないため） */
const BRANCH_RE = /\s+\S*(?:店|支店|営業所|号店|SS|出張所|売店|ショップ|SHOP|STORE|テン)$/u;
const TRAILING_NO = /[\s#№NO.]*\d+$/u;

/** 表示用の店の名前（NFKC・空白をそろえる。番号はもう消してある） */
export function displayMerchant(raw: string): string {
  return nfkc(raw).replace(/\s+/gu, " ").slice(0, 120);
}

/** 店の鍵（辞書を引く形） */
export function merchantKey(raw: string): string {
  let s = foldKana(nfkc(raw).toUpperCase()).replace(new RegExp(MASK, "gu"), " ").replace(/\s+/gu, " ").trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(PREFIX_RE, "");
    if (next === s || next.trim() === "") break;
    s = next;
  }
  for (let i = 0; i < 2; i++) {
    const next = s.replace(BRANCH_RE, "").replace(TRAILING_NO, "").trim();
    if (next === "" || next === s) break;
    s = next;
  }
  const key = s.replace(/[\s_\-‐‑–—―−・･.,:：;；'"`()（）[\]［］「」『』【】<>＜＞/／\\*＊#＃!！?？&＆+＋]/gu, "");
  return key.slice(0, MAX_KEY);
}

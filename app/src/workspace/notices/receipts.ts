// 要望・不具合の受付番号（0087 の6）。
// 「要望・不具合を送る」を押すと、アプリが受付番号（でたらめに作る短い番号。例 R-7K2Q）を作って手元に覚え、既定のブラウザで要望のフォームを開く。
// アプリ自身は送らない・通信しない。フォームの URL に差し込むのは受付番号・アプリの版・OS だけ（世帯の情報・FP や PC を識別する値は入れない。0012）。
// フォームのひな形は config/distribution.toml の1か所（src/generated/distribution.ts に写す）。
// 配信元のお知らせの受付番号の並びに、手元に覚えた番号と合うものがあるときだけ「あなたの要望に対応しました」として出す（center.ts）

/** 受付番号に使う文字: 数字と英大文字から、紛らわしい 0・O・1・I・L を除いた31文字 */
export const RECEIPT_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** 受付番号の形（R- と4文字） */
export const RECEIPT_PATTERN = new RegExp(`^R-[${RECEIPT_CHARS}]{4}$`);

/** 手元に覚えた受付番号 */
export interface Receipt {
  code: string;
  /** 覚えた日（YYYY-MM-DD） */
  on: string;
  /** 手で入れた（別の PC で送ったもの） */
  manual?: boolean;
}

/** 受付番号を作る（でたらめ。暗号の乱数で、偏りが出ないように選ぶ） */
export function newReceiptCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let out = "";
  // 31 の倍数（248）以上の値は捨てて引き直す（剰余の偏りを出さない）
  while (out.length < 4) {
    for (const b of random(8)) {
      if (b < 248 && out.length < 4) out += RECEIPT_CHARS[b % 31];
    }
  }
  return `R-${out}`;
}

/** 手で入れた受付番号を読む。読めないときは理由の文（null は読めた） */
export function readReceiptInput(text: string): { code: string } | { error: string } {
  const t = text
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s－ー―‐]/g, "-")
    .replace(/\s+/g, "")
    .replace(/^-+|-+$/g, "");
  const body = t.startsWith("R-") ? t.slice(2) : t.startsWith("R") && t.length === 5 ? t.slice(1) : t;
  const chars = body.replace(/-/g, "");
  if (chars === "") return { error: "受付番号を入れてください（例 R-7K2Q）" };
  if (/[0O1IL]/.test(chars)) return { error: "受付番号には 0・O・1・I・L は使いません。メールの件名の番号をもう一度確かめてください" };
  if (chars.length !== 4 || ![...chars].every((c) => RECEIPT_CHARS.includes(c))) return { error: "受付番号は R- と英数字4文字です（例 R-7K2Q）" };
  return { code: `R-${chars}` };
}

/** 覚えた受付番号に足す（同じ番号は足さない。新しい順） */
export function addReceipt(list: readonly Receipt[], r: Receipt): Receipt[] {
  if (list.some((x) => x.code === r.code)) return [...list];
  return [r, ...list].slice(0, MAX_RECEIPTS);
}
/** 覚えておく受付番号の数の上限（古いものから忘れる） */
export const MAX_RECEIPTS = 200;

/** 実行している OS のおおまかな名前（版の番号などは入れない。0017 の4 で送ってよいのと同じ粒度） */
export function osName(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "不明";
}

/** フォームの URL のひな形に差し込める印（この3つだけ） */
export const FORM_MARKS = { receipt: "{受付番号}", version: "{版}", os: "{OS}" } as const;

/**
 * フォームの URL（ひな形の印に、受付番号・アプリの版・OS を URL の形に直して差し込む）。
 * 引数はこの3つだけ（世帯の情報を渡す口を作らない）。本体（notices.rs の feedback_form_open）も同じひな形に同じ決まりで差し込んで開く
 */
export function feedbackFormUrl(template: string, p: { code: string; appVersion: string; os: string }): string {
  return template.replaceAll(FORM_MARKS.receipt, encodeURIComponent(p.code)).replaceAll(FORM_MARKS.version, encodeURIComponent(p.appVersion)).replaceAll(FORM_MARKS.os, encodeURIComponent(p.os));
}

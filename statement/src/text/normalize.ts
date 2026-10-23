// 文字のそろえ方（0034 の4）: 全角・半角（NFKC）、ひらがな→カタカナ、小さいカナ→大きいカナ、区切りの記号を取る

/** NFKC（全角の英数字・記号を半角に、半角カナを全角に）＋前後の空白を取る */
export function nfkc(s: string): string {
  return s.normalize("NFKC").replace(/[\u00a0\u3000]/gu, " ").trim();
}

const SMALL: Record<string, string> = {
  ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ", ッ: "ツ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ヮ: "ワ", ヵ: "カ", ヶ: "ケ",
};

/** ひらがなをカタカナに、小さいカナを大きいカナに（半角カナの明細は小さいカナを書けないため、そろえて比べる） */
export function foldKana(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    const k = c >= 0x3041 && c <= 0x3096 ? String.fromCodePoint(c + 0x60) : ch;
    out += SMALL[k] ?? k;
  }
  return out;
}

/** 見出し・選択肢の比べ方: NFKC・空白と記号を取る・英字を大文字に・カナをそろえる */
export function looseKey(s: string): string {
  return foldKana(nfkc(s).toUpperCase()).replace(/[\s_\-‐‑–—―−・･.,:：;；'"`()（）[\]［］「」『』【】<>＜＞/／\\*＊#＃]/g, "");
}

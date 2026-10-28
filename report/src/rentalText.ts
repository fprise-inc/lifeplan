// 収益不動産の分析の率の書き方（表示だけ。0082）。アプリの画面と提案書で同じ書き方にする。
// 率はエンジンの10進の文字列（小数12桁まで）を受け取り、桁で四捨五入（0から遠い方。符号は対称）して書く。null は「—」

/** 10進の文字列 s を 10^shift 倍して、小数 digits 桁に四捨五入した文字列（符号は対称） */
function shiftRound(s: string, shift: number, digits: number): string {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [i = "0", f = ""] = body.split(".");
  // 10^shift 倍: 小数点を右へ
  const fp = f.padEnd(shift + digits + 1, "0");
  const intPart = (i + fp.slice(0, shift)).replace(/^0+(?=\d)/, "");
  const frac = fp.slice(shift, shift + digits);
  const next = fp.charAt(shift + digits);
  // 四捨五入（桁の上がりを文字の足し算で）
  let digitsStr = intPart + frac;
  if (next >= "5") {
    const arr = digitsStr.split("").map(Number);
    let k = arr.length - 1;
    while (k >= 0) {
      if ((arr[k] as number) < 9) {
        arr[k] = (arr[k] as number) + 1;
        break;
      }
      arr[k] = 0;
      k--;
    }
    digitsStr = (k < 0 ? "1" : "") + arr.join("");
  }
  const ip = digitsStr.slice(0, digitsStr.length - digits).replace(/^0+(?=\d)/, "") || "0";
  const fr = digitsStr.slice(digitsStr.length - digits);
  const out = digits > 0 ? `${ip}.${fr}` : ip;
  const zero = /^0(\.0*)?$/.test(out);
  return neg && !zero ? `−${out}` : out;
}

/** 割合（"0.052272" → "5.2%"。digits は小数の桁） */
export function pctText(rate: string | null | undefined, digits = 1): string {
  return rate === null || rate === undefined ? "—" : `${shiftRound(rate, 2, digits)}%`;
}

/** 倍（返済余裕率。"1.162316" → "1.16倍"） */
export function timesText(rate: string | null | undefined, digits = 2): string {
  return rate === null || rate === undefined ? "—" : `${shiftRound(rate, 0, digits)}倍`;
}

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

/** 減価償却が終わる年の書き方の材料（分析の数字の物件の欄） */
export interface DepreciationEndFacts {
  depreciationEnd: { building: number | null; equipment: number | null };
  depreciationEndIfContinued?: { building: number | null; equipment: number | null };
  /** 今の予定で売る（売らずに貸し終わるなら false） */
  sells: boolean;
}

/**
 * 減価償却が終わる年の文（画面と提案書で同じ）。売る・貸し終わるまでに終わらないときは、理由が分かる文にする
 * （「売るまでには終わりません（2065年に終わる見込み）」）。償却が無ければ null（呼ぶ側で「—」と、その理由）
 */
export function depreciationEndText(p: DepreciationEndFacts): string | null {
  const until = p.sells ? "売るまで" : "貸し終わるまで";
  const one = (end: number | null, later: number | null | undefined): string | null => (end !== null ? `${end}年` : later != null ? `${until}には終わりません（${later}年に終わる見込み）` : null);
  const b = one(p.depreciationEnd.building, p.depreciationEndIfContinued?.building);
  const e = one(p.depreciationEnd.equipment, p.depreciationEndIfContinued?.equipment);
  if (b !== null && e !== null) return `建物 ${b}・設備 ${e}`;
  if (b !== null) return b;
  if (e !== null) return `設備 ${e}`;
  return null;
}

/** 元金の返済が減価償却費を上回る年の文。計算の最初の年（計算基準年）から上回っていれば「もう上回っています」 */
export function deadCrossText(deadCross: number | null, baseYear: number): string | null {
  if (deadCross === null) return null;
  return deadCross <= baseYear ? "もう上回っています" : `${deadCross}年`;
}

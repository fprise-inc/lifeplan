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
  /** 計算基準年（計算の最初の年）。この年までに終わった分は「設備は2024年に終わり」と書く（0126）。省略は終わったかを見ない */
  baseYear?: number;
}

/**
 * 減価償却が終わる年の文（画面と提案書で同じ）。売る・貸し終わるまでに終わらないときは、理由が分かる文にする
 * （「売るまでには終わりません（2065年に終わる見込み）」）。計算基準年までに終わった分は「設備は2024年に終わり」と書き、
 * これから終わる分を先に置く（「建物 2031年・設備は2024年に終わり」。0126）。償却が無ければ null（呼ぶ側で「—」と、その理由）
 */
export function depreciationEndText(p: DepreciationEndFacts): string | null {
  const until = p.sells ? "売るまで" : "貸し終わるまで";
  const ended = (end: number | null): end is number => end !== null && p.baseYear !== undefined && end <= p.baseYear;
  const one = (end: number | null, later: number | null | undefined): string | null => (end !== null ? `${end}年` : later != null ? `${until}には終わりません（${later}年に終わる見込み）` : null);
  const parts = [
    { name: "建物", end: p.depreciationEnd.building, later: p.depreciationEndIfContinued?.building },
    { name: "設備", end: p.depreciationEnd.equipment, later: p.depreciationEndIfContinued?.equipment },
  ].filter((x) => one(x.end, x.later) !== null);
  if (parts.length === 0) return null;
  const open = parts.filter((x) => !ended(x.end));
  const done = parts.filter((x) => ended(x.end));
  const doneText = done.map((x) => `${x.name}は${x.end}年に終わり`);
  if (open.length === 0) return done.length === 2 ? `建物は${done[0]?.end}年、設備は${done[1]?.end}年に終わり` : parts[0]?.name === "建物" ? `${parts[0]?.end}年に終わり` : (doneText[0] as string);
  // これから終わる物が建物だけで、ほかに何も無いときは名前を付けない（前の書き方のまま）
  const openText = open.map((x) => (parts.length === 1 && x.name === "建物" ? (one(x.end, x.later) as string) : `${x.name} ${one(x.end, x.later)}`));
  return [...openText, ...doneText].join("・");
}

/** 元金の返済が減価償却費を上回る年の文。計算の最初の年（計算基準年）から上回っていれば「もう上回っています」 */
export function deadCrossText(deadCross: number | null, baseYear: number): string | null {
  if (deadCross === null) return null;
  return deadCross <= baseYear ? "もう上回っています" : `${deadCross}年`;
}

// 率（10進の文字列。0002）の足し算・掛け算。浮動小数点を使わず、桁をそろえた整数（BigInt）で計算する
import { shiftDecimal } from "../input/units.ts";

const DECIMAL = /^-?\d+(\.\d+)?$/;

function scaled(s: string): { n: bigint; d: number } {
  if (!DECIMAL.test(s)) throw new Error("E_DECIMAL");
  const d = s.split(".")[1]?.length ?? 0;
  return { n: BigInt(shiftDecimal(s, d)), d };
}

function toText(n: bigint, d: number): string {
  return shiftDecimal(String(n), -d);
}

/** a + b */
export function addRate(a: string, b: string): string {
  const x = scaled(a);
  const y = scaled(b);
  const d = Math.max(x.d, y.d);
  return toText(x.n * 10n ** BigInt(d - x.d) + y.n * 10n ** BigInt(d - y.d), d);
}

/** a − b */
export function subRate(a: string, b: string): string {
  return addRate(a, b.startsWith("-") ? b.slice(1) : `-${b}`);
}

/** a × b */
export function mulRate(a: string, b: string): string {
  const x = scaled(a);
  const y = scaled(b);
  return toText(x.n * y.n, x.d + y.d);
}

/** a ÷ b（小数第 digits 位まで。切り捨て。b が 0 なら E_DECIMAL） */
export function divRate(a: string, b: string, digits = 10): string {
  const x = scaled(a);
  const y = scaled(b);
  if (y.n === 0n) throw new Error("E_DECIMAL");
  // (x.n / 10^x.d) ÷ (y.n / 10^y.d) を 10^digits 倍した整数
  const num = x.n * 10n ** BigInt(digits + y.d);
  const den = y.n * 10n ** BigInt(x.d);
  return toText(num / den, digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** a と b の比べ方（a<b: -1, 同じ: 0, a>b: 1） */
export function cmpRate(a: string, b: string): number {
  const s = subRate(a, b);
  return s === "0" ? 0 : s.startsWith("-") ? -1 : 1;
}

/** 0 を下回らないようにする */
export function nonNegative(a: string): string {
  return a.startsWith("-") ? "0" : a;
}

/** 百分率の見せ方（小数第 digits 位まで。四捨五入）: "0.0065" → "0.65%" */
export function pctText(rate: string, digits = 2): string {
  const x = scaled(rate);
  // 百分率の小数第 digits 位に丸める: 率の小数第 (digits+2) 位
  const target = digits + 2;
  let n = x.n;
  let d = x.d;
  if (d > target) {
    const div = 10n ** BigInt(d - target);
    const neg = n < 0n;
    const abs = neg ? -n : n;
    let q = abs / div;
    if ((abs % div) * 2n >= div) q += 1n;
    n = neg ? -q : q;
    d = target;
  }
  return `${shiftDecimal(toText(n, d), 2)}%`;
}

// 0002: 整数の割り算の丸め。ふだんは number、安全な整数を超えるときだけ BigInt に切り替える
import { EngineError } from "../errors.ts";

export type RoundingMode = "DOWN" | "UP" | "HALF_UP" | "HALF_DOWN" | "HALF_EVEN";
export const ROUNDING_MODES: readonly RoundingMode[] = ["DOWN", "UP", "HALF_UP", "HALF_DOWN", "HALF_EVEN"];

/** number（安全な整数）か bigint の整数 */
export type Int = number | bigint;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const POW10: readonly number[] = [
  1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000, 10000000000,
  100000000000, 1000000000000, 10000000000000, 100000000000000, 1000000000000000,
];

/** 10 の k 乗（0002: `**` を使わず表と掛け算で作る） */
export function pow10(k: number): Int {
  if (!Number.isInteger(k) || k < 0) throw new EngineError("E_ARGUMENT", ["pow10"]);
  const n = POW10[k];
  if (n !== undefined) return n;
  let b = BigInt(POW10[15] as number);
  for (let i = 15; i < k; i++) b *= 10n;
  return b;
}

export function pow10Big(k: number): bigint {
  return BigInt(pow10(k));
}

export function isSafeInt(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n);
}

/** 安全な整数に戻す。範囲外ならエラー。-0 は 0 にする */
export function toSafeNumber(v: Int): number {
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new EngineError("E_UNSAFE_INTEGER");
    return v === 0 ? 0 : v;
  }
  if (v > BigInt(MAX_SAFE) || v < -BigInt(MAX_SAFE)) throw new EngineError("E_UNSAFE_INTEGER");
  const n = Number(v);
  return n === 0 ? 0 : n;
}

/** 積。安全な整数に収まれば number、収まらなければ bigint */
export function mulInt(a: Int, b: Int): Int {
  if (typeof a === "number" && typeof b === "number") {
    const p = a * b;
    // 真の積が範囲内なら浮動小数点の積は正確。範囲外なら丸められて isSafeInteger が偽になる
    if (Number.isSafeInteger(p)) return p === 0 ? 0 : p;
  }
  return BigInt(a) * BigInt(b);
}

function shouldRoundAway(rem: Int, den: Int, qIsOdd: boolean, mode: RoundingMode): boolean {
  // rem は 0 以上 den 未満、den は正
  if (rem === 0 || rem === 0n) return false;
  switch (mode) {
    case "DOWN":
      return false;
    case "UP":
      return true;
    default: {
      // 2*rem と den の比較を、桁あふれしない「rem と den-rem の比較」で行う
      const other = typeof rem === "number" && typeof den === "number" ? den - rem : BigInt(den) - BigInt(rem);
      const cmp = rem > other ? 1 : rem < other ? -1 : 0;
      if (mode === "HALF_UP") return cmp >= 0;
      if (mode === "HALF_DOWN") return cmp > 0;
      return cmp > 0 || (cmp === 0 && qIsOdd);
    }
  }
}

function divRoundPosNumber(n: number, d: number, mode: RoundingMode): number {
  let q = Math.trunc(n / d);
  let r = n - q * d;
  // 浮動小数点の商のずれを整数で直す
  while (r < 0) {
    q -= 1;
    r += d;
  }
  while (r >= d) {
    q += 1;
    r -= d;
  }
  return shouldRoundAway(r, d, q % 2 === 1, mode) ? q + 1 : q;
}

function divRoundPosBig(n: bigint, d: bigint, mode: RoundingMode): bigint {
  const q = n / d;
  const r = n - q * d;
  return shouldRoundAway(r, d, q % 2n === 1n, mode) ? q + 1n : q;
}

/**
 * num ÷ den を丸めた整数。0002: 負の数は絶対値に対して丸め、符号を戻す（0 に向かう丸め）
 */
export function divRound(num: Int, den: Int, mode: RoundingMode): Int {
  if (den === 0 || den === 0n) throw new EngineError("E_ARGUMENT", ["divRound.zero"]);
  const negative = (num < 0) !== (den < 0) && num !== 0 && num !== 0n;
  if (
    typeof num === "number" &&
    typeof den === "number" &&
    Number.isSafeInteger(num) &&
    Number.isSafeInteger(den)
  ) {
    const n = Math.abs(num);
    const d = Math.abs(den);
    if (n + d <= MAX_SAFE) {
      const q = divRoundPosNumber(n, d, mode);
      return q === 0 ? 0 : negative ? -q : q;
    }
  }
  const nb = BigInt(num);
  const db = BigInt(den);
  const q = divRoundPosBig(nb < 0n ? -nb : nb, db < 0n ? -db : db, mode);
  return negative ? -q : q;
}

export function intToString(v: Int): string {
  return typeof v === "number" ? String(v) : v.toString();
}

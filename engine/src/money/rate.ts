// 0002: 率は10進の文字列から作る正確な値（整数×10のマイナス scale 乗）。途中は小数12桁・銀行丸め
import { EngineError } from "../errors.ts";
import { divRound, pow10Big } from "./integer.ts";

export const RATE_MAX_SCALE = 12;

export interface Rate {
  readonly __brand: "Rate";
  /** 10進の仮数 */
  readonly units: bigint;
  /** 小数点以下の桁数（0〜12） */
  readonly scale: number;
}

const RATE_PATTERN = /^-?\d+(\.\d+)?$/;

function make(units: bigint, scale: number): Rate {
  // 末尾の0を落として正規化する（同じ値は同じ表し方）
  let u = units;
  let s = scale;
  while (s > 0 && u % 10n === 0n) {
    u /= 10n;
    s -= 1;
  }
  return Object.freeze({ __brand: "Rate", units: u, scale: s }) as Rate;
}

/** 率を10進の文字列から作る（例: rate("0.0985")） */
export function rate(text: string): Rate {
  if (typeof text !== "string" || !RATE_PATTERN.test(text)) throw new EngineError("E_RATE_FORMAT");
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf(".");
  const intPart = dot < 0 ? body : body.slice(0, dot);
  const fracPart = dot < 0 ? "" : body.slice(dot + 1);
  if (fracPart.length > RATE_MAX_SCALE) throw new EngineError("E_RATE_FORMAT");
  const units = BigInt(intPart + fracPart);
  return make(negative ? -units : units, fracPart.length);
}

export function isRate(v: unknown): v is Rate {
  return typeof v === "object" && v !== null && (v as { __brand?: unknown }).__brand === "Rate";
}

/** 正規化した10進の文字列（データ・根拠の記録に書く形） */
export function rateToString(r: Rate): string {
  const negative = r.units < 0n;
  let digits = (negative ? -r.units : r.units).toString();
  if (r.scale > 0) {
    digits = digits.padStart(r.scale + 1, "0");
    digits = `${digits.slice(0, digits.length - r.scale)}.${digits.slice(digits.length - r.scale)}`;
  }
  return negative ? `-${digits}` : digits;
}

export function rateFromInt(n: number): Rate {
  if (!Number.isSafeInteger(n)) throw new EngineError("E_ARGUMENT", ["rateFromInt"]);
  return make(BigInt(n), 0);
}

export const RATE_ZERO = rate("0");
export const RATE_ONE = rate("1");

function align(a: Rate, b: Rate): [bigint, bigint, number] {
  const s = a.scale > b.scale ? a.scale : b.scale;
  return [a.units * pow10Big(s - a.scale), b.units * pow10Big(s - b.scale), s];
}

/** 小数12桁を超える値を銀行丸めで12桁にする */
function fit(units: bigint, scale: number): Rate {
  if (scale <= RATE_MAX_SCALE) return make(units, scale);
  const q = divRound(units, pow10Big(scale - RATE_MAX_SCALE), "HALF_EVEN");
  return make(BigInt(q), RATE_MAX_SCALE);
}

export function rateAdd(a: Rate, b: Rate): Rate {
  const [x, y, s] = align(a, b);
  return make(x + y, s);
}

export function rateSub(a: Rate, b: Rate): Rate {
  const [x, y, s] = align(a, b);
  return make(x - y, s);
}

export function rateMul(a: Rate, b: Rate): Rate {
  return fit(a.units * b.units, a.scale + b.scale);
}

export function rateMulInt(a: Rate, k: number): Rate {
  if (!Number.isSafeInteger(k)) throw new EngineError("E_ARGUMENT", ["rateMulInt"]);
  return make(a.units * BigInt(k), a.scale);
}

/** 率の割り算（小数12桁・銀行丸め） */
export function rateDiv(a: Rate, b: Rate): Rate {
  if (b.units === 0n) throw new EngineError("E_ARGUMENT", ["rateDiv.zero"]);
  // a/b = (ua/10^sa) / (ub/10^sb) = ua*10^(12+sb-sa) / ub × 10^-12
  const num = a.units * pow10Big(RATE_MAX_SCALE + b.scale - a.scale);
  return make(BigInt(divRound(num, b.units, "HALF_EVEN")), RATE_MAX_SCALE);
}

/** 率の整数乗。0002: 掛け算を n 回繰り返し、1回ごとに小数12桁・銀行丸め */
export function ratePow(r: Rate, n: number): Rate {
  if (!Number.isSafeInteger(n) || n < 0) throw new EngineError("E_ARGUMENT", ["ratePow"]);
  let acc = RATE_ONE;
  for (let i = 0; i < n; i++) acc = rateMul(acc, r);
  return acc;
}

export function rateCompare(a: Rate, b: Rate): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** 率を分数（分子・分母）で返す。金額×率×整数比を1回の丸めで計算するときに使う */
export function rateFraction(r: Rate): { num: bigint; den: bigint } {
  return { num: r.units, den: pow10Big(r.scale) };
}

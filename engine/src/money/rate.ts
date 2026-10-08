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
  /** units が安全な整数に収まるときの number の写し（金額×率を number で正確に計算するため。収まらなければ null） */
  readonly n: number | null;
}

const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);

const RATE_PATTERN = /^-?\d+(\.\d+)?$/;

function make(units: bigint, scale: number): Rate {
  // 末尾の0を落として正規化する（同じ値は同じ表し方）
  let u = units;
  let s = scale;
  while (s > 0 && u % 10n === 0n) {
    u /= 10n;
    s -= 1;
  }
  const n = u <= MAX_SAFE_BIG && u >= -MAX_SAFE_BIG ? Number(u) : null;
  return Object.freeze({ __brand: "Rate", units: u, scale: s, n }) as Rate;
}

// 同じ文字列から作る率は同じ値（凍結した不変の値）なので使い回す
const PARSED = new Map<string, Rate>();

/** 率を10進の文字列から作る（例: rate("0.0985")） */
export function rate(text: string): Rate {
  const hit = typeof text === "string" ? PARSED.get(text) : undefined;
  if (hit !== undefined) return hit;
  if (typeof text !== "string" || !RATE_PATTERN.test(text)) throw new EngineError("E_RATE_FORMAT");
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf(".");
  const intPart = dot < 0 ? body : body.slice(0, dot);
  const fracPart = dot < 0 ? "" : body.slice(dot + 1);
  if (fracPart.length > RATE_MAX_SCALE) throw new EngineError("E_RATE_FORMAT");
  const units = BigInt(intPart + fracPart);
  const r = make(negative ? -units : units, fracPart.length);
  if (PARSED.size < 4096) PARSED.set(text, r);
  return r;
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

// 率は不変の値なので、同じ2つの率の演算の結果を使い回す（月ごとの計算で同じ率どうしの演算を何度も行い、
// BigInt の計算は内蔵の実行環境（QuickJS）で重いため）。結果は同じ値なので、計算の結果には影響しない
type Memo2 = WeakMap<Rate, WeakMap<Rate, Rate>>;
const ADD: Memo2 = new WeakMap();
const SUB: Memo2 = new WeakMap();
const MUL: Memo2 = new WeakMap();
const DIV: Memo2 = new WeakMap();

function memo2(table: Memo2, a: Rate, b: Rate, f: (a: Rate, b: Rate) => Rate): Rate {
  let inner = table.get(a);
  if (inner === undefined) {
    inner = new WeakMap();
    table.set(a, inner);
  }
  const hit = inner.get(b);
  if (hit !== undefined) return hit;
  const v = f(a, b);
  inner.set(b, v);
  return v;
}

export function rateAdd(a: Rate, b: Rate): Rate {
  return memo2(ADD, a, b, (p, q) => {
    const [x, y, s] = align(p, q);
    return make(x + y, s);
  });
}

export function rateSub(a: Rate, b: Rate): Rate {
  return memo2(SUB, a, b, (p, q) => {
    const [x, y, s] = align(p, q);
    return make(x - y, s);
  });
}

export function rateMul(a: Rate, b: Rate): Rate {
  return memo2(MUL, a, b, (p, q) => fit(p.units * q.units, p.scale + q.scale));
}

export function rateMulInt(a: Rate, k: number): Rate {
  if (!Number.isSafeInteger(k)) throw new EngineError("E_ARGUMENT", ["rateMulInt"]);
  return make(a.units * BigInt(k), a.scale);
}

/** 率の割り算（小数12桁・銀行丸め） */
export function rateDiv(a: Rate, b: Rate): Rate {
  if (b.units === 0n) throw new EngineError("E_ARGUMENT", ["rateDiv.zero"]);
  return memo2(DIV, a, b, (p, q) => {
    // a/b = (ua/10^sa) / (ub/10^sb) = ua*10^(12+sb-sa) / ub × 10^-12
    const num = p.units * pow10Big(RATE_MAX_SCALE + q.scale - p.scale);
    return make(BigInt(divRound(num, q.units, "HALF_EVEN")), RATE_MAX_SCALE);
  });
}

/** 率の整数乗。0002: 掛け算を n 回繰り返し、1回ごとに小数12桁・銀行丸め */
export function ratePow(r: Rate, n: number): Rate {
  if (!Number.isSafeInteger(n) || n < 0) throw new EngineError("E_ARGUMENT", ["ratePow"]);
  let acc = RATE_ONE;
  for (let i = 0; i < n; i++) acc = rateMul(acc, r);
  return acc;
}

export function rateCompare(a: Rate, b: Rate): -1 | 0 | 1 {
  if (a === b) return 0;
  if (a.scale === b.scale) return a.units < b.units ? -1 : a.units > b.units ? 1 : 0;
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

const FRACTION = new WeakMap<Rate, { readonly num: bigint; readonly den: bigint }>();

/** 率を分数（分子・分母）で返す。金額×率×整数比を1回の丸めで計算するときに使う */
export function rateFraction(r: Rate): { num: bigint; den: bigint } {
  let f = FRACTION.get(r);
  if (f === undefined) {
    f = Object.freeze({ num: r.units, den: pow10Big(r.scale) });
    FRACTION.set(r, f);
  }
  return f as { num: bigint; den: bigint };
}

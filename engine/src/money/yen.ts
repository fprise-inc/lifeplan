// 0002: 金額は通貨の最小単位の整数。円は Yen 型（区別できる型）、外貨は Money
import { EngineError } from "../errors.ts";

/** 円の金額（安全な整数）。`*` `/` `%` は lint で禁止し、丸め関数を通す */
export type Yen = number & { readonly __brand: "Yen" };

export function yen(n: number): Yen {
  if (!Number.isSafeInteger(n)) throw new EngineError("E_UNSAFE_INTEGER");
  return (n === 0 ? 0 : n) as Yen;
}

export function isYen(n: unknown): n is Yen {
  return typeof n === "number" && Number.isSafeInteger(n) && !Object.is(n, -0);
}

export const YEN_ZERO = yen(0);

// 0002: 安全な整数どうしの足し算・引き算は正確。結果が範囲を超えたらエラー
export function addYen(a: Yen, b: Yen): Yen {
  return yen(a + b);
}

export function subYen(a: Yen, b: Yen): Yen {
  return yen(a - b);
}

export function negYen(a: Yen): Yen {
  return yen(-a);
}

export function sumYen(values: readonly Yen[]): Yen {
  let s = 0;
  for (const v of values) {
    s += v;
    if (!Number.isSafeInteger(s)) throw new EngineError("E_UNSAFE_INTEGER");
  }
  return yen(s);
}

/** ISO 4217 の minor unit（最小単位の桁）。使う通貨だけを足していく */
const MINOR_UNITS: Readonly<Record<string, number>> = Object.freeze({
  JPY: 0,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  CAD: 2,
  CHF: 2,
  CNY: 2,
  HKD: 2,
  NZD: 2,
  SGD: 2,
});

export function minorUnit(currency: string): number {
  const m = MINOR_UNITS[currency];
  if (m === undefined) throw new EngineError("E_ARGUMENT", [`currency.${currency}`]);
  return m;
}

/** 外貨になりうる金額。amount は最小単位の整数 */
export interface Money<C extends string = string> {
  readonly amount: number;
  readonly currency: C;
}

export function money<C extends string>(amount: number, currency: C): Money<C> {
  minorUnit(currency);
  if (!Number.isSafeInteger(amount)) throw new EngineError("E_UNSAFE_INTEGER");
  return Object.freeze({ amount: amount === 0 ? 0 : amount, currency });
}

// 0002: 通貨の違う金額の足し引きは、型と実行時の両方でエラー
export function addMoney<C extends string>(a: Money<C>, b: Money<C>): Money<C> {
  if (a.currency !== b.currency) throw new EngineError("E_CURRENCY_MISMATCH", [a.currency, b.currency]);
  return money(a.amount + b.amount, a.currency);
}

export function subMoney<C extends string>(a: Money<C>, b: Money<C>): Money<C> {
  if (a.currency !== b.currency) throw new EngineError("E_CURRENCY_MISMATCH", [a.currency, b.currency]);
  return money(a.amount - b.amount, a.currency);
}

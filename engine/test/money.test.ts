// 0002: 金額・率・端数処理
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { EngineError } from "../src/errors.ts";
import { divRound, mulInt, ROUNDING_MODES, type RoundingMode } from "../src/money/integer.ts";
import { rate, rateAdd, rateDiv, rateFraction, rateMul, ratePow, rateSub, rateToString } from "../src/money/rate.ts";
import { allocate, convert, divInt, mulRate, mulRatio, round } from "../src/money/rounding.ts";
import { addMoney, money, sumYen, yen } from "../src/money/yen.ts";
import { prng } from "./helpers.ts";

const D = Decimal.clone({ precision: 200 });

// 参照実装: 10進ライブラリで「絶対値を丸めて符号を戻す」
const DEC_MODE: Record<RoundingMode, Decimal.Rounding> = {
  DOWN: Decimal.ROUND_DOWN,
  UP: Decimal.ROUND_UP,
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_DOWN: Decimal.ROUND_HALF_DOWN,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
};
function refDivRound(num: bigint, den: bigint, mode: RoundingMode): bigint {
  const q = new D(num.toString()).div(new D(den.toString()));
  return BigInt(q.toDecimalPlaces(0, DEC_MODE[mode]).toFixed(0));
}

describe("divRound", () => {
  it("境目のちょうど0.5を含め、5つの方式が参照実装と一致する", () => {
    const cases: [number, number][] = [
      [5, 10], [15, 10], [25, 10], [-5, 10], [-15, 10], [-25, 10], [1, 3], [2, 3], [-2, 3], [7, 2], [-7, 2], [0, 7], [149, 100], [150, 100], [151, 100], [250, 100],
    ];
    for (const [n, d] of cases) {
      for (const mode of ROUNDING_MODES) {
        expect(BigInt(divRound(n, d, mode)), `${n}/${d} ${mode}`).toBe(refDivRound(BigInt(n), BigInt(d), mode));
      }
    }
  });

  it("無作為の入力（number の経路と BigInt の経路）で参照実装と一致する", () => {
    const next = prng(20261008);
    for (let i = 0; i < 4000; i++) {
      const big = i % 2 === 0;
      const n = big ? (BigInt(next()) << 40n) * BigInt(next()) - (1n << 60n) : BigInt(next() % 2000001) - 1000000n;
      const d = BigInt((next() % 1000) + 1) * (i % 3 === 0 ? 10n : 1n);
      for (const mode of ROUNDING_MODES) {
        const got = divRound(big ? n : Number(n), big ? d : Number(d), mode);
        expect(BigInt(got)).toBe(refDivRound(n, d, mode));
      }
    }
  });

  it("-0 を返さない", () => {
    expect(Object.is(divRound(-1, 10, "DOWN"), -0)).toBe(false);
    expect(Object.is(divRound(-4, 10, "HALF_UP"), -0)).toBe(false);
  });
});

describe("率", () => {
  it("10進の文字列から正確に作り、正規化した文字列に戻す", () => {
    expect(rateToString(rate("0.0985"))).toBe("0.0985");
    expect(rateToString(rate("0.10"))).toBe("0.1");
    expect(rateToString(rate("-0.000000000001"))).toBe("-0.000000000001");
    expect(rateToString(rate("-0"))).toBe("0");
    expect(rateToString(rate("150.25"))).toBe("150.25");
  });

  it("書式に合わない文字列（指数表記・13桁以上・数値）を拒む", () => {
    for (const bad of ["1e-3", "0.0000000000001", ".5", "1.", "+1", "0x10", ""]) {
      expect(() => rate(bad), bad).toThrow(EngineError);
    }
    expect(() => rate(0.1 as unknown as string)).toThrow(EngineError);
  });

  it("途中は小数12桁・銀行丸めで、参照実装と一致する", () => {
    const next = prng(7);
    const ref = (s: string) => new D(s);
    const R12 = (x: Decimal) => x.toDecimalPlaces(12, Decimal.ROUND_HALF_EVEN);
    for (let i = 0; i < 2000; i++) {
      const a = `${next() % 3}.${String(next() % 1000000).padStart(6, "0")}${String(next() % 1000000).padStart(6, "0")}`;
      const b = `${next() % 2}.${String((next() % 999999) + 1).padStart(6, "0")}`;
      expect(rateToString(rateAdd(rate(a), rate(b)))).toBe(R12(ref(a).plus(b)).toString());
      expect(rateToString(rateSub(rate(a), rate(b)))).toBe(R12(ref(a).minus(b)).toFixed(R12(ref(a).minus(b)).decimalPlaces()));
      expect(rateToString(rateMul(rate(a), rate(b)))).toBe(R12(ref(a).times(b)).toFixed(R12(ref(a).times(b)).decimalPlaces()));
      expect(rateToString(rateDiv(rate(a), rate(b)))).toBe(R12(ref(a).div(b)).toFixed(R12(ref(a).div(b)).decimalPlaces()));
    }
  });

  it("ratePow は掛け算の繰り返し（1回ごとに12桁・銀行丸め）", () => {
    let acc = new D(1);
    for (let i = 0; i < 100; i++) acc = acc.times("1.0123").toDecimalPlaces(12, Decimal.ROUND_HALF_EVEN);
    expect(rateToString(ratePow(rate("1.0123"), 100))).toBe(acc.toFixed(acc.decimalPlaces()));
    expect(rateToString(ratePow(rate("1.5"), 0))).toBe("1");
  });
});

describe("丸め関数", () => {
  const rule = (mode: RoundingMode, unit = 1) => ({ mode, unit });

  it("mulRate: 金額×率を規則で丸める", () => {
    expect(mulRate(yen(123456), rate("0.1"), rule("DOWN", 100)).value).toBe(12300);
    expect(mulRate(yen(1005), rate("0.5"), rule("HALF_UP")).value).toBe(503);
    expect(mulRate(yen(1005), rate("0.5"), rule("HALF_DOWN")).value).toBe(502);
    expect(mulRate(yen(1005), rate("0.5"), rule("HALF_EVEN")).value).toBe(502);
    expect(mulRate(yen(1007), rate("0.5"), rule("HALF_EVEN")).value).toBe(504);
    expect(mulRate(yen(-1005), rate("0.5"), rule("HALF_UP")).value).toBe(-503);
    expect(mulRate(yen(-1005), rate("0.5"), rule("DOWN")).value).toBe(-502);
  });

  it("積が 2^53 を超えるときは BigInt の経路で正確に計算する", () => {
    const amount = yen(9_000_000_000_000_000);
    const r = rate("0.123456789012");
    expect(typeof mulInt(amount, r.units)).toBe("bigint");
    const exact = new D(amount.toString()).times("0.123456789012").toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
    expect(mulRate(amount, r, rule("HALF_EVEN")).value).toBe(Number(exact.toFixed(0)));
    // 単位が大きく分母が 2^53 を超える場合
    expect(mulRate(yen(123456789), rate("0.000000000001"), rule("UP", 10000)).value).toBe(10000);
  });

  it("mulRatio・divInt・round・convert", () => {
    expect(mulRatio(yen(1000), 1, 3, rule("DOWN")).value).toBe(333);
    expect(mulRatio(yen(1000), 2, 3, rule("HALF_UP")).value).toBe(667);
    expect(divInt(yen(1000000), 12, rule("DOWN")).value).toBe(83333);
    expect(round(yen(123456), rule("DOWN", 100)).value).toBe(123400);
    expect(round(yen(123450), rule("HALF_UP", 100)).value).toBe(123500);
    expect(round(yen(123450), rule("HALF_DOWN", 100)).value).toBe(123400);
    // 12345 セント × 150.25 円/ドル = 18548.3625 円
    expect(convert(money(12345, "USD"), rate("150.25"), rule("DOWN")).value).toBe(18548);
    expect(convert(money(100, "JPY"), rate("1"), rule("DOWN")).value).toBe(100);
  });

  it("丸めの前の値を分数で返す（根拠の記録用）", () => {
    const r = mulRate(yen(1005), rate("0.5"), rule("HALF_UP"));
    expect([String(r.num), String(r.den)]).toEqual(["5025", "10"]);
  });

  it("allocate は合計を保つ（無作為の入力）", () => {
    const next = prng(42);
    for (let i = 0; i < 1000; i++) {
      const total = yen((next() % 2000000) - 1000000);
      const weights = Array.from({ length: (next() % 12) + 1 }, () => next() % 10);
      if (!weights.some((w) => w > 0)) weights[0] = 1;
      const mode = ROUNDING_MODES[next() % 5] as RoundingMode;
      const shares = allocate(total, weights, rule(mode), i % 2 === 0 ? "first" : "last");
      expect(sumYen(shares)).toBe(total);
    }
    expect(allocate(yen(1000000), Array(12).fill(1), rule("DOWN"), "last")).toEqual([...Array(11).fill(83333), 83337]);
  });
});

describe("金額の型", () => {
  it("安全な整数の範囲を超えるとエラー、-0 は 0 にする", () => {
    expect(() => yen(2 ** 53)).toThrow(EngineError);
    expect(() => yen(0.5)).toThrow(EngineError);
    expect(Object.is(yen(-0), -0)).toBe(false);
  });

  it("通貨の違う金額は足せない", () => {
    expect(() => addMoney(money(1, "USD") as never, money(1, "EUR") as never)).toThrow("E_CURRENCY_MISMATCH");
    expect(addMoney(money(1, "USD"), money(2, "USD")).amount).toBe(3);
  });

  it("率の分数", () => {
    expect(rateFraction(rate("0.025"))).toEqual({ num: 25n, den: 1000n });
  });
});

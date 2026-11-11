// AI接続口のプランの動かす項目の JS の頭に置く、組み込みの代わり（scripts/build-explain.ts の PLAN_INTRO。0195）が、Node の組み込みと
// 同じ答えを返すこと（接続口の固めた実行環境には Intl・structuredClone・TextEncoder が無く、Math.round・Math.pow は呼べない）
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PLAN_INTRO } from "../scripts/build-explain.ts";

type Shims = {
  Math: { round: (x: number) => number; pow: (a: number, b: number) => number; floor: (x: number) => number };
  structuredClone: (v: unknown) => unknown;
  TextEncoder: new () => { encode: (s: string) => Uint8Array };
  __fxLocale: (x: unknown, locale?: string, opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number }) => string;
  crypto: { randomUUID: () => string };
};
const shims = runInNewContext(`${PLAN_INTRO}; ({ Math, structuredClone, TextEncoder, __fxLocale, crypto })`) as Shims;

const NUMBERS = [0, -0, 1, -1, 0.5, -0.5, 1.5, 2.5, -2.5, 0.49999999999999994, 1.005, 2.675, 12345.6789, -98765.4321, 1234567, 20000000, 0.1 + 0.2, 1e21, 1.5e-7, 123456789012, 0.0005, 9.9995, 999.9996, 1 / 3, 2 / 3, 1e-10, 4.35, 2.345, 8.125, 0.125];

describe("プランの動かす項目の JS の頭に置く、組み込みの代わり（0195）", () => {
  it("Math.round は Node と同じ", () => {
    for (const x of [...NUMBERS, 3.4999999999999996, -3.5, 4503599627370495.5, 2 ** 53, -(2 ** 53) - 2, Infinity, -Infinity, NaN]) expect(Object.is(shims.Math.round(x), Math.round(x)), String(x)).toBe(true);
    expect(shims.Math.floor(2.7)).toBe(2);
  });

  it("Math.pow は整数の指数で Node とほぼ同じ（住宅ローンの返済額の式）で、整数でない指数はエラー", () => {
    for (const [a, b] of [[1.001, 420], [1 + 0.015 / 12, -360], [10, 3], [2, 0], [1.0025, -1]] as const) expect(Math.abs(shims.Math.pow(a, b) / Math.pow(a, b) - 1)).toBeLessThan(1e-12);
    expect(shims.Math.pow(10, 2)).toBe(100);
    expect(() => shims.Math.pow(2, 0.5)).toThrow();
  });

  it("数の toLocaleString は Intl と同じ形", () => {
    for (const x of NUMBERS) {
      for (const locale of ["ja-JP", "en-US"]) {
        expect(shims.__fxLocale(x, locale), `${x} ${locale}`).toBe(x.toLocaleString(locale));
        for (const d of [0, 1, 2, 3, 4]) expect(shims.__fxLocale(x, locale, { maximumFractionDigits: d }), `${x} ${locale} ${d}`).toBe(x.toLocaleString(locale, { maximumFractionDigits: d }));
      }
      expect(shims.__fxLocale(x), String(x)).toBe(x.toLocaleString());
    }
    expect(shims.__fxLocale(NaN)).toBe(NaN.toLocaleString("ja-JP"));
    expect(shims.__fxLocale(Infinity)).toBe(Infinity.toLocaleString("ja-JP"));
    expect(shims.__fxLocale("文字")).toBe("文字");
  });

  it("structuredClone・TextEncoder・crypto.randomUUID", () => {
    const v = { a: [1, { b: "x", c: undefined }], d: null, g: "文字", h: true };
    const c = shims.structuredClone(v) as typeof v;
    expect(c).toEqual(structuredClone(v));
    expect(c.a).not.toBe(v.a);
    expect("c" in (c.a[1] as object)).toBe(true);
    // Map・Set（同じ実行環境で作った物）
    const m = runInNewContext(`${PLAN_INTRO}; const v = { e: new Map([["k", [1]]]), f: new Set([2]) }; const c = structuredClone(v); [c.e.get("k")[0], c.f.has(2), c.e !== v.e]`) as unknown[];
    expect(m).toEqual([1, true, true]);
    for (const s of ["lifeplan.migrate.0.17:abc/1", "日本語・𠮷野家", "\ud800x"]) expect([...new shims.TextEncoder().encode(s)]).toEqual([...new TextEncoder().encode(s)]);
    expect(shims.crypto.randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

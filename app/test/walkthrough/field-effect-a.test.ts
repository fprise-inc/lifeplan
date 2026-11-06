// 欄ごとの効き目（入力項目で4つに分けて並べて流す。中身は fieldEffect.ts）
import { describe, expect, it } from "vitest";
import { effectIn, fieldEffectSuite, WALKTHROUGH } from "./fieldEffect.ts";

fieldEffectSuite("a", ["family", "work", "retirement", "pension"]);

// 世帯を決めて見る欄（同じ形の欄でも、書類の種類で効き方が違う）
describe.skipIf(!WALKTHROUGH)("世帯を決めて見る欄", () => {
  it("ねんきん定期便（50歳未満）の老齢基礎年金の額は、計算が加入月数から出すので欄を出さない（写しても効かない欄を見せない）", { timeout: 120_000 }, () => {
    expect(() => effectIn("salariedCoupleTwoKids", "pension", "pension:pension/*/amounts/basic")).toThrow(/欄がありません/);
  });
});

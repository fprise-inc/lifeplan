// 欄ごとの効き目（入力項目で4つに分けて並べて流す。中身は fieldEffect.ts）
import { describe, expect, it } from "vitest";
import { effectIn, fieldEffectSuite, WALKTHROUGH } from "./fieldEffect.ts";

fieldEffectSuite("a", ["family", "work", "retirement", "pension"]);

// 直す待ち（同じ形の欄でも、書類の種類で効き方が違うので、世帯を決めて見る）。直したら it.fails を it にする
describe.skipIf(!WALKTHROUGH)("直す待ち（世帯を決めて見る欄）", () => {
  it.fails("ねんきん定期便（50歳未満）の老齢基礎年金の額を変えると、年金の見込みが変わる（今は加入月数から計算し直すので変わらない）", { timeout: 120_000 }, () => {
    expect(effectIn("salariedCoupleTwoKids", "pension", "pension:pension/*/amounts/basic")).toBe(true);
  });
});

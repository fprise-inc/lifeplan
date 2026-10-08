// 答え合わせ（検証 L2）: 公式の計算例との一致（cases.ts）
import { describe, expect, it } from "vitest";
import { CASES } from "./l2/cases.ts";

describe("公式の計算例", () => {
  for (const c of CASES) {
    if (c.status === "pass") {
      it(`${c.id}: ${c.title}`, () => expect(c.actual()).toBe(c.expected));
    } else {
      // 扱いの違いが分かっている例。いつの間にか一致したら、原因の記述を見直すために知らせる
      it(`${c.id}（違いが分かっている例）: ${c.title}`, () => expect(c.actual()).not.toBe(c.expected));
    }
  }
});

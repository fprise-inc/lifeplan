// 0002: 法令に定めがない丸め（エンジンの規約）。ID は conv. で始める
import type { RoundingRule } from "./rounding.ts";

export const CONVENTIONS: Readonly<Record<string, RoundingRule>> = Object.freeze({
  // 0003: 運用益は円未満切り捨て
  "conv.investment.return": Object.freeze({ mode: "DOWN", unit: 1 }),
  // 年額などを月に分けるときの既定（端数は allocate の寄せ先へ）
  "conv.flow.allocate": Object.freeze({ mode: "DOWN", unit: 1 }),
});

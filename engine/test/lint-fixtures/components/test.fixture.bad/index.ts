// lint が止めることを確かめるための、わざと誤った部品（lint の本体の対象外）
import { yen, type Yen } from "../../../../src/sdk/index.ts";
import { other } from "../test.fixture.other/index.ts";
import { mulRate } from "../../../../src/money/rounding.ts";

let counter = 0;

export function bad(a: Yen): number {
  counter += 1;
  const p = Math.pow(1.01, 10);
  const q = 2 ** 3;
  const r = Number((1).toFixed(2));
  const s = a * 2;
  const t = yen(100) / 3;
  const u = Math.random() + Math.round(1) + Math.exp(1);
  const v = new Date().getTime();
  const w = parseFloat("1");
  return p + q + r + s + t + u + v + w + other + counter + Number(mulRate);
}

// 0113 の8: 計算部品は互換モードを読まない
export function compat(ctx: { conventions: Record<string, unknown> }): unknown {
  const { compatibility } = ctx.conventions;
  return [compatibility, ctx.conventions.compatibility, ctx.conventions["compatibility"], "compatibility" in ctx.conventions];
}

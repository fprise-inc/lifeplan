// lint を通る部品の書き方
import { addYen, rate, yen, type Yen } from "../../../../src/sdk/index.ts";
import { helper } from "./helper.ts";

const LIMIT = yen(100);

export function good(a: Yen, n: number): Yen {
  const r = rate("0.007");
  return yen(addYen(a, LIMIT) + helper(n * 2, Math.floor(n / 3), Math.max(1, n)) + (r.scale > 0 ? 0 : 1));
}

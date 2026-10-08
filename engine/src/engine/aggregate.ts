// 0003 の2・0004 の6: お金の動きを年に集める
import { isUnder } from "../ids/cfTree.ts";
import { yen, type Yen } from "../money/yen.ts";
import { parseYm, yearOf, type MonthIndex } from "../time/month.ts";
import type { Aggregation, Flow } from "./types.ts";

/**
 * そのお金の動きを表のどの年に載せるか。cash は支払月の年、accrual は帰属の年。
 * accrual で表の最初の年より前に帰属するものは、最初の年に載せる（計上は基準月以降の支払いだけなので）
 */
export function tableYear(f: Flow, aggregation: Aggregation, baseYear: number): number {
  if (aggregation === "cash") return yearOf(parseYm(f.ym));
  return f.accrualYear < baseYear ? baseYear : f.accrualYear;
}

/** 年間収支（収入−税・社会保険料−支出）。器の間の移動（cf.transfer）は含めない */
export function netByYear(flows: readonly Flow[], aggregation: Aggregation, base: MonthIndex, end: MonthIndex): Map<number, Yen> {
  const out = new Map<number, Yen>();
  const baseYear = yearOf(base);
  for (const f of flows) {
    const m = parseYm(f.ym);
    if (m < base || m > end) continue;
    let sign = 0;
    if (isUnder(f.row, "cf.income")) sign = 1;
    else if (isUnder(f.row, "cf.taxSi") || isUnder(f.row, "cf.expense")) sign = -1;
    if (sign === 0) continue;
    const y = tableYear(f, aggregation, baseYear);
    const cur = out.get(y) ?? yen(0);
    out.set(y, yen(sign > 0 ? cur + f.amount : cur - f.amount));
  }
  return out;
}

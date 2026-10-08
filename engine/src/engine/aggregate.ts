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

/** 年間収支に足す向き（収入は＋、税・社会保険料と支出は−、器の間の移動などは 0） */
function signOf(row: string): number {
  if (isUnder(row, "cf.income")) return 1;
  if (isUnder(row, "cf.taxSi") || isUnder(row, "cf.expense")) return -1;
  return 0;
}

/** 年間収支（収入−税・社会保険料−支出）。器の間の移動（cf.transfer）は含めない */
export function netByYear(flows: readonly Flow[], aggregation: Aggregation, base: MonthIndex, end: MonthIndex): Map<number, Yen> {
  const out = new Map<number, Yen>();
  const baseYear = yearOf(base);
  // 同じ月・同じ行の文字列は何度も出るので、月の番号と向きは文字列ごとに1回だけ求める
  const months = new Map<string, number>();
  const signs = new Map<string, number>();
  for (const f of flows) {
    let m = months.get(f.ym);
    if (m === undefined) {
      m = parseYm(f.ym);
      months.set(f.ym, m);
    }
    if (m < base || m > end) continue;
    let sign = signs.get(f.row);
    if (sign === undefined) {
      sign = signOf(f.row);
      signs.set(f.row, sign);
    }
    if (sign === 0) continue;
    const y = aggregation === "cash" ? Math.floor(m / 12) : tableYear(f, aggregation, baseYear);
    const cur = out.get(y) ?? yen(0);
    out.set(y, yen(sign > 0 ? cur + f.amount : cur - f.amount));
  }
  return out;
}

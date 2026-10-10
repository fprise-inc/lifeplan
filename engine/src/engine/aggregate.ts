// 0003 の2・0004 の6: お金の動きを年に集める
import { isUnder } from "../ids/cfTree.ts";
import { EngineError } from "../errors.ts";
import { numTable } from "./numTable.ts";
import type { Yen } from "../money/yen.ts";
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
  // 年ごとの合計は数の鍵の表で足し、最後に最初に出た年の順の Map にする
  const sums = numTable<number>();
  const years: number[] = [];
  const baseYear = yearOf(base);
  // 同じ行の向きは文字列ごとに1回だけ求める（月の番号は parseYm が覚えている）。部品の出力は同じ月・同じ行のお金の動きが続くので、
  // 1つ前と同じなら引き直さない（0005 の追記（2026-10-10））。足すたびに yen と同じ確かめ（安全な整数）をする
  const signs = new Map<string, number>();
  let lastYm: string | null = null;
  let lastM = 0;
  let lastRow: string | null = null;
  let lastSign = 0;
  for (const f of flows) {
    const ym = f.ym;
    if (ym !== lastYm) {
      lastM = parseYm(ym);
      lastYm = ym;
    }
    const m = lastM;
    if (m < base || m > end) continue;
    const row = f.row;
    if (row !== lastRow) {
      let sign = signs.get(row);
      if (sign === undefined) {
        sign = signOf(row);
        signs.set(row, sign);
      }
      lastSign = sign;
      lastRow = row;
    }
    const sign = lastSign;
    if (sign === 0) continue;
    const y = aggregation === "cash" ? Math.floor(m / 12) : tableYear(f, aggregation, baseYear);
    const cur = sums[y];
    if (cur === undefined) years.push(y);
    const v = sign > 0 ? (cur ?? 0) + f.amount : (cur ?? 0) - f.amount;
    if (typeof v !== "number" || v % 1 !== 0 || v > Number.MAX_SAFE_INTEGER || v < -Number.MAX_SAFE_INTEGER) throw new EngineError("E_UNSAFE_INTEGER");
    sums[y] = v === 0 ? 0 : v;
  }
  const out = new Map<number, Yen>();
  for (const y of years) out.set(y, sums[y] as Yen);
  return out;
}

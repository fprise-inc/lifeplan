// パックの版（年.通し番号.訂正番号）と約束の版（MAJOR.MINOR）の比較
import { EngineError } from "../errors.ts";

export function comparePackVersion(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < 3; i++) {
    const d = Number(pa[i] ?? "0") - Number(pb[i] ?? "0");
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function contractMajor(contract: string): number {
  const m = /^(\d+)\.(\d+)$/.exec(contract);
  if (m === null) throw new EngineError("E_COMPONENT_DEFINITION", ["contract"]);
  return Number(m[1]);
}

/**
 * 0007 の3: パックの requires の範囲（例 ">=1 <3"）を MAJOR が満たすか。
 * 比較は空白区切りの AND。演算子は >= > <= < = のどれか、数は MAJOR
 */
export function satisfiesRange(major: number, range: string): boolean {
  const parts = range.trim().split(/\s+/);
  if (parts.length === 0) throw new EngineError("E_ARGUMENT", ["range"]);
  for (const p of parts) {
    const m = /^(>=|<=|>|<|=)?(\d+)$/.exec(p);
    if (m === null) throw new EngineError("E_ARGUMENT", ["range"]);
    const n = Number(m[2]);
    const ok =
      m[1] === ">=" ? major >= n : m[1] === ">" ? major > n : m[1] === "<=" ? major <= n : m[1] === "<" ? major < n : major === n;
    if (!ok) return false;
  }
  return true;
}

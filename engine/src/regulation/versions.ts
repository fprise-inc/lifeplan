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

const RANGE_PART = /^(>=|<=|>|<|=)?(\d+)$/;

/**
 * 0006・0007 の追記: requires の範囲（例 ">=1 <2"）。空白区切りの AND、演算子は >= > <= < =、数は約束の版の MAJOR。
 * 演算子のない数 "N" は ">=N <N+1" の省略形（MAJOR は整数なので N と一致するのと同じ）
 */
export function isRange(range: string): boolean {
  const parts = range.trim().split(/\s+/);
  return range.trim() !== "" && parts.every((p) => RANGE_PART.test(p));
}

export function satisfiesRange(major: number, range: string): boolean {
  if (!isRange(range)) throw new EngineError("E_ARGUMENT", ["range"]);
  for (const p of range.trim().split(/\s+/)) {
    const m = RANGE_PART.exec(p) as RegExpExecArray;
    const n = Number(m[2]);
    const ok =
      m[1] === ">=" ? major >= n
      : m[1] === ">" ? major > n
      : m[1] === "<=" ? major <= n
      : m[1] === "<" ? major < n
      : m[1] === "=" ? major === n
      : major >= n && major < n + 1;
    if (!ok) return false;
  }
  return true;
}

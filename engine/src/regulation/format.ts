// 0007 の3・0001 の追記: 制度データの形式の版。β公開までは 0.x（最初は 0.1）
import { EngineError } from "../errors.ts";

export const REGULATION_FORMAT_VERSION = "0.1";

/**
 * このエンジンが読める形式の版か。1.0 からは「大が同じなら読める」。
 * 0.x の間は小の版の違いも互換を壊しうるものとして扱い、同じ 0.MINOR だけを読む（PR の提案）
 */
export function isReadableFormat(version: string): boolean {
  const m = /^(\d+)\.(\d+)$/.exec(version);
  const own = /^(\d+)\.(\d+)$/.exec(REGULATION_FORMAT_VERSION);
  if (m === null || own === null) throw new EngineError("E_PACK_FORMAT_VERSION", [version]);
  if (m[1] !== own[1]) return false;
  return own[1] !== "0" || m[2] === own[2];
}

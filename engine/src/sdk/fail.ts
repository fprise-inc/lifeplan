// 部品が計算を止めるとき。エラーには ID だけを入れ、値は入れない（0005 の8）
import { EngineError, type ErrorCode } from "../errors.ts";

export function fail(code: Extract<ErrorCode, "E_ARGUMENT" | "E_PARAM_KIND" | "E_PARAM_NO_VALUE" | "E_PARAM_UNSUPPORTED">, ids: readonly string[]): never {
  throw new EngineError(code, ids);
}

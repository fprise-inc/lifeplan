// 0005: エラーには ID だけを入れ、値（顧客の数字）は入れない
export type ErrorCode =
  | "E_INPUT_SCHEMA"
  | "E_OUTPUT_SCHEMA"
  | "E_COMPONENT_SCHEMA"
  | "E_PACK_SCHEMA"
  | "E_PACK_FORMAT_VERSION"
  | "E_PACK_FEATURE"
  | "E_PACK_DUPLICATE"
  | "E_PACK_UNKNOWN"
  | "E_PARAM_UNDECLARED"
  | "E_PARAM_UNKNOWN"
  | "E_PARAM_NO_VALUE"
  | "E_PARAM_AMBIGUOUS"
  | "E_PARAM_KIND"
  | "E_PARAM_UNSUPPORTED"
  | "E_ROUNDING_UNKNOWN"
  | "E_READ_UNDECLARED"
  | "E_CALL_UNDECLARED"
  | "E_COMPONENT_UNKNOWN"
  | "E_COMPONENT_DUPLICATE"
  | "E_COMPONENT_DEFINITION"
  | "E_COMPONENT_CYCLE"
  | "E_CONTRACT_MISMATCH"
  | "E_NOT_REPLACEABLE"
  | "E_SLOT_UNKNOWN"
  | "E_SLOT_CLOSED"
  | "E_SLOT_ROW"
  | "E_FORMULA_MISSING"
  | "E_ROW_UNKNOWN"
  | "E_ID_FORMAT"
  | "E_TIMEPOINT_CYCLE"
  | "E_TIMEPOINT_UNKNOWN"
  | "E_UNSAFE_INTEGER"
  | "E_CURRENCY_MISMATCH"
  | "E_RATE_FORMAT"
  | "E_ARGUMENT";

export class EngineError extends Error {
  readonly code: ErrorCode;
  readonly ids: readonly string[];

  constructor(code: ErrorCode, ids: readonly string[] = []) {
    super(ids.length > 0 ? `${code}: ${ids.join(", ")}` : code);
    // 0005: 凍結後の Error.prototype.name への代入（override mistake の対策の確認を兼ねる）
    this.name = "EngineError";
    this.code = code;
    this.ids = ids;
  }
}

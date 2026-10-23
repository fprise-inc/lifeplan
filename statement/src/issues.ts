// 知らせ（読めなかった行・短い期間・カードの引き落としを除外しなかった、など）。画面はこの文をそのまま FP に見せてよい
export type IssueLevel = "error" | "warning" | "info";

export type IssueCode =
  | "S_FILE_TOO_LARGE"
  | "S_FILE_EMPTY"
  | "S_FILE_DUPLICATE"
  | "S_FORMAT_UNKNOWN"
  | "S_TOO_MANY_ROWS"
  | "S_ENCODING"
  | "S_NO_HEADER"
  | "S_MAPPING_NEEDED"
  | "S_MAPPING_INVALID"
  | "S_ROW_DATE"
  | "S_ROW_AMOUNT"
  | "S_ROW_YEAR"
  | "S_NO_ROWS"
  | "S_PDF_ENCRYPTED"
  | "S_PDF_BROKEN"
  | "S_PDF_NO_TEXT"
  | "S_PDF_FILTER"
  | "S_PDF_LIMIT"
  | "S_MASKED"
  | "S_SHORT_PERIOD"
  | "S_VERY_SHORT_PERIOD"
  | "S_NO_PERIOD"
  | "S_SEASONAL"
  | "S_CARD_PAYMENT_KEPT"
  | "S_CARD_PAYMENT_EXCLUDED"
  | "S_REVOLVING"
  | "S_REFUND_UNMATCHED"
  | "S_DUPLICATE_ROWS"
  | "S_LOG_SHAPE";

export interface Issue {
  readonly level: IssueLevel;
  readonly code: IssueCode;
  readonly message: string;
  /** 関係する元のファイルの行（1始まり）。PDF は読み取った行の順番 */
  readonly line?: number;
}

export function issue(level: IssueLevel, code: IssueCode, message: string, line?: number): Issue {
  return { level, code, message, ...(line !== undefined ? { line } : {}) };
}

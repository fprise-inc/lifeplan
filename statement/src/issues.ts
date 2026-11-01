// 知らせ（読めなかった行・短い期間・カードの引き落としを除外しなかった、など）。画面はこの文をそのまま FP に見せてよい
export type IssueLevel = "error" | "warning" | "info";

export type IssueCode =
  | "S_FILE_TOO_LARGE"
  | "S_FILE_EMPTY"
  | "S_FILE_DUPLICATE"
  | "S_FORMAT_UNKNOWN"
  | "S_TOO_MANY_ROWS"
  | "S_ENCODING"
  | "S_CSV_QUOTE"
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
  | "S_DURABLE"
  | "S_LOG_SHAPE"
  // 前もってお客さまに印を付けてもらう確認シート（0034 の9）
  | "S_SHEET_PLAINTEXT"
  | "S_SHEET_OVERFLOW"
  | "S_SHEET_GROUPED"
  | "S_SHEET_EMPTY"
  | "S_SHEET_FILE"
  | "S_SHEET_IGNORED"
  | "S_SHEET_NOT_OURS"
  | "S_SHEET_HEARING"
  | "S_SHEET_NEWER"
  | "S_SHEET_MANAGE_MISMATCH"
  | "S_SHEET_PARTLY_LOST"
  | "S_SHEET_OTHER_HOUSEHOLD"
  | "S_SHEET_OLD_REQUEST"
  | "S_SHEET_ALREADY"
  | "S_SHEET_RECEIVED_BEFORE"
  | "S_SHEET_UNCHANGED"
  | "S_SHEET_ROW_UNKNOWN"
  | "S_SHEET_ROW_DUPLICATE"
  | "S_SHEET_ROW_CHANGED"
  | "S_SHEET_ROW_GONE"
  | "S_SHEET_VALUE"
  | "S_SHEET_FORMULA"
  | "S_SHEET_NO_MARKS";

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

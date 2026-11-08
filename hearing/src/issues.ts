// 読み込み・取り込みで見つけたことの知らせ。FP に見せる文は日本語で、機械で見分けるための記号（code）を添える

export type IssueLevel = "error" | "warning" | "info";

export type IssueCode =
  // ファイルの形（0018 の6）
  | "H_FILE_NOT_XLSX"
  | "H_FILE_XLS"
  | "H_FILE_ENCRYPTED"
  | "H_FILE_ODS"
  | "H_FILE_NUMBERS"
  | "H_FILE_TOO_LARGE"
  | "H_FILE_BROKEN"
  | "H_FILE_MACRO_IGNORED"
  | "H_FILE_EXTERNAL_IGNORED"
  | "H_FILE_EMBEDDED_IGNORED"
  // 管理の値（0018 の2・5）
  | "H_NOT_HEARING_SHEET"
  | "H_MANAGE_MISMATCH"
  | "H_MANAGE_PARTLY_LOST"
  | "H_FORMAT_NEWER"
  | "H_SHEET_UNKNOWN"
  | "H_REQUEST_UNKNOWN"
  | "H_LAYOUT_MISMATCH"
  // セルの読み方（0018 の4・6）
  | "H_NAME_MOVED"
  | "H_NAME_MISSING"
  | "H_LABEL_MISMATCH"
  | "H_FORMULA"
  | "H_FORMULA_NO_VALUE"
  // 回答の中身
  | "H_INVALID_VALUE"
  | "H_STATE_NOT_ALLOWED"
  | "H_VALUE_AND_STATE"
  | "H_RATE_DOUBT"
  | "H_UNKNOWN_KEY"
  | "H_MISSING"
  | "H_CONTRADICTION"
  | "H_IGNORED"
  | "H_ESTIMATED"
  | "H_ASSUMED"
  // 書き出し
  | "H_EXPORT_OVERFLOW"
  | "H_EXPORT_PREFILL";

export interface Issue {
  readonly level: IssueLevel;
  readonly code: IssueCode;
  readonly message: string;
  /** 関係する項目キーと何番目か */
  readonly key?: string;
  readonly index?: number;
}

export function issue(level: IssueLevel, code: IssueCode, message: string, at?: { key: string; index?: number }): Issue {
  return { level, code, message, ...(at !== undefined ? { key: at.key, ...(at.index !== undefined ? { index: at.index } : {}) } : {}) };
}

// 明細の取り込みと仕分けの部品の入口（0034）。アプリの画面からは、ここの関数だけを呼ぶ。
//   読む: readStatement … CSV・文字の入った PDF を「欄の表」にし、列の対応付けで明細の行にする（番号らしき数字は読んだ時点で消す）
//   記録: createImport・readLog … 世帯ファイルの本文の区画 statements に持つ形（元のファイルは持たない）
//   仕分け: classify … 辞書（同梱・事務所で覚えた）・世帯の決まり・働き方で、項目・区分・迷う印を付ける
//   数: summarize … 基本生活費の内訳ごとの月平均（使った日で数える）・一時的支出・参考の値・注意
//   候補: buildCandidates・applyCandidates … 0008 の候補の形にし、FP が承認したものを世帯に入れる
//   迷う行: reviewList・applyDecisions・learnFromDecisions・addRule
// ファイルを開くダイアログ・大きさの確かめ・事務所データ（覚えた辞書・覚えた形）の保存はアプリ本体が受け持つ
export { applyCandidates, buildCandidates, type Box, type CandidateHousehold, type CandidateOptions, type LivingExpenseLike, type PeriodicExpenseLike, type StatementCandidate } from "./candidates.ts";
export { BUILTIN, BUILTIN_VERSION, CARD_ISSUERS, GENERIC_CARD_PAYMENT, type BuiltinEntry, type BuiltinFlag } from "./classify/builtin.ts";
export { CATEGORIES, CATEGORY_IDS, categoryInfo, isCategory, LIVING_LABELS, LIVING_ORDER, periodicRowOf, type CategoryInfo, type LivingCategory, type StatementCategory } from "./classify/categories.ts";
export { ANNUAL_MIN, classify, YEAR_DAYS, FLAG_LABELS, HIGH_AMOUNT, includedImports, REFUND_WINDOW_DAYS, REVIEW_FLAGS, type AnnualInfo, type ClassifiedRow, type ClassifyContext, type Flag } from "./classify/classify.ts";
export { forgetEntry, learnEntry, lookup, lookupBuiltin, lookupSourceCategory, MAX_DICTIONARY, mergeEntries, officeIndex, readEntry, type DictionaryEntry, type Match } from "./classify/dictionary.ts";
export { BUCKET_LABELS, BUCKETS_BY_STYLE, bucketsOf, memberStyles, parseShare, splitByShare, WORK_STYLE_LABELS, workStyleAt, type Bucket, type HouseholdLike, type WorkStyle } from "./classify/work.ts";
export { issue, type Issue, type IssueCode, type IssueLevel } from "./issues.ts";
export { createImport, emptyLog, MAX_ROWS_PER_HOUSEHOLD, readLog, STATEMENT_LOG_VERSION, type HouseholdRule, type StatementAccount, type StatementApplication, type StatementImport, type StatementLog, type StatementRow } from "./log.ts";
export { displayMerchant, MAX_KEY, merchantKey } from "./merchant.ts";
export { csvReader, DEFAULT_READERS, fileDigest, MAX_FILE_BYTES, pdfTextReader, readStatement, type ReadContext, type ReaderTable, type ReadOutcome, type StatementReader } from "./readers.ts";
export { addRule, applyDecisions, DecisionError, learnFromDecisions, removeRule, reviewList, unknownMerchants, type ReviewItem, type RowDecision } from "./review.ts";
export { coveredDays, FULL_YEAR_DAYS, MIN_DAYS_FOR_CANDIDATE, monthlyAverage, monthsText, paymentSchedule, summarize, type AccountCoverage, type LivingLine, type OneOffItem, type StatementSummary } from "./summary.ts";
export { checkMapping, COLUMN_ROLES, guessMapping, headerFingerprint, ROLE_LABELS, tableToRows, type ColumnMapping, type ColumnRole, type LearnedFormat, type ReadRow, type SourceKind, type Table } from "./table.ts";
export { decodeText, type Decoded, type Encoding } from "./text/decode.ts";
export { MASK, maskCell, maskText } from "./text/mask.ts";
export { parseAmount, parseDate, parsePlan, parseUser, parseYearMonth, type PaymentPlan } from "./text/values.ts";

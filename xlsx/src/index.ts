// 表計算のファイル（.xlsx）の書き出しと読み込みの土台の入口。ヒアリングシート（hearing/。0018）と、明細の確認シート（statement/。0034）が使う。
// npm の依存なしの TypeScript で、画面（WebView）とテストで同じ部品が動く。どのセルに何を書くか・どのセルを読むかは使う側が決める
export { colIndex, colLetter, num, parseRef, quoteSheet, shownNumber, text, type CellValue } from "./cells.ts";
export { Book, isPercentFormat, problemOf, rowsOf, sniff, type BookSheetInfo, type CellRead, type FileNote, type FileNoteCode, type FileProblem, type FileProblemCode, type OpenResult, type RawCell, type Sheet } from "./read.ts";
export { buildStyles, LIST_SHEET, listValidation, Lists, lines, META_SHEET, metaSheetXml, numberValidation, PROPERTY_PREFIX, SheetBuilder, STYLE, STYLE_COUNT, validation, writeBook, XML_HEAD, type BookOptions, type BookSheet, type SheetXmlOptions } from "./write.ts";
export { child, childrenNamed, decodeEntities, decodeXstring, escapeXml, escapeXstring, parseXml, textOf, XmlError, type XmlElement, type XmlNode } from "./xml.ts";
export { crc32, DEFAULT_LIMITS, writeZip, ZipError, ZipReader, type ZipEntry, type ZipLimits } from "./zip.ts";

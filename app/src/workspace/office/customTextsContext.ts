// 事務所の文・名前・欄の見せ方を画面の部品に渡す入れ物（preact の context。0016 の 2026-11-01・2026-11-02 の追記）。App が本体から読んだ物を置く。
// 当て方の関数は customTexts.ts（画面の部品を読まない。計算のお知らせの文を AI接続口にも同梱するため、入れ物だけをここに分けた。0210）
import { createContext } from "preact";
import { NO_OFFICE_FIELDS, NO_OFFICE_NAMES, NO_OFFICE_TEXTS, type OfficeFields, type OfficeNames, type OfficeTexts } from "./customTexts.ts";

/** 入力の画面などに事務所の文を渡す（App が本体から読んだ物を置く） */
export const OfficeTextsContext = createContext<OfficeTexts>(NO_OFFICE_TEXTS);
/** 事務所の名前（入力の欄の名前・表の行の名前） */
export const OfficeNamesContext = createContext<OfficeNames>(NO_OFFICE_NAMES);
/** 事務所の欄の見せ方（隠す・並べ替え） */
export const OfficeFieldsContext = createContext<OfficeFields>(NO_OFFICE_FIELDS);

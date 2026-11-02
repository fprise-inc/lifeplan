// カスタム層の説明の文の差し替え（0016 の 2026-11-01・2026-11-02 の追記）: FP が承認した事務所の文を、画面の公式の文に当てる。
// - どの文に当てるかは、説明の一覧の id（欄の説明は `field:<入力項目ID>[/<道>]`、計算の知らせは `notice:<文の表の鍵>`）
// - 当てるのは本体が承認した中身から作った物（OfficeTextEntry）だけ。画面はカスタム層のファイルを読まない
// - 今の公式の文が、承認したときに一覧にあった公式の文と同じときだけ当てる（同じ id で世帯によって文が違う所・知らない文には当てない）
// - 文はただの文字。HTML として差し込まない（画面の部品は文字として描く）
import { createContext } from "preact";

export type TextOp = "replace" | "append" | "hide";

/** 本体が返す、画面に当てる事務所の文（承認した中身から作った物だけ） */
export interface OfficeTextEntry {
  id: string;
  do: TextOp;
  text: string | null;
  /** 当てる先の公式の文 */
  official: string;
  /** アプリの更新で公式の説明が変わった（確かめるまで札を変える） */
  officialChanged: boolean;
}

export type OfficeTexts = ReadonlyMap<string, OfficeTextEntry>;

export const NO_OFFICE_TEXTS: OfficeTexts = new Map();

/** 入力の画面などに事務所の文を渡す（App が本体から読んだ物を置く） */
export const OfficeTextsContext = createContext<OfficeTexts>(NO_OFFICE_TEXTS);

export const officeTextsFrom = (list: readonly OfficeTextEntry[]): OfficeTexts => new Map(list.map((e) => [e.id, e]));

/** 計算の知らせの id（`notice:<文の表の鍵>`） */
export const noticeTextId = (key: string): string => `notice:${key}`;

/** 文の中の `{{`・`}}` を字の `{`・`}` にする（差し込みの印は、今の一覧の文には無い） */
export const unescapeBraces = (s: string): string => s.replace(/\{\{/g, "{").replace(/\}\}/g, "}");

export interface Applied {
  /** 出す文（消したときは null） */
  text: string | null;
  /** 事務所の文を当てた（当てていなければ null） */
  office: OfficeTextEntry | null;
}

/** 公式の文に事務所の文を当てる（当てる物が無い・公式の文が違うときは公式の文のまま） */
export function applyOfficeText(t: OfficeTexts, id: string | null, official: string): Applied {
  const e = id === null ? undefined : t.get(id);
  if (e === undefined || unescapeBraces(e.official) !== official) return { text: official, office: null };
  if (e.do === "hide") return { text: null, office: e };
  const mine = unescapeBraces(e.text ?? "");
  return { text: e.do === "append" ? `${official}\n${mine}` : mine, office: e };
}

/** 事務所の文の札（FP 向けの画面だけに出す。提示層・持ち帰り用のレポートには出さない） */
export const officeLabel = (e: OfficeTextEntry): string => (e.officialChanged ? "事務所の文（公式の説明が変わりました）" : "事務所の文");

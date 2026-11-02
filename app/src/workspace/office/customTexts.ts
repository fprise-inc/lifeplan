// カスタム層の説明の文の差し替え（0016 の 2026-11-01・2026-11-02 の追記）: FP が承認した事務所の文を、画面の公式の文に当てる。
// - どの文に当てるかは、説明の一覧の id（欄の説明は `field:<入力項目ID>[/<道>]`、計算の知らせは `notice:<文の表の鍵>`）
// - 当てるのは本体が承認した中身から作った物（OfficeTextEntry）だけ。画面はカスタム層のファイルを読まない
// - 今の公式の文が、承認したときに一覧にあった公式の文と同じときだけ当てる（同じ id で世帯によって文が違う所・知らない文には当てない）
// - 文はただの文字。HTML として差し込まない（画面の部品は文字として描く）
import { createContext } from "preact";
import type { OfficeRowNames } from "../../../../report/src/rowNames.ts";

export type TextOp = "replace" | "append" | "hide" | "order";

/** 本体が返す、画面に当てる事務所の文（承認した中身から作った物だけ） */
export interface OfficeTextEntry {
  id: string;
  do: TextOp;
  text: string | null;
  /** 当てる先の公式の文 */
  official: string;
  /** アプリの更新で公式の説明が変わった（確かめるまで札を変える） */
  officialChanged: boolean;
  /** 何番目に出すか（欄の見せ方の設定だけ） */
  order?: number;
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

// ---- 名前の差し替え（settings/terms.json）と、入力の欄の隠す・並べ替え（settings/fields.json）。0016 の 2026-11-02 の追記 ----
// どちらも当てるのは本体が承認した中身から作った物（OfficeTextEntry。名前は text、並べ替えは order）だけ。画面はカスタム層のファイルを読まない

/** 事務所の名前（名前の一覧の id → 承認した名前）。入力の欄の名前（field:…）と表の行の名前（row:…） */
export type OfficeNames = ReadonlyMap<string, OfficeTextEntry>;
export const NO_OFFICE_NAMES: OfficeNames = new Map();
export const OfficeNamesContext = createContext<OfficeNames>(NO_OFFICE_NAMES);

/** 名前を当てた結果（当てていなければ office は null。official は今の公式の名前） */
export interface NamedLabel {
  name: string;
  official: string;
  office: OfficeTextEntry | null;
}

/** 公式の名前に事務所の名前を当てる（承認したときの公式の名前が今の公式の名前と同じときだけ） */
export function applyOfficeName(names: OfficeNames, id: string | null, official: string): NamedLabel {
  const e = id === null ? undefined : names.get(id);
  if (e === undefined || e.do !== "replace" || e.text === null || unescapeBraces(e.official) !== official) return { name: official, official, office: null };
  return { name: unescapeBraces(e.text), official, office: e };
}

/** 表の行の事務所の名前（row:…）だけを、提示用の値・提案書・持ち帰り用のレポートに渡す形にする（事務所の名前である印は持たない） */
export function rowNamesOf(names: OfficeNames): OfficeRowNames | undefined {
  const out: Record<string, { name: string; official: string }> = {};
  for (const [id, e] of names) if (id.startsWith("row:") && e.do === "replace" && e.text !== null) out[id] = { name: e.text, official: e.official };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 事務所の欄の見せ方（欄の一覧の id → 隠す・何番目に出すか） */
export type OfficeFields = ReadonlyMap<string, { hide: boolean; order: number | null }>;
export const NO_OFFICE_FIELDS: OfficeFields = new Map();
export const OfficeFieldsContext = createContext<OfficeFields>(NO_OFFICE_FIELDS);

export const officeFieldsFrom = (list: readonly OfficeTextEntry[]): OfficeFields => new Map(list.map((e) => [e.id, { hide: e.do === "hide", order: e.order ?? null }]));

/**
 * まとまりの欄の並びに、事務所の見せ方を当てる（見せ方だけ。世帯の値と計算は変えない）。
 * - 隠す欄でも、値が入っていれば出す（hasValue。見えない値で計算しないため。0083 の4と同じ考え方）
 * - order は、まとまりの中で何番目に出すか（1 から）。書いていない欄は今の並びの番号のまま、同じ番号なら書いた欄が先
 */
export function arrangeFields<F>(fields: readonly F[], idOf: (f: F) => string | null, hasValue: (f: F) => boolean, layout: OfficeFields): F[] {
  if (layout.size === 0) return [...fields];
  const rows = fields.map((f, i) => {
    const id = idOf(f);
    return { f, i, rule: id === null ? undefined : layout.get(id) };
  });
  return rows
    .filter((r) => r.rule?.hide !== true || hasValue(r.f))
    .map((r) => ({ ...r, pos: r.rule?.order ?? r.i + 1, written: r.rule?.order != null ? 0 : 1 }))
    .sort((a, b) => a.pos - b.pos || a.written - b.written || a.i - b.i)
    .map((r) => r.f);
}

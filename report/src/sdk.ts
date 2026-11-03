// @lifeplan/sdk のうち、拡張の束（0114）が使う型と小さな関数の正本。
// - 束の計算部品は、相対パスとこのモジュール（@lifeplan/sdk）だけを読める（0016 の5・0114 の1）。リポジトリの中では、アプリと帳票の部品の
//   設定（tsconfig の paths・vite と vitest の alias）が @lifeplan/sdk をこのファイルにつなぐ。リリースのビルドが SDK フォルダの types/ に写す（0019 の2）
// - 見せ方の差し込み口（view.balance・report.chapter。約束の版 1。0114 の5）の入出力の型と、マニフェスト・宣言型の入力欄（extFields@1.0）の型
// - ここの形は試験版（0001）。欄を足すのは足すだけ、変えるときは予告して約束の版を上げる
// 時計・乱数・端末の言語設定に依らない（同じ入力から同じ値。0005）
import type { BsAt, BsGroup, Yen } from "./bsGroups.ts";

export type { BsAt, BsGroup, BsLine, Yen } from "./bsGroups.ts";

/** 見せ方の差し込み口の約束の版（0114 の5） */
export const EXTENSION_CONTRACT = "1";

// ---- 渡す値（どちらの差し込み口も同じ形） ----

/** 現状のプランの今の年の家計のバランスシート（reads の "balance.now"） */
export interface HouseholdNow {
  at: BsAt;
  /** 生活費＋ローン返済の月額（家賃収入で返す不動産のローンは除く。0105 の3） */
  monthly: Yen;
  /** 会社の借入の連帯保証の額（今の額。負債には入っていない。0105） */
  guarantee: Yen;
}

/** 入力欄の値（宣言の path のとおりの対。空欄は欄を持たない） */
export type ExtValue = Record<string, unknown>;

/** 差し込み口の関数が受け取る値 */
export interface ExtInput {
  /** 束の入力欄の値（入力欄の key ごと。何も入れていなければ null） */
  values: Record<string, ExtValue | null>;
  /** reads に "balance.now" を書いたときだけ */
  balance?: { now: HouseholdNow };
}

// ---- view.balance（資産と負債のタブの見るもの） ----

/** 並べる1枚（BsAt に、純資産の箱の中の内訳。どれも0以上で合計は純資産） */
export interface ExtBsAt extends BsAt {
  netParts?: { key: string; label: string; amount: Yen }[];
}

export interface ExtColumn {
  name: string;
  sub?: string;
  at: ExtBsAt;
}

export interface ExtSection {
  key: string;
  title: string;
  note?: string;
  table?: { head: string[]; rows: { cells: string[]; tone?: "total" | "muted" }[] };
  lines?: string[];
  /** 表の横に出す入力欄（宣言の欄の id） */
  field?: string;
}

/** view.balance の関数が返す値（画面が鍵と入力欄の今の値を足して描く） */
export interface BalanceView {
  lead?: string;
  note: string;
  /** 並べる図（共通の縮尺） */
  columns: ExtColumn[];
  /** 段を切り替えて見せる（任意） */
  steps?: { key: string; label: string; columns: ExtColumn[]; note: string }[];
  /** 共通の縮尺（任意） */
  scale?: Yen;
  /** 分け方の名前の置き換え（任意） */
  groups?: Partial<Record<BsGroup, { name: string; short: string }>>;
  notices?: string[];
  sections?: ExtSection[];
  /** 入力欄の見せ方（open は最初から開いておくか。hints は欄ごとの差し込みの文） */
  form?: { open: boolean; hints?: Record<string, { placeholder?: string; help?: string }> };
  /** 入力が足りず図を出せないときの文 */
  empty?: string;
}

// ---- report.chapter（提案書の拡張の章） ----

/** report.chapter の関数が返す値（束の Typst が読む JSON の対。材料が無ければ null） */
export type ChapterData = Record<string, unknown>;

// ---- マニフェストと宣言型の入力欄（0114 の2・4） ----

export type ExtensionPoint = "view.balance" | "report.chapter";

export interface ExtProvide {
  type: "extend";
  extensionPoint: ExtensionPoint;
  contract: string;
  /** 入口が出す関数の名前 */
  export: string;
  /** view.balance: 見るものの切り替えに出す名前 */
  label?: string;
  /** report.chapter: 章 */
  chapter?: { id: string; label: string; typst: string };
}

export interface ExtManifest {
  manifestVersion: string;
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  kind: "component";
  entry: string;
  provides: ExtProvide[];
  reads?: string[];
  fields?: string[];
  activation?: { feature?: string; households?: "all" | "executive" };
  description?: string;
}

export type ExtFieldType = "yen" | "month" | "choice" | "check";

export interface ExtFieldDecl {
  id: string;
  path: string[];
  type: ExtFieldType;
  label: string;
  unit?: string;
  help?: string;
  placeholder?: string;
  /** yen だけ: マイナスも入る */
  negative?: boolean;
  /** choice だけ */
  options?: { value: string; label: string }[];
}

export interface ExtFieldsDecl {
  schema: string;
  key: string;
  version: number;
  attachTo: "household";
  label: string;
  description?: string;
  form: { title: string; note: string; groups: { title: string; note?: string; fields: string[] }[] };
  fields: ExtFieldDecl[];
}

// ---- 小さな関数 ----

/** 3桁ごとのカンマ（端末の言語設定に依らない） */
export function group(n: number): string {
  const s = String(Math.abs(Math.trunc(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 万円の数（四捨五入。符号は対称） */
export function toMan(yen: Yen): number {
  const v = Math.round(Math.abs(yen) / 10000);
  return yen < 0 ? -v : v;
}

/** 万円の文字列（単位なし）: 50,920,000 → "5,092"、−20,270,000 → "▲2,027"（アプリの画面と同じ書き方） */
export function man(yen: Yen): string {
  const v = toMan(yen);
  return (v < 0 ? "▲" : "") + group(v);
}

/** 分け方ごとの合計 */
export function groupTotal(at: BsAt, g: BsGroup): Yen {
  return at.lines.reduce((s, l) => (l.group === g ? s + l.amount : s), 0);
}

/** 分け方の並び（資産の4つ・負債の2つ） */
export const GROUP_ORDER: readonly BsGroup[] = ["liquid", "market", "locked", "illiquid", "mortgage", "debt"];

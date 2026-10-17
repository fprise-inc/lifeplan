// 記入済みのシートの中身（回答の一覧）と管理の値。Excel から読んだ結果と、世帯データから書き出す前の形の両方に使う。
// 形式は schema/filled-sheet.schema.json。Excel の配置に頼らない形なので、紙で返ってきたものを FP が入力するときや、
// 将来の Web フォーム（0018 の未確定）でも同じ受け皿を使える

/** 埋め込みの形式名と形式の版（0018 の2。β公開までは 0.x。0011 の追記） */
export const HEARING_FORMAT = "fprise-lifeplan-hearing";
export const HEARING_FORMAT_VERSION = "0.1";

/** 管理の値（0018 の2）。世帯の内部ID は持たない（0012） */
export interface Management {
  readonly format: typeof HEARING_FORMAT;
  readonly formatVersion: string;
  readonly sheetId: string;
  readonly sheetVersion: number;
  /** 依頼番号（依頼ごとの乱数。R-XXXXXX） */
  readonly requestId: string;
  /** 表示用の顧客番号（任意） */
  readonly customerNo: string;
  /** 配置の指紋（SHA-256 の16進） */
  readonly layoutDigest: string;
  readonly appVersion: string;
  /** 書き出した日（YYYY-MM-DD） */
  readonly exportedOn: string;
}

/** セルから読んだ生の値（数は文字のまま持つ: 10進の桁を失わないため） */
export type RawValue = { readonly kind: "number"; readonly text: string } | { readonly kind: "text"; readonly text: string } | { readonly kind: "bool"; readonly value: boolean };

/** 回答の状態（値／未回答／わからない／該当なし。0018 の4） */
export type AnswerStatus = "value" | "blank" | "unknown" | "notApplicable";

export interface Answer {
  readonly key: string;
  /** 繰り返しの何番目か（1 から。繰り返さない項目は省略） */
  readonly index?: number;
  readonly status: AnswerStatus;
  /** 値（status が value のとき） */
  readonly raw?: RawValue;
  /** 年月の月（年月の型のとき。記入欄2） */
  readonly raw2?: RawValue;
  /** 読むときに要確認になった理由（名前の定義と位置の食い違い・数式など）。要確認の回答は黙って使わない */
  readonly review?: readonly string[];
}

export interface FilledSheet {
  readonly management: Management;
  readonly answers: readonly Answer[];
}

/** 回答を探す鍵 */
export function answerKey(key: string, index?: number): string {
  return index === undefined ? key : `${key}#${index}`;
}

/** 依頼番号を作る（読み違えやすい字 0・O・1・I を除いた6文字）。乱数はアプリ本体が渡す（0004 の追記: 乱数は本体で作る） */
export function requestIdFrom(random: Uint8Array): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  if (random.length < 6) throw new Error("依頼番号には6バイト以上の乱数が要る");
  let s = "R-";
  for (let i = 0; i < 6; i++) s += chars[(random[i] as number) % chars.length];
  return s;
}

export const REQUEST_ID_PATTERN = /^R-[2-9A-HJ-NP-Z]{6}$/;

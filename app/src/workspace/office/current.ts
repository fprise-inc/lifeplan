// 画面の側の操作が読む、今の事務所の既定値（0073）。アプリが開いている間だけ持つ（事務所の既定値を読み込んだとき・保存したときに入れる）。
// 世帯の物を足す操作（受け取る予定の相続・贈与の行を足すなど）と、確かめの一覧の「事務所の新しい値があります」がここを読む。
// FP顧問料の契約を足す操作（stages/fees.ts）も、ここの料金表を読む。ほかの所に頼らないよう、何も読み込まない

/**
 * FP顧問料の料金表（事務所の既定値。新しい契約を足すときに写す）。額は税込の円。
 * 継続の顧問料の改定は「○年目から○円」の段階で持つ（率では持たない。顧客の画面には額だけを出す）
 */
export interface FeeTable {
  /** 単発の料金（相談料・プラン作成料） */
  oneTime: number;
  /** 継続の顧問料の払い方（月額＝毎月・年額＝毎年、始まりの月に） */
  per: "month" | "year";
  /** 継続の顧問料（1回の額。月額か年額） */
  amount: number;
  /** 料金の段階: 継続の顧問料の○年目（2以上。1年目＝始まりの月から12か月）から、この額（1回の額） */
  steps: readonly { year: number; amount: number }[];
  /** 払う人などの万一のときの扱い（止める・続ける） */
  onContingency: "stop" | "continue";
}

/** 料金表の標準（単発30万円・継続は月1万円・段階なし・万一のときは止める） */
export const STANDARD_FEE_TABLE: FeeTable = { oneTime: 300000, per: "month", amount: 10000, steps: [], onContingency: "stop" };

export interface OfficeNow {
  /** 受け取る予定の相続・贈与と、相続で受け継ぐ借金の見込みの既定 */
  inheritLikelihood: "likely" | "uncertain";
  /** 前提条件の標準値（系列の名前 → 小数の文字）。無い系列は FPライズの標準 */
  assumptions: Readonly<Record<string, string>>;
  /** 推定の根拠の文（例: 「事務所の標準（2026-10）」） */
  basis: string;
  /** FP顧問料の料金表 */
  fee: FeeTable;
}

export const STANDARD_OFFICE_NOW: OfficeNow = { inheritLikelihood: "likely", assumptions: {}, basis: "事務所の標準", fee: STANDARD_FEE_TABLE };

let now: OfficeNow = STANDARD_OFFICE_NOW;

export const officeNow = (): OfficeNow => now;

export function setOfficeNow(n: OfficeNow): void {
  now = n;
}

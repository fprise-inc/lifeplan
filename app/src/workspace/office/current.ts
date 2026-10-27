// 画面の側の操作が読む、今の事務所の既定値（0073）。アプリが開いている間だけ持つ（事務所の既定値を読み込んだとき・保存したときに入れる）。
// 世帯の物を足す操作（受け取る予定の相続・贈与の行を足すなど）と、確かめの一覧の「事務所の新しい値があります」がここを読む。
// ほかの所に頼らないよう、何も読み込まない
export interface OfficeNow {
  /** 受け取る予定の相続・贈与と、相続で受け継ぐ借金の見込みの既定 */
  inheritLikelihood: "likely" | "uncertain";
  /** 前提条件の標準値（系列の名前 → 小数の文字）。無い系列は FPライズの標準 */
  assumptions: Readonly<Record<string, string>>;
  /** 推定の根拠の文（例: 「事務所の標準（2026-10）」） */
  basis: string;
}

export const STANDARD_OFFICE_NOW: OfficeNow = { inheritLikelihood: "likely", assumptions: {}, basis: "事務所の標準" };

let now: OfficeNow = STANDARD_OFFICE_NOW;

export const officeNow = (): OfficeNow => now;

export function setOfficeNow(n: OfficeNow): void {
  now = n;
}

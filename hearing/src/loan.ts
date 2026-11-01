// 住宅ローンの返済の逆算（元利均等・最初の金利の段だけ）。簡易版のシートの「残高」「毎月の返済額」から、仮の金利で返済期間か残高を解く。
// 入力の画面の住まい・ローンのカードの逆算（app/src/workspace/input/loanMath.ts）と同じ式（月の利率は年利÷12）
import { addMonths, ymIndex } from "./months.ts";
import type { Member } from "./types.ts";

/** 今の残高・毎月の返済額・年利から、返しきるまでの月数（切り上げ）。利息に届かない返済額なら null */
export function monthsFromPayment(balance: number, payment: number, annualRate: number): number | null {
  if (payment <= 0 || balance <= 0) return null;
  const r = annualRate / 12;
  if (r === 0) return Math.max(1, Math.ceil(balance / payment - 1e-9));
  if (payment <= balance * r) return null;
  return Math.max(1, Math.ceil(-Math.log(1 - (balance * r) / payment) / Math.log(1 + r) - 1e-9));
}

/** 毎月の返済額・年利・月数から、今の残高（円。四捨五入）。解けなければ null */
export function principalFromPayment(payment: number, annualRate: number, months: number): number | null {
  if (months <= 0 || payment <= 0) return null;
  const r = annualRate / 12;
  return Math.round(r === 0 ? payment * months : (payment * (1 - Math.pow(1 + r, -months))) / r);
}

/**
 * 今の残高・年利・月数から、毎月の返済額（円。切り上げ: その額で返すと、monthsFromPayment が同じ月数に戻る）。解けなければ null。
 * 詳細版のシートに会社からの借入金の前回の値を記入するときに使う
 */
export function paymentFromBalance(balance: number, annualRate: number, months: number): number | null {
  if (months <= 0 || balance <= 0 || !Number.isFinite(annualRate)) return null;
  const r = annualRate / 12;
  return Math.ceil((r === 0 ? balance / months : (balance * r) / (1 - Math.pow(1 + r, -months))) - 1e-9);
}

/** 返済期間の標準の値: 35年。完済が80歳を超えるなら80歳まで（年の単位。入力の画面の新しい住宅ローンと同じ） */
export function standardTermMonths(m: Pick<Member, "birth">, start: string): number {
  const at80 = addMonths(m.birth.birthYearMonth, 80 * 12);
  const limit = ymIndex(at80) - ymIndex(start);
  return Math.max(12, Math.min(420, Math.floor(limit / 12) * 12));
}

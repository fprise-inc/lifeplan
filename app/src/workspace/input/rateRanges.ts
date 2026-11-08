// 率の欄の範囲（0098）。min・max はパーセントの値（割合の欄の min・max と同じ形。form.ts の FieldDef）。
// 範囲の外の値は欄に書かず（前の値のまま）、欄の下に「15%より大きい値は設定できません。」のように出す（FieldViews.tsx の rejectReason）。古い世帯・取り込んだ世帯に範囲の外の値が
// 入っていたら、値は変えずに計算し、欄と確かめの一覧に知らせを出して「範囲の端にする」で直せるようにする（form.ts の field）
import { cmpRate } from "../plans/decimal.ts";
import { rateFromPct } from "./units.ts";

export interface PctRange {
  readonly min: number;
  readonly max: number;
}

/**
 * 運用の利回り（前提・資産の種類ごと・口座・段・例外の年・相場の下落の後の上限）と、資産の評価額の増減率: 年 -10%〜+15%（長い期間の平均として）。
 * 上の端を 20% にしないのは、上昇率の上の端（10%）と重ねて表の標準の長さ（若い方が100歳まで）を計算すると、金額が安全に扱える整数を超えて
 * 計算が止まる世帯があるため（0098）
 */
export const RETURN_RANGE: PctRange = { min: -10, max: 15 };
/** 上昇率・変化率・伸び率・増減率（物価・賃金・教育費・土地・家賃・費用・収入・維持費など）: 年 -10%〜+10%（長い期間の平均として） */
export const GROWTH_RANGE: PctRange = { min: -10, max: 10 };
/** 年金の調整率（マクロ経済スライド）: 年 0%〜5%（年金額の伸びから差し引く正の率） */
export const SLIDE_RANGE: PctRange = { min: 0, max: 5 };
/** 運用の費用（信託報酬など）: 年 0%〜5% */
export const FEE_RANGE: PctRange = { min: 0, max: 5 };

/** 健康保険料率（本人負担分。健康保険組合・共済の料率を入れる欄）: 0%〜10%（料率の上の端は労使合わせて13%で、本人はその半分ほど。介護保険料を含めても10%に届かない。0177） */
export const HEALTH_RATE_RANGE: PctRange = { min: 0, max: 10 };
/** 段の「今の額に対する割合」（基本生活費・家賃・修繕や管理の費用・固定資産税の段）: 0%〜500%（マイナスは計算で0%になっていた。0177） */
export const STAGE_RATIO_RANGE: PctRange = { min: 0, max: 500 };

/** 率（10進の文字列。"0.25" = 25%）がパーセントの範囲に入っているか。読めない率は入っていない扱い */
export function rateInRange(rate: string, r: { min?: number | undefined; max?: number | undefined }): boolean {
  if (!/^-?\d+(\.\d+)?$/.test(rate)) return false;
  const lo = r.min === undefined ? null : rateFromPct(String(r.min));
  const hi = r.max === undefined ? null : rateFromPct(String(r.max));
  return (lo === null || cmpRate(rate, lo) >= 0) && (hi === null || cmpRate(rate, hi) <= 0);
}

/** 率を範囲の端に収める（範囲の中ならそのまま） */
export function clampRate(rate: string, r: { min?: number | undefined; max?: number | undefined }): string {
  const lo = r.min === undefined ? null : rateFromPct(String(r.min));
  const hi = r.max === undefined ? null : rateFromPct(String(r.max));
  if (lo !== null && cmpRate(rate, lo) < 0) return lo;
  if (hi !== null && cmpRate(rate, hi) > 0) return hi;
  return rate;
}

/** 範囲の言い方（「-10%〜20%」。片方だけなら「0%以上」「20%以下」） */
export function rangeText(r: { min?: number | undefined; max?: number | undefined }): string {
  if (r.min !== undefined && r.max !== undefined) return `${r.min}%〜${r.max}%`;
  if (r.min !== undefined) return `${r.min}%以上`;
  return `${r.max ?? ""}%以下`;
}

/**
 * 入れようとした率が範囲の外のときの知らせ（「15%より大きい値は設定できません。」「-10%より小さい値は設定できません。」）。
 * 範囲の中・読めない率は null（読めない文字の知らせは欄の側で出す。0098）
 */
export function outOfRangeText(rate: string, r: { min?: number | undefined; max?: number | undefined }): string | null {
  if (!/^-?\d+(\.\d+)?$/.test(rate)) return null;
  const lo = r.min === undefined ? null : rateFromPct(String(r.min));
  const hi = r.max === undefined ? null : rateFromPct(String(r.max));
  if (hi !== null && cmpRate(rate, hi) > 0) return `${r.max}%より大きい値は設定できません。`;
  if (lo !== null && cmpRate(rate, lo) < 0) return `${r.min}%より小さい値は設定できません。`;
  return null;
}

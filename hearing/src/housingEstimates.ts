// 住まい・ローンの推定の目安（0008 の2 の「推定」）。入力の画面（app/src/workspace/input/stages/housingLoans.ts・housing.ts）とヒアリングシートの取り込み
// （import.ts の簡易版の住宅ローン）は、どちらもこのファイルの値と根拠の文を使う（目安の数を1か所に置く）。
// 数は正本の YAML（data/master の master.housing.statistics。0007）の写し statistics.generated.ts から読む。
// 金利・家賃の統計は時とともに変わるので、リリースのたびに見直す（docs/estimates-review.md）
import { masterValue } from "./statistics.ts";

/** 住宅ローンの金利の種類（計算エンジンの rateSchedule の type） */
export type MortgageRateType = "variable" | "fixedPeriod" | "fixed";

export interface RateEstimate {
  /** 年率の文字（例 "0.0085"） */
  readonly rate: string;
  readonly basis: string;
}

const FIXED_ID = "housing.statistics.mortgageRate.fixed";
const VARIABLE_ID = "housing.statistics.mortgageRate.variable";
const FIXED_PERIOD_ID = "housing.statistics.mortgageRate.fixedPeriod10";
const RENT_GROWTH_ID = "housing.statistics.rentGrowth";

/** 写しに値が無いとき（正本の YAML を読めないとき）の予備の値。仮の値で、根拠の文にそう書く */
const FALLBACK: Readonly<Record<MortgageRateType, string>> = { variable: "0.008", fixedPeriod: "0.02", fixed: "0.02" };
const LABEL: Readonly<Record<MortgageRateType, string>> = { variable: "変動金利", fixedPeriod: "固定期間選択型（当初10年）", fixed: "全期間固定" };

/** 年率の文字を「0.85%」の形に（小数点以下3桁まで。末尾の0は付けない） */
export const pctText = (rate: string | number): string => `${(Math.round(Number(rate) * 100000) / 1000).toLocaleString("ja-JP", { maximumFractionDigits: 3 })}%`;

function masterRate(id: string): { rate: string; pending: boolean; source: string } | null {
  const v = masterValue(id);
  if (v === null || typeof v.value !== "string") return null;
  // 値の題名の最初の「（」の前が、出典の短い名前（例: 住宅金融支援機構【フラット３５】2026年10月の最も多い借入金利）
  return { rate: v.value, pending: !v.reviewed, source: v.title.split("（")[0] ?? v.title };
}

/**
 * 住宅ローンの当初の金利の目安（金利の種類ごと）。
 * - 全期間固定: 住宅金融支援機構の【フラット３５】の最も多い金利（借入期間21年以上35年以下・融資率9割以下）
 * - 変動・固定期間選択型（当初10年）: 主要な銀行が公表する最も低い適用金利の平均（民間の公表の金利。銀行の名前は画面に出さない）
 */
export function mortgageRateEstimate(type: MortgageRateType): RateEstimate {
  const m = masterRate(type === "variable" ? VARIABLE_ID : type === "fixedPeriod" ? FIXED_PERIOD_ID : FIXED_ID);
  if (m === null) return { rate: FALLBACK[type], basis: `${LABEL[type]} 年${pctText(FALLBACK[type])}（仮の値。統計の写しが読めません）` };
  const pending = m.pending ? "（原本での確かめ前）" : "";
  const p = pctText(m.rate);
  return { rate: m.rate, basis: `${LABEL[type]} 年${p}（${m.source}）${pending}` };
}

/** 推定の根拠の文から、目安の金利の文か（金利の種類を変えたときに入れ直してよい値か）を見分ける頭の言葉 */
export const RATE_ESTIMATE_HEADS: readonly string[] = ["変動金利 年", "全期間固定 年", "固定期間選択型 年", "固定期間選択型（当初10年） 年"];

/** 家賃の変動率の統計（消費者物価指数の民営家賃の、長い期間の年平均の変化）。写しに値が無ければ null */
export function rentGrowthStatistic(): { rate: string; text: string } | null {
  const m = masterRate(RENT_GROWTH_ID);
  if (m === null) return null;
  const r = Number(m.rate);
  const shown = `${r < 0 ? "−" : r > 0 ? "+" : ""}${pctText(Math.abs(r))}`;
  const flat = Math.abs(r) < 0.0005 ? "（ほぼ横ばい）" : "";
  return { rate: m.rate, text: `${m.source}は年${shown}${flat}${m.pending ? "（原本での確かめ前）" : ""}` };
}

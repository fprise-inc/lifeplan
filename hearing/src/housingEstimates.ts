// 住まい・ローンの推定の目安（0008 の2 の「推定」）。入力の画面（app/src/workspace/input/stages/housingLoans.ts・housing.ts）とヒアリングシートの取り込み
// （import.ts の簡易版の住宅ローン）は、どちらもこのファイルの値と根拠の文を使う（目安の数を1か所に置く）。
// 数は正本の YAML（data/master の master.housing.statistics。0007）の写し statistics.generated.ts から読む。
// 金利・家賃の統計は時とともに変わるので、リリースのたびに見直す（docs/estimates-review.md）
import { masterValue, officeBasisOf } from "./statistics.ts";

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
const CURRENT_ID = "housing.statistics.mortgageRate.current";
const RENT_GROWTH_ID = "housing.statistics.rentGrowth";

/** 写しに値が無いとき（正本の YAML を読めないとき）の予備の値。仮の値で、根拠の文にそう書く */
const FALLBACK: Readonly<Record<MortgageRateType, string>> = { variable: "0.008", fixedPeriod: "0.02", fixed: "0.02" };
const CURRENT_FALLBACK = "0.008";
/** 今返している住宅ローンの目安の根拠の文の頭 */
const CURRENT_LABEL = "今返している住宅ローン";
/** 今返している住宅ローンの目安の根拠の文の種類の書き方（かっこを重ねない） */
const CURRENT_TYPE_LABEL: Readonly<Record<"fixed" | "fixedPeriod", string>> = { fixed: "全期間固定", fixedPeriod: "固定期間選択型・当初10年" };
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
  // 事務所の推定の値なら、事務所の根拠の文そのもの（0111。完全に同じ文で見分ける）
  return { rate: m.rate, basis: officeBasisOf(type === "variable" ? VARIABLE_ID : type === "fixedPeriod" ? FIXED_PERIOD_ID : FIXED_ID) ?? `${LABEL[type]} 年${p}（${m.source}）${pending}` };
}

/**
 * 今返している住宅ローン（借りたのが計算の基準の月まで）の金利の目安（金利の種類ごと）。
 * - 変動金利（省略も）: 上の種類ごとの目安は新しく借りるときの金利で、今返している人には高すぎるので、住宅ローン利用者の借入金利の中央値
 *   （住宅金融支援機構「住宅ローン利用者の実態調査」。利用者の75%が変動型）を使う
 * - 全期間固定・固定期間選択型: 利用者の中央値は変動型の金利に寄っているので使わない。過去の年に借りた人の金利の公表の数（表の形）が無いので、
 *   前からの種類ごとの目安（新しく借りるときの金利）で代え、根拠の文にそう書く（借りたときの金利は返済予定表でわかれば直す）
 */
export function currentMortgageRateEstimate(type: MortgageRateType = "variable"): RateEstimate {
  if (type !== "variable") {
    const head = `${CURRENT_LABEL}（${CURRENT_TYPE_LABEL[type]}）`;
    const f = masterRate(type === "fixedPeriod" ? FIXED_PERIOD_ID : FIXED_ID);
    if (f === null) return { rate: FALLBACK[type], basis: `${head} 年${pctText(FALLBACK[type])}（仮の値。統計の写しが読めません）` };
    return { rate: f.rate, basis: officeBasisOf(type === "fixedPeriod" ? FIXED_PERIOD_ID : FIXED_ID) ?? `${head} 年${pctText(f.rate)}（${f.source}。借りた年ごとの金利の公表の数が無いので、新しく借りるときの目安で代えています）${f.pending ? "（原本での確かめ前）" : ""}` };
  }
  const m = masterRate(CURRENT_ID);
  if (m === null) return { rate: CURRENT_FALLBACK, basis: `${CURRENT_LABEL} 年${pctText(CURRENT_FALLBACK)}（仮の値。統計の写しが読めません）` };
  return { rate: m.rate, basis: officeBasisOf(CURRENT_ID) ?? `${CURRENT_LABEL} 年${pctText(m.rate)}（${m.source}）${m.pending ? "（原本での確かめ前）" : ""}` };
}

/** 推定の根拠の文から、目安の金利の文か（金利の種類を変えたときに入れ直してよい値か）を見分ける頭の言葉 */
export const RATE_ESTIMATE_HEADS: readonly string[] = [
  "変動金利 年",
  "全期間固定 年",
  "固定期間選択型 年",
  "固定期間選択型（当初10年） 年",
  `${CURRENT_LABEL} 年`,
  `${CURRENT_LABEL}（${CURRENT_TYPE_LABEL.fixed}） 年`,
  `${CURRENT_LABEL}（${CURRENT_TYPE_LABEL.fixedPeriod}） 年`,
];

/** 家賃の変動率の統計（消費者物価指数の民営家賃の、長い期間の年平均の変化）。写しに値が無ければ null */
export function rentGrowthStatistic(): { rate: string; text: string } | null {
  const m = masterRate(RENT_GROWTH_ID);
  if (m === null) return null;
  const r = Number(m.rate);
  const shown = `${r < 0 ? "−" : r > 0 ? "+" : ""}${pctText(Math.abs(r))}`;
  const flat = Math.abs(r) < 0.0005 ? "（ほぼ横ばい）" : "";
  return { rate: m.rate, text: `${m.source}は年${shown}${flat}${m.pending ? "（原本での確かめ前）" : ""}` };
}

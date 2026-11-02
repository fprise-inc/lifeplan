// 住宅ローン以外のローンの金利の目安（0008 の2 の「推定」）: 貸与の奨学金と自動車ローン。
// 2か所で使う目安（車の入力項目の自動車ローンと今返している自動車ローン）を、ここの1つの値にそろえる。貸与の奨学金は、これから借りる分
// （子ども・教育の入力項目）と今返している分（ほかのローンの「奨学金の返済」）で目安を分ける（利率は貸与を終えた月で決まるため。2026-11-01）。数は正本の YAML（data/master の master.loanRates。0007）の写し statistics.generated.ts から読む。
// 金利は市場で変わるので、リリースのたびに見直す（docs/estimates-review.md）
import { pctText } from "./housingEstimates.ts";
import { masterValue, officeBasisOf } from "./statistics.ts";

export interface LoanRateEstimate {
  /** 年率の文字（例 "0.03"） */
  readonly rate: string;
  /** 根拠の文（例: 年3%〔日本学生支援機構 第二種奨学金の貸与利率〕） */
  readonly basis: string;
}

function estimateOf(id: string, fallback: string): LoanRateEstimate {
  const v = masterValue(id);
  if (v === null || typeof v.value !== "string") return { rate: fallback, basis: `年${pctText(fallback)}（仮の値。統計の写しが読めません）` };
  // 値の題名の最初の「（」の前が、出典の短い名前
  const source = v.title.split("（")[0] ?? v.title;
  // 事務所の推定の値なら、事務所の根拠の文そのもの（0111。完全に同じ文で見分ける）
  return { rate: v.value, basis: officeBasisOf(id) ?? `年${pctText(v.value)}（${source}）${v.reviewed ? "" : "（原本での確かめ前）"}` };
}

/** 貸与の奨学金の利率の目安（日本学生支援機構 第二種奨学金の貸与利率。基本月額・利率固定方式）。これから借りる奨学金（子ども・教育の入力項目）に使う */
export const scholarshipRateEstimate = (): LoanRateEstimate => estimateOf("loanRates.scholarship", "0.01");

/**
 * 今返している奨学金の利率の目安（ほかのローンの「奨学金の返済」）。利率は貸与を終えた月で決まるので、今の利率でなく、
 * 今返している人が貸与を終えた年（過去15年の各年3月）の第二種・利率固定方式の利率の平均を使う。無利子の第一種なら0%
 */
export const repayingScholarshipRateEstimate = (): LoanRateEstimate => estimateOf("loanRates.scholarship.repaying", "0.0075");

/** 自動車ローンの金利の目安（主要な銀行が公表する最も低い金利の平均） */
export const carLoanRateEstimate = (): LoanRateEstimate => estimateOf("loanRates.carLoan", "0.025");

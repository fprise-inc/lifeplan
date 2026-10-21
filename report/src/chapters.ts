// 提案書の章（公式の帳票 @lifeplan/report-core の章の並び）。FP が画面で章を選ぶときの一覧。
// 表紙と「前提条件と注意書き」は外せない（宛名欄の宣言と、必須の記載の決まった欄があるため。0009 の3・6）
import type { ProposalInput } from "./input.ts";

export type ChapterId = "cover" | "assumptions" | "summary" | "basics" | "events" | "cashflow" | "moneyThree" | "education" | "housing" | "retirement" | "investment" | "marketDrop" | "contingency" | "insurance" | "changes" | "comparison";

export interface ChapterDef {
  id: ChapterId;
  label: string;
  /** 外せない章 */
  fixed: boolean;
}

/** 帳票の中の並び（lib.typ と同じ順） */
export const CHAPTERS: readonly ChapterDef[] = [
  { id: "cover", label: "表紙（目次）", fixed: true },
  { id: "assumptions", label: "前提条件と注意書き", fixed: true },
  { id: "summary", label: "世帯サマリー", fixed: false },
  { id: "basics", label: "基本項目", fixed: false },
  { id: "events", label: "ライフイベント表", fixed: false },
  { id: "cashflow", label: "キャッシュフロー表（資産残高のグラフ・資産と負債の推移を含む）", fixed: false },
  { id: "moneyThree", label: "お金の3つの分け方（説明用の図）", fixed: false },
  { id: "education", label: "教育費の推移", fixed: false },
  { id: "housing", label: "住宅ローン", fixed: false },
  { id: "retirement", label: "老後の必要資金と年金の受取予想", fixed: false },
  { id: "investment", label: "資産運用の計画（運用の期間・口座ごとの推移・資産の内訳）", fixed: false },
  { id: "marketDrop", label: "相場が下がった場合", fixed: false },
  { id: "contingency", label: "万一のとき", fixed: false },
  { id: "insurance", label: "保障内容と払込保険料", fixed: false },
  { id: "changes", label: "提案での変更点", fixed: false },
  { id: "comparison", label: "プランの比較", fixed: false },
];

export const CHAPTER_IDS: readonly ChapterId[] = CHAPTERS.map((c) => c.id);

/** その章の材料が帳票の入力にあるか（無い章は帳票が省く） */
export function hasMaterial(input: ProposalInput, id: ChapterId): boolean {
  switch (id) {
    case "events":
      return input.events.length > 0;
    case "education":
      return input.education !== null;
    case "housing":
      return input.housingLoan !== null;
    case "retirement":
      return input.retirement !== null;
    case "contingency":
      return input.contingency !== null;
    case "insurance":
      return input.insurance !== null;
    case "comparison":
      return input.comparison != null;
    case "investment":
      return input.investment != null;
    case "marketDrop":
      return input.marketDrop != null;
    case "moneyThree":
      return input.moneyThree != null;
    default:
      return true;
  }
}

/**
 * 選んだ章だけを載せる帳票の入力にする: 外した章の材料は帳票に渡さない（null・空にする）。
 * 外せない章は、選んでいなくても残す。並びは帳票の並びにそろえる
 */
export function selectChapters(input: ProposalInput, chosen: readonly ChapterId[]): ProposalInput {
  const on = new Set<ChapterId>([...chosen, ...CHAPTERS.filter((c) => c.fixed).map((c) => c.id)]);
  const out: ProposalInput = { ...input, chapters: CHAPTER_IDS.filter((id) => on.has(id)) };
  if (!on.has("events")) out.events = [];
  if (!on.has("cashflow")) out.balanceSheet = null;
  if (!on.has("education")) out.education = null;
  if (!on.has("housing")) out.housingLoan = null;
  if (!on.has("retirement")) out.retirement = null;
  if (!on.has("contingency")) out.contingency = null;
  if (!on.has("insurance")) out.insurance = null;
  if (!on.has("comparison")) out.comparison = null;
  if (!on.has("investment")) out.investment = null;
  if (!on.has("marketDrop")) out.marketDrop = null;
  if (!on.has("moneyThree")) out.moneyThree = null;
  return out;
}

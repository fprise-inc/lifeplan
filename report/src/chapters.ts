// 提案書の章（公式の帳票 @lifeplan/report-core の章の並び）。FP が画面で章を選ぶときの一覧。
// 表紙と「前提条件と注意書き」は外せない（宛名欄の宣言と、必須の記載の決まった欄があるため。0009 の3・6）
// 提案書の拡張の章（0114 の6。束の章。id は ext.<作成者>.<名前>）は、「提案での変更点」の後・「プランの比較」の前に、束の id の順で並ぶ
import type { ProposalInput } from "./input.ts";

export type OfficialChapterId = "cover" | "assumptions" | "summary" | "basics" | "dreams" | "events" | "cashflow" | "moneyThree" | "education" | "housing" | "rental" | "retirement" | "investment" | "marketDrop" | "contingency" | "insurance" | "changes" | "comparison";
/** 拡張の章の id（ext.<作成者>.<名前>） */
export type ExtChapterId = `ext.${string}`;
export type ChapterId = OfficialChapterId | ExtChapterId;

/** 拡張の章の id の書式（0004 の書式の3段） */
export const EXT_CHAPTER_ID = /^ext\.[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;
export const isExtChapterId = (id: string): id is ExtChapterId => EXT_CHAPTER_ID.test(id);

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
  { id: "summary", label: "ご家族のまとめ", fixed: false },
  { id: "basics", label: "基本項目", fixed: false },
  { id: "dreams", label: "ご家族の夢（夢プラン）", fixed: false },
  { id: "events", label: "ライフイベント表", fixed: false },
  { id: "cashflow", label: "キャッシュフロー表（資産残高のグラフ・資産と負債の推移を含む）", fixed: false },
  { id: "moneyThree", label: "お金の3つの分け方（説明用の図）", fixed: false },
  { id: "education", label: "教育費の推移", fixed: false },
  { id: "housing", label: "住宅ローン", fixed: false },
  { id: "rental", label: "収益不動産のまとめ（物件ごとの数字と売る年の比べ）", fixed: false },
  { id: "retirement", label: "老後の必要資金と年金の受取予想", fixed: false },
  { id: "investment", label: "資産運用の計画（運用の期間・口座ごとの推移・資産の内訳）", fixed: false },
  { id: "marketDrop", label: "相場が下がった場合", fixed: false },
  { id: "contingency", label: "万一のとき", fixed: false },
  { id: "insurance", label: "保障内容と払込保険料", fixed: false },
  { id: "changes", label: "提案での変更点", fixed: false },
  { id: "comparison", label: "プランの比較", fixed: false },
];

export const CHAPTER_IDS: readonly OfficialChapterId[] = CHAPTERS.map((c) => c.id as OfficialChapterId);

/** 拡張の章を置く所（この章の後） */
const EXT_AFTER: OfficialChapterId = "changes";

/** 章の並び（公式の章の並びに、拡張の章を「提案での変更点」の後へ束の id の順で入れる） */
function ordered<T extends { id: ChapterId }>(official: readonly T[], ext: readonly T[]): T[] {
  const at = official.findIndex((c) => c.id === EXT_AFTER) + 1;
  const sorted = [...ext].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...official.slice(0, at), ...sorted, ...official.slice(at)];
}

/** 章の一覧（FP が画面で選ぶ。有効な束の章を足す） */
export function chapterList(ext: readonly { id: ExtChapterId; label: string }[]): ChapterDef[] {
  return ordered(CHAPTERS, ext.filter((c) => isExtChapterId(c.id)).map((c) => ({ id: c.id, label: c.label, fixed: false })));
}

/** その章の材料が帳票の入力にあるか（無い章は帳票が省く） */
export function hasMaterial(input: ProposalInput, id: ChapterId): boolean {
  if (isExtChapterId(id)) return input.extensions?.[id] != null;
  switch (id) {
    case "events":
      return input.events.length > 0;
    case "dreams":
      return input.dreams != null;
    case "education":
      return input.education !== null;
    case "housing":
      return input.housingLoan !== null;
    case "rental":
      return input.rental != null;
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
  const ext = [...new Set(chosen.filter(isExtChapterId))].map((id) => ({ id }));
  const out: ProposalInput = { ...input, chapters: ordered<{ id: ChapterId }>(CHAPTER_IDS.map((id) => ({ id })), ext).map((c) => c.id).filter((id) => on.has(id)) };
  if (!on.has("events")) out.events = [];
  if (!on.has("dreams")) out.dreams = null;
  if (!on.has("cashflow")) out.balanceSheet = null;
  if (!on.has("education")) out.education = null;
  if (!on.has("housing")) out.housingLoan = null;
  if (!on.has("rental")) out.rental = null;
  if (!on.has("retirement")) out.retirement = null;
  if (!on.has("contingency")) out.contingency = null;
  if (!on.has("insurance")) out.insurance = null;
  if (!on.has("comparison")) out.comparison = null;
  if (!on.has("investment")) out.investment = null;
  if (!on.has("marketDrop")) out.marketDrop = null;
  if (!on.has("moneyThree")) out.moneyThree = null;
  // 拡張の章: 選んだ章の材料だけを渡す
  const kept = Object.entries(input.extensions ?? {}).filter(([id]) => isExtChapterId(id) && on.has(id));
  out.extensions = kept.length > 0 ? Object.fromEntries(kept) : null;
  // 見本の印（0197）: 載せる拡張の章のものだけ残す
  const samples = (input.extensionSamples ?? []).filter((id) => out.extensions?.[id] !== undefined);
  out.extensionSamples = samples.length > 0 ? samples : null;
  return out;
}

// 変額保険を解約して保障と運用に分ける比較（0233）の注意: 画面の区画（app の input/VariableSplit.tsx）と提案書の「前提条件と注意書き」で同じ文を使う。
// 提案書には、提案か比較のページのプランで、現状に解約の予定が無い変額保険に解約の予定を入れているときに載せる（どの契約かは書かない）
import type { EngineRequest } from "./bundle.ts";

/** 必ず出す注意 */
export const SPLIT_CAUTIONS: readonly string[] = [
  "健康状態によっては、新しい保険に入れないことがあります。掛け捨ての保険に入れることを確かめてから解約を考えてください",
  "早い時期の解約には解約控除がかかり、解約返戻金が払った保険料を下回ることがあります",
  "年齢が上がると、新しく入る保険の保険料は上がります（入る時期が遅いほど高くなります）",
  "保険の募集人が乗り換えを勧めるときには、今の契約と新しい契約の違い（不利になる点を含む）を説明する決まりがあります",
];

/** 提案書の注意書きの頭の一文 */
export const SPLIT_LEAD = "変額保険を解約して、保障（掛け捨ての保険）と運用に分けるプランを載せています。比較の試算で、特定の商品をおすすめするものではありません。";

const VARIABLE = "insurance.variable";

/** plan に、current では解約の予定の無い変額保険の解約の予定があるか */
export function surrendersVariable(current: EngineRequest, plan: EngineRequest): boolean {
  const now = new Map((current.input.household.insuranceContracts ?? []).map((c) => [c.id, c]));
  return (plan.input.household.insuranceContracts ?? []).some((c) => c.template === VARIABLE && c.surrender !== undefined && now.get(c.id)?.surrender === undefined && now.get(c.id)?.template === VARIABLE);
}

/** 提案書の注意書き（提案か比較のプランのどれかが変額保険を解約するときだけ。文の終わりに句点） */
export function splitCautionNotes(current: EngineRequest, plans: readonly EngineRequest[]): string[] {
  return plans.some((p) => surrendersVariable(current, p)) ? [SPLIT_LEAD, ...SPLIT_CAUTIONS.map((t) => `${t}。`)] : [];
}

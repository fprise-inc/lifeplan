// 変額保険を解約するプランの注意（0233）: 提案書の「前提条件と注意書き」と、保険の入力項目の解約の月の近くの説明で同じ文を使う。
// 提案書には、提案か比較のページのプランが、現状では解約の予定が無い変額保険を解約するときに載せる（FP が手で作ったプランでも同じ。どの契約かは書かない）
import type { EngineRequest } from "./bundle.ts";

/** 注意の4つ */
export const SURRENDER_CAUTIONS: readonly string[] = [
  "健康状態によっては、新しい保険に入れないことがあります。掛け捨ての保険に入れることを確認してから解約を考えてください",
  "早い時期の解約には解約控除がかかり、解約返戻金が払った保険料を下回ることがあります",
  "年齢が上がると、新しく入る保険の保険料は上がります（入る時期が遅いほど高くなります）",
  "保険の募集人が乗り換えを勧めるときには、今の契約と新しい契約の違い（不利になる点を含む）を説明する決まりがあります",
];

/** 提案書の注意書きの頭の一文 */
export const SURRENDER_LEAD = "変額保険を解約するプランを載せています。比較の試算で、特定の商品をおすすめするものではありません。";

/** 保険の入力項目の、運用の利回りの一言（解約の月の近くの説明の頭） */
export const SURRENDER_RATE_NOTE = "解約して保障と運用に分けるプランを作るときは、運用の利回りを、続ける場合と同じ前提にそろえて比較してください";

const VARIABLE = "insurance.variable";

/** plan に、current では解約の予定の無い変額保険の解約の予定があるか */
export function surrendersVariable(current: EngineRequest, plan: EngineRequest): boolean {
  const now = new Map((current.input.household.insuranceContracts ?? []).map((c) => [c.id, c]));
  return (plan.input.household.insuranceContracts ?? []).some((c) => {
    const before = now.get(c.id);
    return c.template === VARIABLE && c.surrender !== undefined && before?.template === VARIABLE && before.surrender === undefined;
  });
}

/** 提案書の注意書き（提案か比較のプランのどれかが変額保険を解約するときだけ。文の終わりに句点） */
export function surrenderCautionNotes(current: EngineRequest, plans: readonly EngineRequest[]): string[] {
  return plans.some((p) => surrendersVariable(current, p)) ? [SURRENDER_LEAD, ...SURRENDER_CAUTIONS.map((t) => `${t}。`)] : [];
}

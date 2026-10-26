// 3. 退職金・企業年金: 辞めるときとその後にもらう会社の給付（退職一時金・確定給付企業年金・公務員の退職手当と年金払い退職給付・
// 国民年金基金・役員退職慰労金）を人ごとに何件でも。物（retirementBenefits）と欄は今のまま（work.ts の benefitGroups）で、見せるカードだけをここにした。
// iDeCo・企業型DC・小規模企業共済の受け取りは口座の物の一部なので貯蓄・運用のカードで入れ、ここには読むだけで並べる（受け取りの順番と間隔を一緒に見るため）
import type { Account, Household, Member } from "../../../engine/types.ts";
import type { SectionDef, StageDef } from "../form.ts";
import type { WorkingHousehold } from "../household.ts";
import { ACCOUNT_KINDS, earners, memberLabel } from "../labels.ts";
import { readGroup, readLine } from "../readLines.ts";
import { defaultPayoutAge, payoutAgeOf } from "../savings/model.ts";
import { addBenefitAction, benefitGroups } from "./work.ts";

/** 受け取りを読むだけで並べる口座の種類 */
export const DC_RECEIPT_KINDS: ReadonlySet<string> = new Set(["ideco", "corporateDc", "smallBusinessMutualAid"]);

const METHOD_TEXT: Readonly<Record<string, string>> = { lumpSum: "一時金", annuity: "年金", mixed: "一時金と年金の併用" };

/** 退職金・企業年金のカードに出す人（本人・配偶者・働き方の期間のある人と、退職給付のある人） */
function people(h: Household): Member[] {
  const list = earners(h);
  for (const b of h.retirementBenefits ?? []) {
    const m = h.members.find((x) => x.id === b.member);
    if (m !== undefined && !list.includes(m)) list.push(m);
  }
  return list;
}

/** iDeCo・企業型DCの受け取りの読むだけの文（例: 一時金・65歳から） */
function receiptText(wh: WorkingHousehold, a: Account): string {
  if (a.kind === "smallBusinessMutualAid") return "受け取りは貯蓄・運用のカードの口座で";
  const h = wh.request.input.household;
  const age = payoutAgeOf(h, a);
  const method = a.payout === undefined ? "一時金（推定）" : (METHOD_TEXT[a.payout.method] ?? a.payout.method);
  return `${method}・${age ?? `${defaultPayoutAge(wh.request, a)}歳（推定）`}${age !== null ? "歳" : ""}から`;
}

export function retirementStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const sections: SectionDef[] = people(h).map((m) => {
    const add = addBenefitAction(wh, m);
    return {
      key: `retirement/${m.id}`,
      title: memberLabel(wh, m.id),
      level: "simple",
      groups: benefitGroups(wh, m),
      actions: add !== null ? [add] : [],
    };
  });
  const dc = (h.accounts ?? []).filter((a) => DC_RECEIPT_KINDS.has(a.kind));
  const kindLabel = (k: string) => ACCOUNT_KINDS.find((o) => o.value === k)?.label ?? k;
  const ro = readGroup(
    "retirement/dc",
    undefined,
    dc.map((a) => readLine(`retirement/dc/${a.id}`, `${kindLabel(a.kind)}（${memberLabel(wh, a.owner)}）`, receiptText(wh, a), "貯蓄・運用")),
  );
  if (ro !== null)
    sections.push({
      key: "retirement/dc",
      title: "iDeCo・企業型DCの受け取り",
      note: "退職金と同じ年に一時金で受け取ると、退職所得控除を分け合います。受け取りの順番と間隔を、ここで並べて見ます",
      level: "simple",
      groups: [ro],
      actions: [],
    });
  return {
    id: "retirement",
    label: "退職金・企業年金",
    lead: "辞めるときとその後にもらう会社の給付（退職一時金・確定給付企業年金・公務員の退職手当・国民年金基金・役員退職慰労金）を、人ごとに入れます。",
    sections,
  };
}

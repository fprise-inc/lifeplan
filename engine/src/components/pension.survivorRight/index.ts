// 遺族年金の受給権（受け取る構成員ごと）: 万一の想定で配偶者・親が亡くなったときに、どの遺族年金の受給権を、いつからいつまで持つか。
// 老齢年金の繰下げの判定（pension.oldAgeBase。国民年金法28条・厚生年金保険法44条の3: 66歳に達する前に他の年金の受給権を得ると繰り下げられず、
// 66歳の後に得るとその日に申出があったとみなす）のための小さな部品。pension.survivor は自分の老齢年金を読むので、pension.oldAgeBase からは
// pension.survivor を呼べない（循環する）。判定は pension.survivor と同じ SDK の survivorBasis で行う
// - basic: 遺族基礎年金（子のある配偶者・子。最後の子が18歳に達した後の最初の3月31日まで）
// - employee: 遺族厚生年金（配偶者は夫なら死亡の当時55歳以上。30歳未満で子の無い妻は5年まで）
// 寡婦年金（60歳から65歳になるまで）は65歳で消えるので、繰下げの判定には関わらず、ここでは出さない
import {
  defineComponent,
  formatYm,
  survivorBasis,
  survivorDeath,
  SURVIVOR_BASIS_PARAMS,
  type MemberInput,
  type RelationInput,
  type SurvivorRightOutput,
} from "../../sdk/index.ts";

export default defineComponent<{ member: string }, SurvivorRightOutput>({
  id: "pension.survivorRight",
  title: "遺族年金の受給権",
  contract: "1.0",
  revision: 1,
  requires: { "contingency.event": ">=1 <2", "pension.record": ">=1 <2" },
  params: Object.values(SURVIVOR_BASIS_PARAMS),
  reads: ["member.kind", "member.birth", "member.sex", "relation.type", "relation.a", "relation.b", "relation.from", "relation.to", "relation.parent", "relation.child"],
  input: "member.input",
  output: "pension.survivorRight.output",
  compute(input, ctx) {
    const Y = input.member;
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    const d = survivorDeath(ctx, Y, members, relations);
    if (d === null) return { rights: [] };
    const sb = survivorBasis(ctx, Y, d, members, relations);
    if (sb === null) return { rights: [] };
    const rights: SurvivorRightOutput["rights"][number][] = [];
    const from = formatYm(sb.death);
    const ownUntil = sb.isChild ? (sb.childUntil.get(Y) ?? sb.death) : sb.lastKid;
    if (sb.basicOk && sb.kidsAtDeath) rights.push({ kind: "basic", from, to: formatYm(ownUntil) });
    if (sb.isSpouse ? sb.spouseEmployeeRight : sb.employeeOk) {
      const to = sb.isChild ? ownUntil : sb.empUntil;
      rights.push({ kind: "employee", from, to: to === null ? null : formatYm(to) });
    }
    return { rights };
  },
});

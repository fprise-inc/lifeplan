// 残された配偶者のひとり親・寡婦の判定（構成員×年分。判定だけを返す小さな部品。tax.deductions が読む。6.3）。
// その年の12月31日の現況で、配偶者が万一の想定で亡くなっていて（その年の末までに。死亡の月で配偶者の関係が終わる）、その後に配偶者がいない人が:
// - ひとり親: 生計を一にする子（世帯にいる子で、その年の総所得金額等が上限以下）がいて、本人の合計所得金額が上限以下（男女とも）
// - 寡婦: ひとり親でない女性で、本人の合計所得金額が上限以下（死別は扶養親族の要件なし）
// 離婚・未婚のひとり親は、死亡の万一の想定ではないので扱わない（入力に離婚・未婚の形が無い）
// 改訂2: 世帯の外の家族（0035 の4）の子は生計を一にする子にしない
// 改訂（0044）: 合計所得金額の判定に、分離課税の譲渡所得（tax.totalIncome の separate。入るお金の行）も足す
import {
  childrenOf,
  defineComponent,
  isOutside,
  monthIndex,
  parseYm,
  spousesAt,
  type ContingencyEventOutput,
  type MemberInput,
  type RelationInput,
  type TotalIncomeOutput,
} from "../../sdk/index.ts";

const P = {
  widowLimit: "incomeTax.widowDeduction.incomeLimit",
  parentLimit: "incomeTax.singleParentDeduction.incomeLimit",
  childLimit: "incomeTax.singleParentDeduction.childIncomeLimit",
};

export default defineComponent<{ member: string; year: number }, { widow: boolean; singleParent: boolean }>({
  id: "tax.survivorStatus",
  title: "ひとり親・寡婦の判定（配偶者と死別した人）",
  contract: "1.0",
  revision: 3,
  requires: { "contingency.event": ">=1 <2", "tax.totalIncome": ">=1 <2" },
  params: Object.values(P),
  reads: ["member.outside", "member.kind", "member.sex", "member.birth", "member.leaves", "relation.type", "relation.a", "relation.b", "relation.from", "relation.to", "relation.parent", "relation.child"],
  input: "tax.memberYear.input",
  output: "tax.survivorStatus.output",
  compute(input, ctx) {
    const { member, year } = input;
    const no = { widow: false, singleParent: false };
    const dec = monthIndex(year, 12);
    const relations = ctx.list<RelationInput>("relation");
    // 亡くなった配偶者（関係の相手の万一の想定が死亡で、その年の末までに）
    let bereaved = false;
    for (const r of relations) {
      if (r.type !== "spouse" || (r.a !== member && r.b !== member)) continue;
      const other = (r.a === member ? r.b : r.a) as string;
      const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: other }).event;
      if (ev !== null && ev.kind === "death" && parseYm(ev.month) <= dec) bereaved = true;
    }
    if (!bereaved || spousesAt(ctx, relations, member, dec).length > 0) return no;
    const members = ctx.list<MemberInput>("member");
    const me = members.find((m) => m.id === member) as MemberInput;
    const at = ctx.at(monthIndex(year, 1));
    const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year });
    const own = inc.total + (inc.retirement ?? 0) + (inc.separate ?? 0);
    // 生計を一にする子（その年の末に世帯にいて、生まれている子）
    const childLimit = at.paramYen(P.childLimit);
    // 世帯の外の子は生計を一にする子にしない（0035 の4）
    const kids = childrenOf(members, relations, member).filter(
      (c) =>
        !isOutside(c) &&
        parseYm(c.birth.birthYearMonth) <= dec &&
        (c.leaves === null || ctx.time.resolve(c.leaves) > dec) &&
        (childLimit === null || ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: c.id, year }).total <= childLimit),
    );
    const parentLimit = at.paramYen(P.parentLimit);
    if (kids.length > 0 && (parentLimit === null || own <= parentLimit)) return { widow: false, singleParent: true };
    const widowLimit = at.paramYen(P.widowLimit);
    if (me.sex === "female" && (widowLimit === null || own <= widowLimit)) return { widow: true, singleParent: false };
    return no;
  },
});

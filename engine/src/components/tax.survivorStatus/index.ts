// ひとり親・寡婦の判定（構成員×年分。判定だけを返す小さな部品。tax.deductions が読む。6.3）。
// その年の12月31日の現況で判定する（所得税法2条1項30号・31号、地方税法292条1項11号・12号。住民税も同じ要件）。
// - 配偶者の関係（法律婚・事実婚）が12月にある人は、どちらでもない（婚姻している・事実婚。事実婚は住民票の「未届の夫・妻」で同じ世帯に
//   いるので、世帯の関係の事実婚で表す。所得税法施行規則1条の3・1条の4）
// - 婚姻の状態: 世帯の法律婚の関係が終わった後は、その終わり方で決める（相手が万一の想定で亡くなって終わった＝死別、ほかの終わり＝離婚。
//   いちばん後に終わった関係で決める）。終わった法律婚の関係が無ければ、構成員の欄 maritalStatus（配偶者の関係が無い期間の婚姻の状態。
//   未婚・離婚・死別・婚姻している〔別居など〕。省略は婚姻していないとみなす）。事実婚の関係が終わっても婚姻の状態は変えない（法律婚ではない）
// - ひとり親: 婚姻していなくて（婚姻している〔別居など〕でない）、生計を一にする子（世帯にいる子で、その年の総所得金額等が上限以下）がいて、
//   本人の合計所得金額が上限以下（男女とも。未婚・離婚・死別を問わない。配偶者の生死が明らかでない者は、政令で戦後の未帰還者の配偶者に
//   限るので扱わない）
// - 寡婦: ひとり親でない女性で、本人の合計所得金額が上限以下、かつ 死別（扶養親族の要件なし）か、離婚で扶養親族がいる。未婚・省略は寡婦にしない
// 改訂2: 世帯の外の家族（0035 の4）の子は生計を一にする子にしない
// 改訂（0044）: 合計所得金額の判定に、分離課税の譲渡所得（tax.totalIncome の separate。入るお金の行）も足す
// 改訂4（0156）: 離婚・未婚のひとり親（今までは死別の後〔万一の想定〕だけ）と、構成員の欄 maritalStatus・世帯の関係の終わり方からの婚姻の状態、
//   離婚した女性の寡婦（扶養親族がいるとき）を足した。子の所得の上限は所得税の値を住民税の判定にも使う（地方税法施行令46条の2の2 の上限は、
//   同じ所得の年で所得税と同じ 48万円・58万円・62万円）
import {
  childrenOf,
  defineComponent,
  isOutside,
  monthIndex,
  OUTSIDE_CHILD_SUPPORT_READS,
  outsideChildSupported,
  parseYm,
  spousesAt,
  type ContingencyEventOutput,
  type Ctx,
  type MemberInput,
  type MonthIndex,
  type RelationInput,
  type TotalIncomeOutput,
} from "../../sdk/index.ts";

const P = {
  widowLimit: "incomeTax.widowDeduction.incomeLimit",
  parentLimit: "incomeTax.singleParentDeduction.incomeLimit",
  childLimit: "incomeTax.singleParentDeduction.childIncomeLimit",
  dependentLimit: "incomeTax.dependentIncomeLimit",
};

/** 婚姻の状態（12月31日の現況）。spouse は配偶者の関係（法律婚・事実婚）が12月にある */
type Marital = "spouse" | "married" | "unmarried" | "divorced" | "bereaved";

export default defineComponent<{ member: string; year: number }, { widow: boolean; singleParent: boolean }>({
  id: "tax.survivorStatus",
  title: "ひとり親・寡婦の判定",
  contract: "1.0",
  revision: 4,
  requires: { "contingency.event": ">=1 <2", "tax.totalIncome": ">=1 <2" },
  params: Object.values(P),
  reads: [
    "member.outside",
    "member.kind",
    "member.sex",
    "member.birth",
    "member.joins",
    "member.leaves",
    "member.support",
    "member.maritalStatus",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.marriage",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
    ...OUTSIDE_CHILD_SUPPORT_READS,
  ],
  input: "tax.memberYear.input",
  output: "tax.survivorStatus.output",
  compute(input, ctx) {
    const { member, year } = input;
    const no = { widow: false, singleParent: false };
    const dec = monthIndex(year, 12);
    const relations = ctx.list<RelationInput>("relation");
    const members = ctx.list<MemberInput>("member");
    const me = members.find((m) => m.id === member) as MemberInput;
    const status = maritalAt(ctx, relations, me, dec);
    if (status === "spouse" || status === "married") return no;
    const at = ctx.at(monthIndex(year, 1));
    const income = (id: string) => {
      const t = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year });
      return t.total + (t.retirement ?? 0) + (t.separate ?? 0);
    };
    const present = (m: MemberInput) =>
      parseYm(m.birth.birthYearMonth) <= dec && (m.joins === null || ctx.time.resolve(m.joins) <= dec) && (m.leaves === null || ctx.time.resolve(m.leaves) > dec);
    // 制度の上限の値（その年の値が制度データに無ければ判定しない。制度データを持たない試験用のパック・値の無い昔の年）
    const limitOf = (id: string) => (at.has(id) ? at.paramYen(id) : null);
    // 生計を一にする子（その年の末に世帯にいて、生まれている子）。世帯の外の子は生計を一にする子にしない（0035 の4）
    const inside = childrenOf(members, relations, member).filter((c) => !isOutside(c) && present(c));
    const widowCase = me.sex === "female" && (status === "bereaved" || status === "divorced");
    if (inside.length === 0 && !widowCase) return no;
    const own = income(member);
    const childLimit = limitOf(P.childLimit);
    const parentLimit = limitOf(P.parentLimit);
    if (childLimit !== null && parentLimit !== null && own <= parentLimit) {
      if (inside.some((c) => ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: c.id, year }).total <= childLimit)) return { widow: false, singleParent: true };
    }
    if (!widowCase) return no;
    const widowLimit = limitOf(P.widowLimit);
    if (widowLimit === null || own > widowLimit) return no;
    // 死別は扶養親族の要件なし。離婚は扶養親族（子と、扶養している親・祖父母。合計所得金額が上限以下）がいるときだけ
    if (status === "divorced") {
      const limit = limitOf(P.dependentLimit) ?? childLimit;
      const dependent = members.some((d) => {
        if (d.id === member || !present(d)) return false;
        const elder = d.kind === "parent" || d.kind === "grandparent" || (isOutside(d) && d.kind !== "child");
        if (d.kind !== "child" && !(elder && d.support?.dependent === true)) return false;
        // 世帯の外の家族は、扶養していると入れたときだけ（世帯の外の子は、養育費・仕送りの行がその月を含むときだけ。tax.dependentDeduction と同じ）
        if (isOutside(d) && (d.support?.dependent !== true || !outsideChildSupported(ctx, d, dec))) return false;
        return limit === null || income(d.id) <= limit;
      });
      if (!dependent) return no;
    }
    return { widow: true, singleParent: false };
  },
});

/**
 * 月 dec（12月）の婚姻の状態。配偶者の関係（法律婚・事実婚）がその月にあれば spouse。無ければ、その月までに終わった法律婚の関係のうち
 * いちばん後に終わったものの終わり方（相手の万一の想定の死亡の月で終わった＝死別、ほか＝離婚）。終わった法律婚が無ければ構成員の欄
 * （省略は未婚とみなす。ひとり親の判定では未婚・離婚・死別は同じで、寡婦は判定しない）
 */
function maritalAt(ctx: Ctx, relations: readonly RelationInput[], me: MemberInput, dec: MonthIndex): Marital {
  if (spousesAt(ctx, relations, me.id, dec).length > 0) return "spouse";
  let last: { end: MonthIndex; how: "divorced" | "bereaved" } | null = null;
  for (const r of relations) {
    if (r.type !== "spouse" || r.marriage !== "legal" || (r.a !== me.id && r.b !== me.id) || r.to === null) continue;
    const end = ctx.time.resolve(r.to);
    if (end > dec || (r.from !== null && ctx.time.resolve(r.from) > dec)) continue;
    const other = r.a === me.id ? r.b : r.a;
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: other }).event;
    // 万一の想定の重ねは、亡くなった月で配偶者の関係を終える（engine/overlay.ts）。その月に終わった関係は死別
    const how = ev !== null && ev.kind === "death" && parseYm(ev.month) === end ? "bereaved" : "divorced";
    if (last === null || end >= last.end) last = { end, how };
  }
  if (last !== null) return last.how;
  return me.maritalStatus ?? "unmarried";
}

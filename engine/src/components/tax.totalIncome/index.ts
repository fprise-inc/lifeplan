// 合計所得金額＝給与所得（所得金額調整控除の後）＋公的年金等に係る雑所得＋その他の所得。所得の計算そのものは tax.totalIncomeBase（約束の版 1.8 までの
// 中身）で、この部品は所得金額調整控除の子ども・特別障害者等の分を引く（改訂10。0167。2026-11-08 に分けた）
// - 所得金額調整控除（子ども・特別障害者等。租税特別措置法41条の3の11第1項）: その年の給与等の収入金額が850万円を超え、年齢23歳未満の扶養親族を
//   有する人は、（給与等の収入金額〔1,000万円が上限〕−850万円）×10%（1円未満は切り上げ）を給与所得から引く。給与と公的年金等の両方がある分
//   （同条2項。tax.totalIncomeBase が引く）は、この分を引いた後の給与所得からさらに引く。adjustment は両方の合計
// - 扶養親族は、扶養控除（tax.dependentDeduction）と同じく、配偶者以外の子と扶養している親・祖父母（世帯の外の家族は扶養していると入れた人、世帯の外の子は
//   養育費・仕送りの行がある間）で、合計所得金額（所得税。退職所得・分離課税の譲渡所得を含む）が扶養親族の上限以下の人。扶養控除と違い、
//   同じ子について夫婦の両方が受けられる（国税庁 No.1411 の注）。判定はその年の12月31日（本人がその年に亡くなれば死亡の時、その前に亡くなった
//   扶養親族は死亡の時）の現況（同条3項）
// - 本人・配偶者（kind self・spouse）だけを判定する（扶養控除を受ける人と同じ範囲。子や親の構成員の「扶養親族」は関係から決められない）
// - 特別障害者（本人・同一生計配偶者・扶養親族）の分は、構成員に障害の欄が無いので判定しない（0012 の未確定。0167）
import {
  deathMonthIn,
  defineComponent,
  isOutside,
  monthIndex,
  outsideChildSupported,
  OUTSIDE_CHILD_SUPPORT_READS,
  parseYm,
  fail,
  yen,
  type Ctx,
  type EmploymentIncomeOutput,
  type MemberInput,
  type MonthIndex,
  type TotalIncomeOutput,
} from "../../sdk/index.ts";

const P = {
  threshold: "incomeTax.incomeAdjustment.children.revenueThreshold",
  cap: "incomeTax.incomeAdjustment.children.revenueCap",
  rate: "incomeTax.incomeAdjustment.children.rate",
  age: "incomeTax.incomeAdjustment.children.youngDependentUntilAge",
  rounding: "incomeTax.incomeAdjustment.children.rounding",
  incomeLimit: "incomeTax.dependentIncomeLimit",
};

export default defineComponent<{ member: string; year: number }, TotalIncomeOutput>({
  id: "tax.totalIncome",
  title: "合計所得金額",
  contract: "1.8",
  revision: 10,
  requires: { "tax.totalIncomeBase": ">=1 <2", "tax.employmentIncome": ">=1 <2", "contingency.event": ">=1 <2" },
  params: Object.values(P),
  reads: ["member.outside", "member.kind", "member.birth", "member.joins", "member.leaves", "member.support", ...OUTSIDE_CHILD_SUPPORT_READS],
  input: "tax.memberYear.input",
  output: "tax.totalIncome.output",
  compute(input, ctx) {
    const base = ctx.call<TotalIncomeOutput>("tax.totalIncomeBase", input);
    const { member, year } = input;
    const members = ctx.list<MemberInput>("member");
    const me = members.find((m) => m.id === member);
    if (me === undefined || (me.kind !== "self" && me.kind !== "spouse") || base.employment <= 0) return base;
    const at = ctx.at(monthIndex(year, 1));
    const threshold = at.paramYen(P.threshold);
    if (threshold === null) return base;
    const revenue = ctx.call<EmploymentIncomeOutput>("tax.employmentIncome", input).revenue;
    if (revenue <= threshold) return base;
    if (!hasYoungDependent(ctx, members, member, year)) return base;
    const cap = at.paramYen(P.cap) ?? revenue;
    const rate = at.paramRate(P.rate);
    if (rate === null) {
      ctx.notice("N_PARAM_MISSING", [P.rate]);
      return base;
    }
    const over = yen((revenue < cap ? revenue : cap) - threshold);
    let child = at.money.mulRate(over, rate, P.rounding);
    if (child > base.employment) child = base.employment;
    if (child <= 0) return base;
    const before = base.total - (base.netLoss ?? 0) - child;
    const rest: { -readonly [K in keyof TotalIncomeOutput]?: TotalIncomeOutput[K] } = { ...base };
    delete rest.netLoss;
    return {
      ...rest,
      total: yen(before > 0 ? before : 0),
      employment: yen(base.employment - child),
      adjustment: yen((base.adjustment ?? 0) + child),
      ...(before < 0 ? { netLoss: yen(-before) } : {}),
    };
  },
});

/** その年の12月31日（本人がその年に亡くなれば死亡の時）に、23歳未満の扶養親族がいるか */
function hasYoungDependent(ctx: Ctx, members: readonly MemberInput[], member: string, year: number): boolean {
  const at = ctx.at(monthIndex(year, 1));
  const dec: MonthIndex = monthIndex(year, 12);
  const own = deathMonthIn(ctx, member, year) ?? dec;
  const sel = at.param(P.age);
  const years = at.paramCount(P.age);
  if (years === null || sel.def.ageSwitch === null) fail("E_PARAM_KIND", [P.age]);
  const limit = at.paramYen(P.incomeLimit) ?? yen(0);
  const present = (m: MemberInput, j: MonthIndex) =>
    parseYm(m.birth.birthYearMonth) <= j && (m.joins === null || ctx.time.resolve(m.joins) <= j) && (m.leaves === null || ctx.time.resolve(m.leaves) > j);
  for (const d of members) {
    // 配偶者（kind spouse）は扶養親族にしない（下の子・親・祖父母だけを見る）
    if (d.id === member) continue;
    // 判定の時: 本人の判定の時より前に亡くなった親族は死亡の時
    const dd = deathMonthIn(ctx, d.id, year);
    const j = dd !== null && dd < own ? dd : own;
    if (!present(d, j)) continue;
    if (ctx.time.ageSwitch(d.id, { years: years as number }, sel.def.ageSwitch as never) <= j) continue;
    if (isOutside(d) && (d.support?.dependent !== true || !outsideChildSupported(ctx, d, j))) continue;
    const isChild = d.kind === "child";
    const isElder = (d.kind === "parent" || d.kind === "grandparent" || (isOutside(d) && d.kind !== "child")) && d.support?.dependent === true;
    if (!isChild && !isElder) continue;
    // 扶養親族の合計所得金額（所得税: 退職所得・分離課税の譲渡所得を含む）。子の構成員はこの部品で調整控除を受けないので、分ける前の部品の値と同じ
    const inc = ctx.call<TotalIncomeOutput>("tax.totalIncomeBase", { member: d.id, year });
    if (inc.total + (inc.retirement ?? 0) + (inc.separate ?? 0) <= limit) return true;
  }
  return false;
}

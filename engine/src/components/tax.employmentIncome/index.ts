// 給与所得＝給与収入−給与所得控除額（所得税法28条。住民税も同じ年分の計算による）
// revenue を渡すと、その給与収入で計算する（年の途中で辞めた年の源泉徴収の近似に使う）
// 改訂5（0044）: 入るお金の行のうち課税の扱いが給与の行（社会保険なし）の収入を、その年の給与収入に足す（revenue を渡したときは足さない）
// 給与収入が別表第五の範囲（660万円未満）のときは、表（別表第五。令和8年分・令和9年分は措置法29条の4第2項の表を含む）の区分の下限に
// 収入金額を切り下げてから計算する。区分の幅は制度データ（incomeTax.employmentIncome.tableSteps）の段ごとの幅で、控除額が定額の段にも
// かかる（例: 令和10年分の202.6万〜203.3万円、令和8年分の219.1万〜220万円）
import {
  bracketFor,
  defineComponent,
  monthIndex,
  RATE_ZERO,
  subYen,
  yen,
  type Bracket,
  type Ctx,
  type EmploymentIncomeOutput,
  type IncomeFlowsOutput,
  type SalaryOutput,
  type Yen,
} from "../../sdk/index.ts";

const TABLE = "incomeTax.employmentIncomeDeduction";
const TABLE_BELOW = "incomeTax.employmentIncome.tableBelow";
const TABLE_STEPS = "incomeTax.employmentIncome.tableSteps";

function deductionOf(ctx: Ctx, b: Bracket, revenue: Yen): Yen {
  // 控除額＝収入×率＋加算額（率の無い段は定額）
  const variable = b.rate === undefined || ctx.rate.compare(b.rate, RATE_ZERO) === 0 ? yen(0) : ctx.money.mulRate(revenue, b.rate, "conv.tax.fractionalDeduction");
  return yen(variable + (b.amount ?? 0));
}

/** 収入金額を含む表の区分の下限（段の下限から、段の幅ずつの区分）。幅 1 は刻みなし */
function tableLower(ctx: Ctx, steps: readonly Bracket[], revenue: Yen): Yen {
  let lower = yen(0);
  for (const s of steps) {
    if (s.upTo === null || revenue <= s.upTo) {
      const width = s.amount ?? yen(1);
      if (width <= 1) return revenue;
      const n = ctx.money.mulRatio(subYen(revenue, lower), 1, width, "conv.tax.tableStep");
      return yen(lower + ctx.money.mulRatio(n, width, 1, "conv.exact"));
    }
    lower = yen(s.upTo + 1);
  }
  return revenue;
}

export default defineComponent<{ member: string; year: number; revenue?: number }, EmploymentIncomeOutput>({
  id: "tax.employmentIncome",
  title: "給与所得",
  contract: "1.1",
  revision: 5,
  requires: { "income.salary": ">=1 <2", "income.flows": ">=1 <2" },
  params: [TABLE, TABLE_BELOW, TABLE_STEPS],
  reads: [],
  input: "tax.employmentIncome.input",
  output: "tax.employmentIncome.output",
  compute(input, ctx) {
    let revenue = yen(0);
    if (input.revenue !== undefined) revenue = yen(input.revenue);
    else {
      // その年の支払いだけを読む
      const payments = ctx.callMonths<SalaryOutput["payments"][number]>("income.salary", { member: input.member }, "payments", monthIndex(input.year, 1), monthIndex(input.year, 12));
      for (const p of payments) revenue = yen(revenue + p.salary + p.bonus);
      const flow = ctx.call<IncomeFlowsOutput>("income.flows", {}).byMember.find((r) => r.member === input.member && r.year === input.year);
      if (flow !== undefined) revenue = yen(revenue + flow.salary);
    }
    if (revenue === 0) return { revenue, deduction: yen(0), income: yen(0) };
    const at = ctx.at(monthIndex(input.year, 1));
    const table = at.paramBrackets(TABLE) ?? [];
    let base = revenue;
    const below = at.paramYen(TABLE_BELOW);
    if (below !== null && revenue < below) base = tableLower(ctx, at.paramBrackets(TABLE_STEPS) ?? [], revenue);
    const b = bracketFor(table, base);
    const deduction = deductionOf(ctx, b, base);
    const income = deduction >= base ? yen(0) : subYen(base, deduction);
    return { revenue, deduction: subYen(revenue, income), income };
  },
});

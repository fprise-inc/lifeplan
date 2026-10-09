// 合計所得金額＝給与所得（所得金額調整控除の後）＋公的年金等に係る雑所得＋その他の所得（事業所得）。
// 所得の区分は給与・公的年金等・その他（0008 の追記）。給与と公的年金等の両方があるときは、
// 給与所得（10万円まで）＋公的年金等に係る雑所得（10万円まで）−10万円 を給与所得から引く（所得金額調整控除）
// 約束の版 1.2: 分離課税の退職所得の金額（retirement。tax.retirementIncome）を任意の欄で添える。total（総所得金額等）には入れない。
// 所得税の合計所得金額（基礎控除の段・配偶者控除・扶養控除の所得の要件）を判定する部品が total に足して使う
// 約束の版 1.3: 保険の一時所得（満期金・解約返戻金・契約者が受け取る死亡保険金。特別控除の後の2分の1）と個人年金の雑所得
// （insurance.income）を total に入れ、temporary・miscellaneous の任意の欄で添える
import {
  defineComponent,
  monthIndex,
  yen,
  type BusinessOutput,
  type EmploymentIncomeOutput,
  type InsuranceIncomeOutput,
  type PublicPensionIncomeOutput,
  type RetirementIncomeOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const ADJUST = "incomeTax.incomeAdjustment.salaryAndPension.limit";

export default defineComponent<{ member: string; year: number }, TotalIncomeOutput>({
  id: "tax.totalIncome",
  title: "合計所得金額",
  contract: "1.3",
  revision: 4,
  requires: {
    "tax.employmentIncome": ">=1 <2",
    "tax.publicPensionIncome": ">=1 <2",
    "income.business": ">=1 <2",
    "tax.retirementIncome": ">=1 <2",
    "insurance.income": ">=1 <2",
  },
  params: [ADJUST],
  reads: [],
  input: "tax.memberYear.input",
  output: "tax.totalIncome.output",
  compute(input, ctx) {
    const e = ctx.call<EmploymentIncomeOutput>("tax.employmentIncome", input);
    const p = ctx.call<PublicPensionIncomeOutput>("tax.publicPensionIncome", input);
    const other = ctx.call<BusinessOutput>("income.business", { member: input.member }).byYear.find((b) => b.year === input.year)?.income ?? yen(0);
    let employment = e.income;
    let adjustment = yen(0);
    if (employment > 0 && p.income > 0) {
      const limit = ctx.at(monthIndex(input.year, 1)).paramYen(ADJUST);
      if (limit !== null) {
        const v = Math.min(employment, limit) + Math.min(p.income, limit) - limit;
        if (v > 0) {
          adjustment = yen(v);
          employment = yen(employment - adjustment);
        }
      }
    }
    const ins = ctx.call<InsuranceIncomeOutput>("insurance.income", input);
    const total: Yen = yen(employment + p.income + other + ins.temporaryIncluded + ins.miscellaneous);
    const retirement = ctx.call<RetirementIncomeOutput>("tax.retirementIncome", { member: input.member, year: input.year }).income;
    return {
      total,
      employment,
      publicPension: p.income,
      other,
      adjustment,
      ...(retirement > 0 ? { retirement } : {}),
      ...(ins.temporaryIncluded > 0 ? { temporary: ins.temporaryIncluded } : {}),
      ...(ins.miscellaneous > 0 ? { miscellaneous: ins.miscellaneous } : {}),
    };
  },
});

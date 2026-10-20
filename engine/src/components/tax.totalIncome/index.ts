// 合計所得金額＝給与所得（所得金額調整控除の後）＋公的年金等に係る雑所得＋その他の所得（事業所得）。
// 所得の区分は給与・公的年金等・その他（0008 の追記）。給与と公的年金等の両方があるときは、
// 給与所得（10万円まで）＋公的年金等に係る雑所得（10万円まで）−10万円 を給与所得から引く（所得金額調整控除）
// 約束の版 1.2: 分離課税の退職所得の金額（retirement。tax.retirementIncome）を任意の欄で添える。total（総所得金額等）には入れない。
// 所得税の合計所得金額（基礎控除の段・配偶者控除・扶養控除の所得の要件）を判定する部品が total に足して使う
// 約束の版 1.3: 保険の一時所得（満期金・解約返戻金・契約者が受け取る死亡保険金。特別控除の後の2分の1）と個人年金の雑所得
// （insurance.income）を total に入れ、temporary・miscellaneous の任意の欄で添える
// 約束の版 1.4: 不動産所得（住まい以外の不動産を貸している年。asset.realEstate。名義の人の物件の合計）を total に入れ、realEstate の任意の欄で添える。
// 損失（マイナス）はほかの所得から引く（損益通算）。ただし損失のうち土地の取得のための借入の利息の分は引けない（その分だけ損失を小さくする）。
// 引ききれない損失の繰り越し（青色申告）は扱わず、total は0より下げない（0028）
import {
  defineComponent,
  monthIndex,
  yen,
  type BusinessOutput,
  type EmploymentIncomeOutput,
  type InsuranceIncomeOutput,
  type PublicPensionIncomeOutput,
  type RealEstateOutput,
  type RetirementIncomeOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const ADJUST = "incomeTax.incomeAdjustment.salaryAndPension.limit";

export default defineComponent<{ member: string; year: number }, TotalIncomeOutput>({
  id: "tax.totalIncome",
  title: "合計所得金額",
  contract: "1.4",
  revision: 5,
  requires: {
    "tax.employmentIncome": ">=1 <2",
    "tax.publicPensionIncome": ">=1 <2",
    "income.business": ">=1 <2",
    "tax.retirementIncome": ">=1 <2",
    "insurance.income": ">=1 <2",
    "asset.realEstate": ">=1 <2",
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
    // 不動産所得（名義の人の物件の合計）。損失は土地の取得のための借入の利息の分を除いて引く
    let realEstate: Yen | null = null;
    let landInterest = 0;
    for (const prop of ctx.call<RealEstateOutput>("asset.realEstate", {}).properties) {
      if (prop.owner !== input.member) continue;
      const e = prop.income.find((x) => x.year === input.year);
      if (e === undefined) continue;
      realEstate = yen((realEstate ?? 0) + e.income);
      landInterest += e.landInterest;
    }
    if (realEstate !== null && realEstate < 0) realEstate = yen(Math.min(0, realEstate + landInterest));
    const total: Yen = yen(Math.max(0, employment + p.income + other + (realEstate ?? 0) + ins.temporaryIncluded + ins.miscellaneous));
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
      ...(realEstate !== null ? { realEstate } : {}),
    };
  },
});

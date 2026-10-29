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
// 約束の版 1.5（0044）: 入るお金の行（income.flows）の所得を足す。事業所得は other に、雑所得（業務・その他）は miscellaneous に、
// 一時所得は保険の一時所得と合わせて特別控除（50万円まで）を引いた2分の1を temporary に（どれも total に入る）。給与の収入は
// tax.employmentIncome が給与所得にする。分離課税の譲渡所得は separate で添え、total には入れない（合計所得金額の判定で足す）
// 約束の版 1.6（改訂7。0081。税と出口）: どれも、青色申告・民泊・宿・売却の予定の無い人の結果は同じ
// - 土地建物等の譲渡所得（tax.realEstateSale の短期・長期。特別控除の前）を separate に足し、landBuilding で添える（合計所得金額に入る。
//   租税特別措置法31条3項1号。所得税法2条1項30号の合計所得金額に長期譲渡所得の金額を含める読み替え）。ほかの所得の損失はこれから引かない
// - 民泊・宿の所得（asset.realEstate の incomeKind）: 雑所得は雑所得（公的年金等の雑所得と差し引き、雑所得の中の損失はほかの所得と通算しない）、
//   事業所得は事業所得（損失は通算する）に入れる。土地の取得のための借入の利息の制限（措置法41条の4）は不動産所得だけ
// - 青色申告特別控除（members[].taxReturn が青色）: 55万円・65万円（doubleEntry・electronic）は、不動産所得が事業的規模（その年に貸している
//   不動産所得の物件の室数＋棟数×2 が10以上。5棟10室の目安）か事業所得があるときだけ。当たらなければ10万円で計算する（知らせ
//   N_LIMIT_APPLIED taxReturn.blueDeduction）。控除の上限は不動産所得と事業所得の黒字の合計（損益通算の前）で、不動産所得・事業所得の順に引く
//   （措置法25条の2）。事業的規模の年は、個人事業税を計算しない知らせ（N_NOT_SUPPORTED realEstate.businessTax）
// - 損益通算をしても引ききれない損失を netLoss で添える（total は0。青色なら tax.lossCarryforward が翌年以後3年繰り越す）
// 約束の版 1.7（改訂8。0086。雑所得の区分）: 入るお金の行・保険・民泊・宿の雑所得に赤字の行が無い人の結果は同じ
// - 公的年金等以外の雑所得は1つの区分: 入るお金の行の雑所得（業務・その他。income.flows の miscellaneousNet）・保険の雑所得（個人年金・
//   収入保障の月額。insurance.income の miscellaneousNet）・民泊・宿の雑所得を、赤字も含めて差し引く（所得税法35条2項2号）。
//   合わせて赤字なら公的年金等の雑所得から引き（同項。雑所得の金額は1号と2号の合計）、引ききれない分はほかの所得と通算しない（69条1項は
//   不動産・事業・山林・譲渡の損失だけ）。捨てた額を miscellaneousLoss で添え、知らせ N_LIMIT_APPLIED（income.miscellaneousLoss）を出す
// - 入るお金の行の事業所得は赤字のまま事業所得に足す（income.flows の businessNet）。赤字はほかの所得と通算し、青色なら純損失を繰り越す
import {
  defineComponent,
  monthIndex,
  yen,
  type BusinessOutput,
  type EmploymentIncomeOutput,
  type IncomeFlowsOutput,
  type InsuranceIncomeOutput,
  type MemberInput,
  type PublicPensionIncomeOutput,
  type RealEstateOutput,
  type RealEstateSaleTaxOutput,
  type RetirementIncomeOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const ADJUST = "incomeTax.incomeAdjustment.salaryAndPension.limit";
const TEMP = { special: "incomeTax.temporaryIncome.specialDeduction", ratio: "incomeTax.temporaryIncome.taxableRatio" };
const BLUE = { electronic: "incomeTax.blueReturnDeduction.electronic", doubleEntry: "incomeTax.blueReturnDeduction.doubleEntry", simple: "incomeTax.blueReturnDeduction.simple" } as const;
/** 事業的規模の目安（所得税基本通達26-9。国税庁 No.1373: 独立した室数がおおむね10室以上、独立家屋はおおむね5棟以上。1棟を2室とみなして合わせる） */
export const BUSINESS_SCALE_ROOMS = 10;
export const ROOMS_PER_HOUSE = 2;

export default defineComponent<{ member: string; year: number }, TotalIncomeOutput>({
  id: "tax.totalIncome",
  title: "合計所得金額",
  contract: "1.7",
  revision: 8,
  requires: {
    "tax.employmentIncome": ">=1 <2",
    "tax.publicPensionIncome": ">=1 <2",
    "income.business": ">=1 <2",
    "tax.retirementIncome": ">=1 <2",
    "insurance.income": ">=1 <2",
    "asset.realEstate": ">=1 <2",
    "income.flows": ">=1 <2",
    "tax.realEstateSale": ">=1 <2",
  },
  params: [ADJUST, ...Object.values(TEMP), ...Object.values(BLUE)],
  reads: ["member.taxReturn"],
  input: "tax.memberYear.input",
  output: "tax.totalIncome.output",
  compute(input, ctx) {
    const e = ctx.call<EmploymentIncomeOutput>("tax.employmentIncome", input);
    const p = ctx.call<PublicPensionIncomeOutput>("tax.publicPensionIncome", input);
    const flowRow = ctx.call<IncomeFlowsOutput>("income.flows", {}).byMember.find((r) => r.member === input.member && r.year === input.year);
    const bizRow = ctx.call<BusinessOutput>("income.business", { member: input.member }).byYear.find((b) => b.year === input.year);
    // 入るお金の行の事業所得は赤字のまま（ほかの所得と通算する）
    let other = yen((bizRow?.income ?? 0) + (flowRow?.businessNet ?? flowRow?.business ?? 0));
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
    // 一時所得: 入るお金の行の一時所得があれば、保険の一時所得と合わせて特別控除を引き、2分の1を入れる
    let temporary = ins.temporaryIncluded;
    if (flowRow !== undefined && flowRow.temporary > 0) {
      const at = ctx.at(monthIndex(input.year, 1));
      const gross = (ins.temporaryGross ?? 0) + flowRow.temporary;
      const special = at.paramYen(TEMP.special) ?? yen(0);
      const t = yen(gross > special ? gross - special : 0);
      temporary = at.money.mulRate(t, at.paramRate(TEMP.ratio) ?? ctx.rate.of("1"), "conv.tax.exact");
    }
    // 公的年金等以外の雑所得（入るお金の行と保険。赤字も含めて差し引く。民泊・宿の雑所得は下で足す）
    const flowMisc = flowRow === undefined ? 0 : (flowRow.miscellaneousNet ?? flowRow.miscBusiness + flowRow.miscOther);
    let miscNet = (ins.miscellaneousNet ?? ins.miscellaneous) + flowMisc;
    // 土地建物等の譲渡所得（分離課税。特別控除の前）
    const sale = ctx.call<RealEstateSaleTaxOutput>("tax.realEstateSale", {}).byMember.find((r) => r.member === input.member && r.year === input.year);
    const landBuilding = sale !== undefined && sale.short + sale.long > 0 ? { short: sale.short, long: sale.long } : null;
    const separate = yen((flowRow?.capitalGains ?? 0) + (landBuilding === null ? 0 : landBuilding.short + landBuilding.long));
    // 不動産所得（名義の人の物件の合計）と、民泊・宿の雑所得・事業所得。事業的規模の目安の室数・棟数
    let realEstate: Yen | null = null;
    let landInterest = 0;
    let lodgingMisc: number | null = null;
    let lodgingBusiness: number | null = null;
    let rooms = 0;
    let houses = 0;
    for (const prop of ctx.call<RealEstateOutput>("asset.realEstate", {}).properties) {
      if (prop.owner !== input.member) continue;
      const e = prop.income.find((x) => x.year === input.year);
      if (e === undefined) continue;
      if (prop.incomeKind === "miscellaneous") lodgingMisc = (lodgingMisc ?? 0) + e.income;
      else if (prop.incomeKind === "business") lodgingBusiness = (lodgingBusiness ?? 0) + e.income;
      else {
        realEstate = yen((realEstate ?? 0) + e.income);
        landInterest += e.landInterest;
        rooms += prop.units?.rooms ?? 0;
        houses += prop.units?.houses ?? 0;
      }
    }
    // 事業所得（自営・入るお金の行の事業所得と、民泊・宿の事業所得）。損失はほかの所得と通算する
    const business = (other as number) + (lodgingBusiness ?? 0);
    const scale = realEstate !== null && rooms + houses * ROOMS_PER_HOUSE >= BUSINESS_SCALE_ROOMS;
    if (scale) ctx.notice("N_NOT_SUPPORTED", ["realEstate.businessTax"]);
    // 青色申告特別控除（不動産所得・事業所得の黒字から、不動産所得・事業所得の順に引く）
    let blueDeduction = 0;
    const filing = ctx.list<MemberInput>("member").find((m) => m.id === input.member)?.taxReturn;
    let re = realEstate as number | null;
    let biz = business;
    if (filing?.method === "blue" && ((re ?? 0) > 0 || biz > 0)) {
      const hasBusiness = bizRow !== undefined || flowRow?.businessNet !== undefined || lodgingBusiness !== null;
      let kind = filing.blueDeduction ?? "simple";
      if (kind !== "simple" && !scale && !hasBusiness) {
        ctx.notice("N_LIMIT_APPLIED", [input.member, "taxReturn.blueDeduction"]);
        kind = "simple";
      }
      const amount = ctx.at(monthIndex(input.year, 1)).paramYen(BLUE[kind]);
      if (amount === null) ctx.notice("N_PARAM_MISSING", [BLUE[kind]]);
      let left = amount ?? 0;
      if (re !== null && re > 0) {
        const d = Math.min(left, re);
        re -= d;
        left -= d;
        blueDeduction += d;
      }
      if (biz > 0 && left > 0) {
        const d = Math.min(left, biz);
        biz -= d;
        blueDeduction += d;
      }
    }
    realEstate = re === null ? null : yen(re);
    if (realEstate !== null && realEstate < 0) realEstate = yen(Math.min(0, realEstate + landInterest));
    other = yen(Math.max(0, biz));
    // 雑所得（公的年金等の雑所得と、そのほかの雑所得の合計）。公的年金等以外の雑所得の赤字は公的年金等の雑所得から引き、
    // 引ききれない分はほかの所得とは通算しない（0円として捨てる）
    miscNet += lodgingMisc ?? 0;
    let pensionPart = p.income as number;
    let miscellaneous = yen(0);
    let miscellaneousLoss = 0;
    if (miscNet >= 0) miscellaneous = yen(miscNet);
    else {
      const used = Math.min(pensionPart, -miscNet);
      pensionPart -= used;
      miscellaneousLoss = -miscNet - used;
      if (miscellaneousLoss > 0) ctx.notice("N_LIMIT_APPLIED", [input.member, "income.miscellaneousLoss"]);
    }
    const before = employment + pensionPart + biz + (realEstate ?? 0) + temporary + miscellaneous;
    const total: Yen = yen(Math.max(0, before));
    const netLoss = before < 0 ? yen(-before) : null;
    const retirement = ctx.call<RetirementIncomeOutput>("tax.retirementIncome", { member: input.member, year: input.year }).income;
    return {
      total,
      employment,
      publicPension: p.income,
      other,
      adjustment,
      ...(retirement > 0 ? { retirement } : {}),
      ...(temporary > 0 ? { temporary } : {}),
      ...(miscellaneous > 0 ? { miscellaneous } : {}),
      ...(realEstate !== null ? { realEstate } : {}),
      ...(separate > 0 ? { separate } : {}),
      ...(landBuilding !== null ? { landBuilding } : {}),
      ...(blueDeduction > 0 ? { blueDeduction: yen(blueDeduction) } : {}),
      ...(netLoss !== null ? { netLoss } : {}),
      ...(lodgingMisc !== null || lodgingBusiness !== null ? { lodging: { miscellaneous: yen(lodgingMisc ?? 0), business: yen(lodgingBusiness ?? 0) } } : {}),
      ...(miscellaneousLoss > 0 ? { miscellaneousLoss: yen(miscellaneousLoss) } : {}),
    };
  },
});

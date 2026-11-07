// 所得控除（所得税・住民税）。その年の12月31日の現況で判定する
// 基礎控除・配偶者控除・配偶者特別控除・扶養控除・特定親族特別控除・社会保険料控除・生命保険料控除・地震保険料控除・小規模企業共済等掛金控除
// （iDeCo の掛金と企業型DCの加入者掛金。拠出限度額で止めた後の額を ideco.contribution から、その年の分だけ読む）。
// 配偶者控除・配偶者特別控除（tax.spouseDeduction）と扶養控除・特定親族特別控除（tax.dependentDeduction）は、他の構成員の所得で決まるので
// 小さな部品に分けている（配偶者の所得が変わっても控除の額が同じなら、ここから先を計算し直さない。0006 の追記）
// ひとり親控除・寡婦控除（改訂7。約束の版 1.1 の任意の欄）: tax.survivorStatus で判定する（離婚・未婚・死別のひとり親と寡婦。万一の想定の死別でも
// 自動で切り替わる。0156）。
// 住民税の調整控除の人的控除額の差は、寡婦1万円・ひとり親（母）5万円・ひとり親（父）1万円（制度データ）
// 改訂（0044）: 合計所得金額の判定に、分離課税の譲渡所得（tax.totalIncome の separate。入るお金の行）も足す
import {
  bracketFor,
  defineComponent,
  monthIndex,
  RATE_ZERO,
  sumYen,
  yen,
  type Bracket,
  type Ctx,
  type DeductionsOutput,
  type InsuranceContractInput,
  type DependentDeductionOutput,
  type IdecoPayment,
  type MonthCtx,
  type PaymentsOutput,
  type SpouseDeductionOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

type Regime = "incomeTax" | "residentTax";
const LIFE_TYPES = ["general", "careMedical", "pension"] as const;

const ids = (p: Regime) => ({
  basic: `${p}.basicDeduction`,
  lifeNew: `${p}.lifeInsuranceDeduction.new`,
  lifeOld: `${p}.lifeInsuranceDeduction.old`,
  lifeMixedLimit: `${p}.lifeInsuranceDeduction.mixedLimit`,
  lifeTotalLimit: `${p}.lifeInsuranceDeduction.totalLimit`,
  quake: `${p}.earthquakeDeduction.earthquake`,
  quakeLongTerm: `${p}.earthquakeDeduction.longTerm`,
  quakeTotalLimit: `${p}.earthquakeDeduction.totalLimit`,
  widow: `${p}.widowDeduction`,
  singleParent: `${p}.singleParentDeduction`,
});

const IDS = { incomeTax: ids("incomeTax"), residentTax: ids("residentTax") } as const;

const LIFE_YOUNG = "incomeTax.lifeInsuranceDeduction.newGeneralWithYoungDependent";
const LIFE_YOUNG_LIMIT = "incomeTax.lifeInsuranceDeduction.mixedLimitWithYoungDependent";
const DIFF_BASIC = "residentTax.adjustmentCredit.diff.basic";
const DIFF_WIDOW = "residentTax.adjustmentCredit.diff.widow";
const DIFF_PARENT_MOTHER = "residentTax.adjustmentCredit.diff.singleParentMother";
const DIFF_PARENT_FATHER = "residentTax.adjustmentCredit.diff.singleParentFather";

const ALL_PARAMS = [
  ...(["incomeTax", "residentTax"] as const).flatMap((p) => Object.values(ids(p))),
  LIFE_YOUNG,
  LIFE_YOUNG_LIMIT,
  DIFF_BASIC,
  DIFF_WIDOW,
  DIFF_PARENT_MOTHER,
  DIFF_PARENT_FATHER,
  "incomeTax.insuranceDeduction.rounding",
];

const amountIn = (b: readonly Bracket[] | null, x: Yen): Yen => (b === null ? yen(0) : (bracketFor(b, x).amount ?? yen(0)));

/** 段階表の「x×率＋額」（保険料控除の式） */
function formulaIn(ctx: Ctx, at: MonthCtx, table: readonly Bracket[] | null, x: Yen, rounding: string): Yen {
  if (table === null || x <= 0) return yen(0);
  const b = bracketFor(table, x);
  const v = b.rate === undefined || ctx.rate.compare(b.rate, RATE_ZERO) === 0 ? yen(0) : at.money.mulRate(x, b.rate, rounding);
  return yen(v + (b.amount ?? 0));
}

export default defineComponent<{ member: string; year: number; regime: Regime }, DeductionsOutput>({
  id: "tax.deductions",
  title: "所得控除",
  contract: "1.1",
  revision: 8,
  requires: {
    "tax.survivorStatus": ">=1 <2",
    "account.mutualAid": ">=1 <2",
    "tax.totalIncome": ">=1 <2",
    "tax.spouseDeduction": ">=1 <2",
    "tax.dependentDeduction": ">=1 <2",
    "tax.socialInsurancePaid": ">=1 <2",
    "insurance.premiumPayment": ">=1 <2",
    "account.dcList": ">=1 <2",
    "ideco.contribution": ">=1 <2",
  },
  params: ALL_PARAMS,
  reads: ["insurance.policyholder", "insurance.deductionCategory", "member.sex"],
  input: "tax.deductions.input",
  output: "tax.deductions.output",
  compute(input, ctx) {
    const { member, year, regime } = input;
    const P = IDS[regime];
    const resident = regime === "residentTax";
    // 所得税はその年分の値、住民税は翌年度（6月から）の値。判定はどちらもその年の12月31日の現況
    const at = ctx.at(resident ? monthIndex(year + 1, 6) : monthIndex(year, 1));
    // 合計所得金額（所得税は分離課税の退職所得の金額を含む）
    const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year });
    const own = yen((resident ? inc.total : inc.total + (inc.retirement ?? 0)) + (inc.separate ?? 0));
    const diffs: Yen[] = [];
    const diff = (id: string) => {
      if (resident) diffs.push(at.paramYen(id) ?? yen(0));
    };

    // 基礎控除（合計所得金額の段階）
    const basic = amountIn(at.paramBrackets(P.basic), own);
    if (basic > 0) diff(DIFF_BASIC);

    // 配偶者控除・配偶者特別控除、扶養控除・特定親族特別控除（他の構成員の所得で決まる部分は小さな部品で判定する。0006 の追記）
    const sp = ctx.call<SpouseDeductionOutput>("tax.spouseDeduction", { member, year, regime });
    const dep = ctx.call<DependentDeductionOutput>("tax.dependentDeduction", { member, year, regime });
    const spouse = sp.spouse;
    const spouseSpecial = sp.spouseSpecial;
    const dependents = dep.dependents;
    const specifiedRelative = dep.specifiedRelative;
    const youngDependent = dep.youngDependent;
    diffs.push(sp.personalDiff, dep.personalDiff);

    // 社会保険料控除: その年に本人が払った保険料（所得税・住民税で同じなので、構成員×年で1回だけ集める）
    const socialInsurance = ctx.call<{ amount: Yen }>("tax.socialInsurancePaid", { member, year }).amount;
    const yearPrefix = `${year}-`;

    // 生命保険料控除・地震保険料控除: 契約者が本人の契約の、その年に払った保険料
    const rounding = resident ? "conv.tax.fractionalDeduction" : "incomeTax.insuranceDeduction.rounding";
    const premiums = ctx.call<PaymentsOutput>("insurance.premiumPayment", {}).payments.filter(
      (p) => p.member === member && p.ym.startsWith(yearPrefix),
    );
    const contracts = ctx.list<InsuranceContractInput>("insurance");
    const paid = (type: string, regimeOf?: "new" | "old") => {
      const xs = premiums.filter((p) => {
        const c = contracts.find((k) => k.id === p.object);
        return c !== undefined && c.deductionCategory.type === type && (regimeOf === undefined || c.deductionCategory.regime === regimeOf);
      });
      return sumYen(xs.map((p) => p.amount));
    };
    let life = yen(0);
    for (const t of LIFE_TYPES) {
      const n = paid(t, "new");
      const o = paid(t, "old");
      if (n <= 0 && o <= 0) continue;
      // 令和8年分からの特例: 23歳未満の扶養親族がいれば、新契約の一般生命保険料の控除の上限が上がる
      const young = !resident && t === "general" && youngDependent ? at.paramBrackets(LIFE_YOUNG) : null;
      const nd = formulaIn(ctx, at, young ?? at.paramBrackets(P.lifeNew), n, rounding);
      const od = formulaIn(ctx, at, at.paramBrackets(P.lifeOld), o, rounding);
      let v = n > 0 ? nd : od;
      if (n > 0 && o > 0) {
        const cap = (young !== null ? at.paramYen(LIFE_YOUNG_LIMIT) : null) ?? at.paramYen(P.lifeMixedLimit) ?? yen(0);
        const both = yen(nd + od) < cap ? yen(nd + od) : cap;
        v = od > both ? od : both;
      }
      life = yen(life + v);
    }
    if (life > 0) {
      const cap = at.paramYen(P.lifeTotalLimit);
      if (cap !== null && life > cap) life = cap;
    }
    let earthquake = yen(0);
    const eq = paid("earthquake");
    const lt = paid("longTermNonLife");
    if (eq > 0 || lt > 0) {
      earthquake = yen(formulaIn(ctx, at, at.paramBrackets(P.quake), eq, rounding) + formulaIn(ctx, at, at.paramBrackets(P.quakeLongTerm), lt, rounding));
      const cap = at.paramYen(P.quakeTotalLimit);
      if (cap !== null && earthquake > cap) earthquake = cap;
    }

    // 小規模企業共済等掛金控除: 本人が払った iDeCo の掛金と企業型DCの加入者掛金（全額。その年の支払いだけを読む）
    let smallBusiness = yen(0);
    const hasDc = ctx.call<{ ids: string[] }>("account.dcList", { member }).ids.length > 0;
    if (hasDc) for (const p of ctx.callMonths<IdecoPayment>("ideco.contribution", { member }, "payments", monthIndex(year, 1), monthIndex(year, 12))) {
      if (p.payer === "self") smallBusiness = yen(smallBusiness + p.amount);
    }
    // 小規模企業共済の掛金（全額。その年に払った分）
    for (const p of ctx.callMonths<{ ym: string; amount: Yen }>("account.mutualAid", { member }, "paid", monthIndex(year, 1), monthIndex(year, 12))) smallBusiness = yen(smallBusiness + p.amount);

    // ひとり親控除・寡婦控除（tax.survivorStatus の判定。0156）
    const sv = ctx.call<{ widow: boolean; singleParent: boolean }>("tax.survivorStatus", { member, year });
    let widow = yen(0);
    let singleParent = yen(0);
    if (sv.singleParent) {
      singleParent = at.paramYen(P.singleParent) ?? yen(0);
      if (singleParent > 0) diff(ctx.get<{ sex: string }>("member", member).sex === "female" ? DIFF_PARENT_MOTHER : DIFF_PARENT_FATHER);
    } else if (sv.widow) {
      widow = at.paramYen(P.widow) ?? yen(0);
      if (widow > 0) diff(DIFF_WIDOW);
    }

    const total = sumYen([basic, spouse, spouseSpecial, dependents, specifiedRelative, socialInsurance, life, earthquake, smallBusiness, widow, singleParent]);
    return {
      basic,
      spouse,
      spouseSpecial,
      dependents,
      specifiedRelative,
      socialInsurance,
      lifeInsurance: life,
      earthquake,
      smallBusiness,
      ...(widow > 0 ? { widow } : {}),
      ...(singleParent > 0 ? { singleParent } : {}),
      total,
      personalDiff: sumYen(diffs),
    };
  },
});

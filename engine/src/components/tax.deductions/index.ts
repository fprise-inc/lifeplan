// 所得控除（所得税・住民税）。その年の12月31日の現況で判定する
// 基礎控除・配偶者控除・配偶者特別控除・扶養控除・特定親族特別控除・社会保険料控除・生命保険料控除・地震保険料控除・小規模企業共済等掛金控除。
// 配偶者控除・配偶者特別控除（tax.spouseDeduction）と扶養控除・特定親族特別控除（tax.dependentDeduction）は、他の構成員の所得で決まるので
// 小さな部品に分けている（配偶者の所得が変わっても控除の額が同じなら、ここから先を計算し直さない。0006 の追記）
import {
  amountInYear,
  bracketFor,
  defineComponent,
  monthIndex,
  RATE_ZERO,
  sumYen,
  yearOf,
  yen,
  type Bracket,
  type Ctx,
  type DeductionsOutput,
  type FlowsResult,
  type InsuranceContractInput,
  type DependentDeductionOutput,
  type MonthCtx,
  type PaymentsOutput,
  type PremiumOutput,
  type SpouseDeductionOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

type Regime = "incomeTax" | "residentTax";
const SI_COMPONENTS = ["socialInsurance.health", "socialInsurance.pension", "socialInsurance.employment"] as const;
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
});

const IDS = { incomeTax: ids("incomeTax"), residentTax: ids("residentTax") } as const;

const LIFE_YOUNG = "incomeTax.lifeInsuranceDeduction.newGeneralWithYoungDependent";
const LIFE_YOUNG_LIMIT = "incomeTax.lifeInsuranceDeduction.mixedLimitWithYoungDependent";
const DIFF_BASIC = "residentTax.adjustmentCredit.diff.basic";

const ALL_PARAMS = [
  ...(["incomeTax", "residentTax"] as const).flatMap((p) => Object.values(ids(p))),
  LIFE_YOUNG,
  LIFE_YOUNG_LIMIT,
  DIFF_BASIC,
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
  contract: "1.0",
  revision: 4,
  requires: {
    "tax.totalIncome": ">=1 <2",
    "tax.spouseDeduction": ">=1 <2",
    "tax.dependentDeduction": ">=1 <2",
    "socialInsurance.health": ">=1 <2",
    "socialInsurance.pension": ">=1 <2",
    "socialInsurance.employment": ">=1 <2",
    "insurance.premiumPayment": ">=1 <2",
    "account.contribution": ">=1 <2",
    "socialInsurance.nationalPension": ">=1 <2",
    "socialInsurance.nationalHealth": ">=1 <2",
    "socialInsurance.lateElderly": ">=1 <2",
    "socialInsurance.careFirst": ">=1 <2",
  },
  params: ALL_PARAMS,
  reads: [
    "insurance.policyholder",
    "insurance.deductionCategory",
    "account.kind",
    "account.owner",
  ],
  input: "tax.deductions.input",
  output: "tax.deductions.output",
  compute(input, ctx) {
    const { member, year, regime } = input;
    const P = IDS[regime];
    const resident = regime === "residentTax";
    // 所得税はその年分の値、住民税は翌年度（6月から）の値。判定はどちらもその年の12月31日の現況
    const at = ctx.at(resident ? monthIndex(year + 1, 6) : monthIndex(year, 1));
    const baseYear = yearOf(ctx.time.base);
    const own = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year }).total;
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

    // 社会保険料控除: その年に本人が払った保険料（給与から控除された被用者保険・国民年金・後期高齢者医療・介護保険（第1号）、
    // 世帯主として払う国民健康保険）
    const fromYear = year < baseYear ? year : baseYear;
    let socialInsurance = yen(0);
    const yearPrefix = `${year}-`;
    const addPaid = (flows: readonly { ym: string; amount: number; member?: string }[]) => {
      for (const f of flows) if (f.ym.startsWith(yearPrefix) && (f.member === undefined || f.member === member)) socialInsurance = yen(socialInsurance + f.amount);
    };
    // 被用者保険・国民年金は、部品が添える暦年ごとの合計を引く（無い古い約束の版の差し替えなら flows から数える）
    const addPremium = (out: PremiumOutput) => {
      if (out.paidByYear === undefined) addPaid(out.flows);
      else socialInsurance = yen(socialInsurance + amountInYear(out.paidByYear, year));
    };
    for (const c of SI_COMPONENTS) addPremium(ctx.call<PremiumOutput>(c, { member, fromYear }));
    addPremium(ctx.call<PremiumOutput>("socialInsurance.nationalPension", { member, fromYear }));
    for (const fy of [year - 1, year]) {
      addPaid(ctx.call<FlowsResult>("socialInsurance.lateElderly", { member, fiscalYear: fy }).flows);
      addPaid(ctx.call<FlowsResult>("socialInsurance.careFirst", { member, fiscalYear: fy }).flows);
      addPaid(ctx.call<FlowsResult>("socialInsurance.nationalHealth", { fiscalYear: fy }).flows);
    }

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

    // 小規模企業共済等掛金控除: iDeCo の掛金（全額）
    const accounts = ctx.list<{ id: string; kind: string; owner: string }>("account");
    const smallBusiness = sumYen(
      ctx
        .call<PaymentsOutput>("account.contribution", {})
        .payments.filter((p) => p.member === member && p.ym.startsWith(yearPrefix) && accounts.find((a) => a.id === p.object)?.kind === "ideco")
        .map((p) => p.amount),
    );

    const total = sumYen([basic, spouse, spouseSpecial, dependents, specifiedRelative, socialInsurance, life, earthquake, smallBusiness]);
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
      total,
      personalDiff: sumYen(diffs),
    };
  },
});

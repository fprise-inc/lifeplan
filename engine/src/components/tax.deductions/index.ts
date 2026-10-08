// 所得控除（所得税・住民税）。その年の12月31日の現況で判定する
// 基礎控除・配偶者控除・配偶者特別控除・扶養控除・特定親族特別控除・社会保険料控除・生命保険料控除・地震保険料控除・小規模企業共済等掛金控除
import {
  amountInYear,
  bracketFor,
  defineComponent,
  fail,
  monthIndex,
  parseYm,
  RATE_ZERO,
  sumYen,
  yearOf,
  yen,
  type Bracket,
  type Ctx,
  type DeductionsOutput,
  type FlowsResult,
  type InsuranceContractInput,
  type MemberInput,
  type MonthCtx,
  type MonthIndex,
  type PaymentsOutput,
  type PremiumOutput,
  type RelationInput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

type Regime = "incomeTax" | "residentTax";
const SI_COMPONENTS = ["socialInsurance.health", "socialInsurance.pension", "socialInsurance.employment"] as const;
const LIFE_TYPES = ["general", "careMedical", "pension"] as const;

const ids = (p: Regime) => ({
  basic: `${p}.basicDeduction`,
  spouseGeneral: `${p}.spouseDeduction.general`,
  spouseElderly: `${p}.spouseDeduction.elderly`,
  spouseSpecial: [1, 2, 3].map((t) => `${p}.spouseSpecialDeduction.tier${t}`),
  spouseSpecialLimit: `${p}.spouseSpecialDeduction.incomeLimit`,
  incomeLimit: `${p}.dependentIncomeLimit`,
  depGeneral: `${p}.dependentDeduction.general`,
  depSpecified: `${p}.dependentDeduction.specified`,
  depElderly: `${p}.dependentDeduction.elderly`,
  depElderlyCohabiting: `${p}.dependentDeduction.elderlyCohabiting`,
  specifiedRelative: `${p}.specifiedRelativeDeduction`,
  specifiedRelativeLimit: `${p}.specifiedRelativeDeduction.incomeLimit`,
  lifeNew: `${p}.lifeInsuranceDeduction.new`,
  lifeOld: `${p}.lifeInsuranceDeduction.old`,
  lifeMixedLimit: `${p}.lifeInsuranceDeduction.mixedLimit`,
  lifeTotalLimit: `${p}.lifeInsuranceDeduction.totalLimit`,
  quake: `${p}.earthquakeDeduction.earthquake`,
  quakeLongTerm: `${p}.earthquakeDeduction.longTerm`,
  quakeTotalLimit: `${p}.earthquakeDeduction.totalLimit`,
});

// 年齢の区分（所得税法の定義。住民税も同じ区分を使う）
const AGE = {
  dependentMin: "incomeTax.dependentDeduction.minAge",
  specifiedFrom: "incomeTax.dependentDeduction.specifiedFromAge",
  specifiedUntil: "incomeTax.dependentDeduction.specifiedUntilAge",
  elderly: "incomeTax.dependentDeduction.elderlyAge",
  spouseElderly: "incomeTax.spouseDeduction.elderlyAge",
  youngDependentUntil: "incomeTax.lifeInsuranceDeduction.youngDependentUntilAge",
};
const LIFE_YOUNG = "incomeTax.lifeInsuranceDeduction.newGeneralWithYoungDependent";
const LIFE_YOUNG_LIMIT = "incomeTax.lifeInsuranceDeduction.mixedLimitWithYoungDependent";
const DIFF = {
  basic: "residentTax.adjustmentCredit.diff.basic",
  spouseGeneral: "residentTax.adjustmentCredit.diff.spouseGeneral",
  spouseElderly: "residentTax.adjustmentCredit.diff.spouseElderly",
  spouseSpecial: "residentTax.adjustmentCredit.diff.spouseSpecial",
  depGeneral: "residentTax.adjustmentCredit.diff.dependentGeneral",
  depSpecified: "residentTax.adjustmentCredit.diff.dependentSpecified",
  depElderly: "residentTax.adjustmentCredit.diff.dependentElderly",
  depElderlyCohabiting: "residentTax.adjustmentCredit.diff.dependentElderlyCohabiting",
  specifiedRelative: "residentTax.adjustmentCredit.diff.specifiedRelative",
};

const ALL_PARAMS = [
  ...(["incomeTax", "residentTax"] as const).flatMap((p) => {
    const i = ids(p);
    return [i.basic, i.spouseGeneral, i.spouseElderly, ...i.spouseSpecial, i.spouseSpecialLimit, i.specifiedRelativeLimit, i.incomeLimit, i.depGeneral, i.depSpecified, i.depElderly, i.depElderlyCohabiting,
      i.specifiedRelative, i.lifeNew, i.lifeOld, i.lifeMixedLimit, i.lifeTotalLimit, i.quake, i.quakeLongTerm, i.quakeTotalLimit];
  }),
  ...Object.values(AGE),
  LIFE_YOUNG,
  LIFE_YOUNG_LIMIT,
  ...Object.values(DIFF),
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
  revision: 3,
  requires: {
    "tax.totalIncome": ">=1 <2",
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
    "member.kind",
    "member.birth",
    "member.joins",
    "member.leaves",
    "member.support",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.marriage",
    "relation.from",
    "relation.to",
    "insurance.policyholder",
    "insurance.deductionCategory",
    "account.kind",
    "account.owner",
  ],
  input: "tax.deductions.input",
  output: "tax.deductions.output",
  compute(input, ctx) {
    const { member, year, regime } = input;
    const P = ids(regime);
    const resident = regime === "residentTax";
    // 所得税はその年分の値、住民税は翌年度（6月から）の値。判定はどちらもその年の12月31日の現況
    const at = ctx.at(resident ? monthIndex(year + 1, 6) : monthIndex(year, 1));
    const ageAt = ctx.at(monthIndex(year, 1));
    const dec: MonthIndex = monthIndex(year, 12);
    const baseYear = yearOf(ctx.time.base);
    const totalOf = (id: string) => ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year }).total;
    const own = totalOf(member);
    const members = ctx.list<MemberInput>("member");
    const present = (m: MemberInput) =>
      parseYm(m.birth.birthYearMonth) <= dec &&
      (m.joins === null || ctx.time.resolve(m.joins) <= dec) &&
      (m.leaves === null || ctx.time.resolve(m.leaves) > dec);
    const ageReached = (id: string, ageParam: string) => {
      const sel = ageAt.param(ageParam);
      const years = ageAt.paramCount(ageParam);
      if (years === null || sel.def.ageSwitch === null) fail("E_PARAM_KIND", [ageParam]);
      return ctx.time.ageSwitch(id, { years }, sel.def.ageSwitch as never) <= dec;
    };
    const diffs: Yen[] = [];
    const diff = (id: string) => {
      if (resident) diffs.push(at.paramYen(id) ?? yen(0));
    };
    const diffIn = (id: string, x: Yen) => {
      if (resident) diffs.push(amountIn(at.paramBrackets(id), x));
    };

    // 基礎控除（合計所得金額の段階）
    const basic = amountIn(at.paramBrackets(P.basic), own);
    if (basic > 0) diff(DIFF.basic);

    // 配偶者控除・配偶者特別控除: 法律婚の配偶者。夫婦の両方が受けることはないので、所得の多い方（同じなら関係の a の側）だけが受ける
    const limit = at.paramYen(P.incomeLimit) ?? yen(0);
    let spouse = yen(0);
    let spouseSpecial = yen(0);
    const spouses = new Set<string>();
    for (const r of ctx.list<RelationInput>("relation")) {
      if (r.type !== "spouse" || r.marriage !== "legal" || (r.a !== member && r.b !== member)) continue;
      if ((r.from !== null && ctx.time.resolve(r.from) > dec) || (r.to !== null && ctx.time.resolve(r.to) <= dec)) continue;
      const other = r.a === member ? r.b : r.a;
      const om = members.find((m) => m.id === other);
      if (om === undefined || !present(om)) continue;
      spouses.add(other);
      const st = totalOf(other);
      if (own < st || (own === st && r.a !== member)) continue;
      const general = at.paramBrackets(P.spouseGeneral);
      if (st <= limit) {
        const elderly = ageReached(other, AGE.spouseElderly);
        spouse = amountIn(at.paramBrackets(elderly ? P.spouseElderly : P.spouseGeneral), own);
        if (spouse > 0) diffIn(elderly ? DIFF.spouseElderly : DIFF.spouseGeneral, own);
      } else if (general !== null && st <= (at.paramYen(P.spouseSpecialLimit) ?? yen(0))) {
        // 本人の合計所得金額の段（配偶者控除の表の段）ごとの表
        const tier = general.findIndex((b) => b.upTo === null || own <= b.upTo);
        const table = tier >= 0 && tier < 3 && (general[tier]?.amount ?? 0) > 0 ? P.spouseSpecial[tier] : undefined;
        if (table !== undefined) {
          spouseSpecial = amountIn(at.paramBrackets(table), st);
          if (spouseSpecial > 0) diff(DIFF.spouseSpecial);
        }
      }
    }

    // 扶養控除・特定親族特別控除: 子と、扶養している親・祖父母。夫婦のうち所得の多い方が受ける
    const earners = members.filter((m) => (m.kind === "self" || m.kind === "spouse") && present(m));
    const rank = (m: MemberInput) => [totalOf(m.id), m.kind === "self" ? 1 : 0] as const;
    let claimant: string | undefined;
    for (const m of earners) {
      if (claimant === undefined) {
        claimant = m.id;
        continue;
      }
      const [a, ak] = rank(m);
      const [b, bk] = rank(earners.find((e) => e.id === claimant) as MemberInput);
      if (a > b || (a === b && (ak > bk || (ak === bk && m.id < (claimant as string))))) claimant = m.id;
    }
    let dependents = yen(0);
    let specifiedRelative = yen(0);
    let youngDependent = false;
    if (claimant === member) {
      for (const d of members) {
        if (d.id === member || spouses.has(d.id) || !present(d)) continue;
        const isChild = d.kind === "child";
        const isElder = (d.kind === "parent" || d.kind === "grandparent") && d.support?.dependent === true;
        if (!isChild && !isElder) continue;
        const dt = totalOf(d.id);
        const specifiedAge = ageReached(d.id, AGE.specifiedFrom) && !ageReached(d.id, AGE.specifiedUntil);
        if (dt <= limit) {
          if (!ageReached(d.id, AGE.youngDependentUntil)) youngDependent = true;
          if (!ageReached(d.id, AGE.dependentMin)) continue;
          if (ageReached(d.id, AGE.elderly)) {
            const cohabiting = isElder && d.support?.cohabiting === true;
            dependents = yen(dependents + (at.paramYen(cohabiting ? P.depElderlyCohabiting : P.depElderly) ?? 0));
            diff(cohabiting ? DIFF.depElderlyCohabiting : DIFF.depElderly);
          } else if (specifiedAge) {
            dependents = yen(dependents + (at.paramYen(P.depSpecified) ?? 0));
            diff(DIFF.depSpecified);
          } else {
            dependents = yen(dependents + (at.paramYen(P.depGeneral) ?? 0));
            diff(DIFF.depGeneral);
          }
        } else if (specifiedAge && dt <= (at.paramYen(P.specifiedRelativeLimit) ?? yen(0))) {
          const amount = amountIn(at.paramBrackets(P.specifiedRelative), dt);
          if (amount > 0) {
            specifiedRelative = yen(specifiedRelative + amount);
            diff(DIFF.specifiedRelative);
          }
        }
      }
    }

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

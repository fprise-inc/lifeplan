// 扶養控除・特定親族特別控除（所得税・住民税）。その年の12月31日の現況で判定する（tax.deductions から呼ぶ）。
// 子と、扶養している親・祖父母。夫婦のうち所得の多い方が受ける。23歳未満の扶養親族がいるか（生命保険料控除の特例）も返す。
// 他の構成員の所得で決まる部分を小さな部品に分けておくと、配偶者の所得が変わっても控除の額が同じなら、所得控除（tax.deductions）と
// それを使う税の部品を計算し直さない（0006 の追記）
import {
  bracketFor,
  defineComponent,
  fail,
  monthIndex,
  parseYm,
  yen,
  type Bracket,
  type MemberInput,
  type MonthIndex,
  type RelationInput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

type Regime = "incomeTax" | "residentTax";
const ids = (p: Regime) => ({
  incomeLimit: `${p}.dependentIncomeLimit`,
  depGeneral: `${p}.dependentDeduction.general`,
  depSpecified: `${p}.dependentDeduction.specified`,
  depElderly: `${p}.dependentDeduction.elderly`,
  depElderlyCohabiting: `${p}.dependentDeduction.elderlyCohabiting`,
  specifiedRelative: `${p}.specifiedRelativeDeduction`,
  specifiedRelativeLimit: `${p}.specifiedRelativeDeduction.incomeLimit`,
});
const IDS = { incomeTax: ids("incomeTax"), residentTax: ids("residentTax") } as const;
// 年齢の区分（所得税法の定義。住民税も同じ区分を使う）
const AGE = {
  dependentMin: "incomeTax.dependentDeduction.minAge",
  specifiedFrom: "incomeTax.dependentDeduction.specifiedFromAge",
  specifiedUntil: "incomeTax.dependentDeduction.specifiedUntilAge",
  elderly: "incomeTax.dependentDeduction.elderlyAge",
  youngDependentUntil: "incomeTax.lifeInsuranceDeduction.youngDependentUntilAge",
};
const DIFF = {
  depGeneral: "residentTax.adjustmentCredit.diff.dependentGeneral",
  depSpecified: "residentTax.adjustmentCredit.diff.dependentSpecified",
  depElderly: "residentTax.adjustmentCredit.diff.dependentElderly",
  depElderlyCohabiting: "residentTax.adjustmentCredit.diff.dependentElderlyCohabiting",
  specifiedRelative: "residentTax.adjustmentCredit.diff.specifiedRelative",
};

const amountIn = (b: readonly Bracket[] | null, x: Yen): Yen => (b === null ? yen(0) : (bracketFor(b, x).amount ?? yen(0)));

export default defineComponent<
  { member: string; year: number; regime: Regime },
  { dependents: Yen; specifiedRelative: Yen; youngDependent: boolean; personalDiff: Yen }
>({
  id: "tax.dependentDeduction",
  title: "扶養控除・特定親族特別控除",
  contract: "1.0",
  revision: 3,
  requires: { "tax.totalIncome": ">=1 <2", "tax.incomeOrder": ">=1 <2" },
  params: [
    ...(["incomeTax", "residentTax"] as const).flatMap((p) => Object.values(ids(p))),
    ...Object.values(AGE),
    ...Object.values(DIFF),
  ],
  reads: ["member.kind", "member.birth", "member.joins", "member.leaves", "member.support", "relation.type", "relation.a", "relation.b", "relation.marriage", "relation.from", "relation.to"],
  input: "tax.deductions.input",
  output: "tax.dependentDeduction.output",
  compute(input, ctx) {
    const { member, year, regime } = input;
    const P = IDS[regime];
    const resident = regime === "residentTax";
    // 所得税はその年分の値、住民税は翌年度（6月から）の値。判定はどちらもその年の12月31日の現況
    const at = ctx.at(resident ? monthIndex(year + 1, 6) : monthIndex(year, 1));
    const ageAt = ctx.at(monthIndex(year, 1));
    const dec: MonthIndex = monthIndex(year, 12);
    // 同じ構成員の合計所得金額は1回だけ引く（比べるたびに呼ばない）
    const totals = new Map<string, Yen>();
    const totalOf = (id: string): Yen => {
      let t = totals.get(id);
      if (t === undefined) {
        // 所得税の合計所得金額は、分離課税の退職所得の金額を含む（住民税は含めない）
        const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year });
        t = resident ? inc.total : yen(inc.total + (inc.retirement ?? 0));
        totals.set(id, t);
      }
      return t;
    };
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
    const limit = at.paramYen(P.incomeLimit) ?? yen(0);
    // 配偶者（法律婚・その年の12月31日にいる）は扶養親族にしない
    const spouses = new Set<string>();
    for (const r of ctx.list<RelationInput>("relation")) {
      if (r.type !== "spouse" || r.marriage !== "legal" || (r.a !== member && r.b !== member)) continue;
      if ((r.from !== null && ctx.time.resolve(r.from) > dec) || (r.to !== null && ctx.time.resolve(r.to) <= dec)) continue;
      const other = r.a === member ? r.b : r.a;
      const om = members.find((m) => m.id === other);
      if (om === undefined || !present(om)) continue;
      spouses.add(other);
    }
    // 夫婦のうち所得の多い方（同じなら本人、次に ID の小さい方）が受ける。所得の額ではなく大小だけを読む（tax.incomeOrder）
    const earners = members.filter((m) => (m.kind === "self" || m.kind === "spouse") && present(m));
    let claimant: MemberInput | undefined;
    for (const m of earners) {
      if (claimant === undefined) {
        claimant = m;
        continue;
      }
      const order = ctx.call<{ order: -1 | 0 | 1 }>("tax.incomeOrder", { a: m.id, b: claimant.id, year }).order;
      const ak = m.kind === "self" ? 1 : 0;
      const bk = claimant.kind === "self" ? 1 : 0;
      if (order > 0 || (order === 0 && (ak > bk || (ak === bk && m.id < claimant.id)))) claimant = m;
    }
    let dependents = yen(0);
    let specifiedRelative = yen(0);
    let youngDependent = false;
    if (claimant?.id === member) {
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
    let personalDiff = 0;
    for (const d of diffs) personalDiff += d;
    return { dependents, specifiedRelative, youngDependent, personalDiff: yen(personalDiff) };
  },
});

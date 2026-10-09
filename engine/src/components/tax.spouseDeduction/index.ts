// 配偶者控除・配偶者特別控除（所得税・住民税）。その年の12月31日の現況で判定する（tax.deductions から呼ぶ）。
// 法律婚の配偶者。夫婦の両方が受けることはないので、所得の多い方（同じなら関係の a の側）だけが受ける。
// 他の構成員の所得で決まる部分を小さな部品に分けておくと、配偶者の所得が変わっても控除の額が同じなら、所得控除（tax.deductions）と
// それを使う税の部品を計算し直さない（0006 の追記: 依存は小さく、結果が同じなら下流は使い回す）
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
  spouseGeneral: `${p}.spouseDeduction.general`,
  spouseElderly: `${p}.spouseDeduction.elderly`,
  spouseSpecial: [1, 2, 3].map((t) => `${p}.spouseSpecialDeduction.tier${t}`),
  spouseSpecialLimit: `${p}.spouseSpecialDeduction.incomeLimit`,
  incomeLimit: `${p}.dependentIncomeLimit`,
});
const IDS = { incomeTax: ids("incomeTax"), residentTax: ids("residentTax") } as const;
const SPOUSE_ELDERLY_AGE = "incomeTax.spouseDeduction.elderlyAge";
const DIFF = {
  spouseGeneral: "residentTax.adjustmentCredit.diff.spouseGeneral",
  spouseElderly: "residentTax.adjustmentCredit.diff.spouseElderly",
  spouseSpecial: "residentTax.adjustmentCredit.diff.spouseSpecial",
};

const amountIn = (b: readonly Bracket[] | null, x: Yen): Yen => (b === null ? yen(0) : (bracketFor(b, x).amount ?? yen(0)));

export default defineComponent<{ member: string; year: number; regime: Regime }, { spouse: Yen; spouseSpecial: Yen; personalDiff: Yen }>({
  id: "tax.spouseDeduction",
  title: "配偶者控除・配偶者特別控除",
  contract: "1.0",
  revision: 3,
  requires: { "tax.totalIncome": ">=1 <2", "tax.incomeOrder": ">=1 <2" },
  params: [
    ...(["incomeTax", "residentTax"] as const).flatMap((p) => {
      const i = ids(p);
      return [i.spouseGeneral, i.spouseElderly, ...i.spouseSpecial, i.spouseSpecialLimit, i.incomeLimit];
    }),
    SPOUSE_ELDERLY_AGE,
    ...Object.values(DIFF),
  ],
  reads: ["member.birth", "member.joins", "member.leaves", "relation.type", "relation.a", "relation.b", "relation.marriage", "relation.from", "relation.to"],
  input: "tax.deductions.input",
  output: "tax.spouseDeduction.output",
  compute(input, ctx) {
    const { member, year, regime } = input;
    const P = IDS[regime];
    const resident = regime === "residentTax";
    // 所得税はその年分の値、住民税は翌年度（6月から）の値。判定はどちらもその年の12月31日の現況
    const at = ctx.at(resident ? monthIndex(year + 1, 6) : monthIndex(year, 1));
    const ageAt = ctx.at(monthIndex(year, 1));
    const dec: MonthIndex = monthIndex(year, 12);
    // 所得税の合計所得金額は、分離課税の退職所得の金額を含む（住民税は、現年分離課税の退職所得を含めない）
    const totalOf = (id: string): Yen => {
      const t = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year });
      return resident ? t.total : yen(t.total + (t.retirement ?? 0));
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
    const diffIn = (id: string, x: Yen) => {
      if (resident) diffs.push(amountIn(at.paramBrackets(id), x));
    };
    const limit = at.paramYen(P.incomeLimit) ?? yen(0);
    let spouse = yen(0);
    let spouseSpecial = yen(0);
    for (const r of ctx.list<RelationInput>("relation")) {
      if (r.type !== "spouse" || r.marriage !== "legal" || (r.a !== member && r.b !== member)) continue;
      if ((r.from !== null && ctx.time.resolve(r.from) > dec) || (r.to !== null && ctx.time.resolve(r.to) <= dec)) continue;
      const other = r.a === member ? r.b : r.a;
      const om = members.find((m) => m.id === other);
      if (om === undefined || !present(om)) continue;
      // 所得の少ない方は受けない（額ではなく大小だけを読む。tax.incomeOrder）
      const order = ctx.call<{ order: -1 | 0 | 1 }>("tax.incomeOrder", { a: member, b: other, year }).order;
      if (order < 0 || (order === 0 && r.a !== member)) continue;
      const own = totalOf(member);
      const st = totalOf(other);
      const general = at.paramBrackets(P.spouseGeneral);
      if (st <= limit) {
        const elderly = ageReached(other, SPOUSE_ELDERLY_AGE);
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
    let personalDiff = 0;
    for (const d of diffs) personalDiff += d;
    return { spouse, spouseSpecial, personalDiff: yen(personalDiff) };
  },
});

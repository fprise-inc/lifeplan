// 国民年金の保険料（第1号被保険者。全国一律の月額。年度ごとの値）。納付期限は翌月末なので翌月に払う。
// 産前産後の免除の月は払わない。制度データの後の年度は、最後の値に賃金上昇率（前提）を掛けて10円単位に丸めて延ばす（0007 の7）
import {
  addMonths,
  defineComponent,
  fiscalYearOf,
  fiscalYearStart,
  formatYm,
  monthIndex,
  parseYm,
  RATE_ONE,
  RATE_ZERO,
  yearOf,
  type CategoryOutput,
  type Flow,
  type Yen,
} from "../../sdk/index.ts";

const PREMIUM = "socialInsurance.nationalPension.premium";
const ROUND = "socialInsurance.nationalPension.premium.rounding";

export default defineComponent<{ member: string; fromYear: number }, { flows: Flow[] }>({
  id: "socialInsurance.nationalPension",
  title: "国民年金保険料",
  contract: "1.0",
  revision: 1,
  requires: { "pension.category": ">=1 <2" },
  params: [PREMIUM, ROUND],
  reads: ["assumptions.wageGrowth"],
  input: "socialInsurance.premium.input",
  output: "flows.output",
  compute(input, ctx) {
    const months = ctx.call<CategoryOutput>("pension.category", { member: input.member }).months;
    const first = monthIndex(input.fromYear - 1, 12);
    const byFy = new Map<number, Yen>();
    let lastKnown: { fy: number; v: Yen } | null = null;
    const projected: number[] = [];
    const premiumOf = (fy: number): Yen => {
      const hit = byFy.get(fy);
      if (hit !== undefined) return hit;
      const at = ctx.at(fiscalYearStart(fy));
      let v: Yen;
      const known = at.has(PREMIUM) ? at.paramYen(PREMIUM) : null;
      if (known !== null) {
        v = known;
        if (lastKnown === null || lastKnown.fy < fy) lastKnown = { fy, v };
      } else if (lastKnown !== null && fy > lastKnown.fy) {
        // 賃金の伸びで延ばす（保険料改定率の近似）
        const prev = premiumOf(fy - 1);
        const g = ctx.rate.add(RATE_ONE, ctx.assumption("wageGrowth", fy - 2, RATE_ZERO));
        v = at.money.mulRate(prev, g, ROUND);
        projected.push(fy);
      } else v = at.paramYen(PREMIUM) as Yen;
      byFy.set(fy, v);
      return v;
    };
    // 既知の最後の年度を先に探す
    for (let fy = fiscalYearOf(ctx.time.base) - 2; fy <= fiscalYearOf(ctx.time.end); fy++) {
      if (ctx.at(fiscalYearStart(fy)).has(PREMIUM) && ctx.at(fiscalYearStart(fy)).paramYen(PREMIUM) !== null) premiumOf(fy);
    }
    const flows: Flow[] = [];
    for (const c of months) {
      if (c.category !== "1" || c.premiumExempt) continue;
      const m = parseYm(c.month);
      if (m < first) continue;
      const amount = premiumOf(fiscalYearOf(m));
      if (amount > 0) {
        flows.push({ row: "cf.taxSi.pension", ym: formatYm(addMonths(m, 1)), amount, accrualYear: yearOf(m), member: input.member, formula: "socialInsurance.nationalPension.monthly" });
      }
    }
    if (projected.length > 0) ctx.notice("N_PARAM_PROJECTED", [PREMIUM, String(Math.min(...projected)), String(Math.max(...projected))]);
    return { flows };
  },
});

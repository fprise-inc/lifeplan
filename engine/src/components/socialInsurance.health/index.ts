// 健康保険料・介護保険料（40〜64歳）・子ども・子育て支援金の被保険者負担分
// 標準報酬月額（賞与は標準賞与額）に、健康保険料率・介護保険料率・支援金率を合算した率を掛けて折半し、1回だけ丸める。
// 表の行は、介護・支援金をそれぞれ同じ規則で丸めた額とし、残りを健康保険に寄せる
import {
  boxValue,
  paidByYear,
  defineComponent,
  parseYm,
  rate,
  RATE_ZERO,
  subYen,
  yearOf,
  yen,
  type CoverageOutput,
  type Ctx,
  type EmploymentPeriodInput,
  type Flow,
  type PremiumOutput,
  type MonthIndex,
  type Rate,
  type ValueBox,
  type Yen,
} from "../../sdk/index.ts";

const ROUNDING = "socialInsurance.employeeShare.rounding";
const TWO = rate("2");

interface Rates {
  /** 被保険者負担の率（折半した後） */
  readonly health: Rate;
  readonly care: Rate;
  readonly childSupport: Rate;
}

function ratesFor(ctx: Ctx, p: EmploymentPeriodInput, m: MonthIndex, care: boolean): Rates {
  const at = ctx.at(m);
  const half = (r: Rate | null) => (r === null ? RATE_ZERO : ctx.rate.div(r, TWO));
  // 支援金率は令和8年4月分から（それより前は制度データで「該当なし」）
  const childSupportNational = half(at.paramRate("socialInsurance.childSupport.rate"));
  const hi = p.healthInsurance;
  if (hi?.kind === "kyokaikenpo") {
    const insurer = hi.insurer as string;
    return {
      health: half(at.paramRate("socialInsurance.health.kyokaikenpo.rate", { jurisdiction: { level: "insurer", code: insurer } })),
      care: care ? half(at.paramRate("socialInsurance.care.kyokaikenpo.rate")) : RATE_ZERO,
      childSupport: childSupportNational,
    };
  }
  // 健保組合・共済は、被保険者負担の率を入力で受ける（上書きの範囲②。0008 の4）
  const own = (b: ValueBox<string> | undefined) => {
    const v = boxValue(b);
    return v === null ? null : rate(v);
  };
  return {
    health: own(hi?.employeeRate) ?? RATE_ZERO,
    care: care ? (own(hi?.careEmployeeRate) ?? RATE_ZERO) : RATE_ZERO,
    childSupport: own(hi?.childSupportEmployeeRate) ?? childSupportNational,
  };
}

/** 合算した率で1回だけ丸め、介護と支援金を同じ規則で丸めた額を除いた残りを健康保険にする */
function split(ctx: Ctx, m: MonthIndex, base: Yen, r: Rates): [Yen, Yen, Yen] {
  const money = ctx.at(m).money;
  const total = money.mulRate(base, ctx.rate.add(ctx.rate.add(r.health, r.care), r.childSupport), ROUNDING);
  const care = ctx.rate.compare(r.care, RATE_ZERO) === 0 ? yen(0) : money.mulRate(base, r.care, ROUNDING);
  const cs = ctx.rate.compare(r.childSupport, RATE_ZERO) === 0 ? yen(0) : money.mulRate(base, r.childSupport, ROUNDING);
  return [subYen(subYen(total, care), cs), care, cs];
}

export default defineComponent<{ member: string; fromYear: number }, PremiumOutput>({
  id: "socialInsurance.health",
  title: "健康保険料・介護保険料・子ども・子育て支援金",
  contract: "1.1",
  revision: 3,
  requires: { "socialInsurance.coverage": ">=1 <2" },
  params: [
    "socialInsurance.health.kyokaikenpo.rate",
    "socialInsurance.care.kyokaikenpo.rate",
    "socialInsurance.childSupport.rate",
    ROUNDING,
  ],
  reads: [
    "employment.healthInsurance.kind",
    "employment.healthInsurance.insurer",
    "employment.healthInsurance.employeeRate",
    "employment.healthInsurance.careEmployeeRate",
    "employment.healthInsurance.childSupportEmployeeRate",
  ],
  replaceable: true,
  input: "socialInsurance.premium.input",
  output: "socialInsurance.premium.output",
  compute(input, ctx) {
    const cov = ctx.call<CoverageOutput>("socialInsurance.coverage", input);
    const flows: Flow[] = [];
    const push = (row: string, ym: string, amount: Yen, accrual: number, period: string, formula: string) => {
      if (amount > 0) flows.push({ row, ym, amount, accrualYear: accrual, member: input.member, object: period, formula });
    };
    for (const c of cov.months) {
      if (c.healthStd === null || c.exempt === true) continue;
      const m = parseYm(c.month);
      const p = ctx.get<EmploymentPeriodInput>("employment", c.period);
      const [h, care, cs] = split(ctx, m, c.healthStd, ratesFor(ctx, p, m, c.care));
      push("cf.taxSi.health", c.paidIn, h, yearOf(m), c.period, "socialInsurance.health.monthly");
      push("cf.taxSi.care", c.paidIn, care, yearOf(m), c.period, "socialInsurance.care.monthly");
      push("cf.taxSi.childSupport", c.paidIn, cs, yearOf(m), c.period, "socialInsurance.childSupport.monthly");
    }
    for (const b of cov.bonuses) {
      if (b.healthStdBonus === null || b.exempt === true) continue;
      const m = parseYm(b.month);
      const p = ctx.get<EmploymentPeriodInput>("employment", b.period);
      const [h, care, cs] = split(ctx, m, b.healthStdBonus, ratesFor(ctx, p, m, b.care));
      push("cf.taxSi.health", b.month, h, yearOf(m), b.period, "socialInsurance.health.bonus");
      push("cf.taxSi.care", b.month, care, yearOf(m), b.period, "socialInsurance.care.bonus");
      push("cf.taxSi.childSupport", b.month, cs, yearOf(m), b.period, "socialInsurance.childSupport.bonus");
    }
    return { flows, paidByYear: paidByYear(flows) };
  },
});

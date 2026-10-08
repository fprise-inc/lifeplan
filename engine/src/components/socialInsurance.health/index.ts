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
  segmentIndex,
  subYen,
  yearOf,
  yen,
  type CoverageOutput,
  type Ctx,
  type MonthCtx,
  type Segment,
  type SegmentOptions,
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

function ratesFor(ctx: Ctx, at: MonthCtx, p: EmploymentPeriodInput, care: boolean): Rates {
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
function split(ctx: Ctx, at: MonthCtx, base: Yen, r: Rates): [Yen, Yen, Yen] {
  const money = at.money;
  const total = money.mulRate(base, ctx.rate.add(ctx.rate.add(r.health, r.care), r.childSupport), ROUNDING);
  const care = ctx.rate.compare(r.care, RATE_ZERO) === 0 ? yen(0) : money.mulRate(base, r.care, ROUNDING);
  const cs = ctx.rate.compare(r.childSupport, RATE_ZERO) === 0 ? yen(0) : money.mulRate(base, r.childSupport, ROUNDING);
  return [subYen(subYen(total, care), cs), care, cs];
}

export default defineComponent<{ member: string; fromYear: number }, PremiumOutput>({
  id: "socialInsurance.health",
  title: "健康保険料・介護保険料・子ども・子育て支援金",
  contract: "1.1",
  revision: 4,
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
    // 区間ごとの計算（0006 の追記）: 料率と端数処理の行が変わらない区間ごとに、同じ標準報酬・勤め先・介護の有無の額は1回だけ計算する
    const items = [
      ...cov.months.filter((c) => c.healthStd !== null && c.exempt !== true).map((c) => ({ m: parseYm(c.month), base: c.healthStd as Yen, care: c.care, period: c.period, paid: c.paidIn, bonus: false })),
      ...cov.bonuses.filter((b) => b.healthStdBonus !== null && b.exempt !== true).map((b) => ({ m: parseYm(b.month), base: b.healthStdBonus as Yen, care: b.care, period: b.period, paid: b.month, bonus: true })),
    ];
    if (items.length === 0) return { flows, paidByYear: paidByYear(flows) };
    let from = items[0]?.m as MonthIndex;
    let to = from;
    const insurers = new Set<string>();
    for (const it of items) {
      if (it.m < from) from = it.m;
      if (it.m > to) to = it.m;
      const hi = ctx.get<EmploymentPeriodInput>("employment", it.period).healthInsurance;
      if (hi?.kind === "kyokaikenpo") insurers.add(hi.insurer as string);
    }
    const params: SegmentOptions["params"] = [
      ...[...insurers].map((code) => ["socialInsurance.health.kyokaikenpo.rate", { jurisdiction: { level: "insurer", code } }] as const),
      "socialInsurance.care.kyokaikenpo.rate",
      "socialInsurance.childSupport.rate",
      ROUNDING,
    ];
    const segs = ctx.segments(from, to, { params });
    const memo = new Map<string, [Yen, Yen, Yen]>();
    const amounts = (m: MonthIndex, base: Yen, period: string, care: boolean): [Yen, Yen, Yen] => {
      const k = segmentIndex(segs, m);
      const key = `${k}|${base}|${period}|${care}`;
      let v = memo.get(key);
      if (v === undefined) {
        const at = (segs[k] as Segment).at;
        v = split(ctx, at, base, ratesFor(ctx, at, ctx.get<EmploymentPeriodInput>("employment", period), care));
        memo.set(key, v);
      }
      return v;
    };
    for (const it of items) {
      const [h, care, cs] = amounts(it.m, it.base, it.period, it.care);
      const kind = it.bonus ? "bonus" : "monthly";
      push("cf.taxSi.health", it.paid, h, yearOf(it.m), it.period, `socialInsurance.health.${kind}`);
      push("cf.taxSi.care", it.paid, care, yearOf(it.m), it.period, `socialInsurance.care.${kind}`);
      push("cf.taxSi.childSupport", it.paid, cs, yearOf(it.m), it.period, `socialInsurance.childSupport.${kind}`);
    }
    return { flows, paidByYear: paidByYear(flows) };
  },
});

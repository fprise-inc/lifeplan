// 医療費の自己負担（6.10。0008 の追記 2026-10-09 の決定6）: 万一の想定（障害・就業不能）の医療費（contingency.medical。1か月の医療費10割と月数）から、
// 窓口の負担（70歳未満は3割）を高額療養費の上限で止めた額を、その月の支出（cf.expense.care.medical）にする（簡易の計算。医療費控除は作らない）。
// - 所得の区分: その月に勤め先の健康保険に入っていれば標準報酬月額、それ以外は前年の総所得金額等から基礎控除を引いた額（旧ただし書き所得）で、
//   住民税が非課税なら最後の区分（オ）。上限は 基準の額＋（医療費−基準の医療費）×1%（区分ア〜ウ）か定額（エ・オ）。
//   令和9年8月からは区分が13に細分化される（区分の番号と額は制度データ。部品は番号で引くだけ）。
//   直近12か月に3回以上上限に達していれば、4回目から多数回該当の額
// - 年間上限（2026年8月診療分から。8月〜翌年7月）: その期間の負担の合計が上限を超えた分を、期間の最後の月の負担から引く
// - 70歳以上の区分・外来の特例は作らない（70歳未満の区分で計算し、知らせ）
import {
  addMonths,
  ageMonth,
  bracketFor,
  defineComponent,
  fiscalYearOf,
  formatYm,
  monthOf,
  parseYm,
  RATE_ZERO,
  yearOf,
  yen,
  type Bracket,
  type ContingencyEventOutput,
  type CoverageOutput,
  type ExemptionOutput,
  type Flow,
  type FlowsResult,
  type HealthStatusOutput,
  type MonthIndex,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  copay: "socialInsurance.medical.copayRate.under70",
  base: "socialInsurance.highCostMedical.under70.base",
  threshold: "socialInsurance.highCostMedical.under70.threshold",
  multiple: "socialInsurance.highCostMedical.under70.multiple",
  annual: "socialInsurance.highCostMedical.under70.annualLimit",
  excess: "socialInsurance.highCostMedical.excessRate",
  byStd: "socialInsurance.highCostMedical.tierByStandard",
  byIncome: "socialInsurance.highCostMedical.tierByIncome",
  deduction: "socialInsurance.highCostMedical.incomeDeduction",
  elderly: "socialInsurance.highCostMedical.elderlyAge",
};
const EMPLOYER: ReadonlySet<string> = new Set(["kyokaikenpo", "union", "mutualAid"]);
/** 段階表の区分の番号（upTo が区分の番号、amount が額）の額 */
const tierAmount = (b: readonly Bracket[] | null, tier: number): Yen | null => (b === null ? null : (bracketFor(b, yen(tier)).amount ?? null));

export default defineComponent<{ member: string }, FlowsResult>({
  id: "medical.highCost",
  title: "医療費の自己負担（高額療養費）",
  contract: "1.0",
  revision: 1,
  requires: {
    "contingency.event": ">=1 <2",
    "socialInsurance.healthStatus": ">=1 <2",
    "socialInsurance.coverage": ">=1 <2",
    "tax.totalIncome": ">=1 <2",
    "residentTax.exemption": ">=1 <2",
  },
  params: Object.values(P),
  reads: [],
  input: "member.input",
  output: "flows.output",
  compute(input, ctx) {
    const member = input.member;
    const { base, end } = ctx.time;
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member }).event;
    if (ev === null || ev.medical === undefined) return { flows: [] };
    const med = ev.medical;
    const from = med.from === undefined ? parseYm(ev.month) : ctx.time.resolve(med.from as never);
    const health = new Map(ctx.call<HealthStatusOutput>("socialInsurance.healthStatus", { member }).months.map((x) => [x.month, x.kind]));
    const std = new Map(ctx.call<CoverageOutput>("socialInsurance.coverage", { member, fromYear: yearOf(base) }).months.map((x) => [x.month, x.healthStd]));
    const tierOf = (m: MonthIndex): number => {
      const at = ctx.at(m);
      // 住民税非課税の区分は限度額の表の最後の区分（令和9年7月までは5のオ、8月からは13）
      if (ctx.call<ExemptionOutput>("residentTax.exemption", { member, fiscalYear: fiscalYearOf(m) }).perCapitaExempt) return at.paramBrackets(P.base)?.length ?? 5;
      const kind = health.get(formatYm(m));
      const s = std.get(formatYm(m)) ?? null;
      if (kind !== undefined && EMPLOYER.has(kind) && s !== null) return Number(tierAmount(at.paramBrackets(P.byStd), s) ?? 4);
      const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year: yearOf(m) - 1 }).total;
      const basis = inc - (at.paramYen(P.deduction) ?? 0);
      return Number(tierAmount(at.paramBrackets(P.byIncome), yen(basis > 0 ? basis : 0)) ?? 4);
    };
    const elderly = ageMonth(ctx, from < base ? base : from, P.elderly, member);
    const reached: MonthIndex[] = [];
    const flows: Flow[] = [];
    const window = new Map<number, { total: number; last: number }>();
    let noticed = false;
    for (let k = 0; k < med.months; k++) {
      const m = addMonths(from, k);
      if (m > end) break;
      if (m >= elderly && !noticed) {
        ctx.notice("N_NOT_SUPPORTED", ["highCostMedical.over70", member]);
        noticed = true;
      }
      const at = ctx.at(m);
      const tier = tierOf(m);
      const copay = at.money.mulRate(med.monthly, at.paramRate(P.copay) ?? RATE_ZERO, "conv.expense.share");
      const b = tierAmount(at.paramBrackets(P.base), tier);
      let limit: Yen | null = null;
      if (b !== null) {
        const th = tierAmount(at.paramBrackets(P.threshold), tier) ?? yen(0);
        limit = th > 0 && med.monthly > th ? yen(b + at.money.mulRate(yen(med.monthly - th), at.paramRate(P.excess) ?? RATE_ZERO, "conv.expense.share")) : b;
        // 多数回該当: 直近12か月に3回以上上限に達していれば
        if (reached.filter((r) => r > addMonths(m, -12)).length >= 3) limit = tierAmount(at.paramBrackets(P.multiple), tier) ?? limit;
      }
      let pay = limit !== null && copay > limit ? limit : copay;
      if (limit !== null && copay >= limit) reached.push(m);
      // 年間上限（8月〜翌年7月）
      const annual = tierAmount(at.paramBrackets(P.annual), tier);
      if (annual !== null) {
        const start = monthOf(m) >= 8 ? yearOf(m) : yearOf(m) - 1;
        const w = window.get(start) ?? { total: 0, last: -1 };
        if (w.total + pay > annual) pay = yen(Math.max(0, annual - w.total));
        w.total += pay;
        window.set(start, w);
      }
      if (pay > 0 && m >= base) flows.push({ row: "cf.expense.care.medical", ym: formatYm(m), amount: pay, accrualYear: yearOf(m), member, formula: "medical.highCost.copay" });
    }
    return { flows };
  },
});

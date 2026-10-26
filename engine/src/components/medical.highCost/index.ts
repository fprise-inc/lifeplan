// 医療費の自己負担（6.10。0008 の追記 2026-10-09 の決定6）: 万一の想定（障害・就業不能）の医療費（contingency.medical。1か月の医療費10割と月数）から、
// 窓口の負担（70歳未満は3割）を高額療養費の上限で止めた額を、その月の支出（cf.expense.care.medical）にする（簡易の計算。医療費控除は作らない）。
// - 所得の区分: その月に勤め先の健康保険に入っていれば標準報酬月額。国民健康保険なら、その月に国民健康保険に入っている世帯の構成員全員の
//   基準所得額（総所得金額等から住民税の基礎控除（合計所得金額2,400万円超で減る。地方税法314条の2第2項）を引いた額。旧ただし書き所得）の
//   合計で、療養の月が8〜12月なら前年、1〜7月なら前々年の所得（国民健康保険法施行令29条の3）。住民税が非課税（国民健康保険なら、
//   その世帯の国民健康保険の構成員全員が非課税）なら最後の区分（オ）。上限は 基準の額＋（医療費−基準の医療費）×1%（区分ア〜ウ）か定額（エ・オ）。
//   令和9年8月からは区分が13に細分化される（区分の番号と額は制度データ。部品は番号で引くだけ）。
//   直近12か月に3回以上上限に達していれば、4回目から多数回該当の額
// - 年間上限（2026年8月診療分から。8月〜翌年7月）: その期間の負担の合計が上限を超えた分を、期間の最後の月の負担から引く。
//   制度データ socialInsurance.highCostMedical.under70.annualLimitRetroactive が 1 の期間（令和8年8月〜令和9年7月）は、期間が終わった後に
//   次の期間の初めの月（令和9年8月）の区分と年間上限で計算し直し（年収約200万円以下の41万円）、負担の合計がそれを超えた分を、その月に
//   払い戻す（cf.income.benefit.medical）
// - 70歳以上の区分・外来の特例は作らない（70歳未満の区分で計算し、知らせ）
// 改訂3: 世帯の外の家族（0035 の4）は世帯の合算に入れない
import {
  addMonths,
  ageMonth,
  bracketFor,
  defineComponent,
  fiscalYearOf,
  formatYm,
  monthIndex,
  monthOf,
  parseYm,
  RATE_ZERO,
  sameHousehold,
  yearOf,
  yen,
  type Bracket,
  type ContingencyEventOutput,
  type CoverageOutput,
  type ExemptionOutput,
  type Flow,
  type FlowsResult,
  type HealthStatusOutput,
  type MemberInput,
  type MonthIndex,
  type RelationInput,
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
  retro: "socialInsurance.highCostMedical.under70.annualLimitRetroactive",
  residentBasic: "residentTax.basicDeduction",
};
const EMPLOYER: ReadonlySet<string> = new Set(["kyokaikenpo", "union", "mutualAid"]);
/** 段階表の区分の番号（upTo が区分の番号、amount が額）の額 */
const tierAmount = (b: readonly Bracket[] | null, tier: number): Yen | null => (b === null ? null : (bracketFor(b, yen(tier)).amount ?? null));

export default defineComponent<{ member: string }, FlowsResult>({
  id: "medical.highCost",
  title: "医療費の自己負担（高額療養費）",
  contract: "1.0",
  revision: 3,
  requires: {
    "contingency.event": ">=1 <2",
    "socialInsurance.healthStatus": ">=1 <2",
    "socialInsurance.coverage": ">=1 <2",
    "tax.totalIncome": ">=1 <2",
    "residentTax.exemption": ">=1 <2",
  },
  params: Object.values(P),
  reads: ["member.outside", "relation.type", "relation.a", "relation.b", "relation.from", "relation.to", "member.kind"],
  input: "member.input",
  output: "flows.output",
  compute(input, ctx) {
    const member = input.member;
    const { base, end } = ctx.time;
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member }).event;
    if (ev === null || ev.medical === undefined) return { flows: [] };
    const med = ev.medical;
    const from = med.from === undefined ? parseYm(ev.month) : ctx.time.resolve(med.from as never);
    const healthOf = new Map<string, Map<string, string>>();
    const healthMap = (id: string) => {
      let h = healthOf.get(id);
      if (h === undefined) {
        h = new Map(ctx.call<HealthStatusOutput>("socialInsurance.healthStatus", { member: id }).months.map((x) => [x.month, x.kind]));
        healthOf.set(id, h);
      }
      return h;
    };
    const health = healthMap(member);
    const std = new Map(ctx.call<CoverageOutput>("socialInsurance.coverage", { member, fromYear: yearOf(base) }).months.map((x) => [x.month, x.healthStd]));
    // 世帯の合算は同じ世帯の人だけ（世帯の外の家族は、その人と世帯の外の配偶者。0035 の4）
    const others = sameHousehold(ctx, ctx.list<MemberInput>("member"), ctx.list<RelationInput>("relation"), member).map((x) => x.id).filter((id) => id !== member);
    // 基準所得額（総所得金額等−住民税の基礎控除。基礎控除は合計所得金額で減る）
    const basisIncome = (id: string, y: number, at: ReturnType<typeof ctx.at>): number => {
      const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: id, year: y }).total;
      const atR = ctx.at(monthIndex(y + 1, 6));
      const table = atR.has(P.residentBasic) ? atR.paramBrackets(P.residentBasic) : null;
      const ded = table === null ? (at.paramYen(P.deduction) ?? 0) : (bracketFor(table, inc).amount ?? 0);
      return Math.max(0, inc - ded);
    };
    // m の療養の区分を、atMonth の制度の値（区分の表）で決める
    const tierOf = (m: MonthIndex, atMonth: MonthIndex = m): number => {
      const at = ctx.at(atMonth);
      const kind = health.get(formatYm(m));
      const s = std.get(formatYm(m)) ?? null;
      const last = at.paramBrackets(P.base)?.length ?? 5;
      const fy = fiscalYearOf(m);
      if (kind !== undefined && EMPLOYER.has(kind) && s !== null) {
        // 住民税非課税の区分は限度額の表の最後の区分（令和9年7月までは5のオ、8月からは13）
        if (ctx.call<ExemptionOutput>("residentTax.exemption", { member, fiscalYear: fy }).perCapitaExempt) return last;
        return Number(tierAmount(at.paramBrackets(P.byStd), s) ?? 4);
      }
      // 国民健康保険（と勤め先の保険の外）: その月に国民健康保険に入っている世帯の構成員の合算
      const ym = formatYm(m);
      const nhi = kind === "national" ? [member, ...others.filter((id) => healthMap(id).get(ym) === "national")] : [member];
      if (nhi.every((id) => ctx.call<ExemptionOutput>("residentTax.exemption", { member: id, fiscalYear: fy }).perCapitaExempt)) return last;
      const y = monthOf(m) >= 8 ? yearOf(m) - 1 : yearOf(m) - 2;
      const basis = nhi.reduce((sum, id) => sum + basisIncome(id, y, at), 0);
      return Number(tierAmount(at.paramBrackets(P.byIncome), yen(basis)) ?? 4);
    };
    const elderly = ageMonth(ctx, from < base ? base : from, P.elderly, member);
    const reached: MonthIndex[] = [];
    const flows: Flow[] = [];
    const window = new Map<number, { total: number; last: number; lastMonth: MonthIndex }>();
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
        const w = window.get(start) ?? { total: 0, last: -1, lastMonth: m };
        if (w.total + pay > annual) pay = yen(Math.max(0, annual - w.total));
        w.total += pay;
        w.lastMonth = m;
        window.set(start, w);
      }
      if (pay > 0 && m >= base) flows.push({ row: "cf.expense.care.medical", ym: formatYm(m), amount: pay, accrualYear: yearOf(m), member, formula: "medical.highCost.copay" });
    }
    // 年間上限の計算し直し（令和8年8月〜令和9年7月の年収約200万円以下の41万円）。期間の最後の療養の月の区分を、次の期間の初めの月の表で引く
    for (const [start, w] of [...window.entries()].sort((a, b) => a[0] - b[0])) {
      const startM = monthIndex(start, 8);
      if (w.total <= 0 || ctx.at(startM).paramCount(P.retro) !== 1) continue;
      const next = monthIndex(start + 1, 8);
      const annualNext = tierAmount(ctx.at(next).paramBrackets(P.annual), tierOf(w.lastMonth, next));
      if (annualNext === null || w.total <= annualNext) continue;
      if (next < base || next > end) continue;
      flows.push({ row: "cf.income.benefit.medical", ym: formatYm(next), amount: yen(w.total - annualNext), accrualYear: start + 1, member, formula: "medical.highCost.annualRefund" });
    }
    return { flows };
  },
});

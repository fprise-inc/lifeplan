// 年金生活者支援給付金（老齢）。65歳以上で老齢基礎年金を受け、世帯全員の住民税（均等割）が非課税で、前年の公的年金等の収入と
// その他の所得の合計が所得基準額以下のとき、給付基準額×保険料納付済の月数/480 を年金と同じ偶数月に払う（非課税の給付）。
// 10月から翌年9月までを、前年の所得（その年度の住民税の非課税）で判定する。免除期間の分は入れていない（免除は記録で入れない）
import {
  addMonths,
  ageMonth,
  defineComponent,
  fiscalYearOf,
  fiscalYearStart,
  formatYm,
  monthIndex,
  monthOf,
  parseYm,
  yearOf,
  yen,
  type Ctx,
  type ExemptionOutput,
  type Flow,
  type MemberInput,
  type MonthIndex,
  type PensionOutput,
  type PublicPensionIncomeOutput,
  type RecordOutput,
  type RevisionOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  base: "pension.supplementaryBenefit.baseMonthly",
  limit: "pension.supplementaryBenefit.incomeLimit",
  start: "pension.normalStartAge",
  maxMonths: "pension.basic.maxMonths",
  round: "pension.amount.rounding",
};

/** 制度データに無い年度は、最後の値に改定率の比を掛けて延ばす（0007 の7: 連動する値）。back は「fy より前で値のある最後の年度」を探した結果の使い回し */
function indexed(
  ctx: Ctx,
  m: MonthIndex,
  id: string,
  member: string,
  R: (fy: number) => string,
  projected: Map<string, number[]>,
  backs: Map<string, number | null>,
): Yen | null {
  const fy = fiscalYearOf(m);
  if (ctx.at(m).has(id, { member })) {
    const v = ctx.at(m).paramYen(id, { member });
    if (v !== null) return v;
  }
  const key = `${id}|${fy}`;
  let found = backs.get(key);
  if (found === undefined) {
    found = null;
    for (let back = fy - 1; back >= fy - 100; back--) {
      const at = ctx.at(fiscalYearStart(back));
      if (!at.has(id, { member })) continue;
      if (at.paramYen(id, { member }) === null) continue;
      found = back;
      break;
    }
    backs.set(key, found);
  }
  if (found !== null) {
    const at = ctx.at(fiscalYearStart(found));
    const v = at.paramYen(id, { member }) as Yen;
    projected.set(id, [...(projected.get(id) ?? []), fy]);
    return at.money.mulRate(v, ctx.rate.div(ctx.rate.of(R(fy)), ctx.rate.of(R(found))), P.round);
  }
  return ctx.at(m).paramYen(id, { member });
}

export default defineComponent<{ member: string }, { flows: Flow[] }>({
  id: "pension.supplementaryBenefit",
  title: "年金生活者支援給付金",
  contract: "1.0",
  revision: 1,
  requires: {
    "pension.oldAge": ">=1 <2",
    "pension.record": ">=1 <2",
    "pension.revision": ">=1 <2",
    "residentTax.exemption": ">=1 <2",
    "tax.totalIncome": ">=1 <2",
    "tax.publicPensionIncome": ">=1 <2",
  },
  params: Object.values(P),
  reads: ["member.birth", "member.joins", "member.leaves"],
  input: "member.input",
  output: "flows.output",
  compute(input, ctx) {
    const member = input.member;
    const { base, end } = ctx.time;
    const pension = ctx.call<PensionOutput>("pension.oldAge", { member });
    const basicMonths = new Set(pension.months.filter((x) => x.basic > 0).map((x) => x.month));
    if (basicMonths.size === 0) return { flows: [] };
    const rec = ctx.call<RecordOutput>("pension.record", { member });
    const rv = ctx.call<RevisionOutput>("pension.revision", { member });
    const rmap = new Map(rv.byFiscalYear.map((x) => [x.fiscalYear, x.rate]));
    const R = (fy: number) => rmap.get(fy) ?? rv.byFiscalYear[rv.byFiscalYear.length - 1]?.rate ?? "1";
    const n65 = ageMonth(ctx, base, P.start, member);
    const paid = rec.basicMonths + rec.months.filter((x) => x.basic).length;
    const others = ctx.list<MemberInput>("member").filter((m) => m.leaves === null || ctx.time.resolve(m.leaves) > base);
    const cache = new Map<number, boolean>();
    const projected = new Map<string, number[]>();
    const backs = new Map<string, number | null>();
    // 10月から翌年9月は、その年（判定の年度）の住民税と前年の所得で決める
    const eligible = (y: number): boolean => {
      let v = cache.get(y);
      if (v !== undefined) return v;
      const exemptAll = others.every((o) => ctx.call<ExemptionOutput>("residentTax.exemption", { member: o.id, fiscalYear: y }).perCapitaExempt);
      const pensionIncome = ctx.call<PublicPensionIncomeOutput>("tax.publicPensionIncome", { member, year: y - 1 });
      const total = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year: y - 1 }).total;
      const measure = pensionIncome.revenue + (total - pensionIncome.income);
      const limit = indexed(ctx, monthIndex(y, 10), P.limit, member, R, projected, backs);
      v = exemptAll && limit !== null && measure <= limit;
      cache.set(y, v);
      return v;
    };
    const monthly = new Map<string, Yen>();
    // 計算基準月から（それより前の月の判定には前の年度の制度の値が要るため）
    for (let m = n65 > base ? n65 : base; m <= end; m = addMonths(m, 1)) {
      if (!basicMonths.has(formatYm(m))) continue;
      const judge = monthOf(m) >= 10 ? yearOf(m) : yearOf(m) - 1;
      if (!eligible(judge)) continue;
      const b = indexed(ctx, m, P.base, member, R, projected, backs);
      if (b === null) continue;
      const max = ctx.at(m).paramCount(P.maxMonths) ?? 480;
      monthly.set(formatYm(m), ctx.at(m).money.mulRatio(b, Math.min(paid, max), max, P.round));
    }
    for (const [id, ys] of projected) ctx.notice("N_PARAM_PROJECTED", [id, String(Math.min(...ys)), String(Math.max(...ys))]);
    // 偶数月に前2か月分
    const pays = new Map<string, { amount: number; accrual: number }>();
    for (const [ym, a] of monthly) {
      const m = parseYm(ym);
      const p = formatYm(addMonths(m, monthOf(m) % 2 === 1 ? 1 : 2));
      const cur = pays.get(p) ?? { amount: 0, accrual: yearOf(m) };
      cur.amount += a;
      pays.set(p, cur);
    }
    const flows: Flow[] = [...pays.entries()]
      .filter(([, v]) => v.amount > 0)
      .map(([ym, v]) => ({ row: "cf.income.benefit", ym, amount: yen(v.amount), accrualYear: v.accrual, member, formula: "pension.supplementaryBenefit.payment" }));
    return { flows };
  },
});

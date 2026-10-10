// 年金生活者支援給付金（老齢）。65歳以上で老齢基礎年金を受け、世帯全員の住民税（均等割）が非課税で、前年の公的年金等の収入と
// その他の所得の合計が所得基準額以下のとき、給付基準額×保険料納付済の月数/480 を年金と同じ偶数月に払う（非課税の給付）。
// 10月から翌年9月までを、前年の所得（その年度の住民税の非課税）で判定する。免除期間の分（老齢基礎年金の満額×（全額・4分の3・半額免除の月数×1/6＋
// 4分の1免除の月数×1/12）/480÷12。学生納付特例・納付猶予は除く。法3条2号）は、加入の記録に第1号の内訳（category1）があるときだけ足す（改訂4）。
// 補足的老齢年金生活者支援給付金: 所得が所得基準額を超え補足的所得基準額以下なら、給付基準額×納付済の月数/480×調整支給率
// （（補足的所得基準額−所得）÷（補足的所得基準額−所得基準額））。補足的所得基準額が制度データに無いときは計算せず、
// 対象かもしれない年（世帯全員が非課税で、所得が所得基準額を超える）を見出しの notices（N_PARAM_MISSING）で知らせる
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
  type MonthCtx,
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
  supLimit: "pension.supplementaryBenefit.supplementaryIncomeLimit",
  start: "pension.normalStartAge",
  maxMonths: "pension.basic.maxMonths",
  round: "pension.amount.rounding",
  basicBase: "pension.basic.baseAmount",
  fullRound: "pension.basic.fullAmount.rounding",
  shareQuarter: "pension.supplementaryBenefit.exemptionShare.quarter",
  shareOther: "pension.supplementaryBenefit.exemptionShare.other",
  shareDen: "pension.supplementaryBenefit.exemptionShare.denominator",
};

/**
 * 制度データに無い年度は、最後の値に改定率の比を掛けて延ばす（0007 の7: 連動する値）。at はその月（または区間）の値、fy はその年度。
 * back は「fy より前で値のある最後の年度」を探した結果の使い回し
 */
function indexed(
  ctx: Ctx,
  at0: MonthCtx,
  fy: number,
  id: string,
  member: string,
  R: (fy: number) => string,
  projected: Map<string, number[]>,
  backs: Map<string, number | null>,
): Yen | null {
  if (at0.has(id, { member })) {
    const v = at0.paramYen(id, { member });
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
  return at0.paramYen(id, { member });
}

export default defineComponent<{ member: string }, { flows: Flow[] }>({
  id: "pension.supplementaryBenefit",
  title: "年金生活者支援給付金",
  contract: "1.0",
  revision: 4,
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
    const c1 = rec.category1 !== undefined && rec.category1.known ? rec.category1 : null;
    const others = ctx.list<MemberInput>("member").filter((m) => m.leaves === null || ctx.time.resolve(m.leaves) > base);
    // 判定の年ごと: null は支給なし、ratio は調整支給率（分子・分母。本来の給付金は 1/1）
    const cache = new Map<number, { num: number; den: number } | null>();
    const projected = new Map<string, number[]>();
    const backs = new Map<string, number | null>();
    // 10月から翌年9月は、その年（判定の年度）の住民税と前年の所得で決める
    const eligible = (y: number): { num: number; den: number } | null => {
      let v = cache.get(y);
      if (v !== undefined) return v;
      const exemptAll = others.every((o) => ctx.call<ExemptionOutput>("residentTax.exemption", { member: o.id, fiscalYear: y }).perCapitaExempt);
      const pensionIncome = ctx.call<PublicPensionIncomeOutput>("tax.publicPensionIncome", { member, year: y - 1 });
      const total = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year: y - 1 }).total;
      const measure = pensionIncome.revenue + (total - pensionIncome.income);
      const oct = monthIndex(y, 10);
      const limit = indexed(ctx, ctx.at(oct), fiscalYearOf(oct), P.limit, member, R, projected, backs);
      v = null;
      if (exemptAll && limit !== null) {
        if (measure <= limit) v = { num: 1, den: 1 };
        else {
          const at = ctx.at(oct);
          const sup = at.has(P.supLimit, { member }) || hasEarlier(P.supLimit, fiscalYearOf(oct)) ? indexed(ctx, at, fiscalYearOf(oct), P.supLimit, member, R, projected, backs) : null;
          if (sup === null) ctx.notice("N_PARAM_MISSING", [P.supLimit, member]);
          else if (measure <= sup && sup > limit) v = { num: sup - measure, den: sup - limit };
        }
      }
      cache.set(y, v);
      return v;
    };
    // 値のある年度がそれより前にあるか（延ばせるか）
    const hasEarlier = (id: string, fy: number): boolean => {
      for (let back = fy - 1; back >= fy - 100; back--) if (ctx.at(fiscalYearStart(back)).has(id, { member })) return true;
      return false;
    };
    const monthly = new Map<string, Yen>();
    // 計算基準月から（それより前の月の判定には前の年度の制度の値が要るため）。
    // 区間ごとの計算（0006 の追記）: 年度・判定の年（10月で替わる）・制度の値の行・老齢基礎年金を受ける月かが変わらない区間ごとに1回だけ計算する
    const start = n65 > base ? n65 : base;
    if (start <= end) {
      const breaks: MonthIndex[] = [];
      let wasIn: boolean | null = null;
      for (let m = start; m <= end; m = addMonths(m, 1)) {
        const now = basicMonths.has(formatYm(m));
        if (wasIn !== null && now !== wasIn) breaks.push(m);
        wasIn = now;
      }
      for (let y = yearOf(start); y <= yearOf(end); y++) breaks.push(monthIndex(y, 10));
      for (const seg of ctx.segments(start, end, { params: [[P.base, { member }], P.maxMonths, P.round, P.basicBase, P.fullRound, P.shareQuarter, P.shareOther, P.shareDen], breaks, every: "fiscalYear" })) {
        const m = seg.from;
        if (!basicMonths.has(formatYm(m))) continue;
        const judge = monthOf(m) >= 10 ? yearOf(m) : yearOf(m) - 1;
        const ratio = eligible(judge);
        if (ratio === null) continue;
        const b = indexed(ctx, seg.at, fiscalYearOf(m), P.base, member, R, projected, backs);
        if (b === null) continue;
        const max = seg.at.paramCount(P.maxMonths) ?? 480;
        let v = seg.at.money.mulRatio(b, Math.min(paid, max) * ratio.num, max * ratio.den, P.round);
        // 免除期間の分（本来の給付金だけ。補足的給付金には無い）
        if (c1 !== null && ratio.num === ratio.den && seg.at.has(P.shareDen)) {
          const den = seg.at.paramCount(P.shareDen) ?? 12;
          let share = (c1.exemptFull + c1.exemptThreeQuarters + c1.exemptHalf) * (seg.at.paramCount(P.shareOther) ?? 0) + c1.exemptQuarter * (seg.at.paramCount(P.shareQuarter) ?? 0);
          // 納付済の月数と合わせて480月まで
          share = Math.min(share, Math.max(0, max - paid) * den);
          if (share > 0) {
            const full = seg.at.money.mulRate(seg.at.paramYen(P.basicBase) ?? yen(0), ctx.rate.of(R(fiscalYearOf(m))), P.fullRound);
            v = yen(v + seg.at.money.mulRatio(full, share, max * den * 12, P.round));
          }
        }
        for (let k = seg.from; k <= seg.to; k = addMonths(k, 1)) monthly.set(formatYm(k), v);
      }
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

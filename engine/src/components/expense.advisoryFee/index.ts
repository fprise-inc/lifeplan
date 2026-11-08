// FP顧問料（0008 の追記・科目の木の cf.expense.advisoryFee。生活費とは別の行）。契約ごと（object は契約の ID、member は払う構成員）に:
// - 単発（oneTime）: 支払う年月に一度だけ
// - 継続（recurring）: from〜to の間、月額なら毎月、年額なら毎年 from の月に。改定は、段階（steps。その月からの年額・月額）と、
//   毎年の改定率（rate。from または最後の段階から1年ごとに当てる。円未満切り捨て）
// 段階は契約の払い方の額を使い、年額の段階は始まりと同じ月（年に1回の払う月）から当てる。始まりと同じ月か前の段階は始まりから（改訂3）
// 金額は税込。enabled が false の契約は計算に入れない（案ごとの ON/OFF。既定では提案の側にだけ入れる。0008 の追記）。
// 個人が払う顧問料は所得から差し引かない（知らせ N_NOT_DEDUCTIBLE）。継続の万一のときの扱い（onContingency）は、世帯の万一の想定
// （contingency.event）の月の翌月から当てる（改訂2）
import {
  addMonths,
  contingencyRatio,
  defineComponent,
  formatYm,
  monthOf,
  yearOf,
  yen,
  type AdvisoryFeeInput,
  type ContingencyEvent,
  type ContingencyEventOutput,
  type Flow,
  type FlowsResult,
  type MonthIndex,
  type Yen,
} from "../../sdk/index.ts";

export default defineComponent<Record<string, never>, FlowsResult>({
  id: "expense.advisoryFee",
  title: "FP顧問料",
  contract: "1.0",
  revision: 3,
  requires: { "contingency.event": ">=1 <2" },
  params: [],
  reads: ["advisoryFee.payer", "advisoryFee.enabled", "advisoryFee.terms", "member.kind"],
  replaceable: true,
  input: "empty.input",
  output: "flows.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const flows: Flow[] = [];
    const contracts = ctx.list<AdvisoryFeeInput>("advisoryFee");
    let ev: ContingencyEvent | null = null;
    if (contracts.some((c) => c.terms?.recurring?.onContingency !== undefined)) {
      for (const m of ctx.list<{ id: string }>("member")) {
        ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: m.id }).event;
        if (ev !== null) break;
      }
    }
    for (const c of contracts) {
      if (c.enabled === false || c.terms === undefined) continue;
      const push = (m: MonthIndex, amount: Yen, formula: string) => {
        if (amount > 0 && m >= base && m <= end) flows.push({ row: "cf.expense.advisoryFee", ym: formatYm(m), amount, accrualYear: yearOf(m), member: c.payer, object: c.id, formula });
      };
      for (const o of c.terms.oneTime ?? []) push(ctx.time.resolve(o.at), o.amount, "expense.advisoryFee.oneTime");
      const r = c.terms.recurring;
      if (r === undefined) continue;
      const from = ctx.time.resolve(r.from);
      const to = r.to === undefined || r.to === null ? end : ctx.time.resolve(r.to);
      const rate = r.revision?.rate === undefined ? null : ctx.rate.of(r.revision.rate);
      // 料金の段階（0070 の追記 2026-11-08）: 年額と月額の両方があれば契約の払い方の額だけを使う（片方だけならその額。前の版の世帯）。
      // 年額で払う契約の年額の段階は、段階の月からの最初の払う月（始まりと同じ月）から当てる（年に2回払わない）。始まりと同じ月か前の段階は始まりから
      const payAnnual = r.annual !== undefined && r.annual !== null;
      const steps = (r.revision?.steps ?? [])
        .map((s) => {
          const annual = s.annual !== undefined && (payAnnual || s.monthly === undefined) ? s.annual : null;
          const monthly = annual === null ? (s.monthly ?? null) : null;
          let m = ctx.time.resolve(s.at);
          if (m < from) m = from;
          if (annual !== null && payAnnual) while (monthOf(m) !== monthOf(from)) m = addMonths(m, 1);
          return { m, annual, monthly };
        })
        .sort((a, b) => a.m - b.m);
      const first = steps.filter((s) => s.m <= from).at(-1);
      // その月の、改定を当てた額（年額か月額）
      let current = first !== undefined ? { since: from, annual: first.annual, monthly: first.monthly } : { since: from, annual: r.annual ?? null, monthly: r.monthly ?? null };
      let k = 0;
      let grownAnnual = current.annual === null ? null : yen(current.annual);
      let grownMonthly = current.monthly === null ? null : yen(current.monthly);
      for (let m: MonthIndex = from; m <= to && m <= end; m = addMonths(m, 1)) {
        const step = steps.filter((s) => s.m <= m).at(-1);
        if (step !== undefined && step.m > current.since) {
          current = { since: step.m, annual: step.annual, monthly: step.monthly };
          k = 0;
          grownAnnual = current.annual === null ? null : yen(current.annual);
          grownMonthly = current.monthly === null ? null : yen(current.monthly);
        }
        // 毎年の改定（始まりから12か月ごと）
        const years = Math.floor((m - current.since) / 12);
        while (rate !== null && k < years) {
          if (grownAnnual !== null) grownAnnual = yen(grownAnnual + ctx.money.mulRate(grownAnnual, rate, "conv.expense.growth"));
          if (grownMonthly !== null) grownMonthly = yen(grownMonthly + ctx.money.mulRate(grownMonthly, rate, "conv.expense.growth"));
          k++;
        }
        const cr = contingencyRatio(ctx, r.onContingency, ev, m);
        const adj = (a: Yen) => (cr === null ? a : ctx.money.mulRate(a, cr, "conv.expense.share"));
        if (grownMonthly !== null) push(m, adj(grownMonthly), "expense.advisoryFee.monthly");
        if (grownAnnual !== null && monthOf(m) === monthOf(current.since)) push(m, adj(grownAnnual), "expense.advisoryFee.annual");
      }
    }
    if (flows.length > 0) ctx.notice("N_NOT_DEDUCTIBLE", ["advisoryFee"]);
    return { flows };
  },
});

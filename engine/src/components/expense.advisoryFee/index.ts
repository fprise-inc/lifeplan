// FP顧問料（0008 の追記・科目の木の cf.expense.advisoryFee。生活費とは別の行）。契約ごと（object は契約の ID、member は払う構成員）に:
// - 単発（oneTime）: 支払う年月に一度だけ
// - 継続（recurring）: from〜to の間、月額なら毎月、年額なら毎年 from の月に。改定は、段階（steps。その月からの年額・月額）と、
//   毎年の改定率（rate。from または最後の段階から1年ごとに当てる。円未満切り捨て）
// 金額は税込。enabled が false の契約は計算に入れない（案ごとの ON/OFF。既定では提案の側にだけ入れる。0008 の追記）。
// 個人が払う顧問料は所得から差し引かない（知らせ N_NOT_DEDUCTIBLE）。継続の万一のときの扱い（onContingency）は、世帯の万一の想定
// （contingency.event）の月の翌月から当てる（改訂2）
// 改訂3（0173）: 払う人が万一の想定で亡くなった月の翌月からは、相続する人（死亡の当時の配偶者。いなければ子を等分）が払う（sdk の inheritFlows）
import {
  inheritFlows,
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
      const steps = (r.revision?.steps ?? []).map((s) => ({ m: ctx.time.resolve(s.at), annual: s.annual, monthly: s.monthly })).sort((a, b) => a.m - b.m);
      // その月の、改定を当てた額（年額か月額）
      let current = { since: from, annual: r.annual ?? null, monthly: r.monthly ?? null };
      let k = 0;
      let grownAnnual = current.annual === null ? null : yen(current.annual);
      let grownMonthly = current.monthly === null ? null : yen(current.monthly);
      for (let m: MonthIndex = from; m <= to && m <= end; m = addMonths(m, 1)) {
        const step = steps.filter((s) => s.m <= m).at(-1);
        if (step !== undefined && step.m > current.since) {
          current = { since: step.m, annual: step.annual ?? null, monthly: step.monthly ?? null };
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
    return { flows: inheritFlows(ctx, flows) };
  },
});

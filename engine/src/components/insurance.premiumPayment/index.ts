// 保険料の支払い（支出の行と、保険料控除の基にする支払い）。払込は契約の月から、払込の終わりの前月まで
// - 改訂2（6.8）: 一時払（single。契約の月に1回）、更新（renewals。その月から更新後の保険料）、年次の数表の保険料（schedule の
//   保険年度ごとの年額。主契約・特約の行の合計。月払いは12か月に分ける）。保障と払込が終わる月（解約・被保険者の死亡・満期）と
//   払込免除の月（insurance.term）からは払わない
import {
  addMonths,
  defineComponent,
  formatYm,
  monthIndex,
  monthOf,
  parseYm,
  yearOf,
  yen,
  type Flow,
  type InsuranceContractInput,
  type MonthIndex,
  type PaymentsOutput,
  type PremiumPayment,
  type Yen,
} from "../../sdk/index.ts";

export default defineComponent<Record<string, never>, PaymentsOutput>({
  id: "insurance.premiumPayment",
  title: "保険料の支払い",
  contract: "1.0",
  revision: 2,
  requires: { "insurance.term": ">=1 <2" },
  params: [],
  reads: ["insurance.policyholder", "insurance.contractDate", "insurance.premium", "insurance.renewals", "insurance.schedule"],
  input: "empty.input",
  output: "payments.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const calcStart = monthIndex(yearOf(base) - 2, 1);
    const flows: Flow[] = [];
    const payments: PremiumPayment[] = [];
    for (const c of ctx.list<InsuranceContractInput>("insurance")) {
      const start = parseYm(c.contractDate);
      const term = ctx.call<{ endsAt: string | null; waiverFrom: string | null }>("insurance.term", { object: c.id });
      let until: MonthIndex = c.premium.payUntil === null ? addMonths(end, 1) : ctx.time.resolve(c.premium.payUntil);
      if (term.endsAt !== null && parseYm(term.endsAt) < until) until = parseYm(term.endsAt);
      if (term.waiverFrom !== null && parseYm(term.waiverFrom) < until) until = parseYm(term.waiverFrom);
      const renewals = (c.renewals ?? []).map((r) => ({ m: ctx.time.resolve(r.at), premium: r.premium })).sort((a, b) => a.m - b.m);
      // 数表の保険年度ごとの年額（行の合計）
      const byYear = new Map<number, Yen>();
      for (const r of c.schedule?.rows ?? []) if (r.premium !== undefined) byYear.set(r.policyYear, yen((byYear.get(r.policyYear) ?? 0) + r.premium));
      const monthlyParts = new Map<number, Yen[]>();
      const amountAt = (m: MonthIndex): Yen => {
        const py = Math.floor((m - start) / 12) + 1;
        const annual = byYear.get(py);
        if (annual !== undefined) {
          if (c.premium.frequency !== "monthly") return annual;
          let parts = monthlyParts.get(py);
          if (parts === undefined) {
            parts = ctx.money.allocate(annual, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.expense.share", "first");
            monthlyParts.set(py, parts);
          }
          return parts[(m - start) % 12] as Yen;
        }
        let a = c.premium.amount;
        for (const r of renewals) if (r.m <= m) a = r.premium;
        return a;
      };
      const push = (m: MonthIndex, amount: Yen, formula: string) => {
        const ym = formatYm(m);
        payments.push({ ym, object: c.id, member: c.policyholder, amount });
        if (amount > 0) flows.push({ row: "cf.expense.insurance", ym, amount, accrualYear: yearOf(m), member: c.policyholder, object: c.id, formula });
      };
      if (c.premium.frequency === "single") {
        if (start >= calcStart && start <= end) push(start, c.premium.amount, "insurance.premiumPayment.single");
        continue;
      }
      for (let m = start > calcStart ? start : calcStart; m < until && m <= end; m = addMonths(m, 1)) {
        if (c.premium.frequency === "annual" && monthOf(m) !== monthOf(start)) continue;
        push(m, amountAt(m), c.premium.frequency === "annual" ? "insurance.premiumPayment.annual" : "insurance.premiumPayment.monthly");
      }
    }
    return { flows, payments };
  },
});

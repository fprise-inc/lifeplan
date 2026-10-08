// 保険料の支払い（支出の行と、保険料控除の基にする支払い）。払込は契約の月から、払込の終わりの前月まで
import {
  addMonths,
  defineComponent,
  formatYm,
  monthIndex,
  monthOf,
  parseYm,
  yearOf,
  type Flow,
  type InsuranceContractInput,
  type PaymentsOutput,
  type PremiumPayment,
} from "../../sdk/index.ts";

export default defineComponent<Record<string, never>, PaymentsOutput>({
  id: "insurance.premiumPayment",
  title: "保険料の支払い",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: [],
  reads: ["insurance.policyholder", "insurance.contractDate", "insurance.premium"],
  input: "empty.input",
  output: "payments.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const calcStart = monthIndex(yearOf(base) - 2, 1);
    const flows: Flow[] = [];
    const payments: PremiumPayment[] = [];
    for (const c of ctx.list<InsuranceContractInput>("insurance")) {
      const start = parseYm(c.contractDate);
      const until = c.premium.payUntil === null ? addMonths(end, 1) : ctx.time.resolve(c.premium.payUntil);
      for (let m = start > calcStart ? start : calcStart; m < until && m <= end; m = addMonths(m, 1)) {
        if (c.premium.frequency === "annual" && monthOf(m) !== monthOf(start)) continue;
        const ym = formatYm(m);
        payments.push({ ym, object: c.id, member: c.policyholder, amount: c.premium.amount });
        if (c.premium.amount > 0) {
          flows.push({
            row: "cf.expense.insurance",
            ym,
            amount: c.premium.amount,
            accrualYear: yearOf(m),
            member: c.policyholder,
            object: c.id,
            formula: c.premium.frequency === "annual" ? "insurance.premiumPayment.annual" : "insurance.premiumPayment.monthly",
          });
        }
      }
    }
    return { flows, payments };
  },
});

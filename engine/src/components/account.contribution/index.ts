// 資産の器への積立・掛金（器の間の移動。年間収支に入れない。0004 の6）
import {
  addMonths,
  defineComponent,
  formatYm,
  monthIndex,
  yearOf,
  type AccountInput,
  type Flow,
  type PaymentsOutput,
  type PremiumPayment,
} from "../../sdk/index.ts";

const ROW: Readonly<Record<string, string>> = {
  ideco: "cf.transfer.ideco",
  corporateDc: "cf.transfer.ideco",
  nisa: "cf.transfer.nisa",
  childNisa: "cf.transfer.nisa",
};

export default defineComponent<Record<string, never>, PaymentsOutput>({
  id: "account.contribution",
  title: "積立・掛金",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: [],
  reads: ["account.kind", "account.owner", "account.contributions"],
  input: "empty.input",
  output: "payments.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const calcStart = monthIndex(yearOf(base) - 2, 1);
    const flows: Flow[] = [];
    const payments: PremiumPayment[] = [];
    for (const a of ctx.list<AccountInput>("account")) {
      for (const c of a.contributions) {
        const from = ctx.time.resolve(c.from);
        const to = c.to === null ? end : ctx.time.resolve(c.to);
        for (let m = from > calcStart ? from : calcStart; m <= to && m <= end; m = addMonths(m, 1)) {
          const ym = formatYm(m);
          payments.push({ ym, object: a.id, member: a.owner, amount: c.monthly });
          if (c.monthly > 0) {
            flows.push({ row: ROW[a.kind] ?? "cf.transfer.savings", ym, amount: c.monthly, accrualYear: yearOf(m), member: a.owner, object: a.id, formula: "account.contribution.monthly" });
          }
        }
      }
    }
    return { flows, payments };
  },
});

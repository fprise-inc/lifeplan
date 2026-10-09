// 資産の器への積立の予定（月ごと。器の間の移動。年間収支に入れない。0004 の6）。
// iDeCo・企業型DC の掛金は拠出限度額で止める ideco.contribution（構成員ごと）が扱うので、ここでは数えない。
// NISA・課税口座・財形などの移動のお金の動き（cf.transfer）は、NISA の枠で止めた後の額で plan.cashflow が出す（ここは予定の支払いだけを返す）
import {
  addMonths,
  defineComponent,
  formatYm,
  monthIndex,
  yearOf,
  type AccountInput,
  type PaymentsOutput,
  type PremiumPayment,
} from "../../sdk/index.ts";

/** ideco.contribution が扱う器 */
const DC_KINDS: ReadonlySet<string> = new Set(["ideco", "corporateDc"]);

export default defineComponent<Record<string, never>, PaymentsOutput>({
  id: "account.contribution",
  title: "積立の予定",
  contract: "2.0",
  revision: 2,
  requires: {},
  params: [],
  reads: ["account.kind", "account.owner", "account.contributions"],
  input: "empty.input",
  output: "payments.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const calcStart = monthIndex(yearOf(base) - 2, 1);
    const payments: PremiumPayment[] = [];
    for (const a of ctx.list<AccountInput>("account")) {
      if (DC_KINDS.has(a.kind)) continue;
      for (const c of a.contributions) {
        const from = ctx.time.resolve(c.from);
        const to = c.to === null ? end : ctx.time.resolve(c.to);
        for (let m = from > calcStart ? from : calcStart; m <= to && m <= end; m = addMonths(m, 1)) {
          if (c.monthly > 0) payments.push({ ym: formatYm(m), object: a.id, member: a.owner, amount: c.monthly });
        }
      }
    }
    payments.sort((x, y) => (x.ym < y.ym ? -1 : x.ym > y.ym ? 1 : 0));
    return { flows: [], payments };
  },
});

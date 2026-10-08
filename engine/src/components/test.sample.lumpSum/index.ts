// 【架空の見本】年1回の一時金。架空の率を差し引いて受け取る（実在の制度の計算ではない）
import {
  defineComponent,
  formatYm,
  monthIndex,
  RATE_ZERO,
  subYen,
  yearOf,
  type AnnualLumpSumInput,
  type Flow,
} from "../../sdk/index.ts";

export default defineComponent<{ object: string }, { flows: Flow[] }>({
  id: "test.sample.lumpSum",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: ["test.sample.lumpSum.withholdingRate", "test.sample.lumpSum.rounding"],
  reads: ["test.sample.annualLumpSums"],
  replaceable: true,
  input: "test.sample.lumpSum.input",
  output: "flows.output",
  compute(input, ctx) {
    const item = ctx.readObject<AnnualLumpSumInput>("test.sample.annualLumpSums", input.object);
    const from = ctx.time.resolve(item.from);
    const to = item.to === null ? ctx.time.end : ctx.time.resolve(item.to);
    const flows: Flow[] = [];
    for (let y = yearOf(from); y <= yearOf(to); y++) {
      // 帰属の月（その年分）と、お金が動く月（支払月）を分けて持つ（0003 の2）
      const accrual = monthIndex(y, item.month);
      if (accrual < from || accrual > to) continue;
      const paid = item.paidNextYear ? monthIndex(y + 1, item.month) : accrual;
      if (paid < ctx.time.base || paid > ctx.time.end) continue;
      // 率は「その年分」の値（basis: incomeYear）。引く日はエンジンが決める
      const at = ctx.at(accrual);
      const r = at.paramRate("test.sample.lumpSum.withholdingRate") ?? RATE_ZERO;
      const withheld = at.money.mulRate(item.amount, r, "test.sample.lumpSum.rounding");
      flows.push({
        row: "cf.income.lumpSum",
        ym: formatYm(paid),
        amount: subYen(item.amount, withheld),
        accrualYear: y,
        ...(item.member !== undefined ? { member: item.member } : {}),
        object: item.id,
        formula: "test.sample.lumpSum.net",
      });
    }
    return { flows };
  },
});

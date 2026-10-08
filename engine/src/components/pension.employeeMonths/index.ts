// 厚生年金の被保険者期間の月数（加入の記録の初めの値と、記録の後の厚生年金の月）。加給年金・振替加算の判定（240月）で、配偶者の月数だけを
// 読むための小さな部品（0006 の追記: 配偶者の年収が変わっても月数が同じなら、本人の老齢年金を計算し直さない）
import { defineComponent, type RecordOutput } from "../../sdk/index.ts";

export default defineComponent<{ member: string }, { months: number }>({
  id: "pension.employeeMonths",
  title: "厚生年金の被保険者期間の月数",
  contract: "1.0",
  revision: 1,
  requires: { "pension.record": ">=1 <2" },
  params: [],
  reads: [],
  input: "member.input",
  output: "pension.employeeMonths.output",
  compute(input, ctx) {
    const rec = ctx.call<RecordOutput>("pension.record", { member: input.member });
    let months = rec.employeeMonths;
    for (const x of rec.months) if (x.employee) months++;
    return { months };
  },
});

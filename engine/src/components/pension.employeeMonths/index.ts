// 厚生年金の被保険者期間の月数（加入の記録の初めの値と、記録の後の厚生年金の月）。加給年金・振替加算の判定（240月）で、配偶者の月数だけを
// 読むための小さな部品（0006 の追記: 配偶者の年収が変わっても月数が同じなら、本人の老齢年金を計算し直さない）
// 約束の版 1.1: longFrom（厚生年金240月以上の老齢厚生年金の受給権を持つ最初の月）を足した（改訂2）。配偶者の加給年金は、配偶者がこの受給権を
// 持つ月から止まる（厚生年金保険法46条6項。2022年4月から、受け取っていなくても受給権があれば止まる）。受給権は、特別支給の老齢厚生年金の
// 開始・繰上げの請求・65歳のうち早い月に得る。そのときの月数が240に満たなくても、退職改定（資格を失った月の翌月から）と在職定時改定
// （65歳から、8月までの加入を10月分から。pension.oldAgeBase と同じ近似で9月から数える）で240に届けば、その月から。受給資格期間を満たさなければ null
import {
  addMonths,
  ageMonth,
  defineComponent,
  formatYm,
  monthIndex,
  monthOf,
  oldAgeClaimMonths,
  claimInput,
  parseYm,
  specialOldAgeStart,
  SPECIAL_OLD_AGE_PARAMS,
  yearOf,
  type MonthIndex,
  type PensionRecordInput,
  type RecordOutput,
} from "../../sdk/index.ts";

const P = {
  start: "pension.normalStartAge",
  qual: "pension.qualifyingMonths",
  supMonths: "pension.spouseSupplement.requiredMonths",
  ...SPECIAL_OLD_AGE_PARAMS,
};

export default defineComponent<{ member: string }, { months: number; longFrom: string | null }>({
  id: "pension.employeeMonths",
  title: "厚生年金の被保険者期間の月数",
  contract: "1.1",
  revision: 2,
  requires: { "pension.record": ">=1 <2" },
  params: Object.values(P),
  reads: ["pensionRecord.member", "pensionRecord.claim", "member.pensionClaim"],
  memberScope: ["pensionRecord"],
  input: "member.input",
  output: "pension.employeeMonths.output",
  compute(input, ctx) {
    const member = input.member;
    const { base, end } = ctx.time;
    const rec = ctx.call<RecordOutput>("pension.record", { member });
    let months = rec.employeeMonths;
    for (const x of rec.months) if (x.employee) months++;
    const at0 = ctx.at(base);
    const required = at0.paramCount(P.supMonths) ?? 240;
    if (months < required) return { months, longFrom: null };
    const input0 = ctx.list<PensionRecordInput>("pensionRecord").find((r) => r.member === member);
    const monthsGiven = input0?.months !== undefined || (rec.kind !== "projection" && rec.kind !== "receiving");
    if (monthsGiven && rec.qualifyingMonths < (at0.paramCount(P.qual) ?? 0)) return { months, longFrom: null };
    const N = ageMonth(ctx, base, P.start, member);
    const receiving = rec.kind === "receiving";
    // 受給権を得る月と、そのときの月数を決める月（受給中は記録の時点の翌月まで）
    let E: MonthIndex;
    let b0: MonthIndex;
    if (receiving) {
      E = monthIndex(yearOf(base) - 2, 1);
      b0 = rec.asOf === null ? E : addMonths(parseYm(rec.asOf), 1);
    } else {
      const SA = specialOldAgeStart(ctx, at0, rec, member, N);
      const claim = oldAgeClaimMonths(ctx, rec, claimInput(ctx, member, input0), N, SA);
      E = N;
      if (claim.employee < E) E = claim.employee;
      if (SA !== null && SA < E) E = SA;
      b0 = E;
    }
    const empMonths = rec.months.filter((x) => x.employee).map((x) => parseYm(x.month));
    const insured = new Set(empMonths as number[]);
    // cut より前の記録の厚生年金の月の数（記録の月は昇順。二分探索）
    const countBefore = (cut: MonthIndex) => {
      let lo = 0;
      let hi = empMonths.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((empMonths[mid] as number) < cut) lo = mid + 1;
        else hi = mid;
      }
      return rec.employeeMonths + lo;
    };
    for (let m = E; m <= end; m = addMonths(m, 1)) {
      let cut: MonthIndex;
      if (!insured.has(m)) cut = m;
      else if (m < N) cut = b0;
      else {
        const sep = addMonths(monthIndex(monthOf(m) >= 10 ? yearOf(m) : yearOf(m) - 1, 8), 1);
        cut = sep > b0 ? sep : b0;
      }
      if (countBefore(cut) >= required) return { months, longFrom: formatYm(m) };
    }
    return { months, longFrom: null };
  },
});

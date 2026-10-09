// 住宅借入金等特別控除を受けうる年分の範囲（構成員ごと。入居の年から控除期間の最後の年まで）。所得や残高に依らない判定だけを返す小さな部品
// （0006 の追記）。所得税・住民税の部品は、この範囲の年分だけ tax.housingLoanCredit を呼ぶ（0005 の追記（3回目の見直し）: 呼び出しの数を減らす）
import { defineComponent, monthIndex, yearOf, type DebtInput } from "../../sdk/index.ts";

const C = "incomeTax.housingLoanCredit";
/** 値の無い入居の年に使う範囲（年。これまでの制度の最も長い控除期間） */
const UNKNOWN_PERIOD = 13;
const PERIODS = ["new", "newOther", "used", "usedOther"].map((k) => `${C}.period.${k}`);

export default defineComponent<{ member: string }, { from: number; to: number } | { from: null; to: null }>({
  id: "tax.housingLoanCreditYears",
  title: "住宅借入金等特別控除を受けうる年分",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: [`${C}.rate`, ...PERIODS],
  reads: ["debt.kind", "debt.debtors", "debt.housing"],
  input: "member.input",
  output: "tax.housingLoanCreditYears.output",
  compute(input, ctx) {
    let from: number | null = null;
    let to: number | null = null;
    for (const d of ctx.list<DebtInput>("debt")) {
      const h = d.housing;
      if (d.kind !== "mortgage" || h === undefined || h.creditDisabled === true || !d.debtors.some((x) => x.member === input.member && x.role !== "guarantor")) continue;
      const moveYear = yearOf(ctx.time.resolve({ event: h.moveIn }));
      const at = ctx.at(monthIndex(moveYear, 12));
      const opts = { anchorEvent: h.moveIn };
      // 値の無い入居の年（令和3年以前など）は、控除の部品が N_PARAM_MISSING で知らせるように、最も長い控除期間の範囲にする
      let period = UNKNOWN_PERIOD;
      if (at.has(`${C}.rate`, opts)) {
        const other = h.propertyType === "other";
        period = at.paramCount(`${C}.period.${h.newBuild ? (other ? "newOther" : "new") : other ? "usedOther" : "used"}`, opts) ?? 1;
      }
      const last = moveYear + Math.max(period, 1) - 1;
      if (from === null || moveYear < from) from = moveYear;
      if (to === null || last > to) to = last;
    }
    return from === null || to === null ? { from: null, to: null } : { from, to };
  },
});

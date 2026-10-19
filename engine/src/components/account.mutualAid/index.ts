// 小規模企業共済（資産の器の種類 smallBusinessMutualAid。構成員ごと）。
// - 掛金: 器の積立（contributions の月額。制度データの下限・上限で止める）を決済口座から払う（cf.transfer.mutualAid）。
//   全額が小規模企業共済等掛金控除（tax.deductions が paid を読む）
// - 残高: 時価（marketValue）＋掛金に、資産の配分（assetMix）があればその利回りで、無ければ0で運用益を足す（0003 の3。共済金の額の表
//   （基本共済金・付加共済金）は持たないので、掛金の累計からの近似。知らせ N_APPROXIMATED）
// - 受け取り（payout）: start の月に、一括（lumpSum。退職所得）・分割（annuity。annuityYears 年（10年か15年）、年6回。公的年金等の雑所得）・
//   併用（mixed。一括の割合 lumpShare）。分割の額は、受け取りの始まりの残高を回数で等分する（分割の間の利息は扱わない）。
//   分割で受け取る間は、まだ受け取っていない額を年末の残高に残す
//   一括は退職所得の一時金（勤続期間は加入の始まり enrolledSince〜受け取りの前の月。掛金納付月数の近似）として retirement.receipts に渡す
import {
  accountReturnRate,
  addMonths,
  addYen,
  annualReturn,
  boxValue,
  defineComponent,
  formatYm,
  monthOf,
  parseYm,
  RATE_ZERO,
  yearOf,
  yen,
  type AccountInput,
  type AnnuityPayment,
  type Flow,
  type IdecoAccountYear,
  type MonthIndex,
  type MutualAidOutput,
  type RetirementReceipt,
  type Yen,
} from "../../sdk/index.ts";

const P = { min: "smallBusinessMutualAid.contribution.monthlyMin", max: "smallBusinessMutualAid.contribution.monthlyMax", perYear: "smallBusinessMutualAid.installment.paymentsPerYear" };

export default defineComponent<{ member: string }, MutualAidOutput>({
  id: "account.mutualAid",
  title: "小規模企業共済の残高と受け取り",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: Object.values(P),
  reads: [
    "account.kind",
    "account.owner",
    "account.marketValue",
    "account.assetMix",
    "account.contributions",
    "account.enrolledSince",
    "account.payout",
    "assumptions.investmentReturn",
    "assumptions.assetReturns",
  ],
  memberScope: ["account"],
  input: "member.input",
  output: "account.mutualAid.output",
  compute(input, ctx) {
    const member = input.member;
    const list = ctx.list<AccountInput>("account").filter((a) => a.kind === "smallBusinessMutualAid");
    if (list.length === 0) return { flows: [], accounts: [], receipts: [], annuities: [], paid: [] };
    const { base, end } = ctx.time;
    const flows: Flow[] = [];
    const accounts: MutualAidOutput["accounts"][number][] = [];
    const receipts: RetirementReceipt[] = [];
    const annuities: AnnuityPayment[] = [];
    const paid: AnnuityPayment[] = [];
    let capped = false;
    for (const a of list) {
      const payout = a.payout;
      const start: MonthIndex | null = payout?.start === undefined ? null : ctx.time.resolve(payout.start);
      // 掛金（受け取りの前の月まで）
      const byYear = new Map<number, Map<number, Yen>>();
      for (const c of a.contributions) {
        const from = ctx.time.resolve(c.from);
        const to0 = c.to === null ? end : ctx.time.resolve(c.to);
        const to = start !== null && to0 >= start ? addMonths(start, -1) : to0;
        for (let m = from < base ? base : from; m <= to && m <= end; m = addMonths(m, 1)) {
          const at = ctx.at(m);
          const max = at.paramYen(P.max);
          const min = at.paramYen(P.min) ?? yen(0);
          let v = c.monthly;
          if (max !== null && v > max) v = max;
          if (v < min) v = yen(0);
          if (v !== c.monthly) capped = true;
          if (v <= 0) continue;
          const months = byYear.get(yearOf(m)) ?? new Map<number, Yen>();
          months.set(monthOf(m), addYen(months.get(monthOf(m)) ?? yen(0), v));
          byYear.set(yearOf(m), months);
          paid.push({ ym: formatYm(m), amount: v, object: a.id });
          flows.push({ row: "cf.transfer.mutualAid", ym: formatYm(m), amount: v, accrualYear: yearOf(m), member, object: a.id, formula: "account.mutualAid.contribution" });
        }
      }
      const sumBefore = (y: number, month: number) => {
        let s = yen(0);
        for (const [mo, v] of byYear.get(y) ?? []) if (mo < month) s = addYen(s, v);
        return s;
      };
      const total = (y: number) => sumBefore(y, 13);
      let v: Yen = boxValue(a.marketValue) ?? yen(0);
      const years: IdecoAccountYear[] = [];
      const n = payout?.method === "lumpSum" ? 0 : (payout?.annuityYears ?? 10);
      const perYear = ctx.at(base).paramCount(P.perYear) ?? 6;
      // 分割で受け取る分の、年ごとの受け取りの額
      const installmentsByYear = new Map<number, Yen>();
      let pending = yen(0);
      for (let y = yearOf(base); y <= yearOf(end); y++) {
        if (start !== null && yearOf(start) < y) {
          const got = installmentsByYear.get(y) ?? yen(0);
          pending = yen(pending - got);
          years.push({ year: y, contributions: yen(0), payout: got, returns: yen(0), closing: pending });
          continue;
        }
        const months = y === yearOf(base) ? 13 - monthOf(base) : 12;
        const r = a.assetMix === undefined ? RATE_ZERO : accountReturnRate(ctx, a, y);
        const contrib = total(y);
        if (start === null || yearOf(start) !== y || start < base) {
          const ret = annualReturn(ctx, v, contrib, r, months);
          v = addYen(addYen(v, contrib), ret);
          years.push({ year: y, contributions: contrib, payout: yen(0), returns: ret, closing: v });
          continue;
        }
        // 受け取りの年: 受け取りの月までの運用益と掛金の後に、全部を受け取る（分割の分は受け取りの始まりの残高を回数で等分して払う）
        const elapsed = y === yearOf(base) ? start - base : monthOf(start) - 1;
        const before = sumBefore(y, monthOf(start));
        const ret = annualReturn(ctx, v, before, r, elapsed);
        const balance = addYen(addYen(v, before), ret);
        const lumpShare = payout?.method === "mixed" ? ctx.rate.of(payout.lumpShare ?? "0") : null;
        const lump = payout?.method === "lumpSum" ? balance : lumpShare === null ? yen(0) : ctx.money.mulRate(balance, lumpShare, "conv.retirement.annuity");
        if (lump > 0) {
          flows.push({ row: "cf.income.lumpSum.smallBusiness", ym: formatYm(start), amount: lump, accrualYear: y, member, object: a.id, formula: "account.mutualAid.lumpSum" });
          const since = a.enrolledSince === undefined ? start : parseYm(a.enrolledSince);
          receipts.push({ ym: formatYm(start), amount: lump, object: a.id, source: "mutualAid", serviceFrom: formatYm(since), serviceTo: formatYm(addMonths(start, -1)) });
        }
        const rest = yen(balance - lump);
        if (rest > 0 && n > 0) {
          const parts = ctx.money.allocate(rest, Array.from({ length: n * perYear }, () => 1), "conv.retirement.annuity", "first");
          parts.forEach((amount, i) => {
            const m = addMonths(start, Math.floor((i * 12) / perYear));
            if (m > end) return;
            annuities.push({ ym: formatYm(m), amount, object: a.id });
            installmentsByYear.set(yearOf(m), addYen(installmentsByYear.get(yearOf(m)) ?? yen(0), amount));
            flows.push({ row: "cf.income.corporatePension.smallBusiness", ym: formatYm(m), amount, accrualYear: yearOf(m), member, object: a.id, formula: "account.mutualAid.installment" });
          });
        }
        v = yen(0);
        const gotNow = installmentsByYear.get(y) ?? yen(0);
        pending = n > 0 ? yen(rest - gotNow) : yen(0);
        years.push({ year: y, contributions: contrib, payout: addYen(lump, gotNow), returns: ret, closing: pending });
      }
      accounts.push({ object: a.id, years });
    }
    if (capped) ctx.notice("N_LIMIT_APPLIED", [P.max]);
    ctx.notice("N_APPROXIMATED", ["smallBusinessMutualAid.benefitAmount"]);
    const byYm = (x: { ym: string }, y: { ym: string }) => (x.ym < y.ym ? -1 : x.ym > y.ym ? 1 : 0);
    receipts.sort(byYm);
    annuities.sort(byYm);
    paid.sort(byYm);
    return { flows, accounts, receipts, annuities, paid };
  },
});

// 小規模企業共済（資産の器の種類 smallBusinessMutualAid。構成員ごと）。
// - 掛金: 器の積立（contributions の月額。制度データの下限・上限で止める）を決済口座から払う（cf.transfer.mutualAid）。
//   全額が小規模企業共済等掛金控除（tax.deductions が paid を読む）
// - 残高: 時価（marketValue）＋掛金に、資産の配分（assetMix）があればその利回りで、無ければ0で運用益を足す（0003 の3。共済金の額の表
//   （基本共済金・付加共済金）は持たないので、掛金の累計からの近似。知らせ N_APPROXIMATED）
// - 受け取り（payout）: start の月に、一括（lumpSum。退職所得）・分割（annuity。annuityYears 年（10年か15年）、年6回。公的年金等の雑所得）・
//   併用（mixed。一括の割合 lumpShare）。分割の額は、受け取りの始まりの残高を回数で等分する（分割の間の利息は扱わない）。
//   分割で受け取る間は、まだ受け取っていない額を年末の残高に残す
//   一括は退職所得の一時金（勤続期間は加入の始まり enrolledSince〜受け取りの前の月。掛金納付月数の近似）として retirement.receipts に渡す
// - 改訂2（0137）: 預金の利回り（assumptions.depositReturn）を読む。預金・外貨預金の資産クラス（cash.deposit・cash.foreign）が前提の資産クラスごとの利回りに無いときの利回り（省略は運用利回りで、前の要求は今までどおり。0137）
// - 改訂3（0164）: 併用（mixed）の一括の割合（lumpShare）の省略を半分にする（画面の空欄と同じ。0050）。前は0（全額を分割）だった
// - 改訂4（0165）: 共済契約者の死亡（万一の想定 contingency.event）: 死亡の月の翌月に、その時の残高を死亡を事由とする共済金として遺族
//   （死亡の当時の配偶者。いなければ子）が一時金で受け取る（account.ideco の死亡一時金と同じ形）。みなし相続財産（相続税法3条1項2号の
//   退職手当金等）で、退職所得・雑所得の税をかけないので receipts・annuities に入れない（知らせ N_INHERITANCE_TAX）。分割の受け取りの間に
//   亡くなったら、まだ受け取っていない分割の分を同じ月に遺族へ一時金で渡す。前は死亡を見ず、生前の受け取りの予定どおりに亡くなった人の
//   所得として受け取った
import {
  accountReturnRate,
  addMonths,
  addYen,
  annualReturn,
  boxValue,
  childrenOf,
  defineComponent,
  formatYm,
  monthOf,
  parseYm,
  RATE_ZERO,
  spousesAt,
  yearOf,
  yen,
  type AccountInput,
  type AnnuityPayment,
  type ContingencyEventOutput,
  type Flow,
  type IdecoAccountYear,
  type MemberInput,
  type MonthIndex,
  type MutualAidOutput,
  type RelationInput,
  type RetirementReceipt,
  type Yen,
} from "../../sdk/index.ts";

const P = { min: "smallBusinessMutualAid.contribution.monthlyMin", max: "smallBusinessMutualAid.contribution.monthlyMax", perYear: "smallBusinessMutualAid.installment.paymentsPerYear" };

export default defineComponent<{ member: string }, MutualAidOutput>({
  id: "account.mutualAid",
  title: "小規模企業共済の残高と受け取り",
  contract: "1.0",
  revision: 5,
  requires: { "contingency.event": ">=1 <2" },
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
    "assumptions.depositReturn",
    "member.kind",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
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
    // 死亡の月の翌月（死亡を事由とする共済金）と受け取る遺族（改訂3）
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member }).event;
    const deathPay = ev !== null && ev.kind === "death" ? addMonths(parseYm(ev.month), 1) : null;
    let heir = member;
    if (deathPay !== null) {
      const relations = ctx.list<RelationInput>("relation");
      heir = spousesAt(ctx, relations, member, addMonths(deathPay, -1))[0] ?? childrenOf(ctx.list<MemberInput>("member"), relations, member)[0]?.id ?? member;
    }
    const deathFlow = (ym: MonthIndex, amount: Yen, object: string) => {
      flows.push({ row: "cf.income.lumpSum.inheritance", ym: formatYm(ym), amount, accrualYear: yearOf(ym), member: heir, object, formula: "account.mutualAid.deathLumpSum" });
      ctx.notice("N_INHERITANCE_TAX", ["account.mutualAid.deathLumpSum", object]);
    };
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
        // 亡くなった後（改訂3）: 死亡の年の後は残高も受け取りも無い
        if (deathPay !== null && y > yearOf(deathPay)) {
          years.push({ year: y, contributions: yen(0), payout: yen(0), returns: yen(0), closing: yen(0) });
          continue;
        }
        // 受け取りが始まる前に亡くなった（改訂3）: 死亡の月の翌月までの運用益と掛金を足した残高を、遺族が一時金で受け取る
        if (deathPay !== null && y === yearOf(deathPay) && deathPay >= base && (start === null || start >= deathPay || yearOf(start) > y)) {
          const elapsed = y === yearOf(base) ? deathPay - base : monthOf(deathPay) - 1;
          const before = sumBefore(y, monthOf(deathPay));
          const r = a.assetMix === undefined ? RATE_ZERO : accountReturnRate(ctx, a, y);
          const ret = annualReturn(ctx, v, before, r, elapsed);
          const balance = addYen(addYen(v, before), ret);
          if (balance > 0 && deathPay <= end) deathFlow(deathPay, balance, a.id);
          v = yen(0);
          years.push({ year: y, contributions: before, payout: balance, returns: ret, closing: yen(0) });
          continue;
        }
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
        // 併用の一括の割合の省略は半分（画面の空欄と同じ。0050・改訂3）
        const lumpShare = payout?.method === "mixed" ? ctx.rate.of(payout.lumpShare ?? "0.5") : null;
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
      // 分割の受け取りの間に亡くなった（改訂3）: 死亡の月の翌月から後の分割の分を、その月に遺族へ一時金で渡す
      if (deathPay !== null && start !== null && start < deathPay) {
        const dp = formatYm(deathPay);
        let rest = yen(0);
        for (let i = annuities.length - 1; i >= 0; i--) {
          const x = annuities[i] as AnnuityPayment;
          if (x.object !== a.id || x.ym < dp) continue;
          rest = addYen(rest, x.amount);
          annuities.splice(i, 1);
        }
        for (let i = flows.length - 1; i >= 0; i--) {
          const f = flows[i] as Flow;
          if (f.object === a.id && f.formula === "account.mutualAid.installment" && f.ym >= dp) flows.splice(i, 1);
        }
        if (rest > 0) {
          if (deathPay <= end) deathFlow(deathPay, rest, a.id);
          for (let i = 0; i < years.length; i++) {
            const e = years[i] as IdecoAccountYear;
            if (e.year < yearOf(deathPay)) continue;
            const got = annuities.filter((x) => x.object === a.id && yearOf(parseYm(x.ym)) === e.year).reduce((s0, x) => addYen(s0, x.amount), yen(0));
            const lumpNow = e.year === yearOf(start) ? receipts.filter((x) => x.object === a.id).reduce((s0, x) => addYen(s0, x.amount), yen(0)) : yen(0);
            years[i] = { ...e, payout: e.year === yearOf(deathPay) ? addYen(addYen(got, lumpNow), rest) : yen(0), closing: yen(0) };
          }
        }
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

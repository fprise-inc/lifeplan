// iDeCo・企業型DC の器ごとの残高（運用益は 0003 の規約で年に1回）と受け取り（構成員ごと）。
// 取り崩しの順序では引き出さない（受け取りの年齢までは引き出せない）ので、世帯の残高の計算（plan.cashflow）と分けて、この部品だけで決まる。
// - 受け取りの始まりと方法は account.idecoPayout（運用利回りに依らない）
// - 受け取り（payout）: 一時金（lumpSum）は始めの月にその時の残高を、年金（annuity）は始めの月から毎年1回、その時の残高÷残りの回数を
//   annuityYears 回（最後の回は残り全部）、mixed は始めに lumpShare の割合を一時金で、残りを年金で
// - 年金で受け取る分は公的年金等の雑所得（tax.publicPensionIncome が payments を読む）。一時金の退職所得の税は tax.retirementIncome
//   （受け取りの年月と通算加入者等期間を payments に残し、retirement.receipts が集める。重複排除期間の判定に使う）
// - 死亡（改訂3。万一の想定 contingency.event）: 死亡の月の翌月に、その時の残高を死亡一時金として遺族（死亡の当時の配偶者。いなければ子）が受け取る
//   （みなし相続財産。退職所得・雑所得の税をかけないので payments に入れない。知らせ N_INHERITANCE_TAX）
// - 資産の時価の下落（ストレステスト。前提 marketShocks）: その年の年末の残高を、その割合だけ下げる（改訂4: 資産クラスを書いた下落は、
//   配分のうちその資産クラスの割合だけ。利回りは FP が入れた器の利回り・運用の費用・利回りの書き換えも見る。0026）
import {
  accountReturnRate,
  shockShare,
  addMonths,
  addYen,
  childrenOf,
  spousesAt,
  annualReturn,
  boxValue,
  defineComponent,
  formatYm,
  monthIndex,
  monthOf,
  parseYm,
  yearOf,
  yen,
  type AccountInput,
  type ContingencyEventOutput,
  type Flow,
  type MarketShock,
  type MemberInput,
  type RelationInput,
  type IdecoAccountOutput,
  type IdecoAccountYear,
  type IdecoContributionOutput,
  type IdecoPayoutPlanOutput,
  type IdecoReceipt,
  type MonthIndex,
  type Yen,
} from "../../sdk/index.ts";

export default defineComponent<{ member: string }, IdecoAccountOutput>({
  id: "account.ideco",
  title: "iDeCo・企業型DCの残高と受け取り",
  contract: "1.0",
  revision: 4,
  requires: { "account.idecoPayout": ">=1 <2", "ideco.contribution": ">=1 <2", "contingency.event": ">=1 <2" },
  params: [],
  reads: [
    "account.kind",
    "account.owner",
    "account.marketValue",
    "account.assetMix",
    "account.expectedReturn",
    "account.fee",
    "assumptions.investmentReturn",
    "assumptions.assetReturns",
    "assumptions.marketShocks",
    "assumptions.investment",
    "assumptions.returnShifts",
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
  output: "account.ideco.output",
  compute(input, ctx) {
    const member = input.member;
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const plans = ctx.call<IdecoPayoutPlanOutput>("account.idecoPayout", { member }).accounts;
    if (plans.length === 0) return { flows: [], accounts: [], payments: [] };
    const paid = ctx.call<IdecoContributionOutput>("ideco.contribution", { member }).payments;
    // 死亡の月の翌月（死亡一時金）と受け取る遺族
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member }).event;
    const deathPay = ev !== null && ev.kind === "death" ? addMonths(parseYm(ev.month), 1) : null;
    let heir = member;
    if (deathPay !== null) {
      const relations = ctx.list<RelationInput>("relation");
      heir = spousesAt(ctx, relations, member, addMonths(deathPay, -1))[0] ?? childrenOf(ctx.list<MemberInput>("member"), relations, member)[0]?.id ?? member;
    }
    const shocks = ctx.setting<readonly MarketShock[]>("marketShocks") ?? [];
    const flows: Flow[] = [];
    const receipts: IdecoReceipt[] = [];
    const out: { object: string; kind: "ideco" | "corporateDc"; years: IdecoAccountYear[] }[] = [];
    for (const plan of plans) {
      const a = ctx.get<AccountInput>("account", plan.object);
      const kind = plan.kind;
      const enrolledMonths = plan.enrolledMonths;
      const start = parseYm(plan.start);
      const method = plan.method;
      const n = plan.annuityYears;
      const lumpShare = plan.lumpShare === null ? null : ctx.rate.of(plan.lumpShare);
      const byYear = new Map<number, { total: Yen; before: Map<number, Yen> }>();
      for (const p of paid) {
        if (p.object !== a.id) continue;
        const m = parseYm(p.ym);
        if (m < base) continue;
        const y = yearOf(m);
        const e = byYear.get(y) ?? { total: yen(0), before: new Map<number, Yen>() };
        e.total = addYen(e.total, p.amount);
        e.before.set(monthOf(m), addYen(e.before.get(monthOf(m)) ?? yen(0), p.amount));
        byYear.set(y, e);
      }
      // 受け取りの年の、受け取りの月より前の掛金
      const contributedBefore = (y: number, month: number): Yen => {
        let s = yen(0);
        for (const [mo, v] of byYear.get(y)?.before ?? []) if (mo < month) s = addYen(s, v);
        return s;
      };
      let v: Yen = boxValue(a.marketValue) ?? yen(0);
      // ストレステスト: その年の年末の時価をその割合だけ下げる（運用益に含める）
      const dropOf = (x: Yen, y: number): Yen => {
        let out = x;
        for (const sh of shocks) {
          if (sh.year !== y || (sh.kinds !== undefined && !sh.kinds.includes(kind))) continue;
          // 資産クラスを書いた下落は、配分のうちその資産クラスの割合だけ（0026）
          const share = shockShare(ctx, a, sh.assetClasses);
          if (share === null) continue;
          out = yen(out - ctx.money.mulRate(out, ctx.rate.mul(ctx.rate.of(sh.drop), share), "conv.investment.return"));
        }
        return yen(x - out);
      };
      let k = 0; // 年金の受け取りの回数
      const years: IdecoAccountYear[] = [];
      const receive = (m: MonthIndex, amount: Yen, part: "lumpSum" | "annuity") => {
        if (amount <= 0) return;
        const ym = formatYm(m);
        receipts.push({ object: a.id, kind: part, ym, amount, enrolledMonths });
        const row = part === "lumpSum" ? (kind === "ideco" ? "cf.income.lumpSum.ideco" : "cf.income.lumpSum.dc") : kind === "ideco" ? "cf.income.corporatePension.ideco" : "cf.income.corporatePension.dc";
        flows.push({ row, ym, amount, accrualYear: yearOf(m), member, object: a.id, formula: `account.ideco.${part}` });
      };
      for (let y = baseYear; y <= endYear; y++) {
        const contrib = byYear.get(y)?.total ?? yen(0);
        const months = y === baseYear ? 13 - monthOf(base) : 12;
        const r = accountReturnRate(ctx, a, y);
        if (deathPay !== null && y > yearOf(deathPay)) {
          years.push({ year: y, contributions: yen(0), payout: yen(0), returns: yen(0), closing: yen(0) });
          continue;
        }
        if (deathPay !== null && y === yearOf(deathPay) && deathPay >= base) {
          // 死亡一時金: 死亡の月の翌月までの運用益と掛金を足した残高（受け取りが始まっていれば、その残り）
          const elapsed = y === baseYear ? deathPay - base : monthOf(deathPay) - 1;
          const before = contributedBefore(y, monthOf(deathPay));
          const ret = annualReturn(ctx, v, before, r, elapsed);
          const balance = addYen(addYen(v, before), ret);
          if (balance > 0) {
            flows.push({ row: "cf.income.lumpSum.inheritance", ym: formatYm(deathPay), amount: balance, accrualYear: y, member: heir, object: a.id, formula: "account.ideco.deathLumpSum" });
            ctx.notice("N_INHERITANCE_TAX", ["account.ideco.deathLumpSum", a.id]);
          }
          v = yen(0);
          years.push({ year: y, contributions: before, payout: balance, returns: ret, closing: yen(0) });
          continue;
        }
        const payMonth = monthIndex(y, monthOf(start));
        const paysThisYear = v + contrib > 0 && y >= yearOf(start) && (method === "lumpSum" ? y === yearOf(start) : k < n || (lumpShare !== null && y === yearOf(start)));
        if (!paysThisYear || payMonth < base) {
          const ret0 = annualReturn(ctx, v, contrib, r, months);
          const drop = dropOf(addYen(addYen(v, contrib), ret0), y);
          const ret = yen(ret0 - drop);
          v = addYen(addYen(v, contrib), ret);
          years.push({ year: y, contributions: contrib, payout: yen(0), returns: ret, closing: v });
          continue;
        }
        // 受け取りの月までの運用益（受け取りの月より前の月数）と、受け取りの月までの掛金
        const elapsed = y === baseYear ? payMonth - base : monthOf(start) - 1;
        const before = contributedBefore(y, monthOf(start));
        const retBefore = annualReturn(ctx, v, before, r, elapsed);
        let balance = addYen(addYen(v, before), retBefore);
        let payout = yen(0);
        if (y === yearOf(start) && method !== "annuity") {
          const lump = lumpShare === null ? balance : ctx.money.mulRate(balance, lumpShare, "conv.flow.allocate");
          receive(payMonth, lump, "lumpSum");
          payout = addYen(payout, lump);
          balance = yen(balance - lump);
        }
        if (n > 0 && k < n && balance > 0) {
          const amount = k === n - 1 ? balance : ctx.money.divInt(balance, n - k, "conv.flow.allocate");
          receive(payMonth, amount, "annuity");
          payout = addYen(payout, amount);
          balance = yen(balance - amount);
          k++;
        }
        // 受け取りの後の残りの月の掛金（受け取りを始めた後は出ない）と運用益
        const after = yen(contrib - before);
        const retAfter = balance > 0 ? annualReturn(ctx, balance, after, r, months - elapsed) : yen(0);
        const drop = dropOf(addYen(addYen(balance, after), retAfter), y);
        v = yen(addYen(addYen(balance, after), retAfter) - drop);
        years.push({ year: y, contributions: contrib, payout, returns: yen(retBefore + retAfter - drop), closing: v });
      }
      out.push({ object: a.id, kind, years });
    }
    receipts.sort((x, y) => (x.ym < y.ym ? -1 : x.ym > y.ym ? 1 : 0));
    return { flows, accounts: out, payments: receipts };
  },
});

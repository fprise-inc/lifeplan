// 計算のはじめに呼ぶ部品: お金の動きと年間収支（plan.flows）から、運用益・金融資産の残高を年ごとに出す。
// お金の動きを集めるのは plan.flows（運用利回りだけが変わったときに集め直さずに済むように分けた。0005 の追記）
import {
  addYen,
  boxValue,
  defineComponent,
  monthOf,
  yearOf,
  yen,
  type AccountInput,
  type AnnualRow,
  type Flow,
  type Yen,
} from "../../sdk/index.ts";

/** 残高に入れない器（不動産・保険の積立部分は別の部品で扱う） */
const NOT_FINANCIAL: ReadonlySet<string> = new Set(["realEstate", "insurance"]);

export default defineComponent<Record<string, never>, { flows: readonly Flow[]; annual: AnnualRow[] }>({
  id: "plan.cashflow",
  title: "キャッシュフロー表",
  contract: "1.0",
  revision: 3,
  requires: { "plan.flows": ">=1 <2" },
  params: [],
  reads: ["account.kind", "account.marketValue", "assumptions.investmentReturn"],
  input: "empty.input",
  output: "plan.cashflow.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const collected = ctx.call<{ flows: readonly Flow[]; net: readonly { year: number; amount: Yen }[] }>("plan.flows", {});
    const net = new Map(collected.net.map((x) => [x.year, x.amount]));

    // 0003 の3・5: 運用益＝(期首残高×2＋その年の収支)×年利×月数/12÷2（midYear）を1回で丸める。初年度は残りの月数で按分
    const { investmentTiming } = ctx.conventions;
    let balance: Yen = yen(0);
    for (const a of ctx.list<AccountInput>("account")) {
      if (!NOT_FINANCIAL.has(a.kind)) balance = addYen(balance, boxValue(a.marketValue) ?? yen(0));
    }
    const annual: AnnualRow[] = [];
    for (let y = baseYear; y <= endYear; y++) {
      const n = net.get(y) ?? yen(0);
      const months = y === baseYear ? 13 - monthOf(base) : 12;
      const r = ctx.rate.fraction(ctx.assumption("investmentReturn", y));
      const [amount, half] =
        investmentTiming === "midYear" ? [addYen(addYen(balance, balance), n), 2n] : investmentTiming === "beginning" ? [addYen(balance, n), 1n] : [balance, 1n];
      const ret = ctx.money.mulRatio(amount, r.num * BigInt(months), r.den * 12n * half, "conv.investment.return");
      balance = addYen(addYen(balance, n), ret);
      annual.push(
        { row: "cf.net", year: y, amount: n, formula: "plan.cashflow.net" },
        { row: "cf.balance.return", year: y, amount: ret, formula: "plan.cashflow.return" },
        { row: "cf.balance.financial", year: y, amount: balance, formula: "plan.cashflow.closing" },
      );
    }
    return { flows: collected.flows, annual };
  },
});

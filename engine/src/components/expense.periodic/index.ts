// 周期的な支出（出るお金の行。0008 の追記・0044）: 最初の支払いの月から n年ごと（同じ月）に、1回の額（計算基準年の価格。伸び方で伸ばす）を払う。終わりの月まで。
// 万一のときの扱い（onContingency）は、世帯の万一の想定（contingency.event）の月の翌月から当てる（割合は万一の後の全期間で1つ。改訂2）
// 段階と例外の年（改訂3。0040）: 支払いの月の段の額（計算基準年の価格。割合の段は1回の額×割合）を、同じ伸び方で伸ばす。
// 例外の年は、その年の支払いだけ例外の額（計算基準年の価格）にする（0円は払わない。支払いの無い年に支払いを足さない）
// 改訂4（0044）: 月額の行（monthly。最初の月から終わりの月まで毎月）。払う人（payer）を入れた行は、万一のときの扱いをその人の万一だけに当てる。
// 払う人が世帯の外の家族の行は世帯から出さない。あげる贈与（gift）は世帯から出し、受け取る人の贈与税は gift.received・gift.tax が要約に出す
// 改訂5（0044 の追記）: 相手（counterparty）が世帯の外の家族で亡くなる見込み（leaves）があれば、その月から払わない（亡くなった人へ仕送りは
//   送らない）。行の終わりがそれより後なら、知らせ N_LIMIT_APPLIED（moneyRow.counterpartyDeath・相手）を出す。行の終わりの値は書き換えない
// 改訂6（0123）: つながる物（object。資産の器の ID）を書いた行は、その器に売る予定（accounts[].sale）があれば、売る月から払わない
//   （貸していない不動産の固定資産税・管理費など）。行の終わりの値は書き換えない。つながる物の無い行の結果は同じ
import {
  COUNTERPARTY_DEATH_TOPIC,
  counterpartyStop,
  defineComponent,
  formatYm,
  isOutside,
  moneyRowPayments,
  yearOf,
  type Flow,
  type FlowsResult,
  type ContingencyEvent,
  type ContingencyEventOutput,
  type AccountInput,
  type MemberInput,
  type PeriodicExpenseInput,
} from "../../sdk/index.ts";

export default defineComponent<Record<string, never>, FlowsResult>({
  id: "expense.periodic",
  title: "何年かごとの支出（出るお金の行）",
  contract: "1.0",
  revision: 6,
  requires: { "contingency.event": ">=1 <2" },
  params: [],
  reads: [
    "member.kind",
    "member.outside",
    "member.leaves",
    "periodicExpense.counterparty",
    "periodicExpense.onContingency",
    "periodicExpense.row",
    "periodicExpense.from",
    "periodicExpense.to",
    "periodicExpense.everyYears",
    "periodicExpense.monthly",
    "periodicExpense.amount",
    "periodicExpense.growth",
    "periodicExpense.stages",
    "periodicExpense.exceptions",
    "periodicExpense.payer",
    "periodicExpense.object",
    "account.sale",
    "assumptions.inflation",
  ],
  input: "empty.input",
  output: "flows.output",
  compute(_input, ctx) {
    const flows: Flow[] = [];
    const list = ctx.list<PeriodicExpenseInput>("periodicExpense");
    const members = ctx.list<MemberInput>("member");
    // つながる物の売る月（0123）
    const soldAt = new Map<string, number>();
    if (list.some((e) => e.object !== undefined)) for (const a of ctx.list<Pick<AccountInput, "id" | "sale">>("account")) if (a.sale !== undefined) soldAt.set(a.id, ctx.time.resolve(a.sale.at));
    // 世帯の万一（世帯の行）と、払う人ごとの万一
    const byMember = new Map<string, ContingencyEvent | null>();
    const eventOf = (id: string): ContingencyEvent | null => {
      if (!byMember.has(id)) byMember.set(id, ctx.call<ContingencyEventOutput>("contingency.event", { member: id }).event);
      return byMember.get(id) ?? null;
    };
    let household: ContingencyEvent | null | undefined;
    const householdEvent = (): ContingencyEvent | null => {
      if (household === undefined) {
        household = null;
        for (const m of members) {
          const ev = eventOf(m.id);
          if (ev !== null) {
            household = ev;
            break;
          }
        }
      }
      return household;
    };
    for (const e of list) {
      const payer = e.payer === undefined ? undefined : members.find((m) => m.id === e.payer);
      // 世帯の外の家族が払う行は、世帯から出さない
      if (payer !== undefined && isOutside(payer)) continue;
      const ev = e.onContingency === undefined ? null : payer !== undefined ? eventOf(payer.id) : householdEvent();
      const stop = counterpartyStop(ctx, members, e.counterparty);
      const all = moneyRowPayments(ctx, e, ev, "conv.expense.share");
      const sold = e.object === undefined ? undefined : soldAt.get(e.object);
      const pays = stop === null && sold === undefined ? all : all.filter((p) => (stop === null || p.month < stop) && (sold === undefined || p.month < sold));
      if (stop !== null && all.some((p) => p.month >= stop) && e.counterparty !== undefined) ctx.notice("N_LIMIT_APPLIED", [COUNTERPARTY_DEATH_TOPIC, e.counterparty]);
      for (const p of pays) {
        flows.push({ row: e.row, ym: formatYm(p.month), amount: p.amount, accrualYear: yearOf(p.month), ...(payer !== undefined ? { member: payer.id } : {}), object: e.id, formula: p.contingency ? "expense.periodic.contingency" : "expense.periodic.payment" });
      }
    }
    return { flows };
  },
});

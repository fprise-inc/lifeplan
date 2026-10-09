// 保険契約1件の、保障と払込が終わる月と払込免除の月（判定だけを返す小さな部品。insurance.premiumPayment と insurance.policy が読む）。
// - 終わる月（endsAt。その月から保障も払込も無い）: 解約の月（surrender）、被保険者の死亡の月の翌月（万一の想定）、満期（主契約・満期金の
//   保障の終わりの翌月。終身は無い）の早い方
// - 払込免除（waiver が真の契約）: 被保険者の障害・就業不能の想定の月の翌月から払込が止まる（保障は続く）
import { addMonths, defineComponent, formatYm, parseYm, type ContingencyEventOutput, type InsuranceContractInput, type MonthIndex } from "../../sdk/index.ts";

type Out = { endsAt: string | null; cause: "surrender" | "death" | "maturity" | null; waiverFrom: string | null };

export default defineComponent<{ object: string }, Out>({
  id: "insurance.term",
  title: "保険契約の終わりと払込免除（判定）",
  contract: "1.0",
  revision: 1,
  requires: { "contingency.event": ">=1 <2" },
  params: [],
  reads: ["insurance.insured", "insurance.surrender", "insurance.coverages", "insurance.waiver"],
  input: "object.input",
  output: "insurance.term.output",
  compute(input, ctx) {
    const c = ctx.get<Pick<InsuranceContractInput, "id" | "insured" | "surrender" | "coverages" | "waiver">>("insurance", input.object);
    let endsAt: MonthIndex | null = null;
    let cause: Out["cause"] = null;
    const take = (m: MonthIndex, why: NonNullable<Out["cause"]>) => {
      if (endsAt === null || m < endsAt) {
        endsAt = m;
        cause = why;
      }
    };
    if (c.surrender !== undefined) take(ctx.time.resolve(c.surrender), "surrender");
    // 満期: 主契約の保障の終わり（すべての主契約に終わりがあり、満期金・年金の保障が無ければ、その後は払込も保障も無い）
    const mains = (c.coverages ?? []).filter((x) => x.role === "main");
    if (mains.length > 0 && mains.every((x) => x.to !== undefined && x.to !== null) && !mains.some((x) => x.benefit === "annuity")) {
      let last: MonthIndex | null = null;
      for (const x of mains) {
        const t = ctx.time.resolve(x.to as never);
        if (last === null || t > last) last = t;
      }
      if (last !== null) take(addMonths(last, 1), "maturity");
    }
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: c.insured }).event;
    let waiverFrom: string | null = null;
    if (ev !== null) {
      if (ev.kind === "death") take(addMonths(parseYm(ev.month), 1), "death");
      else if (c.waiver === true) waiverFrom = formatYm(addMonths(parseYm(ev.month), 1));
    }
    return { endsAt: endsAt === null ? null : formatYm(endsAt), cause, waiverFrom };
  },
});

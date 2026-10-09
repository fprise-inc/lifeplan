// 団体信用生命保険（0008 の追記 2026-10-09 の決定1）: 負債1本について、万一の想定で残高が消える月と割合を返す（判定だけを返す小さな部品）。
// debt.schedule がこれを読み、その月の返済の後の残高と、その後の返済を減らす（負債の出力を後から書き換えない。依存の追跡と使い回しが効くように）。
// - 事由: 死亡（death。死亡の月）、高度障害（highDisability。障害1級の想定の障害認定日の月）、就業不能（incapacity。障害・就業不能の想定で、
//   働けない状態が incapacityMonths（省略は12）か月続いた月。働けるようになる月がそれより前なら消えない）。がん・3大疾病・8大疾病は万一の想定に無いので扱わない
// - 割合: 夫婦連生（spouseJoint）なら、対象のどちらの事由でも1（全額）。そうでなければ保障割合（ratio）か、連帯債務の負担割合（debtors の share）、
//   どちらも無ければ1。ペアローンは2本の負債なので、亡くなった人の負債だけが消える
import { addMonths, defineComponent, formatYm, parseYm, type ContingencyEventOutput, type CreditLifeOutput, type DebtInput } from "../../sdk/index.ts";

export default defineComponent<{ object: string }, CreditLifeOutput>({
  id: "debt.creditLifeEvents",
  title: "団体信用生命保険（残高が消える月と割合）",
  contract: "1.0",
  revision: 1,
  requires: { "contingency.event": ">=1 <2" },
  params: [],
  reads: ["debt.debtors", "debt.creditLife"],
  input: "object.input",
  output: "debt.creditLifeEvents.output",
  compute(input, ctx) {
    const d = ctx.get<Pick<DebtInput, "id" | "debtors" | "creditLife">>("debt", input.object);
    const cl = d.creditLife;
    if (cl === undefined || cl.covered.length === 0) return { events: [] };
    const events: CreditLifeOutput["events"][number][] = [];
    const kinds = cl.events ?? ["death"];
    for (const member of cl.covered) {
      const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member }).event;
      if (ev === null) continue;
      let month: string | null = null;
      let cause: CreditLifeOutput["events"][number]["cause"] | null = null;
      if (ev.kind === "death" && kinds.includes("death")) {
        month = ev.month;
        cause = "death";
      } else if (ev.kind !== "death") {
        const recovery = ev.recovery === undefined ? null : parseYm(ev.recovery);
        if (kinds.includes("highDisability") && ev.kind === "disability" && ev.grade === 1 && ev.recognition !== undefined && (recovery === null || recovery > parseYm(ev.recognition))) {
          month = ev.recognition;
          cause = "highDisability";
        }
        if (kinds.includes("incapacity")) {
          const at = addMonths(parseYm(ev.month), cl.incapacityMonths ?? 12);
          if ((recovery === null || recovery > at) && (month === null || at < parseYm(month))) {
            month = formatYm(at);
            cause = "incapacity";
          }
        }
        if (kinds.some((k) => k === "cancer" || k === "threeMajor" || k === "eightMajor")) ctx.notice("N_NOT_SUPPORTED", ["debt.creditLife.illness"]);
      }
      if (month === null || cause === null) continue;
      const share = d.debtors.find((x) => x.member === member)?.share;
      const ratio = cl.spouseJoint === true ? "1" : (cl.ratio ?? (d.debtors.length > 1 && share !== undefined ? share : "1"));
      events.push({ month, ratio, cause, member });
    }
    events.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
    return { events };
  },
});

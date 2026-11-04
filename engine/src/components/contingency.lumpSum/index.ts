// 万一（死亡）のときの一時のお金（世帯。6.3）: 整理資金（葬儀・お墓など。survivor.funeral）を死亡の月の翌月に支出し、
// 勤め先からの死亡退職金・弔慰金（survivor.deathBenefits。入れたときだけ。入れなければ死亡退職金は retirement.benefit が退職給付から出す）を
// 同じ月に遺族（死亡の当時の配偶者。いなければ子）が受け取る。死亡退職金は相続税の対象（みなし相続財産。非課税の枠は500万円×法定相続人の数）、
// 弔慰金は普通給与の6か月分（業務上の死亡は3年分）までは相続税がかからない。相続税は計算せず、知らせ（N_INHERITANCE_TAX）だけを出す
import {
  addMonths,
  childrenOf,
  defineComponent,
  formatYm,
  parseYm,
  spousesAt,
  yearOf,
  type ContingencyEvent,
  type ContingencyEventOutput,
  type Flow,
  type FlowsResult,
  type MemberInput,
  type RelationInput,
  type Yen,
} from "../../sdk/index.ts";

export default defineComponent<Record<string, never>, FlowsResult>({
  id: "contingency.lumpSum",
  title: "万一のときの一時のお金（整理資金・死亡退職金・弔慰金）",
  contract: "1.0",
  revision: 1,
  requires: { "contingency.event": ">=1 <2" },
  params: [],
  reads: ["member.kind", "relation.type", "relation.a", "relation.b", "relation.from", "relation.to", "relation.parent", "relation.child"],
  replaceable: true,
  input: "empty.input",
  output: "flows.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const members = ctx.list<MemberInput>("member");
    let ev: ContingencyEvent | null = null;
    let who: string | null = null;
    for (const m of members) {
      ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: m.id }).event;
      if (ev !== null) {
        who = m.id;
        break;
      }
    }
    if (ev === null || who === null || ev.kind !== "death") return { flows: [] };
    const D = parseYm(ev.month);
    const relations = ctx.list<RelationInput>("relation");
    const heir = spousesAt(ctx, relations, who, D)[0] ?? childrenOf(members, relations, who)[0]?.id ?? null;
    const pay = addMonths(D, 1);
    const flows: Flow[] = [];
    const push = (row: string, amount: Yen | undefined, formula: string) => {
      if (amount === undefined || amount <= 0 || pay < base || pay > end) return;
      flows.push({ row, ym: formatYm(pay), amount, accrualYear: yearOf(pay), ...(heir === null ? {} : { member: heir }), formula });
    };
    push("cf.expense.lumpSum.funeral", ev.survivor?.funeral, "contingency.lumpSum.funeral");
    const db = ev.survivor?.deathBenefits;
    push("cf.income.lumpSum.retirement", db?.retirementAllowance, "contingency.lumpSum.retirementAllowance");
    push("cf.income.lumpSum.other", db?.condolence, "contingency.lumpSum.condolence");
    ctx.notice("N_INHERITANCE_TAX", ["contingency.inheritance", who]);
    return { flows };
  },
});

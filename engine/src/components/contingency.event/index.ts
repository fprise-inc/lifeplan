// 構成員の万一（0008 の5）を判定だけ返す小さな部品（0006 の追記の書き方）。万一の想定（contingencies）のうち、その構成員の物だけを読む
// （memberScope）ので、ほかの構成員の万一の年を動かしても、この構成員の部品は計算し直さない。万一の無い構成員は { event: null }。
// 働き方の期間を区切る・世帯から離れるなどの入力の重ねはエンジン（overlay.ts）が行い、この部品は遺族年金・障害年金・団信・保険・
// 遺族の生活費などの部品が読む月と種類を返す。障害認定日は初診日（起きる月）から1年6か月（制度データの月数）。
// 障害年金の65歳からの組み合わせを FP が選び直したとき（oldAgeChoice）は、それも返す（改訂2）。
// 病気の想定（illness。病気の種類・入院の日数・手術の回数。保険の医療・がんの給付に使う）も返す（改訂3。0054）
// 改訂4・約束の版 1.2（0173）: 死亡なら、亡くなった人の名義の物を受け継ぐ人（heirs）も返す。死亡の当時の配偶者が、いなければ子（亡くなる月までに
// 生まれた子。世帯を離れた子も含む。等分）が全部を相続したとみなす。どちらもいなければ出さない（名義を変えない）。名義を移すのは亡くなった月の
// 翌月から（sdk の inheritanceOf・inheritFlows）
import { addMonths, childrenOf, defineComponent, formatYm, parseYm, spousesAt, type ContingencyEventOutput, type ContingencyInput, type MemberInput } from "../../sdk/index.ts";


const RECOGNITION = "pension.disability.recognitionMonths";

export default defineComponent<{ member: string }, ContingencyEventOutput>({
  id: "contingency.event",
  title: "構成員の万一（判定）",
  contract: "1.2",
  revision: 4,
  requires: {},
  params: [RECOGNITION],
  reads: ["contingency.kind", "contingency.member", "contingency.occurs", "contingency.grade", "contingency.recovery", "contingency.oldAgeChoice", "contingency.survivor", "contingency.medical", "contingency.illness", "member.kind", "member.birth", "relation.type", "relation.a", "relation.b", "relation.from", "relation.to", "relation.parent", "relation.child"],
  memberScope: ["contingency"],
  input: "member.input",
  output: "contingency.event.output",
  compute(input, ctx) {
    const c = ctx.list<ContingencyInput>("contingency").find((x) => x.member === input.member);
    if (c === undefined) return { event: null };
    const month = ctx.time.resolve(c.occurs);
    const recovery = c.recovery === undefined ? null : ctx.time.resolve(c.recovery);
    let recognition: string | undefined;
    let heirs: string[] = [];
    if (c.kind === "death") {
      const relations = ctx.list<{ type: string; a?: string; b?: string; from?: unknown; to?: unknown; parent?: string; child?: string }>("relation");
      heirs = [...new Set(spousesAt(ctx, relations, input.member, month))].slice(0, 1);
      if (heirs.length === 0) {
        const members = ctx.list<MemberInput>("member");
        heirs = childrenOf(members, relations, input.member)
          .filter((x) => x.id !== input.member && (x.birth === undefined || parseYm(x.birth.birthYearMonth) <= month))
          .map((x) => x.id);
      }
    }
    if (c.kind !== "death") {
      const months = ctx.at(month).paramCount(RECOGNITION);
      if (months !== null) recognition = formatYm(addMonths(month, months));
    }
    return {
      event: {
        id: c.id,
        kind: c.kind,
        month: formatYm(month),
        ...(c.grade !== undefined ? { grade: c.grade } : {}),
        ...(recovery !== null ? { recovery: formatYm(recovery) } : {}),
        ...(recognition !== undefined ? { recognition } : {}),
        ...(c.oldAgeChoice !== undefined ? { oldAgeChoice: c.oldAgeChoice } : {}),
        ...(c.survivor !== undefined ? { survivor: c.survivor } : {}),
        ...(c.medical !== undefined ? { medical: c.medical } : {}),
        ...(c.illness !== undefined && c.kind !== "death" ? { illness: c.illness } : {}),
        ...(heirs.length > 0 ? { heirs } : {}),
      },
    };
  },
});

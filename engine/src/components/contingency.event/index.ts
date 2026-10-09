// 構成員の万一（0008 の5）を判定だけ返す小さな部品（0006 の追記の書き方）。万一の想定（contingencies）のうち、その構成員の物だけを読む
// （memberScope）ので、ほかの構成員の万一の年を動かしても、この構成員の部品は計算し直さない。万一の無い構成員は { event: null }。
// 働き方の期間を区切る・世帯から離れるなどの入力の重ねはエンジン（overlay.ts）が行い、この部品は遺族年金・障害年金・団信・保険・
// 遺族の生活費などの部品が読む月と種類を返す。障害認定日は初診日（起きる月）から1年6か月（制度データの月数）
import { addMonths, defineComponent, formatYm, type ContingencyEventOutput, type ContingencyInput } from "../../sdk/index.ts";


const RECOGNITION = "pension.disability.recognitionMonths";

export default defineComponent<{ member: string }, ContingencyEventOutput>({
  id: "contingency.event",
  title: "構成員の万一（判定）",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: [RECOGNITION],
  reads: ["contingency.kind", "contingency.member", "contingency.occurs", "contingency.grade", "contingency.recovery", "contingency.survivor", "contingency.medical"],
  memberScope: ["contingency"],
  input: "member.input",
  output: "contingency.event.output",
  compute(input, ctx) {
    const c = ctx.list<ContingencyInput>("contingency").find((x) => x.member === input.member);
    if (c === undefined) return { event: null };
    const month = ctx.time.resolve(c.occurs);
    const recovery = c.recovery === undefined ? null : ctx.time.resolve(c.recovery);
    let recognition: string | undefined;
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
        ...(c.survivor !== undefined ? { survivor: c.survivor } : {}),
        ...(c.medical !== undefined ? { medical: c.medical } : {}),
      },
    };
  },
});

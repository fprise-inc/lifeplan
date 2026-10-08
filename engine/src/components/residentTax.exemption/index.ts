// 住民税の非課税の判定（年度。前年の所得による）。均等割は合計所得金額が「基本額×人数＋加算＋（扶養があれば）扶養の加算」以下なら非課税、
// 所得割は総所得金額等が同じ形の額以下なら非課税（人数は本人・同一生計配偶者・扶養親族。16歳未満を含む）。
// 均等割の額は生活保護の級地で市町村ごとに違うが、市町村ごとの値を持たない方針（0007 の6）なので1級地の値を既定にする（見出しの notices）
import {
  defineComponent,
  monthIndex,
  parseYm,
  yen,
  type MemberInput,
  type RelationInput,
  type TotalIncomeOutput,
} from "../../sdk/index.ts";

const P = {
  pcBase: "residentTax.exemption.perCapita.perPerson",
  pcAdd: "residentTax.exemption.perCapita.addition",
  pcDep: "residentTax.exemption.perCapita.dependentAddition",
  ilBase: "residentTax.exemption.incomeLevy.perPerson",
  ilAdd: "residentTax.exemption.incomeLevy.addition",
  ilDep: "residentTax.exemption.incomeLevy.dependentAddition",
  depLimit: "residentTax.dependentIncomeLimit",
};

export default defineComponent<{ member: string; fiscalYear: number }, { perCapitaExempt: boolean; incomeLevyExempt: boolean; persons: number }>({
  id: "residentTax.exemption",
  title: "住民税の非課税の判定",
  contract: "1.0",
  revision: 2,
  requires: { "tax.totalIncome": ">=1 <2", "tax.incomeOrder": ">=1 <2", "tax.incomeWithin": ">=1 <2" },
  params: Object.values(P),
  reads: ["member.kind", "member.birth", "member.joins", "member.leaves", "member.support", "relation.type", "relation.a", "relation.b", "relation.marriage"],
  input: "residentTax.annual.input",
  output: "residentTax.exemption.output",
  compute(input, ctx) {
    const { member, fiscalYear } = input;
    const year = fiscalYear - 1;
    const at = ctx.at(monthIndex(fiscalYear, 6));
    const own = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year }).total;
    const dec = monthIndex(year, 12);
    const members = ctx.list<MemberInput>("member").filter(
      (m) =>
        parseYm(m.birth.birthYearMonth) <= dec &&
        (m.joins === null || ctx.time.resolve(m.joins) <= dec) &&
        (m.leaves === null || ctx.time.resolve(m.leaves) > dec),
    );
    const limit = at.paramYen(P.depLimit) ?? 0;
    // 扶養は夫婦のうち所得の多い方（同じなら本人）が持つとみなす。ほかの人の所得は、額ではなく大小と上限以下かだけを読む
    // （tax.incomeOrder・tax.incomeWithin。配偶者の年収が変わっても判定が同じなら、本人の判定を計算し直さない）
    const earners = members.filter((m) => m.kind === "self" || m.kind === "spouse");
    let best: MemberInput | undefined;
    for (const m of earners) {
      if (best === undefined) {
        best = m;
        continue;
      }
      const order = ctx.call<{ order: -1 | 0 | 1 }>("tax.incomeOrder", { a: m.id, b: best.id, year }).order;
      if (order > 0 || (order === 0 && m.kind === "self" && best.kind !== "self")) best = m;
    }
    const claimant = best?.id;
    const withinLimit = (id: string) => ctx.call<{ within: boolean }>("tax.incomeWithin", { member: id, year, limit }).within;
    let persons = 1;
    let dependents = 0;
    const spouses = new Set(
      ctx
        .list<RelationInput>("relation")
        .flatMap((r) => (r.type === "spouse" && r.marriage === "legal" && (r.a === member || r.b === member) ? [r.a === member ? r.b : r.a] : [])),
    );
    for (const m of members) {
      if (m.id === member || !withinLimit(m.id)) continue;
      if (spouses.has(m.id)) {
        persons++;
        dependents++;
      } else if (claimant === member && (m.kind === "child" || ((m.kind === "parent" || m.kind === "grandparent") && m.support?.dependent === true))) {
        persons++;
        dependents++;
      }
    }
    const threshold = (b: string, a: string, d: string) =>
      at.money.mulRatio(at.paramYen(b) ?? yen(0), persons, 1, "conv.exact") + (at.paramYen(a) ?? 0) + (dependents > 0 ? (at.paramYen(d) ?? 0) : 0);
    ctx.notice("N_DEFAULT_USED", ["residentTax.exemption.perCapita.gradeOne"]);
    return {
      perCapitaExempt: own <= threshold(P.pcBase, P.pcAdd, P.pcDep),
      incomeLevyExempt: own <= threshold(P.ilBase, P.ilAdd, P.ilDep),
      persons,
    };
  },
});

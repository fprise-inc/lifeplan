// 構成員の退職所得になる一時金を集める（月の昇順）: 退職手当等（退職一時金・DB・公務員の退職手当・役員退職慰労金。retirement.benefit）、
// 確定拠出年金の老齢給付金の一時金（iDeCo・企業型DC。account.ideco。勤続期間の代わりに、通算加入者等期間の始まりから
// 掛金を払った最後の月（無ければ受け取りの前の月）までの期間とみなす。運用指図者の期間は勤続期間に入れない）、
// 小規模企業共済の共済金（account.mutualAid）。計算基準月より前に受け取った一時金も入る（重複排除期間の判定に使う）。
// 退職所得の税（tax.retirementIncome）が、その年と前の年の分だけを読む（ctx.callMonths）
import {
  addMonths,
  defineComponent,
  formatYm,
  parseYm,
  type IdecoAccountOutput,
  type IdecoContributionOutput,
  type MutualAidOutput,
  type RetirementBenefitOutput,
  type RetirementReceipt,
} from "../../sdk/index.ts";

export default defineComponent<{ member: string }, { receipts: RetirementReceipt[] }>({
  id: "retirement.receipts",
  title: "退職所得になる一時金（集める）",
  contract: "1.0",
  revision: 1,
  requires: { "retirement.benefit": ">=1 <2", "account.dcList": ">=1 <2", "account.ideco": ">=1 <2", "account.mutualAid": ">=1 <2", "ideco.contribution": ">=1 <2" },
  params: [],
  reads: [],
  input: "member.input",
  output: "retirement.receipts.output",
  compute(input, ctx) {
    const member = input.member;
    const receipts: RetirementReceipt[] = [...ctx.call<RetirementBenefitOutput>("retirement.benefit", { member }).receipts];
    if (ctx.call<{ ids: string[] }>("account.dcList", { member }).ids.length > 0) {
      const paid = ctx.call<IdecoContributionOutput>("ideco.contribution", { member }).payments;
      for (const p of ctx.call<IdecoAccountOutput>("account.ideco", { member }).payments) {
        if (p.kind !== "lumpSum") continue;
        const m = parseYm(p.ym);
        const last = paid.filter((x) => x.object === p.object && x.ym < p.ym).at(-1)?.ym;
        const to = last === undefined ? addMonths(m, -1) : parseYm(last);
        receipts.push({ ym: p.ym, amount: p.amount, object: p.object, source: "dc", serviceFrom: formatYm(addMonths(m, -Math.max(1, p.enrolledMonths))), serviceTo: formatYm(to) });
      }
    }
    for (const r of ctx.call<MutualAidOutput>("account.mutualAid", { member }).receipts) receipts.push(r);
    receipts.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : a.object < b.object ? -1 : a.object > b.object ? 1 : 0));
    return { receipts };
  },
});

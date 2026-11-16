// 構成員の退職所得になる一時金を集める（月の昇順）: 退職手当等（退職一時金・DB・公務員の退職手当・役員退職慰労金。retirement.benefit）、
// 確定拠出年金の老齢給付金の一時金（iDeCo・企業型DC。account.ideco。勤続期間の代わりに、掛金を納付した加入者期間（所得税法施行令69条1項2号
// ただし書。企業型は事業主掛金、iDeCo は加入者掛金を納付した月。60歳以後に掛けた月を含む。運用指図者の期間・掛金を止めていた月は入れない）。
// 計算基準月より前は account.idecoPayout の serviceBeforeBase、計算基準月からは ideco.contribution の掛金を払った月（受け取りの月より前）。
// 改訂2（0003 の追記 2026-11-15）: 前は受け取りの月から60歳の前の月までの加入の月数だけさかのぼった月を始まりにしていた）、
// 小規模企業共済の共済金（account.mutualAid）。計算基準月より前に受け取った一時金も入る（重複排除期間の判定に使う）。
// 退職所得の税（tax.retirementIncome）が、その年と前の年の分だけを読む（ctx.callMonths）
import {
  addMonths,
  defineComponent,
  formatYm,
  parseYm,
  type IdecoAccountOutput,
  type IdecoContributionOutput,
  type IdecoPayoutPlanOutput,
  type MonthIndex,
  type MutualAidOutput,
  type RetirementBenefitOutput,
  type RetirementReceipt,
} from "../../sdk/index.ts";

export default defineComponent<{ member: string }, { receipts: RetirementReceipt[] }>({
  id: "retirement.receipts",
  title: "退職所得になる一時金（集める）",
  contract: "1.1",
  revision: 2,
  requires: { "retirement.benefit": ">=1 <2", "account.dcList": ">=1 <2", "account.ideco": ">=1 <2", "account.idecoPayout": ">=1 <2", "account.mutualAid": ">=1 <2", "ideco.contribution": ">=1 <2" },
  params: [],
  reads: [],
  input: "member.input",
  output: "retirement.receipts.output",
  compute(input, ctx) {
    const member = input.member;
    const receipts: RetirementReceipt[] = [...ctx.call<RetirementBenefitOutput>("retirement.benefit", { member }).receipts];
    if (ctx.call<{ ids: string[] }>("account.dcList", { member }).ids.length > 0) {
      const paid = ctx.call<IdecoContributionOutput>("ideco.contribution", { member }).payments;
      const plans = ctx.call<IdecoPayoutPlanOutput>("account.idecoPayout", { member }).accounts;
      const base = ctx.time.base;
      const unknown = new Set<string>();
      for (const p of ctx.call<IdecoAccountOutput>("account.ideco", { member }).payments) {
        if (p.kind !== "lumpSum") continue;
        const m = parseYm(p.ym);
        const plan = plans.find((x) => x.object === p.object);
        // 掛金を納付した月（計算基準月より前はみなしの期間、計算基準月からは払った月。受け取りの月より前）
        const months = new Set<MonthIndex>();
        for (const r of plan?.serviceBeforeBase ?? []) for (let k = parseYm(r.from); k <= parseYm(r.to) && k < m; k = addMonths(k, 1)) months.add(k);
        for (const x of paid) if (x.object === p.object && x.ym < p.ym && parseYm(x.ym) >= base) months.add(parseYm(x.ym));
        if (plan?.serviceKnown === false) unknown.add(p.object);
        const sorted = [...months].sort((a, b) => a - b);
        if (sorted.length === 0) {
          // 掛金を払った月が無い（加入の始まりも積立も無い）: 受け取りの前の月の1か月とみなす（勤続年数は1年）
          const prev = formatYm(addMonths(m, -1));
          receipts.push({ ym: p.ym, amount: p.amount, object: p.object, source: "dc", serviceFrom: prev, serviceTo: prev });
          continue;
        }
        const periods: { from: string; to: string }[] = [];
        let from = sorted[0] as MonthIndex;
        let prev = from;
        for (const k of sorted.slice(1)) {
          if (k !== prev + 1) {
            periods.push({ from: formatYm(from), to: formatYm(prev) });
            from = k;
          }
          prev = k;
        }
        periods.push({ from: formatYm(from), to: formatYm(prev) });
        receipts.push({
          ym: p.ym,
          amount: p.amount,
          object: p.object,
          source: "dc",
          serviceFrom: periods[0]?.from as string,
          serviceTo: periods.at(-1)?.to as string,
          ...(periods.length > 1 ? { servicePeriods: periods } : {}),
        });
      }
      // 加入の始まりが無く、計算基準月より前の積立も無い: 勤続年数を計算基準月（か積立の始まり）から数えている
      for (const id of [...unknown].sort()) ctx.notice("N_ASSUMED", ["ideco.lumpSumServiceEstimated", id]);
    }
    for (const r of ctx.call<MutualAidOutput>("account.mutualAid", { member }).receipts) receipts.push(r);
    receipts.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : a.object < b.object ? -1 : a.object > b.object ? 1 : 0));
    return { receipts };
  },
});

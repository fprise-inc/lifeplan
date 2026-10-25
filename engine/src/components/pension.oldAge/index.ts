// 老齢年金（老齢基礎年金・老齢厚生年金・特別支給の老齢厚生年金）の月ごとの額と、偶数月に前2か月分を払うお金の動き（0003 の2）
// - 月ごとの額は pension.oldAgeBase が計算する（繰上げ・繰下げ・在職老齢年金・加給年金・振替加算・特別支給・万一の死亡の月まで）
// - 障害の想定で65歳から障害年金と選ぶとき（0008 の追記 2026-10-10 の決定2）: pension.disability が手取りの多い組み合わせ（障害基礎＋障害厚生・
//   老齢基礎＋老齢厚生・障害基礎＋老齢厚生）を選ぶので、選ばれなかった老齢年金の部分（基礎・厚生）をその月から止める（改訂6）。
//   pension.disability は選ぶ前の額を pension.oldAgeBase から読む（循環しない）
// - 配偶者が障害年金（障害基礎年金・障害厚生年金）を受ける月は、配偶者の加給年金額（pension.oldAgeBase の spouseSupplement）を止める
//   （厚生年金保険法46条6項。改訂7）。配偶者が65歳から老齢年金を選んで障害年金を受けない月は止めない
// - 支払い: 偶数月に前2か月分。各支払いの1円未満を切り捨て、年度の切り捨ての合計を2月の支払いに足す
import {
  addMonths,
  defineComponent,
  formatYm,
  monthIndex,
  monthOf,
  parseYm,
  spousesAt,
  yearOf,
  yen,
  type ContingencyEventOutput,
  type DisabilityPensionOutput,
  type Flow,
  type PensionMonth,
  type PensionPayment,
  type RelationInput,
} from "../../sdk/index.ts";

const PAY_ROUND = "pension.payment.rounding";

type Out = { flows: Flow[]; payments: PensionPayment[]; months: PensionMonth[] };

export default defineComponent<{ member: string }, Out>({
  id: "pension.oldAge",
  title: "老齢年金",
  contract: "1.0",
  revision: 7,
  requires: {
    "pension.oldAgeBase": ">=1 <2",
    "pension.disability": ">=1 <2",
    "contingency.event": ">=1 <2",
  },
  params: [PAY_ROUND],
  reads: ["relation.type", "relation.a", "relation.b", "relation.from", "relation.to"],
  input: "member.input",
  output: "pension.oldAge.output",
  compute(input, ctx) {
    const member = input.member;
    const base = ctx.call<{ months: readonly PensionMonth[] }>("pension.oldAgeBase", { member }).months;
    if (base.length === 0) return { flows: [], payments: [], months: [] };
    let months: readonly PensionMonth[] = base;
    // 障害年金と選ぶ月（65歳から）: 選ばれなかった部分を止める
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member }).event;
    if (ev !== null && ev.kind === "disability" && ev.grade !== undefined) {
      const choice = ctx.call<DisabilityPensionOutput>("pension.disability", { member }).choices ?? [];
      if (choice.length > 0) {
        const comboAt = (ym: string) => choice.find((c) => c.from <= ym && ym <= c.to)?.combination ?? null;
        months = months.map((x) => {
          const c = comboAt(x.month);
          if (c === "disability") return { ...x, basic: yen(0), employee: yen(0), special: yen(0) };
          if (c === "disabilityBasicOldAgeEmployee") return { ...x, basic: yen(0) };
          return x;
        });
      }
    }

    // 配偶者が障害年金を受ける月は、配偶者の加給年金額を止める（46条6項）
    if (months.some((x) => (x.spouseSupplement ?? 0) > 0)) {
      const relations = ctx.list<RelationInput>("relation");
      const disabled = new Map<string, Set<string>>();
      const receives = (sp: string, ym: string): boolean => {
        let set = disabled.get(sp);
        if (set === undefined) {
          set = new Set(ctx.call<DisabilityPensionOutput>("pension.disability", { member: sp }).months.filter((x) => x.basic + x.employee > 0).map((x) => x.month));
          disabled.set(sp, set);
        }
        return set.has(ym);
      };
      months = months.map((x) => {
        const sup = x.spouseSupplement ?? 0;
        if (sup <= 0 || !spousesAt(ctx, relations, member, parseYm(x.month)).some((sp) => receives(sp, x.month))) return x;
        return { ...x, employee: yen(Math.max(0, x.employee - sup)) };
      });
    }
    // 出力の月は約束の欄だけ（配偶者の加給年金額の内訳は出さない）
    months = months.map((x) => ({ month: x.month, basic: x.basic, employee: x.employee, special: x.special, suspended: x.suspended }));
    // 支払い: 偶数月に前2か月分。各支払いは1円未満を切り捨て、3月から翌年2月までの支払いの切り捨ての合計（1円未満は切り捨て）を
    // 2月の支払い（無ければその期間の最後の支払い）に足す（国民年金法18条の2）
    const payments: PensionPayment[] = [];
    const parts = ["basic", "employee", "special"] as const;
    for (const part of parts) {
      const pays = new Map<string, { sum: number; accrual: number }>();
      for (const x of months) {
        const a = x[part];
        if (a <= 0) continue;
        const m = parseYm(x.month);
        const paid = formatYm(addMonths(m, monthOf(m) % 2 === 1 ? 1 : 2));
        const cur = pays.get(paid) ?? { sum: 0, accrual: yearOf(m) };
        cur.sum += a;
        pays.set(paid, cur);
      }
      const remainder = new Map<number, number>();
      const lastOf = new Map<number, string>();
      const list: PensionPayment[] = [];
      for (const [ym, v] of [...pays.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const pm = parseYm(ym);
        const period = monthOf(pm) >= 3 ? yearOf(pm) : yearOf(pm) - 1;
        const amount = ctx.at(pm).money.divInt(yen(v.sum), 12, PAY_ROUND);
        remainder.set(period, (remainder.get(period) ?? 0) + (v.sum - ctx.money.mulRatio(amount, 12, 1, "conv.exact")));
        lastOf.set(period, ym);
        list.push({ ym, part, amount, accrualYear: v.accrual });
      }
      for (const [period, rem] of remainder) {
        const add = ctx.at(monthIndex(period + 1, 2)).money.divInt(yen(rem), 12, PAY_ROUND);
        if (add <= 0) continue;
        const feb = formatYm(monthIndex(period + 1, 2));
        const target = list.find((p) => p.ym === feb) ?? list.find((p) => p.ym === lastOf.get(period));
        if (target !== undefined) list[list.indexOf(target)] = { ...target, amount: yen(target.amount + add) };
      }
      payments.push(...list.filter((p) => p.amount > 0));
    }
    payments.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : a.part < b.part ? -1 : 1));
    const formula = { basic: "pension.oldAge.basic.payment", employee: "pension.oldAge.employee.payment", special: "pension.oldAge.special.payment" };
    const flows: Flow[] = payments.map((p) => ({ row: "cf.income.pension", ym: p.ym, amount: p.amount, accrualYear: p.accrualYear, member, formula: formula[p.part] }));
    return { flows, payments, months: [...months] };
  },
});

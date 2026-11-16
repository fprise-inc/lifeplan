// 個人事業税（構成員×所得の年。0155 の追記 2026-11-15）。自営の働き方の期間の事業所得（income.business。青色申告特別控除の前の額）に課す。
// - 所得: その年の自営の期間の事業所得の合計（法定業種でない期間〔業種の区分 none〕は入れない。青色申告特別控除は引かない。地方税法72条の49の12・
//   東京都主税局の説明「青色申告特別控除の適用はありませんので、所得金額に加算します」）。事業専従者控除・損失の繰越控除・社会保険診療報酬の除外・
//   入るお金の行の事業所得・事業所得の民泊や宿・不動産所得（不動産貸付業）は扱わない
// - 事業主控除: 年290万円。その年に事業を行った月数（課税の期間の月）が12か月に満たなければ、290万円×月数÷12（1,000円未満の切り上げ。同法72条の49の14）
// - 税額: (所得−事業主控除) の1,000円未満を切り捨て（課税標準）、業種の区分の税率（標準税率。第1種5%・第2種4%・第3種5%・第3種のうちあん摩・はり・
//   きゅう・柔道整復などと装蹄師業3%。同法72条の49の17）を掛け、100円未満を切り捨てる。区分の違う期間があるときは、課税標準を区分ごとの所得
//   （黒字の分）で按分する（同条2項）
// - 払う月: 翌年の8月と11月に半分ずつ（1,000円未満の端数は8月の分。同法72条の51・20条の4の2第6項）。その年のうちに事業をやめた（課税の期間が
//   その年の途中で終わり、翌月に続く課税の期間が無い。亡くなったときを含む）ときは、やめた月の2か月後（1〜3月にやめたら4月）に1回で払う
//   （同法72条の51第3項。納期は通知に書かれるので近似）。亡くなった後も亡くなった人の名で載せる（まだ払っていない税。相続人が払う）
// - 払った事業税は、払った年の事業所得の必要経費になるが、事業所得は入れた額（経費を引いた後）なので計算し直さない
import { defineComponent, formatYm, monthIndex, yen, type EmploymentPeriodInput, type Flow, type MonthIndex, type Yen } from "../../sdk/index.ts";

const P = {
  deduction: "businessTax.ownerDeduction",
  deductionRound: "businessTax.ownerDeduction.rounding",
  taxableRound: "businessTax.taxable.rounding",
  taxRound: "businessTax.tax.rounding",
  installmentRound: "businessTax.installment.rounding",
  class1: "businessTax.rate.class1",
  class2: "businessTax.rate.class2",
  class3: "businessTax.rate.class3",
  class3Reduced: "businessTax.rate.class3Reduced",
};
type TaxClass = "class1" | "class2" | "class3" | "class3Reduced";
const CLASSES: readonly TaxClass[] = ["class1", "class2", "class3", "class3Reduced"];
const ROW = "cf.taxSi.businessTax";

export interface BusinessTaxOutput {
  readonly flows: readonly Flow[];
  /** 税額（その年の所得の分） */
  readonly total: Yen;
  /** 課税の期間の事業所得の合計（青色申告特別控除の前） */
  readonly income: Yen;
  /** 事業を行った月数（課税の期間の月） */
  readonly months: number;
  /** 事業主控除 */
  readonly deduction: Yen;
  /** 課税標準（1,000円未満の切り捨ての後） */
  readonly taxable: Yen;
}

const ZERO: BusinessTaxOutput = { flows: [], total: yen(0), income: yen(0), months: 0, deduction: yen(0), taxable: yen(0) };

export default defineComponent<{ member: string; year: number }, BusinessTaxOutput>({
  id: "tax.businessTax",
  title: "個人事業税",
  contract: "1.0",
  revision: 1,
  requires: { "income.business": ">=1 <2" },
  params: Object.values(P),
  reads: ["employment.member", "employment.from", "employment.to", "employment.type", "employment.business.businessTaxClass"],
  memberScope: ["employment"],
  input: "tax.memberYear.input",
  output: "tax.businessTax.output",
  compute(input, ctx) {
    const { member, year } = input;
    const { base, end } = ctx.time;
    const classOf = (p: EmploymentPeriodInput): TaxClass | null => {
      const c = p.business?.businessTaxClass ?? "class1";
      return c === "none" ? null : c;
    };
    const periods = ctx.list<EmploymentPeriodInput>("employment").filter((p) => p.member === member && p.type === "selfEmployed" && classOf(p) !== null);
    if (periods.length === 0) return ZERO;
    const first = monthIndex(year, 1);
    const last = monthIndex(year, 12);
    // 課税の期間の月（その年の中）と、期間がその年の後も続くか
    const months = new Set<MonthIndex>();
    let lastMonth: MonthIndex | null = null;
    const ranges = periods.map((p) => ({ from: ctx.time.resolve(p.from), to: p.to === null ? null : ctx.time.resolve(p.to) }));
    for (const r of ranges) {
      const a = r.from > first ? r.from : first;
      const b = r.to === null || r.to > last ? last : r.to;
      for (let m = a; m <= b; m = (m + 1) as MonthIndex) {
        months.add(m);
        if (lastMonth === null || m > lastMonth) lastMonth = m;
      }
    }
    if (lastMonth === null) return ZERO;
    // 区分ごとの事業所得（その年の分）
    const byPeriod = new Map(periods.map((p) => [p.id, classOf(p) as TaxClass]));
    const byClass = new Map<TaxClass, number>();
    for (const f of ctx.call<{ flows: readonly Flow[] }>("income.business", { member }).flows) {
      if (f.accrualYear !== year || f.object === undefined) continue;
      const c = byPeriod.get(f.object);
      if (c === undefined) continue;
      byClass.set(c, (byClass.get(c) ?? 0) + f.amount);
    }
    const income = [...byClass.values()].reduce((s, v) => s + v, 0);
    const at = ctx.at(first);
    const full = at.paramYen(P.deduction) ?? yen(0);
    const n = months.size;
    const deduction = n >= 12 ? full : at.money.mulRatio(full, n, 12, P.deductionRound);
    const taxable = at.money.round(yen(Math.max(0, income - deduction)), P.taxableRound);
    if (taxable <= 0) return { ...ZERO, income: yen(income), months: n, deduction };
    // 区分ごとの税率。区分が2つ以上なら課税標準を区分ごとの所得（黒字の分）で按分する
    const used = CLASSES.filter((c) => (byClass.get(c) ?? 0) > 0);
    const parts = used.length <= 1 ? [taxable] : ctx.money.allocate(taxable, used.map((c) => byClass.get(c) ?? 0), "conv.flow.allocate", "first");
    const cls = used.length === 0 ? ["class1" as TaxClass] : used;
    let computed = 0;
    cls.forEach((c, i) => {
      const r = at.paramRate(P[c]);
      if (r !== null) computed += ctx.money.mulRate(yen(parts[i] ?? 0), r, "conv.tax.exact");
    });
    const total = at.money.round(yen(computed), P.taxRound);
    // 払う月
    const flows: Flow[] = [];
    const push = (m: MonthIndex, amount: number, formula: string) => {
      if (amount <= 0 || m < base || m > end) return;
      flows.push({ row: ROW, ym: formatYm(m), amount: yen(amount), accrualYear: year, member, formula });
    };
    const next = (lastMonth + 1) as MonthIndex;
    const continues = ranges.some((r) => r.from <= next && (r.to === null || r.to >= next));
    if (!continues) {
      // その年のうちにやめた（亡くなったときを含む）: やめた月の2か月後（1〜3月にやめたら4月）に1回で
      let m = (lastMonth + 2) as MonthIndex;
      if (m < monthIndex(year, 4)) m = monthIndex(year, 4);
      push(m, total, "tax.businessTax.closure");
    } else {
      const second = at.money.mulRatio(total, 1, 2, P.installmentRound);
      push(monthIndex(year + 1, 8), total - second, "tax.businessTax.installment");
      push(monthIndex(year + 1, 11), second, "tax.businessTax.installment");
    }
    return { flows, total, income: yen(income), months: n, deduction, taxable };
  },
});

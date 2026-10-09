// 介護の費用（6.10。本人・親）: 月額×期間＋一時費用。0008 の追記 2026-10-09 の決定6。
// - 介護保険の対象の費用（serviceMonthly。10割）には自己負担割合（65歳以上は前年の所得で1〜3割、65歳未満は1割）を掛け、高額介護サービス費の
//   上限（住民税が非課税なら24,600円、課税なら前年の課税所得で44,400円・93,000円・140,100円。月額。制度データ）で止める（介護を受ける人ごとの近似。
//   世帯の合算はしない）。自己負担割合の判定は、本人の合計所得金額と「年金収入＋その他の合計所得金額」（配偶者がいれば2人以上の世帯の基準。
//   配偶者の額は足さない近似）
// - 保険の対象外の費用（otherMonthly。居住費・食費など）と一時費用（initial）はそのまま
// - 何も入れないときは、統計の既定（master.care.statistics: 月額・期間・一時費用。在宅・施設の別）を保険の対象外の費用として使う（知らせ N_DEFAULT_USED。
//   統計の月額は自己負担の総額なので、自己負担割合・上限は掛けない）
// - 額は計算基準年の価格で、伸び方（省略は物価上昇率）で伸ばす。払う人（payer。省略は介護を受ける人）の行に載せる。
//   払う人の万一のときの扱い（onContingency）を当てる。介護休業給付は、働き方の期間の休業（leaveKind: care）で benefit.employment が出す
import {
  addMonths,
  ageMonth,
  boxValue,
  bracketFor,
  contingencyRatio,
  defineComponent,
  fiscalYearOf,
  formatYm,
  grownByYear,
  monthIndex,
  monthOf,
  RATE_ZERO,
  spousesAt,
  yearOf,
  yen,
  type CareExpenseInput,
  type ContingencyEventOutput,
  type ExemptionOutput,
  type Flow,
  type FlowsResult,
  type IncomeTaxOutput,
  type MonthIndex,
  type Rate,
  type RelationInput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const S = {
  monthly: "care.statistics.monthly",
  home: "care.statistics.monthlyHome",
  facility: "care.statistics.monthlyFacility",
  months: "care.statistics.months",
  initial: "care.statistics.initial",
};
const P = {
  firstAge: "socialInsurance.care.secondaryInsuredUntilAge",
  r1: "socialInsurance.care.copay.ratio1",
  r2: "socialInsurance.care.copay.ratio2",
  r3: "socialInsurance.care.copay.ratio3",
  i2: "socialInsurance.care.copay.twoTenths.incomeFrom",
  s2: "socialInsurance.care.copay.twoTenths.pensionSingle",
  c2: "socialInsurance.care.copay.twoTenths.pensionCouple",
  i3: "socialInsurance.care.copay.threeTenths.incomeFrom",
  s3: "socialInsurance.care.copay.threeTenths.pensionSingle",
  c3: "socialInsurance.care.copay.threeTenths.pensionCouple",
  cap: "socialInsurance.care.highCostService.limit",
  capExempt: "socialInsurance.care.highCostService.exemptLimit",
};

export default defineComponent<Record<string, never>, FlowsResult>({
  id: "care.expense",
  title: "介護の費用（自己負担割合・高額介護サービス費）",
  contract: "1.0",
  revision: 1,
  requires: {
    "contingency.event": ">=1 <2",
    "tax.totalIncome": ">=1 <2",
    "incomeTax.annual": ">=1 <2",
    "residentTax.exemption": ">=1 <2",
    "pension.oldAge": ">=1 <2",
  },
  params: [...Object.values(S), ...Object.values(P)],
  reads: [
    "care.member",
    "care.payer",
    "care.from",
    "care.months",
    "care.place",
    "care.serviceMonthly",
    "care.otherMonthly",
    "care.initial",
    "care.growth",
    "care.onContingency",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.from",
    "relation.to",
    "assumptions.inflation",
  ],
  input: "empty.input",
  output: "flows.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const flows: Flow[] = [];
    const list = ctx.list<CareExpenseInput>("care");
    if (list.length === 0) return { flows };
    const relations = ctx.list<RelationInput>("relation");
    // 自己負担割合と上限（介護を受ける人×年。前年の所得による）
    const cache = new Map<string, { ratio: Rate; cap: Yen | null }>();
    const ruleOf = (member: string, m: MonthIndex): { ratio: Rate; cap: Yen | null } => {
      const y = yearOf(m);
      const key = `${member}|${y}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const at = ctx.at(m);
      let ratio = at.paramRate(P.r1) ?? RATE_ZERO;
      // 65歳以上（第1号）だけ所得で判定
      if (ageMonth(ctx, m, P.firstAge, member) <= m) {
        const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year: y - 1 });
        let revenue = 0;
        for (const p of ctx.callMonths<{ ym: string; amount: Yen }>("pension.oldAge", { member }, "payments", monthIndex(y - 1, 1), monthIndex(y - 1, 12))) revenue += p.amount;
        const measure = revenue + inc.total - (inc.publicPension ?? 0);
        const couple = spousesAt(ctx, relations, member, m).length > 0;
        const v = (id: string) => at.paramYen(id) ?? yen(Number.MAX_SAFE_INTEGER);
        if (inc.total >= v(P.i3) && measure >= v(couple ? P.c3 : P.s3)) ratio = at.paramRate(P.r3) ?? ratio;
        else if (inc.total >= v(P.i2) && measure >= v(couple ? P.c2 : P.s2)) ratio = at.paramRate(P.r2) ?? ratio;
      }
      // 高額介護サービス費の上限（住民税が非課税か、前年の課税所得）
      const ex = ctx.call<ExemptionOutput>("residentTax.exemption", { member, fiscalYear: fiscalYearOf(m) });
      let cap: Yen | null;
      if (ex.perCapitaExempt) cap = at.paramYen(P.capExempt);
      else {
        const table = at.paramBrackets(P.cap);
        const taxable = ctx.call<IncomeTaxOutput>("incomeTax.annual", { member, year: y - 1 }).taxable;
        cap = table === null ? null : (bracketFor(table, taxable).amount ?? null);
      }
      const out = { ratio, cap };
      cache.set(key, out);
      return out;
    };
    for (const c of list) {
      const from = ctx.time.resolve(c.from);
      const at0 = ctx.at(from < base ? base : from);
      const months = c.months ?? at0.paramCount(S.months) ?? 0;
      const last = addMonths(from, months - 1);
      const service = c.serviceMonthly === undefined ? null : (boxValue(c.serviceMonthly) ?? null);
      let other = c.otherMonthly === undefined ? null : (boxValue(c.otherMonthly) ?? null);
      let initial = c.initial === undefined ? null : (boxValue(c.initial) ?? null);
      if (service === null && other === null) {
        other = at0.paramYen(c.place === "home" ? S.home : c.place === "facility" ? S.facility : S.monthly);
        ctx.notice("N_DEFAULT_USED", [c.id, "care.otherMonthly"]);
      }
      if (initial === null) {
        initial = at0.paramYen(S.initial);
        ctx.notice("N_DEFAULT_USED", [c.id, "care.initial"]);
      }
      if (c.months === undefined) ctx.notice("N_DEFAULT_USED", [c.id, "care.months"]);
      const payer = c.payer ?? c.member;
      const ev = c.onContingency === undefined ? null : ctx.call<ContingencyEventOutput>("contingency.event", { member: payer }).event;
      const row = c.place === "facility" ? "cf.expense.care.facility" : "cf.expense.care.nursing";
      const fy = yearOf(base);
      const ly = yearOf(end);
      const sv = service === null ? null : grownByYear(ctx, ctx.money.mulRatio(service, 12, 1, "conv.exact"), c.growth, fy, ly);
      const ot = other === null ? null : grownByYear(ctx, ctx.money.mulRatio(other, 12, 1, "conv.exact"), c.growth, fy, ly);
      const iv = initial === null ? null : grownByYear(ctx, initial, c.growth, fy, ly);
      const push = (m: MonthIndex, amount: Yen, formula: string) => {
        if (amount <= 0 || m < base || m > end) return;
        const cr = contingencyRatio(ctx, c.onContingency, ev, m);
        const a = cr === null ? amount : ctx.money.mulRate(amount, cr, "conv.expense.share");
        if (a > 0) flows.push({ row, ym: formatYm(m), amount: a, accrualYear: yearOf(m), member: payer, object: c.id, formula });
      };
      if (iv !== null) push(from, iv.get(yearOf(from)) ?? initial ?? yen(0), "care.expense.initial");
      for (let m = from; m <= last && m <= end; m = addMonths(m, 1)) {
        if (m < base) continue;
        const k = monthOf(m) - 1;
        if (sv !== null) {
          const monthly = ctx.money.allocate(sv.get(yearOf(m)) ?? yen(0), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.expense.share", "first")[k] as Yen;
          const rule = ruleOf(c.member, m);
          let copay = ctx.at(m).money.mulRate(monthly, rule.ratio, "conv.expense.share");
          if (rule.cap !== null && copay > rule.cap) copay = rule.cap;
          push(m, copay, "care.expense.service");
        }
        if (ot !== null) {
          const monthly = ctx.money.allocate(ot.get(yearOf(m)) ?? yen(0), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.expense.share", "first")[k] as Yen;
          push(m, monthly, "care.expense.other");
        }
      }
    }
    return { flows };
  },
});

// 健康保険の任意継続の保険料（年度。被保険者が全額を払う。健康保険法47条・161条）。
// 健康保険の種類が任意継続（continuation。働き方の期間の healthInsurance.kind で入れる。socialInsurance.healthStatus が始まりから2年まで）の月に、
// 資格を失ったときの標準報酬月額（協会けんぽは上限 socialInsurance.health.kyokaikenpo.continuationLimit まで）×
// 保険料率（健康保険＋40〜64歳の介護保険＋子ども・子育て支援金。折半しない）をその月に払う（前納の割引は入れない）。
// 協会けんぽの支部は、任意継続の期間の healthInsurance.insurer、無ければ前の勤め先の支部。合算した率で1回だけ円未満を切り捨て、
// 介護・支援金を同じ規則で切り捨てた額を除いた残りを健康保険にする（協会けんぽの任意継続の保険料額表）。
// 健保組合・共済の任意継続は、料率と上限が組合の規約で決まり世帯の入力が無いので計算せず、見出しの notices に N_INPUT_REQUIRED を出す
// 改訂2: 世帯の外の家族（0035 の4）の任意継続は世帯の支出にしない
// 改訂3（速さだけ。結果は同じ。0005 の追記）: まずその年度の月だけを読み（ctx.callMonths）、任意継続の月が無い年度は全期間の月を読まない
import {
  addMonths,
  ageMonth,
  boxValue,
  defineComponent,
  EMPLOYEE_TYPES,
  fiscalYearEnd,
  fiscalYearStart,
  formatYm,
  gradeFor,
  householdMembers,
  monthIndex,
  parseYm,
  RATE_ZERO,
  subYen,
  yearOf,
  yen,
  type CoverageOutput,
  type EmploymentPeriodInput,
  type Flow,
  type HealthStatusOutput,
  type MemberInput,
  type MonthIndex,
  type Rate,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  limit: "socialInsurance.health.kyokaikenpo.continuationLimit",
  health: "socialInsurance.health.kyokaikenpo.rate",
  care: "socialInsurance.care.kyokaikenpo.rate",
  childSupport: "socialInsurance.childSupport.rate",
  table: "socialInsurance.health.standardMonthlyRemuneration",
  careFrom: "socialInsurance.care.secondaryInsuredFromAge",
  careUntil: "socialInsurance.care.secondaryInsuredUntilAge",
};
const ROUNDING = "conv.premium.continuation";

export default defineComponent<{ fiscalYear: number }, { flows: Flow[] }>({
  id: "socialInsurance.continuation",
  title: "健康保険の任意継続の保険料",
  contract: "1.0",
  revision: 3,
  requires: { "socialInsurance.healthStatus": ">=1 <2", "socialInsurance.coverage": ">=1 <2" },
  params: Object.values(P),
  reads: [
    "member.outside",
    "member.kind",
    "employment.member",
    "employment.from",
    "employment.to",
    "employment.type",
    "employment.healthInsurance.kind",
    "employment.healthInsurance.insurer",
    "employment.salary.annual",
    "employment.standardMonthlyRemuneration",
  ],
  input: "fiscalYear.input",
  output: "flows.output",
  compute(input, ctx) {
    const fy = input.fiscalYear;
    const start = fiscalYearStart(fy);
    const last = fiscalYearEnd(fy);
    const { base } = ctx.time;
    const flows: Flow[] = [];
    let unknown = false;
    // 世帯の外の家族の任意継続は世帯の支出にしない（0035 の4）
    for (const mem of householdMembers(ctx.list<MemberInput>("member"))) {
      const member = mem.id;
      // その年度の月だけを読む（依存もその年度の分だけ。任意継続の月が無い年度は、全期間の月を読まずに次へ）
      const fyMonths = ctx.callMonths<HealthStatusOutput["months"][number]>("socialInsurance.healthStatus", { member }, "months", start, last);
      if (!fyMonths.some((x) => x.kind === "continuation")) continue;
      const months = ctx.call<HealthStatusOutput>("socialInsurance.healthStatus", { member }).months.map((x) => ({ m: parseYm(x.month), kind: x.kind }));
      const inYear = months.filter((x) => x.kind === "continuation" && x.m >= start && x.m <= last).map((x) => x.m);
      if (inYear.length === 0) continue;
      const periods = ctx.list<EmploymentPeriodInput>("employment").filter((p) => p.member === member);
      const resolveTo = (p: EmploymentPeriodInput) => (p.to === null ? ctx.time.end : ctx.time.resolve(p.to));
      // 任意継続の続きの月ごとに、始まりの月（前の月が任意継続でない月）を引く
      const kindOf = new Map(months.map((x) => [x.m, x.kind]));
      const runStart = (m: MonthIndex): MonthIndex => {
        let s = m;
        while (kindOf.get(addMonths(s, -1)) === "continuation") s = addMonths(s, -1);
        return s;
      };
      const cache = new Map<MonthIndex, { std: Yen; insurer: string } | null>();
      const lossOf = (s: MonthIndex): { std: Yen; insurer: string } | null => {
        const hit = cache.get(s);
        if (hit !== undefined) return hit;
        // 前の勤め先: 任意継続の始まりより前に終わる会社員などの期間のうち最後のもの
        const prev = periods.filter((p) => EMPLOYEE_TYPES.has(p.type) && resolveTo(p) < s).sort((a, b) => resolveTo(b) - resolveTo(a))[0];
        const own = periods.find((p) => ctx.time.resolve(p.from) <= s && s <= resolveTo(p) && p.healthInsurance?.kind === "continuation");
        const kind = prev?.healthInsurance?.kind ?? "kyokaikenpo";
        const insurer = own?.healthInsurance?.insurer ?? prev?.healthInsurance?.insurer;
        let out: { std: Yen; insurer: string } | null = null;
        if (prev !== undefined && kind === "kyokaikenpo" && insurer !== undefined) {
          // 資格を失ったときの標準報酬月額: 前の勤め先の最後の月の標準報酬月額（等級表の値がある年までさかのぼる）。
          // 引けなければ、期間に入れた標準報酬月額、それも無ければ年収の12分の1の等級
          const lastMonth = resolveTo(prev);
          let fromYear = Math.min(yearOf(base), yearOf(lastMonth));
          while (fromYear < yearOf(base) && !ctx.at(monthIndex(fromYear - 1, 12)).has(P.table)) fromYear++;
          const cov = ctx.call<CoverageOutput>("socialInsurance.coverage", { member, fromYear }).months;
          const mine = cov.filter((c) => c.healthStd !== null && c.period === prev.id && parseYm(c.month) <= lastMonth);
          const seen = mine[mine.length - 1];
          const given = prev.standardMonthlyRemuneration === undefined ? null : boxValue(prev.standardMonthlyRemuneration.health);
          const at = ctx.at(s < base ? base : s);
          const std = seen?.healthStd ?? given ?? gradeFor(at.paramGrades(P.table) ?? [], ctx.money.divInt(boxValue(prev.salary?.annual) ?? yen(0), 12, "conv.salary.monthly")).amount;
          out = { std, insurer };
        }
        cache.set(s, out);
        return out;
      };
      for (const m of inYear) {
        const loss = lossOf(runStart(m));
        if (loss === null) {
          unknown = true;
          continue;
        }
        const at = ctx.at(m);
        if (!at.has(P.limit)) continue;
        const cap = at.paramYen(P.limit);
        const std = cap !== null && loss.std > cap ? cap : loss.std;
        const rateOf = (id: string): Rate => at.paramRate(id) ?? RATE_ZERO;
        const health = at.paramRate(P.health, { jurisdiction: { level: "insurer", code: loss.insurer } }) ?? RATE_ZERO;
        const inCare = m >= ageMonth(ctx, m < base ? base : m, P.careFrom, member) && m < ageMonth(ctx, m < base ? base : m, P.careUntil, member);
        const care = inCare ? rateOf(P.care) : RATE_ZERO;
        const childSupport = rateOf(P.childSupport);
        const total = at.money.mulRate(std, ctx.rate.add(ctx.rate.add(health, care), childSupport), ROUNDING);
        const careYen = ctx.rate.compare(care, RATE_ZERO) === 0 ? yen(0) : at.money.mulRate(std, care, ROUNDING);
        const csYen = ctx.rate.compare(childSupport, RATE_ZERO) === 0 ? yen(0) : at.money.mulRate(std, childSupport, ROUNDING);
        const ym = formatYm(m);
        const push = (row: string, amount: Yen, part: string) => {
          if (amount > 0) flows.push({ row, ym, amount, accrualYear: yearOf(m), member, formula: `socialInsurance.continuation.${part}` });
        };
        push("cf.taxSi.health", subYen(subYen(total, careYen), csYen), "health");
        push("cf.taxSi.care", careYen, "care");
        push("cf.taxSi.childSupport", csYen, "childSupport");
      }
    }
    if (unknown) ctx.notice("N_INPUT_REQUIRED", ["socialInsurance.continuation.rates"]);
    return { flows };
  },
});

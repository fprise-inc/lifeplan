// 被用者保険の資格と保険料の計算の基礎（標準報酬月額・標準賞与額・雇用保険の賃金）を月ごとに決める
// 資格は socialInsurance.employeeStatus が働き方の期間から導いた月（休業の月は直前の勤め先を引き継ぐ）。
// 産前産後休業・育児休業の月は保険料が免除（exempt）。年金の記録には標準報酬月額のまま数える
import {
  addMonths,
  addYen,
  ageMonth,
  boxValue,
  defineComponent,
  formatYm,
  gradeFor,
  monthIndex,
  monthOf,
  parseYm,
  yearOf,
  yen,
  type CoverageBonus,
  type CoverageMonth,
  type CoverageWage,
  type EmployeeStatusOutput,
  type EmploymentPeriodInput,
  type SalaryPayment,
  type MonthIndex,
  type Yen,
} from "../../sdk/index.ts";

export default defineComponent<
  { member: string; fromYear: number },
  { months: CoverageMonth[]; bonuses: CoverageBonus[]; wages: CoverageWage[] }
>({
  id: "socialInsurance.coverage",
  title: "被用者保険の資格と標準報酬",
  contract: "1.1",
  revision: 2,
  requires: { "income.salary": ">=1 <2", "socialInsurance.employeeStatus": ">=1 <2" },
  params: [
    "socialInsurance.care.secondaryInsuredFromAge",
    "socialInsurance.care.secondaryInsuredUntilAge",
    "socialInsurance.pension.maxAge",
    "socialInsurance.health.lateElderlyAge",
    "socialInsurance.health.standardMonthlyRemuneration",
    "socialInsurance.pension.standardMonthlyRemuneration",
    "socialInsurance.standardBonus.rounding",
    "socialInsurance.health.standardBonus.annualLimit",
    "socialInsurance.pension.standardBonus.monthlyLimit",
  ],
  reads: ["employment.from", "employment.to", "employment.standardMonthlyRemuneration"],
  input: "socialInsurance.coverage.input",
  output: "socialInsurance.coverage.output",
  compute(input, ctx) {
    const { base, end } = ctx.time;
    const member = input.member;
    const { payments } = ctx.call<{ payments: readonly SalaryPayment[] }>("income.salary", { member });
    const status = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member }).months;
    // 保険料は翌月の給与から控除するので、fromYear の年に控除する分（前年12月分）から計算する
    const firstMonth = monthIndex(input.fromYear - 1, 12);
    const months: CoverageMonth[] = [];
    const bonuses: CoverageBonus[] = [];
    const wages: CoverageWage[] = [];
    const salaryStart = monthIndex(input.fromYear, 1);
    // 雇用保険: 賃金（給与・通勤手当・賞与）を払う月ごと。保険料はその支払いから控除する
    const statusOf = new Map(status.map((x) => [x.month, x]));
    for (const x of payments) {
      if (parseYm(x.ym) < salaryStart || statusOf.get(x.ym)?.employment !== true) continue;
      const w = addYen(x.salary, x.commuting);
      if (w > 0) wages.push({ month: x.ym, period: x.period, kind: "salary", wage: w });
      if (x.bonus > 0) wages.push({ month: x.ym, period: x.period, kind: "bonus", wage: x.bonus });
    }
    const insured = status.filter((x) => (x.health || x.pension) && x.employer !== null);
    if (insured.length === 0) return { months, bonuses, wages };
    const at0 = (() => {
      const f = parseYm((insured[0] as { month: string }).month);
      return f > firstMonth ? f : firstMonth < base ? base : firstMonth;
    })();
    // 年齢による資格の終わり（0003 の4。規則は制度データの ageSwitch）
    const pensionEnd = ageMonth(ctx, at0, "socialInsurance.pension.maxAge", member);
    const careFrom = ageMonth(ctx, at0, "socialInsurance.care.secondaryInsuredFromAge", member);
    const careUntil = ageMonth(ctx, at0, "socialInsurance.care.secondaryInsuredUntilAge", member);
    const lastInsured = parseYm((insured[insured.length - 1] as { month: string }).month);
    // 後期高齢者医療に移る年齢の値は、厚生年金の資格が終わる年齢より後まで入る人でだけ読む
    const healthEnd = lastInsured >= pensionEnd ? ageMonth(ctx, at0, "socialInsurance.health.lateElderlyAge", member) : null;

    const periods = new Map(ctx.list<EmploymentPeriodInput>("employment").map((p) => [p.id, p]));
    const own = (period: string) => payments.filter((x) => x.period === period);
    // 標準報酬月額の基にする報酬月額: 9月〜翌年8月は、その年の4〜6月の報酬の平均（定時決定）。
    // 6月以後に資格を取った年と翌年の8月までは、資格を取った月の報酬（資格取得時決定）。報酬が無い（休業など）ときは前の月の額
    const remunerationOf = (period: string, from: MonthIndex, m: MonthIndex): Yen | null => {
      const y = monthOf(m) >= 9 ? yearOf(m) : yearOf(m) - 1;
      const acquisition = y < yearOf(from) || (y === yearOf(from) && monthOf(from) >= 6);
      const all = own(period);
      const pays = acquisition
        ? all.filter((x) => parseYm(x.ym) >= from && x.salary > 0).slice(0, 1)
        : all.filter((x) => {
            const xm = parseYm(x.ym);
            return xm >= monthIndex(y, 4) && xm <= monthIndex(y, 6) && xm >= from && x.salary > 0;
          });
      if (pays.length === 0) return null;
      let sum = yen(0);
      for (const x of pays) sum = addYen(sum, addYen(x.salary, x.commuting));
      return ctx.money.divInt(sum, pays.length, "conv.socialInsurance.remuneration");
    };
    const stdCache = new Map<string, Yen>();
    const stdOf = (kind: "health" | "pension", period: string, m: MonthIndex): Yen => {
      const p = periods.get(period) as EmploymentPeriodInput;
      const override = p.standardMonthlyRemuneration === undefined ? null : boxValue(p.standardMonthlyRemuneration[kind]);
      if (override !== null) return override;
      const r = remunerationOf(period, ctx.time.resolve(p.from), m);
      const prev = stdCache.get(`${kind}|${period}`);
      if (r === null && prev !== undefined) return prev;
      const v = gradeFor(ctx.at(m).paramGrades(`socialInsurance.${kind}.standardMonthlyRemuneration`) ?? [], r ?? yen(0)).amount;
      stdCache.set(`${kind}|${period}`, v);
      return v;
    };

    for (let i = 0; i < insured.length; i++) {
      const s = insured[i] as (typeof insured)[number];
      const m = parseYm(s.month);
      if (m < firstMonth || m > end) {
        // 計算より前の月も、標準報酬の引き継ぎのため順に見る
        // 等級表の行が無い月（制度データの最初の行より前）は見ない（推測で埋めない）
        if (m < firstMonth && m >= monthIndex(yearOf(firstMonth) - 1, 9)) {
          const known = (kind: "health" | "pension") => ctx.at(m).has(`socialInsurance.${kind}.standardMonthlyRemuneration`);
          if (s.pension && m < pensionEnd && known("pension")) stdOf("pension", s.employer as string, m);
          if (s.health && known("health")) stdOf("health", s.employer as string, m);
        }
        continue;
      }
      const pensionCovered = s.pension && m < pensionEnd;
      const healthCovered = s.health && (healthEnd === null || m < healthEnd);
      if (!pensionCovered && !healthCovered) continue;
      const employer = s.employer as string;
      const exempt = s.leave === "maternity" || s.leave === "childcare";
      // 控除する月: 翌月。ただし勤め先の期間の最後の給与の月を超えない（月末に辞めると最後の給与で2か月分）。休業中は翌月
      const p = periods.get(employer) as EmploymentPeriodInput;
      const lastSalary = p.to === null ? null : ctx.time.resolve(p.to);
      const next = addMonths(m, 1);
      const paidIn = s.leave !== undefined || lastSalary === null || next <= lastSalary ? next : lastSalary;
      months.push({
        month: s.month,
        paidIn: formatYm(paidIn),
        period: employer,
        healthStd: healthCovered ? stdOf("health", employer, m) : null,
        pensionStd: pensionCovered ? stdOf("pension", employer, m) : null,
        care: healthCovered && m >= careFrom && m < careUntil,
        ...(exempt ? { exempt: true } : {}),
      });
    }

    // 賞与: 資格を失った月に払う賞与にはかからない（月末に辞めた月はかかる）。健康保険は年度（4月〜翌3月）の累計に上限。
    // 年度の累計のため、最初に計算する月の年度の始め（4月）から数える
    const insuredMonths = new Map(insured.map((x) => [x.month, x]));
    let fyKey = -1;
    let fyTotal = yen(0);
    const fyStart = monthIndex(monthOf(firstMonth) >= 4 ? yearOf(firstMonth) : yearOf(firstMonth) - 1, 4);
    for (const x of payments) {
      if (x.bonus <= 0) continue;
      const m = parseYm(x.ym);
      const s = insuredMonths.get(x.ym);
      if (s === undefined || s.employer !== x.period || m < fyStart || m > end) continue;
      const fy = monthOf(m) >= 4 ? yearOf(m) : yearOf(m) - 1;
      if (fy !== fyKey) {
        fyKey = fy;
        fyTotal = yen(0);
      }
      const pensionCovered = s.pension && m < pensionEnd;
      const healthCovered = s.health && (healthEnd === null || m < healthEnd);
      if (!pensionCovered && !healthCovered) continue;
      const at = ctx.at(m);
      const sb = at.money.round(x.bonus, "socialInsurance.standardBonus.rounding");
      let healthSb: Yen | null = null;
      if (healthCovered) {
        const limit = at.paramYen("socialInsurance.health.standardBonus.annualLimit");
        const room = limit === null ? sb : yen(Math.max(0, limit - fyTotal));
        healthSb = sb < room ? sb : room;
        fyTotal = addYen(fyTotal, healthSb);
      }
      let pensionSb: Yen | null = null;
      if (pensionCovered) {
        const limit = at.paramYen("socialInsurance.pension.standardBonus.monthlyLimit");
        pensionSb = limit === null || sb < limit ? sb : limit;
      }
      if (m < firstMonth) continue;
      const exempt = s.leave === "maternity" || s.leave === "childcare";
      bonuses.push({
        month: x.ym,
        period: x.period,
        healthStdBonus: healthSb,
        pensionStdBonus: pensionSb,
        care: healthCovered && m >= careFrom && m < careUntil,
        ...(exempt ? { exempt: true } : {}),
      });
    }
    return { months, bonuses, wages };
  },
});

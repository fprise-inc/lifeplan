// 公的年金の加入の記録。入力の型（ねんきん定期便 50歳未満・50歳以上、受給中の年金額、加入歴、見込額だけ）ごとの初めの値と、
// 記録の時点（asOf）の後に働き方の期間から足す月（国民年金の種別・厚生年金の標準報酬）を返す。
// 記録が無い構成員は、働き方の期間から加入歴を推計する（見出しの notices に N_ESTIMATED）。計算基準月の2年前より前の月の標準報酬は、
// その勤め先の期間の給与の入力（いまの賃金の水準）から近似する
import {
  addMonths,
  addYen,
  ageMonth,
  boxValue,
  defineComponent,
  fiscalYearOf,
  formatYm,
  monthIndex,
  parseYm,
  rate,
  yearOf,
  yen,
  type CategoryOutput,
  type CoverageOutput,
  type EmployeeStatusOutput,
  type EmploymentPeriodInput,
  type MonthIndex,
  type PensionRecordInput,
  type RecordMonth,
  type RecordOutput,
  type Yen,
} from "../../sdk/index.ts";

const UNTIL60 = "socialInsurance.nationalPension.untilAge";
const FROM20 = "socialInsurance.nationalPension.fromAge";
const PRE = "pension.employee.accrualRate.pre2003";
const POST = "pension.employee.accrualRate.post2003";
const ROUND = "pension.amount.rounding";
const SPLIT_2003 = monthIndex(2003, 4);
const SINCE_1961 = monthIndex(1961, 4);

export default defineComponent<{ member: string }, RecordOutput>({
  id: "pension.record",
  title: "公的年金の加入の記録",
  contract: "1.0",
  revision: 1,
  requires: { "pension.category": ">=1 <2", "socialInsurance.coverage": ">=1 <2", "socialInsurance.employeeStatus": ">=1 <2" },
  params: [UNTIL60, FROM20, PRE, POST, ROUND],
  reads: [
    "pensionRecord.member",
    "pensionRecord.kind",
    "pensionRecord.asOf",
    "pensionRecord.months",
    "pensionRecord.amounts",
    "pensionRecord.history",
    "employment.salary.annual",
    "employment.salary.bonus",
  ],
  input: "member.input",
  output: "pension.record.output",
  compute(input, ctx) {
    const member = input.member;
    const { base } = ctx.time;
    const rec = ctx.list<PensionRecordInput>("pensionRecord").find((r) => r.member === member);
    const asOf = rec === undefined ? null : parseYm(rec.asOf);
    const until60 = ageMonth(ctx, base, UNTIL60, member);
    const from20 = ageMonth(ctx, base, FROM20, member);
    const at = ctx.at(base);

    // 記録の後の月
    const cats = new Map(ctx.call<CategoryOutput>("pension.category", { member }).months.map((c) => [c.month, c]));
    const status = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member }).months;
    const cov = ctx.call<CoverageOutput>("socialInsurance.coverage", { member, fromYear: yearOf(base) - 1 });
    const covStart = cov.months.length > 0 ? parseYm((cov.months[0] as { month: string }).month) : null;
    const covered = new Map(cov.months.map((c) => [c.month, c]));
    const bonusOf = new Map<string, Yen>();
    for (const b of cov.bonuses) if (b.pensionStdBonus !== null) bonusOf.set(b.month, addYen(bonusOf.get(b.month) ?? yen(0), b.pensionStdBonus));
    const periods = new Map(ctx.list<EmploymentPeriodInput>("employment").map((p) => [p.id, p]));
    const kind = rec?.kind ?? "estimated";
    const months: RecordMonth[] = [];
    for (const s of status) {
      const m = parseYm(s.month);
      if (asOf !== null && m <= asOf) continue;
      const c = cats.get(s.month);
      const basic = c?.basic === true;
      let employee = false;
      let remuneration = yen(0);
      if (covStart !== null && m >= covStart) {
        const cv = covered.get(s.month);
        if (cv !== undefined && cv.pensionStd !== null) {
          employee = true;
          remuneration = m < SPLIT_2003 ? cv.pensionStd : addYen(cv.pensionStd, bonusOf.get(s.month) ?? yen(0));
        }
      } else if (s.pension && s.employer !== null) {
        // 計算基準月の2年前より前: 勤め先の期間の給与の入力（いまの水準）から（2003年4月以後は賞与を含めた月の平均）
        employee = true;
        const p = periods.get(s.employer);
        const annual = boxValue(p?.salary?.annual) ?? yen(0);
        const bonus = boxValue(p?.salary?.bonus) ?? yen(0);
        remuneration = ctx.money.divInt(m < SPLIT_2003 ? annual : addYen(annual, bonus), 12, "conv.socialInsurance.remuneration");
      }
      if (!basic && !employee) continue;
      // 50歳以上の定期便の見込額には60歳までの加入が入っているので、報酬比例に足すのは60歳から
      const accrues = employee && (kind !== "statementOver50" || m >= until60) && kind !== "projection";
      months.push({ month: s.month, basic, employee, employee2059: employee && basic && m >= SINCE_1961, remuneration, accrues });
    }

    const amounts = { basic: null as Yen | null, employee: null as Yen | null, transitional: null as Yen | null, special: null as Yen | null };
    let basicMonths = 0;
    let employeeMonths = 0;
    let employee2059Months = 0;
    let qualifyingMonths = 0;
    if (rec === undefined) {
      ctx.notice("N_ESTIMATED", ["pensionRecord", member]);
    } else if (rec.kind === "history") {
      // 加入歴: 月数を数え、報酬比例を平均標準報酬額（いまの水準とみなす）から計算する
      // 率は小数12桁までなので、分母を 10^12 にそろえて足す（1回だけ丸める）
      const DEN = 1000000000000n;
      let num = 0n;
      for (const h of rec.history ?? []) {
        const f = parseYm(h.from);
        const t = parseYm(h.to);
        for (let m = f; m <= t; m = addMonths(m, 1) as MonthIndex) {
          const npAge = m >= from20 && m < until60;
          if (h.category === "national1Unpaid") continue;
          qualifyingMonths++;
          if (npAge) basicMonths++;
          if (h.category === "employee") {
            employeeMonths++;
            if (npAge && m >= SINCE_1961) employee2059Months++;
            const r = ctx.rate.fraction(at.paramRate(m < SPLIT_2003 ? PRE : POST) ?? rate("0"));
            num += (BigInt(h.averageRemuneration ?? 0) * r.num * DEN) / r.den;
          }
        }
      }
      amounts.employee = ctx.at(base).money.mulRatio(yen(1), num, DEN, ROUND);
    } else {
      basicMonths = rec.months?.basic ?? 0;
      employeeMonths = rec.months?.employee ?? 0;
      employee2059Months = rec.months?.employee2059 ?? Math.min(employeeMonths, basicMonths);
      qualifyingMonths = rec.months?.qualifying ?? basicMonths;
      amounts.basic = rec.kind === "statementUnder50" ? null : boxValue(rec.amounts?.basic);
      amounts.employee = boxValue(rec.amounts?.employee);
      amounts.transitional = boxValue(rec.amounts?.transitional);
      amounts.special = boxValue(rec.amounts?.special);
    }
    // 受給資格期間: 記録の月数と、記録の後の月（20〜59歳の月と、それ以外の厚生年金の月）
    for (const x of months) if (x.basic || x.employee) qualifyingMonths++;
    return {
      kind,
      fiscalYear: fiscalYearOf(asOf ?? base),
      asOf: asOf === null ? null : formatYm(asOf),
      basicMonths,
      employeeMonths,
      employee2059Months,
      qualifyingMonths,
      amounts,
      months,
    };
  },
});

// 働き方の期間から、月ごとに勤め先の保険（健康保険・厚生年金・雇用保険）に入るかを導く（0008 の4・追記）
// 会社員・公務員は入る。契約・パートは、週の所定労働時間が通常の労働者の4分の3以上なら入り、そうでなければ短時間労働者の要件
// （週の所定労働時間・賃金の月額・勤め先の規模・学生でないこと）で決める。要件の値と施行の時期は制度データに持つ。
// 休業の月は直前の勤め先の期間を引き継ぐ。FP は期間の employeeInsurance・employmentInsuranceCovered で上書きできる。
// 役員（executive）は健康保険・厚生年金に入り（会社員と同じ）、雇用保険には入らない（失業・育児休業・高年齢雇用継続・介護休業の給付は出ない）。
// 計算基準月より前の月は、計算基準月の要件で判定する（過去の要件の値を持たないため）
// 改訂4（0171）: 万一の想定で亡くなる月は、健康保険・厚生年金に入らない（死亡の翌日に資格を失い、保険料はその前の月まで。健康保険法36条・
//   厚生年金保険法14条。月の途中で辞めた月と同じ扱い）。雇用保険はその月の給与にかかるので変えない。
//   約束の版 1.1: 期間に任意継続を書いた月に continuation を添える（家族の扶養の判定で、任意継続の人を扶養する人にする。socialInsurance.healthStatus）
import {
  addMonths,
  boxValue,
  deathMonthOf,
  defineComponent,
  EMPLOYEE_PENSION_KINDS,
  EMPLOYEE_TYPES,
  EMPLOYER_HEALTH_KINDS,
  formatYm,
  monthIndex,
  parseYm,
  rate,
  segmentIndex,
  yearOf,
  yen,
  type Ctx,
  type EmployeeStatusMonth,
  type EmploymentPeriodInput,
  type MemberInput,
  type MonthCtx,
  type MonthIndex,
  type Segment,
} from "../../sdk/index.ts";

const P = {
  ratio: "socialInsurance.coverage.regularHoursRatio",
  hours: "socialInsurance.coverage.shortTimeWeeklyHours",
  wage: "socialInsurance.coverage.shortTimeMonthlyWage",
  size: "socialInsurance.coverage.shortTimeEmployerSize",
  eiHours: "employmentInsurance.coverage.weeklyHours",
};
const FULL_TIME_DEFAULT = "40";

interface Resolved {
  readonly p: EmploymentPeriodInput;
  readonly from: MonthIndex;
  readonly to: MonthIndex | null;
}

/** 契約・パートが勤め先の保険に入るか（4分の3の基準、または短時間労働者の要件） */
function shortTimeCovered(ctx: Ctx, m: MonthCtx, p: EmploymentPeriodInput): boolean {
  const hours = rate(p.employer?.weeklyHours ?? "0");
  const full = rate(p.employer?.fullTimeWeeklyHours ?? FULL_TIME_DEFAULT);
  const ratio = m.paramRate(P.ratio);
  if (ratio !== null && ctx.rate.compare(hours, ctx.rate.mul(full, ratio)) >= 0) return true;
  if (p.student === true) return false;
  const minHours = m.paramCount(P.hours);
  if (minHours === null || ctx.rate.compare(hours, rate(String(minHours))) < 0) return false;
  const minWage = m.paramYen(P.wage);
  if (minWage !== null) {
    const contractual = boxValue(p.salary?.contractualMonthly) ?? ctx.money.divInt(boxValue(p.salary?.annual) ?? yen(0), 12, "conv.salary.monthly");
    if (contractual < minWage) return false;
  }
  const minSize = m.paramCount(P.size);
  return minSize === null || (p.employer?.size ?? 0) >= minSize;
}

function employmentCovered(ctx: Ctx, at: MonthCtx, p: EmploymentPeriodInput): boolean {
  if (p.employmentInsuranceCovered !== undefined) return p.employmentInsuranceCovered;
  if (p.type === "civilServant" || p.type === "executive" || p.student === true) return false;
  const min = at.paramCount(P.eiHours);
  return min !== null && ctx.rate.compare(rate(p.employer?.weeklyHours ?? "0"), rate(String(min))) >= 0;
}

export default defineComponent<{ member: string }, { months: EmployeeStatusMonth[] }>({
  id: "socialInsurance.employeeStatus",
  title: "勤め先の保険に入るか（働き方の期間から導く）",
  contract: "1.1",
  revision: 4,
  requires: { "contingency.event": ">=1 <2" },
  params: [P.ratio, P.hours, P.wage, P.size, P.eiHours],
  reads: [
    "member.birth",
    "employment.member",
    "employment.from",
    "employment.to",
    "employment.type",
    "employment.leaveKind",
    "employment.healthInsurance.kind",
    "employment.pensionCategory",
    "employment.employer.size",
    "employment.employer.weeklyHours",
    "employment.employer.fullTimeWeeklyHours",
    "employment.student",
    "employment.employeeInsurance",
    "employment.employmentInsuranceCovered",
    "employment.salary.annual",
    "employment.salary.contractualMonthly",
    "employment.endsOnMonthEnd",
  ],
  memberScope: ["employment"],
  input: "member.input",
  output: "socialInsurance.employeeStatus.output",
  compute(input, ctx) {
    const { base, end } = ctx.time;
    const me = ctx.get<MemberInput>("member", input.member);
    // 18歳の月か、計算基準月の2年前の1月の早い方から（前年・前々年の所得に対する住民税と、年金の加入歴の推計のため）
    const birth = parseYm(me.birth.birthYearMonth);
    const adult = addMonths(birth, 18 * 12);
    const early = monthIndex(yearOf(base) - 2, 1);
    const start = adult < early ? adult : early;
    const periods: Resolved[] = ctx
      .list<EmploymentPeriodInput>("employment")
      .filter((p) => p.member === input.member)
      .map((p) => ({ p, from: ctx.time.resolve(p.from), to: p.to === null ? null : ctx.time.resolve(p.to) }))
      .sort((a, b) => a.from - b.from);
    const inPeriod = (r: Resolved, m: MonthIndex) => m >= r.from && (r.to === null || m <= r.to);
    // 休業は、始まりより前に終わる最後の勤め先の期間を引き継ぐ
    const employerOf = (r: Resolved): Resolved | null => {
      if (EMPLOYEE_TYPES.has(r.p.type)) return r;
      if (r.p.type !== "leave") return null;
      let best: Resolved | null = null;
      for (const o of periods) {
        if (!EMPLOYEE_TYPES.has(o.p.type) || o.to === null || o.to >= r.from) continue;
        if (best === null || (best.to as number) < o.to) best = o;
      }
      return best;
    };
    // 区間ごとの計算（0006 の追記）: 働き方の期間・計算基準月・要件の値の行が変わらない区間ごとに1回だけ判定し、区間の月に並べる
    const breaks: MonthIndex[] = [base];
    // 亡くなる月（改訂4）
    const death = deathMonthOf(ctx, input.member);
    if (death !== null) breaks.push(death);
    for (const r of periods) {
      breaks.push(r.from);
      if (r.to !== null) breaks.push(r.to, addMonths(r.to, 1));
    }
    const months: EmployeeStatusMonth[] = [];
    const segs = ctx.segments(base > start ? base : start, end, { params: [P.ratio, P.hours, P.wage, P.size, P.eiHours], breaks });
    // 計算基準月より前の月は、計算基準月の要件で判定する（区間は計算基準月の区間をそのまま使う）
    const atOf = (m: MonthIndex) => (m < base ? (segs[0] as Segment).at : (segs[segmentIndex(segs, m)] as Segment).at);
    const pre: Segment[] = [];
    if (start < base) {
      // 計算基準月より前を、働き方の期間の境目で区切る
      const cuts = [...new Set(breaks.filter((b) => b > start && b < base))].sort((x, y) => x - y);
      let from = start;
      for (const c of [...cuts, base]) {
        pre.push({ from, to: addMonths(c, -1), at: (segs[0] as Segment).at });
        from = c;
      }
    }
    for (const seg of [...pre, ...segs]) {
      const m = seg.from;
      const r = periods.find((x) => inPeriod(x, m));
      if (r === undefined) {
        for (let k = seg.from; k <= seg.to; k = addMonths(k, 1)) {
          months.push({ month: formatYm(k), period: null, employer: null, type: "none", health: false, pension: false, employment: false });
        }
        continue;
      }
      const emp = employerOf(r);
      const leave = r.p.type === "leave" ? r.p.leaveKind : undefined;
      // 期間に書いた任意継続（亡くなる月からは添えない）
      const continuation = r.p.healthInsurance?.kind === "continuation" && (death === null || m < death);
      let health = false;
      let pension = false;
      let employment = false;
      if (emp !== null) {
        const ep = emp.p;
        const at = atOf(m);
        const override = boxValue(ep.employeeInsurance);
        const covered = override ?? (ep.type === "regular" || ep.type === "civilServant" || ep.type === "executive" ? true : shortTimeCovered(ctx, at, ep));
        // 月の途中で辞めると、最後の月は資格を失っている（月末に辞めればその月まで）
        const lastMonthLost = (r === emp && ep.endsOnMonthEnd === false && emp.to !== null && m === emp.to) || (death !== null && m >= death);
        health = covered && !lastMonthLost && EMPLOYER_HEALTH_KINDS.has(ep.healthInsurance?.kind ?? "");
        pension = covered && !lastMonthLost && EMPLOYEE_PENSION_KINDS.has(ep.pensionCategory ?? "none");
        employment = employmentCovered(ctx, at, ep);
      }
      for (let k = seg.from; k <= seg.to; k = addMonths(k, 1)) {
        months.push({
          month: formatYm(k),
          period: r.p.id,
          employer: emp?.p.id ?? null,
          type: r.p.type,
          ...(leave !== undefined ? { leave } : {}),
          health,
          pension,
          employment,
          ...(continuation ? { continuation: true as const } : {}),
        });
      }
    }
    return { months };
  },
});

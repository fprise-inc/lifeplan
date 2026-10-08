// 被用者保険の資格と保険料の計算の基礎（標準報酬月額・標準賞与額・雇用保険の賃金）を月ごとに決める
// 資格を取った月から失った月の前月までかかる。失うのは辞めた日の翌日（月末に辞めればその月までかかる）
import {
  addMonths,
  addYen,
  boxValue,
  defineComponent,
  formatYm,
  gradeFor,
  monthIndex,
  monthOf,
  parseYm,
  yearOf,
  yen,
  fail,
  type CoverageBonus,
  type CoverageMonth,
  type CoverageWage,
  type Ctx,
  type EmploymentPeriodInput,
  type SalaryPayment,
  type MonthIndex,
  type Yen,
} from "../../sdk/index.ts";

const EMPLOYEE: ReadonlySet<string> = new Set(["regular", "contract", "partTime", "civilServant"]);
const HEALTH_KINDS: ReadonlySet<string> = new Set(["kyokaikenpo", "union", "mutualAid"]);
const PENSION_KINDS: ReadonlySet<string> = new Set(["employee1", "employee2", "employee3"]);

/** 年齢の値（unit: years）と、その値の ageSwitch で決まる月 */
function ageMonth(ctx: Ctx, at: MonthIndex, id: string, member: string): MonthIndex {
  const m = ctx.at(at);
  const sel = m.param(id);
  const years = m.paramCount(id);
  if (years === null || sel.def.ageSwitch === null) fail("E_PARAM_KIND", [id]);
  return ctx.time.ageSwitch(member, { years }, sel.def.ageSwitch as never);
}

export default defineComponent<
  { member: string; fromYear: number },
  { months: CoverageMonth[]; bonuses: CoverageBonus[]; wages: CoverageWage[] }
>({
  id: "socialInsurance.coverage",
  title: "被用者保険の資格と標準報酬",
  contract: "1.0",
  revision: 1,
  requires: { "income.salary": ">=1 <2" },
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
  reads: [
    "employment.member",
    "employment.from",
    "employment.to",
    "employment.type",
    "employment.leaveKind",
    "employment.healthInsurance.kind",
    "employment.pensionCategory",
    "employment.employmentInsuranceCovered",
    "employment.standardMonthlyRemuneration",
    "employment.endsOnMonthEnd",
  ],
  input: "socialInsurance.coverage.input",
  output: "socialInsurance.coverage.output",
  compute(input, ctx) {
    const { end } = ctx.time;
    const member = input.member;
    const { payments } = ctx.call<{ payments: readonly SalaryPayment[] }>("income.salary", { member });
    // 保険料は翌月の給与から控除するので、fromYear の年に控除する分（前年12月分）から計算する
    const firstMonth = monthIndex(input.fromYear - 1, 12);
    const months: CoverageMonth[] = [];
    const bonuses: CoverageBonus[] = [];
    const wages: CoverageWage[] = [];
    for (const p of ctx.list<EmploymentPeriodInput>("employment")) {
      if (p.member !== member) continue;
      if (p.type === "leave") {
        // 産前産後休業・育児休業の間は保険料が免除。病気などの休職は次の作業
        if (p.leaveKind === "sick" || p.leaveKind === "other") ctx.notice("N_NOT_SUPPORTED", [p.id, `leave.${p.leaveKind}`]);
        continue;
      }
      if (!EMPLOYEE.has(p.type)) {
        // 自営・無職の間の国民健康保険・国民年金は次の作業
        ctx.notice("N_NOT_SUPPORTED", [p.id, `employment.${p.type}`]);
        continue;
      }
      const healthOn = HEALTH_KINDS.has(p.healthInsurance.kind);
      const pensionOn = PENSION_KINDS.has(p.pensionCategory);
      if (!HEALTH_KINDS.has(p.healthInsurance.kind) && p.healthInsurance.kind !== "dependent") {
        // 国民健康保険・任意継続・後期高齢者医療は次の作業
        ctx.notice("N_NOT_SUPPORTED", [p.id, `healthInsurance.${p.healthInsurance.kind}`]);
      }
      if (p.pensionCategory === "employee4") ctx.notice("N_NOT_SUPPORTED", [p.id, "pensionCategory.employee4"]);
      const from = ctx.time.resolve(p.from);
      const to = p.to === null ? null : ctx.time.resolve(p.to);
      // 期間の最後の給与の月（終わりの無い期間は表の最後より後も続く）
      const lastSalary = to;
      const lastPremium = to === null ? end : p.endsOnMonthEnd === false ? addMonths(to, -1) : to;
      const own = payments.filter((x) => x.period === p.id);

      // 雇用保険: 賃金（給与・通勤手当・賞与）を払う月ごと。保険料はその支払いから控除する
      const eiCovered =
        p.employmentInsuranceCovered ??
        (p.type === "regular" || p.type === "contract" ? true : p.type === "civilServant" ? false : undefined);
      if (eiCovered === undefined) fail("E_ARGUMENT", [p.id, "employment.employmentInsuranceCovered"]);
      if (eiCovered) {
        for (const x of own) {
          const m = parseYm(x.ym);
          if (m < monthIndex(input.fromYear, 1) || m < from || (lastSalary !== null && m > lastSalary)) continue;
          const w = addYen(x.salary, x.commuting);
          if (w > 0) wages.push({ month: x.ym, period: p.id, kind: "salary", wage: w });
          if (x.bonus > 0) wages.push({ month: x.ym, period: p.id, kind: "bonus", wage: x.bonus });
        }
      }
      if (!healthOn && !pensionOn) continue;

      // 年齢による資格の終わり（0003 の4。規則は制度データの ageSwitch）
      const at0 = from > firstMonth ? from : firstMonth;
      const pensionEnd = ageMonth(ctx, at0, "socialInsurance.pension.maxAge", member);
      const careFrom = ageMonth(ctx, at0, "socialInsurance.care.secondaryInsuredFromAge", member);
      const careUntil = ageMonth(ctx, at0, "socialInsurance.care.secondaryInsuredUntilAge", member);
      // 後期高齢者医療に移る年齢の値は、厚生年金の資格が終わる年齢より後まで働く期間でだけ読む
      const healthEnd = lastPremium >= pensionEnd ? ageMonth(ctx, at0, "socialInsurance.health.lateElderlyAge", member) : null;

      const override = p.standardMonthlyRemuneration;
      const overrideHealth = override === undefined ? null : boxValue(override.health);
      const overridePension = override === undefined ? null : boxValue(override.pension);
      // 標準報酬月額の基にする報酬月額: 9月〜翌年8月は、その年の4〜6月の報酬の平均（定時決定）。
      // 6月以後に資格を取った年と翌年の8月までは、資格を取った月の報酬（資格取得時決定）
      const remunerationOf = (m: MonthIndex): Yen => {
        const y = monthOf(m) >= 9 ? yearOf(m) : yearOf(m) - 1;
        const acquisition = y < yearOf(from) || (y === yearOf(from) && monthOf(from) >= 6);
        const pays = acquisition
          ? own.filter((x) => parseYm(x.ym) >= from).slice(0, 1)
          : own.filter((x) => {
              const xm = parseYm(x.ym);
              return xm >= monthIndex(y, 4) && xm <= monthIndex(y, 6) && xm >= from;
            });
        if (pays.length === 0) return yen(0);
        let sum = yen(0);
        for (const x of pays) sum = addYen(sum, addYen(x.salary, x.commuting));
        return ctx.money.divInt(sum, pays.length, "conv.socialInsurance.remuneration");
      };

      const start = from > firstMonth ? from : firstMonth;
      const stop = lastPremium < end ? lastPremium : end;
      for (let m = start; m <= stop; m = addMonths(m, 1)) {
        const pensionCovered = pensionOn && m < pensionEnd;
        const healthCovered = healthOn && (healthEnd === null || m < healthEnd);
        if (!pensionCovered && !healthCovered) continue;
        const at = ctx.at(m);
        let healthStd: Yen | null = null;
        let pensionStd: Yen | null = null;
        if (healthCovered) {
          healthStd = overrideHealth ?? gradeFor(at.paramGrades("socialInsurance.health.standardMonthlyRemuneration") ?? [], remunerationOf(m)).amount;
        }
        if (pensionCovered) {
          pensionStd = overridePension ?? gradeFor(at.paramGrades("socialInsurance.pension.standardMonthlyRemuneration") ?? [], remunerationOf(m)).amount;
        }
        const next = addMonths(m, 1);
        months.push({
          month: formatYm(m),
          paidIn: formatYm(lastSalary === null || next < lastSalary ? next : lastSalary),
          period: p.id,
          healthStd,
          pensionStd,
          care: healthCovered && m >= careFrom && m < careUntil,
        });
      }

      // 賞与: 資格を失った月に払う賞与にはかからない（月末に辞めた月はかかる）。健康保険は年度（4月〜翌3月）の累計に上限
      let fyKey = -1;
      let fyTotal = yen(0);
      for (const x of own) {
        if (x.bonus <= 0) continue;
        const m = parseYm(x.ym);
        if (m < from || m > lastPremium) continue;
        const fy = monthOf(m) >= 4 ? yearOf(m) : yearOf(m) - 1;
        // 年度の累計のため、最初に計算する月の年度の始め（4月）から数える
        if (m < monthIndex(monthOf(firstMonth) >= 4 ? yearOf(firstMonth) : yearOf(firstMonth) - 1, 4)) continue;
        if (fy !== fyKey) {
          fyKey = fy;
          fyTotal = yen(0);
        }
        const pensionCovered = pensionOn && m < pensionEnd;
        const healthCovered = healthOn && (healthEnd === null || m < healthEnd);
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
        bonuses.push({ month: x.ym, period: p.id, healthStdBonus: healthSb, pensionStdBonus: pensionSb, care: healthCovered && m >= careFrom && m < careUntil });
      }
    }
    return { months, bonuses, wages };
  },
});

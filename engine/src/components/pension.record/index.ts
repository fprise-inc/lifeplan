// 公的年金の加入の記録。入力の型（ねんきん定期便 50歳未満・50歳以上、受給中の年金額、加入歴、見込額だけ）ごとの初めの値と、
// 記録の時点（asOf）の後に働き方の期間から足す月（国民年金の種別・厚生年金の標準報酬）を返す。
// 記録が無い構成員は、働き方の期間から加入歴を推計する（見出しの notices に N_ESTIMATED）。計算基準年の前の年の11月より前の月の標準報酬は、
// その勤め先の期間の給与の入力（いまの賃金の水準）から近似する
import {
  addMonths,
  addYen,
  ageMonth,
  boxValue,
  defineComponent,
  fiscalYearOf,
  fiscalYearStart,
  formatYm,
  monthIndex,
  parseYm,
  periodRateFor,
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
  type RevisionOutput,
  type PeriodRate,
  type Yen,
} from "../../sdk/index.ts";

const UNTIL60 = "socialInsurance.nationalPension.untilAge";
const FROM20 = "socialInsurance.nationalPension.fromAge";
const PRE = "pension.employee.accrualRate.pre2003";
const POST = "pension.employee.accrualRate.post2003";
const ROUND = "pension.amount.rounding";
// 再評価率（生年月日の区分×報酬の期間の表。年度ごと）。加入歴の「当時の額」をその年度の水準に直す（0007 の追記）
const REVAL = "pension.revaluationRate";
// 中高齢者の期間短縮の特例で数える厚生年金の月の始まり（40歳。女子は35歳。昭和60年改正法附則12条1項4号）
const MIDDLE_MALE = "pension.survivor.middleAgeSpecial.fromAgeMale";
const MIDDLE_FEMALE = "pension.survivor.middleAgeSpecial.fromAgeFemale";
const SPLIT_2003 = monthIndex(2003, 4);
const SINCE_1961 = monthIndex(1961, 4);

export default defineComponent<{ member: string }, RecordOutput>({
  id: "pension.record",
  title: "公的年金の加入の記録",
  contract: "1.1",
  revision: 5,
  requires: { "pension.category": ">=1 <2", "socialInsurance.coverage": ">=1 <2", "socialInsurance.employeeStatus": ">=1 <2", "pension.revision": ">=1 <2" },
  params: [UNTIL60, FROM20, PRE, POST, ROUND, REVAL, MIDDLE_MALE, MIDDLE_FEMALE],
  reads: [
    "pensionRecord.member",
    "pensionRecord.kind",
    "pensionRecord.asOf",
    "pensionRecord.months",
    "pensionRecord.amounts",
    "pensionRecord.history",
    "employment.salary.annual",
    "employment.salary.bonus",
    "member.sex",
  ],
  memberScope: ["pensionRecord", "employment"],
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
    const cov = ctx.call<CoverageOutput>("socialInsurance.coverage", { member, fromYear: yearOf(base) });
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
        // 保険料を計算する月より前: 勤め先の期間の給与の入力（いまの水準）から（2003年4月以後は賞与を含めた月の平均）
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
    // 第1号の期間の内訳（死亡一時金・寡婦年金・老齢基礎年金の免除の月。改訂5）
    const c1 = { known: false, paid: 0, exemptQuarter: 0, exemptHalf: 0, exemptThreeQuarters: 0, exemptFull: 0, deferred: 0, pre2009: { exemptQuarter: 0, exemptHalf: 0, exemptThreeQuarters: 0, exemptFull: 0 } };
    const SINCE_2009 = monthIndex(2009, 4);
    let middleFrom: MonthIndex | null = null;
    let employeeFromMiddleAge = 0;
    if (rec === undefined) {
      ctx.notice("N_ESTIMATED", ["pensionRecord", member]);
    } else if (rec.kind === "history") {
      // 加入歴: 月数を数え、報酬比例を平均標準報酬額から計算する。額は、いまの水準とみなす額（averageRemuneration）か、
      // 当時の額（averageRemunerationAtTime）に記録の年度の再評価率（生年月日の区分×報酬の月）を掛けた額
      // 率は小数12桁までなので、分母を 10^12 にそろえて足す（1回だけ丸める）
      const DEN = 1000000000000n;
      let num = 0n;
      const F = fiscalYearOf(asOf ?? base);
      const atK = ctx.at(fiscalYearStart(F));
      // 再評価率の延ばし方（0006・0007 の追記（2026-10-09））: 記録の年度 F の表が制度データに無いときは、値のある最後の年度 L（F の前の10年度まで探す）の
      // 表の各行に、報酬比例の改定の比（pension.revision の employee の F 年度÷L 年度）を掛けて小数3桁に四捨五入する（令和7年度→令和8年度の
      // 表で、直近の3期間を除く全行がこの規則で一致した。PR #9）。L の表の期間より後の月（直近の期間）は、その月の年度 p の改定の比（F÷p。
      // p が F 以後なら1）を小数3桁に四捨五入した率にする。延ばした表を使ったら見出しの notices（N_PARAM_PROJECTED）に出す
      let table: readonly PeriodRate[] | null | undefined;
      let proj: { readonly L: number; readonly ratio: (from: number) => { num: bigint; den: bigint } } | null = null;
      const round3 = (num: bigint, den: bigint): { num: bigint; den: bigint } => ({ num: (num * 2000n + den) / (2n * den), den: 1000n });
      const tableOf = (): readonly PeriodRate[] | null => {
        if (table !== undefined) return table;
        table = null;
        if (atK.has(REVAL, { member })) {
          table = atK.paramPeriods(REVAL, { member });
          return table;
        }
        for (let y = F - 1; y >= F - 10; y--) {
          const aty = ctx.at(fiscalYearStart(y));
          if (!aty.has(REVAL, { member })) continue;
          const rows = ctx.call<RevisionOutput>("pension.revision", { member }).byFiscalYear;
          const e = (fy: number): string | null => rows.find((r) => r.fiscalYear === fy)?.employee ?? null;
          const eF = e(F);
          if (eF === null || e(y) === null) break;
          table = aty.paramPeriods(REVAL, { member });
          proj = {
            L: y,
            ratio: (from: number) => {
              const ef = e(from);
              return ef === null ? { num: 1n, den: 1n } : ctx.rate.fraction(ctx.rate.div(ctx.rate.of(eF), ctx.rate.of(ef)));
            },
          };
          ctx.notice("N_PARAM_PROJECTED", [REVAL, String(y + 1), String(F)]);
          break;
        }
        return table;
      };
      const revalAt = (m: MonthIndex): { num: bigint; den: bigint } => {
        const tb = tableOf();
        const row = tb === null ? null : periodRateFor(tb, m);
        if (proj !== null && tb !== null) {
          const p = proj as { readonly L: number; readonly ratio: (from: number) => { num: bigint; den: bigint } };
          if (row !== null) {
            const r = ctx.rate.fraction(row.rate);
            const k = p.ratio(p.L);
            return round3(r.num * k.num, r.den * k.den);
          }
          const last = tb.length === 0 ? null : (tb[tb.length - 1] as PeriodRate).to;
          if (last !== null && m > last) {
            const fy = fiscalYearOf(m);
            if (fy >= F) return { num: 1n, den: 1n };
            const k = p.ratio(fy);
            return round3(k.num, k.den);
          }
        }
        if (row === null) {
          // 再評価率の値が無い（制度データに無い年度・生年月日・期間）: いまの水準の額とみなし、知らせる
          ctx.notice("N_PARAM_MISSING", [REVAL, member]);
          return { num: 1n, den: 1n };
        }
        return ctx.rate.fraction(row.rate);
      };
      c1.known = true;
      // 中高齢者の期間短縮の特例（40歳・女子35歳以後の厚生年金の月）
      const sex = ctx.list<{ id: string; sex?: string }>("member").find((x) => x.id === member)?.sex;
      const middleId = sex === "female" ? MIDDLE_FEMALE : MIDDLE_MALE;
      middleFrom = ctx.at(base).has(middleId) ? ageMonth(ctx, base, middleId, member) : null;
      const exemptKey = {
        national1ExemptQuarter: "exemptQuarter",
        national1ExemptHalf: "exemptHalf",
        national1ExemptThreeQuarters: "exemptThreeQuarters",
        national1ExemptFull: "exemptFull",
        national1Deferred: "deferred",
      } as const;
      for (const h of rec.history ?? []) {
        const f = parseYm(h.from);
        const t = parseYm(h.to);
        for (let m = f; m <= t; m = addMonths(m, 1) as MonthIndex) {
          const npAge = m >= from20 && m < until60;
          if (h.category === "national1Unpaid") continue;
          qualifyingMonths++;
          // 免除・学生納付特例・納付猶予: 受給資格期間に数え、老齢基礎年金の額の月数（basicMonths）には入れない
          if (h.category in exemptKey) {
            if (npAge) {
              c1[exemptKey[h.category as keyof typeof exemptKey]]++;
              const key = exemptKey[h.category as keyof typeof exemptKey];
              if (key !== "deferred" && m < SINCE_2009) c1.pre2009[key]++;
            }
            continue;
          }
          if (npAge && h.category === "national1") c1.paid++;
          if (npAge) basicMonths++;
          if (h.category === "employee") {
            employeeMonths++;
            if (middleFrom !== null && m >= middleFrom) employeeFromMiddleAge++;
            if (npAge && m >= SINCE_1961) employee2059Months++;
            const r = ctx.rate.fraction(at.paramRate(m < SPLIT_2003 ? PRE : POST) ?? rate("0"));
            if (h.averageRemunerationAtTime !== undefined) {
              const v = revalAt(m);
              num += (BigInt(h.averageRemunerationAtTime) * v.num * r.num * DEN) / (v.den * r.den);
            } else num += (BigInt(h.averageRemuneration ?? 0) * r.num * DEN) / r.den;
          }
        }
      }
      amounts.employee = ctx.at(base).money.mulRatio(yen(1), num, DEN, ROUND);
    } else {
      basicMonths = rec.months?.basic ?? 0;
      employeeMonths = rec.months?.employee ?? 0;
      employee2059Months = rec.months?.employee2059 ?? Math.min(employeeMonths, basicMonths);
      const k = rec.months?.category1;
      if (k !== undefined) {
        c1.known = true;
        c1.paid = k.paid;
        c1.exemptQuarter = k.exemptQuarter ?? 0;
        c1.exemptHalf = k.exemptHalf ?? 0;
        c1.exemptThreeQuarters = k.exemptThreeQuarters ?? 0;
        c1.exemptFull = k.exemptFull ?? 0;
        c1.deferred = k.deferred ?? 0;
      }
      qualifyingMonths = rec.months?.qualifying ?? basicMonths + c1.exemptQuarter + c1.exemptHalf + c1.exemptThreeQuarters + c1.exemptFull + c1.deferred;
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
      category1: c1,
      ...(rec?.kind === "history" && middleFrom !== null ? { employeeFromMiddleAge } : {}),
    };
  },
});

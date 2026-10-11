// 障害年金（6.3）。万一の想定の「障害」（等級は FP が選ぶ「該当した場合」の仮定）で、障害認定日（初診日から1年6か月。それまでは
// 勤め先の健康保険の傷病手当金。overlay.ts が休業の期間を置き、benefit.health が出す）の翌月から払う。
// - 障害基礎年金（1・2級）: 1級は基本額（780,900円×改定率）×1.25、2級は基本額。子（18歳に達した後の最初の3月31日まで）の加算。
//   初診日が65歳になる前なら受けられるとみなす（保険料の納付要件は満たすとみなす）
// - 障害厚生年金（1〜3級。初診日に厚生年金に入っていたとき）: 報酬比例の額（障害認定日の月までの記録。300月に満たなければ300月とみなす）。
//   1級は×1.25。1・2級は配偶者の加給年金額（配偶者が65歳になるまで）。3級は最低保障（障害基礎年金の基本額×3/4）
// - 自営業（初診日に厚生年金に入っていない）は障害基礎年金だけ
// - 65歳からは、障害基礎年金＋障害厚生年金・老齢基礎年金＋老齢厚生年金・障害基礎年金＋老齢厚生年金（障害基礎年金を受けるときだけ）のうち、
//   手取りが多い組み合わせを月ごとに選ぶ（0008 の追記 2026-10-10 の決定2）。障害年金は非課税なので、老齢年金の部分から所得税・住民税の
//   見積もり（その年金だけを収入とし、公的年金等控除・基礎控除・税率表。復興・防衛特別所得税・ほかの所得・社会保険料は入れない近似。知らせ）を
//   引いて比べ、同じなら障害年金の側を選ぶ。選んだ組み合わせは出力の choices に残し、pension.oldAge が選ばれなかった老齢年金の部分を止める。
//   老齢年金の額は pension.oldAgeBase の選ぶ前の年額（循環しないよう pension.oldAge からは読まない）。子の加算と子の加給年金の調整は扱わない
// - FP が組み合わせを選び直したとき（万一の想定の oldAgeChoice。改訂3）は、65歳からの月はその組み合わせにする。障害基礎年金を含む組み合わせで
//   障害基礎年金を受けない月（3級など）は、その月だけ自動の選び方に戻す
// - 働けるようになる月（recovery）が障害認定日より前なら払わない。後なら、その前の月まで
import {
  addMonths,
  ageMonth,
  bracketFor,
  childrenOf,
  defineComponent,
  evenMonthPayments,
  fiscalYearOf,
  fiscalYearStart,
  formatYm,
  monthIndex,
  parseYm,
  rate,
  RATE_ONE,
  RATE_ZERO,
  spousesAt,
  yen,
  type ContingencyEventOutput,
  type DisabilityPensionMonth,
  type DisabilityPensionOutput,
  type Flow,
  type MemberInput,
  type MonthCtx,
  type MonthIndex,
  type PensionOutput,
  type Rate,
  type RecordOutput,
  type RelationInput,
  type RevisionOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  base: "pension.basic.baseAmount",
  fullRound: "pension.basic.fullAmount.rounding",
  round: "pension.amount.rounding",
  payRound: "pension.payment.rounding",
  pre: "pension.employee.accrualRate.pre2003",
  post: "pension.employee.accrualRate.post2003",
  child12: "pension.childSupplement.firstTwoBaseAmount",
  child3: "pension.childSupplement.thirdBaseAmount",
  childAge: "pension.childSupplement.childUntilAge",
  supBase: "pension.spouseSupplement.baseAmount",
  spouseAge: "pension.spouseSupplement.spouseUntilAge",
  start: "pension.normalStartAge",
  basic1: "pension.disability.basicGrade1Ratio",
  employee1: "pension.disability.employeeGrade1Ratio",
  min3: "pension.disability.grade3MinimumRatio",
  deemed: "pension.disability.deemedMonths",
};
// 老齢年金の手取りの見積もりに使う税の値
const T = {
  ppd: "incomeTax.publicPensionDeduction.over65.tier1",
  itBasic: "incomeTax.basicDeduction",
  itRate: "incomeTax.taxRateTable",
  itRound: "incomeTax.taxableIncome.rounding",
  rtBasic: "residentTax.basicDeduction",
  rtRound: "residentTax.taxableIncome.rounding",
  rtM: "residentTax.incomeLevy.municipalRate",
  rtP: "residentTax.incomeLevy.prefecturalRate",
};
type Combination = "disability" | "oldAge" | "disabilityBasicOldAgeEmployee";
const SPLIT_2003 = monthIndex(2003, 4);
const DEN = 1000000000000n;

function revisionTable(rv: RevisionOutput, series: "rate" | "employee" | "newAward"): (fy: number) => Rate {
  const map = new Map(rv.byFiscalYear.map((x) => [x.fiscalYear, rate(series === "employee" ? x.employee : series === "newAward" ? (x.newAward ?? x.rate) : x.rate)]));
  const first = rv.byFiscalYear[0]?.fiscalYear ?? 0;
  const last = rv.byFiscalYear[rv.byFiscalYear.length - 1]?.fiscalYear ?? 0;
  return (fy) => map.get(fy < first ? first : fy > last ? last : fy) ?? RATE_ONE;
}

export default defineComponent<{ member: string }, DisabilityPensionOutput>({
  id: "pension.disability",
  title: "障害年金（障害基礎年金・障害厚生年金）",
  contract: "1.1",
  revision: 3,
  requires: { "contingency.event": ">=1 <2", "pension.record": ">=1 <2", "pension.revision": ">=1 <2", "pension.oldAgeBase": ">=1 <2" },
  params: [...Object.values(P), ...Object.values(T)],
  reads: ["member.kind", "member.birth", "relation.type", "relation.a", "relation.b", "relation.from", "relation.to", "relation.parent", "relation.child"],
  input: "member.input",
  output: "pension.disability.output",
  compute(input, ctx) {
    const X = input.member;
    const { base, end } = ctx.time;
    const empty: DisabilityPensionOutput = { flows: [], months: [], choices: [] };
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: X }).event;
    if (ev === null || ev.kind === "death" || ev.grade === undefined || ev.recognition === undefined) return empty;
    const g = ev.grade;
    const D = parseYm(ev.month);
    const RC = parseYm(ev.recognition);
    const recovery = ev.recovery === undefined ? null : parseYm(ev.recovery);
    if (recovery !== null && recovery <= RC) return empty;
    const m0 = D < base ? base : D;
    const at0 = ctx.at(m0);
    const N = ageMonth(ctx, m0, P.start, X);
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    const rec = ctx.call<RecordOutput>("pension.record", { member: X });
    const rv = ctx.call<RevisionOutput>("pension.revision", { member: X });
    const R = revisionTable(rv, "rate");
    const E = revisionTable(rv, "employee");
    const NA = revisionTable(rv, "newAward");
    const K = rec.fiscalYear;
    const EK = E(K);
    // 初診日に厚生年金に入っていたか・65歳になる前か
    const employeeOk = rec.months.some((x) => x.month === ev.month && x.employee);
    const basicOk = g <= 2 && D < N;
    if (!employeeOk && !basicOk) return empty;
    // 報酬比例（障害認定日の月までの記録）
    const recMonths = rec.months.filter((x) => parseYm(x.month) <= RC);
    const empMonths = rec.employeeMonths + recMonths.filter((x) => x.employee).length;
    let num = BigInt(rec.amounts.employee ?? 0) * DEN;
    for (const x of recMonths) {
      if (!x.accrues || x.remuneration <= 0) continue;
      const m = parseYm(x.month);
      const r = at0.paramRate(m < SPLIT_2003 ? P.pre : P.post) ?? RATE_ZERO;
      const deflate = m < base ? RATE_ONE : ctx.rate.div(EK, E(fiscalYearOf(m)));
      const f = ctx.rate.fraction(ctx.rate.mul(r, deflate));
      num += (BigInt(x.remuneration) * f.num * DEN) / f.den;
    }
    const deemed = at0.paramCount(P.deemed) ?? 300;
    if (empMonths > 0 && empMonths < deemed) num = (num * BigInt(deemed)) / BigInt(empMonths);
    const kids = childrenOf(members, relations, X);
    const childUntil = new Map(kids.map((c) => [c.id, ageMonth(ctx, m0, P.childAge, c.id)]));
    const spouseUntil = new Map<string, MonthIndex>();
    const cache = new Map<number, { at: MonthCtx; basic: Yen; prop: Yen; c12: Yen; c3: Yen; sup: Yen }>();
    const yearOfFy = (fy: number) => {
      let v = cache.get(fy);
      if (v === undefined) {
        const at = ctx.at(fiscalYearStart(fy));
        const basic = at.money.mulRate(at.paramYen(P.base) ?? yen(0), R(fy), P.fullRound);
        const ratioE = ctx.rate.fraction(ctx.rate.div(E(fy), EK));
        const prop = at.money.mulRatio(yen(1), num * ratioE.num, DEN * ratioE.den, P.round);
        const c12 = at.money.mulRate(at.paramYen(P.child12) ?? yen(0), R(fy), P.fullRound);
        const c3 = at.money.mulRate(at.paramYen(P.child3) ?? yen(0), R(fy), P.fullRound);
        const sup = at.money.mulRate(at.paramYen(P.supBase) ?? yen(0), NA(fy), P.fullRound);
        v = { at, basic, prop, c12, c3, sup };
        cache.set(fy, v);
      }
      return v;
    };
    let old: Map<string, { basic: Yen; employee: Yen }> | null = null;
    const oldAt = (m: MonthIndex): { basic: Yen; employee: Yen } => {
      if (old === null) old = new Map(ctx.call<{ months: PensionOutput["months"] }>("pension.oldAgeBase", { member: X }).months.map((x) => [x.month, { basic: x.basic, employee: x.employee }]));
      return old.get(formatYm(m)) ?? { basic: yen(0), employee: yen(0) };
    };
    // 老齢年金（年額）にかかる所得税・住民税の見積もり（その年金だけを収入とみなす）
    const taxCache = new Map<string, number>();
    const taxOn = (revenue: number, year: number): number => {
      if (revenue <= 0) return 0;
      const key = `${year}|${revenue}`;
      const hit = taxCache.get(key);
      if (hit !== undefined) return hit;
      const at = ctx.at(monthIndex(year, 1));
      const b = at.has(T.ppd) ? bracketFor(at.paramBrackets(T.ppd) ?? [], yen(revenue)) : null;
      const ded = b === null ? 0 : (b.rate === undefined ? 0 : ctx.money.mulRate(yen(revenue), b.rate, "conv.tax.fractionalDeduction")) + (b.amount ?? 0);
      const income = Math.max(0, revenue - ded);
      let tax = 0;
      if (at.has(T.itBasic) && at.has(T.itRate)) {
        const basic = bracketFor(at.paramBrackets(T.itBasic) ?? [], yen(income)).amount ?? 0;
        const taxable = at.money.round(yen(Math.max(0, income - basic)), T.itRound);
        const r = bracketFor(at.paramBrackets(T.itRate) ?? [], taxable);
        if (r.rate !== undefined) tax += Math.max(0, ctx.money.mulRate(taxable, r.rate, "conv.tax.exact") - (r.amount ?? 0));
      }
      const atR = ctx.at(monthIndex(year + 1, 6));
      if (atR.has(T.rtBasic) && atR.has(T.rtM)) {
        const basic = bracketFor(atR.paramBrackets(T.rtBasic) ?? [], yen(income)).amount ?? 0;
        const taxable = atR.money.round(yen(Math.max(0, income - basic)), T.rtRound);
        const rr = ctx.rate.add(atR.paramRate(T.rtM) ?? RATE_ZERO, atR.paramRate(T.rtP) ?? RATE_ZERO);
        tax += ctx.money.mulRate(taxable, rr, "conv.tax.exact");
      }
      taxCache.set(key, tax);
      return tax;
    };
    const choices: { from: string; to: string; combination: Combination }[] = [];
    const months: DisabilityPensionMonth[] = [];
    let noticed = false;
    for (let m = addMonths(RC, 1); m <= end && (recovery === null || m < recovery); m = addMonths(m, 1)) {
      const v = yearOfFy(fiscalYearOf(m));
      let basic = yen(0);
      if (basicOk) {
        basic = g === 1 ? v.at.money.mulRate(v.basic, v.at.paramRate(P.basic1) ?? RATE_ONE, P.round) : v.basic;
        const n = kids.filter((c) => parseYm(c.birth.birthYearMonth) <= m && m <= (childUntil.get(c.id) as MonthIndex)).length;
        for (let k = 0; k < n; k++) basic = yen(basic + (k < 2 ? v.c12 : v.c3));
      }
      let employee = yen(0);
      if (employeeOk) {
        employee = g === 1 ? v.at.money.mulRate(v.prop, v.at.paramRate(P.employee1) ?? RATE_ONE, P.round) : v.prop;
        if (g === 3) {
          const min = v.at.money.mulRate(v.basic, v.at.paramRate(P.min3) ?? RATE_ZERO, P.fullRound);
          if (employee < min) employee = min;
        }
        if (g <= 2) {
          for (const sp of spousesAt(ctx, relations, X, m)) {
            let until = spouseUntil.get(sp);
            if (until === undefined) {
              until = ageMonth(ctx, m0, P.spouseAge, sp);
              spouseUntil.set(sp, until);
            }
            if (m < until) {
              employee = yen(employee + v.sup);
              break;
            }
          }
        }
      }
      // 65歳から: 手取りが多い組み合わせ
      if (m >= N) {
        const o = oldAt(m);
        if (o.basic > 0 || o.employee > 0) {
          if (!noticed) {
            ctx.notice("N_ESTIMATED", ["pension.disability.oldAgeChoice", X]);
            noticed = true;
          }
          const y = Math.floor(m / 12);
          const options: { c: Combination; net: number }[] = [{ c: "disability", net: basic + employee }];
          options.push({ c: "oldAge", net: o.basic + o.employee - taxOn(o.basic + o.employee, y) });
          if (basic > 0) options.push({ c: "disabilityBasicOldAgeEmployee", net: basic + o.employee - taxOn(o.employee, y) });
          let best = options[0] as { c: Combination; net: number };
          for (const x of options) if (x.net > best.net) best = x;
          const chosen = ev.oldAgeChoice === undefined ? undefined : options.find((x) => x.c === ev.oldAgeChoice);
          if (chosen !== undefined && (chosen.c !== "disability" || basic > 0 || employee > 0)) best = chosen;
          if (best.c === "oldAge") {
            basic = yen(0);
            employee = yen(0);
          } else if (best.c === "disabilityBasicOldAgeEmployee") employee = yen(0);
          const ym = formatYm(m);
          const lastC = choices[choices.length - 1];
          if (lastC !== undefined && lastC.combination === best.c && lastC.to === formatYm(addMonths(m, -1))) lastC.to = ym;
          else choices.push({ from: ym, to: ym, combination: best.c });
        }
      }
      if (basic > 0 || employee > 0) months.push({ month: formatYm(m), basic, employee });
    }
    const flows: Flow[] = evenMonthPayments(
      ctx,
      months.map((x) => ({ month: x.month, amount: yen(x.basic + x.employee) })),
      P.payRound,
    )
      .filter((p) => parseYm(p.ym) >= base)
      .map((p) => ({ row: "cf.income.pension.disability", ym: p.ym, amount: p.amount, accrualYear: p.accrualYear, member: X, formula: "pension.disability.payment" }));
    return { flows, months, choices };
  },
});

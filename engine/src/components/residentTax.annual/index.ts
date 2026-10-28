// 住民税（所得割・均等割）と森林環境税。前年の所得に対して、6月から翌年5月に払う（0003 の2）
// 所得割は全国一律の標準税率（市町村民税・道府県民税）で計算し、調整控除を引いて、それぞれ100円未満を切り捨てる。
// 給与所得者（その年度の6月に給与を受ける人）は特別徴収（6月〜翌年5月の12回）。給与を受けなくなった後の残り（改訂8）:
// - 翌年1月〜4月に辞めた（最後の給与がその月）: 5月分までの残りを最後の給与の月にまとめる（一括徴収。地方税法321条の5第2項ただし書）
// - 6月〜12月に辞めた: 残りは普通徴収に切り替わり、特別徴収が止まった月以後に来る普通徴収の納期（6月・8月・10月・翌年1月）に分けて払う
//   （321条の7。年の合計は変わらず、払う時期が変わる）。本人が申し出て一括で引いてもらう形（321条の5第2項ただし書）は扱わない
// それ以外は普通徴収（6月・8月・10月・翌年1月の4回）。
// 改訂9: 年金から差し引く（特別徴収）かの判定で、表の最後の年の年度の、表の外の翌年2月の年金の支払いを、表の最後の月の支払いと同じ額とみなす（0003 の追記）
// 非課税限度額（residentTax.exemption）以下なら均等割・所得割をかけない。指定都市の税率の配分・超過課税は扱わない（notices）。
// 住宅借入金等特別税額控除: 前年分の所得税から引ききれなかった住宅借入金等特別控除（incomeTax.annual の creditRemainder）を、
// 所得税の課税総所得金額等×率（5%など）と上限額（97,500円など。入居の年月で選ぶ。tax.housingLoanCredit）まで、調整控除の後の所得割から
// 市町村民税5分の3・道府県民税5分の2で引く（引ききれない分は無くなる）。居住年が平成28年〜令和7年のときは、上限の基礎の課税総所得金額等に
// （所得税の基礎控除の額−48万円。0未満は0）を足す（地方税法附則5条の4。改訂6）
// 年金からの特別徴収: 年度の初日に65歳以上で、年金が年18万円以上なら、公的年金等に係る所得割（所得割×公的年金等に係る雑所得÷合計所得金額）と
// （給与からの特別徴収が無ければ）均等割・森林環境税を年金から差し引く。前の年度に年金から差し引いていなければ、6月・8月に4分の1ずつ普通徴収し、
// 10月・12月・2月に6分の1ずつ。前の年度から続くときは、4月・6月・8月に前の年度の年金の分の6分の1ずつ（仮徴収）、10月・12月・2月に残りを3分の1ずつ
// 改訂10（0081）: 青色申告の純損失の繰越控除（tax.lossCarryforward の deducted。前の年の分）を総所得金額から引いてから所得割を計算する
//   （地方税法32条8項・313条8項）。非課税の判定・調整控除の所得の上限は合計所得金額（引く前）のまま。青色でない人は0で、結果は同じ
// 年度の初めの年の1月1日に世帯にいない（leaves がその月以前。万一の重ねで亡くなった人）構成員には、その年度の住民税をかけない（改訂7）
import {
  ageMonth,
  boxValue,
  fiscalYearOf,
  pensionSpecial,
  PENSION_SPECIAL_MINIMUM,
  defineComponent,
  formatYm,
  monthIndex,
  subYen,
  yen,
  type Ctx,
  type DeductionsOutput,
  type ExemptionOutput,
  type HousingLoanCreditOutput,
  type IncomeTaxOutput,
  type LossCarryforwardOutput,
  type Flow,
  type LevyPair,
  type MonthIndex,
  type ResidentTaxAssessmentInput,
  type ResidentTaxOutput,
  type SalaryOutput,
  type TotalIncomeOutput,
  type Timepoint,
  type Yen,
} from "../../sdk/index.ts";

const CALC = "residentTax.incomeLevy.calc.rounding";
const LEVY = "residentTax.incomeLevy.rounding";
const PENSION_AGE = "residentTax.pensionSpecialCollection.age";
// 地方税法20条の4の2第6項: 分割して納める金額の端数（普通徴収は1,000円未満、特別徴収は100円未満）は最初の納期の分に合わせる
const ORDINARY = "residentTax.installment.ordinary.rounding";
const SPECIAL = "residentTax.installment.special.rounding";

type Levy = Omit<ResidentTaxOutput, "flows" | "assessed">;
const PAIR0: LevyPair = { municipal: yen(0), prefectural: yen(0) };

function levy(ctx: Ctx, fiscalYear: number, member: string, incomeYear: number, total: Yen, carry: Yen = yen(0)): Levy {
  const ded = ctx.call<DeductionsOutput>("tax.deductions", { member, year: incomeYear, regime: "residentTax" });
  const at = ctx.at(monthIndex(fiscalYear, 6));
  // 純損失の繰越控除の後の総所得金額（調整控除の所得の上限は合計所得金額で見る）
  const base = yen(total - carry);
  const taxable = at.money.round(base > ded.total ? subYen(base, ded.total) : yen(0), "residentTax.taxableIncome.rounding");
  // 調整控除: 合計課税所得金額が200万円以下なら min(人的控除額の差の合計, 合計課税所得金額)、超えるなら
  // 差の合計−(合計課税所得金額−200万円)（5万円を下回るときは5万円）に、市町村民税3%・道府県民税2%を掛ける
  let creditBase = yen(0);
  const incomeLimit = at.paramYen("residentTax.adjustmentCredit.incomeLimit");
  if (taxable > 0 && (incomeLimit === null || total <= incomeLimit)) {
    const threshold = at.paramYen("residentTax.adjustmentCredit.threshold") ?? yen(0);
    const minimum = at.paramYen("residentTax.adjustmentCredit.minimumBase") ?? yen(0);
    const d = ded.personalDiff;
    if (taxable <= threshold) creditBase = d < taxable ? d : taxable;
    else {
      const v = d - (taxable - threshold);
      creditBase = yen(v > minimum ? v : minimum);
    }
  }
  // 住宅借入金等特別税額控除（前年分の所得税から引ききれなかった額を、上限まで）
  let housing = yen(0);
  const window = ctx.call<{ from: number | null; to: number | null }>("tax.housingLoanCreditYears", { member });
  const inWindow = window.from !== null && window.to !== null && incomeYear >= window.from && incomeYear <= window.to;
  const hc = inWindow ? ctx.call<HousingLoanCreditOutput>("tax.housingLoanCredit", { member, year: incomeYear }) : null;
  if (hc !== null && hc.credit > 0 && hc.residentRate !== null) {
    const it = ctx.call<IncomeTaxOutput>("incomeTax.annual", { member, year: incomeYear });
    const remainder = it.creditRemainder ?? yen(0);
    if (remainder > 0) {
      // 居住年が平成28年〜令和7年のときは、課税総所得金額等に（所得税の基礎控除の額−48万円。0未満は0）を足す（地方税法附則5条の4）
      let capBase = it.taxable;
      if (hc.residentBasicOffset !== undefined) {
        const basic = ctx.call<DeductionsOutput>("tax.deductions", { member, year: incomeYear, regime: "incomeTax" }).basic;
        if (basic > hc.residentBasicOffset) capBase = yen(capBase + basic - hc.residentBasicOffset);
      }
      let cap = ctx.money.mulRate(capBase, ctx.rate.of(hc.residentRate), "conv.residentTax.housingCredit");
      if (hc.residentLimit !== null && cap > hc.residentLimit) cap = hc.residentLimit;
      housing = remainder < cap ? remainder : cap;
    }
  }
  const housingMunicipal = housing > 0 ? ctx.money.mulRatio(housing, 3, 5, "conv.residentTax.housingCredit") : yen(0);
  const housingParts = { municipal: housingMunicipal, prefectural: yen(housing - housingMunicipal) };
  const used = { municipal: yen(0), prefectural: yen(0) };
  const part = (rateId: string, creditId: string, which: "municipal" | "prefectural"): [Yen, Yen, Yen] => {
    const r = at.paramRate(rateId);
    const cr = at.paramRate(creditId);
    const gross = r === null ? yen(0) : at.money.mulRate(taxable, r, CALC);
    const credit = cr === null ? yen(0) : at.money.mulRate(creditBase, cr, CALC);
    const after = gross > credit ? subYen(gross, credit) : yen(0);
    const h = housingParts[which] < after ? housingParts[which] : after;
    used[which] = h;
    return [gross, credit, at.money.round(yen(after - h), LEVY)];
  };
  const [gm, cm, lm] = part("residentTax.incomeLevy.municipalRate", "residentTax.adjustmentCredit.municipalRate", "municipal");
  const [gp, cp, lp] = part("residentTax.incomeLevy.prefecturalRate", "residentTax.adjustmentCredit.prefecturalRate", "prefectural");
  const perCapita = { municipal: at.paramYen("residentTax.perCapita.municipal") ?? yen(0), prefectural: at.paramYen("residentTax.perCapita.prefectural") ?? yen(0) };
  const forest = at.paramYen("forestEnvironmentTax.amount") ?? yen(0);
  return {
    total: yen(lm + lp + perCapita.municipal + perCapita.prefectural + forest),
    taxable,
    grossLevy: { municipal: gm, prefectural: gp },
    adjustmentCredit: { municipal: cm, prefectural: cp },
    incomeLevy: { municipal: lm, prefectural: lp },
    perCapita,
    forestEnvironmentTax: forest,
    ...(housing > 0 ? { housingLoanCredit: used } : {}),
  };
}

const NONE: Levy = { total: yen(0), taxable: yen(0), grossLevy: PAIR0, adjustmentCredit: PAIR0, incomeLevy: PAIR0, perCapita: PAIR0, forestEnvironmentTax: yen(0) };

export default defineComponent<{ member: string; fiscalYear: number }, ResidentTaxOutput>({
  id: "residentTax.annual",
  title: "住民税・森林環境税",
  contract: "1.1",
  revision: 10,
  requires: {
    "tax.totalIncome": ">=1 <2",
    "tax.lossCarryforward": ">=1 <2",
    "tax.housingLoanCreditYears": ">=1 <2",
    "tax.housingLoanCredit": ">=1 <2",
    "incomeTax.annual": ">=1 <2",
    "tax.deductions": ">=1 <2",
    "income.salary": ">=1 <2",
    "residentTax.exemption": ">=1 <2",
    "pension.oldAge": ">=1 <2",
  },
  params: [
    "residentTax.taxableIncome.rounding",
    CALC,
    LEVY,
    "residentTax.incomeLevy.municipalRate",
    "residentTax.incomeLevy.prefecturalRate",
    "residentTax.adjustmentCredit.incomeLimit",
    "residentTax.adjustmentCredit.threshold",
    "residentTax.adjustmentCredit.minimumBase",
    "residentTax.adjustmentCredit.municipalRate",
    "residentTax.adjustmentCredit.prefecturalRate",
    "residentTax.perCapita.municipal",
    "residentTax.perCapita.prefectural",
    "forestEnvironmentTax.amount",
    PENSION_AGE,
    PENSION_SPECIAL_MINIMUM,
    ORDINARY,
    SPECIAL,
  ],
  reads: ["residentTaxAssessment.member", "residentTaxAssessment.fiscalYear", "residentTaxAssessment.amount", "residentTaxAssessment.collection", "member.leaves"],
  memberScope: ["residentTaxAssessment"],
  input: "residentTax.annual.input",
  output: "residentTax.annual.output",
  compute(input, ctx) {
    const { member, fiscalYear } = input;
    const incomeYear = fiscalYear - 1;
    // 賦課期日（1月1日）に世帯にいない構成員にはかけない
    const leaves = ctx.get<{ leaves: Timepoint | null }>("member", member).leaves;
    if (leaves !== null && ctx.time.resolve(leaves) <= monthIndex(fiscalYear, 1)) return { flows: [], assessed: false, ...NONE };
    const given = ctx.list<ResidentTaxAssessmentInput>("residentTaxAssessment").find((a) => a.member === member && a.fiscalYear === fiscalYear);
    // 給与を受ける月か（支払いは月の昇順なので、その月の支払いだけを二分探索で見る）
    // 給与を受ける月か（その年度の6月〜翌年5月の支払いだけを読む。ほかの年の給与が変わっても計算し直さない）
    const salaryMonths = (fy: number) =>
      new Set(ctx.callMonths<SalaryOutput["payments"][number]>("income.salary", { member }, "payments", monthIndex(fy, 6), monthIndex(fy + 1, 5)).filter((p) => p.salary > 0).map((p) => p.ym));
    const paid = salaryMonths(fiscalYear);
    const salarySpecial = (fy: number, g: ResidentTaxAssessmentInput | undefined) =>
      g?.collection !== undefined ? g.collection === "special" : (fy === fiscalYear ? paid : salaryMonths(fy)).has(formatYm(monthIndex(fy, 6)));
    // 年度の税額と、そのうち年金から差し引く額
    const assess = (fy: number): { detail: Levy; assessed: boolean; pension: Yen } => {
      const g = ctx.list<ResidentTaxAssessmentInput>("residentTaxAssessment").find((a) => a.member === member && a.fiscalYear === fy);
      let detail: Levy;
      let inc: TotalIncomeOutput | null = null;
      if (g !== undefined) detail = { ...NONE, total: boxValue(g.amount) ?? yen(0) };
      else {
        inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year: fy - 1 });
        if (inc.total <= 0) return { detail: NONE, assessed: false, pension: yen(0) };
        ctx.notice("N_NOT_SUPPORTED", ["residentTax.designatedCityAllocation", "residentTax.excessTaxation"]);
        const ex = ctx.call<ExemptionOutput>("residentTax.exemption", { member, fiscalYear: fy });
        if (ex.perCapitaExempt) return { detail: NONE, assessed: false, pension: yen(0) };
        const carry = ctx.call<LossCarryforwardOutput>("tax.lossCarryforward", { member }).byYear.find((x) => x.year === fy - 1)?.deducted ?? yen(0);
        detail = levy(ctx, fy, member, fy - 1, inc.total, carry);
        if (ex.incomeLevyExempt) {
          const pc = detail.perCapita;
          detail = { ...NONE, perCapita: pc, forestEnvironmentTax: detail.forestEnvironmentTax, total: yen(pc.municipal + pc.prefectural + detail.forestEnvironmentTax) };
        }
      }
      // 年金からの特別徴収
      const start = monthIndex(fy, 4);
      const eligible = ageMonth(ctx, start, PENSION_AGE, member) <= start && pensionSpecial(ctx, member, fy);
      let pension = yen(0);
      if (eligible && detail.total > 0) {
        const share =
          inc !== null && inc.total > 0
            ? ctx.money.mulRatio(yen(detail.incomeLevy.municipal + detail.incomeLevy.prefectural), inc.publicPension ?? 0, inc.total, "conv.residentTax.pensionShare")
            : yen(0);
        const capita = salarySpecial(fy, g) ? yen(0) : yen(detail.perCapita.municipal + detail.perCapita.prefectural + detail.forestEnvironmentTax);
        pension = g !== undefined ? (salarySpecial(fy, g) ? yen(0) : detail.total) : yen(share + capita);
        if (pension > detail.total) pension = detail.total;
      }
      return { detail, assessed: g !== undefined, pension };
    };
    const now = assess(fiscalYear);
    const detail = now.detail;
    const total = detail.total;
    const assessed = now.assessed;
    if (total <= 0) return { flows: [], assessed, ...detail };
    // 年度の納期の端数処理（6月から翌年5月の年度の値）
    const at = ctx.at(monthIndex(fiscalYear, 6));
    const special = salarySpecial(fiscalYear, given);
    const flows: Flow[] = [];
    const push = (ym: string, amount: Yen, formula: string) => {
      if (amount > 0) flows.push({ row: "cf.taxSi.residentTax", ym, amount, accrualYear: incomeYear, member, formula });
    };
    // 年金からの特別徴収の分
    const pensionPart = now.pension;
    if (pensionPart > 0) {
      // 前の年度が計算基準月より前で決定額の入力も無いときは、前の年度から同じ額の特別徴収が続いているとみなす（65歳の年度を除く）
      const before = fiscalYear - 1 < fiscalYearOf(ctx.time.base) && !ctx.list<ResidentTaxAssessmentInput>("residentTaxAssessment").some((a) => a.member === member && a.fiscalYear === fiscalYear - 1);
      const prev = before
        ? ageMonth(ctx, monthIndex(fiscalYear - 1, 4), PENSION_AGE, member) <= monthIndex(fiscalYear - 1, 4)
          ? pensionPart
          : yen(0)
        : assess(fiscalYear - 1).pension;
      const m = (y: number, mo: number) => formatYm(monthIndex(y, mo));
      if (prev <= 0) {
        // 年金から差し引く最初の年度: 年額の半分（6月・8月）を普通徴収、残り（10月・12月・2月）を特別徴収。それぞれの分割の端数は最初の納期へ
        const halves = ctx.money.allocate(pensionPart, [6, 6], "conv.residentTax.pensionShare", "first");
        const o = at.money.allocate(halves[0] as Yen, [1, 1], ORDINARY, "first");
        const s = at.money.allocate(halves[1] as Yen, [1, 1, 1], SPECIAL, "first");
        push(m(fiscalYear, 6), o[0] as Yen, "residentTax.pension.ordinary");
        push(m(fiscalYear, 8), o[1] as Yen, "residentTax.pension.ordinary");
        push(m(fiscalYear, 10), s[0] as Yen, "residentTax.pension.special");
        push(m(fiscalYear, 12), s[1] as Yen, "residentTax.pension.special");
        push(m(fiscalYear + 1, 2), s[2] as Yen, "residentTax.pension.special");
      } else {
        // 仮徴収（4月・6月・8月）: 前の年度の年金の分の2分の1を3回に分ける。本徴収（10月・12月・2月）: 残りを3回に分ける
        const provisionalTotal = ctx.money.mulRatio(prev, 1, 2, "conv.residentTax.pensionShare");
        const provisional = at.money.allocate(provisionalTotal, [1, 1, 1], SPECIAL, "first");
        [4, 6, 8].forEach((mo, i) => push(m(fiscalYear, mo), provisional[i] as Yen, "residentTax.pension.provisional"));
        const rest = pensionPart - provisionalTotal;
        if (rest > 0) {
          const parts = at.money.allocate(yen(rest), [1, 1, 1], SPECIAL, "first");
          push(m(fiscalYear, 10), parts[0] as Yen, "residentTax.pension.special");
          push(m(fiscalYear, 12), parts[1] as Yen, "residentTax.pension.special");
          push(m(fiscalYear + 1, 2), parts[2] as Yen, "residentTax.pension.special");
        }
      }
    }
    const remaining = yen(total - pensionPart);
    if (remaining <= 0) return { flows, assessed, ...detail };
    const installments = Array.from({ length: 12 }, (_, i) => (i < 7 ? monthIndex(fiscalYear, 6 + i) : monthIndex(fiscalYear + 1, i - 6)));
    // 特別徴収の最初の月に給与が無ければ普通徴収にする。表の最後より後の月は、給与が続くものとみなす
    const firstUnpaid = special ? installments.findIndex((mm) => mm <= ctx.time.end && !paid.has(formatYm(mm))) : 0;
    if (firstUnpaid !== 0) {
      const parts = at.money.allocate(remaining, installments.map(() => 1), SPECIAL, "first");
      const stop = firstUnpaid < 0 ? 12 : firstUnpaid;
      let rest = yen(0);
      for (let i = stop; i < 12; i++) rest = yen(rest + (parts[i] as Yen));
      // 最後の給与が翌年1〜4月（installments の7〜10番目）なら、残りは最後の給与の月にまとめて徴収する（一括徴収）
      const lumpSum = stop - 1 >= 7;
      for (let i = 0; i < stop; i++) {
        const ym = formatYm(installments[i] as never);
        push(ym, parts[i] as Yen, "residentTax.special.installment");
        if (lumpSum && i === stop - 1) push(ym, rest, "residentTax.special.lumpSum");
      }
      if (!lumpSum && rest > 0) {
        // 6〜12月に辞めた: 特別徴収が止まった月（最初に給与の無い月）以後の普通徴収の納期に分ける（無ければその月に。321条の7）
        const stopped = installments[stop] as MonthIndex;
        const regular = [monthIndex(fiscalYear, 6), monthIndex(fiscalYear, 8), monthIndex(fiscalYear, 10), monthIndex(fiscalYear + 1, 1)].filter((mm) => mm >= stopped);
        const ms = regular.length > 0 ? regular : [stopped];
        const ordinary = at.money.allocate(rest, ms.map(() => 1), ORDINARY, "first");
        ms.forEach((mm, i) => push(formatYm(mm), ordinary[i] as Yen, "residentTax.ordinary.installment"));
      }
    } else {
      const ms = [monthIndex(fiscalYear, 6), monthIndex(fiscalYear, 8), monthIndex(fiscalYear, 10), monthIndex(fiscalYear + 1, 1)];
      const parts = at.money.allocate(remaining, ms.map(() => 1), ORDINARY, "first");
      ms.forEach((mm, i) => push(formatYm(mm), parts[i] as Yen, "residentTax.ordinary.installment"));
    }
    return { flows, assessed, ...detail };
  },
});

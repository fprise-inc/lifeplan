// 退職所得の分離課税（所得税・復興特別所得税・防衛特別所得税と住民税。0003・0008 の追記）。構成員×年ごとに、その年に受け取る一時金
// （退職手当等・確定拠出年金の老齢給付金の一時金・小規模企業共済の共済金。retirement.receipts）を合わせて計算する。
// - 勤続年数: その年の一時金の勤続期間を合わせた期間（重なりは1回だけ数える）の月数を12で割り、1年未満を切り上げ
// - 退職所得控除額: 勤続年数が20年以下は40万円×年数、20年超は800万円＋70万円×(年数−20)。前の年に受けた一時金と勤続期間が重なるとき
//   （重複排除期間）は、重なる期間の年数（1年未満切り捨て）の控除額を引く。前の一時金の範囲: 退職手当等を受ける年は前年以前4年内
//   （前に受けたのが確定拠出年金の一時金なら9年内。令和8年以後に受けるもの。その9年内に確定拠出年金の一時金があるときは、前の退職手当等のうち
//   令和8年以後に受けたものも9年内で見る（施行令70条1項2号ロ(1)。改訂2））、確定拠出年金の一時金を受ける年は前年以前19年内（令和4年4月1日以後に
//   支払を受けるべき一時金。それより前は14年内。一時金の支払の月で引く）。
//   前の一時金の額がその控除額に満たないときは、前の勤続期間を、額を40万円（800万円を超える分は70万円）で割った年数（切り捨て）とみなす
//   （始まりから数える）。引いた後が80万円に満たなければ80万円。障害者になったことによる退職は100万円を足す。年数と時期は制度データ
// - 退職所得の金額: (収入−控除)×1/2。特定役員退職手当等（役員等の勤続年数が5年以下）は1/2にしない。短期退職手当等（勤続5年以下、役員以外）は
//   控除の後の300万円を超える部分を1/2にしない。特定役員と他の一時金を同じ年に受けるときは、控除額を特定役員の分（40万円×役員の年数まで）と
//   残りに分ける近似（施行令71条の2の重複期間の按分は扱わない。知らせ N_APPROXIMATED）
// - 課税退職所得金額（1,000円未満切り捨て）に、所得税は税率の表（総合課税と同じ表）と付加税（(A×B−C)×102.1% の形。1円未満切り捨て）、
//   住民税は所得割の率（市町村民税・道府県民税。100円未満切り捨て）
// - 「退職所得の受給に関する申告書」を出したものとして、支払いのたびに、それまでのその年の一時金を合わせた税額との差を源泉徴収・特別徴収する
//   （支払いの月。確定申告での精算はしない）
import {
  bracketFor,
  defineComponent,
  formatYm,
  monthIndex,
  parseYm,
  RATE_ZERO,
  yen,
  type Flow,
  type MonthCtx,
  type MonthIndex,
  type RetirementIncomeOutput,
  type RetirementReceipt,
} from "../../sdk/index.ts";

const R = "incomeTax.retirementIncome";
const P = {
  first: `${R}.deduction.perYearFirst`,
  after: `${R}.deduction.perYearAfter`,
  threshold: `${R}.deduction.yearsThreshold`,
  minimum: `${R}.deduction.minimum`,
  disability: `${R}.deduction.disabilityAddition`,
  ratio: `${R}.taxableRatio`,
  officer: `${R}.specifiedOfficer.maxYears`,
  shortYears: `${R}.shortTerm.maxYears`,
  shortLimit: `${R}.shortTerm.halfLimit`,
  lb: `${R}.overlap.lookbackYears`,
  lbAfterDc: `${R}.overlap.lookbackYearsAfterDc`,
  lbForDc: `${R}.overlap.lookbackYearsForDc`,
  taxableRound: `${R}.taxable.rounding`,
  withholdRound: `${R}.withholding.rounding`,
  table: "incomeTax.taxRateTable",
  recon: "incomeTax.reconstructionSurtax.rate",
  defense: "incomeTax.defenseSurtax.rate",
  muni: "residentTax.incomeLevy.municipalRate",
  pref: "residentTax.incomeLevy.prefecturalRate",
  rRound: "residentTax.incomeLevy.rounding",
};
/** 前の一時金を見る年数の最大（確定拠出年金の一時金を受ける年の前年以前19年内） */
const WINDOW = 20;

const ZERO: RetirementIncomeOutput = { flows: [], total: yen(0), revenue: yen(0), deduction: yen(0), income: yen(0), taxable: yen(0), years: 0, overlapYears: 0, incomeTax: yen(0), residentTax: yen(0) };

/** 期間（年月の範囲）の月の集まり */
function monthsOf(from: string, to: string): MonthIndex[] {
  const a = parseYm(from);
  const b = parseYm(to);
  const out: MonthIndex[] = [];
  for (let m = a; m <= b; m = (m + 1) as MonthIndex) out.push(m);
  return out;
}

export default defineComponent<{ member: string; year: number }, RetirementIncomeOutput>({
  id: "tax.retirementIncome",
  title: "退職所得の税（分離課税）",
  contract: "1.0",
  revision: 2,
  requires: { "retirement.receipts": ">=1 <2" },
  params: Object.values(P),
  reads: [],
  input: "tax.memberYear.input",
  output: "tax.retirementIncome.output",
  compute(input, ctx) {
    const { member, year } = input;
    const all = ctx.callMonths<RetirementReceipt>("retirement.receipts", { member }, "receipts", monthIndex(year - WINDOW, 1), monthIndex(year, 12));
    const now = all.filter((r) => r.ym.startsWith(`${year}-`));
    if (now.length === 0) return ZERO;
    const prior = all.filter((r) => Number(r.ym.slice(0, 4)) < year);
    const at = ctx.at(monthIndex(year, 1));
    const count = (m: MonthCtx, id: string) => m.paramCount(id);
    const first = at.paramYen(P.first) ?? yen(0);
    const after = at.paramYen(P.after) ?? yen(0);
    const threshold = count(at, P.threshold) ?? 20;
    const times = (a: number, n: number): number => ctx.money.mulRatio(yen(a), n, 1, "conv.exact");
    const upTo = times(first, threshold);
    /** 勤続年数 n 年の退職所得控除額（80万円の下限の前） */
    const D = (n: number): number => (n <= 0 ? 0 : n <= threshold ? times(first, n) : upTo + times(after, n - threshold));
    /** 前の一時金の額から換算した勤続年数（施行令70条2項。切り捨て） */
    const yearsFromAmount = (a: number): number => (a <= upTo ? Math.floor(a / Math.max(first, 1)) : threshold + Math.floor((a - upTo) / Math.max(after, 1)));
    const minimum = at.paramYen(P.minimum) ?? yen(0);
    const officerMax = count(at, P.officer);
    const shortMax = at.has(P.shortYears) ? count(at, P.shortYears) : null;
    const shortLimit = at.has(P.shortLimit) ? (at.paramYen(P.shortLimit) ?? null) : null;
    const lbAt = (mi: MonthIndex, id: string): number | null => {
      const m = ctx.at(mi);
      return m.has(id) ? count(m, id) : null;
    };
    const lbOf = (y: number, id: string): number | null => lbAt(monthIndex(y, 1), id);
    const lb = count(at, P.lb) ?? 4;
    const ratio = at.paramRate(P.ratio) ?? RATE_ZERO;
    let approximated = false;

    const taxOf = (set: readonly RetirementReceipt[]) => {
      const revenue = set.reduce((s, r) => s + r.amount, 0);
      const union = new Set<number>();
      for (const r of set) for (const m of monthsOf(r.serviceFrom, r.serviceTo)) union.add(m);
      const years = Math.max(1, Math.ceil(union.size / 12));
      // 重複排除期間
      // 確定拠出年金の一時金を受ける年の年数（19年内）は、その一時金の支払の日で分かれる（令和4年4月1日以後に支払を受けるべきもの）ので、支払の月で引く
      const dcReceipt = set.find((r) => r.source === "dc");
      const priorMonths = new Set<number>();
      // 前年以前の年数（前の一時金が確定拠出年金のもの・令和8年以後の退職手当等。今の年と前の年の値の小さい方）
      const afterDc = (py: number): number => {
        const a = lbOf(year, P.lbAfterDc);
        const b = lbOf(py, P.lbAfterDc);
        return a === null || b === null ? lb : Math.min(a, b);
      };
      // 9年内に確定拠出年金の一時金を受けているか（ロ(1): そのときは前の退職手当等も9年内で見る）
      const dcBefore = dcReceipt === undefined && prior.some((p) => p.source === "dc" && Number(p.ym.slice(0, 4)) >= year - afterDc(Number(p.ym.slice(0, 4))));
      for (const p of prior) {
        const py = Number(p.ym.slice(0, 4));
        let L: number;
        if (dcReceipt !== undefined) L = lbAt(parseYm(dcReceipt.ym), P.lbForDc) ?? lb;
        else if (p.source === "dc" || dcBefore) L = afterDc(py);
        else L = lb;
        if (py < year - L) continue;
        let ms = monthsOf(p.serviceFrom, p.serviceTo);
        const pYears = Math.max(1, Math.ceil(ms.length / 12));
        if (p.amount < D(pYears)) ms = ms.slice(0, yearsFromAmount(p.amount) * 12);
        for (const m of ms) priorMonths.add(m);
      }
      let overlap = 0;
      for (const m of union) if (priorMonths.has(m)) overlap++;
      const overlapYears = Math.floor(overlap / 12);
      let deduction = D(years) - D(overlapYears);
      if (deduction < minimum) deduction = minimum;
      if (set.some((r) => r.disability === true)) deduction += at.paramYen(P.disability) ?? 0;
      // 特定役員退職手当等・短期退職手当等
      const officerYears = (r: RetirementReceipt) => (r.officerFrom === undefined || r.officerTo === undefined ? null : Math.ceil(monthsOf(r.officerFrom, r.officerTo).length / 12));
      const specified = set.filter((r) => {
        const oy = officerYears(r);
        return oy !== null && officerMax !== null && oy <= officerMax;
      });
      const others = set.filter((r) => !specified.includes(r));
      const half = (x: number) => ctx.money.mulRate(yen(x), ratio, "conv.tax.exact");
      const shortOf = (x: number): number => {
        // 短期退職手当等: 控除の後の額のうち上限を超える部分は1/2にしない
        if (shortLimit === null || x <= shortLimit) return half(x);
        return half(shortLimit) + (x - shortLimit);
      };
      const isShort = shortMax !== null && years <= shortMax;
      let income: number;
      if (specified.length === 0) {
        const x = Math.max(0, revenue - deduction);
        income = isShort ? shortOf(x) : half(x);
      } else {
        const sYears = Math.max(...specified.map((r) => officerYears(r) ?? 0));
        const sRevenue = specified.reduce((s, r) => s + r.amount, 0);
        const sDed = others.length === 0 ? deduction : Math.min(deduction, times(first, sYears));
        const oRevenue = revenue - sRevenue;
        const oDed = deduction - sDed;
        const ox = Math.max(0, oRevenue - oDed);
        income = Math.max(0, sRevenue - sDed) + (isShort ? shortOf(ox) : half(ox));
        if (others.length > 0) approximated = true;
      }
      const taxable = at.money.round(yen(income), P.taxableRound);
      const b = bracketFor(at.paramBrackets(P.table) ?? [], taxable);
      const computed0 = b.rate === undefined ? 0 : ctx.money.mulRate(taxable, b.rate, "conv.tax.exact") - (b.amount ?? 0);
      const computed = yen(computed0 > 0 ? computed0 : 0);
      const surRate = ctx.rate.add(at.paramRate(P.recon) ?? RATE_ZERO, at.paramRate(P.defense) ?? RATE_ZERO);
      const incomeTax = yen(computed + at.money.mulRate(computed, surRate, P.withholdRound));
      const rAt = ctx.at(monthIndex(year, 6));
      const muni = rAt.money.mulRate(taxable, rAt.paramRate(P.muni) ?? RATE_ZERO, P.rRound);
      const pref = rAt.money.mulRate(taxable, rAt.paramRate(P.pref) ?? RATE_ZERO, P.rRound);
      return { revenue: yen(revenue), deduction: yen(deduction), income: yen(income), taxable, years, overlapYears, incomeTax, residentTax: yen(muni + pref) };
    };

    const flows: Flow[] = [];
    let paidIt = 0;
    let paidRt = 0;
    let last = taxOf(now);
    const base = ctx.time.base;
    for (let k = 0; k < now.length; k++) {
      const r = now[k] as RetirementReceipt;
      last = taxOf(now.slice(0, k + 1));
      const it = last.incomeTax - paidIt;
      const rt = last.residentTax - paidRt;
      paidIt = last.incomeTax;
      paidRt = last.residentTax;
      const m = parseYm(r.ym);
      if (m < base) continue;
      if (it !== 0) flows.push({ row: "cf.taxSi.incomeTax.retirement", ym: formatYm(m), amount: yen(it), accrualYear: year, member, object: r.object, formula: "tax.retirementIncome.withholding" });
      if (rt !== 0) flows.push({ row: "cf.taxSi.residentTax.retirement", ym: formatYm(m), amount: yen(rt), accrualYear: year, member, object: r.object, formula: "tax.retirementIncome.specialCollection" });
    }
    if (approximated) ctx.notice("N_APPROXIMATED", [`${R}.specifiedOfficer.mixed`]);
    return { flows, total: yen(last.incomeTax + last.residentTax), ...last };
  },
});

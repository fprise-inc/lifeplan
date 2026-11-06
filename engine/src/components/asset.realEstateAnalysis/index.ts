// 収益不動産の分析の数字（物件ごと・年ごとと、全物件の合計。0082）。計算は変えない（表・税は asset.realEstate・debt.schedule・税の部品のまま）。
// 年は計算基準年から、持っている月が表にある年（売った年まで）。金額は表に載る月（計算基準月から）の分で、キャッシュフロー表と同じ。
// - 実際に入る収入（rent）: 家賃収入の行のこの物件の分（礼金・更新料を含む）。満室のときの収入（gross）: 空室を見込む前の家賃と家賃以外の月の収入
//   （礼金・更新料は入れない。民泊・宿は稼働率100%の売上で、月の売上で入れたときは無い）
// - 経費（expenses）は大きな修繕を除く。大きな修繕（repairs）は別に持つ
// - 年の返済（repayment）: この物件を指す負債の返済（毎月・ボーナス・繰上返済・手数料。売ったときの一括の返済は除き、exit に出す）。
//   約定の返済（debtService）は毎月とボーナスの返済だけ（返済比率・返済余裕率・損益分岐の入居率に使う）。元金（principal）は約定の返済−利息
// - 税引前の手残り＝実際に入る収入−経費−大きな修繕−年の返済。税引後の手残り＝税引前の手残り−その物件で増える税と社会保険料（tax）
// - その物件で増える税と社会保険料（近似）: その年の物件の所得（不動産所得。損失は土地の取得のための借入の利息の分を除く。雑所得の損失は0。
//   青色申告特別控除は不動産所得の黒字の物件に黒字の割合で分ける）の分だけ、課税所得を下げたときの差。所得税（税率の表。復興特別所得税・
//   防衛特別所得税を含む）・住民税の所得割（市町村民税と道府県民税の率）・国民健康保険・後期高齢者医療の所得割（翌年度に入っている月数の分。
//   料率の入力が無ければ全国の目安）。所得の年に置く（払う月のずれは見ない）。所得控除の段・賦課限度額・軽減・純損失の繰越控除の変わり方は
//   見ない。計算基準年は、表に載る月の分に貸している月数で按分する
// - 率（分母が0・無いときは null）: 表面利回り＝満室のときの収入（年換算）÷取得価額、実質利回り（NOI 利回り）＝（実際に入る収入−経費）（年換算）
//   ÷（取得価額＋取得時の諸費用）、損益分岐の入居率＝（経費＋約定の返済）÷満室のときの収入、返済比率＝約定の返済÷実際に入る収入、
//   返済余裕率（DSCR）＝（実際に入る収入−経費）÷約定の返済、借入の割合（LTV）＝年末のローン残高÷年末の評価額（ローンのある物件）、
//   自己資金に対する手残りの割合（CCR）＝税引前の手残り（年換算）÷自己資金（入れたときだけ）。年換算は×12÷貸している月数（表に載る月の分）。
//   民泊・宿は表面利回りを出さず（満室の考えが無い）、稼働率と1泊の単価・営業日数・年の売上を並べる（損益分岐は稼働率100%の売上に対する割合）
// - 築年数＝その年−建った年、残りの耐用年数＝法定耐用年数−築年数（0より下げない）。建物の無い物件（asset.realEstate の facts.noBuilding）は出さない
// - 売ったときの手残りの目安（equity）＝年末の評価額−年末のローン残高。含み益（unrealizedGain。改訂2）＝年末の評価額−年末の帳簿価額
//   （bookValue＝取得価額＋取得時の諸費用−減価償却の累計。asset.realEstate の years[].book。取得の入力が無ければ出さない）
// - 減価償却が終わる年が売る・貸し終わるまでに来ないときは、貸し続けたら終わる年（depreciationEndIfContinued。改訂2）を添える
// - 元金の返済が減価償却費を上回る年（deadCross）: 貸している年のうち、元金＞減価償却費（建物と建物附属設備）になる最初の年（計算基準年は
//   減価償却費を表に載る月の分にそろえて比べる。計算基準年で上回っていれば、もう上回っている）
// - 売却（exit。今の予定の売却）: 手取り（売却価格−費用）・売ったときの一括の返済・譲渡所得の税（tax.realEstateSale の名義の人×年の額。
//   同じ年に同じ人が売る物件が他にもあれば、黒字の譲渡所得の割合で分ける）・税引後の手取り
// - 合計（total）: 年ごとに物件の金額を足す。率は物件の年換算の額を足して出す（分母は数字のある物件の分だけ）
// - 改訂3・約束の版 1.2（0126）: 今の実際の家賃収入で入れた物件（asset.realEstate の facts.rentBy が actual）は、満室のときの収入が無いので、
//   表面利回り・損益分岐の入居率を null にし、今の家賃収入での表面利回り（currentYield＝受け取った家賃と家賃以外の月の収入〔礼金・更新料を除く。
//   cash.current〕の年換算÷取得価額）を出す。物件に rentBy を写す。合計の表面利回り・損益分岐は、満室のときの収入のある物件だけで出す（今までどおり）
import {
  addYen,
  ageMonth,
  bracketFor,
  boxValue,
  defineComponent,
  fiscalYearOf,
  fiscalYearStart,
  healthStatusInFiscalYear,
  LATE_ELDERLY_AGE,
  monthIndex,
  rate,
  rateOverride,
  yearOf,
  yen,
  type DebtInput,
  type DebtScheduleOutput,
  type DeductionsOutput,
  type LossCarryforwardOutput,
  type MonthCtx,
  type PremiumPart,
  type PremiumRateInput,
  type Rate,
  type RealEstateAnalysisOutput,
  type RealEstateOutput,
  type RealEstateSaleTaxOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const CONV = "conv.realEstate.analysis";
const IT = { table: "incomeTax.taxRateTable", recon: "incomeTax.reconstructionSurtax.rate", defense: "incomeTax.defenseSurtax.rate", surtax: "incomeTax.surtax.rounding" };
const RT = { municipal: "residentTax.incomeLevy.municipalRate", prefectural: "residentTax.incomeLevy.prefecturalRate" };
const NH = "socialInsurance.nationalHealth";
const LE = "socialInsurance.lateElderly";
const NH_PARTS: readonly PremiumPart[] = ["medical", "elderlySupport", "care", "childSupport"];
const LE_PARTS: readonly PremiumPart[] = ["medical", "childSupport"];
const CARE = { from: "socialInsurance.care.secondaryInsuredFromAge", until: "socialInsurance.care.secondaryInsuredUntilAge" };

type Row = RealEstateAnalysisOutput["properties"][number]["years"][number];
type TotalRow = RealEstateAnalysisOutput["total"][number];

const REGULAR = new Set(["debt.schedule.equalPayment", "debt.schedule.equalPrincipal"]);
const PAYOFF = "debt.schedule.salePayoff";
const max0 = (v: number): Yen => yen(v > 0 ? v : 0);

export default defineComponent<Record<string, never>, RealEstateAnalysisOutput>({
  id: "asset.realEstateAnalysis",
  title: "収益不動産の分析の数字（利回り・返済比率・手残りなど）",
  contract: "1.2",
  revision: 3,
  requires: {
    "asset.realEstate": ">=1 <2",
    "debt.schedule": ">=1 <2",
    "tax.realEstateSale": ">=1 <2",
    "tax.totalIncome": ">=1 <2",
    "tax.lossCarryforward": ">=1 <2",
    "tax.deductions": ">=1 <2",
    "socialInsurance.healthStatus": ">=1 <2",
  },
  params: [
    ...Object.values(IT),
    ...Object.values(RT),
    ...NH_PARTS.map((p) => `${NH}.${p}.incomeRate`),
    `${NH}.incomeDeduction`,
    ...LE_PARTS.map((p) => `${LE}.${p}.incomeRate`),
    `${LE}.incomeDeduction`,
    ...Object.values(CARE),
    LATE_ELDERLY_AGE,
  ],
  reads: ["debt.property", "member.leaves", "premiumRate.kind", "premiumRate.fromFiscalYear", "premiumRate.parts"],
  input: "empty.input",
  output: "asset.realEstateAnalysis.output",
  compute(_input, ctx) {
    const props = ctx.call<RealEstateOutput>("asset.realEstate", {}).properties;
    if (props.length === 0) return { properties: [], total: [] };
    const baseYear = yearOf(ctx.time.base);
    // 計算基準年の表に載る月数
    const baseMonths = 12 - (ctx.time.base - monthIndex(baseYear, 1));
    const debts = ctx.list<Pick<DebtInput, "id" | "property">>("debt");
    const ratio = (num: number, den: number): string | null => (den <= 0 ? null : ctx.rate.toString(ctx.rate.div(rate(String(num)), rate(String(den)))));
    const annualized = (v: Yen, months: number): Yen => (months === 12 ? v : ctx.money.mulRatio(v, 12, months, CONV));
    // 年換算の率: （額×12÷月数〔円未満切り捨て〕）÷分母。合計の行と同じ出し方
    const annualRatio = (num: number, months: number, den: number): string | null => (den <= 0 || months <= 0 ? null : ratio(annualized(yen(num), months), den));

    // ---- その物件で増える税と社会保険料（名義の人×年。物件の所得の分だけ課税所得を下げたときの差） ----
    const sale = ctx.call<RealEstateSaleTaxOutput>("tax.realEstateSale", {});
    const premiumRates = ctx.list<PremiumRateInput>("premiumRate");
    const itOf = (at: MonthCtx, x: Yen): Yen => {
      if (x <= 0) return yen(0);
      const b = bracketFor(at.paramBrackets(IT.table) ?? [], x);
      if (b.rate === undefined) return yen(0);
      const base = max0(ctx.money.mulRate(x, b.rate, CONV) - (b.amount ?? 0));
      const sur = (id: string) => {
        const r = at.has(id) ? at.paramRate(id) : null;
        return r === null ? yen(0) : at.money.mulRate(base, r, IT.surtax);
      };
      return yen(base + sur(IT.recon) + sur(IT.defense));
    };
    const rtRate = (at: MonthCtx): Rate => {
      const m = at.has(RT.municipal) ? at.paramRate(RT.municipal) : null;
      const p = at.has(RT.prefectural) ? at.paramRate(RT.prefectural) : null;
      return ctx.rate.add(m ?? rate("0"), p ?? rate("0"));
    };
    /** 健康保険の所得割の率の合計と月数（翌年度。国民健康保険・後期高齢者医療） */
    const premiumParts = (member: string, fy: number): { rate: Rate; months: number; deduction: Yen }[] => {
      const status = healthStatusInFiscalYear(ctx, member, fy);
      const national = status.filter((x) => x.kind === "national").length;
      const late = status.filter((x) => x.kind === "lateElderly").length;
      const jy = Math.max(fy, fiscalYearOf(ctx.time.base));
      const at = ctx.at(fiscalYearStart(jy));
      const out: { rate: Rate; months: number; deduction: Yen }[] = [];
      const sum = (prefix: string, kind: string, parts: readonly PremiumPart[]) => {
        const o = rateOverride(premiumRates, kind, fy);
        let r = rate("0");
        for (const part of parts) {
          if (part === "care") {
            const start = fiscalYearStart(fy) < ctx.time.base ? ctx.time.base : fiscalYearStart(fy);
            if (!(at.has(CARE.from) && at.has(CARE.until))) continue;
            if (start < ageMonth(ctx, start, CARE.from, member) || start >= ageMonth(ctx, start, CARE.until, member)) continue;
          }
          const given = o?.parts?.[part];
          if (o !== undefined) {
            const v = given?.incomeRate !== undefined ? boxValue(given.incomeRate) : null;
            if (v !== null) r = ctx.rate.add(r, rate(v));
            continue;
          }
          const id = `${prefix}.${part}.incomeRate`;
          const pv = at.has(id) ? at.paramRate(id) : null;
          if (pv !== null) r = ctx.rate.add(r, pv);
        }
        return r;
      };
      if (national > 0) out.push({ rate: sum(NH, "nationalHealth", NH_PARTS), months: national, deduction: (at.has(`${NH}.incomeDeduction`) ? at.paramYen(`${NH}.incomeDeduction`) : null) ?? yen(0) });
      if (late > 0) out.push({ rate: sum(LE, "lateElderly", LE_PARTS), months: late, deduction: (at.has(`${LE}.incomeDeduction`) ? at.paramYen(`${LE}.incomeDeduction`) : null) ?? yen(0) });
      return out;
    };
    /** 名義の人・年・物件の所得の分（effect）で増える税と社会保険料 */
    const taxEffect = (member: string, year: number, effect: Yen): Yen => {
      if (effect === 0) return yen(0);
      const ti = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year });
      const carry = ctx.call<LossCarryforwardOutput>("tax.lossCarryforward", { member }).byYear.find((x) => x.year === year)?.deducted ?? 0;
      // 損益通算で引ききれない損失（純損失）は合計所得金額を0より下げないので、その分を戻した額
      const total = ti.total - (ti.netLoss ?? 0) - carry;
      const at = ctx.at(monthIndex(year, 1));
      let tax = 0;
      if (total > 0 || effect < 0) {
        const ded = ctx.call<DeductionsOutput>("tax.deductions", { member, year, regime: "incomeTax" });
        const withIt = total - ded.total;
        tax += itOf(at, max0(withIt)) - itOf(at, max0(withIt - effect));
        const rat = ctx.at(monthIndex(year + 1, 6));
        tax += ctx.money.mulRate(yen(max0(withIt) - max0(withIt - effect)), rtRate(rat), CONV);
      }
      for (const p of premiumParts(member, year + 1)) {
        const base = total + (ti.separate ?? 0) - p.deduction;
        const d = ctx.money.mulRate(yen(max0(base) - max0(base - effect)), p.rate, CONV);
        tax += p.months >= 12 ? d : ctx.money.mulRatio(d, p.months, 12, CONV);
      }
      return yen(tax);
    };

    // 物件の所得の分（不動産所得の損失は土地の取得のための借入の利息の分を除く。雑所得の損失は0）
    const effectOf = (p: RealEstateOutput["properties"][number], year: number): Yen | null => {
      const x = p.income.find((e) => e.year === year);
      if (x === undefined) return null;
      if (x.income >= 0) return x.income;
      if (p.incomeKind === "miscellaneous") return yen(0);
      if (p.incomeKind === "business") return x.income;
      return yen(Math.min(0, x.income + x.landInterest));
    };
    // 青色申告特別控除の不動産所得の分（名義の人×年。黒字の不動産所得の物件に黒字の割合で分ける）
    const blueShare = new Map<string, { deduction: Yen; positive: number }>();
    for (const p of props) {
      if (p.incomeKind !== undefined) continue;
      for (const x of p.income) {
        if (x.income <= 0 || x.year < baseYear) continue;
        const k = `${p.owner}|${x.year}`;
        const e = blueShare.get(k);
        if (e === undefined) {
          const ti = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: p.owner, year: x.year });
          blueShare.set(k, { deduction: ti.blueDeduction ?? yen(0), positive: x.income });
        } else e.positive += x.income;
      }
    }

    const properties: RealEstateAnalysisOutput["properties"][number][] = [];
    for (const p of props) {
      const cash = p.cash ?? [];
      const facts = p.facts;
      const loans = debts.filter((d) => d.property === p.object).map((d) => ctx.call<DebtScheduleOutput>("debt.schedule", { object: d.id }));
      const hasLoan = loans.length > 0;
      const pay = new Map<number, { regular: number; other: number }>();
      let payoff = 0;
      const saleYm = p.sale?.ym ?? null;
      for (const out of loans) {
        for (const f of out.flows) {
          const y = Number(f.ym.slice(0, 4));
          const e = pay.get(y) ?? { regular: 0, other: 0 };
          if (f.formula === PAYOFF) {
            if (f.ym === saleYm) payoff += f.amount;
            else e.other += f.amount;
          } else if (REGULAR.has(f.formula)) e.regular += f.amount;
          else e.other += f.amount;
          pay.set(y, e);
        }
      }
      const interestOf = (y: number) => loans.reduce((s, out) => s + (out.interest?.find((x) => x.year === y)?.amount ?? 0), 0);
      const balanceOf = (y: number) => loans.reduce((s, out) => s + (out.yearEnd.find((x) => x.year === y)?.balance ?? 0), 0);
      const valueOf = new Map(p.years.map((v) => [v.year, v.value]));
      const bookOf = new Map(p.years.flatMap((v) => (v.book === undefined ? [] : [[v.year, v.book] as const])));
      const noBuilding = facts?.noBuilding === true;
      const incomeOf = new Map(p.income.map((v) => [v.year, v]));
      const acq = facts?.acquisition ?? null;
      const equityIn = acq?.equity;
      const lodging = facts?.lodging;
      const actualRent = facts?.rentBy === "actual";
      const isLodging = !actualRent && (p.incomeKind !== undefined || lodging !== undefined || cash.some((c) => c.gross === null));
      const years: Row[] = [];
      let deadCross: number | null = null;
      for (const c of cash) {
        const y = c.year;
        const t = incomeOf.get(y);
        const reg = pay.get(y)?.regular ?? 0;
        const repayment = yen(reg + (pay.get(y)?.other ?? 0));
        const debtService = yen(reg);
        const principal = max0(reg - interestOf(y));
        const cashBeforeTax = yen(c.rent - c.expenses - c.repairs - repayment);
        // 税は所得の年の額。計算基準年は表に載る月の分（貸している月数の割合）
        let tax = yen(0);
        const eff0 = effectOf(p, y);
        if (eff0 !== null) {
          let eff = eff0;
          const bs = blueShare.get(`${p.owner}|${y}`);
          if (bs !== undefined && eff > 0 && bs.deduction > 0) eff = yen(eff - ctx.money.mulRatio(yen(Math.min(bs.deduction, bs.positive)), eff, bs.positive, CONV));
          tax = taxEffect(p.owner, y, eff);
          // 計算基準年は、所得（暦年の全部）のうち表に載る月の分（受け取った収入の割合）
          if (y === baseYear && t !== undefined && t.rent > 0 && c.rent < t.rent) tax = ctx.money.mulRatio(tax, c.rent, t.rent, CONV);
        }
        const value = valueOf.get(y) ?? null;
        const loanBalance = yen(balanceOf(y));
        const dep = t?.depreciation ?? null;
        // 計算基準年は、減価償却費（暦年の全部）を表に載る月の分にそろえて比べる
        const depCmp = dep === null ? 0 : y === baseYear && baseMonths < 12 ? ctx.money.mulRatio(dep, baseMonths, 12, CONV) : dep;
        if (deadCross === null && c.months > 0 && hasLoan && principal > 0 && principal > depCmp) deadCross = y;
        const noi = c.rent - c.expenses;
        const age = facts === undefined || noBuilding ? null : Math.max(0, y - facts.builtYear);
        const bookValue = value === null ? null : (bookOf.get(y) ?? null);
        const row: Row = {
          year: y,
          held: value !== null,
          months: c.months,
          gross: c.gross,
          rent: c.rent,
          expenses: c.expenses,
          repairs: c.repairs,
          depreciation: dep,
          interest: t?.interest ?? null,
          income: t?.income ?? null,
          repayment,
          debtService,
          principal,
          cashBeforeTax,
          tax,
          cashAfterTax: yen(cashBeforeTax - tax),
          loanBalance,
          value,
          equity: value === null ? null : yen(value - loanBalance),
          bookValue,
          unrealizedGain: value === null || bookValue === null ? null : yen(value - bookValue),
          age,
          remainingLife: facts === undefined || age === null ? null : Math.max(0, facts.legalLife - age),
          grossYield: isLodging || c.gross === null || acq === null ? null : annualRatio(c.gross, c.months, acq.total),
          ...(actualRent ? { currentYield: acq === null || c.current === undefined ? null : annualRatio(c.current, c.months, acq.total) } : {}),
          netYield: acq === null ? null : annualRatio(noi, c.months, acq.total + acq.costs),
          breakEven: c.gross === null || c.months === 0 ? null : ratio(c.expenses + debtService, c.gross),
          repaymentRatio: !hasLoan || c.months === 0 ? null : ratio(debtService, c.rent),
          dscr: !hasLoan || c.months === 0 ? null : ratio(noi, debtService),
          ltv: !hasLoan || value === null ? null : ratio(loanBalance, value),
          ccr: equityIn === undefined || c.months === 0 ? null : annualRatio(cashBeforeTax, c.months, equityIn),
          ...(lodging !== undefined && c.months > 0 ? { lodging: { occupancy: lodging.occupancy, nightly: lodging.nightly, days: lodging.days, sales: annualized(c.rent, c.months) } } : {}),
        };
        years.push(row);
      }
      // 今の予定の売却
      let exit: RealEstateAnalysisOutput["properties"][number]["exit"] = null;
      if (p.sale !== null) {
        const sy = Number(p.sale.ym.slice(0, 4));
        const m = sale.byMember.find((x) => x.member === p.owner && x.year === sy);
        let tax = yen(0);
        if (m !== undefined && (p.sale.gain ?? 0) > 0) {
          const all = yen(m.incomeTax + m.residentTax);
          const others = props.filter((q) => q.owner === p.owner && q.sale !== null && q.sale.ym.startsWith(`${sy}-`) && (q.sale.gain ?? 0) > 0);
          const sum = others.reduce((s, q) => s + (q.sale?.gain ?? 0), 0);
          tax = others.length <= 1 || sum <= 0 ? all : ctx.money.mulRatio(all, p.sale.gain ?? 0, sum, CONV);
        }
        exit = { ym: p.sale.ym, price: p.sale.price, costs: p.sale.costs, proceeds: p.sale.proceeds, loanPayoff: yen(payoff), tax, net: yen(p.sale.proceeds - payoff - tax) };
      }
      properties.push({
        object: p.object,
        owner: p.owner,
        acquisition: acq,
        builtYear: noBuilding ? null : (facts?.builtYear ?? null),
        legalLife: noBuilding ? null : (facts?.legalLife ?? null),
        depreciationEnd: facts?.depreciationEnd ?? { building: null, equipment: null },
        ...(facts?.depreciationEndIfContinued !== undefined ? { depreciationEndIfContinued: facts.depreciationEndIfContinued } : {}),
        deadCross,
        lodging: isLodging,
        ...(actualRent ? { rentBy: "actual" as const } : {}),
        years,
        exit,
      });
    }

    // ---- 全物件の合計 ----
    const byYear = new Map<number, { row: TotalRow; gross: number; grossDen: number; noi: number; noiDen: number; ccrNum: number; ccrDen: number; beNum: number; beDen: number; loanProps: boolean; ltvValue: number }>();
    for (const a of properties) {
      const hasLoan = a.years.some((x) => x.debtService > 0 || x.loanBalance > 0 || x.repayment > 0);
      for (const r of a.years) {
        let e = byYear.get(r.year);
        if (e === undefined) {
          e = {
            row: { year: r.year, gross: yen(0), rent: yen(0), expenses: yen(0), repairs: yen(0), depreciation: yen(0), interest: yen(0), income: yen(0), repayment: yen(0), debtService: yen(0), principal: yen(0), cashBeforeTax: yen(0), tax: yen(0), cashAfterTax: yen(0), loanBalance: yen(0), value: yen(0), equity: yen(0), bookValue: null, unrealizedGain: null, grossYield: null, netYield: null, breakEven: null, repaymentRatio: null, dscr: null, ltv: null, ccr: null },
            gross: 0, grossDen: 0, noi: 0, noiDen: 0, ccrNum: 0, ccrDen: 0, beNum: 0, beDen: 0, loanProps: false, ltvValue: 0,
          };
          byYear.set(r.year, e);
        }
        const t = e.row as { -readonly [K in keyof TotalRow]: TotalRow[K] };
        t.gross = addYen(t.gross, r.gross ?? yen(0));
        t.rent = addYen(t.rent, r.rent);
        t.expenses = addYen(t.expenses, r.expenses);
        t.repairs = addYen(t.repairs, r.repairs);
        t.depreciation = addYen(t.depreciation, r.depreciation ?? yen(0));
        t.interest = addYen(t.interest, r.interest ?? yen(0));
        t.income = addYen(t.income, r.income ?? yen(0));
        t.repayment = addYen(t.repayment, r.repayment);
        t.debtService = addYen(t.debtService, r.debtService);
        t.principal = addYen(t.principal, r.principal);
        t.cashBeforeTax = addYen(t.cashBeforeTax, r.cashBeforeTax);
        t.tax = addYen(t.tax, r.tax);
        t.cashAfterTax = addYen(t.cashAfterTax, r.cashAfterTax);
        t.loanBalance = addYen(t.loanBalance, r.loanBalance);
        t.value = addYen(t.value, r.value ?? yen(0));
        t.equity = addYen(t.equity, r.equity ?? yen(0));
        // 帳簿価額・含み益は、数字のある物件の分だけ足す（どの物件にも無ければ null）
        if (r.bookValue != null) t.bookValue = addYen(t.bookValue ?? yen(0), r.bookValue);
        if (r.unrealizedGain != null) t.unrealizedGain = addYen(t.unrealizedGain ?? yen(0), r.unrealizedGain);
        if (r.months > 0) {
          const noi = annualized(yen(r.rent - r.expenses), r.months);
          if (r.grossYield !== null && r.gross !== null && a.acquisition !== null) {
            e.gross += annualized(r.gross, r.months);
            e.grossDen += a.acquisition.total;
          }
          if (a.acquisition !== null) {
            e.noi += noi;
            e.noiDen += a.acquisition.total + a.acquisition.costs;
          }
          if (r.ccr !== null && a.acquisition?.equity !== undefined) {
            e.ccrNum += annualized(r.cashBeforeTax, r.months);
            e.ccrDen += a.acquisition.equity;
          }
          if (r.breakEven !== null && r.gross !== null) {
            e.beNum += annualized(yen(r.expenses + r.debtService), r.months);
            e.beDen += annualized(r.gross, r.months);
          }
        }
        if (hasLoan) e.loanProps = true;
        if (r.value !== null) e.ltvValue += r.value;
      }
    }
    const total: TotalRow[] = [...byYear.values()]
      .sort((a, b) => a.row.year - b.row.year)
      .map((e) => {
        const r = e.row;
        const ds = r.debtService;
        // 返済比率・返済余裕率は同じ月の額どうしの比なので年換算しない
        return {
          ...r,
          grossYield: ratio(e.gross, e.grossDen),
          netYield: ratio(e.noi, e.noiDen),
          breakEven: ratio(e.beNum, e.beDen),
          repaymentRatio: !e.loanProps ? null : ratio(ds, r.rent),
          dscr: !e.loanProps ? null : ratio(r.rent - r.expenses, ds),
          ltv: !e.loanProps ? null : ratio(r.loanBalance, e.ltvValue),
          ccr: ratio(e.ccrNum, e.ccrDen),
        };
      });
    return { properties, total };
  },
});

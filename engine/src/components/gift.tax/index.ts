// 贈与税（受け取る構成員×年。0008 の追記 2026-10-09 の決定4）。受け取る贈与は gift.received が集める。
// - 住宅取得等資金の非課税: 受け取る人がその年の1月1日に18歳以上・その年の合計所得金額が上限（2,000万円）以下のとき、住宅の種類ごとの
//   上限（省エネ等住宅・それ以外。期限と額は制度データ。期限の後は無い）まで、受け取る人ごとに1回分（前の年に使った分を引く）
// - 暦年課税: その年の贈与（非課税の後）の合計から基礎控除（110万円）を引き、1,000円未満を切り捨て、税率の表（直系尊属から18歳以上への
//   贈与は特例税率、それ以外は一般税率。両方あるときは、それぞれの税率で計算した額を贈与の額の割合で按分し、各部分の1円未満を切り捨てて
//   合計する。国税庁の計算明細の順。端数は制度データ giftTax.tax.allocation.rounding）を当て、100円未満を切り捨てる
// - 相続時精算課税（taxMethod: settlement。贈与者ごと）: その年の基礎控除（110万円。精算課税の贈与の額の割合で分ける）を引き、
//   特別控除（贈与者ごとに累計2,500万円）を引いた残り×20%（贈与者ごとに1,000円未満を切り捨て、税額の100円未満を切り捨て）。
//   贈与者の年齢（60歳以上）の要件は確かめない。精算課税は一度選ぶと撤回できないので、同じ贈与者（donors の ID・世帯の構成員）から
//   その後に受ける贈与は、暦年課税と書いてあっても精算課税で計算する（知らせ N_ASSUMED）
// - 贈与者: 世帯の外の贈与者（donors）を指す贈与は、その ID で合わせて数える（0008 の追記 2026-10-10 の決定1。住宅資金と教育資金などで
//   2,500万円の特別控除を別々に数えない）。贈与者を指さない世帯の外からの贈与は、これまでどおり援助の物ごとに別の贈与者とみなす
// - 世帯の外から受け取る贈与（住宅購入の資金援助・保険）の税は、翌年3月にキャッシュフロー表の cf.taxSi.giftTax に載せる。世帯から子に出す
//   贈与（子への援助）の税は子が払うので載せず、要約（summary.gifts）にだけ出す。相続のときの持ち戻し・相続税は作らない（知らせ）
import {
  ageMonth,
  bracketFor,
  defineComponent,
  formatYm,
  monthIndex,
  parseYm,
  yearOf,
  yen,
  type Bracket,
  type Flow,
  type GiftReceived,
  type GiftReceivedOutput,
  type GiftTaxOutput,
  type MonthCtx,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  basic: "giftTax.basicDeduction",
  general: "giftTax.rateTable.general",
  special: "giftTax.rateTable.special",
  adultAge: "giftTax.special.recipientMinAge",
  taxableRound: "giftTax.taxable.rounding",
  taxRound: "giftTax.tax.rounding",
  allocRound: "giftTax.tax.allocation.rounding",
  settleSpecial: "giftTax.settlement.specialDeduction",
  settleRate: "giftTax.settlement.rate",
  settleBasic: "giftTax.settlement.basicDeduction",
  housingSaving: "giftTax.housingFunds.exemption.energySaving",
  housingOther: "giftTax.housingFunds.exemption.other",
  housingIncome: "giftTax.housingFunds.incomeLimit",
};

/** 速算表（rate と控除額 amount）を当てた税額 */
function byTable(at: MonthCtx, table: readonly Bracket[] | null, taxable: Yen): Yen {
  if (table === null || taxable <= 0) return yen(0);
  const b = bracketFor(table, taxable);
  if (b.rate === undefined) return yen(0);
  const v = at.money.mulRate(taxable, b.rate, P.taxRound) - (b.amount ?? 0);
  return yen(v > 0 ? v : 0);
}

const giverKey = (g: GiftReceived) => g.donor ?? g.giverMember ?? `${g.giver}|${g.object}`;
const DIRECT: ReadonlySet<string> = new Set(["parent", "grandparent", "household"]);

export default defineComponent<{ member: string; year: number }, GiftTaxOutput>({
  id: "gift.tax",
  title: "贈与税（暦年課税・相続時精算課税・住宅取得等資金の非課税）",
  contract: "1.0",
  revision: 2,
  requires: { "gift.received": ">=1 <2", "tax.totalIncome": ">=1 <2" },
  params: Object.values(P),
  reads: [],
  input: "tax.memberYear.input",
  output: "gift.tax.output",
  compute(input, ctx) {
    const { member, year } = input;
    const empty: GiftTaxOutput = { flows: [], amount: yen(0), exempt: yen(0), calendarTaxable: yen(0), settlementTaxable: yen(0), tax: yen(0), settlementRemaining: [], inCashflow: false };
    const all = ctx.call<GiftReceivedOutput>("gift.received", { member }).gifts;
    if (!all.some((g) => yearOf(parseYm(g.ym)) === year)) return empty;
    // 贈与税の値の無いデータの組（古い版のパック・架空の見本）では計算せず、知らせる
    if (!ctx.at(monthIndex(year, 1)).has(P.basic)) {
      ctx.notice("N_PARAM_MISSING", [P.basic, member]);
      return empty;
    }
    const first = yearOf(parseYm((all[0] as GiftReceived).ym));
    let housingUsed = 0;
    const settleUsed = new Map<string, number>();
    // 精算課税を選んだ贈与者（撤回できない）
    const elected = new Set<string>();
    const methodOf = new Map<GiftReceived, "calendar" | "settlement">();
    for (const g of all) {
      const k = giverKey(g);
      if (g.method === "settlement") elected.add(k);
      else if (elected.has(k)) {
        methodOf.set(g, "settlement");
        if (yearOf(parseYm(g.ym)) <= year) ctx.notice("N_ASSUMED", ["giftTax.settlement.irrevocable", member]);
        continue;
      }
      methodOf.set(g, g.method);
    }
    let result: GiftTaxOutput = empty;
    for (let y = first; y <= year; y++) {
      const gifts = all.filter((g) => yearOf(parseYm(g.ym)) === y);
      if (gifts.length === 0) continue;
      const at = ctx.at(monthIndex(y, 1));
      // その年の1月1日に18歳以上か（18歳に達した月がその年より前。1月1日・2日生まれの区別は月の単位でしない近似）
      const adult = ageMonth(ctx, monthIndex(y, 1), P.adultAge, member) < monthIndex(y, 1);
      // 住宅取得等資金の非課税
      let exempt = 0;
      const after = new Map<GiftReceived, number>();
      let incomeOk: boolean | null = null;
      for (const g of gifts) {
        let rest: number = g.amount;
        if (g.housing !== null && adult) {
          const gm = ctx.at(parseYm(g.ym));
          const limit = gm.paramYen(g.housing === "energySaving" ? P.housingSaving : P.housingOther);
          if (limit !== null) {
            if (incomeOk === null) {
              const cap = gm.paramYen(P.housingIncome);
              incomeOk = cap === null || ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year: y }).total <= cap;
            }
            if (incomeOk) {
              const room = Math.max(0, limit - housingUsed);
              const use = Math.min(room, rest);
              housingUsed += use;
              exempt += use;
              rest -= use;
            }
          }
        }
        after.set(g, rest);
      }
      // 暦年課税
      const cal = gifts.filter((g) => methodOf.get(g) === "calendar");
      const calTotal = cal.reduce((s, g) => s + (after.get(g) ?? 0), 0);
      const basic = at.paramYen(P.basic) ?? yen(0);
      const calTaxable = at.money.round(yen(Math.max(0, calTotal - basic)), P.taxableRound);
      let calTax = yen(0);
      if (calTaxable > 0) {
        const sp = adult ? cal.filter((g) => DIRECT.has(g.giver)).reduce((s, g) => s + (after.get(g) ?? 0), 0) : 0;
        const gen = calTotal - sp;
        const tGen = byTable(at, at.paramBrackets(P.general), calTaxable);
        const tSp = byTable(at, at.paramBrackets(P.special), calTaxable);
        if (sp === 0) calTax = tGen;
        else if (gen === 0) calTax = tSp;
        // 両方あるとき: 按分した各部分の1円未満を切り捨てて合計し、その後に100円未満を切り捨てる（国税庁の計算明細の順）
        else calTax = yen(at.money.mulRatio(tGen, gen, calTotal, P.allocRound) + at.money.mulRatio(tSp, sp, calTotal, P.allocRound));
        calTax = at.money.round(calTax, P.taxRound);
      }
      // 相続時精算課税（贈与者ごと）
      const st = gifts.filter((g) => methodOf.get(g) === "settlement");
      const stTotal = st.reduce((s, g) => s + (after.get(g) ?? 0), 0);
      let stTaxable = 0;
      let stTax = 0;
      if (stTotal > 0) {
        const sBasic = at.paramYen(P.settleBasic) ?? yen(0);
        const special = at.paramYen(P.settleSpecial) ?? yen(0);
        const rate = at.paramRate(P.settleRate) ?? ctx.rate.of("0");
        const byGiver = new Map<string, number>();
        for (const g of st) byGiver.set(giverKey(g), (byGiver.get(giverKey(g)) ?? 0) + (after.get(g) ?? 0));
        const keys = [...byGiver.keys()].sort();
        const basics = ctx.money.allocate(yen(Math.min(sBasic, stTotal)), keys.map((k) => byGiver.get(k) as number), "conv.tax.allocate", "first");
        keys.forEach((k, i) => {
          const amt = Math.max(0, (byGiver.get(k) as number) - (basics[i] as number));
          const used = settleUsed.get(k) ?? 0;
          const use = Math.min(Math.max(0, special - used), amt);
          settleUsed.set(k, used + use);
          const taxable = at.money.round(yen(amt - use), P.taxableRound);
          stTaxable += taxable;
          stTax += at.money.mulRate(taxable, rate, P.taxRound);
        });
      }
      if (y !== year) continue;
      const total = gifts.reduce((s, g) => s + g.amount, 0);
      const tax = yen(calTax + stTax);
      const inflow = gifts.filter((g) => g.inflow).reduce((s, g) => s + g.amount, 0);
      const flows: Flow[] = [];
      if (tax > 0 && inflow > 0) {
        const share = inflow === total ? tax : ctx.money.mulRatio(tax, inflow, total, "conv.tax.allocate");
        const pay = monthIndex(year + 1, 3);
        flows.push({ row: "cf.taxSi.giftTax", ym: formatYm(pay), amount: share, accrualYear: year, member, formula: "gift.tax.payment" });
      }
      if (tax > 0 && inflow < total) ctx.notice("N_GIFT_TAX_BY_RECIPIENT", ["gift.tax", member, String(year)]);
      if (st.length > 0) ctx.notice("N_NOT_SUPPORTED", ["giftTax.settlement.inheritanceAddBack"]);
      result = {
        flows,
        amount: yen(total),
        exempt: yen(exempt),
        calendarTaxable: calTaxable,
        settlementTaxable: yen(stTaxable),
        tax,
        settlementRemaining: [...settleUsed.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([giver, used]) => ({ giver, remaining: yen(Math.max(0, (at.paramYen(P.settleSpecial) ?? 0) - used)) })),
        inCashflow: inflow > 0,
      };
    }
    return result;
  },
});

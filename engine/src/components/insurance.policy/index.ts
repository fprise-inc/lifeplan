// 保険契約1件（6.8・0008 の10）: 保険年度ごとの値（解約返戻金・死亡保障額）と、万一の想定・満期・解約で受け取るお金を、税の区分つきで出す。
// - 値は年次の数表（schedule。保険年度ごと・主契約と特約の行の合計）を優先し、無い値は保険の種類の型（template）から計算する:
//   終身（wholeLife）・学資（education）・個人年金（privateAnnuity）の解約返戻金は、払込保険料の累計×返戻率（simple.returnRate）×
//   min(1, 経過の月数÷払込の月数)（払込の後は払込の終わりの値のまま）。変額（variable）・外貨建（foreignCurrency）は、保険料のうち
//   積立に回る分（1−loadRate）を資産クラス（simple.assetClass。前提の利回り。為替も利回りに含めるとみなす）で伸ばした積立金。
//   定期・収入保障・医療・がんは解約返戻金なし。返戻率が無い貯蓄型は0とし、入力を求める（N_INPUT_REQUIRED）
// - 受け取り（支払月の翌月を受け取りの月とする）:
//   被保険者の死亡: 死亡保険金（death。変額は積立金と多い方）を受取人の割合で、収入保障（incomeProtection）は月額を保障の終わり
//   （最低保証の月数に満たなければそこ）まで毎月。障害1級: 高度障害（highDisability）。障害・就業不能: 就業不能（incapacity。
//   免責の月数の後、働けるようになる月の前まで、保障の終わりまで毎月）。満期金（maturity）は保障の終わりの翌月、祝金（survival）は
//   保障の始まり（省略は契約からn年）からn年ごと、年金（annuity）は始まりから毎年、解約（surrender）は解約の月にその時の解約返戻金
// - 税の区分（契約者・被保険者・受取人の関係）: 死亡保険金は 契約者＝被保険者 なら相続税の対象（みなし相続財産。額は計算せず知らせ
//   N_INHERITANCE_TAX）、契約者＝受取人 なら一時所得（収入保障の月額は雑所得）、それ以外は贈与税。満期金・祝金・解約返戻金は
//   受取人＝契約者 なら一時所得、それ以外は贈与税。年金は 受取人＝契約者 なら雑所得、それ以外は始まる月に権利の贈与と雑所得（改訂6）。
//   高度障害・就業不能の給付は非課税。一時所得の必要経費は、その時までの払込保険料のうち前の受け取りに使っていない分
// - 医療・がんの給付（改訂2。0054）: 被保険者の病気の想定（就業不能・障害の想定の illness）があれば、起きる月の翌月に1回だけ受け取る
//   （非課税）: 入院日額×min(入院の日数, 1回の限度日数〔maxDays。省略は60日〕)、手術×手術の回数、がん一時金（がんのとき）、
//   三大疾病一時金（がん・心疾患・脳卒中のとき）。2回目以降・通算の限度・先進医療などの細かい条件は計算しない。病気の想定が無ければ
//   受け取りは計算せず、知らせ N_NOT_SUPPORTED insurance.medicalBenefit
// - 保障の行ごとの被保険者（改訂2。0054）: 保障に insured があれば、その保障の給付（死亡・収入保障・就業不能・高度障害・医療）は
//   その人の万一の想定で受け取る。契約の被保険者でない人の死亡保険金は契約者（契約者が亡くなった人なら契約の被保険者）が受け取る。
//   年末の死亡保障額 deathBenefit は契約の被保険者の分だけで、ほかの人の分は others に人ごと
// - 数表の死亡保障の行（改訂2。0054）: 保障の ID（coverage）のある行はその保障の額だけを置き換える（逓減定期の減り方など）。ID の無い
//   行は前のとおり、その保険年度の契約全体（契約の被保険者の分）の死亡保障額
// - 変額・外貨建の円の目安の形（改訂2。simple.estimate。0054）: 積立金を前提の利回りで伸ばさず、死亡保険金は保障の明細の額、
//   解約返戻金は数表の行の額だけ（行が無ければ0）
// - 年ごとの値に、年末までの払込保険料の累計（paid。契約の月から）を添える（約束の版 1.1。0054）
// - 低解約返戻金型（改訂3。simple.returnRateDuring・returnRatePoints。0055 の追記 2026-11-03）: 払込中の率があれば、払込の終わりの前は
//   払込保険料の累計×払込中の率（まっすぐ伸ばさない）。払込の後は払込の終わりの率（returnRate）のまま。年齢ごとの率の点があれば、
//   払込の終わりの月（払込の終わりの率）と各点（被保険者がその年齢になる月）の間をまっすぐつなぎ、最後の点の後はその率のまま。
//   払込の終わりより前の年齢の点は使わない。運用の計算はしない（設計書の数字を写す）
// - アカウント型（改訂3。simple.account。0055 の追記 2026-11-03）: 積立金は契約の月の0円から払込の終わりの額（value）まで保険年度ごとに
//   まっすぐ増える（保険年度 n の終わりで value×12n÷払込の月数）。解約返戻金と、亡くなったときに死亡保険金に足す額はこの線から。
//   払込の後: 終身保険に移す（wholeLife）なら死亡保険金は deathBenefit（積立金は足さない）・解約返戻金は value のまま。年金で受け取る
//   （annuity）なら払込の終わりの月から毎年 annual を years 年（省略は10年。個人年金と同じ税: 受取人＝契約者 なら雑所得で、必要経費は
//   払込保険料×年金額÷年金の総額）、積立金は受け取った回数の分だけ value から減る（解約返戻金・亡くなったときの額）。解約して受け取る
//   （surrender）なら払込の終わりの月に value を解約で受け取る（insurance.term がその月で終わりにする。一時所得）。保障の部分の死亡保険金は
//   保障の明細のとおり（定期保険と同じ）。利率の変動は計算しない（設計書の数字を入れ直す）。払込の終わりが無ければ積立金は0とし、入力を求める
// - 改訂5・約束の版 1.2（0170）: 年ごとの値に、その年の最初の月（計算基準年は計算基準月）に亡くなったときの死亡保障額（start）を添える
//   （必要保障額の推移の「その年の1月に亡くなったら」。年末の額 deathBenefit は年の途中で終わる定期保険が0・収入保障の残りが11か月少ない）
// - 改訂6・約束の版 1.3（0179）: 年金の税を施行令のとおりにした。
//   ・必要経費＝年金の額×割合（保険料の総額÷支払総額。小数点以下2位まで、3位以下を切り上げ。施行令183条1項4号）。年金の年数が空なら保障の終わり
//     までの回数で支払総額を出し、終わりも無い終身年金は年額×受取人の支給開始日の余命年数（施行令の別表）を支払総額の見込額にする（前は必要経費0）
//   ・受取人が契約者でない年金（個人年金・アカウント型の年金・契約者でも亡くなった人でもない人が受け取る収入保障の月額）は、支払が始まる月に
//     年金を受け取る権利（定期金に関する権利）を1回贈与されたとみなし（相続税法6条3項・5条）、その評価額（相続税法24条: 1年当たりの平均額×
//     予定利率〔目安 preset.insurance.annuityAssumedRate〕の複利年金現価率。数表の解約返戻金があれば多い方）を受け取り annuityRight（贈与税。
//     お金の動きは無い）に出す。毎回の年金は雑所得で、総収入金額に入れるのは施行令185条2項の課税部分だけ（初年は0、2年目から階段状に増える）。
//     総収入金額に入れない部分と、課税部分の必要経費を cost に入れる（前は毎回の年金を1回ずつの贈与にしていた）
//   ・変額・外貨建の積立金（前の入れ方）に、計算基準年の2年前より前の払込保険料も足す（前は数えなかった）。払込保険料の累計（paid・必要経費の基）も、
//     その時より前の月の分を数える（前は0）
// - 改訂4（0137）: 預金の利回り（assumptions.depositReturn）を読む。預金・外貨預金の資産クラス（cash.deposit・cash.foreign）が前提の資産クラスごとの利回りに無いときの利回り（省略は運用利回りで、前の要求は今までどおり。0137）
import {
  addMonths,
  bracketFor,
  addYen,
  defineComponent,
  formatYm,
  monthIndex,
  parseYm,
  RATE_ZERO,
  spousesAt,
  childrenOf,
  yearOf,
  yen,
  type ContingencyEventOutput,
  type CoverageInput,
  type Flow,
  type InsuranceContractInput,
  type InsurancePolicyOutput,
  type InsurancePolicyYear,
  type InsuranceReceipt,
  type MemberInput,
  type MonthCtx,
  type MonthIndex,
  type PaymentsOutput,
  type RelationInput,
  type Yen,
} from "../../sdk/index.ts";

const SAVINGS: ReadonlySet<string> = new Set(["insurance.wholeLife", "insurance.education", "insurance.privateAnnuity"]);
const FUND: ReadonlySet<string> = new Set(["insurance.variable", "insurance.foreignCurrency"]);
const KNOWN: ReadonlySet<string> = new Set([
  "insurance.term",
  "insurance.incomeProtection",
  "insurance.wholeLife",
  "insurance.medical",
  "insurance.cancer",
  "insurance.education",
  "insurance.privateAnnuity",
  "insurance.foreignCurrency",
  "insurance.variable",
  "insurance.nonLife",
]);
const MEDICAL: ReadonlySet<string> = new Set(["hospitalDaily", "surgery", "cancerLump", "threeMajorLump"]);
/** 入院の1回の限度日数の既定の値ID（0054。sdk/estimates.ts の目安。ctx.estimate で引く） */
const DEFAULT_MAX_DAYS = "preset.insurance.hospitalMaxDays";
/** 年金の税の制度の値（0179） */
const P = {
  costRound: "incomeTax.privateAnnuity.costRatio.rounding",
  lifeYears: "incomeTax.privateAnnuity.lifeExpectancyYears",
  taxableShare: "incomeTax.inheritedAnnuity.taxableShare",
  specifiedShare: "incomeTax.inheritedAnnuity.specifiedPeriodShare",
  pvRound: "inheritanceTax.annuityRight.presentValueFactor.rounding",
};
/** 年金を受け取る権利の評価の予定利率の目安の値ID（0179。sdk/estimates.ts。ctx.estimate で引く） */
const ASSUMED_RATE = "preset.insurance.annuityAssumedRate";
/** 年金の必要経費・課税部分・権利の評価額の1円未満（法令に定めの無い端数） */
const CONV = "conv.insurance.annuity";
/** 割合の百分率の1未満の切り上げ（段の境目が整数の百分率の表を引く） */
const PCT_UP = "conv.insurance.percentUp";
/** 年金の1回 */
type Pay = { readonly m: MonthIndex; readonly amount: Yen };
const ROW: Readonly<Record<Exclude<InsuranceReceipt["kind"], "annuityRight">, string>> = {
  death: "cf.income.lumpSum.insurance",
  highDisability: "cf.income.lumpSum.insurance",
  incomeProtection: "cf.income.other.insuranceBenefit",
  incapacity: "cf.income.other.insuranceBenefit",
  maturity: "cf.income.lumpSum.maturity",
  survival: "cf.income.lumpSum.maturity",
  surrender: "cf.income.lumpSum.surrender",
  annuity: "cf.income.corporatePension.privateAnnuity",
  medical: "cf.income.lumpSum.insurance",
};

export default defineComponent<{ object: string }, InsurancePolicyOutput>({
  id: "insurance.policy",
  title: "保険契約（保険年度ごとの値と受け取り）",
  contract: "1.3",
  revision: 6,
  requires: { "insurance.term": ">=1 <2", "insurance.premiumPayment": ">=1 <2", "contingency.event": ">=1 <2" },
  params: Object.values(P),
  reads: [
    "insurance.template",
    "insurance.policyholder",
    "insurance.insured",
    "insurance.contractDate",
    "insurance.premium",
    "insurance.renewals",
    "insurance.beneficiaries",
    "insurance.annuitant",
    "insurance.coverages",
    "insurance.schedule",
    "insurance.simple",
    "member.kind",
    "member.birth",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
    "assumptions.investmentReturn",
    "assumptions.assetReturns",
    "assumptions.depositReturn",
  ],
  input: "object.input",
  output: "insurance.policy.output",
  compute(input, ctx) {
    const { base, end } = ctx.time;
    const c = ctx.get<InsuranceContractInput>("insurance", input.object);
    if (!KNOWN.has(c.template)) ctx.notice("N_NOT_SUPPORTED", ["insurance.template", c.template]);
    const start = parseYm(c.contractDate);
    const term = ctx.call<{ endsAt: string | null; cause: string | null; waiverFrom: string | null }>("insurance.term", { object: c.id });
    const endsAt = term.endsAt === null ? null : parseYm(term.endsAt);
    const active = (m: MonthIndex) => m >= start && (endsAt === null || m < endsAt);
    const pays = ctx
      .call<PaymentsOutput>("insurance.premiumPayment", {})
      .payments.filter((p) => p.object === c.id)
      .map((p) => ({ m: parseYm(p.ym), amount: p.amount }));
    // insurance.premiumPayment は計算基準年の2年前の1月からの支払いだけを出すので、それより前の払込（契約の月から）は、
    // 契約の保険料（更新・数表の年額を含む）から数える（解約返戻金・一時所得の必要経費の基の払込保険料の累計）
    const windowStart = monthIndex(yearOf(base) - 2, 1);
    // それより前の払込（月ごと。変額・外貨建の積立金も、これを保険年度ごとに足して伸ばす。0179）
    const priorPays: { m: MonthIndex; amount: number }[] = [];
    if (start < windowStart) {
      if (c.premium.frequency === "single") priorPays.push({ m: start, amount: c.premium.amount });
      else {
        const payEnd = c.premium.payUntil === null ? windowStart : Math.min(windowStart, ctx.time.resolve(c.premium.payUntil));
        const renewals = (c.renewals ?? []).map((r) => ({ m: ctx.time.resolve(r.at), premium: r.premium })).sort((a, b) => a.m - b.m);
        for (let m = start; m < payEnd; m = addMonths(m, 1)) {
          if (c.premium.frequency === "annual" && (m - start) % 12 !== 0) continue;
          const py = Math.floor((m - start) / 12) + 1;
          let annual: number | null = null;
          for (const r of c.schedule?.rows ?? []) if (r.policyYear === py && r.premium !== undefined) annual = (annual ?? 0) + r.premium;
          let a: number = c.premium.amount;
          for (const r of renewals) if (r.m <= m) a = r.premium;
          if (annual !== null) a = c.premium.frequency === "monthly" ? ctx.money.allocate(yen(annual), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.expense.share", "first")[(m - start) % 12] ?? 0 : annual;
          priorPays.push({ m, amount: a });
        }
      }
    }
    const prior = priorPays.reduce((s, p) => s + p.amount, 0);
    const paidUpTo = (m: MonthIndex): Yen => {
      let s = m >= windowStart ? prior : 0;
      if (m < windowStart) for (const p of priorPays) if (p.m <= m) s += p.amount;
      for (const p of pays) if (p.m <= m) s += p.amount;
      return yen(s);
    };
    const coverages = c.coverages ?? [];
    const covFrom = (x: CoverageInput) => (x.from === undefined ? start : ctx.time.resolve(x.from));
    const covTo = (x: CoverageInput) => (x.to === undefined || x.to === null ? null : ctx.time.resolve(x.to));
    const covActive = (x: CoverageInput, m: MonthIndex) => {
      const to = covTo(x);
      return m >= covFrom(x) && (to === null || m <= to);
    };
    // 数表の保険年度ごとの値（行の合計。無ければ null）。死亡保障は、保障の ID の無い行（契約全体）だけ（0054）
    const sched = (py: number, field: "deathBenefit" | "surrenderValue" | "annuity" | "survivalBenefit"): Yen | null => {
      let found = false;
      let s = 0;
      for (const r of c.schedule?.rows ?? []) {
        if (r.policyYear !== py || r[field] === undefined) continue;
        if (field === "deathBenefit" && r.coverage !== undefined) continue;
        found = true;
        s += r[field] as number;
      }
      return found ? yen(s) : null;
    };
    // 保障の ID のある数表の死亡保障の行（その保障の額を置き換える。0054）
    const schedCov = (py: number, id: string): Yen | null => {
      let found = false;
      let s = 0;
      for (const r of c.schedule?.rows ?? []) {
        if (r.policyYear !== py || r.coverage !== id || r.deathBenefit === undefined) continue;
        found = true;
        s += r.deathBenefit;
      }
      return found ? yen(s) : null;
    };
    const covInsured = (x: CoverageInput): string => x.insured ?? c.insured;
    // 変額・外貨建の積立金（保険年度の終わり）
    const fund = new Map<number, Yen>();
    const grows = FUND.has(c.template) && c.simple?.estimate !== true;
    if (grows) {
      const load = ctx.rate.of(c.simple?.loadRate ?? "0");
      let v = yen(0);
      for (let py = 1; addMonths(start, 12 * (py - 1)) <= end; py++) {
        const a = addMonths(start, 12 * (py - 1));
        const b = addMonths(start, 12 * py - 1);
        let prem = 0;
        for (const p of priorPays) if (p.m >= a && p.m <= b) prem += p.amount;
        for (const p of pays) if (p.m >= a && p.m <= b) prem += p.amount;
        const into = yen(prem - ctx.money.mulRate(yen(prem), load, "conv.investment.return"));
        const y = yearOf(b);
        const r = c.simple?.assetClass === undefined ? ctx.assumption("investmentReturn", y) : (ctx.assumptionIn("assetReturns", c.simple.assetClass, y, ctx.assumption("investmentReturn", y)) ?? RATE_ZERO);
        v = addYen(v, into);
        v = addYen(v, ctx.money.mulRate(v, r, "conv.investment.return"));
        fund.set(py, v);
      }
    }
    // 払込の月数（貯蓄型の解約返戻金の伸び）
    const payEndM = c.premium.payUntil === null ? null : ctx.time.resolve(c.premium.payUntil);
    const payMonths = payEndM === null ? null : payEndM - start;
    // アカウント型の積立金（m の月の終わりの時点。0055 の追記 2026-11-03）
    const account = c.simple?.account;
    const annuityYears = account?.years ?? 10;
    if (account !== undefined && (payMonths === null || payMonths <= 0)) ctx.notice("N_INPUT_REQUIRED", [c.id, "insurance.simple.account"]);
    const accountAt = (m: MonthIndex): Yen => {
      if (account === undefined || payEndM === null || payMonths === null || payMonths <= 0) return yen(0);
      const value = yen(account.value);
      if (m < payEndM) {
        const n = Math.max(0, Math.floor((m - start + 1) / 12));
        return ctx.money.mulRatio(value, Math.min(12 * n, payMonths), payMonths, "conv.investment.return");
      }
      if (account.after !== "annuity") return value;
      let made = 0;
      for (let k = 0; k < annuityYears; k++) if (addMonths(payEndM, 12 * k) <= m) made++;
      return ctx.money.mulRatio(value, annuityYears - made, annuityYears, "conv.investment.return");
    };
    // 低解約返戻金型の払込の後の年齢ごとの率の点（被保険者がその年齢になる月。払込の終わりの後の点だけ。月の順）
    const ratePoints = (c.simple?.returnRatePoints ?? [])
      .map((p) => ({ m: ctx.time.resolve({ memberAge: { member: c.insured, years: p.age, months: 0 } }), rate: p.rate }))
      .filter((p) => payEndM !== null && p.m > payEndM)
      .sort((a, b) => a.m - b.m);
    let noticedRate = false;
    const surrenderAt = (py: number): Yen => {
      if (py <= 0) return yen(0);
      const s = sched(py, "surrenderValue");
      if (s !== null) return s;
      if (account !== undefined) return accountAt(addMonths(start, 12 * py - 1));
      if (FUND.has(c.template)) return grows ? (fund.get(py) ?? yen(0)) : yen(0);
      if (!SAVINGS.has(c.template)) return yen(0);
      if (c.simple?.returnRate === undefined) {
        // 6.8 の形（保障の明細・数表・解約）で入れた契約だけ、返戻率を求める（保険料控除のためだけの契約には知らせない）
        if (!noticedRate && (c.coverages !== undefined || c.schedule !== undefined)) ctx.notice("N_INPUT_REQUIRED", [c.id, "insurance.simple.returnRate"]);
        noticedRate = true;
        return yen(0);
      }
      const yearEnd = addMonths(start, 12 * py - 1);
      const paid = paidUpTo(yearEnd);
      const times = (r: string): Yen => ctx.money.mulRate(paid, ctx.rate.of(r), "conv.investment.return");
      const during = c.simple.returnRateDuring;
      // 払込中: 払込中の率があればその率（低解約返戻金型）、無ければ払込の終わりの率に向かってまっすぐ伸ばす（終身払いは払込中の率のまま）
      if (payMonths === null || payMonths <= 0) return times(during ?? c.simple.returnRate);
      if (12 * py < payMonths) return during !== undefined ? times(during) : ctx.money.mulRatio(times(c.simple.returnRate), 12 * py, payMonths, "conv.investment.return");
      // 払込の後: 払込の終わりの率のまま。年齢ごとの率の点があれば、点の間をまっすぐつなぐ
      let m0 = payEndM as MonthIndex;
      let r0 = c.simple.returnRate;
      if (yearEnd <= m0) return times(r0);
      for (const p of ratePoints) {
        if (yearEnd < p.m) {
          const a = times(r0);
          return addYen(a, ctx.money.mulRatio(yen(times(p.rate) - a), yearEnd - m0, p.m - m0, "conv.investment.return"));
        }
        m0 = p.m;
        r0 = p.rate;
      }
      return times(r0);
    };
    const policyYear = (m: MonthIndex) => Math.floor((m - start) / 12) + 1;
    // 死亡保険金の一時金（who が被保険者の保障。契約の被保険者の分は、ID の無い数表の行があればそれ、変額は積立金と多い方）
    const lumpAt = (m: MonthIndex, who: string): number => {
      const py = policyYear(m);
      const own = who === c.insured;
      const s = own ? sched(py, "deathBenefit") : null;
      let total = 0;
      if (s !== null) total = s;
      else for (const x of coverages) if (x.benefit === "death" && covInsured(x) === who && covActive(x, m)) total += schedCov(py, x.id) ?? x.amount;
      if (own && grows) total = Math.max(total, fund.get(py) ?? 0);
      // アカウント型: 払込の後に終身保険に移したなら終身保険の死亡保険金、ほかはその時の積立金を足す
      if (own && account !== undefined) total += payEndM !== null && m >= payEndM && account.after === "wholeLife" ? (account.deathBenefit ?? 0) : accountAt(m);
      return total;
    };
    const deathAt = (m: MonthIndex, who: string = c.insured): Yen => {
      if (!active(m)) return yen(0);
      let total = lumpAt(m, who);
      // 収入保障の残り（月額×残りの月数。最低保証の月数まで）
      for (const x of coverages) {
        if (x.benefit !== "incomeProtection" || covInsured(x) !== who || !covActive(x, m)) continue;
        const to = covTo(x);
        const left = Math.max(to === null ? 0 : to - m, x.minimumMonths ?? 0);
        total += ctx.money.mulRatio(x.amount, left, 1, "conv.exact");
      }
      return yen(total);
    };

    // 受け取る人（受取人の割合）と税の区分
    const relations = ctx.list<RelationInput>("relation");
    const members = ctx.list<MemberInput>("member");
    const annuitant = c.annuitant ?? c.policyholder;
    // 死亡保険金の税の区分: 契約者が亡くなった人なら相続税の対象、受取人が契約者なら一時所得、ほかは贈与税
    const deathClass = (dead: string, to: string | null): InsuranceReceipt["taxClass"] =>
      c.policyholder === dead ? "inheritance" : to === c.policyholder ? "temporary" : "gift";
    const ownClass = (to: string): InsuranceReceipt["taxClass"] => (to === c.policyholder ? "temporary" : "gift");
    const receipts: InsuranceReceipt[] = [];
    let used = 0;
    const add = (m: MonthIndex, kind: InsuranceReceipt["kind"], amount: Yen, to: string | null, taxClass: InsuranceReceipt["taxClass"], coverage: string | null, cost?: Yen) => {
      if (amount <= 0) return;
      let k = cost ?? yen(0);
      if (cost === undefined && taxClass === "temporary") {
        const remaining = paidUpTo(m) - used;
        k = yen(remaining > 0 ? (remaining < amount ? remaining : amount) : 0);
        used += k;
      }
      receipts.push({
        ym: formatYm(m),
        object: c.id,
        coverage,
        member: to,
        kind,
        amount,
        taxClass,
        cost: k,
        ...(taxClass === "gift" ? { giver: c.policyholder } : {}),
      });
    };

    // ---- 年金の税（0179） ----
    const atOf = (m: MonthIndex): MonthCtx => ctx.at(m < base ? base : m);
    // 支給開始日の余命年数（施行令の別表。受取人の性別・満年齢）。表が無ければ null
    const lifeYearsOf = (who: string | null, from: MonthIndex): number | null => {
      if (who === null) return null;
      const mem = members.find((x) => x.id === who);
      if (mem === undefined) return null;
      const at = atOf(from);
      if (!at.has(P.lifeYears, { member: who })) return null;
      const table = at.paramBrackets(P.lifeYears, { member: who });
      if (table === null || table.length === 0) return null;
      const age = Math.max(0, Math.floor((from - parseYm(mem.birth.birthYearMonth)) / 12));
      const r = bracketFor(table, yen(age)).rate;
      if (r === undefined) return null;
      const f = ctx.rate.fraction(r);
      return Number(f.num / f.den);
    };
    // 必要経費の割合の百分率（保険料の総額÷支払総額。小数点以下2位まで、3位以下を切り上げ。施行令183条1項4号・185条1項11号）。
    // 端数の値が無いデータの組では null（割合をそのまま使う）
    const costPct = (paid: number, total: number, at: MonthCtx): number | null => (total > 0 && at.has(P.costRound) ? at.money.mulRatio(yen(100), paid, total, P.costRound) : null);
    const costOf = (amount: Yen, paid: number, total: number, pct: number | null): Yen =>
      total <= 0 ? yen(0) : pct === null ? ctx.money.mulRatio(paid as Yen, amount, total, "conv.exact") : ctx.money.mulRatio(amount, pct, 100, CONV);
    // 支払総額（確定年金は回の額の合計、終身年金は年額×余命年数）
    const totalOf = (list: readonly Pay[], perYear: number, life: number | null): number =>
      life === null ? list.reduce((t, p) => t + p.amount, 0) : ctx.money.mulRatio((list[0]?.amount ?? 0) as Yen, perYear * life, 1, "conv.exact");
    // 残存期間年数（1年未満は切り上げ）。終身年金は余命年数
    const yearsOf = (list: readonly Pay[], perYear: number, life: number | null): number => life ?? Math.ceil(list.length / perYear);
    // 年金を受け取る権利（定期金に関する権利）の評価額（相続税法24条1項1号・3号）: 1年当たりの平均額×予定利率の複利年金現価率
    // （小数点以下3位未満を四捨五入。相続税法施行規則12条の5）と、数表の解約返戻金の多い方
    const rightValue = (list: readonly Pay[], perYear: number, life: number | null, at: MonthCtx, surrender: Yen | null): Yen => {
      const n = yearsOf(list, perYear, life);
      const total = totalOf(list, perYear, life);
      if (n <= 0 || total <= 0) return surrender ?? yen(0);
      const avg = ctx.money.divInt(yen(total), n, CONV);
      const r = ctx.rate.of(String(ctx.estimate(ASSUMED_RATE)));
      let v: Yen;
      if (ctx.rate.compare(r, RATE_ZERO) <= 0 || !at.has(P.pvRound)) v = ctx.money.mulRatio(avg, n, 1, "conv.exact");
      else {
        const one = ctx.rate.of("1");
        const factor = ctx.rate.div(ctx.rate.sub(one, ctx.rate.div(one, ctx.rate.pow(ctx.rate.add(one, r), n))), r);
        const f = ctx.rate.fraction(factor);
        const permille = at.money.mulRatio(yen(1000), Number(f.num), Number(f.den), P.pvRound);
        v = ctx.money.mulRatio(avg, permille, 1000, CONV);
      }
      return surrender !== null && surrender > v ? surrender : v;
    };
    // 相続等（贈与を含む）で取得した年金の各回の cost（総収入金額に入れない部分＋課税部分の必要経費。施行令185条2項・1項8号）。
    // 相続税評価割合（評価額÷支払総額）が百分の五十を超えれば 一課税単位×経過年数、以下なら 一単位×経過年数（特定期間の後は 一単位×特定期間年数−1円）。
    // 年金の回の額にかかる月数（12÷1年の回数）で月割りし、年金の額以上なら、単位の整数倍のうち年金の額に満たない最も多い額（同6号）
    const inheritedCosts = (list: readonly Pay[], perYear: number, life: number | null, value: Yen, paid: number, ratioTotal: number, at: MonthCtx): Yen[] => {
      const n = yearsOf(list, perYear, life);
      const total = totalOf(list, perYear, life);
      if (total <= 0 || n <= 0 || !at.has(P.taxableShare) || !at.has(P.specifiedShare)) return list.map((p) => p.amount);
      const first = list[0]?.m ?? (0 as MonthIndex);
      const share = at.money.mulRatio(yen(100), value, total, PCT_UP);
      const months = 12 / perYear;
      let unitOf: (k: number) => Yen;
      let unit: Yen;
      if (share > 50) {
        const t = bracketFor(at.paramBrackets(P.taxableShare) ?? [], yen(share)).rate ?? RATE_ZERO;
        const units = (n * (n - 1)) / 2;
        unit = units > 0 ? ctx.money.divInt(ctx.money.mulRate(yen(total), t, CONV), units, CONV) : yen(0);
        unitOf = (k) => ctx.money.mulRatio(unit, life !== null && k > life ? life - 1 : k, 1, "conv.exact");
      } else {
        const q = ctx.rate.fraction(bracketFor(at.paramBrackets(P.specifiedShare) ?? [], yen(share)).rate ?? ctx.rate.of("1"));
        const sy = Number((BigInt(n) * q.num + q.den - 1n) / q.den) - 1;
        unit = sy > 0 ? ctx.money.divInt(yen(total), sy * n, CONV) : yen(0);
        unitOf = (k) => (sy <= 0 ? yen(0) : k <= sy ? ctx.money.mulRatio(unit, k, 1, "conv.exact") : yen(Math.max(0, ctx.money.mulRatio(unit, sy, 1, "conv.exact") - 1)));
      }
      const pct = costPct(paid, ratioTotal, at);
      return list.map((p) => {
        const k = Math.floor((p.m - first) / 12);
        let part = ctx.money.mulRatio(unitOf(k), months, 12, CONV);
        if (part >= p.amount) {
          const step = ctx.money.mulRatio(unit, months, 12, CONV);
          part = step <= 0 ? yen(0) : ctx.money.mulRatio(step, ctx.money.mulRatio(yen(1), p.amount, step, PCT_UP) - 1, 1, "conv.exact");
        }
        return yen(p.amount - part + costOf(part, paid, ratioTotal, pct));
      });
    };
    // 年金を出す（own: 受取人が契約者なら雑所得で施行令183条、ほかは権利の贈与と施行令185条2項）。list は全部の回（計算の範囲の外も）、
    // emit は受け取りに出す回（解約・計算の範囲で切った回）
    const annuityReceipts = (
      kind: "annuity" | "incomeProtection",
      list: readonly Pay[],
      emit: (p: Pay) => boolean,
      perYear: number,
      life: number | null,
      to: string | null,
      own: boolean,
      paid: number,
      ratioTotal: number,
      coverage: string | null,
      surrender: Yen | null,
    ) => {
      const first = list[0];
      if (first === undefined) return;
      const at = atOf(first.m);
      let costs: Yen[];
      if (own) {
        const pct = costPct(paid, ratioTotal, at);
        costs = list.map((p) => costOf(p.amount, paid, ratioTotal, pct));
      } else {
        const value = rightValue(list, perYear, life, at, surrender);
        if (first.m <= end) add(first.m, "annuityRight", value, to, "gift", coverage, yen(0));
        costs = inheritedCosts(list, perYear, life, value, paid, ratioTotal, at);
      }
      list.forEach((p, i) => {
        if (emit(p)) add(p.m, kind, p.amount, to, "miscellaneous", coverage, costs[i] ?? yen(0));
      });
    };
    // 保障の被保険者ごと（契約の被保険者と、保障の行の被保険者。0054）の万一の想定
    const people = [...new Set([c.insured, ...coverages.map(covInsured)])];
    const deathMonth = new Map<string, MonthIndex>();
    for (const P of people) {
      const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: P }).event;
      if (ev === null) continue;
      const D = parseYm(ev.month);
      if (ev.kind === "death") {
        deathMonth.set(P, D);
        if (!active(D)) continue;
        // 受取人: 契約の被保険者の死亡は受取人の割合（無ければ死亡の当時の配偶者、いなければ子）。ほかの人（家族特約）の死亡は契約者
        // （契約者が亡くなった人なら契約の被保険者）
        const heirs =
          P !== c.insured
            ? [{ member: c.policyholder !== P ? c.policyholder : c.insured, share: "1" }]
            : c.beneficiaries !== undefined && c.beneficiaries.length > 0
              ? c.beneficiaries.map((b) => ({ member: b.member ?? null, share: b.share }))
              : [{ member: spousesAt(ctx, relations, c.insured, D)[0] ?? childrenOf(members, relations, c.insured)[0]?.id ?? null, share: "1" }];
        const weights = heirs.map((h) => ctx.rate.fraction(ctx.rate.of(h.share)));
        const split = (amount: Yen) =>
          ctx.money.allocate(
            amount,
            weights.map((w) => Number((w.num * 1000000n) / w.den)),
            "conv.flow.allocate",
            "first",
          );
        const lump = lumpAt(D, P);
        const pay = addMonths(D, 1);
        split(yen(lump)).forEach((a, i) => add(pay, "death", a, heirs[i]?.member ?? null, deathClass(P, heirs[i]?.member ?? null), null));
        // 収入保障: 月額を保障の終わり（最低保証の月数まで）まで毎月
        for (const x of coverages) {
          if (x.benefit !== "incomeProtection" || covInsured(x) !== P || !covActive(x, D)) continue;
          const to = covTo(x);
          const last = Math.max(to === null ? D : to, D + (x.minimumMonths ?? 0));
          const totalPaid = paidUpTo(D);
          // 受取人ごとの全部の回（計算の範囲の外も）。契約者が受け取るなら雑所得（施行令183条）、契約者でも亡くなった人でもない人なら
          // 年金を受け取る権利の贈与と施行令185条2項（0179）。亡くなった人が契約者なら相続税の対象（毎月の年金の雑所得は計算しない）
          const byHeir: Pay[][] = heirs.map(() => []);
          for (let m = pay; m <= last; m = addMonths(m, 1)) split(x.amount).forEach((a, i) => byHeir[i]?.push({ m, amount: a }));
          const all = byHeir.reduce((t, l) => t + l.reduce((u, p) => u + p.amount, 0), 0);
          byHeir.forEach((list, i) => {
            const who = heirs[i]?.member ?? null;
            const cls0 = deathClass(P, who);
            if (cls0 === "inheritance") {
              for (const p of list) if (p.m <= end) add(p.m, "incomeProtection", p.amount, who, "inheritance", x.id);
              return;
            }
            annuityReceipts("incomeProtection", list, (p) => p.m <= end, 12, null, who, cls0 === "temporary", totalPaid, all, x.id, null);
          });
        }
        if (lump > 0 && c.policyholder === P) ctx.notice("N_INHERITANCE_TAX", ["insurance.deathBenefit", c.id]);
        continue;
      }
      const recovery = ev.recovery === undefined ? null : parseYm(ev.recovery);
      const illness = ev.illness;
      let medicalNotice = false;
      for (const x of coverages) {
        if (covInsured(x) !== P) continue;
        if (x.benefit === "incapacity" && covActive(x, D)) {
          const to = covTo(x);
          for (let m = addMonths(D, (x.waitingMonths ?? 0) + 1); m <= end && (to === null || m <= to) && (recovery === null || m < recovery); m = addMonths(m, 1)) {
            add(m, "incapacity", x.amount, P, "none", x.id);
          }
        }
        if (x.benefit === "highDisability" && ev.kind === "disability" && ev.grade === 1 && ev.recognition !== undefined) {
          const rc = parseYm(ev.recognition);
          if (covActive(x, rc) && active(rc) && (recovery === null || recovery > rc)) add(addMonths(rc, 1), "highDisability", x.amount, P, "none", x.id);
        }
        if (!MEDICAL.has(x.benefit)) continue;
        if (illness === undefined) {
          medicalNotice = true;
          continue;
        }
        // 医療・がんの給付（0054）: 起きる月に保障があれば、その翌月に1回だけ（非課税）
        if (!active(D) || !covActive(x, D)) continue;
        let amount: Yen = yen(0);
        if (x.benefit === "hospitalDaily") amount = ctx.money.mulRatio(x.amount, Math.min(illness.hospitalDays ?? 0, x.maxDays ?? Number(ctx.estimate(DEFAULT_MAX_DAYS))), 1, "conv.exact");
        else if (x.benefit === "surgery") amount = ctx.money.mulRatio(x.amount, illness.surgeries ?? 0, 1, "conv.exact");
        else if (x.benefit === "cancerLump") amount = illness.disease === "cancer" ? x.amount : yen(0);
        else if (x.benefit === "threeMajorLump") amount = illness.disease === "cancer" || illness.disease === "heartStroke" ? x.amount : yen(0);
        add(addMonths(D, 1), "medical", amount, P, "none", x.id);
      }
      if (medicalNotice) ctx.notice("N_NOT_SUPPORTED", ["insurance.medicalBenefit", c.id]);
    }
    // 満期金・祝金・年金
    for (const x of coverages) {
      const to = covTo(x);
      if (x.benefit === "maturity" && to !== null) {
        const pay = addMonths(to, 1);
        if (endsAt === null || endsAt >= pay || term.cause === "maturity") add(pay, "maturity", x.amount, annuitant, ownClass(annuitant), x.id);
      }
      if (x.benefit === "survival" && x.everyYears !== undefined) {
        // 最初は保障の始まり（from。省略は契約から n 年）、その後 n 年ごと
        const first = x.from === undefined ? addMonths(start, 12 * x.everyYears) : covFrom(x);
        for (let k = 0; ; k++) {
          const m = addMonths(first, 12 * x.everyYears * k);
          if (m > end || (to !== null && m > addMonths(to, 1)) || !active(m)) break;
          add(m, "survival", sched(policyYear(m) - 1, "survivalBenefit") ?? x.amount, annuitant, ownClass(annuitant), x.id);
        }
      }
      if (x.benefit === "annuity") {
        const from = covFrom(x);
        const years = x.years ?? null;
        // 回（年数があればその回数、無ければ保障の終わりまで〔画面の「入れなければ保障の終わりまで」〕、終わりも無ければ終身で計算の範囲まで）
        const life = years === null && to === null ? lifeYearsOf(annuitant, from) : null;
        const list: Pay[] = [];
        for (let k = 0; years === null || k < years; k++) {
          const m = addMonths(from, 12 * k);
          if ((to !== null && m > to) || (years === null && to === null && m > end)) break;
          list.push({ m, amount: sched(policyYear(m), "annuity") ?? x.amount });
        }
        // 終身で余命年数の表が無ければ、支払総額が分からないので必要経費は0（前と同じ）
        const lifeless = years === null && to === null && life === null;
        const live = (p: Pay) => p.m <= end && !(endsAt !== null && p.m >= endsAt && term.cause !== "maturity");
        if (lifeless) {
          for (const p of list) if (live(p)) add(p.m, "annuity", p.amount, annuitant, annuitant === c.policyholder ? "miscellaneous" : "gift", x.id, yen(0));
        } else {
          const ratioTotal = totalOf(list, 1, life);
          annuityReceipts("annuity", list, live, 1, life, annuitant, annuitant === c.policyholder, paidUpTo(from), ratioTotal, x.id, sched(policyYear(from), "surrenderValue"));
        }
      }
    }
    // アカウント型の年金（払込の終わりの月から毎年。個人年金と同じ税）
    if (account?.after === "annuity" && payEndM !== null && payMonths !== null && payMonths > 0) {
      const annual = yen(account.annual ?? 0);
      const list: Pay[] = [];
      for (let k = 0; k < annuityYears; k++) list.push({ m: addMonths(payEndM, 12 * k), amount: annual });
      const ratioTotal = totalOf(list, 1, null);
      annuityReceipts("annuity", list, (p) => p.m <= end && !(endsAt !== null && p.m >= endsAt), 1, null, annuitant, annuitant === c.policyholder, paidUpTo(payEndM), ratioTotal, null, null);
    }
    // 解約（アカウント型の払込の後は、その時の積立金。払込の終わりの月は value）
    const surrenderValueAt = (m: MonthIndex): Yen => {
      if (account !== undefined && payEndM !== null && m >= payEndM) return m === payEndM ? yen(account.value) : accountAt(addMonths(m, -1));
      return surrenderAt(Math.floor((m - start) / 12));
    };
    if (term.cause === "surrender" && endsAt !== null && endsAt >= start) add(endsAt, "surrender", surrenderValueAt(endsAt), c.policyholder, "temporary", null);
    receipts.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));

    const flows: Flow[] = [];
    for (const r of receipts) {
      const m = parseYm(r.ym);
      // 年金を受け取る権利の贈与（annuityRight）はお金の動きが無い（贈与税だけ。0179）
      if (r.member === null || m < base || m > end || r.kind === "annuityRight") continue;
      flows.push({ row: ROW[r.kind], ym: r.ym, amount: r.amount, accrualYear: yearOf(m), member: r.member, object: c.id, formula: `insurance.policy.${r.kind}` });
    }
    const years: InsurancePolicyYear[] = [];
    for (let y = yearOf(base); y <= yearOf(end); y++) {
      const dec = monthIndex(y, 12);
      let premium = 0;
      for (const p of pays) if (yearOf(p.m) === y) premium += p.amount;
      const live = active(dec);
      const others: { member: string; deathBenefit: Yen }[] = [];
      if (live) {
        for (const P of people) {
          if (P === c.insured) continue;
          const dm = deathMonth.get(P);
          if (dm !== undefined && dm <= dec) continue;
          const v = deathAt(dec, P);
          if (v > 0) others.push({ member: P, deathBenefit: v });
        }
      }
      // その年の最初の月（計算基準年は計算基準月）に亡くなったときの死亡保障額（必要保障額の推移の「その年の1月に亡くなったら」。改訂5・約束の版 1.2。0170）
      const first = (y === yearOf(base) ? base : monthIndex(y, 1)) as MonthIndex;
      const firstOthers: { member: string; deathBenefit: Yen }[] = [];
      if (active(first)) {
        for (const P of people) {
          if (P === c.insured) continue;
          const dm = deathMonth.get(P);
          if (dm !== undefined && dm < first) continue;
          const v = deathAt(first, P);
          if (v > 0) firstOthers.push({ member: P, deathBenefit: v });
        }
      }
      years.push({
        year: y,
        premium: yen(premium),
        deathBenefit: live ? deathAt(dec) : yen(0),
        start: { month: formatYm(first), deathBenefit: active(first) ? deathAt(first) : yen(0), ...(firstOthers.length > 0 ? { others: firstOthers } : {}) },
        surrenderValue: live ? surrenderAt(Math.floor((dec - start + 1) / 12)) : yen(0),
        paid: paidUpTo(dec),
        ...(others.length > 0 ? { others } : {}),
      });
    }
    return { flows, receipts, years, endsAt: term.endsAt };
  },
});

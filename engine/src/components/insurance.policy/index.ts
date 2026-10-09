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
//   受取人＝契約者 なら一時所得、それ以外は贈与税。年金は 受取人＝契約者 なら雑所得（必要経費は払込保険料×年金額÷年金の総額）、それ以外は贈与税。
//   高度障害・就業不能の給付は非課税。一時所得の必要経費は、その時までの払込保険料のうち前の受け取りに使っていない分
// - 医療・がんの給付（入院日額・手術・がん一時金）は保障内容一覧に載せるだけで、受け取りは計算しない
import {
  addMonths,
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
  type InsuranceReceipt,
  type MemberInput,
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
const MEDICAL: ReadonlySet<string> = new Set(["hospitalDaily", "surgery", "cancerLump"]);
const ROW: Readonly<Record<InsuranceReceipt["kind"], string>> = {
  death: "cf.income.lumpSum.insurance",
  highDisability: "cf.income.lumpSum.insurance",
  incomeProtection: "cf.income.other.insuranceBenefit",
  incapacity: "cf.income.other.insuranceBenefit",
  maturity: "cf.income.lumpSum.maturity",
  survival: "cf.income.lumpSum.maturity",
  surrender: "cf.income.lumpSum.surrender",
  annuity: "cf.income.corporatePension.privateAnnuity",
};

export default defineComponent<{ object: string }, InsurancePolicyOutput>({
  id: "insurance.policy",
  title: "保険契約（保険年度ごとの値と受け取り）",
  contract: "1.0",
  revision: 1,
  requires: { "insurance.term": ">=1 <2", "insurance.premiumPayment": ">=1 <2", "contingency.event": ">=1 <2" },
  params: [],
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
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
    "assumptions.investmentReturn",
    "assumptions.assetReturns",
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
    let prior = 0;
    if (start < windowStart) {
      if (c.premium.frequency === "single") prior = c.premium.amount;
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
          prior += a;
        }
      }
    }
    const paidUpTo = (m: MonthIndex): Yen => {
      let s = m >= windowStart ? prior : 0;
      if (m < windowStart) return yen(0);
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
    // 数表の保険年度ごとの値（行の合計。無ければ null）
    const sched = (py: number, field: "deathBenefit" | "surrenderValue" | "annuity" | "survivalBenefit"): Yen | null => {
      let found = false;
      let s = 0;
      for (const r of c.schedule?.rows ?? []) {
        if (r.policyYear !== py || r[field] === undefined) continue;
        found = true;
        s += r[field] as number;
      }
      return found ? yen(s) : null;
    };
    // 変額・外貨建の積立金（保険年度の終わり）
    const fund = new Map<number, Yen>();
    if (FUND.has(c.template)) {
      const load = ctx.rate.of(c.simple?.loadRate ?? "0");
      let v = yen(0);
      for (let py = 1; addMonths(start, 12 * (py - 1)) <= end; py++) {
        const a = addMonths(start, 12 * (py - 1));
        const b = addMonths(start, 12 * py - 1);
        let prem = 0;
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
    const payMonths = c.premium.payUntil === null ? null : ctx.time.resolve(c.premium.payUntil) - start;
    let noticedRate = false;
    const surrenderAt = (py: number): Yen => {
      if (py <= 0) return yen(0);
      const s = sched(py, "surrenderValue");
      if (s !== null) return s;
      if (FUND.has(c.template)) return fund.get(py) ?? yen(0);
      if (!SAVINGS.has(c.template)) return yen(0);
      if (c.simple?.returnRate === undefined) {
        // 6.8 の形（保障の明細・数表・解約）で入れた契約だけ、返戻率を求める（保険料控除のためだけの契約には知らせない）
        if (!noticedRate && (c.coverages !== undefined || c.schedule !== undefined)) ctx.notice("N_INPUT_REQUIRED", [c.id, "insurance.simple.returnRate"]);
        noticedRate = true;
        return yen(0);
      }
      const paid = paidUpTo(addMonths(start, 12 * py - 1));
      const v = ctx.money.mulRate(paid, ctx.rate.of(c.simple.returnRate), "conv.investment.return");
      if (payMonths === null || payMonths <= 0 || 12 * py >= payMonths) return v;
      return ctx.money.mulRatio(v, 12 * py, payMonths, "conv.investment.return");
    };
    const policyYear = (m: MonthIndex) => Math.floor((m - start) / 12) + 1;
    const deathAt = (m: MonthIndex): Yen => {
      if (!active(m)) return yen(0);
      const py = policyYear(m);
      const s = sched(py, "deathBenefit");
      let total = 0;
      if (s !== null) total = s;
      else for (const x of coverages) if (x.benefit === "death" && covActive(x, m)) total += x.amount;
      if (FUND.has(c.template)) total = Math.max(total, fund.get(py) ?? 0);
      // 収入保障の残り（月額×残りの月数。最低保証の月数まで）
      for (const x of coverages) {
        if (x.benefit !== "incomeProtection" || !covActive(x, m)) continue;
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
    const deathClass = (to: string | null): InsuranceReceipt["taxClass"] =>
      c.policyholder === c.insured ? "inheritance" : to === c.policyholder ? "temporary" : "gift";
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
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: c.insured }).event;
    if (ev !== null && ev.kind === "death") {
      const D = parseYm(ev.month);
      if (active(D)) {
        // 受取人（無ければ死亡の当時の配偶者、いなければ子）
        const heirs =
          c.beneficiaries !== undefined && c.beneficiaries.length > 0
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
        const py = policyYear(D);
        const s = sched(py, "deathBenefit");
        let lump = 0;
        if (s !== null) lump = s;
        else for (const x of coverages) if (x.benefit === "death" && covActive(x, D)) lump += x.amount;
        if (FUND.has(c.template)) lump = Math.max(lump, fund.get(py) ?? 0);
        const pay = addMonths(D, 1);
        split(yen(lump)).forEach((a, i) => add(pay, "death", a, heirs[i]?.member ?? null, deathClass(heirs[i]?.member ?? null), null));
        // 収入保障: 月額を保障の終わり（最低保証の月数まで）まで毎月
        for (const x of coverages) {
          if (x.benefit !== "incomeProtection" || !covActive(x, D)) continue;
          const to = covTo(x);
          const last = Math.max(to === null ? D : to, D + (x.minimumMonths ?? 0));
          const n = last - D;
          const totalPaid = paidUpTo(D);
          for (let m = pay; m <= last && m <= end; m = addMonths(m, 1)) {
            split(x.amount).forEach((a, i) => {
              const who = heirs[i]?.member ?? null;
              const cls0 = deathClass(who);
              const cls = cls0 === "temporary" ? "miscellaneous" : cls0;
              add(m, "incomeProtection", a, who, cls, x.id, cls === "miscellaneous" && n > 0 ? ctx.money.mulRatio(totalPaid, 1, n * heirs.length, "conv.exact") : yen(0));
            });
          }
        }
        if (lump > 0 && c.policyholder === c.insured) ctx.notice("N_INHERITANCE_TAX", ["insurance.deathBenefit", c.id]);
      }
    } else if (ev !== null) {
      const D = parseYm(ev.month);
      const recovery = ev.recovery === undefined ? null : parseYm(ev.recovery);
      for (const x of coverages) {
        if (x.benefit === "incapacity" && covActive(x, D)) {
          const to = covTo(x);
          for (let m = addMonths(D, (x.waitingMonths ?? 0) + 1); m <= end && (to === null || m <= to) && (recovery === null || m < recovery); m = addMonths(m, 1)) {
            add(m, "incapacity", x.amount, c.insured, "none", x.id);
          }
        }
        if (x.benefit === "highDisability" && ev.kind === "disability" && ev.grade === 1 && ev.recognition !== undefined) {
          const rc = parseYm(ev.recognition);
          if (covActive(x, rc) && active(rc) && (recovery === null || recovery > rc)) add(addMonths(rc, 1), "highDisability", x.amount, c.insured, "none", x.id);
        }
        if (MEDICAL.has(x.benefit)) ctx.notice("N_NOT_SUPPORTED", ["insurance.medicalBenefit", c.id]);
      }
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
        const expected = years === null ? null : ctx.money.mulRatio(x.amount, years, 1, "conv.exact");
        const totalPaid = paidUpTo(from);
        for (let k = 0; years === null || k < years; k++) {
          const m = addMonths(from, 12 * k);
          if (m > end || (to !== null && m > to)) break;
          if (endsAt !== null && m >= endsAt && term.cause !== "maturity") break;
          const amount = sched(policyYear(m), "annuity") ?? x.amount;
          const cls = annuitant === c.policyholder ? "miscellaneous" : "gift";
          const cost = cls === "miscellaneous" && expected !== null && expected > 0 ? ctx.money.mulRatio(totalPaid, amount, expected, "conv.exact") : yen(0);
          add(m, "annuity", amount, annuitant, cls, x.id, cost);
        }
      }
    }
    // 解約
    if (term.cause === "surrender" && endsAt !== null && endsAt >= start) add(endsAt, "surrender", surrenderAt(Math.floor((endsAt - start) / 12)), c.policyholder, "temporary", null);
    receipts.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));

    const flows: Flow[] = [];
    for (const r of receipts) {
      const m = parseYm(r.ym);
      if (r.member === null || m < base || m > end) continue;
      flows.push({ row: ROW[r.kind], ym: r.ym, amount: r.amount, accrualYear: yearOf(m), member: r.member, object: c.id, formula: `insurance.policy.${r.kind}` });
    }
    const years: InsurancePolicyOutput["years"][number][] = [];
    for (let y = yearOf(base); y <= yearOf(end); y++) {
      const dec = monthIndex(y, 12);
      let premium = 0;
      for (const p of pays) if (yearOf(p.m) === y) premium += p.amount;
      const live = active(dec);
      years.push({ year: y, premium: yen(premium), deathBenefit: live ? deathAt(dec) : yen(0), surrenderValue: live ? surrenderAt(Math.floor((dec - start + 1) / 12)) : yen(0) });
    }
    return { flows, receipts, years, endsAt: term.endsAt };
  },
});

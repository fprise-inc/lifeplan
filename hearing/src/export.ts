// 世帯データ → シートの回答の一覧（書き出し）。importAnswers の逆向き。
// - 確定の値（confirmed）は値、わからない（unknown）は「わからない」、該当なし（notApplicable）は「該当なし」として書く
// - 推定（estimated）の値・仮の値は書かない（空欄にして、顧客に記入してもらう）
// - シートに載らない物（繰り返しの上限を超えた分・シートに無い種類）は知らせる
// 書き出した回答を取り込み、もう一度書き出すと同じ回答になる（往復。test/roundtrip.test.ts）
import { HEARING_FORMAT, HEARING_FORMAT_VERSION, type Answer, type FilledSheet, type Management } from "./answers.ts";
import { itemByKey, type SheetDefinition } from "./definition.ts";
import { DEATH_TEMPLATES, DERIVED_TERM } from "./import.ts";
import { paymentFromBalance } from "./loan.ts";
import { landOfShare } from "./ownedHome.ts";
import { issue, type Issue } from "./issues.ts";
import { addMonths, ageAt, resolveAt, ymIndex } from "./months.ts";
import type { Account, EducationStage, EmploymentPeriod, EngineRequest, Household, Member, Residence, ValueBox } from "./types.ts";
import { formatValue } from "./values.ts";

export interface ExportResult {
  readonly answers: readonly Answer[];
  readonly issues: readonly Issue[];
}

type Val = { status: "value"; value: number | string } | { status: "unknown" | "notApplicable" | "blank" };
const BLANK: Val = { status: "blank" };
const v = (value: number | string): Val => ({ status: "value", value });

function boxVal(b: ValueBox<number> | undefined): Val {
  if (b === undefined) return BLANK;
  if (b.state === "confirmed" && b.value !== undefined) return v(b.value);
  if (b.state === "unknown") return { status: "unknown" };
  if (b.state === "notApplicable") return { status: "notApplicable" };
  return BLANK;
}

/**
 * 持ち家の評価を買った値段で入れたか（入力の画面の ownedValueMode と同じ読み方。0176 の3）: 入れ方を書いてあればそれ、無ければ評価額の時点が
 * 計算基準月より前なら買った値段（時点が今か空なら今の時価）
 */
function valuedByPurchase(val: NonNullable<Residence["valuation"]>, base: string): boolean {
  if (val.basis !== undefined) return val.basis === "purchase";
  return val.asOf !== undefined && ymIndex(val.asOf) < ymIndex(base);
}

/** その月に効いている期間か */
function activeAt(from: string | null, to: string | null, ym: string): boolean {
  return (from === null || ymIndex(from) <= ymIndex(ym)) && (to === null || ymIndex(to) >= ymIndex(ym));
}

export interface ExportOptions {
  /** 値の箱を持たない欄に入れた仮の値（入力の画面の WorkingHousehold.assumed）。ここに載った欄は書き出さない（推定は書かない） */
  readonly assumed?: Readonly<Record<string, string>>;
}

/** 世帯データからシートの回答を作る（記入の年月は計算基準月） */
export function exportAnswers(def: SheetDefinition, request: EngineRequest, options: ExportOptions = {}): ExportResult {
  const assumed = options.assumed ?? {};
  const known = (uiKey: string) => assumed[uiKey] === undefined;
  const h = request.input.household;
  const base = request.input.baseMonth;
  const items = itemByKey(def);
  const out = new Map<string, Val>();
  const issues: Issue[] = [];
  const put = (key: string, index: number | undefined, val: Val) => {
    if (!items.has(key)) throw new Error(`シート定義に無い項目: ${key}`);
    out.set(index === undefined ? key : `${key}#${index}`, val);
  };
  const axisCount = (id: string) => def.axes.find((a) => a.id === id)?.count ?? 0;

  put("hs.meta.filledOn", undefined, v(base));

  // 家族
  const self = h.members.find((m) => m.kind === "self");
  const spouse = h.members.find((m) => m.kind === "spouse");
  const adults: (Member | undefined)[] = [self, spouse];
  adults.forEach((m, i) => {
    const n = i + 1;
    if (m === undefined) {
      if (n === 2) put("hs.family.adult.birthYearMonth", n, { status: "notApplicable" });
      return;
    }
    if (known(`family/${m.id}/birth`)) put("hs.family.adult.birthYearMonth", n, v(m.birth.birthYearMonth));
    if (known(`family/${m.id}/sex`)) put("hs.family.adult.sex", n, v(m.sex));
  });
  if (spouse !== undefined) {
    const rel = h.relations.find((r) => r.type === "spouse");
    if (rel !== undefined && rel.type === "spouse") put("hs.family.spouse.marriage", undefined, v(rel.marriage));
  } else put("hs.family.spouse.marriage", undefined, { status: "notApplicable" });
  const children = h.members.filter((m) => m.kind === "child").sort((a, b) => ymIndex(a.birth.birthYearMonth) - ymIndex(b.birth.birthYearMonth));
  const shownChildren = children.slice(0, axisCount("child"));
  if (children.length > shownChildren.length) issues.push(issue("warning", "H_EXPORT_OVERFLOW", `お子さまが${children.length}人います。シートには${shownChildren.length}人まで載ります`));
  shownChildren.forEach((m, i) => {
    put("hs.family.child.birthYearMonth", i + 1, v(m.birth.birthYearMonth));
    if (known(`family/${m.id}/sex`)) put("hs.family.child.sex", i + 1, v(m.sex));
  });
  // ご両親（ご本人の父・母、配偶者の方の父・母。詳細版の版3から）: ご健在か・年齢・同居か・仕送り・援助・介護が始まっているか
  const parentsAsked = items.has("hs.family.parent.alive");
  const slots: (Member | undefined)[] = [];
  if (parentsAsked) {
    const parentsOf = (side: Member | undefined, sex: "male" | "female") => (side === undefined ? undefined : h.members.find((m) => m.kind === "parent" && m.sex === sex && (m.outside?.of ?? self?.id) === side.id && !slots.includes(m)));
    for (const [side, sex] of [[self, "male"], [self, "female"], [spouse, "male"], [spouse, "female"]] as const) slots.push(parentsOf(side, sex));
    slots.slice(0, axisCount("parent")).forEach((m, i) => {
      if (m === undefined) return;
      const n = i + 1;
      const gone = m.leaves !== null && known(`family/${m.id}/leaves`) && ymIndex(resolveAt(m.leaves, h) ?? base) <= ymIndex(base);
      put("hs.family.parent.alive", n, v(gone ? "deceased" : "alive"));
      if (gone) return;
      // 年齢は、生年月が分かっているか、前のシートの年齢から置いた仮の生年月なら書く（子の生年の30年前などの仮の値は書かない）
      const birthNote = assumed[`family/${m.id}/birth`];
      if (birthNote === undefined || birthNote.includes("歳として")) put("hs.family.parent.age", n, v(ageAt(m, base)));
      if (m.support !== undefined) put("hs.family.parent.cohabiting", n, v(m.support.cohabiting ? "together" : "apart"));
      const monthlyOf = (rows: readonly { counterparty?: string; monthly?: boolean; amount: ValueBox<number>; to: unknown }[]) => rows.find((r) => r.counterparty === m.id && r.monthly === true);
      const allowance = monthlyOf((h.periodicExpenses ?? []).filter((r) => r.kind === "allowance"));
      if (allowance !== undefined && items.has("hs.family.parent.allowance")) put("hs.family.parent.allowance", n, boxVal(allowance.amount));
      const support = monthlyOf((h.incomeFlows ?? []).filter((r) => r.kind === "support"));
      if (support !== undefined && items.has("hs.family.parent.support")) put("hs.family.parent.support", n, boxVal(support.amount));
      const care = (h.careExpenses ?? []).find((x) => x.member === m.id && ymIndex(resolveAt(x.from, h) ?? base) < ymIndex(base));
      if (items.has("hs.family.parent.care")) {
        if (care !== undefined) {
          put("hs.family.parent.care", n, v(care.place));
          if (care.otherMonthly !== undefined) put("hs.family.parent.careMonthly", n, boxVal(care.otherMonthly));
        } else put("hs.family.parent.care", n, v("none"));
      }
    });
    // 受け取る予定の相続・贈与（今の世帯の相続・遺贈の行の最初の1件）
    const inh = (h.incomeFlows ?? []).find((f) => f.kind === "inheritance");
    if (items.has("hs.inherit.expected") && inh !== undefined) {
      put("hs.inherit.expected", undefined, v("yes"));
      const at = resolveAt(inh.from, h);
      if (at !== null && known(`in/${inh.id}/from`)) put("hs.inherit.year", undefined, v(Number(at.slice(0, 4))));
      put("hs.inherit.amount", undefined, boxVal(inh.amount));
    }
  }
  const others = h.members.filter((m) => m.kind !== "self" && m.kind !== "spouse" && m.kind !== "child" && !slots.includes(m));
  if (others.length > 0) issues.push(issue("info", "H_EXPORT_OVERFLOW", parentsAsked ? "ご両親のほかの、祖父母などのご家族は、この版のシートに載りません" : "親・祖父母などのご家族は、この版のシートに載りません"));

  // 働き方と収入
  const periods = new Map<string, EmploymentPeriod>();
  adults.forEach((m, i) => {
    const n = i + 1;
    if (m === undefined) {
      if (n === 2) put("hs.work.type", n, { status: "notApplicable" });
      return;
    }
    const ps = h.employmentPeriods.filter((p) => p.member === m.id);
    const p = ps.find((x) => activeAt(resolveAt(x.from, h), resolveAt(x.to, h), base));
    if (p === undefined || p.type === "unemployed") {
      put("hs.work.type", n, v("unemployed"));
      return;
    }
    periods.set(m.id, p);
    put("hs.work.type", n, v(p.type));
    const k = `work/period/${p.id}`;
    const from = resolveAt(p.from, h);
    if (from !== null && known(`${k}/from`)) put("hs.work.since", n, v(from));
    if (p.employer !== undefined) {
      if (known(`${k}/size`)) put("hs.work.employerSize", n, v(p.employer.size));
      if (known(`${k}/hours`)) put("hs.work.weeklyHours", n, v(p.employer.weeklyHours));
    }
    if (p.healthInsurance !== undefined) {
      const kind = p.healthInsurance.kind;
      if (["kyokaikenpo", "union", "mutualAid", "national", "dependent"].includes(kind) && known(`${k}/hi`)) put("hs.work.healthInsurance", n, v(kind));
      if (kind === "kyokaikenpo" && p.healthInsurance.insurer !== undefined && known(`${k}/branch`)) put("hs.work.prefecture", n, v(p.healthInsurance.insurer));
    }
    if (p.salary !== undefined) {
      const a = boxVal(p.salary.annual);
      const b = boxVal(p.salary.bonus);
      if (a.status === "value" && b.status === "value") {
        put("hs.income.salary", n, v((a.value as number) + (b.value as number)));
        put("hs.income.bonus", n, b);
      } else if (a.status === "value" && b.status === "notApplicable") {
        put("hs.income.salary", n, a);
        put("hs.income.bonus", n, b);
      } else {
        put("hs.income.salary", n, a.status === "value" ? BLANK : a);
        put("hs.income.bonus", n, b);
      }
    }
    if (p.business !== undefined) put("hs.income.business", n, boxVal(p.business.income));
    // 確定申告の仕方（自営業の方。入れてある人だけ。0155）
    const tr = m.taxReturn;
    if (p.type === "selfEmployed" && tr !== undefined && items.has("hs.income.taxReturn"))
      put("hs.income.taxReturn", n, v(tr.method === "white" ? "white" : tr.blueDeduction === "electronic" ? "blueElectronic" : tr.blueDeduction === "doubleEntry" ? "blueDoubleEntry" : "blueSimple"));
    const to = resolveAt(p.to, h);
    if (to !== null) put("hs.work.retireAge", n, v(ageAt(m, addMonths(to, 1))));
    const rb = (h.retirementBenefits ?? []).find((b) => b.member === m.id && b.kind === "lumpSum");
    if (rb !== undefined) put("hs.retirement.lumpSum", n, boxVal(rb.amount));
  });
  adults.forEach((m, i) => {
    if (m === undefined) return;
    const fy = residentTaxYearOf(base);
    const a = (h.residentTaxAssessments ?? []).find((x) => x.member === m.id && x.fiscalYear === fy);
    if (a !== undefined) put("hs.income.residentTax", i + 1, boxVal(a.amount));
  });

  // 公的年金
  adults.forEach((m, i) => {
    const n = i + 1;
    if (m === undefined) return;
    const r = (h.pensionRecords ?? []).find((x) => x.member === m.id && (x.kind === "statementUnder50" || x.kind === "statementOver50" || x.kind === "receiving"));
    // 額の無い記録は、取り込むと記録にならない（働き方からの推計になる）ので書かない
    if (r === undefined || (boxVal(r.amounts?.basic).status !== "value" && boxVal(r.amounts?.employee).status !== "value")) return;
    put("hs.pension.notice.type", n, v(r.kind));
    if (known(`pension/${r.id}/asOf`)) put("hs.pension.notice.asOf", n, v(r.asOf));
    if (r.months !== undefined && r.kind !== "receiving") {
      put("hs.pension.months.total", n, v(r.months.basic));
      if (known(`pension/${r.id}/months`)) put("hs.pension.months.employee", n, v(r.months.employee));
    }
    put("hs.pension.amount.basic", n, boxVal(r.amounts?.basic));
    put("hs.pension.amount.employee", n, boxVal(r.amounts?.employee));
  });

  // 住まい
  const res = (h.residences ?? []).find((r) => {
    const from = resolveAt(r.from, h);
    return from !== null && activeAt(from, resolveAt(r.to, h), base);
  });
  if (res !== undefined) {
    put("hs.housing.type", undefined, v(res.kind));
    const from = resolveAt(res.from, h);
    if (from !== null && known(`housing/res/${res.id}/from`)) put("hs.housing.since", undefined, v(from));
    if (res.kind === "rent") {
      put("hs.housing.rent", undefined, boxVal(res.rent?.monthly));
      for (const k of ["hs.housing.purchaseMonth", "hs.housing.purchasePrice", "hs.housing.purchaseLand"]) if (items.has(k)) put(k, undefined, { status: "notApplicable" });
    } else {
      put("hs.housing.rent", undefined, { status: "notApplicable" });
      put("hs.housing.propertyTax", undefined, boxVal(res.propertyTax?.annual));
      put("hs.housing.maintenance", undefined, boxVal(res.maintenance?.monthly));
      // 家を買った年月・値段（詳細の版5 から。0176 の追記 2026-11-09）: 買った年月は住み始め。買った値段で入れた家だけ、値段とうち土地の値段を書く
      // （今の時価で入れた評価額は買った値段ではないので書かない。土地の値段は FP が入れた割合のときだけ。推定の値は書かない）
      if (items.has("hs.housing.purchaseMonth") && from !== null && known(`housing/res/${res.id}/from`)) put("hs.housing.purchaseMonth", undefined, v(from));
      const val = res.valuation;
      if (items.has("hs.housing.purchasePrice") && val?.value !== undefined && valuedByPurchase(val, base)) {
        const price = boxVal(val.value);
        put("hs.housing.purchasePrice", undefined, price);
        const share = val.landShare;
        const rows = (res as { valueStates?: Record<string, { state?: string; origin?: { kind?: string } }> }).valueStates ?? {};
        const landRow = rows["residence.valuation/landShare"];
        const landEstimated = landRow?.state === "estimated" && landRow.origin?.kind === "auto";
        if (items.has("hs.housing.purchaseLand") && price.status === "value" && share !== undefined && !landEstimated) put("hs.housing.purchaseLand", undefined, v(landOfShare(price.value as number, share)));
      }
    }
  }
  const loans = (h.debts ?? []).filter((d) => {
    const st = resolveAt(d.start, h);
    return d.kind === "mortgage" && st !== null && ymIndex(st) <= ymIndex(base);
  });
  const shownLoans = loans.slice(0, axisCount("loan"));
  if (loans.length > shownLoans.length) issues.push(issue("warning", "H_EXPORT_OVERFLOW", `住宅ローンが${loans.length}件あります。シートには${shownLoans.length}件まで載ります`));
  if (loans.length === 0 && res !== undefined) put("hs.loan.debtor", 1, { status: "notApplicable" });
  shownLoans.forEach((d, i) => {
    const n = i + 1;
    const debtor = d.debtors.find((x) => x.role === "primary") ?? d.debtors[0];
    const who = adults.findIndex((m) => m !== undefined && m.id === debtor?.member);
    if (who < 0) return;
    put("hs.loan.debtor", n, v(`adult.${who + 1}`));
    put("hs.loan.principal", n, v(d.principal));
    const start = resolveAt(d.start, h) as string;
    put("hs.loan.start", n, v(start));
    put("hs.loan.termYears", n, v(Math.round(d.repayment.termMonths / 12)));
    const step = [...d.rateSchedule].filter((s) => {
      const f = resolveAt(s.from, h);
      return f !== null && ymIndex(f) <= ymIndex(base);
    }).pop() ?? d.rateSchedule[0];
    if (step !== undefined) {
      put("hs.loan.rate", n, v(step.rate));
      if (known(`housing/debt/${d.id}/rateType`)) put("hs.loan.rateType", n, v(step.type));
    }
    if (known(`housing/debt/${d.id}/method`)) put("hs.loan.method", n, v(d.repayment.method));
    if (d.balance !== undefined) put("hs.loan.balance", n, boxVal(d.balance));
    put("hs.loan.creditLife", n, v(d.creditLife !== undefined && d.creditLife.covered.includes(debtor?.member ?? "") ? "covered" : "none"));
  });

  // 教育
  shownChildren.forEach((m, i) => {
    const n = i + 1;
    const g = (h.goals ?? []).find((x) => x.kind === "education" && x.owner === m.id);
    if (g?.education === undefined) return;
    // シートに載る段階が1つも無い目標（保育園だけなど）は書かない（取り込むと目標にならないため）
    const covered = ["elementary", "juniorHigh", "highSchool", "university", "juniorCollege", "vocational"];
    if (!g.education.stages.some((x) => covered.includes(x.stage))) return;
    const st = (s: string) => g.education?.stages.find((x) => x.stage === s);
    for (const [key, stage] of [
      ["hs.education.elementary", "elementary"],
      ["hs.education.juniorHigh", "juniorHigh"],
      ["hs.education.highSchool", "highSchool"],
    ] as const) {
      const s = st(stage);
      put(key, n, s === undefined ? { status: "notApplicable" } : v(s.sector === "private" ? "private" : "public"));
    }
    const after = g.education.stages.find((x) => x.stage === "university" || x.stage === "juniorCollege" || x.stage === "vocational");
    if (after === undefined) put("hs.education.after", n, { status: "notApplicable" });
    else {
      put("hs.education.after", n, v(afterCode(after)));
      put("hs.education.living", n, after.living === undefined ? BLANK : v(after.living));
    }
  });

  // 貯蓄・投資
  adults.forEach((m, i) => {
    const n = i + 1;
    if (m === undefined) return;
    const of = (kind: string) => h.accounts.filter((a) => a.owner === m.id && a.kind === kind);
    for (const [key, kind, monthlyKey] of [
      ["hs.assets.deposit", "deposit", null],
      ["hs.assets.taxable", "taxable", null],
      ["hs.assets.nisa", "nisa", "hs.assets.nisaMonthly"],
      ["hs.assets.ideco", "ideco", "hs.assets.idecoMonthly"],
      ["hs.assets.corporateDc", "corporateDc", null],
    ] as const) {
      const list = of(kind);
      if (list.length === 0) continue;
      put(key, n, sumBoxes(list.map((a) => a.marketValue)));
      if (monthlyKey !== null) {
        const monthly = activeContribution(list, h, base);
        if (monthly > 0) put(monthlyKey, n, v(monthly));
      }
    }
  });

  // 会社役員の方の会社とのお金（自社株の出資額・会社への貸付金・会社からの借入金・連帯保証の額。0105）。この項目の無い版のシートには書かない
  adults.forEach((m, i) => {
    const n = i + 1;
    if (m === undefined || !items.has("hs.company.shares")) return;
    for (const [key, subtype] of [
      ["hs.company.shares", "ownCompanyShares"],
      ["hs.company.loanToCompany", "loanToCompany"],
    ] as const) {
      const list = h.accounts.filter((a) => a.owner === m.id && a.kind === "otherAsset" && a.subtype === subtype);
      if (list.length > 0) put(key, n, sumBoxes(list.map((a) => a.marketValue)));
    }
    const loans = (h.debts ?? []).filter((d) => d.subtype === "companyLoan" && d.debtors.some((x) => x.member === m.id && x.role === "primary"));
    if (loans.length > 0) {
      put("hs.company.loanFromCompany", n, sumBoxes(loans.map((d) => d.balance)));
      // 毎月の返済額は、残高・返済期間・利率から求める（切り上げ。取り込み直すと同じ期間に戻る）。返済期間が仮の値（返済額が無いので5年とみなした）のローンは書かない
      const one = loans.length === 1 ? loans[0] : undefined;
      const term = one === undefined ? undefined : assumed[`housing/debt/${one.id}/term`];
      if (one !== undefined && (term === undefined || term.startsWith(DERIVED_TERM)) && one.balance?.state === "confirmed" && one.balance.value !== undefined) {
        const pay = paymentFromBalance(one.balance.value, Number(one.rateSchedule[0]?.rate ?? "0"), one.repayment.termMonths);
        if (pay !== null) put("hs.company.loanFromCompanyMonthly", n, v(pay));
      }
    }
    if (m.companyGuarantee !== undefined) put("hs.company.guarantee", n, boxVal(m.companyGuarantee));
  });

  // 保険
  const contracts = h.insuranceContracts.filter((c) => def.items.find((x) => x.key === "hs.insurance.type")?.choices?.some((ch) => ch.value === c.template));
  const shownContracts = contracts.slice(0, axisCount("policy"));
  if (h.insuranceContracts.length > shownContracts.length) issues.push(issue("warning", "H_EXPORT_OVERFLOW", `保険が${h.insuranceContracts.length}件あります。シートには${shownContracts.length}件まで載ります`));
  const personCode = (id: string): string | null => {
    const a = adults.findIndex((m) => m?.id === id);
    if (a >= 0) return `adult.${a + 1}`;
    const c = shownChildren.findIndex((m) => m.id === id);
    return c >= 0 ? `child.${c + 1}` : null;
  };
  shownContracts.forEach((c, i) => {
    const n = i + 1;
    const k = `ins/${c.id}`;
    put("hs.insurance.type", n, v(c.template));
    const holder = personCode(c.policyholder);
    if (holder !== null && holder.startsWith("adult.") && known(`${k}/holder`)) put("hs.insurance.policyholder", n, v(holder));
    const insured = personCode(c.insured);
    if (insured !== null && known(`${k}/insured`)) put("hs.insurance.insured", n, v(insured));
    if (known(`${k}/date`)) put("hs.insurance.contractDate", n, v(c.contractDate));
    put("hs.insurance.premium", n, v(c.premium.amount));
    if (known(`${k}/freq`)) put("hs.insurance.frequency", n, v(c.premium.frequency));
    const pu = c.premium.payUntil;
    if (c.premium.frequency !== "single" && known(`${k}/payUntil`)) {
      if (pu === null) put("hs.insurance.payUntilAge", n, { status: "notApplicable" });
      else if ("memberAge" in pu && pu.memberAge.member === c.insured && (pu.memberAge.months ?? 0) === 0) put("hs.insurance.payUntilAge", n, v(pu.memberAge.years));
      else {
        const at = resolveAt(pu, h);
        const ins = h.members.find((m) => m.id === c.insured);
        if (at !== null && ins !== undefined) put("hs.insurance.payUntilAge", n, v(ageAt(ins, addMonths(at, 1))));
      }
    }
    const death = c.coverages?.find((x) => x.role === "main" && x.benefit === "death");
    if (death !== undefined && DEATH_TEMPLATES.has(c.template)) put("hs.insurance.deathBenefit", n, v(death.amount));
    const ip = c.coverages?.find((x) => x.role === "main" && x.benefit === "incomeProtection");
    if (ip !== undefined && c.template === "insurance.incomeProtection") put("hs.insurance.monthlyBenefit", n, v(ip.amount));
  });

  // 生活費と貯蓄
  const living = (h.livingExpenses ?? []).find((l) => l.from === undefined || activeAt(resolveAt(l.from, h), resolveAt(l.to ?? null, h), base));
  if (living !== undefined) {
    if (living.mode === "total") put("hs.expense.living", undefined, boxVal(living.monthly));
    else put("hs.expense.living", undefined, sumBoxes((living.categories ?? []).map((x) => x.monthly)));
  }
  const sc = (h.savingsChecks ?? [])[0];
  if (sc !== undefined) put("hs.expense.savings", undefined, boxVal(sc.actualSavings));

  // 定義の順に並べる（空欄も含める: 書き出すセルの一覧として使う）
  const answers: Answer[] = [];
  for (const it of def.items) {
    if (it.retiredIn !== null) continue;
    const axis = def.sections.flatMap((s) => s.groups).find((g) => g.items.includes(it.key))?.axis;
    const count = axis === undefined ? 1 : axisCount(axis);
    for (let n = 1; n <= count; n++) {
      const index = axis === undefined ? undefined : n;
      const val = out.get(index === undefined ? it.key : `${it.key}#${index}`) ?? BLANK;
      const idx = index !== undefined ? { index } : {};
      if (val.status === "value") {
        const f = formatValue(it, val.value);
        answers.push({ key: it.key, ...idx, status: "value", raw: f.raw, ...(f.raw2 !== undefined ? { raw2: f.raw2 } : {}) });
      } else answers.push({ key: it.key, ...idx, status: val.status });
    }
  }
  return { answers, issues };
}

function residentTaxYearOf(baseMonth: string): number {
  const [y, m] = baseMonth.split("-").map(Number) as [number, number];
  return m >= 6 ? y : y - 1;
}

function afterCode(s: EducationStage): string {
  if (s.stage === "juniorCollege") return "juniorCollege";
  if (s.stage === "vocational") return "vocational";
  if (s.sector === "national") return "national";
  if (s.sector === "public") return "public";
  return s.field === "science" || s.field === "medical" ? "privateScience" : "privateHumanities";
}

function sumBoxes(list: (ValueBox<number> | undefined)[]): Val {
  let sum = 0;
  for (const b of list) {
    const x = boxVal(b);
    if (x.status === "unknown") return x;
    if (x.status !== "value") return BLANK;
    sum += x.value as number;
  }
  return v(sum);
}

function activeContribution(list: Account[], h: Household, base: string): number {
  let sum = 0;
  const next = addMonths(base, 1);
  for (const a of list) {
    for (const c of a.contributions) {
      const from = resolveAt(c.from, h);
      const to = resolveAt(c.to, h);
      if (activeAt(from, to, base) || activeAt(from, to, next)) sum += c.monthly;
    }
  }
  return sum;
}

/** 管理の値を作る（依頼番号・指紋はアプリが渡す） */
export function management(def: SheetDefinition, o: { requestId: string; customerNo: string; layoutDigest: string; appVersion: string; exportedOn: string }): Management {
  return { format: HEARING_FORMAT, formatVersion: HEARING_FORMAT_VERSION, sheetId: def.sheetId, sheetVersion: def.version, ...o };
}

/** 空欄のシート（新しいお客さま） */
export function blankAnswers(def: SheetDefinition): Answer[] {
  const out: Answer[] = [];
  for (const it of def.items) {
    if (it.retiredIn !== null) continue;
    const axis = def.sections.flatMap((s) => s.groups).find((g) => g.items.includes(it.key))?.axis;
    const count = axis === undefined ? 1 : (def.axes.find((a) => a.id === axis)?.count ?? 1);
    for (let n = 1; n <= count; n++) out.push({ key: it.key, ...(axis === undefined ? {} : { index: n }), status: "blank" });
  }
  return out;
}

export type { FilledSheet };

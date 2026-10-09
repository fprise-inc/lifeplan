// iDeCo・企業型DC の掛金（構成員ごと）。月ごとに拠出限度額で止める（0008 の9。2026年12月分からの改正は制度データの行で切り替わる）。
// - iDeCo に加入できる月: 国民年金の第1号・第2号・第3号の月（pension.category）。加入できる年齢の上限（ideco.enrollment.untilAge）の前の月まで。
//   上限が70歳の月（2026年12月から）は、60歳以上で国民年金の被保険者でなく、老齢基礎年金を受けておらず、その前に iDeCo の掛金を出していた人も
//   加入できる（第5号）。受け取りを始めた月からは出さない
// - 拠出限度額（月額）: 第1号・第3号・第5号はその値。第2号は勤め先の企業年金で分ける（企業年金なし・企業型DCだけ・他制度あり（公務員を含む））。
//   企業型DCの事業主掛金（2024年12月分からは他制度掛金相当額も）と合わせた上限を超える分も出さない。最低額（月5,000円）に届かなければ出さない
// - 企業型DC: 事業主掛金と加入者掛金（マッチング拠出）の合計を拠出限度額（2024年12月分からは他制度掛金相当額を引く）で止め、加入者掛金を先に減らす。
//   2026年11月分までは加入者掛金を事業主掛金の額以下にする
// 掛金は器の間の移動（cf.transfer.ideco の明細）。事業主掛金は世帯の支払いではない（.employer）。所得控除（小規模企業共済等掛金控除）は
// 本人が払った分（iDeCo と加入者掛金）を tax.deductions が読む
import {
  addMonths,
  ageMonth,
  defineComponent,
  formatYm,
  monthIndex,
  parseYm,
  yearOf,
  yen,
  type AccountInput,
  type CategoryOutput,
  type EmploymentPeriodInput,
  type Flow,
  type IdecoContributionOutput,
  type IdecoPayment,
  type MonthIndex,
  type PensionOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  c1: "ideco.contributionLimit.category1",
  noPlan: "ideco.contributionLimit.category2.noPlan",
  withDc: "ideco.contributionLimit.category2.withDc",
  withDb: "ideco.contributionLimit.category2.withDb",
  combined: "ideco.contributionLimit.category2.combined",
  combinedDb: "ideco.contributionLimit.category2.combinedWithDb",
  c3: "ideco.contributionLimit.category3",
  c5: "ideco.contributionLimit.category5",
  minimum: "ideco.contribution.minimum",
  until: "ideco.enrollment.untilAge",
  earliest: "ideco.payout.earliestAge",
  dc: "corporateDc.contributionLimit",
  dcDb: "corporateDc.contributionLimit.withDb",
  matchingCap: "corporateDc.matching.capToEmployer",
};
/** 他制度掛金相当額を上限の計算に数えはじめる月（2024年12月分） */
const OTHER_PLAN_FROM = monthIndex(2024, 12);

const min = (a: Yen, b: Yen): Yen => (a < b ? a : b);
const pos = (a: number): Yen => yen(a > 0 ? a : 0);

export default defineComponent<{ member: string }, IdecoContributionOutput>({
  id: "ideco.contribution",
  title: "iDeCo・企業型DCの掛金",
  contract: "1.0",
  revision: 1,
  requires: { "account.dcList": ">=1 <2", "pension.category": ">=1 <2", "pension.oldAge": ">=1 <2" },
  params: Object.values(P),
  reads: [
    "account.kind",
    "account.owner",
    "account.contributions",
    "account.payout",
    "employment.member",
    "employment.from",
    "employment.to",
    "employment.type",
    "employment.corporatePension",
  ],
  memberScope: ["account", "employment"],
  input: "member.input",
  output: "ideco.contribution.output",
  compute(input, ctx) {
    const member = input.member;
    const { base, end } = ctx.time;
    const calcStart = monthIndex(yearOf(base) - 2, 1);
    // iDeCo・企業型DC の器だけを読む（ほかの器の積立を変えても計算し直さない）
    const accounts = ctx.call<{ ids: string[] }>("account.dcList", { member }).ids.map((id) => ctx.get<AccountInput>("account", id));
    if (accounts.length === 0 || accounts.every((a) => a.contributions.length === 0)) return { flows: [], payments: [] };

    // 月ごとの予定の掛金（器ごと・払う人ごと）
    type Plan = { ideco: Map<string, Yen>; employer: Map<string, Yen>; matching: Map<string, Yen> };
    const byMonth = new Map<MonthIndex, Plan>();
    const plan = (m: MonthIndex): Plan => {
      let p = byMonth.get(m);
      if (p === undefined) {
        p = { ideco: new Map(), employer: new Map(), matching: new Map() };
        byMonth.set(m, p);
      }
      return p;
    };
    // 受け取りを始める月（その月から掛金を出さない）
    const payoutFrom = (a: AccountInput): MonthIndex => (a.payout === undefined ? addMonths(end, 1) : ctx.time.resolve(a.payout.start));
    for (const a of accounts) {
      const stop = payoutFrom(a);
      for (const c of a.contributions) {
        const from = ctx.time.resolve(c.from);
        const to = c.to === null ? end : ctx.time.resolve(c.to);
        for (let m = from > calcStart ? from : calcStart; m <= to && m <= end && m < stop; m = addMonths(m, 1)) {
          if (c.monthly <= 0) continue;
          const p = plan(m);
          const bucket = a.kind === "ideco" ? p.ideco : c.payer === "employer" ? p.employer : p.matching;
          bucket.set(a.id, yen((bucket.get(a.id) ?? 0) + c.monthly));
        }
      }
    }
    if (byMonth.size === 0) return { flows: [], payments: [] };
    const months = [...byMonth.keys()].sort((x, y) => x - y);
    const first = months[0] as MonthIndex;
    const last = months[months.length - 1] as MonthIndex;

    // 国民年金の被保険者の種別（その月の範囲だけを読む）
    const category = new Map<string, string>();
    for (const c of ctx.callMonths<CategoryOutput["months"][number]>("pension.category", { member }, "months", first, last)) category.set(c.month, c.category);
    const periods = ctx.list<EmploymentPeriodInput>("employment");
    const periodAt = (m: MonthIndex) =>
      periods.find((p) => ctx.time.resolve(p.from) <= m && (p.to === null || ctx.time.resolve(p.to) >= m) && p.type !== "leave" && p.type !== "unemployed");
    const hadIdeco = (m: MonthIndex) => months.some((k) => k < m && (byMonth.get(k) as Plan).ideco.size > 0);
    let basicFrom: MonthIndex | null | undefined;
    const receivesBasic = (m: MonthIndex): boolean => {
      if (basicFrom === undefined) {
        basicFrom = null;
        for (const x of ctx.callMonths<PensionOutput["months"][number]>("pension.oldAge", { member }, "months", first, last)) {
          if (x.basic > 0) {
            basicFrom = parseYm(x.month);
            break;
          }
        }
      }
      return basicFrom !== null && m >= basicFrom;
    };

    const flows: Flow[] = [];
    const payments: IdecoPayment[] = [];
    let capped = false;
    const push = (m: MonthIndex, object: string, kind: "ideco" | "corporateDc", payer: "self" | "employer", amount: Yen, row: string) => {
      if (amount <= 0) return;
      const ym = formatYm(m);
      payments.push({ ym, object, amount, kind, payer });
      flows.push({ row, ym, amount, accrualYear: yearOf(m), member, object, formula: `ideco.contribution.${kind === "ideco" ? "ideco" : payer === "employer" ? "employer" : "matching"}` });
    };
    for (const m of months) {
      const p = byMonth.get(m) as Plan;
      const at = ctx.at(m);
      const per = periodAt(m);
      const db = per?.corporatePension?.db === true || per?.type === "civilServant";
      const dbEq = m >= OTHER_PLAN_FROM && db ? yen(per?.corporatePension?.dbEquivalentMonthly ?? 0) : yen(0);
      // 企業型DC
      let employer = yen(0);
      for (const v of p.employer.values()) employer = yen(employer + v);
      let matching = yen(0);
      for (const v of p.matching.values()) matching = yen(matching + v);
      if (employer + matching > 0) {
        const dcLimit = pos((db ? (at.paramYen(P.dcDb) ?? 0) : (at.paramYen(P.dc) ?? 0)) - dbEq);
        let allowedMatching = matching;
        if ((at.paramCount(P.matchingCap) ?? 0) === 1 && allowedMatching > employer) allowedMatching = employer;
        const allowedEmployer = min(employer, dcLimit);
        allowedMatching = min(allowedMatching, pos(dcLimit - allowedEmployer));
        if (allowedEmployer < employer || allowedMatching < matching) capped = true;
        // 器ごとに、予定の額の割合で（端数は最初の器）
        const split = (total: Yen, planned: Map<string, Yen>, sum: Yen, payer: "self" | "employer") => {
          if (total <= 0) return;
          const ids = [...planned.keys()];
          const parts = total === sum ? ids.map((id) => planned.get(id) as Yen) : ctx.money.allocate(total, ids.map((id) => planned.get(id) as number), "conv.flow.allocate", "first");
          ids.forEach((id, i) => push(m, id, "corporateDc", payer, parts[i] as Yen, payer === "employer" ? "cf.transfer.ideco.employer" : "cf.transfer.ideco.matching"));
        };
        split(allowedEmployer, p.employer, employer, "employer");
        split(allowedMatching, p.matching, matching, "self");
        employer = allowedEmployer;
      }
      // iDeCo
      if (p.ideco.size === 0) continue;
      let wanted = yen(0);
      for (const v of p.ideco.values()) wanted = yen(wanted + v);
      let limit: Yen | null = null;
      const untilAge = ageMonth(ctx, m, P.until, member);
      const cat = category.get(formatYm(m)) ?? "none";
      if (m < untilAge) {
        if (cat === "1") limit = at.paramYen(P.c1);
        else if (cat === "3") limit = at.paramYen(P.c3);
        else if (cat === "2") {
          const other = yen(employer + dbEq);
          if (db) limit = min(at.paramYen(P.withDb) ?? yen(0), pos((at.paramYen(P.combinedDb) ?? 0) - other));
          else if (employer > 0) limit = min(at.paramYen(P.withDc) ?? yen(0), pos((at.paramYen(P.combined) ?? 0) - other));
          else limit = at.paramYen(P.noPlan);
        } else {
          // 第5号（60歳以上70歳未満・国民年金の被保険者でない・老齢基礎年金を受けていない・前に iDeCo の掛金を出していた）
          const c5 = at.paramYen(P.c5);
          if (c5 !== null && m >= ageMonth(ctx, m, P.earliest, member) && !receivesBasic(m) && hadIdeco(m)) limit = pos(c5 - employer - dbEq);
        }
      }
      let allowed = limit === null ? yen(0) : min(wanted, limit);
      if (allowed > 0 && allowed < (at.paramYen(P.minimum) ?? 0)) allowed = yen(0);
      if (allowed < wanted) capped = true;
      const ids = [...p.ideco.keys()];
      const parts = allowed === wanted ? ids.map((id) => p.ideco.get(id) as Yen) : allowed <= 0 ? ids.map(() => yen(0)) : ctx.money.allocate(allowed, ids.map((id) => p.ideco.get(id) as number), "conv.flow.allocate", "first");
      ids.forEach((id, i) => push(m, id, "ideco", "self", parts[i] as Yen, "cf.transfer.ideco.ideco"));
    }
    if (capped) ctx.notice("N_LIMIT_APPLIED", ["ideco.contributionLimit"]);
    return { flows, payments };
  },
});

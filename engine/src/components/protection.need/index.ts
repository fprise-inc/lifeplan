// 必要保障額の推移（6.3）: 構成員ごとに「この年に亡くなったら」を1年ずつずらした連続計算。差し込み口 slot.protection.method の公式の考え方。
// 万一の想定を重ねて全体のキャッシュフロー表を年ごとに計算し直すのではなく、万一なしの計算の部品の結果（月ごとのお金の動き）から遺族の
// 収支を組み立て、亡くなる年ごとに変わる部品（遺族年金。入力の death で「この月に亡くなったら」を試す）だけを呼ぶ（速さ: 0005 の追記 2026-10-09）。
// 亡くなる月はその年の1月（計算基準年は計算基準月）。遺族は死亡の当時の配偶者（いなければ子）。
// - 積み上げ方式（標準）: 死亡の月の翌月から期間の終わり（標準は配偶者の平均余命。簡易生命表の主な年齢の値を年齢で補間）までの
//   必要な資金（遺族の生活費＝生活費×遺族の割合（末子の独立まで0.7・後0.5、子のいない世帯は0.7。生活費の段階の後に掛ける）・住居費（団信で消える住宅ローンは除く）・
//   教育費・周期的な支出・介護・保険料（亡くなった人が被保険者の契約を除く）・遺族の税と社会保険料・遺族の車など）から、準備できる資金
//   （遺族の収入（給与・年金）・遺族年金・児童手当・教育の公的支援・死亡退職金・確定拠出年金の死亡一時金・弔慰金）を引き、
//   諸費用（整理資金・予備の生活資金（遺族の生活費の n か月分））を足す。金融資産（亡くなる年の前の年末）を含めない額（need）と、含めて引いた額
//   （needWithAssets）を出し、加入中の死亡保険金（亡くなった人が被保険者の契約の、その年の死亡保障額）と並べる。名目の額で、割り引かない
// - 逆算方式: 遺族の年ごとの収支で金融資産を前提の運用利回りで伸ばし、遺族（配偶者）が指定の年齢（省略は平均余命）になるまで残高が負に
//   ならない最小の保険金（死亡の月に受け取る）を求める（金融資産を含まない額と含む額）
// - 遺族年金の2028年4月の見直しは作らない（pension.survivor の知らせ）
import {
  addMonths,
  childrenOf,
  defineComponent,
  formatYm,
  monthIndex,
  parseYm,
  spousesAt,
  yearOf,
  yen,
  type AccountInput,
  type AnnualRow,
  type DebtInput,
  type Flow,
  type FlowsResult,
  type IdecoAccountOutput,
  type InsuranceContractInput,
  type InsurancePolicyOutput,
  type LivingExpenseInput,
  type MemberInput,
  type MonthIndex,
  type PaymentsOutput,
  type PeriodicExpenseInput,
  type ProtectionRequest,
  type Rate,
  type RelationInput,
  type RetirementReceipt,
  type SurvivorPensionOutput,
  type Yen,
} from "../../sdk/index.ts";

const LIFE = "lifeTable.lifeExpectancy";
const START = "pension.normalStartAge";
const NOT_FINANCIAL: ReadonlySet<string> = new Set(["realEstate", "insurance"]);

type Year = {
  year: number;
  death: string;
  horizon: number;
  need: Yen;
  needWithAssets: Yen;
  coverage: Yen;
  expenses: Yen;
  resources: Yen;
  lumpSum: Yen;
  assets: Yen;
};

export default defineComponent<{ request: ProtectionRequest }, { method: "accumulation" | "reverse"; members: { member: string; survivor?: string; years: Year[] }[] }>({
  id: "protection.need",
  title: "必要保障額の推移（積み上げ方式・逆算方式）",
  contract: "1.0",
  revision: 1,
  requires: {
    "plan.cashflow": ">=1 <2",
    "plan.memberFlows": ">=1 <2",
    "expense.living": ">=1 <2",
    "expense.periodic": ">=1 <2",
    "expense.advisoryFee": ">=1 <2",
    "housing.residence": ">=1 <2",
    "debt.schedule": ">=1 <2",
    "education.cost": ">=1 <2",
    "education.support": ">=1 <2",
    "benefit.childAllowance": ">=1 <2",
    "insurance.premiumPayment": ">=1 <2",
    "insurance.policy": ">=1 <2",
    "care.expense": ">=1 <2",
    "socialInsurance.nationalHealth": ">=1 <2",
    "pension.survivor": ">=1 <2",
    "retirement.receipts": ">=1 <2",
    "account.ideco": ">=1 <2",
  },
  params: [LIFE, START],
  reads: [
    "member.kind",
    "member.birth",
    "member.sex",
    "member.leaves",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
    "livingExpense.onContingency",
    "periodicExpense.onContingency",
    "advisoryFee.terms",
    "debt.debtors",
    "debt.creditLife",
    "goal.kind",
    "goal.owner",
    "insurance.insured",
    "account.kind",
    "account.marketValue",
    "assumptions.investmentReturn",
  ],
  input: "protection.need.input",
  output: "protection.need.output",
  compute(input, ctx) {
    const req = input.request;
    const method = req.method ?? "accumulation";
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const N = end - base + 1;
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    // 月ごとの額の累積（prefix[i] は計算基準月から i か月分の合計）
    const prefixOf = (flows: readonly Flow[], pick: (f: Flow) => boolean = () => true): number[] => {
      const arr = new Array<number>(N + 1).fill(0);
      for (const f of flows) {
        if (!pick(f)) continue;
        const i = parseYm(f.ym) - base;
        if (i < 0 || i >= N) continue;
        (arr as number[])[i + 1] = (arr[i + 1] as number) + f.amount;
      }
      for (let i = 1; i <= N; i++) arr[i] = (arr[i] as number) + (arr[i - 1] as number);
      return arr;
    };
    const sum = (p: readonly number[], a: MonthIndex, b: MonthIndex): number => {
      const i = Math.max(0, a - base);
      const j = Math.min(N - 1, b - base);
      return j < i ? 0 : (p[j + 1] as number) - (p[i] as number);
    };
    // 死亡のときの割合（onContingency。死亡に当てるもの）。null は当てない
    const deathFactor = (on: { mode: string; ratio?: string; kinds?: readonly string[] } | undefined): string | null => {
      if (on === undefined || on.mode === "continue" || !(on.kinds ?? ["death"]).includes("death")) return null;
      return on.mode === "stop" ? "0" : (on.ratio ?? "1");
    };
    // 生活費（onContingency の有無で分ける）
    const living = ctx.call<FlowsResult>("expense.living", {}).flows;
    const livingInputs = ctx.list<LivingExpenseInput>("livingExpense");
    const explicit = new Map(livingInputs.map((e) => [e.id, deathFactor(e.onContingency)]));
    const livingDefault = prefixOf(living, (f) => !livingInputs.some((e) => e.id === f.object && e.onContingency !== undefined));
    const factorGroups = (flows: readonly Flow[], factorOf: (f: Flow) => string | null): { factor: string | null; p: number[] }[] => {
      const keys = new Set(flows.map(factorOf));
      return [...keys].map((k) => ({ factor: k, p: prefixOf(flows, (f) => factorOf(f) === k) }));
    };
    const livingExplicit = factorGroups(
      living.filter((f) => livingInputs.some((e) => e.id === f.object && e.onContingency !== undefined)),
      (f) => explicit.get(f.object ?? "") ?? null,
    );
    const periodicInputs = ctx.list<PeriodicExpenseInput>("periodicExpense");
    const periodic = factorGroups(ctx.call<FlowsResult>("expense.periodic", {}).flows, (f) => deathFactor(periodicInputs.find((e) => e.id === f.object)?.onContingency));
    const advisoryInputs = ctx.list<{ id: string; terms?: { recurring?: { onContingency?: { mode: string; ratio?: string; kinds?: readonly string[] } } } }>("advisoryFee");
    const advisory = factorGroups(ctx.call<FlowsResult>("expense.advisoryFee", {}).flows, (f) => (f.formula === "expense.advisoryFee.oneTime" ? null : deathFactor(advisoryInputs.find((c) => c.id === f.object)?.terms?.recurring?.onContingency)));
    const housing = prefixOf(ctx.call<FlowsResult>("housing.residence", {}).flows);
    const care = prefixOf(ctx.call<FlowsResult>("care.expense", {}).flows);
    const health: Flow[] = [];
    for (let fy = baseYear - 1; fy <= endYear; fy++) for (const f of ctx.call<FlowsResult>("socialInsurance.nationalHealth", { fiscalYear: fy }).flows) health.push(f);
    const nationalHealth = prefixOf(health);
    const debts = ctx.list<Pick<DebtInput, "id" | "debtors" | "creditLife">>("debt").map((d) => ({ d, p: prefixOf(ctx.call<FlowsResult>("debt.schedule", { object: d.id }).flows) }));
    const edu: Flow[] = [];
    const support: Flow[] = [];
    for (const g of ctx.list<{ kind: string; owner: string }>("goal")) {
      if (g.kind !== "education") continue;
      for (const f of ctx.call<FlowsResult>("education.cost", { member: g.owner }).flows) edu.push(f);
      for (const f of ctx.call<FlowsResult>("education.support", { member: g.owner }).flows) support.push(f);
    }
    const education = prefixOf(edu);
    const educationSupport = prefixOf(support);
    const allowance = prefixOf(ctx.call<FlowsResult>("benefit.childAllowance", {}).flows);
    const contracts = ctx.list<Pick<InsuranceContractInput, "id" | "insured">>("insurance");
    const premiumFlows = ctx.call<PaymentsOutput>("insurance.premiumPayment", {}).flows;
    const premiums = contracts.map((c) => ({ insured: c.insured, p: prefixOf(premiumFlows, (f) => f.object === c.id) }));
    const policies = contracts.map((c) => ({ insured: c.insured, years: ctx.call<InsurancePolicyOutput>("insurance.policy", { object: c.id }).years }));
    // 遺族の収入・税と社会保険料・支出（万一なしの構成員ごとのお金の動き）
    const memberCache = new Map<string, { income: number[]; tax: number[]; expense: number[] }>();
    const ownOf = (z: string) => {
      let v = memberCache.get(z);
      if (v === undefined) {
        const fl = ctx.call<{ flows: readonly Flow[] }>("plan.memberFlows", { member: z }).flows;
        v = { income: prefixOf(fl, (f) => f.row.startsWith("cf.income")), tax: prefixOf(fl, (f) => f.row.startsWith("cf.taxSi")), expense: prefixOf(fl, (f) => f.row.startsWith("cf.expense")) };
        memberCache.set(z, v);
      }
      return v;
    };
    // 金融資産（年末）
    const annual = ctx.call<{ annual: readonly AnnualRow[] }>("plan.cashflow", {}).annual;
    const financial = new Map(annual.filter((a) => a.row === "cf.balance.financial").map((a) => [a.year, a.amount]));
    let initial = 0;
    for (const a of ctx.list<Pick<AccountInput, "kind" | "marketValue">>("account")) if (!NOT_FINANCIAL.has(a.kind)) initial += a.marketValue.value ?? 0;
    const assetsAt = (y: number): number => (y > baseYear ? (financial.get(y - 1) ?? 0) : initial);

    // 平均余命（簡易生命表の主な年齢の値を補間。性別ごと）
    const lifeMonths = (z: string, at: MonthIndex): number | null => {
      const m = ctx.at(at < base ? base : at);
      if (!m.has(LIFE, { member: z })) return null;
      const table = m.paramBrackets(LIFE, { member: z });
      if (table === null || table.length === 0) return null;
      const birth = parseYm((members.find((x) => x.id === z) as MemberInput).birth.birthYearMonth);
      const age = Math.floor((at - birth) / 12);
      let lo = table[0] as { upTo: number | null; rate?: Rate };
      let hi = lo;
      for (const r of table) {
        if (r.upTo === null) continue;
        if ((r.upTo as number) <= age) lo = r as typeof lo;
        if ((r.upTo as number) >= age) {
          hi = r as typeof hi;
          break;
        }
        hi = r as typeof hi;
      }
      const toMonths = (r: Rate) => {
        const f = ctx.rate.fraction(ctx.rate.mulInt(r, 12));
        return Number(f.num / f.den);
      };
      const e0 = lo.rate === undefined ? 0 : toMonths(lo.rate);
      const e1 = hi.rate === undefined ? e0 : toMonths(hi.rate);
      const a0 = (lo.upTo as number) ?? age;
      const a1 = (hi.upTo as number) ?? age;
      if (a1 === a0 || age <= a0) return age <= a0 ? e0 : e1;
      if (age >= a1) return e1;
      ctx.notice("N_ESTIMATED", ["lifeTable.interpolated"]);
      return Math.floor(e0 + ((e1 - e0) * (age - a0)) / (a1 - a0));
    };
    const ageMonthOf = (z: string, years: number) => addMonths(parseYm((members.find((x) => x.id === z) as MemberInput).birth.birthYearMonth), years * 12);

    const targets = req.members ?? members.filter((m) => m.kind === "self" || m.kind === "spouse").map((m) => m.id);
    const out: { member: string; survivor?: string; years: Year[] }[] = [];
    for (const X of targets) {
      const xm = members.find((m) => m.id === X);
      if (xm === undefined) continue;
      const startAge = ctx.at(base).paramCount(START) ?? 65;
      const from = Math.max(req.fromYear ?? baseYear, baseYear);
      const to = Math.min(req.toYear ?? yearOf(ageMonthOf(X, startAge)), endYear);
      const years: Year[] = [];
      let survivorId: string | undefined;
      for (let y = from; y <= to; y++) {
        const D = (y === baseYear ? base : monthIndex(y, 1)) as MonthIndex;
        const xLeaves = xm.leaves === null ? null : ctx.time.resolve(xm.leaves);
        if (xLeaves !== null && xLeaves <= D) break;
        const spouse = spousesAt(ctx, relations, X, D)[0];
        const kids = childrenOf(members, relations, X).filter((c) => parseYm(c.birth.birthYearMonth) <= D);
        const Z = spouse ?? kids.sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? -1 : 1))[0]?.id;
        if (Z === undefined) continue;
        survivorId = Z;
        // 期間の終わり
        let H: MonthIndex;
        const hz = req.horizon ?? { kind: "lifeExpectancy" };
        if (hz.kind === "age" && hz.age !== undefined) H = ageMonthOf(Z, hz.age);
        else if (hz.kind === "youngestIndependence") {
          H = D;
          for (const c of kids) {
            const own = c.leaves === null ? addMonths(ctx.time.ageSwitch(c.id, { years: req.survivor?.independenceAge ?? 22 }, "firstMarch31AfterReach"), 1) : ctx.time.resolve(c.leaves);
            if (own > H) H = own;
          }
        } else {
          const lm = lifeMonths(Z, D);
          if (lm === null) {
            ctx.notice("N_INPUT_REQUIRED", ["lifeTable.lifeExpectancy", "protection.horizon"]);
            H = ageMonthOf(Z, 90);
          } else H = addMonths(D, lm);
        }
        if (H > end) {
          ctx.notice("N_PROTECTION_TRUNCATED", ["protection.horizon", String(endYear)]);
          H = end;
        }
        const A = addMonths(D, 1);
        // 末子の独立（遺族の生活費の割合の切り替わり）
        let indep = D;
        for (const c of kids) {
          const own = c.leaves === null ? addMonths(ctx.time.ageSwitch(c.id, { years: req.survivor?.independenceAge ?? 22 }, "firstMarch31AfterReach"), 1) : ctx.time.resolve(c.leaves);
          if (own > indep) indep = own;
        }
        // 子のいない世帯は、全期間を noChildren（省略は0.7）にする
        const noChildren = kids.length === 0 ? ctx.rate.of(req.survivor?.livingRatio?.noChildren ?? "0.7") : null;
        const before = noChildren ?? ctx.rate.of(req.survivor?.livingRatio?.beforeIndependence ?? "0.7");
        const after = noChildren ?? ctx.rate.of(req.survivor?.livingRatio?.afterIndependence ?? "0.5");
        const scaled = (p: readonly number[], factor: string | null, a: MonthIndex, b: MonthIndex): number => {
          const s = sum(p, a, b);
          return factor === null || s === 0 ? s : ctx.money.mulRate(yen(s), ctx.rate.of(factor), "conv.expense.share");
        };
        // 年ごとの必要な資金と準備できる資金（死亡の月の翌月から H まで）
        const sp = ctx.call<SurvivorPensionOutput>("pension.survivor", { member: Z, death: { member: X, month: formatYm(D) } }).flows;
        const yearly: { year: number; exp: number; res: number }[] = [];
        const survivorOwn = spouse !== undefined ? ownOf(spouse) : null;
        for (let t = yearOf(A); t <= yearOf(H); t++) {
          const a = (t === yearOf(A) ? A : monthIndex(t, 1)) as MonthIndex;
          const b = (t === yearOf(H) ? H : monthIndex(t, 12)) as MonthIndex;
          let exp = 0;
          // 生活費（段階の後に遺族の割合）
          const cut = indep < a ? a : indep > b ? addMonths(b, 1) : indep;
          if (cut > a) exp += ctx.money.mulRate(yen(sum(livingDefault, a, addMonths(cut, -1))), before, "conv.expense.share");
          if (cut <= b) exp += ctx.money.mulRate(yen(sum(livingDefault, cut, b)), after, "conv.expense.share");
          for (const g of livingExplicit) exp += scaled(g.p, g.factor, a, b);
          for (const g of periodic) exp += scaled(g.p, g.factor, a, b);
          for (const g of advisory) exp += scaled(g.p, g.factor, a, b);
          exp += sum(housing, a, b) + sum(care, a, b) + sum(education, a, b) + sum(nationalHealth, a, b);
          for (const { d, p } of debts) {
            const cl = d.creditLife;
            let factor: string | null = null;
            if (cl !== undefined && cl.covered.includes(X) && (cl.events ?? ["death"]).includes("death")) {
              const share = d.debtors.find((x) => x.member === X)?.share;
              const ratio = cl.spouseJoint === true ? "1" : (cl.ratio ?? (d.debtors.length > 1 && share !== undefined ? share : "1"));
              factor = ctx.rate.toString(ctx.rate.sub(ctx.rate.of("1"), ctx.rate.of(ratio)));
            }
            exp += scaled(p, factor, a, b);
          }
          for (const pr of premiums) if (pr.insured !== X) exp += sum(pr.p, a, b);
          let res = sum(educationSupport, a, b) + sum(allowance, a, b);
          if (survivorOwn !== null) {
            exp += sum(survivorOwn.tax, a, b) + sum(survivorOwn.expense, a, b);
            res += sum(survivorOwn.income, a, b);
          }
          for (const f of sp) {
            const m = parseYm(f.ym);
            if (m >= a && m <= b) res += f.amount;
          }
          yearly.push({ year: t, exp, res });
        }
        // 一時の資金: 死亡退職金（勤続の月数で按分）・確定拠出年金の死亡一時金・弔慰金と、整理資金・予備の生活資金
        let lumpRes = 0;
        const given = req.survivor?.deathBenefits;
        if (given?.retirementAllowance !== undefined) lumpRes += given.retirementAllowance;
        else {
          for (const r of ctx.call<{ receipts: readonly RetirementReceipt[] }>("retirement.receipts", { member: X }).receipts) {
            const m = parseYm(r.ym);
            if (r.source !== "retirement" || m <= D) continue;
            const f = parseYm(r.serviceFrom);
            const tt = parseYm(r.serviceTo);
            lumpRes += tt > D && D >= f ? ctx.money.mulRatio(r.amount, D - f + 1, tt - f + 1, "conv.retirement.estimate") : r.amount;
          }
        }
        for (const acc of ctx.call<IdecoAccountOutput>("account.ideco", { member: X }).accounts) {
          const prev = acc.years.find((e) => e.year === y - 1);
          if (prev !== undefined) lumpRes += prev.closing;
        }
        lumpRes += given?.condolence ?? 0;
        const reserveMonthly = ctx.money.mulRate(yen(sum(livingDefault, A, A)), indep > A ? before : after, "conv.expense.share");
        const lumpCost = (req.survivor?.funeral ?? 0) + ctx.money.mulRatio(reserveMonthly, req.survivor?.reserveMonths ?? 0, 1, "conv.exact");
        const totalExp = yearly.reduce((s, x) => s + x.exp, 0);
        const totalRes = yearly.reduce((s, x) => s + x.res, 0);
        const assets = assetsAt(y);
        let need: number;
        let needWithAssets: number;
        if (method === "accumulation") {
          need = Math.max(0, totalExp - totalRes + lumpCost - lumpRes);
          needWithAssets = Math.max(0, need - assets);
        } else {
          // 逆算方式: 遺族の年ごとの収支で残高を運用利回りで伸ばし、目標の年齢まで負にならない最小の保険金（二分探索）
          const until = req.reverseUntilAge === undefined ? H : ageMonthOf(Z, req.reverseUntilAge);
          const lastYear = Math.min(yearOf(until), yearOf(H));
          const ok = (start: number, L: number): boolean => {
            let bal = start + L + lumpRes - lumpCost;
            if (bal < 0) return false;
            for (const x of yearly) {
              if (x.year > lastYear) break;
              const r = ctx.assumption("investmentReturn", x.year);
              const net = x.res - x.exp;
              bal = bal + net + ctx.money.mulRate(yen(bal > 0 ? bal : 0), r, "conv.investment.return");
              if (bal < 0) return false;
            }
            return true;
          };
          const solve = (start: number): number => {
            if (ok(start, 0)) return 0;
            let lo = 0;
            let hi = 1000000;
            while (!ok(start, hi) && hi < 10000000000000) hi *= 2;
            while (hi - lo > 1000) {
              const mid = Math.floor((lo + hi) / 2 / 1000) * 1000;
              if (mid <= lo) break;
              if (ok(start, mid)) hi = mid;
              else lo = mid;
            }
            return hi;
          };
          need = solve(0);
          needWithAssets = solve(assets);
        }
        // 加入中の死亡保険金（亡くなる人が被保険者の契約の、その年の死亡保障額）
        let coverage = 0;
        for (const p of policies) if (p.insured === X) coverage += p.years.find((e) => e.year === y)?.deathBenefit ?? 0;
        years.push({
          year: y,
          death: formatYm(D),
          horizon: yearOf(H),
          need: yen(need),
          needWithAssets: yen(needWithAssets),
          coverage: yen(coverage),
          expenses: yen(totalExp + lumpCost),
          resources: yen(totalRes + lumpRes),
          lumpSum: yen(lumpCost),
          assets: yen(assets),
        });
      }
      out.push({ member: X, ...(survivorId !== undefined ? { survivor: survivorId } : {}), years });
    }
    return { method, members: out };
  },
});

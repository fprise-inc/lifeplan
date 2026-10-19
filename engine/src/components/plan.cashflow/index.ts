// 計算のはじめに呼ぶ部品: お金の動きと年間収支（plan.flows）から、資産の器ごとの残高・運用益・取り崩しを年ごとに出す（0008 の9・0003 の3）。
// お金の動きを集めるのは plan.flows（運用利回りだけが変わったときに集め直さずに済むように分けた。0005 の追記）。
// - 決済口座（settlement の器。省略は最初の預金。預金が無ければ名義の無い預金）に、その年の収支（収入−税・社会保険料−支出）が入る。
//   積立（器の間の移動。NISA・課税口座・財形・持株会・積立預金。iDeCo・企業型DC の本人の掛金は ideco.contribution）は決済口座から出る
// - 運用益: 器ごとに、期首残高×年利＋その年の器への出入り×年利×1/2（0003 の3。年利は資産クラスの配分×資産クラスの利回り。accountReturnRate）。
//   iDeCo・企業型DC は account.ideco が計算する（受け取りの年齢まで引き出せない）
// - NISA: 積立は年間投資枠（つみたて・成長）と非課税保有限度額（簿価。成長投資枠は内数）の残りで止める。売った簿価の分の枠は翌年に復活する。
//   口座を開けるのはその年1月1日に18歳以上の年（生年月で判定。1月2日生まれは1年遅れる近似）。こどもNISA（2027年から）は年間投資枠と
//   非課税保有限度額で止め、成人の年からは成人の NISA になる（簿価は成人の枠に数える）
// - 旧NISA・ジュニアNISA: 買付の年ごとの内訳（lots）の非課税期間が終わった年の年末に、時価で課税口座へ移す（取得価額はその時価）。
//   ジュニアNISA は非課税期間（5年）の終わりと18歳（1月1日）の前の年の終わりの遅い方
// - 取り崩し: 決済口座の年末の残高が minimumDeposit（省略は0）を下回ったら、取り崩しの順序（assumptions.withdrawal.order。省略は
//   預金・外貨預金・財形・課税口座・持株会・旧NISA・NISA）の器から年末に売って補う。課税口座は売った額の取得価額（取得価額×売る額÷時価）との差に
//   上場株式等の譲渡益の税（所得税・復興特別所得税・防衛特別所得税と住民税。源泉徴収ありの特定口座とみなす）をかけ、手取りで足りるだけ売る。
//   引き出せない期間（withdrawalLockedUntil）の器・iDeCo・企業型DC・不動産は取り崩さない。補えなかった額は資金不足（cf.balance.shortfall）
// - 年ごとの行: 年間収支（譲渡益の税を引いた後）・運用益・金融資産の合計・器ごとの残高・負債の残高・NISA の非課税保有限度額の残り・資金不足
// - 小規模企業共済は account.mutualAid が残高と受け取りを計算する（掛金は決済口座から出る）。自動車ローン（expense.car）・教育ローンと
//   貸与の奨学金（education.cost）の年末残高も負債の残高（cf.balance.debt.other）に載せる
// - 現状の検算（expense.reconcile。年間収支を読むのでここで呼ぶ）の使途不明金を、お金の動きと年間収支に足す
// - 改訂7（約束の版 1.2）: ストレステストの資産の時価の下落（前提 marketShocks。その年の年末に器の時価をその割合だけ下げ、運用益に含める。
//   既定の器は預金・外貨預金・財形・不動産・保険・小規模企業共済を除く）。保険契約の解約返戻金を器ごとの残高の行（cf.balance.account.insurance。
//   契約の ID。金融資産の合計には入れない）に載せる。保障内容一覧・払込保険料の推移の材料と贈与税を details（エンジンが summary に写す）に出す
// - 改訂8: 持ち家の残高（cf.balance.account.realEstate）を housing.valuation の評価額（土地は上昇率、建物は耐用年数で減らす。売った年からは載せない）に
//   した。車の評価額（asset.car）を cf.balance.account.car に載せる。器の種類「その他の資産」（otherAsset。評価額の増減率 valueGrowth、省略は0）を足した。
//   不動産・車・その他の資産・保険の解約返戻金は、金融資産の合計に入れず、取り崩さない
import {
  accountReturnRate,
  type CarValuationOutput,
  type HousingValuationOutput,
  addMonths,
  addYen,
  ageMonth,
  annualReturn,
  boxValue,
  defineComponent,
  formatYm,
  monthIndex,
  monthOf,
  netByYear,
  RATE_ZERO,
  yearOf,
  yen,
  type AccountInput,
  type AccountKind,
  type AnnualRow,
  type CashflowDetails,
  type DebtInput,
  type DebtScheduleOutput,
  type Flow,
  type GiftTaxOutput,
  type IdecoAccountOutput,
  type InsuranceContractInput,
  type InsurancePolicyOutput,
  type MarketShock,
  type IdecoContributionOutput,
  type MemberInput,
  type MonthIndex,
  type MutualAidOutput,
  type Rate,
  type Yen,
} from "../../sdk/index.ts";

const N = {
  tsumitate: "nisa.annualLimit.tsumitate",
  growth: "nisa.annualLimit.growth",
  lifetime: "nisa.lifetimeLimit",
  lifetimeGrowth: "nisa.lifetimeLimit.growth",
  age: "nisa.eligibleAge",
  childAnnual: "nisa.child.annualLimit",
  childLifetime: "nisa.child.lifetimeLimit",
  childWithdrawal: "nisa.child.withdrawalAge",
  general: "nisa.legacy.generalPeriodYears",
  tsumitateYears: "nisa.legacy.tsumitatePeriodYears",
  junior: "nisa.junior.untilAge",
};
const T = {
  it: "incomeTax.listedSecurities.rate",
  rt: "residentTax.listedSecurities.rate",
  itRound: "incomeTax.listedSecurities.withholding.rounding",
  rtRound: "residentTax.listedSecurities.rounding",
  recon: "incomeTax.reconstructionSurtax.rate",
  defense: "incomeTax.defenseSurtax.rate",
};

/** 残高に入れない器（不動産・保険の解約返戻金・その他の資産） */
const NOT_FINANCIAL: ReadonlySet<string> = new Set(["realEstate", "insurance", "otherAsset"]);
/** 既定の取り崩しの順序 */
const DEFAULT_ORDER: readonly AccountKind[] = ["deposit", "fxDeposit", "zaikei", "taxable", "esop", "legacyNisa", "nisa"];
/** 取り崩さない器（受け取りの年齢までの iDeCo・企業型DC、不動産・その他の資産） */
const NEVER_WITHDRAWN: ReadonlySet<string> = new Set(["ideco", "corporateDc", "realEstate", "otherAsset"]);
const TRANSFER_ROW: Readonly<Record<string, string>> = {
  taxable: "cf.transfer.investment",
  zaikei: "cf.transfer.savings.zaikei",
  esop: "cf.transfer.savings.esop",
  deposit: "cf.transfer.savings.deposit",
  fxDeposit: "cf.transfer.savings.deposit",
};

interface Lot {
  readonly vintage: number;
  readonly regime: "general" | "tsumitate" | "junior";
  cost: Yen;
  value: Yen;
}

interface Acc {
  readonly id: string | null;
  readonly input: AccountInput | null;
  /** 残高の行の器の種類（こどもNISA は成人の年から nisa） */
  kind: string;
  readonly owner: string | null;
  value: Yen;
  cost: Yen;
  /** NISA の取得価額のうち成長投資枠の分 */
  growthCost: Yen;
  lots: Lot[] | null;
  /** その年の器への出入り（運用益の計算に使う） */
  inflow: Yen;
  ret: Yen;
}

interface Frame {
  used: Yen;
  usedGrowth: Yen;
  restore: Yen;
  restoreGrowth: Yen;
}

/** 時価の下落の既定で下げない器 */
const SHOCK_EXEMPT: ReadonlySet<string> = new Set(["deposit", "fxDeposit", "zaikei", "realEstate", "insurance", "smallBusinessMutualAid", "otherAsset"]);

export default defineComponent<Record<string, never>, { flows: readonly Flow[]; annual: AnnualRow[]; parts: readonly (readonly Flow[])[]; details?: CashflowDetails }>({
  id: "plan.cashflow",
  title: "キャッシュフロー表",
  contract: "1.2",
  revision: 8,
  requires: {
    "plan.flows": ">=1 <2",
    "insurance.policy": ">=1 <2",
    "gift.received": ">=1 <2",
    "gift.tax": ">=1 <2",
    "expense.reconcile": ">=1 <2",
    "expense.car": ">=1 <2",
    "education.cost": ">=1 <2",
    "account.mutualAid": ">=1 <2",
    "ideco.contribution": ">=1 <2",
    "account.ideco": ">=1 <2",
    "debt.schedule": ">=1 <2",
    "housing.valuation": ">=1 <2",
    "asset.car": ">=1 <2",
  },
  params: [...Object.values(N), ...Object.values(T)],
  reads: [
    "member.kind",
    "account.kind",
    "account.owner",
    "account.marketValue",
    "account.costBasis",
    "account.assetMix",
    "account.settlement",
    "account.withdrawalLockedUntil",
    "account.contributions",
    "account.frame",
    "account.lots",
    "account.valueGrowth",
    "debt.kind",
    "debt.debtors",
    "goal.kind",
    "goal.owner",
    "assumptions.investmentReturn",
    "assumptions.assetReturns",
    "assumptions.withdrawal",
    "assumptions.marketShocks",
    "insurance.template",
    "insurance.policyholder",
    "insurance.insured",
    "insurance.coverages",
  ],
  input: "empty.input",
  output: "plan.cashflow.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const collected = ctx.call<{ flows: readonly Flow[]; net: readonly { year: number; amount: Yen }[]; parts: readonly (readonly Flow[])[] }>("plan.flows", {});
    const net = new Map(collected.net.map((x) => [x.year, x.amount]));
    // 現状の検算の使途不明金（年間収支から引く）
    const reconciled = ctx.call<{ flows: readonly Flow[] }>("expense.reconcile", {}).flows;
    if (reconciled.length > 0) for (const [y, a] of netByYear(reconciled, ctx.conventions.aggregation, base, end)) net.set(y, yen((net.get(y) ?? 0) + a));
    const inputs = ctx.list<AccountInput>("account");
    const own: Flow[] = [];
    const annual: AnnualRow[] = [];
    const flow = (row: string, m: MonthIndex, amount: Yen, member: string | null, object: string | null, formula: string) => {
      if (amount === 0) return;
      own.push({ row, ym: formatYm(m), amount, accrualYear: yearOf(m), ...(member === null ? {} : { member }), ...(object === null ? {} : { object }), formula });
    };

    // 器（iDeCo・企業型DC は account.ideco）
    const accs: Acc[] = [];
    for (const a of inputs) {
      if (a.kind === "ideco" || a.kind === "corporateDc" || a.kind === "smallBusinessMutualAid") continue;
      const value = boxValue(a.marketValue) ?? yen(0);
      const cost = a.costBasis === undefined ? value : (boxValue(a.costBasis) ?? value);
      const lots = a.lots === undefined ? null : a.lots.map((l) => ({ vintage: l.vintageYear, regime: l.regime, cost: l.costBasis, value: l.marketValue }));
      accs.push({ id: a.id, input: a, kind: a.kind, owner: a.owner, value, cost, growthCost: yen(0), lots, inflow: yen(0), ret: yen(0) });
    }
    let settlement = accs.find((x) => x.input?.settlement === true) ?? accs.find((x) => x.kind === "deposit");
    if (settlement === undefined) {
      settlement = { id: null, input: null, kind: "deposit", owner: null, value: yen(0), cost: yen(0), growthCost: yen(0), lots: null, inflow: yen(0), ret: yen(0) };
      accs.unshift(settlement);
    }
    const D = settlement;
    // NISA の枠（構成員ごと。frame が無ければ今の取得価額を消化した枠とみなす）
    const frames = new Map<string, Frame>();
    const frameOf = (owner: string): Frame => {
      let f = frames.get(owner);
      if (f === undefined) {
        f = { used: yen(0), usedGrowth: yen(0), restore: yen(0), restoreGrowth: yen(0) };
        frames.set(owner, f);
      }
      return f;
    };
    for (const x of accs) {
      if (x.kind !== "nisa" || x.owner === null) continue;
      const f = frameOf(x.owner);
      const given = x.input?.frame;
      f.used = addYen(f.used, given === undefined ? x.cost : given.lifetimeUsedCost);
      f.usedGrowth = addYen(f.usedGrowth, yen(given?.growthUsedCost ?? 0));
      x.growthCost = yen(given?.growthUsedCost ?? 0);
    }
    // 課税口座（旧NISA・ジュニアNISA の移し先。名義人の最初の課税口座。無ければ移す元の器の ID で作る）
    const taxableOf = (owner: string | null, from: Acc): Acc => {
      let t = accs.find((x) => x.kind === "taxable" && x.owner === owner);
      if (t === undefined) {
        t = { id: from.id, input: null, kind: "taxable", owner, value: yen(0), cost: yen(0), growthCost: yen(0), lots: null, inflow: yen(0), ret: yen(0) };
        accs.push(t);
      }
      return t;
    };
    const members = ctx.list<MemberInput>("member");
    const reach = new Map<string, MonthIndex>();
    const reachOf = (owner: string, id: string, at: MonthIndex): MonthIndex => {
      const key = `${owner}|${id}`;
      let m = reach.get(key);
      if (m === undefined) {
        m = ageMonth(ctx, at, id, owner);
        reach.set(key, m);
      }
      return m;
    };
    // その年1月1日に18歳以上か（成人の NISA）
    const adultIn = (owner: string, y: number) => reachOf(owner, N.age, monthIndex(y, 1)) < monthIndex(y, 1);

    // iDeCo・企業型DC（構成員ごと）と、本人が払う掛金（決済口座から出る）
    const dcYears = new Map<string, { kind: string; owner: string; byYear: Map<number, { closing: Yen; returns: Yen }> }>();
    const selfPaid = new Map<number, Yen>();
    for (const m of members) {
      const out = ctx.call<IdecoAccountOutput>("account.ideco", { member: m.id });
      for (const a of out.accounts) dcYears.set(a.object, { kind: a.kind, owner: m.id, byYear: new Map(a.years.map((y) => [y.year, { closing: y.closing, returns: y.returns }])) });
      if (out.accounts.length === 0) continue;
      for (const p of ctx.call<IdecoContributionOutput>("ideco.contribution", { member: m.id }).payments) {
        if (p.payer !== "self") continue;
        const ym = ctx.time.resolve({ at: p.ym });
        if (ym < base) continue;
        selfPaid.set(yearOf(ym), addYen(selfPaid.get(yearOf(ym)) ?? yen(0), p.amount));
      }
    }
    // 小規模企業共済（構成員ごと。掛金は決済口座から出る）
    const mutualAid = new Map<string, { owner: string; byYear: Map<number, { closing: Yen; returns: Yen }> }>();
    for (const m of members) {
      const out = ctx.call<MutualAidOutput>("account.mutualAid", { member: m.id });
      for (const a of out.accounts) {
        mutualAid.set(a.object, { owner: m.id, byYear: new Map(a.years.map((y) => [y.year, { closing: y.closing, returns: y.returns }])) });
        for (const y of a.years) selfPaid.set(y.year, addYen(selfPaid.get(y.year) ?? yen(0), y.contributions));
      }
    }
    // 負債の年末残高と、購入した持ち家
    const debts: { d: Pick<DebtInput, "id" | "kind" | "debtors">; out: Pick<DebtScheduleOutput, "yearEnd"> }[] = ctx.list<DebtInput>("debt").map((d) => ({ d, out: ctx.call<DebtScheduleOutput>("debt.schedule", { object: d.id }) }));
    // ほかの部品が作った負債（自動車ローン・教育ローン・貸与の奨学金）
    for (const m of members) {
      for (const l of ctx.call<{ loans: readonly { object: string; yearEnd: DebtScheduleOutput["yearEnd"] }[] }>("expense.car", { member: m.id }).loans) {
        debts.push({ d: { id: l.object, kind: "car", debtors: [{ member: m.id, role: "primary" }] }, out: { yearEnd: l.yearEnd } });
      }
    }
    for (const g of ctx.list<{ kind: string; owner: string }>("goal")) {
      if (g.kind !== "education") continue;
      for (const l of ctx.call<{ loans: readonly { object: string; member: string; yearEnd: DebtScheduleOutput["yearEnd"] }[] }>("education.cost", { member: g.owner }).loans) {
        debts.push({ d: { id: l.object, kind: "other", debtors: [{ member: l.member, role: "primary" }] }, out: { yearEnd: l.yearEnd } });
      }
    }
    // 持ち家の評価額（年ごと）と車の評価額（金融資産の合計には入れない）
    const homes = ctx.call<HousingValuationOutput>("housing.valuation", {}).properties.map((p) => ({ p, byYear: new Map(p.years.map((e) => [e.year, e.value])) }));
    const cars = ctx.call<CarValuationOutput>("asset.car", {}).cars.map((c) => ({ c, byYear: new Map(c.years.map((e) => [e.year, e.value])) }));

    // 積立の予定（器ごと・月ごと）
    const planned = new Map<number, { acc: Acc; m: MonthIndex; amount: Yen; tranche: string }[]>();
    for (const x of accs) {
      if (x.input === null || x.input.contributions.length === 0 || x === D) continue;
      for (const c of x.input.contributions) {
        const from = ctx.time.resolve(c.from);
        const to = c.to === null ? end : ctx.time.resolve(c.to);
        for (let m = from > base ? from : base; m <= to && m <= end; m = addMonths(m, 1)) {
          if (c.monthly <= 0) continue;
          const list = planned.get(yearOf(m)) ?? [];
          list.push({ acc: x, m, amount: c.monthly, tranche: c.tranche === "growth" ? "growth" : "tsumitate" });
          planned.set(yearOf(m), list);
        }
      }
    }

    // 取り崩しの順序（旧NISA・ジュニアNISA の移し先に作った課税口座も含めるため、取り崩すたびに器の一覧から決める）
    const setting = ctx.setting<{ order?: readonly ({ kind: string } | { object: string })[]; minimumDeposit?: Yen }>("withdrawal");
    const orderOf = (): Acc[] => {
      const order: Acc[] = [];
      for (const o of setting?.order ?? DEFAULT_ORDER.map((kind) => ({ kind }))) {
        const hits = "object" in o ? accs.filter((x) => x.id === o.object && x.input !== null) : accs.filter((x) => (x.input === null ? x.kind : x.input.kind) === o.kind);
        for (const h of hits) if (h !== D && !order.includes(h) && !NEVER_WITHDRAWN.has(h.input?.kind ?? h.kind)) order.push(h);
      }
      return order;
    };
    const minimum = setting?.minimumDeposit ?? yen(0);
    const shocks = ctx.setting<readonly MarketShock[]>("marketShocks") ?? [];
    // 保険契約（解約返戻金・保障内容一覧・払込保険料の推移）
    const contracts = ctx.list<Pick<InsuranceContractInput, "id" | "template" | "policyholder" | "insured" | "coverages">>("insurance");
    const policies = contracts.map((c) => ({ c, out: ctx.call<InsurancePolicyOutput>("insurance.policy", { object: c.id }) }));
    let cappedNotice = false;
    // 器の年利: 不動産・その他の資産は評価額の増減率（valueGrowth）があればそれ。その他の資産と保険は、資産の配分が無ければ0
    const rateOf = (a: AccountInput, y: number): Rate => {
      if ((a.kind === "realEstate" || a.kind === "otherAsset") && a.valueGrowth !== undefined) return ctx.rate.of(a.valueGrowth);
      if ((a.kind === "insurance" || a.kind === "otherAsset") && a.assetMix === undefined) return RATE_ZERO;
      return accountReturnRate(ctx, a, y);
    };

    for (let y = baseYear; y <= endYear; y++) {
      const jan = monthIndex(y, 1);
      const dec = monthIndex(y, 12);
      const at = ctx.at(jan);
      const months = y === baseYear ? 13 - monthOf(base) : 12;
      for (const x of accs) {
        x.inflow = yen(0);
        x.ret = yen(0);
      }
      // 売った簿価の分の NISA の枠は翌年に復活する
      for (const f of frames.values()) {
        f.used = yen(f.used - f.restore);
        f.usedGrowth = yen(f.usedGrowth - f.restoreGrowth);
        f.restore = yen(0);
        f.restoreGrowth = yen(0);
      }
      // こどもNISA は成人の年から成人の NISA（簿価を成人の枠に数える）
      for (const x of accs) {
        if (x.kind !== "childNisa" || x.owner === null || !adultIn(x.owner, y)) continue;
        x.kind = "nisa";
        const f = frameOf(x.owner);
        f.used = addYen(f.used, x.cost);
      }
      // 1. 積立
      const used = new Map<string, { tsumitate: Yen; growth: Yen; child: Yen }>();
      for (const p of planned.get(y) ?? []) {
        const x = p.acc;
        const owner = x.owner as string;
        let amount = p.amount;
        let row = TRANSFER_ROW[x.kind] ?? null;
        if (x.kind === "nisa" || x.kind === "childNisa") {
          const u = used.get(owner) ?? { tsumitate: yen(0), growth: yen(0), child: yen(0) };
          used.set(owner, u);
          if (x.kind === "childNisa") {
            const annualLimit = at.paramYen(N.childAnnual);
            const lifetime = at.paramYen(N.childLifetime);
            const room = annualLimit === null || lifetime === null ? 0 : Math.min(annualLimit - u.child, lifetime - x.cost);
            amount = yen(Math.max(0, Math.min(amount, room)));
            u.child = addYen(u.child, amount);
            row = "cf.transfer.nisa.child";
          } else {
            const f = frameOf(owner);
            const growth = p.tranche === "growth";
            const annualLimit = at.paramYen(growth ? N.growth : N.tsumitate) ?? yen(0);
            let room = Math.min(annualLimit - (growth ? u.growth : u.tsumitate), (at.paramYen(N.lifetime) ?? 0) - f.used);
            if (growth) room = Math.min(room, (at.paramYen(N.lifetimeGrowth) ?? 0) - f.usedGrowth);
            if (!adultIn(owner, y)) room = 0;
            amount = yen(Math.max(0, Math.min(amount, room)));
            if (growth) {
              u.growth = addYen(u.growth, amount);
              f.usedGrowth = addYen(f.usedGrowth, amount);
              x.growthCost = addYen(x.growthCost, amount);
            } else u.tsumitate = addYen(u.tsumitate, amount);
            f.used = addYen(f.used, amount);
            row = growth ? "cf.transfer.nisa.growth" : "cf.transfer.nisa.tsumitate";
          }
        } else if (x.kind === "legacyNisa" || x.kind === "juniorNisa" || row === null) amount = yen(0);
        if (amount < p.amount) cappedNotice = true;
        if (amount <= 0 || row === null) continue;
        flow(row, p.m, amount, owner, x.id, "plan.cashflow.contribution");
        x.inflow = addYen(x.inflow, amount);
        x.cost = addYen(x.cost, amount);
        D.inflow = yen(D.inflow - amount);
      }
      // 2. その年の収支と、本人が払う iDeCo・企業型DC の掛金
      D.inflow = yen(D.inflow + (net.get(y) ?? 0) - (selfPaid.get(y) ?? 0));
      // 3. 運用益
      for (const x of accs) {
        const opening = x.value;
        const r: Rate = x.input === null ? accountReturnRate(ctx, { kind: x.kind }, y) : rateOf(x.input, y);
        x.ret = annualReturn(ctx, opening, x.inflow, r, months);
        x.value = addYen(addYen(opening, x.inflow), x.ret);
        // ストレステスト: その年の年末に時価を下げる（運用益に含める）
        for (const sh of shocks) {
          if (sh.year !== y || (sh.kinds !== undefined ? !sh.kinds.includes(x.kind as AccountKind) : SHOCK_EXEMPT.has(x.kind)) || x.value <= 0) continue;
          const drop = ctx.money.mulRate(x.value, ctx.rate.of(sh.drop), "conv.investment.return");
          x.value = yen(x.value - drop);
          x.ret = yen(x.ret - drop);
        }
        // 旧NISA・ジュニアNISA の内訳は、期首の時価の割合で年末の時価を分ける
        if (x.lots !== null && x.lots.some((l) => l.value > 0) && opening > 0) {
          const parts = ctx.money.allocate(x.value, x.lots.map((l) => l.value as number), "conv.flow.allocate", "first");
          x.lots.forEach((l, i) => (l.value = parts[i] as Yen));
        }
      }
      // 4. 非課税期間の終わり（年末に時価で課税口座へ）
      for (const x of accs) {
        if (x.lots === null || (x.kind !== "legacyNisa" && x.kind !== "juniorNisa")) continue;
        const keep: Lot[] = [];
        for (const l of x.lots) {
          let last: number;
          if (l.regime === "junior" || x.kind === "juniorNisa") {
            const reach18 = x.owner === null ? jan : reachOf(x.owner, N.junior, jan);
            last = Math.max(l.vintage + (at.paramCount(N.general) ?? 5) - 1, yearOf(reach18));
          } else last = l.vintage + (at.paramCount(l.regime === "tsumitate" ? N.tsumitateYears : N.general) ?? 5) - 1;
          if (last > y) {
            keep.push(l);
            continue;
          }
          const t = taxableOf(x.owner, x);
          t.value = addYen(t.value, l.value);
          t.cost = addYen(t.cost, l.value);
          x.value = yen(x.value - l.value);
          x.cost = yen(x.cost - l.cost > 0 ? x.cost - l.cost : 0);
          flow("cf.transfer.rollover", dec, l.value, x.owner, x.id, "plan.cashflow.rollover");
        }
        x.lots = keep;
      }
      // 5. 取り崩し
      let gainsTax = yen(0);
      let need = yen(minimum - D.value);
      if (need > 0) {
        // 譲渡益の税率（課税口座を売るときだけ読む）
        let rates: [Rate, Rate] | null = null;
        const taxRates = (): [Rate, Rate] => {
          if (rates === null) {
            const recon = at.paramRate(T.recon) ?? RATE_ZERO;
            const defense = at.paramRate(T.defense) ?? RATE_ZERO;
            const itBase = at.paramRate(T.it) ?? RATE_ZERO;
            rates = [ctx.rate.add(itBase, ctx.rate.add(ctx.rate.mul(itBase, recon), ctx.rate.mul(itBase, defense))), at.paramRate(T.rt) ?? RATE_ZERO];
          }
          return rates;
        };
        for (const x of orderOf()) {
          if (need <= 0) break;
          if (x.value <= 0) continue;
          const lock = x.input?.withdrawalLockedUntil;
          if (lock !== undefined && lock !== null && ctx.time.resolve(lock) >= dec) continue;
          // こどもNISA の払い出しは、その年3月31日に12歳である年（12歳に達する日がその年の3月31日以前）から
          if (x.kind === "childNisa" && (x.owner === null || at.paramCount(N.childWithdrawal) === null || reachOf(x.owner, N.childWithdrawal, jan) > monthIndex(y, 3))) continue;
          const taxed = x.kind === "taxable";
          const costOf = (g: Yen) => (g >= x.value ? x.cost : ctx.money.mulRatio(x.cost, g, x.value, "conv.account.cost"));
          const taxOf = (g: Yen): [Yen, Yen] => {
            if (!taxed) return [yen(0), yen(0)];
            const gain = yen(g - costOf(g));
            if (gain <= 0) return [yen(0), yen(0)];
            const [itRate, rtRate] = taxRates();
            return [at.money.mulRate(gain, itRate, T.itRound), at.money.mulRate(gain, rtRate, T.rtRound)];
          };
          const netOf = (g: Yen) => {
            const [a, b] = taxOf(g);
            return g - a - b;
          };
          let g: Yen;
          if (netOf(x.value) <= need) g = x.value;
          else if (!taxed) g = need;
          else {
            // 手取りで足りる最も少ない売る額（二分探索）
            let lo = need as number;
            let hi = x.value as number;
            while (lo < hi) {
              const mid = Math.floor((lo + hi) / 2);
              if (netOf(yen(mid)) >= need) hi = mid;
              else lo = mid + 1;
            }
            g = yen(lo);
          }
          const sold = costOf(g);
          const [it, rt] = taxOf(g);
          if (x.kind === "nisa" && x.owner !== null) {
            const f = frameOf(x.owner);
            const soldGrowth = x.growthCost > 0 ? ctx.money.mulRatio(x.growthCost, sold, x.cost > 0 ? x.cost : 1, "conv.account.cost") : yen(0);
            f.restore = addYen(f.restore, sold);
            f.restoreGrowth = addYen(f.restoreGrowth, soldGrowth);
            x.growthCost = yen(x.growthCost - soldGrowth);
          }
          if (x.lots !== null && x.lots.some((l) => l.value > 0) && x.lots.some((l) => l.cost > 0)) {
            const parts = ctx.money.allocate(yen(x.value - g), x.lots.map((l) => l.value as number), "conv.flow.allocate", "first");
            const costs = ctx.money.allocate(yen(x.cost - sold), x.lots.map((l) => l.cost as number), "conv.flow.allocate", "first");
            x.lots.forEach((l, i) => {
              l.value = parts[i] as Yen;
              l.cost = costs[i] as Yen;
            });
          }
          x.value = yen(x.value - g);
          x.cost = yen(x.cost - sold);
          flow("cf.transfer.withdrawal", dec, g, x.owner, x.id, "plan.cashflow.withdrawal");
          flow("cf.taxSi.incomeTax.capitalGains", dec, it, x.owner, x.id, "plan.cashflow.capitalGainsTax");
          flow("cf.taxSi.residentTax.capitalGains", dec, rt, x.owner, x.id, "plan.cashflow.capitalGainsTax");
          gainsTax = yen(gainsTax + it + rt);
          const proceeds = yen(g - it - rt);
          D.value = addYen(D.value, proceeds);
          need = yen(need - proceeds);
        }
      }
      // 6. 年ごとの行
      const n = yen((net.get(y) ?? 0) - gainsTax);
      let financial = yen(0);
      let returns = yen(0);
      const balanceRow = (kind: string, amount: Yen, owner: string | null, object: string | null) =>
        annual.push({ row: `cf.balance.account.${kind}`, year: y, amount, ...(owner === null ? {} : { member: owner }), ...(object === null ? {} : { object }), formula: "plan.cashflow.account" });
      for (const x of accs) {
        balanceRow(x.kind, x.value, x.owner, x.id);
        if (NOT_FINANCIAL.has(x.kind)) continue;
        financial = addYen(financial, x.value);
        returns = addYen(returns, x.ret);
      }
      for (const [object, ma] of mutualAid) {
        const e = ma.byYear.get(y);
        if (e === undefined) continue;
        balanceRow("smallBusinessMutualAid", e.closing, ma.owner, object);
        financial = addYen(financial, e.closing);
        returns = addYen(returns, e.returns);
      }
      for (const { c, out } of policies) {
        const e = out.years.find((x) => x.year === y);
        if (e !== undefined && e.surrenderValue > 0) balanceRow("insurance", e.surrenderValue, c.policyholder, c.id);
      }
      for (const [object, dc] of dcYears) {
        const e = dc.byYear.get(y);
        if (e === undefined) continue;
        balanceRow(dc.kind, e.closing, dc.owner, object);
        financial = addYen(financial, e.closing);
        returns = addYen(returns, e.returns);
      }
      // 持ち家（housing.valuation の年末の評価額）と車（asset.car）
      for (const h of homes) {
        const v = h.byYear.get(y);
        if (v !== undefined) balanceRow("realEstate", v, h.p.owner, h.p.object);
      }
      for (const c of cars) {
        const v = c.byYear.get(y);
        if (v !== undefined) balanceRow("car", v, c.c.owner, c.c.object);
      }
      for (const { d, out } of debts) {
        const e = out.yearEnd.find((x) => x.year === y);
        if (e === undefined || (e.balance <= 0 && e.unpaidInterest <= 0)) continue;
        const member = (d.debtors.find((x) => x.role === "primary") ?? d.debtors[0])?.member;
        const who = member === undefined ? {} : { member };
        annual.push({ row: d.kind === "mortgage" ? "cf.balance.debt.mortgage" : "cf.balance.debt.other", year: y, amount: e.balance, ...who, object: d.id, formula: "plan.cashflow.debt" });
        if (e.unpaidInterest > 0) annual.push({ row: "cf.balance.debt.unpaidInterest", year: y, amount: e.unpaidInterest, ...who, object: d.id, formula: "plan.cashflow.debt" });
      }
      for (const [owner, f] of frames) {
        annual.push({ row: "cf.balance.nisaFrame", year: y, amount: yen(Math.max(0, (at.paramYen(N.lifetime) ?? 0) - f.used)), member: owner, formula: "plan.cashflow.nisaFrame" });
      }
      annual.push(
        { row: "cf.net", year: y, amount: n, formula: "plan.cashflow.net" },
        { row: "cf.balance.return", year: y, amount: returns, formula: "plan.cashflow.return" },
        { row: "cf.balance.financial", year: y, amount: financial, formula: "plan.cashflow.closing" },
      );
      if (D.value < 0) annual.push({ row: "cf.balance.shortfall", year: y, amount: yen(-D.value), formula: "plan.cashflow.shortfall" });
    }
    if (cappedNotice) ctx.notice("N_LIMIT_APPLIED", ["nisa.annualLimit"]);
    // parts は plan.flows のまま渡し、この部品の出したお金の動き（積立・取り崩し・譲渡益の税・移管）を足す（エンジンが表の集計を部品ごとに使い回す）
    if (reconciled.length > 0) for (const f of reconciled) own.push(f);
    const parts = own.length === 0 ? collected.parts : [...collected.parts, own];
    // 保障内容一覧と払込保険料の推移の材料・贈与税（エンジンが summary に写す）
    const details: CashflowDetails = {};
    if (policies.length > 0) {
      details.insurance = {
        contracts: policies.map(({ c }) => ({
          object: c.id,
          template: c.template,
          policyholder: c.policyholder,
          insured: c.insured,
          coverages: (c.coverages ?? []).map((x) => ({
            id: x.id,
            role: x.role,
            benefit: x.benefit,
            amount: x.amount,
            ...(x.from !== undefined ? { from: formatYm(ctx.time.resolve(x.from)) } : {}),
            ...(x.to !== undefined && x.to !== null ? { to: formatYm(ctx.time.resolve(x.to)) } : {}),
          })),
        })),
        byYear: policies.flatMap(({ c, out }) => out.years.map((e) => ({ year: e.year, object: c.id, premium: e.premium, deathBenefit: e.deathBenefit, surrenderValue: e.surrenderValue }))),
      };
    }
    const gifts: NonNullable<CashflowDetails["gifts"]>[number][] = [];
    for (const m of members) {
      const years = new Set(ctx.call<{ gifts: readonly { ym: string }[] }>("gift.received", { member: m.id }).gifts.map((g) => Number(g.ym.slice(0, 4))));
      for (const gy of [...years].sort((a, b) => a - b)) {
        if (gy < baseYear || gy > endYear) continue;
        const t = ctx.call<GiftTaxOutput>("gift.tax", { member: m.id, year: gy });
        gifts.push({ year: gy, recipient: m.id, amount: t.amount, exempt: t.exempt, calendarTaxable: t.calendarTaxable, settlementTaxable: t.settlementTaxable, tax: t.tax, inCashflow: t.inCashflow });
      }
    }
    if (gifts.length > 0) details.gifts = gifts;
    const hasDetails = details.insurance !== undefined || details.gifts !== undefined;
    return { flows: own.length === 0 ? collected.flows : [...collected.flows, ...own], annual, parts, ...(hasDetails ? { details } : {}) };
  },
});

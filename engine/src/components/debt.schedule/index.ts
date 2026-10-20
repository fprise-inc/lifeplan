// 負債1本の返済（0008 の9。返済は月単位で計算して年に集計する。0003）。住宅ローン・車・奨学金・その他で共通。
// - 元利均等（equalPayment）: 返済額＝残高×月利×(1＋月利)^n÷((1＋月利)^n−1)（月利＝年利÷12。分数のまま計算して conv.loan.payment で1回だけ丸める）。
//   元金均等（equalPrincipal）: 元金＝残高÷回数（conv.loan.payment）、利息は毎月の残高から。利息は残高×年利÷12（conv.loan.interest）
// - 金利の段階（rateSchedule）: その月の金利は、from がその月以前の最後の段（最初の段は借入の月から）。固定・期間選択の段が変わったら、
//   その月から返済額を計算し直す。変動金利（variable）で5年ルール（variableRules.fiveYear）があれば、金利が変わっても返済額は
//   変動の始まりから5年ごと（60回目ごと）にだけ見直し、125%ルール（cap125）があれば前の返済額の1.25倍を上限にする。
//   利息が返済額を超えた分は未払利息として持ち越し（次の返済から先に払う）、最後の回に残高と一緒に払う
// - ボーナス返済（bonusShare）: 借入額のその割合を、ボーナスの月（既定は6月・12月）の年2回の元利均等で返す（半年の利率＝年利÷2）
// - 繰上返済（prepayments）: その月の返済の後に元金に充てる。期間短縮（shortenTerm）は返済額を変えずに回数を減らし、
//   返済額軽減（reducePayment）は回数を変えずに返済額を計算し直す。手数料は fee
// - 借り換え（refinance）: その月から、残高（未払利息を含む）を新しい金利の段階・期間で返す。諸費用は払う（costsFinanced なら新しいローンに含める）
// - 既に借りているローンは balance（balanceAsOf の月の返済の後の残高）から計算する。団信で残高が消える計算は万一の作業で使う（ここは入力まで）
// - 約束の版 1.1: 世帯の負債の物の ID（object）のほかに、ほかの部品が作った負債（loan。車のひな形の自動車ローン・教育ローン・貸与の奨学金）も受ける
// - 約束の版 1.2（改訂4）: 年ごとの利息（interest。計算基準月から。ボーナス返済の分を含む）を任意の欄で添える（住まい以外の不動産の不動産所得。0028）
// - 団信（改訂3。0008 の追記 2026-10-09）: 団信の部品（debt.creditLifeEvents）が返す月の返済の後に、残高（ボーナス返済の分・未払利息を含む）を
//   その割合だけ減らし、残りの回数で返済額を計算し直す（割合が1なら返し終わる）
// - 変動金利の上乗せ（改訂3。ストレステスト）: 前提の loanRateShifts の月から、変動金利（variable）の段の金利に上乗せを足す
import {
  addMonths,
  boxValue,
  defineComponent,
  formatYm,
  monthOf,
  parseYm,
  yearOf,
  yen,
  type CreditLifeOutput,
  type Ctx,
  type DebtInput,
  type DebtScheduleOutput,
  type Flow,
  type MonthIndex,
  type RateStep,
  type VariableRules,
  type Yen,
} from "../../sdk/index.ts";

/** b の n 乗（整数。繰り返しの2乗） */
function powBig(b: bigint, n: number): bigint {
  let result = 1n;
  let x = b;
  let k = n;
  while (k > 0) {
    if (k % 2 === 1) result *= x;
    x *= x;
    k = Math.floor(k / 2);
  }
  return result;
}

/** 元利均等の1回の返済額。期の利率は num/den */
function annuity(ctx: Ctx, balance: Yen, num: bigint, den: bigint, n: number): Yen {
  if (balance <= 0 || n <= 0) return yen(0);
  if (num === 0n) return ctx.money.divInt(balance, n, "conv.loan.payment");
  const q = powBig(den + num, n);
  const d = powBig(den, n);
  return ctx.money.mulRatio(balance, num * q, den * (q - d), "conv.loan.payment");
}

interface Step {
  readonly from: MonthIndex;
  readonly type: RateStep["type"];
  readonly num: bigint;
  readonly den: bigint;
  readonly key: string;
}

const ROWS: Readonly<Record<DebtInput["kind"], string>> = {
  mortgage: "cf.expense.housing.loan",
  car: "cf.expense.debt.car",
  scholarship: "cf.expense.debt.scholarship",
  other: "cf.expense.debt.other",
};

export default defineComponent<{ object: string } | { loan: DebtInput }, DebtScheduleOutput>({
  id: "debt.schedule",
  title: "負債の返済",
  contract: "1.2",
  revision: 4,
  requires: { "debt.creditLifeEvents": ">=1 <2" },
  params: [],
  reads: [
    "assumptions.loanRateShifts",
    "debt.kind",
    "debt.debtors",
    "debt.principal",
    "debt.start",
    "debt.balance",
    "debt.balanceAsOf",
    "debt.rateSchedule",
    "debt.repayment",
    "debt.prepayments",
    "debt.refinance",
  ],
  input: "debt.schedule.input",
  output: "debt.schedule.output",
  compute(input, ctx) {
    const d = "loan" in input ? input.loan : ctx.get<DebtInput>("debt", input.object);
    const { base, end } = ctx.time;
    const member = (d.debtors.find((x) => x.role === "primary") ?? d.debtors[0])?.member;
    const row = ROWS[d.kind];
    const prepayRow = d.kind === "mortgage" ? "cf.expense.housing.loan.prepayment" : row;
    const feeRow = d.kind === "mortgage" ? "cf.expense.housing.loan.fees" : row;
    const start = ctx.time.resolve(d.start);
    // ストレステストの変動金利の上乗せ（月の昇順）
    const shifts = (ctx.setting<readonly { from: string; add: string }[]>("loanRateShifts") ?? []).map((x) => ({ m: parseYm(x.from), add: x.add })).sort((a, b) => a.m - b.m);
    const stepsOf = (s: readonly RateStep[], from: MonthIndex): Step[] => {
      const raw = s
        .map((x) => {
          const at = ctx.time.resolve(x.from);
          return { from: at < from ? from : at, type: x.type, rate: x.rate };
        })
        .sort((a, b) => a.from - b.from);
      if (shifts.length === 0) {
        return raw.map((x) => {
          const f = ctx.rate.fraction(ctx.rate.of(x.rate));
          return { from: x.from, type: x.type, num: f.num, den: f.den, key: `${x.type}|${x.rate}` };
        });
      }
      // 段の始まりと上乗せの始まりで区切り、変動の段には、その月までの上乗せの合計を足す
      const cuts = [...new Set([...raw.map((x) => x.from as number), ...shifts.map((x) => (x.m < from ? from : x.m) as number)])].sort((a, b) => a - b);
      const out: Step[] = [];
      for (const c of cuts) {
        let b = raw[0];
        for (const x of raw) if (x.from <= c) b = x;
        if (b === undefined) continue;
        let r = ctx.rate.of(b.rate);
        if (b.type === "variable") for (const sh of shifts) if (sh.m <= c) r = ctx.rate.add(r, ctx.rate.of(sh.add));
        const f = ctx.rate.fraction(r);
        const key = `${b.type}|${ctx.rate.toString(r)}`;
        if (out.length > 0 && (out[out.length - 1] as Step).key === key) continue;
        out.push({ from: c as MonthIndex, type: b.type, num: f.num, den: f.den, key });
      }
      return out;
    };
    // 団信で残高が消える月と割合（世帯の負債だけ）
    const credit = "loan" in input ? [] : ctx.call<CreditLifeOutput>("debt.creditLifeEvents", { object: input.object }).events.map((e) => ({ m: parseYm(e.month), keep: ctx.rate.sub(ctx.rate.of("1"), ctx.rate.of(e.ratio)) }));
    let steps = stepsOf(d.rateSchedule, start);
    let method = d.repayment.method;
    let rules: VariableRules = d.repayment.variableRules ?? {};
    const bonusMonths = d.repayment.bonusMonths ?? [6, 12];
    const bonusShare = ctx.rate.of(d.repayment.bonusShare ?? "0");
    const stepAt = (m: MonthIndex): Step => {
      let s = steps[0] as Step;
      for (const x of steps) if (x.from <= m) s = x;
      return s;
    };

    // 始まりの残高と残りの回数
    let cur: MonthIndex;
    let total: Yen;
    let n: number;
    const given = d.balance === undefined ? null : boxValue(d.balance);
    if (given !== null && given !== undefined && d.balanceAsOf !== undefined) {
      cur = parseYm(d.balanceAsOf);
      total = given;
      n = d.repayment.termMonths - (cur - start);
    } else {
      cur = start;
      total = d.principal;
      n = d.repayment.termMonths;
    }
    let bonus = ctx.money.mulRate(total, bonusShare, "conv.loan.payment");
    let main = yen(total - bonus);
    let unpaid = yen(0);
    const bonusLeft = (from: MonthIndex, count: number) => {
      let c = 0;
      for (let k = 0; k < count; k++) if (bonusMonths.includes(monthOf(addMonths(from, k)))) c++;
      return c;
    };
    let step = stepAt(addMonths(cur, 1));
    let variableFrom: MonthIndex = step.type === "variable" ? (step.from > start ? step.from : start) : addMonths(cur, 1);
    let principalPart = yen(0);
    let payment = yen(0);
    let bonusPayment = yen(0);
    const reprice = (m: MonthIndex) => {
      if (method === "equalPayment") payment = annuity(ctx, main, step.num, step.den * 12n, n);
      else principalPart = n > 0 ? ctx.money.divInt(main, n, "conv.loan.payment") : main;
      bonusPayment = annuity(ctx, bonus, step.num, step.den * 2n, bonusLeft(m, n));
    };
    reprice(addMonths(cur, 1));

    const flows: Flow[] = [];
    const yearEnd: { year: number; balance: Yen; unpaidInterest: Yen }[] = [];
    let payoff: MonthIndex | null = null;
    // 年ごとの利息（計算基準月から。約束の版 1.2。住まい以外の不動産の不動産所得の必要経費に使う。0028）
    const interestByYear = new Map<number, Yen>();
    const addInterest = (m: MonthIndex, amount: Yen) => {
      if (amount > 0 && m >= base) interestByYear.set(yearOf(m), yen((interestByYear.get(yearOf(m)) ?? 0) + amount));
    };
    const emit = (m: MonthIndex, r: string, amount: Yen, formula: string) => {
      if (amount <= 0 || m < base) return;
      flows.push({ row: r, ym: formatYm(m), amount, accrualYear: yearOf(m), ...(member === undefined ? {} : { member }), object: d.id, formula });
    };
    const prepayments = (d.prepayments ?? []).map((p) => ({ ...p, m: ctx.time.resolve(p.at) }));
    const refinances = (d.refinance ?? []).map((p) => ({ ...p, m: ctx.time.resolve(p.at) }));
    for (let m = addMonths(cur, 1); m <= end && n > 0; m = addMonths(m, 1)) {
      // 借り換え: その月から新しいローン
      const rf = refinances.find((x) => x.m === m);
      if (rf !== undefined) {
        const costs = yen(rf.costs ?? 0);
        main = yen(main + bonus + unpaid + (rf.costsFinanced === true ? costs : 0));
        if (rf.costsFinanced !== true) emit(m, feeRow, costs, "debt.schedule.refinanceCosts");
        bonus = yen(0);
        unpaid = yen(0);
        steps = stepsOf(rf.rateSchedule, m);
        method = rf.method ?? method;
        rules = rf.variableRules ?? {};
        n = rf.termMonths;
        step = stepAt(m);
        variableFrom = m;
        reprice(m);
      }
      // 金利の段階
      const s = stepAt(m);
      if (s !== step) {
        const keepPayment = s.type === "variable" && step.type === "variable" && rules.fiveYear === true;
        if (s.type === "variable" && step.type !== "variable") variableFrom = m;
        step = s;
        if (!keepPayment) reprice(m);
      }
      // 5年ルール: 変動の始まりから60回目ごとに返済額を見直す（125%ルールで上限）
      if (step.type === "variable" && rules.fiveYear === true && m > variableFrom && (m - variableFrom) % 60 === 0) {
        const before = payment;
        const beforeBonus = bonusPayment;
        reprice(m);
        if (rules.cap125 === true && method === "equalPayment") {
          const cap = ctx.money.mulRatio(before, 5, 4, "conv.loan.payment");
          if (payment > cap) payment = cap;
          const capB = ctx.money.mulRatio(beforeBonus, 5, 4, "conv.loan.payment");
          if (bonusPayment > capB) bonusPayment = capB;
        }
      }
      // 毎月の返済
      const interest = ctx.money.mulRatio(main, step.num, step.den * 12n, "conv.loan.interest");
      addInterest(m, interest);
      const due = yen(interest + unpaid);
      let pay: Yen;
      if (n === 1) {
        pay = yen(main + due);
        main = yen(0);
        unpaid = yen(0);
      } else if (method === "equalPayment") {
        if (payment >= due) {
          const principal = payment - due < main ? yen(payment - due) : main;
          pay = yen(principal + due);
          main = yen(main - principal);
          unpaid = yen(0);
        } else {
          pay = payment;
          unpaid = yen(due - payment);
        }
      } else {
        const principal = principalPart < main ? principalPart : main;
        pay = yen(principal + due);
        main = yen(main - principal);
        unpaid = yen(0);
      }
      // ボーナス返済
      if (bonus > 0 && bonusMonths.includes(monthOf(m))) {
        const bi = ctx.money.mulRatio(bonus, step.num, step.den * 2n, "conv.loan.interest");
        addInterest(m, bi);
        const last = bonusLeft(m, n) <= 1;
        const principal = last ? bonus : bonusPayment - bi > 0 ? (bonusPayment - bi < bonus ? yen(bonusPayment - bi) : bonus) : yen(0);
        pay = yen(pay + principal + bi);
        bonus = yen(bonus - principal);
      }
      emit(m, row, pay, method === "equalPayment" ? "debt.schedule.equalPayment" : "debt.schedule.equalPrincipal");
      n--;
      // 繰上返済（その月の返済の後）
      for (const p of prepayments) {
        if (p.m !== m || main <= 0) continue;
        const amount = p.amount < main ? p.amount : main;
        main = yen(main - amount);
        emit(m, prepayRow, amount, `debt.schedule.prepayment.${p.mode}`);
        emit(m, feeRow, yen(p.fee ?? 0), "debt.schedule.prepaymentFee");
        if (main <= 0) {
          n = bonus > 0 ? n : 0;
          continue;
        }
        if (method === "equalPayment") {
          if (p.mode === "reducePayment") payment = annuity(ctx, main, step.num, step.den * 12n, n);
          else {
            // 返済額を変えずに済む最も少ない回数
            let lo = 1;
            let hi = n;
            while (lo < hi) {
              const mid = Math.floor((lo + hi) / 2);
              if (annuity(ctx, main, step.num, step.den * 12n, mid) <= payment) hi = mid;
              else lo = mid + 1;
            }
            n = lo;
          }
        } else if (p.mode === "reducePayment") principalPart = ctx.money.divInt(main, n, "conv.loan.payment");
        else {
          // 元金を変えずに返し終える回数（切り上げ）
          n = ctx.money.divInt(main, principalPart > 0 ? principalPart : 1, "conv.loan.term") as number;
        }
        if (bonus > 0) bonusPayment = annuity(ctx, bonus, step.num, step.den * 2n, bonusLeft(addMonths(m, 1), n));
      }
      // 団信: その月の返済の後に、残高をその割合だけ減らし、残りの回数で返済額を計算し直す
      for (const c of credit) {
        if (c.m !== m) continue;
        main = ctx.money.mulRate(main, c.keep, "conv.loan.payment");
        bonus = ctx.money.mulRate(bonus, c.keep, "conv.loan.payment");
        unpaid = ctx.money.mulRate(unpaid, c.keep, "conv.loan.payment");
        if (main > 0 || bonus > 0) reprice(addMonths(m, 1));
      }
      const done = main <= 0 && bonus <= 0 && unpaid <= 0;
      if (monthOf(m) === 12 || done) {
        const y = yearOf(m);
        const last = yearEnd[yearEnd.length - 1];
        const entry = { year: y, balance: yen(main + bonus), unpaidInterest: unpaid };
        if (last !== undefined && last.year === y) yearEnd[yearEnd.length - 1] = entry;
        else yearEnd.push(entry);
      }
      if (done) {
        payoff = m;
        break;
      }
    }
    const interest = [...interestByYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, amount]) => ({ year, amount }));
    return { flows, yearEnd, firstPayment: formatYm(addMonths(start, 1)), payoff: payoff === null ? null : formatYm(payoff), ...(interest.length > 0 ? { interest } : {}) };
  },
});

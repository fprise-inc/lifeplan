// 介護の費用（6.10。本人・親）: 月額×期間＋一時費用。0008 の追記 2026-10-09 の決定6。
// - 介護保険の対象の費用（serviceMonthly。10割）には自己負担割合（65歳以上は所得で1〜3割、65歳未満は1割）を掛け、高額介護サービス費の
//   上限（月額。制度データ）で止める（介護を受ける人ごとの近似。同じ世帯の2人が同じ月に介護を受けるときの合算はしない）。
// - 判定の年（介護保険法施行令22条の2第1項・第4項2号、22条の2の2第5項・第7項1号）: 所得はサービスの月の前年（1〜7月は前々年）、
//   住民税の非課税はその年度（4〜7月は前年度）。どちらも8月で切り替わる（計算基準年の前々年の所得・計算基準月に払っている住民税の年度より
//   前の年度は持たないので、その年・年度で判定する）
// - 世帯: その月に世帯にいる構成員（生まれる前・加わる前・離れた後・亡くなった後の人は除く）。同居していない親・祖父母
//   （member.support.cohabiting が true でない）は別の世帯で、その人と、同じく同居していない配偶者だけの世帯とみなす
// - 自己負担割合（22条の2第3項〜第7項）: 本人が65歳以上（第1号）で住民税が課税され、本人の合計所得金額が160万円（220万円）以上で、
//   世帯の65歳以上の人全員の「公的年金等の収入金額＋合計所得金額から公的年金等の雑所得を除いた額」の合計が346万円（463万円。
//   世帯にほかに65歳以上の人がいなければ280万円（340万円））以上なら2割（3割）
// - 高額介護サービス費の上限（22条の2の2）: 世帯の全員が住民税非課税なら24,600円（そのうえ本人の年金収入等が基準（80万円。令和7年8月から
//   80万9千円、令和8年8月から82万6,500円）以下なら個人の上限15,000円。同条第9項）。そうでなければ、世帯の65歳以上の人のいずれかの
//   課税所得で44,400円・93,000円・140,100円
// - 保険の対象外の費用（otherMonthly。居住費・食費など）と一時費用（initial）はそのまま
// - 何も入れないときは、統計の既定（master.care.statistics: 月額・期間・一時費用。在宅・施設の別）を保険の対象外の費用として使う（知らせ N_DEFAULT_USED。
//   統計の月額は自己負担の総額なので、自己負担割合・上限は掛けない）。事務所の既定値で「推定で埋めない」にしたとき（0111 の2回目）は、統計を引かず
//   入っていない所を0円（期間は0か月）にして、知らせ N_INPUT_REQUIRED（care.noFill）を出す
// - 額は計算基準年の価格で、伸び方（省略は物価上昇率）で伸ばす。払う人（payer。省略は介護を受ける人）の行に載せる。
//   払う人の万一のときの扱い（onContingency）を当てる。介護休業給付は、働き方の期間の休業（leaveKind: care）で benefit.employment が出す
// 改訂4: 世帯の外の家族（0035 の4）も、同居していなければ別の世帯で判定する
// 改訂5: 介護を受ける人が亡くなった後（離れた後）は出さない。世帯の外の家族の亡くなる見込み・構成員の離れる月（leaves）の月から、
//   万一の想定で介護を受ける人が亡くなるときはその月の翌月から（期間・一時費用が残っていても）。今までは期間の終わりまで出していた
// 改訂6（0164）: 在宅か施設か（place）の省略は在宅の統計の月額にする（前は在宅と施設を合わせた平均。表の行は前から在宅の行で、画面も在宅と見せていた）
// 改訂7（0171）:
// - 所得の指標は、給与所得・公的年金等の雑所得から10万円を引く（令和6年1月の厚生労働省の事務連絡「介護保険制度における所得指標の取扱いについて」。
//   本人の合計所得金額は給与所得と年金の所得の合計から10万円まで、「その他の合計所得金額」は給与所得から10万円まで。sdk の careIncome）
// - 高額介護サービス費の上限の課税所得は、住民税の課税所得（市町村民税の総所得金額等から所得控除をした後の額。22条の2の2第5項）。前は所得税の
//   課税所得で、基礎控除の差（令和7・8年の引き上げ）の分だけ低く判定していた。住民税の決定通知書の額を入れた年度（途中の値が無い）は、
//   所得税の課税所得で近似する。19歳未満の扶養親族の分を引く決まり（同項）は入れない（65歳以上の人の扶養親族に
//   19歳未満の人がいる形はまれ）
// 改訂8（0173）: 払う人が万一の想定で亡くなった月の翌月からは、相続する人（死亡の当時の配偶者。いなければ子を等分）が払う（sdk の inheritFlows）
import {
  inheritFlows,
  addMonths,
  ageMonth,
  boxValue,
  bracketFor,
  careIncome,
  contingencyRatio,
  defineComponent,
  fiscalYearOf,
  formatYm,
  grownByYear,
  isOutside,
  monthIndex,
  monthOf,
  parseYm,
  RATE_ZERO,
  spousesAt,
  yearOf,
  yen,
  type CareExpenseInput,
  type ContingencyEventOutput,
  type ExemptionOutput,
  type Flow,
  type FlowsResult,
  type IncomeTaxOutput,
  type MemberInput,
  type MonthIndex,
  type Rate,
  type RelationInput,
  type ResidentTaxOutput,
  type TotalIncomeOutput,
  type Yen,
} from "../../sdk/index.ts";

const S = {
  monthly: "care.statistics.monthly",
  home: "care.statistics.monthlyHome",
  facility: "care.statistics.monthlyFacility",
  months: "care.statistics.months",
  initial: "care.statistics.initial",
};
const P = {
  firstAge: "socialInsurance.care.secondaryInsuredUntilAge",
  r1: "socialInsurance.care.copay.ratio1",
  r2: "socialInsurance.care.copay.ratio2",
  r3: "socialInsurance.care.copay.ratio3",
  i2: "socialInsurance.care.copay.twoTenths.incomeFrom",
  s2: "socialInsurance.care.copay.twoTenths.pensionSingle",
  c2: "socialInsurance.care.copay.twoTenths.pensionCouple",
  i3: "socialInsurance.care.copay.threeTenths.incomeFrom",
  s3: "socialInsurance.care.copay.threeTenths.pensionSingle",
  c3: "socialInsurance.care.copay.threeTenths.pensionCouple",
  cap: "socialInsurance.care.highCostService.limit",
  capExempt: "socialInsurance.care.highCostService.exemptLimit",
  capPersonal: "socialInsurance.care.highCostService.exemptPersonalLimit",
  personalIncome: "socialInsurance.care.highCostService.exemptPersonalIncomeLimit",
  indicatorDeduction: "socialInsurance.care.incomeIndicator.salaryPensionDeduction",
};

export default defineComponent<Record<string, never>, FlowsResult>({
  id: "care.expense",
  title: "介護の費用（自己負担割合・高額介護サービス費）",
  contract: "1.0",
  revision: 8,
  requires: {
    "contingency.event": ">=1 <2",
    "tax.totalIncome": ">=1 <2",
    "incomeTax.annual": ">=1 <2",
    "residentTax.annual": ">=1 <2",
    "residentTax.exemption": ">=1 <2",
    "pension.oldAge": ">=1 <2",
  },
  params: [...Object.values(S), ...Object.values(P)],
  reads: [
    "member.outside",
    "care.member",
    "care.payer",
    "care.from",
    "care.months",
    "care.place",
    "care.serviceMonthly",
    "care.otherMonthly",
    "care.initial",
    "care.growth",
    "care.onContingency",
    "member.kind",
    "member.birth",
    "member.joins",
    "member.leaves",
    "member.support",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.from",
    "relation.to",
    "assumptions.inflation",
  ],
  input: "empty.input",
  output: "flows.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const flows: Flow[] = [];
    const list = ctx.list<CareExpenseInput>("care");
    if (list.length === 0) return { flows };
    const relations = ctx.list<RelationInput>("relation");
    const members = ctx.list<MemberInput>("member");
    // 同居していない親・祖父母（別の世帯）
    // 世帯の外の家族（0035 の4）も、同居していなければ別の世帯
    const apart = (x: MemberInput) => (isOutside(x) || x.kind === "parent" || x.kind === "grandparent") && x.support?.cohabiting !== true;
    // その月に世帯にいるか（亡くなった人は、亡くなった月の翌月から世帯を離れる）
    const present = (x: MemberInput, m: MonthIndex): boolean => {
      if (ctx.time.resolve({ at: x.birth.birthYearMonth }) > m) return false;
      if (x.joins !== null && ctx.time.resolve(x.joins) > m) return false;
      if (x.leaves !== null && ctx.time.resolve(x.leaves) <= m) return false;
      const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: x.id }).event;
      return ev === null || ev.kind !== "death" || parseYm(ev.month) >= m;
    };
    /** 月 m に member と同じ世帯の構成員（member を含む。ID の順） */
    const householdOf = (member: string, m: MonthIndex): string[] => {
      const me = members.find((x) => x.id === member);
      if (me === undefined) return [member];
      const ids =
        apart(me)
          ? [member, ...spousesAt(ctx, relations, member, m).filter((id) => {
              const x = members.find((y) => y.id === id);
              return x !== undefined && apart(x) && present(x, m);
            })]
          : [member, ...members.filter((x) => x.id !== member && !apart(x) && present(x, m)).map((x) => x.id)];
      return [...new Set(ids)].sort();
    };
    // 自己負担割合と上限（介護を受ける人×判定の年・年度×世帯の顔ぶれと65歳以上の人）
    const cache = new Map<string, { ratio: Rate; cap: Yen | null }>();
    // 公的年金等の収入金額＋（合計所得金額−公的年金等の雑所得）（その年）
    // 給与所得・公的年金等の雑所得から引く額（改訂7）
    const indicatorDeduction = (m: MonthIndex): Yen => {
      const at = ctx.at(m);
      return at.has(P.indicatorDeduction) ? (at.paramYen(P.indicatorDeduction) ?? yen(0)) : yen(0);
    };
    const pensionAndOther = (member: string, year: number, m: MonthIndex): number => {
      const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year });
      let revenue = 0;
      for (const p of ctx.callMonths<{ ym: string; amount: Yen }>("pension.oldAge", { member }, "payments", monthIndex(year, 1), monthIndex(year, 12))) revenue += p.amount;
      return revenue + careIncome(inc, indicatorDeduction(m)).other;
    };
    const ruleOf = (member: string, m: MonthIndex): { ratio: Rate; cap: Yen | null } => {
      const y = yearOf(m);
      const late = monthOf(m) >= 8;
      // 所得は前年（1〜7月は前々年）、住民税の非課税はその年度（4〜7月は前年度。1〜3月はもともと前の年度）。
      // 計算基準年の前々年の所得と、計算基準月に払っている住民税の年度より前の年度は持たないので、それより前にはしない（0003 の追記と同じ）
      const incomeYear = Math.max(late ? y - 1 : y - 2, yearOf(base) - 1);
      const fiscalYear = Math.max(late ? y : y - 1, fiscalYearOf(base));
      const house = householdOf(member, m);
      // 世帯の65歳以上（第1号被保険者）の人
      const firsts = house.filter((id) => ageMonth(ctx, m, P.firstAge, id) <= m);
      const key = `${member}|${incomeYear}|${fiscalYear}|${house.join(",")}|${firsts.join(",")}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const at = ctx.at(m);
      const exempt = (id: string) => ctx.call<ExemptionOutput>("residentTax.exemption", { member: id, fiscalYear }).perCapitaExempt;
      let ratio = at.paramRate(P.r1) ?? RATE_ZERO;
      // 65歳以上（第1号）で住民税が課税される人だけ所得で判定（22条の2第4項2号・第7項2号）
      if (firsts.includes(member) && !exempt(member)) {
        // 本人の合計所得金額（給与所得と年金の所得から10万円を引く。改訂7）
        const total = careIncome(ctx.call<TotalIncomeOutput>("tax.totalIncome", { member, year: incomeYear }), indicatorDeduction(m)).total;
        const measure = firsts.reduce((sum, id) => sum + pensionAndOther(id, incomeYear, m), 0);
        const couple = firsts.length > 1;
        const v = (id: string) => at.paramYen(id) ?? yen(Number.MAX_SAFE_INTEGER);
        if (total >= v(P.i3) && measure >= v(couple ? P.c3 : P.s3)) ratio = at.paramRate(P.r3) ?? ratio;
        else if (total >= v(P.i2) && measure >= v(couple ? P.c2 : P.s2)) ratio = at.paramRate(P.r2) ?? ratio;
      }
      // 高額介護サービス費の上限
      let cap: Yen | null;
      if (house.every(exempt)) {
        // 世帯の全員が住民税非課税（22条の2の2第7項1号）
        cap = at.paramYen(P.capExempt);
        // 個人の上限（15,000円）: 本人の年金収入等が基準以下（同条第9項）
        const personal = at.has(P.capPersonal) ? at.paramYen(P.capPersonal) : null;
        const limit = at.has(P.personalIncome) ? at.paramYen(P.personalIncome) : null;
        if (personal !== null && limit !== null && (cap === null || personal < cap) && pensionAndOther(member, incomeYear, m) <= limit) cap = personal;
      } else {
        // 世帯の65歳以上の人のいずれかの住民税の課税所得（同条第5項・第6項。改訂7）。その所得の年の翌年度の住民税の課税所得を使う。
        // 決定通知書の額を入れた年度（途中の値が無い）は、所得税の課税所得で近似する（所得税の年税額は計算基準年からしか計算しないので、
        // 計算基準年の前年の所得で判定する月は計算基準年の課税所得）
        const table = at.paramBrackets(P.cap);
        const taxYear = Math.max(incomeYear, yearOf(base));
        const taxableOf = (id: string): number => {
          if (incomeYear >= yearOf(base) - 1) {
            const r = ctx.call<ResidentTaxOutput>("residentTax.annual", { member: id, fiscalYear: incomeYear + 1 });
            if (!r.assessed) return r.taxable;
          }
          return ctx.call<IncomeTaxOutput>("incomeTax.annual", { member: id, year: taxYear }).taxable;
        };
        const taxable = firsts.reduce((top, id) => Math.max(top, taxableOf(id)), 0);
        cap = table === null ? null : (bracketFor(table, yen(taxable)).amount ?? null);
      }
      const out = { ratio, cap };
      cache.set(key, out);
      return out;
    };
    const fills = ctx.fillsByEstimate("care");
    for (const c of list) {
      const from = ctx.time.resolve(c.from);
      const at0 = ctx.at(from < base ? base : from);
      const months = c.months ?? (fills ? (at0.paramCount(S.months) ?? 0) : 0);
      const last = addMonths(from, months - 1);
      const service = c.serviceMonthly === undefined ? null : (boxValue(c.serviceMonthly) ?? null);
      let other = c.otherMonthly === undefined ? null : (boxValue(c.otherMonthly) ?? null);
      let initial = c.initial === undefined ? null : (boxValue(c.initial) ?? null);
      if (!fills) {
        // 推定で埋めない（0111 の2回目）: 入っていない所は0円・0か月
        if ((service === null && other === null) || initial === null || c.months === undefined) ctx.notice("N_INPUT_REQUIRED", [c.id, "care.noFill"]);
      } else {
        if (service === null && other === null) {
          // 在宅か施設かの省略は在宅（表の行・画面の既定と同じ。改訂6）
          other = at0.paramYen(c.place === "facility" ? S.facility : S.home);
          ctx.notice("N_DEFAULT_USED", [c.id, "care.otherMonthly"]);
        }
        if (initial === null) {
          initial = at0.paramYen(S.initial);
          ctx.notice("N_DEFAULT_USED", [c.id, "care.initial"]);
        }
        if (c.months === undefined) ctx.notice("N_DEFAULT_USED", [c.id, "care.months"]);
      }
      // 介護を受ける人が亡くなった（離れた）月から出さない（改訂5）
      const cared = members.find((x) => x.id === c.member);
      const caredEv = cared === undefined ? null : ctx.call<ContingencyEventOutput>("contingency.event", { member: cared.id }).event;
      const stops = [
        ...(cared !== undefined && cared.leaves !== null && cared.leaves !== undefined ? [ctx.time.resolve(cared.leaves)] : []),
        ...(caredEv !== null && caredEv.kind === "death" ? [addMonths(parseYm(caredEv.month), 1)] : []),
      ];
      const stop = stops.length === 0 ? null : Math.min(...stops);
      const payer = c.payer ?? c.member;
      const ev = c.onContingency === undefined ? null : ctx.call<ContingencyEventOutput>("contingency.event", { member: payer }).event;
      const row = c.place === "facility" ? "cf.expense.care.facility" : "cf.expense.care.nursing";
      const fy = yearOf(base);
      const ly = yearOf(end);
      const sv = service === null ? null : grownByYear(ctx, ctx.money.mulRatio(service, 12, 1, "conv.exact"), c.growth, fy, ly);
      const ot = other === null ? null : grownByYear(ctx, ctx.money.mulRatio(other, 12, 1, "conv.exact"), c.growth, fy, ly);
      const iv = initial === null ? null : grownByYear(ctx, initial, c.growth, fy, ly);
      const push = (m: MonthIndex, amount: Yen, formula: string) => {
        if (amount <= 0 || m < base || m > end || (stop !== null && m >= stop)) return;
        const cr = contingencyRatio(ctx, c.onContingency, ev, m);
        const a = cr === null ? amount : ctx.money.mulRate(amount, cr, "conv.expense.share");
        if (a > 0) flows.push({ row, ym: formatYm(m), amount: a, accrualYear: yearOf(m), member: payer, object: c.id, formula });
      };
      if (iv !== null) push(from, iv.get(yearOf(from)) ?? initial ?? yen(0), "care.expense.initial");
      for (let m = from; m <= last && m <= end; m = addMonths(m, 1)) {
        if (m < base) continue;
        const k = monthOf(m) - 1;
        if (sv !== null) {
          const monthly = ctx.money.allocate(sv.get(yearOf(m)) ?? yen(0), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.expense.share", "first")[k] as Yen;
          const rule = ruleOf(c.member, m);
          let copay = ctx.at(m).money.mulRate(monthly, rule.ratio, "conv.expense.share");
          if (rule.cap !== null && copay > rule.cap) copay = rule.cap;
          push(m, copay, "care.expense.service");
        }
        if (ot !== null) {
          const monthly = ctx.money.allocate(ot.get(yearOf(m)) ?? yen(0), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.expense.share", "first")[k] as Yen;
          push(m, monthly, "care.expense.other");
        }
      }
    }
    return { flows: inheritFlows(ctx, flows) };
  },
});

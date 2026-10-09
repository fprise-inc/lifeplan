// 遺族年金（6.3）。受け取る構成員ごとに、亡くなった構成員（配偶者・親）の加入の記録から月ごとの額と、偶数月に前2か月分の支払いを出す。
// 亡くなった構成員と月は、万一の想定（contingency.event）か、入力の death（必要保障額の推移で「この月に亡くなったら」を試すとき）で決める。
// - 遺族基礎年金: 子（18歳に達した後の最初の3月31日まで）のある配偶者、または子に。基本額（780,900円×改定率）＋子の加算（2人目まで
//   224,700円×改定率、3人目から74,900円×改定率。子だけが受け取るときは2人目から）。受給の要件（保険料の納付要件）は満たすとみなす
// - 遺族厚生年金: 報酬比例の額（死亡の月までの記録）×3/4。短期要件（死亡の月に厚生年金に入っていた）は厚生年金の月数が300に満たなければ300月とみなし、
//   長期要件（受給資格期間25年以上）は実際の月数。妻は年齢を問わない（死亡の当時30歳未満で子が無ければ5年）。夫は死亡の当時55歳以上で、
//   60歳から（遺族基礎年金を受ける間は60歳前でも）。配偶者が65歳になった後は、自分の老齢厚生年金との調整（報酬比例×1/2＋自分の老齢厚生年金×1/2
//   と遺族厚生年金の多い方から、自分の老齢厚生年金を引いた額。自分の老齢厚生年金を先に受ける）
// - 中高齢寡婦加算: 妻が死亡の当時（子があれば遺族基礎年金が終わったとき）40歳以上で、65歳になるまで、遺族基礎年金を受けない月に、
//   遺族基礎年金の基本額×3/4（100円単位）。長期要件は夫の厚生年金が240月以上のとき。経過的寡婦加算（昭和31年4月1日以前生まれ）は値を持たないので知らせる
// - 寡婦年金（第1号の期間の夫）: 第1号の月数（免除を含む）が10年以上の夫が老齢年金を受けずに亡くなり、婚姻が10年以上の妻に、60歳から65歳になるまで、
//   夫の第1号の期間で計算した老齢基礎年金の額×3/4。死亡一時金: 第1号の月数が36月以上で、遺族基礎年金を受ける人がいないとき。寡婦年金と両方を
//   受けられるときは総額の多い方。第1号の月数は、記録の型によっては第3号の月と区別できないので、厚生年金の月を除いた20〜59歳の月で近似する（知らせ）
// - 2028年4月からの遺族年金の見直し（有期化・子の加算の見直しなど）は作らない。2028年4月以後の死亡の想定には知らせ（N_REFORM_NOT_REFLECTED）を必ず出す
import {
  addMonths,
  ageMonth,
  bracketFor,
  childrenOf,
  defineComponent,
  evenMonthPayments,
  fiscalYearOf,
  fiscalYearStart,
  formatYm,
  monthIndex,
  parseYm,
  rate,
  RATE_ONE,
  RATE_ZERO,
  spousesAt,
  yearOf,
  yen,
  type CategoryOutput,
  type ContingencyEventOutput,
  type Flow,
  type MemberInput,
  type MonthCtx,
  type MonthIndex,
  type PensionOutput,
  type Rate,
  type RecordOutput,
  type RelationInput,
  type RevisionOutput,
  type SurvivorPensionMonth,
  type SurvivorPensionOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  base: "pension.basic.baseAmount",
  fullRound: "pension.basic.fullAmount.rounding",
  round: "pension.amount.rounding",
  payRound: "pension.payment.rounding",
  maxMonths: "pension.basic.maxMonths",
  pre: "pension.employee.accrualRate.pre2003",
  post: "pension.employee.accrualRate.post2003",
  child12: "pension.childSupplement.firstTwoBaseAmount",
  child3: "pension.childSupplement.thirdBaseAmount",
  childAge: "pension.childSupplement.childUntilAge",
  start: "pension.normalStartAge",
  qual: "pension.survivor.longTermMonths",
  ratio: "pension.survivor.employee.ratio",
  deemed: "pension.survivor.employee.deemedMonths",
  addRatio: "pension.survivor.widowAddition.ratio",
  addFrom: "pension.survivor.widowAddition.fromAge",
  addUntil: "pension.survivor.widowAddition.untilAge",
  addLongMonths: "pension.survivor.widowAddition.longTermEmployeeMonths",
  youngAge: "pension.survivor.youngWidowAge",
  youngMonths: "pension.survivor.youngWidowMonths",
  husbandAge: "pension.survivor.husbandMinAge",
  husbandFrom: "pension.survivor.husbandPayFromAge",
  elderlyProp: "pension.survivor.elderly.proportionalRatio",
  elderlyOwn: "pension.survivor.elderly.ownRatio",
  wpRatio: "pension.widowPension.ratio",
  wpMonths: "pension.widowPension.requiredMonths",
  wpMarriage: "pension.widowPension.marriageMonths",
  wpFrom: "pension.widowPension.fromAge",
  wpUntil: "pension.widowPension.untilAge",
  lump: "pension.deathLumpSum",
  lumpMonths: "pension.deathLumpSum.requiredMonths",
};
const SPLIT_2003 = monthIndex(2003, 4);
/** 2028年4月からの遺族年金の見直し（作らない。知らせだけ） */
const REFORM_2028 = monthIndex(2028, 4);
/** 経過的寡婦加算の対象（昭和31年4月1日以前生まれ） */
const TRANSITIONAL_BORN_BEFORE = "1956-04";
const DEN = 1000000000000n;

type Input = { member: string; death?: { member: string; month: string } };

/** 改定率（年度ごと。範囲の外は端の年度） */
function revisionTable(rv: RevisionOutput, series: "rate" | "employee"): (fy: number) => Rate {
  const map = new Map(rv.byFiscalYear.map((x) => [x.fiscalYear, rate(series === "employee" ? x.employee : x.rate)]));
  const first = rv.byFiscalYear[0]?.fiscalYear ?? 0;
  const last = rv.byFiscalYear[rv.byFiscalYear.length - 1]?.fiscalYear ?? 0;
  return (fy) => map.get(fy < first ? first : fy > last ? last : fy) ?? RATE_ONE;
}

export default defineComponent<Input, SurvivorPensionOutput>({
  id: "pension.survivor",
  title: "遺族年金（遺族基礎年金・遺族厚生年金・中高齢寡婦加算・寡婦年金・死亡一時金）",
  contract: "1.0",
  revision: 1,
  requires: {
    "contingency.event": ">=1 <2",
    "pension.record": ">=1 <2",
    "pension.revision": ">=1 <2",
    "pension.category": ">=1 <2",
    "pension.oldAge": ">=1 <2",
  },
  params: Object.values(P),
  reads: ["member.kind", "member.birth", "member.sex", "relation.type", "relation.a", "relation.b", "relation.from", "relation.to", "relation.parent", "relation.child"],
  input: "pension.survivor.input",
  output: "pension.survivor.output",
  compute(input, ctx) {
    const Y = input.member;
    const { base, end } = ctx.time;
    const empty: SurvivorPensionOutput = { flows: [], months: [], deceased: null, death: null, lumpSum: yen(0) };
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    // 亡くなった構成員（配偶者か親）と死亡の月
    let X: string | null = null;
    let D: MonthIndex | null = null;
    if (input.death !== undefined) {
      X = input.death.member;
      D = parseYm(input.death.month);
    } else {
      const candidates = [
        ...relations.flatMap((r) => (r.type === "spouse" && (r.a === Y || r.b === Y) ? [(r.a === Y ? r.b : r.a) as string] : [])),
        ...relations.flatMap((r) => (r.type === "parentOf" && r.child === Y ? [r.parent as string] : [])),
      ];
      // 関係に親が無いときは、子（kind child）から見た本人・配偶者
      const me0 = members.find((m) => m.id === Y);
      if (me0?.kind === "child" && !relations.some((r) => r.type === "parentOf")) for (const m of members) if (m.kind === "self" || m.kind === "spouse") candidates.push(m.id);
      for (const c of [...new Set(candidates)]) {
        const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: c }).event;
        if (ev !== null && ev.kind === "death") {
          X = c;
          D = parseYm(ev.month);
          break;
        }
      }
    }
    if (X === null || D === null) return empty;
    const deceased = X;
    const death = D;
    if (death >= REFORM_2028) ctx.notice("N_REFORM_NOT_REFLECTED", ["survivorPension.reform2028"]);
    const me = members.find((m) => m.id === Y) as MemberInput;
    const dm = members.find((m) => m.id === deceased);
    if (dm === undefined) return empty;
    const isSpouse = spousesAt(ctx, relations, deceased, death).includes(Y);
    const kidsAll = childrenOf(members, relations, deceased).filter((c) => parseYm(c.birth.birthYearMonth) <= addMonths(death, 10));
    const isChild = kidsAll.some((c) => c.id === Y);
    if (!isSpouse && !isChild) return empty;
    // 子だけが受け取るのは、死亡の当時に配偶者がいないとき（いれば配偶者が受け取り、子の分は止まる）
    const hasSpouse = spousesAt(ctx, relations, deceased, death).length > 0;
    if (isChild && hasSpouse) return empty;
    // 受け取る子は、受けられる子のうち最も年上の子（お金の動きはその子に載せる）
    const m0 = death < base ? base : death;
    const at0 = ctx.at(m0);
    const childUntil = new Map(kidsAll.map((c) => [c.id, ageMonth(ctx, m0, P.childAge, c.id)]));
    const kidsAt = (m: MonthIndex) => kidsAll.filter((c) => parseYm(c.birth.birthYearMonth) <= m && m <= (childUntil.get(c.id) as MonthIndex));
    if (isChild) {
      const eldest = [...kidsAll].filter((c) => (childUntil.get(c.id) as MonthIndex) > death).sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? -1 : 1))[0];
      if (eldest === undefined || eldest.id !== Y) return empty;
    }

    // 亡くなった人の記録（死亡の月まで）
    const rec = ctx.call<RecordOutput>("pension.record", { member: deceased });
    const rvX = ctx.call<RevisionOutput>("pension.revision", { member: deceased });
    const rvY = ctx.call<RevisionOutput>("pension.revision", { member: Y });
    const EX = revisionTable(rvX, "employee");
    const RY = revisionTable(rvY, "rate");
    const K = rec.fiscalYear;
    const EK = EX(K);
    const recMonths = rec.months.filter((x) => parseYm(x.month) <= death);
    const futureCount = rec.months.filter((x) => x.basic || x.employee).length;
    const qualifying = rec.qualifyingMonths - futureCount + recMonths.filter((x) => x.basic || x.employee).length;
    const empMonths = rec.employeeMonths + recMonths.filter((x) => x.employee).length;
    const insuredAtDeath = recMonths.some((x) => x.month === formatYm(death) && x.employee);
    const longOk = qualifying >= (at0.paramCount(P.qual) ?? 300);
    const shortTerm = insuredAtDeath;
    const employeeOk = empMonths > 0 && (shortTerm || longOk);
    // 遺族基礎年金の要件: 65歳になる前の死亡（被保険者・60〜64歳の国内居住）か、受給資格期間25年以上
    const basicOk = longOk || death < ageMonth(ctx, m0, P.start, deceased);
    // 報酬比例（記録の年度の水準の分母 10^12 の整数）。記録の額（定期便・通知・見込額）があればそれから
    let num = BigInt(rec.amounts.employee ?? 0) * DEN;
    for (const x of recMonths) {
      if (!x.accrues || x.remuneration <= 0) continue;
      const m = parseYm(x.month);
      const r = at0.paramRate(m < SPLIT_2003 ? P.pre : P.post) ?? RATE_ZERO;
      const deflate = m < base ? RATE_ONE : ctx.rate.div(EK, EX(fiscalYearOf(m)));
      const f = ctx.rate.fraction(ctx.rate.mul(r, deflate));
      num += (BigInt(x.remuneration) * f.num * DEN) / f.den;
    }
    if (shortTerm && empMonths > 0 && empMonths < (at0.paramCount(P.deemed) ?? 300)) {
      num = (num * BigInt(at0.paramCount(P.deemed) ?? 300)) / BigInt(empMonths);
    }
    // 年度ごとの値（年度の初めの月の値）
    const yearCache = new Map<number, { at: MonthCtx; prop: Yen; survivorEmp: Yen; basic: Yen; c12: Yen; c3: Yen; add: Yen }>();
    const yearOfFy = (fy: number) => {
      let v = yearCache.get(fy);
      if (v === undefined) {
        const at = ctx.at(fiscalYearStart(fy));
        const ratioE = ctx.rate.fraction(ctx.rate.div(EX(fy), EK));
        const prop = at.money.mulRatio(yen(1), num * ratioE.num, DEN * ratioE.den, P.round);
        const survivorEmp = at.money.mulRate(prop, at.paramRate(P.ratio) ?? RATE_ZERO, P.round);
        const basic = at.money.mulRate(at.paramYen(P.base) ?? yen(0), RY(fy), P.fullRound);
        const c12 = at.money.mulRate(at.paramYen(P.child12) ?? yen(0), RY(fy), P.fullRound);
        const c3 = at.money.mulRate(at.paramYen(P.child3) ?? yen(0), RY(fy), P.fullRound);
        const add = at.money.mulRate(basic, at.paramRate(P.addRatio) ?? RATE_ZERO, P.fullRound);
        v = { at, prop, survivorEmp, basic, c12, c3, add };
        yearCache.set(fy, v);
      }
      return v;
    };

    const female = me.sex === "female";
    const ageAt = (id: string, years: string) => ageMonth(ctx, m0, years, id);
    // 遺族厚生年金を受ける期間
    const kidsAtDeath = kidsAt(addMonths(death, 1)).length > 0;
    let empFrom: MonthIndex = addMonths(death, 1);
    let empUntil: MonthIndex | null = null;
    if (isSpouse && employeeOk) {
      if (female) {
        if (!kidsAtDeath && death < ageAt(Y, P.youngAge)) empUntil = addMonths(death, at0.paramCount(P.youngMonths) ?? 60);
      } else if (death < ageAt(Y, P.husbandAge)) empFrom = addMonths(end, 1);
      else {
        const from60 = ageAt(Y, P.husbandFrom);
        if (from60 > empFrom) empFrom = from60;
      }
    }
    // 中高齢寡婦加算: 遺族基礎年金が終わった月（子が無ければ死亡の月の翌月）に40歳以上
    const lastKid = kidsAll.length === 0 ? death : kidsAll.reduce((mx, c) => ((childUntil.get(c.id) as MonthIndex) > mx ? (childUntil.get(c.id) as MonthIndex) : mx), death);
    const addStart = isSpouse && basicOk && kidsAtDeath ? addMonths(lastKid, 1) : addMonths(death, 1);
    const addOk =
      isSpouse && female && employeeOk && (shortTerm || empMonths >= (at0.paramCount(P.addLongMonths) ?? 240)) && addMonths(ageAt(Y, P.addFrom), 0) <= addStart;
    const addUntil = ageAt(Y, P.addUntil);
    if (isSpouse && female && employeeOk && me.birth.birthYearMonth <= TRANSITIONAL_BORN_BEFORE) ctx.notice("N_PARAM_MISSING", ["pension.survivor.transitionalWidowAddition", Y]);
    // 65歳からの自分の老齢厚生年金
    const N = ageAt(Y, P.start);
    let own: Map<string, Yen> | null = null;
    const ownAt = (m: MonthIndex): Yen => {
      if (own === null) own = new Map(ctx.call<PensionOutput>("pension.oldAge", { member: Y }).months.map((x) => [x.month, x.employee]));
      return own.get(formatYm(m)) ?? yen(0);
    };

    // 寡婦年金・死亡一時金（第1号の月数）
    const cats = ctx.call<CategoryOutput>("pension.category", { member: deceased }).months;
    const cat1Future = cats.filter((c) => c.category === "1" && parseYm(c.month) <= death && rec.months.some((x) => x.month === c.month)).length;
    const cat1 = Math.max(0, rec.basicMonths - rec.employee2059Months) + cat1Future;
    if (rec.basicMonths - rec.employee2059Months > 0) ctx.notice("N_ESTIMATED", ["pension.survivor.category1Months", deceased]);
    const receivingOldAge = rec.kind === "receiving" || death >= ageAt(deceased, P.start);
    const spouseRel = relations.find((r) => r.type === "spouse" && ((r.a === Y && r.b === deceased) || (r.b === Y && r.a === deceased)));
    const marriedFrom = spouseRel === undefined || spouseRel.type !== "spouse" || spouseRel.from === null ? null : ctx.time.resolve(spouseRel.from);
    const wpOk =
      isSpouse && female && !receivingOldAge && cat1 >= (at0.paramCount(P.wpMonths) ?? 120) && (marriedFrom === null || death - marriedFrom >= (at0.paramCount(P.wpMarriage) ?? 120));
    const wpFrom = ageAt(Y, P.wpFrom) > addMonths(death, 1) ? ageAt(Y, P.wpFrom) : addMonths(death, 1);
    const wpUntil = ageAt(Y, P.wpUntil);
    const maxMonths = at0.paramCount(P.maxMonths) ?? 480;

    const months: SurvivorPensionMonth[] = [];
    let wpTotal = 0;
    const wpMonthsList: SurvivorPensionMonth[] = [];
    const startM = addMonths(death, 1) > base ? addMonths(death, 1) : base;
    for (let m = addMonths(death, 1); m <= end; m = addMonths(m, 1)) {
      const fy = fiscalYearOf(m);
      const v = yearOfFy(fy);
      const kids = kidsAt(m);
      let basic = yen(0);
      if (basicOk && kids.length > 0) {
        // 配偶者が受け取るときは1人目から、子だけが受け取るときは2人目から加算
        let total = v.basic;
        const counted = isSpouse ? kids.length : kids.length - 1;
        for (let k = 0; k < counted; k++) total = yen(total + (k < 2 ? v.c12 : v.c3));
        basic = total;
      }
      let employee = yen(0);
      if (employeeOk && (isChild ? kids.length > 0 : m >= empFrom || (basic > 0 && !female)) && (empUntil === null || m <= empUntil)) {
        employee = v.survivorEmp;
        if (isSpouse && m >= N) {
          const o = ownAt(m);
          const alt = yen(v.at.money.mulRate(v.prop, v.at.paramRate(P.elderlyProp) ?? RATE_ZERO, P.round) + v.at.money.mulRate(o, v.at.paramRate(P.elderlyOwn) ?? RATE_ZERO, P.round));
          const best = alt > employee ? alt : employee;
          employee = best > o ? yen(best - o) : yen(0);
        }
      }
      const widowAddition = addOk && basic === 0 && m >= addStart && m < addUntil ? v.add : yen(0);
      let widowPension = yen(0);
      if (wpOk && basic === 0 && m >= wpFrom && m < wpUntil) {
        const full = v.at.money.mulRatio(v.basic, Math.min(cat1, maxMonths), maxMonths, P.round);
        widowPension = v.at.money.mulRate(full, v.at.paramRate(P.wpRatio) ?? RATE_ZERO, P.round);
        wpTotal += widowPension;
      }
      const row = { month: formatYm(m), basic, employee, widowAddition, widowPension };
      if (widowPension > 0) wpMonthsList.push(row);
      if (basic > 0 || employee > 0 || widowAddition > 0 || widowPension > 0) months.push(row);
    }
    // 死亡一時金（遺族基礎年金を受ける人がいないとき）。寡婦年金と両方なら総額（年額÷12 の月の合計）の多い方
    let lumpSum = yen(0);
    const anyBasic = basicOk && kidsAtDeath;
    if (!anyBasic && !receivingOldAge && cat1 >= (at0.paramCount(P.lumpMonths) ?? 36)) {
      const table = at0.paramBrackets(P.lump);
      const amount = table === null ? yen(0) : (bracketFor(table, yen(cat1)).amount ?? yen(0));
      const wpSum = ctx.money.divInt(yen(wpTotal), 12, "conv.exact");
      if (amount > wpSum) {
        lumpSum = amount;
        for (const r of wpMonthsList) (r as { widowPension: Yen }).widowPension = yen(0);
      }
    }
    const kept = months.filter((r) => r.basic > 0 || r.employee > 0 || r.widowAddition > 0 || r.widowPension > 0);
    const totals = kept.map((r) => ({ month: r.month, amount: yen(r.basic + r.employee + r.widowAddition + r.widowPension) }));
    const flows: Flow[] = [];
    for (const p of evenMonthPayments(ctx, totals, P.payRound)) {
      if (parseYm(p.ym) < startM && parseYm(p.ym) < base) continue;
      flows.push({ row: "cf.income.pension.survivor", ym: p.ym, amount: p.amount, accrualYear: p.accrualYear, member: Y, formula: "pension.survivor.payment" });
    }
    if (lumpSum > 0) {
      const pm = addMonths(death, 2);
      flows.push({ row: "cf.income.lumpSum.other", ym: formatYm(pm), amount: lumpSum, accrualYear: yearOf(pm), member: Y, formula: "pension.survivor.deathLumpSum" });
    }
    return { flows, months: kept, deceased, death: formatYm(death), lumpSum };
  },
});

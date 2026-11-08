// 遺族年金（6.3）。受け取る構成員ごとに、亡くなった構成員（配偶者・親）の加入の記録から月ごとの額と、偶数月に前2か月分の支払いを出す。
// 亡くなった構成員と月は、万一の想定（contingency.event）か、入力の death（必要保障額の推移で「この月に亡くなったら」を試すとき）で決める。
// - 遺族基礎年金: 子（18歳に達した後の最初の3月31日まで）のある配偶者、または子に。基本額（780,900円×改定率）＋子の加算（2人目まで
//   224,700円×改定率、3人目から74,900円×改定率。子だけが受け取るときは2人目から）。受給の要件（保険料の納付要件）は満たすとみなす
// - 遺族厚生年金: 報酬比例の額（死亡の月までの記録）×3/4。短期要件（死亡の月に厚生年金に入っていた）は厚生年金の月数が300に満たなければ300月とみなし、
//   長期要件（受給資格期間25年以上）は実際の月数。妻は年齢を問わない（死亡の当時30歳未満で子が無ければ5年）。夫は死亡の当時55歳以上で、
//   60歳から（遺族基礎年金を受ける間は60歳前でも）。配偶者が65歳になった後は、自分の老齢厚生年金との調整（報酬比例×1/2＋自分の老齢厚生年金×1/2
//   と遺族厚生年金の多い方から、自分の老齢厚生年金を引いた額。自分の老齢厚生年金を先に受ける）
// - 中高齢寡婦加算: 妻が死亡の当時（子があれば遺族基礎年金が終わったとき）40歳以上で、65歳になるまで、遺族基礎年金を受けない月に、
//   遺族基礎年金の基本額×3/4（100円単位）。長期要件は夫の厚生年金が240月以上のとき（夫が昭和26年4月1日以前生まれなら、中高齢者の期間短縮の特例:
//   40歳（女子35歳）以後の厚生年金の月が生年月日ごとの15〜19年以上でもよい。昭和60年改正法附則12条1項4号・61条1項。月数は加入歴から数える）
// - 経過的寡婦加算（妻が昭和31年4月1日以前生まれ。昭和60年改正法附則73条）: 中高齢寡婦加算の要件（年齢を除く）を満たす妻の65歳から（65歳以後に
//   受給権を得たときはその翌月から）、中高齢寡婦加算の額−老齢基礎年金の満額×生年月日ごとの率（附則別表第九。制度データの分子・分母）。
//   65歳からの自分の老齢厚生年金との調整では、遺族厚生年金に含めて調整する（先に自分の老齢厚生年金を受ける）
// - 寡婦年金（第1号の期間の夫）: 第1号の保険料納付済期間と保険料免除期間（学生納付特例・納付猶予を含む）が10年以上の夫が老齢年金を受けずに
//   亡くなり、婚姻が10年以上の妻に、60歳から65歳になるまで、夫の第1号の期間で計算した老齢基礎年金の額（免除の月は27条の割合）×3/4（国民年金法49条・50条）。
//   死亡一時金: 第1号の納付済の月数＋4分の1免除の月数×3/4＋半額免除×1/2＋4分の3免除×1/4（全額免除・学生納付特例・納付猶予は数えない。52条の2・52条の4）が
//   36月以上で、遺族基礎年金を受ける人がいないとき。寡婦年金と両方を受けられるときは総額の多い方。第1号の内訳は加入の記録（加入歴・定期便の category1）から。
//   内訳が無い記録では第3号の月と区別できないので、厚生年金の月を除いた20〜59歳の月を納付済とみなす近似（知らせ）。記録の後の第1号の月は、
//   死亡の月の前月まで数える（49条・52条の2「死亡日の属する月の前月まで」。改訂2）
// - 一人一年金（国民年金法20条・厚生年金保険法38条）: 寡婦年金と遺族厚生年金（＋中高齢寡婦加算）を両方受けられる月は、多い方の一方だけ。
//   死亡一時金と寡婦年金の選択は、寡婦年金を選んで増える総額と比べる。妻が繰上げで老齢基礎年金を受け始めると寡婦年金の受給権は消える
//   （附則9条の2第5項。夫の死亡より前から受けていれば寡婦年金は無い）（改訂3）
// - 受給権の判定（誰が・いつ・どの遺族年金の受給権を得るか）は SDK の survivorBasis（pension.survivorRight と共通）
// - 改訂6（0170）: 死亡の当時55歳未満の夫は遺族厚生年金の受給権が無い（遺族基礎年金を受ける間も出さない）。遺族厚生年金は子が受け取る
//   （配偶者に受給権が無いので止まらない。遺族基礎年金は夫が受け、子の分は止まる）。前は受給権の無い夫に出していた（世帯の合計は同じ）
// - 65歳になる前は、遺族年金（遺族基礎年金・遺族厚生年金・中高齢寡婦加算・寡婦年金）と自分の老齢年金（特別支給の老齢厚生年金・繰上げの
//   老齢基礎年金と老齢厚生年金）を同じ月に受けない（一人一年金。国民年金法20条・附則9条の2の4、厚生年金保険法38条・附則17条）。
//   年額の多い方を選ぶとみなし（知らせ N_ASSUMED）、自分の老齢年金が多ければその月の遺族年金を0に、遺族年金が多ければ自分の老齢年金の額を
//   遺族年金から引く（世帯の受け取りは遺族年金の額。自分の老齢年金は止めずに表に残すので、税・保険料は自分の老齢年金を受ける前提の近似。
//   65歳からの自分の老齢厚生年金との調整と同じ形。改訂4）
// - 寡婦年金と死亡一時金の選択で比べる寡婦年金の総額は、表の外の月（65歳まで）も数える（表の長さで選択を変えない。0003 の追記。改訂5）
// - 中高齢寡婦加算の40歳の判定は、夫の死亡の月（子があれば最後の子が対象でなくなる月）に40歳に達しているか。これまでは払い始めの月（その翌月）と
//   比べていて、その翌月に40歳になる妻にも付いていた（改訂6。0167）
// - 2028年4月からの遺族年金の見直し（有期化・子の加算の見直しなど）は作らない。2028年4月以後の死亡の想定には知らせ（N_REFORM_NOT_REFLECTED）を必ず出す
//   （制度データの行の扱いは 0007 の追記 2026-10-10: 見直し後の値は別の値IDで持ち、この部品が読む値IDの行は見直し前の値のまま続ける）
import {
  addMonths,
  ageMonth,
  bracketFor,
  defineComponent,
  exemptionMonths,
  EXEMPTION_WEIGHT_DENOMINATOR,
  EXEMPTION_WEIGHT_IDS,
  evenMonthPayments,
  fiscalYearOf,
  fiscalYearStart,
  formatYm,
  monthIndex,
  parseYm,
  rate,
  RATE_ONE,
  RATE_ZERO,
  survivorBasis,
  survivorDeath,
  yearOf,
  yen,
  type CategoryOutput,
  type Flow,
  type MemberInput,
  type MonthCtx,
  type MonthIndex,
  type PensionOutput,
  type Rate,
  type RelationInput,
  type RevisionOutput,
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
  lumpQ: "pension.deathLumpSum.exemptionWeight.quarter",
  lumpH: "pension.deathLumpSum.exemptionWeight.half",
  lumpTQ: "pension.deathLumpSum.exemptionWeight.threeQuarters",
  middleMonths: "pension.survivor.middleAgeSpecial.requiredMonths",
  twNum: "pension.survivor.transitionalWidowAddition.numerator",
  twDen: "pension.survivor.transitionalWidowAddition.denominator",
};
const SPLIT_2003 = monthIndex(2003, 4);
/** 2028年4月からの遺族年金の見直し（作らない。知らせだけ） */
const REFORM_2028 = monthIndex(2028, 4);
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
  revision: 6,
  requires: {
    "contingency.event": ">=1 <2",
    "pension.record": ">=1 <2",
    "pension.revision": ">=1 <2",
    "pension.category": ">=1 <2",
    "pension.oldAge": ">=1 <2",
  },
  params: [...Object.values(P), ...Object.values(EXEMPTION_WEIGHT_IDS), EXEMPTION_WEIGHT_DENOMINATOR],
  reads: ["member.kind", "member.birth", "member.sex", "relation.type", "relation.a", "relation.b", "relation.from", "relation.to", "relation.parent", "relation.child"],
  input: "pension.survivor.input",
  output: "pension.survivor.output",
  compute(input, ctx) {
    const Y = input.member;
    const { base, end } = ctx.time;
    const empty: SurvivorPensionOutput = { flows: [], months: [], deceased: null, death: null, lumpSum: yen(0) };
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    // 亡くなった構成員（配偶者か親）と死亡の月・受給権の要件（pension.survivorRight と同じ判定。SDK の survivorBasis）
    const d = survivorDeath(ctx, Y, members, relations, input.death);
    if (d === null) return empty;
    if (d.death >= REFORM_2028) ctx.notice("N_REFORM_NOT_REFLECTED", ["survivorPension.reform2028"]);
    const sb = survivorBasis(ctx, Y, d, members, relations);
    if (sb === null) return empty;
    const { deceased, death, me, isSpouse, isChild, kidsAll, childUntil, m0, rec, recMonths, empMonths, shortTerm, employeeOk, kidsAtDeath, lastKid, empFrom, empUntil, spouseEmployeeRight } = sb;
    // 子が受け取る遺族厚生年金で、遺族基礎年金は配偶者が受けるとき（配偶者が受給権の無い夫。0170）は、子に遺族基礎年金を出さない
    const basicOk = sb.basicOk && sb.basicSuspended !== true;
    const at0 = ctx.at(m0);
    const kidsAt = (m: MonthIndex) => kidsAll.filter((c) => parseYm(c.birth.birthYearMonth) <= m && m <= (childUntil.get(c.id) as MonthIndex));

    // 亡くなった人の記録（死亡の月まで）
    const rvX = ctx.call<RevisionOutput>("pension.revision", { member: deceased });
    const rvY = ctx.call<RevisionOutput>("pension.revision", { member: Y });
    const EX = revisionTable(rvX, "employee");
    const RY = revisionTable(rvY, "rate");
    const K = rec.fiscalYear;
    const EK = EX(K);
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
    // 中高齢寡婦加算: 払い始めは遺族基礎年金が終わった翌月（子が無ければ死亡の月の翌月）。40歳の判定は、夫の死亡の当時（死亡の月）か、
    // 子があれば40歳に達した当時に遺族基礎年金の対象の子がいたか（最後の子が対象でなくなる月まで）（厚生年金保険法62条1項。改訂6）。
    // 40歳に達した月がその月と同じなら、日の前後が分からないので達していたとみなす
    const addStart = isSpouse && basicOk && kidsAtDeath ? addMonths(lastKid, 1) : addMonths(death, 1);
    const addJudged = isSpouse && kidsAtDeath ? lastKid : death;
    // 中高齢者の期間短縮の特例（夫の生年月日で必要な月数。制度データに行の無い生年月日は特例なし）
    let middleOk = false;
    if (!shortTerm && at0.has(P.middleMonths, { member: deceased })) {
      const need = at0.paramCount(P.middleMonths, { member: deceased });
      if (need !== null) {
        if (rec.employeeFromMiddleAge === undefined) ctx.notice("N_INPUT_REQUIRED", ["pension.survivor.middleAgeSpecial", deceased]);
        else {
          // 記録の後の厚生年金の月は、40歳（女子35歳）以後とみなす（記録の後に40歳になる人は特例の生年月日に当たらない）
          const after = recMonths.filter((x) => x.employee).length;
          middleOk = rec.employeeFromMiddleAge + after >= need;
        }
      }
    }
    const longEmpOk = shortTerm || empMonths >= (at0.paramCount(P.addLongMonths) ?? 240) || middleOk;
    const addOk = isSpouse && female && employeeOk && longEmpOk && ageAt(Y, P.addFrom) <= addJudged;
    const addUntil = ageAt(Y, P.addUntil);
    // 経過的寡婦加算（妻の生年月日の率。行の無い生年月日（昭和31年4月2日以後）は無い）
    // 受給権を得たとき65歳以上、または中高齢寡婦加算を受けていた妻（昭和60年改正法附則73条）
    const twOk = isSpouse && female && employeeOk && longEmpOk && (addOk || addMonths(death, 1) >= addUntil) && at0.has(P.twNum, { member: Y }) && at0.paramCount(P.twNum, { member: Y }) !== null;
    const twNum = twOk ? (at0.paramCount(P.twNum, { member: Y }) ?? 0) : 0;
    const twDen = twOk ? (at0.paramCount(P.twDen, { member: Y }) ?? 1) : 1;
    // 65歳からの自分の老齢厚生年金
    const N = ageAt(Y, P.start);
    let own: PensionOutput["months"] | null = null;
    let ownEmp: Map<string, Yen> | null = null;
    const ownMonths = () => (own ??= ctx.call<PensionOutput>("pension.oldAge", { member: Y }).months);
    const ownAt = (m: MonthIndex): Yen => {
      ownEmp ??= new Map(ownMonths().map((x) => [x.month, x.employee]));
      return ownEmp.get(formatYm(m)) ?? yen(0);
    };

    // 寡婦年金・死亡一時金（第1号の月数）
    const cats = ctx.call<CategoryOutput>("pension.category", { member: deceased }).months;
    const cat1Future = cats.filter((c) => c.category === "1" && parseYm(c.month) < death && rec.months.some((x) => x.month === c.month)).length;
    const k1 = rec.category1;
    const known = k1 !== undefined && k1.known;
    const cat1Paid = (known ? k1.paid : Math.max(0, rec.basicMonths - rec.employee2059Months)) + cat1Future;
    if (!known && rec.basicMonths - rec.employee2059Months > 0) ctx.notice("N_ESTIMATED", ["pension.survivor.category1Months", deceased]);
    const exQ = known ? k1.exemptQuarter : 0;
    const exH = known ? k1.exemptHalf : 0;
    const exTQ = known ? k1.exemptThreeQuarters : 0;
    const exF = known ? k1.exemptFull : 0;
    const deferred = known ? k1.deferred : 0;
    /** 月数＋Σ 月数×率 を分数で（率は制度データ） */
    const weighted = (base0: number, parts: readonly [string, number][]): { num: bigint; den: bigint } => {
      let num = BigInt(base0);
      let den = 1n;
      for (const [id, n] of parts) {
        if (n <= 0) continue;
        const f = ctx.rate.fraction(at0.paramRate(id) ?? RATE_ZERO);
        num = num * f.den + BigInt(n) * f.num * den;
        den = den * f.den;
      }
      return { num, den };
    };
    // 死亡一時金の月数（52条の2）
    const lumpW = weighted(cat1Paid, [[P.lumpQ, exQ], [P.lumpH, exH], [P.lumpTQ, exTQ]]);
    const lumpMonthsN = Number(lumpW.num / lumpW.den);
    // 寡婦年金の要件の月数（49条: 納付済＋免除。学生納付特例・納付猶予だけの夫は除く）と額の月数（27条の割合）
    const cat1 = cat1Paid + exQ + exH + exTQ + exF + deferred;
    const wpMonthsOk = cat1Paid + exQ + exH + exTQ + exF > 0;
    // 寡婦年金の額の月数（27条の割合。免除の月で割合が違う）
    const wpEx = known ? exemptionMonths(ctx, k1) : { num: 0n, den: 1n };
    const wpAmountW = { num: BigInt(cat1Paid) * wpEx.den + wpEx.num, den: wpEx.den };
    const receivingOldAge = rec.kind === "receiving" || death >= ageAt(deceased, P.start);
    const spouseRel = relations.find((r) => r.type === "spouse" && ((r.a === Y && r.b === deceased) || (r.b === Y && r.a === deceased)));
    const marriedFrom = spouseRel === undefined || spouseRel.type !== "spouse" || spouseRel.from === null ? null : ctx.time.resolve(spouseRel.from);
    let wpOk =
      isSpouse && female && !receivingOldAge && wpMonthsOk && cat1 >= (at0.paramCount(P.wpMonths) ?? 120) && (marriedFrom === null || death - marriedFrom >= (at0.paramCount(P.wpMarriage) ?? 120));
    // 妻の繰上げ（65歳になる前に老齢基礎年金を受け始める月）: 寡婦年金の受給権はその請求で消える（国民年金法附則9条の2第5項。消えた月まで支給）。
    // 夫の死亡より前から受けていれば、寡婦年金は無い
    let wpEnd: MonthIndex | null = null;
    if (wpOk) {
      const early = ownMonths().find((x) => x.basic > 0 && parseYm(x.month) < N);
      if (early !== undefined) {
        wpEnd = parseYm(early.month);
        if (wpEnd <= death) wpOk = false;
      }
    }
    const wpFrom = ageAt(Y, P.wpFrom) > addMonths(death, 1) ? ageAt(Y, P.wpFrom) : addMonths(death, 1);
    const wpUntil = ageAt(Y, P.wpUntil);
    const maxMonths = at0.paramCount(P.maxMonths) ?? 480;

    type Row = { month: string; basic: Yen; employee: Yen; widowAddition: Yen; widowPension: Yen };
    const months: Row[] = [];
    // 寡婦年金を受けられる月（額は選ぶ前。寡婦年金と遺族厚生年金・中高齢寡婦加算は同じ月に受けず、どちらかを選ぶ（一人一年金。国民年金法20条））
    const wpRows: { row: Row; wp: Yen }[] = [];
    const startM = addMonths(death, 1) > base ? addMonths(death, 1) : base;
    // 寡婦年金と死亡一時金の選択は、寡婦年金を受けられる期間（65歳まで）の総額で比べるので、表の外の月も数える（改訂5。表の行には入れない）
    const wpLast = wpOk ? addMonths(wpEnd !== null && wpEnd < wpUntil ? wpEnd : wpUntil, -1) : end;
    const loopEnd = wpLast > end ? wpLast : end;
    for (let m = addMonths(death, 1); m <= loopEnd; m = addMonths(m, 1)) {
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
      let transitional = yen(0);
      // 夫は遺族基礎年金を受ける間は60歳前でも受ける（受給権のある夫だけ。死亡の当時55歳未満の夫は受給権が無く、子が受け取る。0170）
      if (employeeOk && (isChild ? kids.length > 0 : m >= empFrom || (basic > 0 && !female && spouseEmployeeRight)) && (empUntil === null || m <= empUntil)) {
        employee = v.survivorEmp;
        // 経過的寡婦加算（65歳から。遺族基礎年金を受けない月）
        if (twOk && m >= addUntil && basic === 0) {
          const minus = v.at.money.mulRatio(v.basic, twNum, twDen, P.round);
          transitional = v.add > minus ? yen(v.add - minus) : yen(0);
        }
        if (isSpouse && m >= N) {
          const o = ownAt(m);
          const alt = yen(v.at.money.mulRate(v.prop, v.at.paramRate(P.elderlyProp) ?? RATE_ZERO, P.round) + v.at.money.mulRate(o, v.at.paramRate(P.elderlyOwn) ?? RATE_ZERO, P.round));
          const best = yen((alt > employee ? alt : employee) + transitional);
          const paid = best > o ? yen(best - o) : yen(0);
          // 調整の後の額のうち、経過的寡婦加算の分（加算を先に残す）
          transitional = paid < transitional ? paid : transitional;
          employee = yen(paid - transitional);
        }
      }
      const widowAddition = addOk && basic === 0 && m >= addStart && m < addUntil ? v.add : transitional;
      let wp = yen(0);
      if (wpOk && basic === 0 && m >= wpFrom && m < wpUntil && (wpEnd === null || m < wpEnd)) {
        const capped = wpAmountW.num > BigInt(maxMonths) * wpAmountW.den ? BigInt(maxMonths) * wpAmountW.den : wpAmountW.num;
        const full = v.at.money.mulRatio(v.basic, capped, wpAmountW.den * BigInt(maxMonths), P.round);
        wp = v.at.money.mulRate(full, v.at.paramRate(P.wpRatio) ?? RATE_ZERO, P.round);
      }
      const row: Row = { month: formatYm(m), basic, employee, widowAddition, widowPension: yen(0) };
      if (wp > 0) wpRows.push({ row, wp });
      if (m <= end && (basic > 0 || employee > 0 || widowAddition > 0 || wp > 0)) months.push(row);
    }
    // 寡婦年金を選んだときに増える額（寡婦年金が遺族厚生年金＋中高齢寡婦加算より多い月の差。年額の合計）
    let gain = 0;
    for (const r of wpRows) {
      const other = r.row.employee + r.row.widowAddition;
      if (r.wp > other) gain += r.wp - other;
    }
    // 死亡一時金（遺族基礎年金を受ける人がいないとき）。寡婦年金と両方を受けられるときはどちらかを選ぶ（52条の6）: 寡婦年金を選んで増える総額
    // （年額÷12 の月の合計）より死亡一時金が多ければ、死亡一時金を受けて寡婦年金は受けない
    let lumpSum = yen(0);
    const anyBasic = basicOk && kidsAtDeath;
    if (!anyBasic && !receivingOldAge && lumpW.num >= BigInt(at0.paramCount(P.lumpMonths) ?? 36) * lumpW.den) {
      const table = at0.paramBrackets(P.lump);
      const amount = table === null ? yen(0) : (bracketFor(table, yen(lumpMonthsN)).amount ?? yen(0));
      if (amount > ctx.money.divInt(yen(gain), 12, "conv.exact")) lumpSum = amount;
    }
    // 寡婦年金を受けるなら、寡婦年金の方が多い月だけ寡婦年金を選び、その月の遺族厚生年金・中高齢寡婦加算は受けない
    if (lumpSum === 0) {
      for (const r of wpRows) {
        if (r.wp <= r.row.employee + r.row.widowAddition) continue;
        r.row.widowPension = r.wp;
        r.row.employee = yen(0);
        r.row.widowAddition = yen(0);
      }
    }
    // 65歳になる前の、遺族年金と自分の老齢年金の選択（多い方。一人一年金）
    let ownTotals: Map<string, number> | null = null;
    let chose = false;
    for (const r of months) {
      if (parseYm(r.month) >= N) break;
      ownTotals ??= new Map(ownMonths().map((x) => [x.month, x.basic + x.employee + x.special]));
      const o = ownTotals.get(r.month) ?? 0;
      const sv = r.basic + r.employee + r.widowAddition + r.widowPension;
      if (o <= 0 || sv <= 0) continue;
      chose = true;
      // 自分の老齢年金の額を、遺族厚生年金 → 中高齢寡婦加算 → 寡婦年金 → 遺族基礎年金 の順に引く（多ければ全部0）
      let cut = o;
      for (const k of ["employee", "widowAddition", "widowPension", "basic"] as const) {
        const take = Math.min(cut, r[k]);
        r[k] = yen(r[k] - take);
        cut -= take;
      }
    }
    if (chose) ctx.notice("N_ASSUMED", ["pension.survivor.ownPensionBefore65", Y]);
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

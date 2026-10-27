// 老齢年金（老齢基礎年金・老齢厚生年金・特別支給の老齢厚生年金）の月ごとの額（障害年金と選ぶ前）。支払いとお金の動きは pension.oldAge が、
// 障害の想定で65歳から障害年金と選ぶときの調整をした後に作る（2026-10-10 に pension.oldAge から分けた。計算は改訂5のまま）
// - 老齢基礎年金: 満額（基準額×改定率を100円単位）×納付月数/480。記録に額があればその額×改定率の比。振替加算を足す
// - 老齢厚生年金: 報酬比例（報酬×乗率。記録の後の報酬は改定率で記録の年度の水準に直す）＋経過的加算（定額部分−基礎年金の相当額）＋加給年金
// - 基礎と厚生を別々に繰上げ・繰下げ（減額率・増額率は生年月日で決まる）。加給年金・振替加算は増額しない
// - 在職老齢年金: 厚生年金に入る月は（基本月額＋総報酬月額相当額−支給停止調整額）÷2 を止める。全部止まる月は加給年金も止める
// - 在職定時改定（65歳から、8月までの加入を10月分から）と退職改定（資格を失った月の翌月から）で、記録の後の加入を足す
// - 万一の想定で亡くなる構成員は、死亡の月の分まで（受給権は死亡で消え、その月の分までが支給される。改訂5）
// 改訂3（受給権の時期・改正・選択の決まり）:
// - 配偶者の加給年金は、配偶者が厚生年金240月以上の老齢厚生年金の受給権を持つ月から止める（pension.employeeMonths の longFrom。厚生年金保険法46条6項）
// - 令和10年4月以後に配偶者の加給年金の要件を満たした人は、配偶者 202,200円×改定率・特別加算 149,200円×改定率（令和7年法律第74号附則12条4項。
//   それより前に加算された人は従前の額が続く）
// - 在職老齢年金の支給停止調整額は毎年度、名目賃金変動率で改定される（46条3項）。制度データの後の年度は、値のある最後の年度の額に賃金上昇率（前提。
//   年度の前の年。pension.revision と同じ）を掛けて1万円単位に四捨五入する（知らせ N_PARAM_PROJECTED）
// - 繰下げ: 66歳に達する前に遺族年金の受給権を得ると繰り下げられず、66歳の後に得るとその日に申出があったとみなす（国民年金法28条・厚生年金保険法44条の3。
//   pension.survivorRight）。遺族年金は死亡の翌月から受けるとみなすので、令和10年4月からの44条の4（遺族厚生年金を請求する前の繰下げ）は当てはまらない。
//   老齢基礎年金は、令和10年4月から遺族厚生年金の受給権では止まらない（その日に65歳以上で受給権があった人は従前。令和7年法律第74号附則5条）
// - 繰上げは老齢基礎年金と老齢厚生年金を同時に請求する（国民年金法附則9条の2第2項）: 片方だけ早めた入力は、早い方の月にそろえて知らせる（N_ASSUMED）
// - 障害の想定の法定免除の月（第1号で障害基礎年金1・2級を受ける月。国民年金法89条）は、老齢基礎年金の額では全額免除の月（2009年4月以後は1/2）。
//   額で入れた記録（見込額・定期便）は60歳まで納める前提の額なので、法定免除の月の（1−割合）の分を満額から按分して引く
// 改訂5: 受給資格期間に足りない知らせは、働き方（勤め先の期間）も加入の記録も入れていない子には出さない（額は変えない）
import {
  addMonths,
  ageMonth,
  defineComponent,
  exemptionMonths,
  EXEMPTION_WEIGHT_DENOMINATOR,
  EXEMPTION_WEIGHT_IDS,
  fiscalYearOf,
  fiscalYearStart,
  formatYm,
  legalExemptionWindow,
  monthIndex,
  monthOf,
  oldAgeClaimMonths,
  claimInput,
  parseYm,
  rate,
  RATE_ONE,
  RATE_ZERO,
  specialOldAgeStart,
  yearOf,
  yen,
  type CategoryOutput,
  type ContingencyEventOutput,
  type CoverageOutput,
  type Ctx,
  type MonthCtx,
  type SegmentOptions,
  type EmploymentPeriodInput,
  type MemberInput,
  type MonthIndex,
  type PensionMonth,
  type PensionRecordInput,
  type Rate,
  type RecordOutput,
  type RelationInput,
  type RevisionOutput,
  type SurvivorRightOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  base: "pension.basic.baseAmount",
  fullRound: "pension.basic.fullAmount.rounding",
  round: "pension.amount.rounding",
  maxMonths: "pension.basic.maxMonths",
  pre: "pension.employee.accrualRate.pre2003",
  post: "pension.employee.accrualRate.post2003",
  flat: "pension.employee.flatRate.baseAmount",
  flatMax: "pension.employee.flatRate.maxMonths",
  start: "pension.normalStartAge",
  inc: "pension.deferral.increaseRate",
  defMax: "pension.deferral.maxMonths",
  red: "pension.earlyClaim.reductionRate",
  earlyMax: "pension.earlyClaim.maxMonths",
  qual: "pension.qualifyingMonths",
  supMonths: "pension.spouseSupplement.requiredMonths",
  supBase: "pension.spouseSupplement.baseAmount",
  supSpecial: "pension.spouseSupplement.specialAddition",
  spouseAge: "pension.spouseSupplement.spouseUntilAge",
  child12: "pension.childSupplement.firstTwoBaseAmount",
  child3: "pension.childSupplement.thirdBaseAmount",
  childAge: "pension.childSupplement.childUntilAge",
  childMonths: "pension.childSupplement.requiredMonths",
  basicChild: "pension.basic.childAddition.baseAmount",
  basicChildFull: "pension.basic.childAddition.fullMonths",
  transfer: "pension.transferAddition.coefficient",
  transferBase: "pension.transferAddition.baseAmount",
  specialAge: "pension.specialOldAge.startAge",
  specialMonths: "pension.specialOldAge.requiredMonths",
  work: "pension.workingAdjustment.threshold",
  workRound: "pension.workingAdjustment.threshold.rounding",
  supBase2028: "pension.spouseSupplement.reform2028.baseAmount",
  supSpecial2028: "pension.spouseSupplement.reform2028.specialAddition",
};
const SPLIT_2003 = monthIndex(2003, 4);
/** 令和7年法律第74号の令和10年4月1日施行の改正（配偶者の加給年金額・繰下げ） */
const REFORM_2028 = monthIndex(2028, 4);
const DEN = 1000000000000n;

type Out = { months: PensionMonth[] };

/** 改定率（年度ごと）を引く。範囲の外は端の年度の値。employee は報酬比例の系列、newAward は新規裁定者の改定率（無ければ本人の率） */
function revisionTable(rv: RevisionOutput, series: "rate" | "employee" | "newAward"): (fy: number) => Rate {
  const map = new Map(rv.byFiscalYear.map((x) => [x.fiscalYear, rate(series === "employee" ? x.employee : series === "newAward" ? (x.newAward ?? x.rate) : x.rate)]));
  const first = rv.byFiscalYear[0]?.fiscalYear ?? 0;
  const last = rv.byFiscalYear[rv.byFiscalYear.length - 1]?.fiscalYear ?? 0;
  return (fy) => map.get(fy < first ? first : fy > last ? last : fy) ?? RATE_ONE;
}

/** 昇順の配列で、key より小さい要素の数（二分探索） */
function countBelow(xs: readonly number[], key: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((xs[mid] as number) < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 記録の厚生年金の月数（初めの値＋記録の後の月。before より前だけ）。記録の月は昇順 */
function employeeMonthsOf(rec: RecordOutput, before: MonthIndex | null, cache: Map<RecordOutput, MonthIndex[]>): number {
  let months = cache.get(rec);
  if (months === undefined) {
    months = rec.months.filter((x) => x.employee).map((x) => parseYm(x.month));
    cache.set(rec, months);
  }
  return rec.employeeMonths + (before === null ? months.length : countBelow(months, before));
}

function claimFactor(ctx: Ctx, at: MonthIndex, member: string, d: number): Rate {
  const m = ctx.at(at);
  if (d > 0) {
    const max = m.paramCount(P.defMax, { member }) ?? 0;
    return ctx.rate.add(RATE_ONE, ctx.rate.mulInt(m.paramRate(P.inc) ?? RATE_ZERO, Math.min(d, max)));
  }
  if (d < 0) {
    const max = m.paramCount(P.earlyMax) ?? 0;
    return ctx.rate.sub(RATE_ONE, ctx.rate.mulInt(m.paramRate(P.red, { member }) ?? RATE_ZERO, Math.min(-d, max)));
  }
  return RATE_ONE;
}

export default defineComponent<{ member: string }, Out>({
  id: "pension.oldAgeBase",
  title: "老齢年金の月ごとの額（障害年金と選ぶ前）",
  contract: "1.1",
  revision: 5,
  requires: {
    "pension.record": ">=1 <2",
    "pension.revision": ">=1 <2",
    "socialInsurance.coverage": ">=1 <2",
    "pension.employeeMonths": ">=1 <2",
    "contingency.event": ">=1 <2",
    "pension.survivorRight": ">=1 <2",
    "pension.category": ">=1 <2",
  },
  params: [...Object.values(P), ...Object.values(EXEMPTION_WEIGHT_IDS), EXEMPTION_WEIGHT_DENOMINATOR],
  reads: [
    "member.kind",
    "member.birth",
    "member.joins",
    "member.leaves",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
    "pensionRecord.member",
    "pensionRecord.claim",
    "member.pensionClaim",
    "employment.member",
    "assumptions.wageGrowth",
  ],
  memberScope: ["pensionRecord", "employment"],
  input: "member.input",
  output: "pension.oldAgeBase.output",
  compute(input, ctx) {
    const member = input.member;
    const { base, end } = ctx.time;
    const monthCache = new Map<RecordOutput, MonthIndex[]>();
    const empty: Out = { months: [] };
    // 表の最後までに繰上げの最も早い月（65歳の60か月前）も来ず、受給中の記録も無ければ計算しない
    const input0 = ctx.list<PensionRecordInput>("pensionRecord").find((r) => r.member === member);
    const N = ageMonth(ctx, base, P.start, member);
    if (addMonths(N, -60) > end && input0?.kind !== "receiving") return empty;
    // 万一の想定で亡くなる月（その月の分まで支給）
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member }).event;
    const lastMonth = ev !== null && ev.kind === "death" ? parseYm(ev.month) : null;
    const rec = ctx.call<RecordOutput>("pension.record", { member });
    const rv = ctx.call<RevisionOutput>("pension.revision", { member });
    const R = revisionTable(rv, "rate");
    const E = revisionTable(rv, "employee");
    // 加給年金額・配偶者の特別加算（子の加算を含む）は新規裁定者の改定率（厚生年金保険法44条2項・昭和60年改正法附則60条2項）
    const NA = revisionTable(rv, "newAward");
    const K = rec.fiscalYear;
    const RK = R(K);
    const EK = E(K);
    // 年度ごとの比は使い回す（月ごとに同じ割り算をしない）
    const memo = <K, V>(f: (k: K) => V): ((k: K) => V) => {
      const m = new Map<K, V>();
      return (k) => {
        if (m.has(k)) return m.get(k) as V;
        const v = f(k);
        m.set(k, v);
        return v;
      };
    };
    const ratioTo = memo((fy: number) => ctx.rate.div(R(fy), RK));
    const ratioE = memo((fy: number) => ctx.rate.div(E(fy), EK));
    const at0 = ctx.at(base);
    // 受給資格期間: 見込額だけ・受給中の記録で月数を入れていないときは、資格があるとみなす
    const monthsGiven = input0?.months !== undefined || (rec.kind !== "projection" && rec.kind !== "receiving");
    if (monthsGiven && rec.qualifyingMonths < (at0.paramCount(P.qual) ?? 0)) {
      // 働き方も加入の記録も入れていない子は、表の中の加入の月（20歳から世帯を離れるまでの第1号など）が足りないだけなので知らせない（改訂5。額は同じ0円）
      const kind = ctx.list<MemberInput>("member").find((m) => m.id === member)?.kind;
      const noInput = input0 === undefined && ctx.list<EmploymentPeriodInput>("employment").length === 0;
      if (!(kind === "child" && noInput)) ctx.notice("N_NOT_ENTITLED", ["pension.qualifyingMonths", member]);
      return empty;
    }
    const receiving = rec.kind === "receiving";
    const S0 = monthIndex(yearOf(base) - 2, 1);
    // 特別支給の老齢厚生年金（生年月日・性別で開始年齢。対象でない生年月日は notApplicable）
    const SA = specialOldAgeStart(ctx, at0, rec, member, N);
    let CB: MonthIndex = S0;
    let CE: MonthIndex = S0;
    if (!receiving) {
      // 繰上げは同時に請求する（早い方の月にそろえる）
      const claim = oldAgeClaimMonths(ctx, rec, claimInput(ctx, member, input0), N, SA);
      CB = claim.basic;
      CE = claim.employee;
      if (claim.aligned) ctx.notice("N_ASSUMED", ["pension.earlyClaim.simultaneous", member]);
      // 遺族年金の受給権と繰下げ: 65歳に達した月から66歳に達した月までに受給権を持てば繰り下げられない（N から）。66歳の後に得ると、その日に
      // 申出があったとみなし翌月から（増額の月数はそこまで）。65歳になる前に受給権が消えていれば関係しない
      if (CB > N || CE > N) {
        const rights = ctx.call<SurvivorRightOutput>("pension.survivorRight", { member }).rights;
        const R65 = addMonths(N, -1);
        const R66 = addMonths(N, 11);
        const capOf = (blocks: (r: SurvivorRightOutput["rights"][number]) => boolean): MonthIndex | null => {
          let cap: MonthIndex | null = null;
          for (const r of rights) {
            if (!blocks(r)) continue;
            const from = parseYm(r.from);
            let c: MonthIndex;
            if (from <= R66) {
              if (r.to !== null && parseYm(r.to) < R65) continue;
              c = N;
            } else c = addMonths(from, 1);
            if (cap === null || c < cap) cap = c;
          }
          return cap;
        };
        // 老齢基礎年金: 遺族基礎年金。遺族厚生年金は、令和10年3月31日に65歳以上で受給権を持っていた人だけ（附則5条の従前の例）
        const capB = capOf((r) => r.kind === "basic" || (parseYm(r.from) < REFORM_2028 && N <= REFORM_2028));
        // 老齢厚生年金: 遺族厚生年金・遺族基礎年金（44条の3。44条の4は遺族厚生年金を請求しない人だけなので当てはまらない）
        const capE = capOf(() => true);
        if (capB !== null && CB > capB) {
          CB = capB;
          ctx.notice("N_LIMIT_APPLIED", ["pension.deferral.survivorRight", member]);
        }
        if (capE !== null && CE > capE) {
          CE = capE;
          ctx.notice("N_LIMIT_APPLIED", ["pension.deferral.survivorRight", member]);
        }
      }
    }
    const fb = receiving ? RATE_ONE : claimFactor(ctx, base, member, CB - N);
    const fe = receiving ? RATE_ONE : claimFactor(ctx, base, member, CE - N);

    // 記録の後の報酬比例の積み上げ（記録の年度の水準。分母 10^12 の整数で、月ごとの累計）
    const recMonths = rec.months.map((x) => ({ m: parseYm(x.month), x }));
    const accrual: { m: MonthIndex; cum: bigint; emp: number; e2059: number; basic: number }[] = [];
    {
      let cum = 0n;
      let emp = 0;
      let e2059 = 0;
      let basic = 0;
      for (const { m, x } of recMonths) {
        if (x.accrues && x.remuneration > 0) {
          const r = at0.paramRate(m < SPLIT_2003 ? P.pre : P.post) ?? RATE_ZERO;
          const deflate = m < base ? RATE_ONE : ctx.rate.div(EK, E(fiscalYearOf(m)));
          const f = ctx.rate.fraction(ctx.rate.mul(r, deflate));
          cum += (BigInt(x.remuneration) * f.num * DEN) / f.den;
        }
        if (x.employee) emp++;
        if (x.employee2059) e2059++;
        if (x.basic) basic++;
        accrual.push({ m, cum, emp, e2059, basic });
      }
    }
    // cut より前の最後の積み上げ（accrual は月の昇順。二分探索）
    const accrualMonths = accrual.map((a) => a.m as number);
    const ZERO_ACCRUAL = { cum: 0n, emp: 0, e2059: 0, basic: 0 };
    const upTo = (cut: MonthIndex) => {
      const k = countBelow(accrualMonths, cut);
      return k === 0 ? ZERO_ACCRUAL : (accrual[k - 1] as (typeof accrual)[number]);
    };
    const fromMonths = rec.kind !== "projection" && !(receiving && rec.employeeMonths === 0);
    const employeeInitialNum = BigInt(rec.amounts.employee ?? 0) * DEN;
    const insuredAt = new Set(rec.months.filter((x) => x.employee).map((x) => parseYm(x.month) as number));
    const cov = ctx.call<CoverageOutput>("socialInsurance.coverage", { member, fromYear: yearOf(base) });
    // 在職老齢年金の基: 厚生年金の標準報酬月額と、70歳以上で働く月の標準報酬月額に相当する額（coverage の約束の版 1.2）
    const stdOf = new Map(
      cov.months.filter((c) => c.pensionStd !== null || c.workingStd !== undefined).map((c) => [parseYm(c.month) as number, (c.pensionStd ?? c.workingStd) as Yen]),
    );
    const bonusOf = new Map<number, Yen>();
    for (const b of cov.bonuses) {
      const sb = b.pensionStdBonus ?? b.workingStdBonus ?? null;
      if (sb === null) continue;
      const bm = parseYm(b.month) as number;
      bonusOf.set(bm, yen((bonusOf.get(bm) ?? 0) + sb));
    }
    const bonus12 = (m: MonthIndex): Yen => {
      let s = 0;
      for (let k = 0; k < 12; k++) s += bonusOf.get(m - k) ?? 0;
      return yen(s);
    };
    // その月の年金額の計算に入る記録の後の月の終わり（その月より前）。退職改定・在職定時改定
    const cutoff = (m: MonthIndex, b0: MonthIndex, periodic: boolean): MonthIndex => {
      if (!insuredAt.has(m)) return m;
      if (!periodic) return b0;
      const aug = monthIndex(monthOf(m) >= 10 ? yearOf(m) : yearOf(m) - 1, 8);
      const c = addMonths(aug, 1);
      return c > b0 ? c : b0;
    };
    // 金額×率を、同じ金額・同じ率・同じ端数処理の行なら使い回す（同じ計算をしない。率は小数12桁で、内蔵の実行環境では
    // BigInt の計算が重いため）。端数処理の値は、丸めるときと同じ順に先に読む（根拠の記録の順も変わらない）
    const rateMemo = new WeakMap<Rate, Map<string, { entry: object; v: Yen }>>();
    const mulRateM = (at: MonthCtx, a: Yen, r: Rate, roundingId: string): Yen => {
      const entry = at.param(roundingId).entry;
      let byKey = rateMemo.get(r);
      if (byKey === undefined) {
        byKey = new Map();
        rateMemo.set(r, byKey);
      }
      const k = `${roundingId}|${a}`;
      const hit = byKey.get(k);
      if (hit !== undefined && hit.entry === entry) return hit.v;
      const v = at.money.mulRate(a, r, roundingId);
      byKey.set(k, { entry, v });
      return v;
    };
    const round1 = (at: MonthCtx, a: Yen, r: Rate) => mulRateM(at, a, r, P.round);
    // 同じ積み上げ（cut より前の記録の月の数）・同じ年度・同じ端数処理の行なら同じ額
    const propMemo = new Map<string, { entry: object; v: Yen }>();
    const proportional = (at: MonthCtx, fy: number, cut: MonthIndex): Yen => {
      const k = `${countBelow(accrualMonths, cut)}|${fy}`;
      const sum = employeeInitialNum + upTo(cut).cum;
      const r = ctx.rate.fraction(ratioE(fy));
      const entry = at.param(P.round).entry;
      const hit = propMemo.get(k);
      if (hit !== undefined && hit.entry === entry) return hit.v;
      const v = at.money.mulRatio(yen(1), sum * r.num, DEN * r.den, P.round);
      propMemo.set(k, { entry, v });
      return v;
    };
    const fullBasic = (at: MonthCtx, fy: number): Yen => mulRateM(at, at.paramYen(P.base) ?? yen(0), R(fy), P.fullRound);
    const transitional = (at: MonthCtx, fy: number, cut: MonthIndex): Yen => {
      if (!fromMonths) return rec.amounts.transitional === null ? yen(0) : round1(at, rec.amounts.transitional, ratioTo(fy));
      const a = upTo(cut);
      const months = Math.min(at.paramCount(P.flatMax) ?? 0, rec.employeeMonths + a.emp);
      const unit = mulRateM(at, at.paramYen(P.flat) ?? yen(0), R(fy), P.round);
      const max = at.paramCount(P.maxMonths) ?? 480;
      const basicPart = at.money.mulRatio(fullBasic(at, fy), rec.employee2059Months + a.e2059, max, P.round);
      const v = ctx.money.mulRatio(unit, months, 1, "conv.exact") - basicPart;
      return yen(v > 0 ? v : 0);
    };
    // 免除の月（記録の第1号の内訳）は、国民年金法27条ただし書の割合（2009年4月以後の分は 4分の1免除7/8・半額3/4・4分の3免除5/8・全額1/2、
    // 2009年3月以前の分は 5/6・2/3・1/2・1/3。平成16年改正法附則10条）で老齢基礎年金の月数に足す（改訂2）。480月を超える分の割合（27条3・5・7号）は扱わない
    const c1 = rec.category1;
    const exempt0 = c1 === undefined || !c1.known ? null : exemptionMonths(ctx, c1);
    // 障害の想定の法定免除の月（記録の後の第1号の月のうち、障害基礎年金1・2級を受ける月。保険料は socialInsurance.nationalPension が払わない）
    const lw = legalExemptionWindow(ev);
    let legalMonths: number[] = [];
    if (lw !== null) {
      const cat1 = new Set(
        ctx
          .call<CategoryOutput>("pension.category", { member })
          .months.filter((c) => c.category === "1" && !c.premiumExempt)
          .map((c) => c.month),
      );
      legalMonths = rec.months.filter((x) => x.basic && cat1.has(x.month) && parseYm(x.month) >= lw.from && (lw.to === null || parseYm(x.month) < lw.to)).map((x) => parseYm(x.month) as number);
    }
    const L = countBelow(legalMonths, CB);
    const zero = { exemptQuarter: 0, exemptHalf: 0, exemptThreeQuarters: 0, exemptFull: 0 };
    const c1base = c1 === undefined || !c1.known ? { ...zero, pre2009: zero } : c1;
    const exempt = L === 0 ? exempt0 : exemptionMonths(ctx, { ...c1base, exemptFull: c1base.exemptFull + L });
    // 全額免除の1か月の割合（2009年4月以後）
    const fullWeight = L === 0 ? null : exemptionMonths(ctx, { ...zero, exemptFull: 1, pre2009: zero });
    const basicAmount = (at: MonthCtx, fy: number): Yen => {
      const ratio = ratioTo(fy);
      const max = at.paramCount(P.maxMonths) ?? 480;
      if (rec.amounts.basic !== null) {
        const v = round1(at, rec.amounts.basic, ratio);
        if (fullWeight === null) return v;
        const minus = at.money.mulRatio(fullBasic(at, fy), BigInt(L) * (fullWeight.den - fullWeight.num), fullWeight.den * BigInt(max), P.round);
        return yen(v > minus ? v - minus : 0);
      }
      const n = rec.basicMonths + upTo(CB).basic - L;
      if (exempt === null || exempt.num === 0n) return at.money.mulRatio(fullBasic(at, fy), Math.min(max, n), max, P.round);
      // 月数を分数のまま足す
      let num = BigInt(n) * exempt.den + exempt.num;
      if (num > BigInt(max) * exempt.den) num = BigInt(max) * exempt.den;
      return at.money.mulRatio(fullBasic(at, fy), num, exempt.den * BigInt(max), P.round);
    };
    // 在職停止（年額）。basicAnnual は報酬比例（繰上げの減額の後・繰下げの増額の前）。標準報酬のある月は1か月ずつの区間
    // 支給停止調整額（年度ごと）。制度データの後の年度は、値のある最後の年度の額×賃金の伸び（前の年の賃金上昇率の積）を1万円単位に四捨五入
    const projectedFy: number[] = [];
    const thresholdOf = memo((fy: number): Yen | null => {
      const atF = ctx.at(fiscalYearStart(fy));
      if (atF.has(P.work)) return atF.paramYen(P.work);
      let last = fy - 1;
      while (last > fy - 100 && !ctx.at(fiscalYearStart(last)).has(P.work)) last--;
      if (last <= fy - 100) return atF.paramYen(P.work);
      const known = ctx.at(fiscalYearStart(last)).paramYen(P.work);
      if (known === null) return null;
      let f = RATE_ONE;
      for (let k = last + 1; k <= fy; k++) f = ctx.rate.mul(f, ctx.rate.add(RATE_ONE, ctx.assumption("wageGrowth", k - 1, RATE_ZERO)));
      projectedFy.push(fy);
      return atF.money.mulRate(known, f, P.workRound);
    });
    const suspension = (_at: MonthCtx, m: MonthIndex, basicAnnual: Yen): Yen => {
      const std = stdOf.get(m);
      if (std === undefined || basicAnnual <= 0) return yen(0);
      const limit = thresholdOf(fiscalYearOf(m));
      if (limit === null) return yen(0);
      const times12 = (a: Yen) => ctx.money.mulRatio(a, 12, 1, "conv.exact");
      const excess = basicAnnual + times12(std) + bonus12(m) - times12(limit);
      if (excess <= 0) return yen(0);
      const stop = ctx.money.mulRatio(yen(excess), 1, 2, "conv.pension.suspension");
      return stop < basicAnnual ? stop : basicAnnual;
    };

    // 構成員と家族
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    const spouseAt = (m: MonthIndex): string[] =>
      relations.flatMap((r) => {
        if (r.type !== "spouse" || (r.a !== member && r.b !== member)) return [];
        if ((r.from !== null && ctx.time.resolve(r.from) > m) || (r.to !== null && ctx.time.resolve(r.to) < m)) return [];
        return [r.a === member ? r.b : r.a];
      });
    const parentsGiven = relations.some((r) => r.type === "parentOf");
    const me = members.find((x) => x.id === member) as MemberInput;
    const children = members.filter(
      (c) =>
        c.kind === "child" &&
        (parentsGiven ? relations.some((r) => r.type === "parentOf" && r.parent === member && r.child === c.id) : me.kind === "self" || me.kind === "spouse"),
    );
    const supMonths = at0.paramCount(P.supMonths) ?? 240;
    // 配偶者の厚生年金の月数（加給年金・振替加算の判定）。配偶者の記録の全体ではなく月数だけを読む
    const otherMonths = (id: string) => ctx.call<{ months: number }>("pension.employeeMonths", { member: id }).months;
    // 配偶者が厚生年金240月以上の老齢厚生年金の受給権を持つ最初の月（その月から配偶者の加給年金を止める。無ければ null）。
    // 約束の版 1.0 の差し替え（longFrom が無い）は、これまでどおり全体の月数で決める
    const spouseLongFrom = memo((id: string): MonthIndex | null => {
      const o = ctx.call<{ months: number; longFrom?: string | null }>("pension.employeeMonths", { member: id });
      if (o.longFrom === undefined) return o.months >= supMonths ? monthIndex(1, 1) : null;
      return o.longFrom === null ? null : parseYm(o.longFrom);
    });
    const spouseUntil = memo((id: string) => ageMonth(ctx, base, P.spouseAge, id));
    const childUntil = memo((id: string) => ageMonth(ctx, base, P.childAge, id));
    // 加給年金の対象の子（その月に生まれていて、18歳に達した年度の末まで）。数えるのは、受給権を得た当時（子の加給年金は要件の月数を満たした当時）に
    // 生まれている（生計を維持していた）子だけ（国民年金法27条の6・厚生年金保険法44条。改訂4）
    const childrenAt = (m: MonthIndex, since: MonthIndex | null = null) =>
      children.filter((c) => parseYm(c.birth.birthYearMonth) <= m && m <= childUntil(c.id) && (since === null || parseYm(c.birth.birthYearMonth) <= since));
    // 子の加給年金の要件を満たした月（最初に満たした月。区間は月の昇順に計算する）
    let childFixedAt: MonthIndex | null = null;
    // 子の加給年金の要件の月数（令和10年4月から120月。それより前は配偶者と同じ240月）。値が無ければ配偶者と同じ
    const childMonthsAt = (at: MonthCtx) => (at.has(P.childMonths) ? (at.paramCount(P.childMonths) ?? supMonths) : supMonths);
    // 加給年金額: 配偶者（240月）と子（childMonthsAt）。新規裁定者の改定率を掛ける
    // その月に配偶者の加給年金の対象になる配偶者（生まれていて65歳未満、配偶者が240月以上の老齢厚生年金の受給権を持っていない）
    const spouseEligibleAt = (m: MonthIndex): boolean =>
      spouseAt(m).some((sp) => {
        if (parseYm((members.find((x) => x.id === sp) as MemberInput).birth.birthYearMonth) > m) return false;
        if (m >= spouseUntil(sp)) return false;
        const lf = spouseLongFrom(sp);
        return lf === null || m < lf;
      });
    // 配偶者の加給年金の要件を初めて満たした月（受給権を得た当時、または240月に届いた当時。繰下げで払われない月も数える）。
    // 令和10年4月より前なら従前の額が続く（令和7年法律第74号附則12条4項）
    let spouseSince: MonthIndex | null | undefined;
    const spouseSinceOf = (): MonthIndex | null => {
      if (spouseSince !== undefined) return spouseSince;
      spouseSince = null;
      const from = receiving ? S0 : N;
      const b0 = receiving ? addMonths(parseYm(rec.asOf ?? formatYm(S0)), 1) : N;
      for (let m = from; m <= end; m = addMonths(m, 1)) {
        if (employeeMonthsOf(rec, cutoff(m, b0, true), monthCache) >= supMonths && spouseEligibleAt(m)) {
          spouseSince = m;
          break;
        }
      }
      return spouseSince;
    };
    /** 加給年金（年額）と、そのうち配偶者の分 */
    const supplementOf = (at: MonthCtx, fy: number, m: MonthIndex, cut: MonthIndex): { total: Yen; spouse: Yen } => {
      const months = employeeMonthsOf(rec, cut, monthCache);
      const childOk = months >= childMonthsAt(at);
      if (months < supMonths && !childOk) return { total: yen(0), spouse: yen(0) };
      const r = NA(fy);
      let total = 0;
      if (months >= supMonths && spouseEligibleAt(m)) {
        const since = spouseSinceOf();
        if (since !== null && since >= REFORM_2028) {
          total += mulRateM(at, at.paramYen(P.supBase2028) ?? yen(0), r, P.fullRound);
          total += mulRateM(at, at.paramYen(P.supSpecial2028) ?? yen(0), r, P.fullRound);
        } else {
          total += mulRateM(at, at.paramYen(P.supBase) ?? yen(0), r, P.fullRound);
          const special = at.paramYen(P.supSpecial, { member });
          if (special !== null) total += mulRateM(at, special, r, P.fullRound);
        }
      }
      const spouse = yen(total);
      if (childOk) {
        if (childFixedAt === null) childFixedAt = m;
        const n = childrenAt(m, childFixedAt).length;
        for (let k = 0; k < n; k++) total += mulRateM(at, at.paramYen(k < 2 ? P.child12 : P.child3) ?? yen(0), r, P.fullRound);
      }
      return { total: yen(total), spouse };
    };
    // 老齢基礎年金の子の加算（令和10年4月から。値の行がある月だけ）: 子の加給年金を受けない子の分（同じ子の加算を両方では受けないとみなす）。
    // 振替加算と同じく繰上げ・繰下げで増減しない。保険料納付済期間などの月数（老齢基礎年金の額に反映する月数で近似）が fullMonths（300）に
    // 満たないときは ×月数/300（国民年金法27条の6第2項）。数える子は受給権を得た当時（繰上げならその月、そうでなければ65歳）に生まれている子
    const basicEntitled = CB < N ? CB : N;
    const basicChildOf = (at: MonthCtx, fy: number, m: MonthIndex, coveredByEmployee: boolean): Yen => {
      if (coveredByEmployee || !at.has(P.basicChild)) return yen(0);
      const amount = at.paramYen(P.basicChild);
      if (amount === null) return yen(0);
      let each = mulRateM(at, amount, NA(fy), P.fullRound);
      const full = at.has(P.basicChildFull) ? at.paramCount(P.basicChildFull) : null;
      const months = Math.min(at.paramCount(P.maxMonths) ?? 480, rec.basicMonths + upTo(CB).basic);
      if (full !== null && months < full) each = at.money.mulRatio(each, months, full, P.round);
      let total = 0;
      for (let k = childrenAt(m, basicEntitled).length; k > 0; k--) total += each;
      return yen(total);
    };
    // 振替加算: 本人の厚生年金が240月未満で、配偶者の厚生年金が240月以上（配偶者の加給年金の対象だった）
    const transferOf = (at: MonthCtx, fy: number): Yen => {
      if (employeeMonthsOf(rec, null, monthCache) >= supMonths) return yen(0);
      if (!spouseAt(N).some((sp) => otherMonths(sp) >= supMonths)) return yen(0);
      if (!at.has(P.transfer, { member })) {
        // 制度データに率の無い生年月日（原本で確かめる前の区分）は計算せずに知らせる
        ctx.notice("N_PARAM_MISSING", [P.transfer, member]);
        return yen(0);
      }
      const coef = at.paramRate(P.transfer, { member });
      if (coef === null) return yen(0);
      const amount = mulRateM(at, at.paramYen(P.transferBase) ?? yen(0), R(fy), P.fullRound);
      return mulRateM(at, amount, coef, P.round);
    };
    // 繰下げの待機中の在職停止の平均（増額の対象から除く）
    let avgStop = yen(0);
    if (CE > N) {
      let sum = 0;
      for (let m = N; m < CE; m = addMonths(m, 1)) {
        const at = ctx.at(m);
        sum += suspension(at, m, proportional(at, fiscalYearOf(m), cutoff(m, N, true)));
      }
      avgStop = ctx.money.divInt(yen(sum), CE - N, "conv.pension.average");
    }

    // 区間ごとの計算（0006 の追記）: 年度・制度の値の行・受給の開始・加給年金の対象の年齢・在職の月などが変わらない区間ごとに1回だけ計算し、
    // 区間の月に同じ額を並べる。区間の境目は、計算に使う月ごとの条件が変わる月（下の breaks）
    const start = Math.min(CB, CE, SA ?? CE) as MonthIndex;
    const first = (start > S0 ? start : S0) as MonthIndex;
    const breaks: MonthIndex[] = [CB, CE, N];
    if (SA !== null) breaks.push(SA);
    // 記録の後の積み上げ（cut より前の月）が変わる月と、在職（標準報酬のある月・記録の厚生年金の月）の月は1か月ずつ
    for (const am of accrualMonths) breaks.push(addMonths(am as MonthIndex, 1));
    for (const im of insuredAt) breaks.push(im as MonthIndex, addMonths(im as MonthIndex, 1));
    for (const sm of stdOf.keys()) breaks.push(sm as MonthIndex, addMonths(sm as MonthIndex, 1));
    for (const r of relations) {
      if (r.type !== "spouse" || (r.a !== member && r.b !== member)) continue;
      if (r.from !== null) breaks.push(ctx.time.resolve(r.from));
      if (r.to !== null) breaks.push(addMonths(ctx.time.resolve(r.to), 1));
      const sp = r.a === member ? r.b : r.a;
      breaks.push(parseYm((members.find((x) => x.id === sp) as MemberInput).birth.birthYearMonth), spouseUntil(sp));
      const lf = spouseLongFrom(sp);
      if (lf !== null) breaks.push(lf);
    }
    breaks.push(REFORM_2028);
    for (const c of children) breaks.push(parseYm(c.birth.birthYearMonth), addMonths(childUntil(c.id), 1));
    const segParams: SegmentOptions["params"] = [
      P.base, P.fullRound, P.round, P.maxMonths, P.flat, P.flatMax, P.supBase, [P.supSpecial, { member }], P.child12, P.child3, P.childMonths, P.basicChild, P.basicChildFull,
      [P.transfer, { member }], P.transferBase, P.work, P.supBase2028, P.supSpecial2028,
    ];
    const months: PensionMonth[] = [];
    for (const seg of ctx.segments(first, end, { params: segParams, breaks, every: "fiscalYear" })) {
      const m = seg.from;
      const at = seg.at;
      const fy = fiscalYearOf(m);
      let basic = yen(0);
      let employee = yen(0);
      let special = yen(0);
      let suspended = yen(0);
      let spouseSupplement = yen(0);
      // 子の加給年金を厚生年金で受ける月か（受けない子の分は老齢基礎年金の子の加算）
      let childByEmployee = false;
      if (m >= CE) {
        const cut = cutoff(m, receiving ? addMonths(parseYm(rec.asOf ?? formatYm(S0)), 1) : N, true);
        const prop = proportional(at, fy, cut);
        const trans = transitional(at, fy, cut);
        const early = ctx.rate.compare(fe, RATE_ONE) < 0;
        const propPaid = early ? round1(at, prop, fe) : prop;
        const transPaid = early ? round1(at, trans, fe) : trans;
        let increase = yen(0);
        if (CE > N) {
          const atN = cutoff(N, N, false);
          const baseInc = proportional(at, fy, atN) + transitional(at, fy, atN) - avgStop;
          increase = baseInc > 0 ? round1(at, yen(baseInc), ctx.rate.sub(fe, RATE_ONE)) : yen(0);
        }
        const stop = suspension(at, m, propPaid);
        suspended = stop;
        const full = stop >= propPaid && propPaid > 0;
        const supplementPaid = !(full || (m < N && !receiving));
        const supplement = supplementPaid ? supplementOf(at, fy, m, cut) : { total: yen(0), spouse: yen(0) };
        childByEmployee = supplementPaid && employeeMonthsOf(rec, cut, monthCache) >= childMonthsAt(at);
        employee = yen(propPaid - stop + transPaid + increase + supplement.total);
        spouseSupplement = supplement.spouse;
      } else if (SA !== null && m >= SA && m < N) {
        const prop = rec.amounts.special !== null ? round1(at, rec.amounts.special, ratioE(fy)) : proportional(at, fy, cutoff(m, SA, false));
        const stop = suspension(at, m, prop);
        suspended = stop;
        special = yen(prop - stop);
      }
      if (m >= CB) {
        basic = at.money.mulRate(basicAmount(at, fy), fb, P.round);
        if (m >= N || receiving) basic = yen(basic + transferOf(at, fy) + basicChildOf(at, fy, m, childByEmployee));
      }
      if (basic > 0 || employee > 0 || special > 0 || suspended > 0) {
        for (let k = seg.from; k <= seg.to && (lastMonth === null || k <= lastMonth); k = addMonths(k, 1)) months.push({ month: formatYm(k), basic, employee, special, suspended, ...(spouseSupplement > 0 ? { spouseSupplement } : {}) });
      }
    }

    if (projectedFy.length > 0) ctx.notice("N_PARAM_PROJECTED", [P.work, String(Math.min(...projectedFy)), String(Math.max(...projectedFy))]);
    return { months };
  },
});

// 老齢年金（老齢基礎年金・老齢厚生年金・特別支給の老齢厚生年金）の月ごとの額と、偶数月に前2か月分を払うお金の動き（0003 の2）
// - 老齢基礎年金: 満額（基準額×改定率を100円単位）×納付月数/480。記録に額があればその額×改定率の比。振替加算を足す
// - 老齢厚生年金: 報酬比例（報酬×乗率。記録の後の報酬は改定率で記録の年度の水準に直す）＋経過的加算（定額部分−基礎年金の相当額）＋加給年金
// - 基礎と厚生を別々に繰上げ・繰下げ（減額率・増額率は生年月日で決まる）。加給年金・振替加算は増額しない
// - 在職老齢年金: 厚生年金に入る月は（基本月額＋総報酬月額相当額−支給停止調整額）÷2 を止める。全部止まる月は加給年金も止める
// - 在職定時改定（65歳から、8月までの加入を10月分から）と退職改定（資格を失った月の翌月から）で、記録の後の加入を足す
// - 支払い: 偶数月に前2か月分。各支払いの1円未満を切り捨て、年度の切り捨ての合計を2月の支払いに足す
import {
  addMonths,
  ageMonth,
  defineComponent,
  fiscalYearOf,
  formatYm,
  monthIndex,
  monthOf,
  parseYm,
  rate,
  RATE_ONE,
  RATE_ZERO,
  yearOf,
  yen,
  type CoverageOutput,
  type Ctx,
  type Flow,
  type MonthCtx,
  type SegmentOptions,
  type MemberInput,
  type MonthIndex,
  type PensionMonth,
  type PensionPayment,
  type PensionRecordInput,
  type Rate,
  type RecordOutput,
  type RelationInput,
  type RevisionOutput,
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
  transfer: "pension.transferAddition.coefficient",
  transferBase: "pension.transferAddition.baseAmount",
  specialAge: "pension.specialOldAge.startAge",
  specialMonths: "pension.specialOldAge.requiredMonths",
  work: "pension.workingAdjustment.threshold",
  payRound: "pension.payment.rounding",
};
const SPLIT_2003 = monthIndex(2003, 4);
const DEN = 1000000000000n;

type Out = { flows: Flow[]; payments: PensionPayment[]; months: PensionMonth[] };

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
  id: "pension.oldAge",
  title: "老齢年金",
  contract: "1.0",
  revision: 3,
  requires: { "pension.record": ">=1 <2", "pension.revision": ">=1 <2", "socialInsurance.coverage": ">=1 <2", "pension.employeeMonths": ">=1 <2" },
  params: Object.values(P),
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
  ],
  memberScope: ["pensionRecord"],
  input: "member.input",
  output: "pension.oldAge.output",
  compute(input, ctx) {
    const member = input.member;
    const { base, end } = ctx.time;
    const monthCache = new Map<RecordOutput, MonthIndex[]>();
    const empty: Out = { flows: [], payments: [], months: [] };
    // 表の最後までに繰上げの最も早い月（65歳の60か月前）も来ず、受給中の記録も無ければ計算しない
    const input0 = ctx.list<PensionRecordInput>("pensionRecord").find((r) => r.member === member);
    const N = ageMonth(ctx, base, P.start, member);
    if (addMonths(N, -60) > end && input0?.kind !== "receiving") return empty;
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
      ctx.notice("N_NOT_ENTITLED", ["pension.qualifyingMonths", member]);
      return empty;
    }
    const receiving = rec.kind === "receiving";
    const S0 = monthIndex(yearOf(base) - 2, 1);
    const CB = receiving ? S0 : input0?.claim?.basic !== undefined ? ctx.time.resolve(input0.claim.basic) : N;
    const CE = receiving ? S0 : input0?.claim?.employee !== undefined ? ctx.time.resolve(input0.claim.employee) : N;
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
    const stdOf = new Map(cov.months.filter((c) => c.pensionStd !== null).map((c) => [parseYm(c.month) as number, c.pensionStd as Yen]));
    const bonusOf = new Map<number, Yen>();
    for (const b of cov.bonuses) {
      if (b.pensionStdBonus === null) continue;
      const bm = parseYm(b.month) as number;
      bonusOf.set(bm, yen((bonusOf.get(bm) ?? 0) + b.pensionStdBonus));
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
    const basicAmount = (at: MonthCtx, fy: number): Yen => {
      const ratio = ratioTo(fy);
      if (rec.amounts.basic !== null) return round1(at, rec.amounts.basic, ratio);
      const max = at.paramCount(P.maxMonths) ?? 480;
      const n = Math.min(max, rec.basicMonths + upTo(CB).basic);
      return at.money.mulRatio(fullBasic(at, fy), n, max, P.round);
    };
    // 在職停止（年額）。basicAnnual は報酬比例（繰上げの減額の後・繰下げの増額の前）。標準報酬のある月は1か月ずつの区間
    const suspension = (at: MonthCtx, m: MonthIndex, basicAnnual: Yen): Yen => {
      const std = stdOf.get(m);
      if (std === undefined || basicAnnual <= 0) return yen(0);
      const limit = at.paramYen(P.work);
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
    const spouseUntil = memo((id: string) => ageMonth(ctx, base, P.spouseAge, id));
    const childUntil = memo((id: string) => ageMonth(ctx, base, P.childAge, id));
    // 加給年金の対象の子（その月に生まれていて、18歳に達した年度の末まで）
    const childrenAt = (m: MonthIndex) => children.filter((c) => parseYm(c.birth.birthYearMonth) <= m && m <= childUntil(c.id));
    // 子の加給年金の要件の月数（令和10年4月から120月。それより前は配偶者と同じ240月）。値が無ければ配偶者と同じ
    const childMonthsAt = (at: MonthCtx) => (at.has(P.childMonths) ? (at.paramCount(P.childMonths) ?? supMonths) : supMonths);
    // 加給年金額: 配偶者（240月）と子（childMonthsAt）。新規裁定者の改定率を掛ける
    const supplementOf = (at: MonthCtx, fy: number, m: MonthIndex, cut: MonthIndex): Yen => {
      const months = employeeMonthsOf(rec, cut, monthCache);
      const childOk = months >= childMonthsAt(at);
      if (months < supMonths && !childOk) return yen(0);
      const r = NA(fy);
      let total = 0;
      for (const sp of months >= supMonths ? spouseAt(m) : []) {
        if (parseYm((members.find((x) => x.id === sp) as MemberInput).birth.birthYearMonth) > m) continue;
        if (m >= spouseUntil(sp)) continue;
        if (otherMonths(sp) >= supMonths) continue;
        total += mulRateM(at, at.paramYen(P.supBase) ?? yen(0), r, P.fullRound);
        const special = at.paramYen(P.supSpecial, { member });
        if (special !== null) total += mulRateM(at, special, r, P.fullRound);
        break;
      }
      if (childOk) {
        let k = 0;
        for (const _c of childrenAt(m)) {
          total += mulRateM(at, at.paramYen(k < 2 ? P.child12 : P.child3) ?? yen(0), r, P.fullRound);
          k++;
        }
      }
      return yen(total);
    };
    // 老齢基礎年金の子の加算（令和10年4月から。値の行がある月だけ）: 子の加給年金を受けない子の分（同じ子の加算を両方では受けないとみなす）。
    // 振替加算と同じく繰上げ・繰下げで増減しない
    const basicChildOf = (at: MonthCtx, fy: number, m: MonthIndex, coveredByEmployee: boolean): Yen => {
      if (coveredByEmployee || !at.has(P.basicChild)) return yen(0);
      const amount = at.paramYen(P.basicChild);
      if (amount === null) return yen(0);
      let total = 0;
      for (const _c of childrenAt(m)) total += mulRateM(at, amount, NA(fy), P.fullRound);
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
    // 特別支給の老齢厚生年金（生年月日・性別で開始年齢。対象でない生年月日は notApplicable）
    let SA: MonthIndex | null = null;
    if (!receiving && rec.kind !== "projection") {
      const years = at0.paramCount(P.specialAge, { member });
      const qual = (at0.paramCount(P.specialMonths) ?? 12) <= employeeMonthsOf(rec, N, monthCache);
      if (years !== null && qual) {
        const sel = at0.param(P.specialAge, { member });
        SA = ctx.time.ageSwitch(member, { years }, (sel.def.ageSwitch ?? "monthAfterReach") as never);
      }
    }
    if (rec.amounts.special !== null && SA === null && !receiving) SA = addMonths(N, -12);

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
    }
    for (const c of children) breaks.push(parseYm(c.birth.birthYearMonth), addMonths(childUntil(c.id), 1));
    const segParams: SegmentOptions["params"] = [
      P.base, P.fullRound, P.round, P.maxMonths, P.flat, P.flatMax, P.supBase, [P.supSpecial, { member }], P.child12, P.child3, P.childMonths, P.basicChild,
      [P.transfer, { member }], P.transferBase, P.work,
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
        const supplement = supplementPaid ? supplementOf(at, fy, m, cut) : yen(0);
        childByEmployee = supplementPaid && employeeMonthsOf(rec, cut, monthCache) >= childMonthsAt(at);
        employee = yen(propPaid - stop + transPaid + increase + supplement);
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
        for (let k = seg.from; k <= seg.to; k = addMonths(k, 1)) months.push({ month: formatYm(k), basic, employee, special, suspended });
      }
    }

    // 支払い: 偶数月に前2か月分。各支払いは1円未満を切り捨て、3月から翌年2月までの支払いの切り捨ての合計（1円未満は切り捨て）を
    // 2月の支払い（無ければその期間の最後の支払い）に足す（国民年金法18条の2）
    const payments: PensionPayment[] = [];
    const parts = ["basic", "employee", "special"] as const;
    for (const part of parts) {
      const pays = new Map<string, { sum: number; accrual: number }>();
      for (const x of months) {
        const a = x[part];
        if (a <= 0) continue;
        const m = parseYm(x.month);
        const paid = formatYm(addMonths(m, monthOf(m) % 2 === 1 ? 1 : 2));
        const cur = pays.get(paid) ?? { sum: 0, accrual: yearOf(m) };
        cur.sum += a;
        pays.set(paid, cur);
      }
      const remainder = new Map<number, number>();
      const lastOf = new Map<number, string>();
      const list: PensionPayment[] = [];
      for (const [ym, v] of [...pays.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const pm = parseYm(ym);
        const period = monthOf(pm) >= 3 ? yearOf(pm) : yearOf(pm) - 1;
        const amount = ctx.at(pm).money.divInt(yen(v.sum), 12, P.payRound);
        remainder.set(period, (remainder.get(period) ?? 0) + (v.sum - ctx.money.mulRatio(amount, 12, 1, "conv.exact")));
        lastOf.set(period, ym);
        list.push({ ym, part, amount, accrualYear: v.accrual });
      }
      for (const [period, rem] of remainder) {
        const add = ctx.at(monthIndex(period + 1, 2)).money.divInt(yen(rem), 12, P.payRound);
        if (add <= 0) continue;
        const feb = formatYm(monthIndex(period + 1, 2));
        const target = list.find((p) => p.ym === feb) ?? list.find((p) => p.ym === lastOf.get(period));
        if (target !== undefined) list[list.indexOf(target)] = { ...target, amount: yen(target.amount + add) };
      }
      payments.push(...list.filter((p) => p.amount > 0));
    }
    payments.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : a.part < b.part ? -1 : 1));
    const formula = { basic: "pension.oldAge.basic.payment", employee: "pension.oldAge.employee.payment", special: "pension.oldAge.special.payment" };
    const flows: Flow[] = payments.map((p) => ({ row: "cf.income.pension", ym: p.ym, amount: p.amount, accrualYear: p.accrualYear, member, formula: formula[p.part] }));
    return { flows, payments, months };
  },
});

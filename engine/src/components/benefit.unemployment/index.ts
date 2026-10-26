// 雇用保険の失業の給付と高年齢雇用継続給付（非課税。0037）
// - 基本手当: 雇用保険に入る働き方の期間が終わり、次に働くまで働かない月があり、その期間に employment.unemploymentClaim: true を入れたとき
//   （欄が無ければ受け取らない。今までと同じ結果。新しい世帯に入れる推定は SDK の estimateUnemploymentClaim）。賃金日額＝離職の前6か月の給与（賞与を除く）÷180（上限・下限は離職の日の年齢）、
//   基本手当日額＝賃金日額×給付率（80%〜50%。60歳以上65歳未満は80%〜45%）。辞めた月の翌月の初めに求職を申し込み、待期7日・自己都合の給付制限
//   （令和7年4月から原則1か月）の後から所定給付日数（辞め方・被保険者であった期間・年齢）まで。次に働く月・受給期間（1年）で打ち切る
// - 高年齢求職者給付金: 65歳以上で辞めたとき、基本手当日額の30日分・50日分の一時金（受け取るのは unemploymentClaim を true にしたときだけ）
// - 高年齢雇用継続基本給付金: その月の働き方の期間に employment.elderlyContinuationClaim: true を入れたとき（欄が無ければ受け取らない）、
//   被保険者であった期間が5年以上の60〜64歳の月に、給与（賞与を除く）が60歳到達時の賃金月額の75%未満なら、
//   給与×最大の率（60歳に達した日が令和7年4月から10%、それより前は15%。64%〈61%〉以上75%未満は75%で0円になるよう減らす率を0.01%で切り捨て）。
//   支給限度額・最低限度額。基本手当を受けた後の高年齢再就職給付金は入れない
// - 年金とのつながり（pensionStops）: 基本手当を受ける間は65歳前の老齢厚生年金（特別支給・繰上げ）を全額止め（求職の申込みの月の翌月から。
//   事後精算の後の月数＝基本手当を受けた日数÷30の切り上げ）、高年齢雇用継続給付を受ける月は標準報酬月額×（給付の率×最大の停止の割合÷最大の給付の率）を
//   在職老齢年金の停止に加えて止める。止めるのは pension.oldAge、被扶養者・第3号の判定（日額×360）は socialInsurance.healthStatus・pension.category
// 日数は1か月を30日とみなす近似（benefit.employment と同じ）。基本手当は受けた日の月の翌月に、高年齢雇用継続給付はその月の翌月に払う
import {
  addMonths,
  ageMonth,
  boxValue,
  defineComponent,
  EMPLOYEE_TYPES,
  formatYm,
  parseYm,
  RATE_ZERO,
  yearOf,
  yen,
  type CoverageOutput,
  type Ctx,
  type EmployeeStatusOutput,
  type EmploymentPeriodInput,
  type Flow,
  type MemberInput,
  type MonthCtx,
  type MonthIndex,
  type Rate,
  type SalaryOutput,
  type UnemploymentOutput,
  type UnemploymentPensionStop,
  type UnemploymentReceipt,
  type Yen,
} from "../../sdk/index.ts";

const B = "employmentInsurance.basicAllowance";
const C = "employmentInsurance.elderlyContinuation";
const P = {
  min: `${B}.dailyWageMin`,
  maxUnder30: `${B}.dailyWageMax.under30`,
  maxFrom30: `${B}.dailyWageMax.from30`,
  maxFrom45: `${B}.dailyWageMax.from45`,
  maxFrom60: `${B}.dailyWageMax.from60`,
  breakFull: `${B}.rateBreak.full`,
  breakHalf: `${B}.rateBreak.half`,
  breakElderly: `${B}.rateBreak.elderly`,
  high: `${B}.rate.high`,
  low: `${B}.rate.low`,
  lowElderly: `${B}.rate.lowElderly`,
  altWage: `${B}.elderlyAlt.wageRate`,
  altBase: `${B}.elderlyAlt.baseRate`,
  waiting: `${B}.waitingDays`,
  receipt: `${B}.receiptMonths`,
  reqGeneral: `${B}.requiredMonths.general`,
  winGeneral: `${B}.windowMonths.general`,
  reqSpecific: `${B}.requiredMonths.specific`,
  winSpecific: `${B}.windowMonths.specific`,
  restriction: `${B}.restrictionMonths.voluntary`,
  age30: `${B}.ageBand.from30`,
  age35: `${B}.ageBand.from35`,
  age45: `${B}.ageBand.from45`,
  age60: `${B}.seniorAge`,
  age65: `${B}.elderlyAge`,
  generalUnder10: `${B}.days.general.under10`,
  generalFrom10: `${B}.days.general.from10`,
  generalFrom20: `${B}.days.general.from20`,
  specificUnder1: `${B}.days.specific.under1`,
  elderlyUnder1: "employmentInsurance.elderlyJobSeeker.days.under1",
  elderlyFrom1: "employmentInsurance.elderlyJobSeeker.days.from1",
  cFrom: `${C}.fromAge`,
  cUntil: `${C}.untilAge`,
  cRequired: `${C}.requiredMonths`,
  cThreshold: `${C}.thresholdRatio`,
  cFull: `${C}.fullRateRatio`,
  cMax: `${C}.maxRate`,
  cLimit: `${C}.monthlyLimit`,
  cMinimum: `${C}.minimumAmount`,
  stopMax: "pension.employmentBenefitAdjustment.maxStopRate",
};
const AGE_BANDS = ["under30", "from30", "from35", "from45", "from60"] as const;
const YEAR_BANDS = ["from1", "from5", "from10", "from20"] as const;
const SPECIFIC = Object.fromEntries(AGE_BANDS.map((a) => [a, Object.fromEntries(YEAR_BANDS.map((y) => [y, `${B}.days.specific.${a}.${y}`]))])) as Record<
  (typeof AGE_BANDS)[number],
  Record<(typeof YEAR_BANDS)[number], string>
>;
const DAYS_PER_MONTH = 30;
/** 高年齢雇用継続給付の支給率の単位（0.01%。厚生労働省の Q&A の計算例から） */
const RATE_UNIT = 10000n;
/** 被保険者であった期間を通算する、資格の空白の上限（1年以内。雇用保険法22条3項）。月数 */
const GAP_LIMIT_MONTHS = 12;
/** 辞め方（employment.endsWith）のうち、計算が読む値 */
type Reason = "retirement" | "voluntary" | "involuntary" | "contractEnd" | "sickLeave";
const REASONS: ReadonlySet<string> = new Set(["retirement", "voluntary", "involuntary", "contractEnd", "sickLeave"]);
const EMPTY: UnemploymentOutput = { flows: [], receipts: [], pensionStops: [] };

interface EventLike {
  readonly id: string;
  readonly kind: string;
}

/** 有理数の掛け算（num/den の分数で、切り捨て） */
function fractionOf(ctx: Ctx, r: Rate): { n: bigint; d: bigint } {
  const f = ctx.rate.fraction(r);
  return { n: f.num, d: f.den };
}

export default defineComponent<{ member: string }, UnemploymentOutput>({
  id: "benefit.unemployment",
  title: "雇用保険の失業の給付・高年齢雇用継続給付",
  contract: "1.0",
  revision: 1,
  requires: { "socialInsurance.employeeStatus": ">=1 <2", "income.salary": ">=1 <2", "socialInsurance.coverage": ">=1 <2" },
  params: [...Object.values(P), ...AGE_BANDS.flatMap((a) => YEAR_BANDS.map((y) => SPECIFIC[a][y]))],
  reads: [
    "member.birth",
    "member.leaves",
    "event.kind",
    "employment.member",
    "employment.from",
    "employment.to",
    "employment.type",
    "employment.salary.annual",
    "employment.endsOnMonthEnd",
    "employment.endsWith",
    "employment.unemploymentClaim",
    "employment.elderlyContinuationClaim",
  ],
  memberScope: ["employment"],
  input: "member.input",
  output: "benefit.unemployment.output",
  compute(input, ctx) {
    const member = input.member;
    const { base, end } = ctx.time;
    // 制度データに失業の給付の値が無い（架空の見本のデータなど）ときは計算しない
    if (!ctx.at(base).has(P.high)) return EMPTY;
    const status = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member }).months;
    if (status.length === 0) return EMPTY;
    const first = parseYm((status[0] as { month: string }).month);
    const insured = new Set<number>();
    const working = new Set<number>();
    for (const s of status) {
      const m = parseYm(s.month);
      if (s.employment) insured.add(m);
      if (s.type !== "none" && s.type !== "unemployed") working.add(m);
    }
    const salary = new Map<number, Yen>();
    for (const x of ctx.call<SalaryOutput>("income.salary", { member }).payments) {
      const m = parseYm(x.ym);
      salary.set(m, yen((salary.get(m) ?? 0) + x.salary));
    }
    const me = ctx.list<MemberInput>("member").find((x) => x.id === member) as MemberInput;
    const leaves = me.leaves === null ? null : ctx.time.resolve(me.leaves);
    const events = ctx.list<EventLike>("event");
    const periods = ctx
      .list<EmploymentPeriodInput>("employment")
      .filter((p) => p.member === member)
      .map((p) => ({ p, from: ctx.time.resolve(p.from), to: p.to === null ? null : ctx.time.resolve(p.to) }))
      .sort((a, b) => a.from - b.from);

    // 制度データの期間より前の月は、後の最初の期間の値を使う（給付率の変わり目の賃金日額は令和8年8月からの値だけを置いたため）
    let assumedLater = false;
    const valuesAt = (m: MonthIndex): MonthCtx => {
      const at = ctx.at(m);
      if (at.has(P.breakFull)) return at;
      for (let k = 1; k <= 72; k++) {
        const later = ctx.at(addMonths(m, k));
        if (later.has(P.breakFull)) {
          assumedLater = true;
          return later;
        }
      }
      return at;
    };
    const ageAt = (m: MonthIndex, id: string): boolean => ageMonth(ctx, m, id, member) <= m;
    // 被保険者であった期間（月数）: m から前へ、雇用保険に入る月を数える。1年を超える空白・前に基本手当を受けた離職（resetAfter）で切れる
    const insuredSpan = (m: MonthIndex, resetAfter: MonthIndex | null): number => {
      let n = 0;
      let gap = 0;
      for (let k = m; k >= first && (resetAfter === null || k > resetAfter); k = addMonths(k, -1)) {
        if (insured.has(k)) {
          n++;
          gap = 0;
        } else if (++gap > GAP_LIMIT_MONTHS) break;
      }
      return n;
    };
    const insuredWithin = (m: MonthIndex, window: number): number => {
      let n = 0;
      for (let k = 0; k < window; k++) if (insured.has(addMonths(m, -k))) n++;
      return n;
    };
    /** 賃金日額（上限・下限の後）。sum は6か月の給与の合計 */
    const wageDaily = (at: MonthCtx, sum: number, capId: string): Yen => {
      let w = ctx.money.mulRatio(yen(sum), 1, 180, "conv.benefit.daily");
      const max = at.paramYen(capId);
      const min = at.paramYen(P.min);
      if (max !== null && w > max) w = max;
      if (min !== null && w < min) w = min;
      return w;
    };
    /** 基本手当日額（雇用保険法16条。senior は離職の日に60歳以上65歳未満） */
    const basicDaily = (at: MonthCtx, w: Yen, senior: boolean): Yen => {
      const hi = at.paramRate(P.high) ?? RATE_ZERO;
      const lo = (senior ? at.paramRate(P.lowElderly) : at.paramRate(P.low)) ?? RATE_ZERO;
      const a = at.paramYen(P.breakFull);
      const b = senior ? at.paramYen(P.breakElderly) : at.paramYen(P.breakHalf);
      if (a === null || b === null || b <= a || w < a) return at.money.mulRate(w, hi, "conv.benefit.daily");
      if (w > b) return at.money.mulRate(w, lo, "conv.benefit.daily");
      // 逓減: w×(hi−(hi−lo)×(w−a)/(b−a))
      const h = fractionOf(ctx, hi);
      const l = fractionOf(ctx, lo);
      const span = BigInt(b - a);
      const num = h.n * l.d * span - (h.n * l.d - l.n * h.d) * BigInt(w - a);
      let y = at.money.mulRatio(w, num, h.d * l.d * span, "conv.benefit.daily");
      if (senior) {
        // 60歳以上65歳未満は、賃金日額×5%＋（45%になる賃金日額）×40% との低い方
        const x = fractionOf(ctx, at.paramRate(P.altWage) ?? RATE_ZERO);
        const z = fractionOf(ctx, at.paramRate(P.altBase) ?? RATE_ZERO);
        const alt = at.money.mulRatio(yen(1), BigInt(w) * x.n * z.d + BigInt(b) * z.n * x.d, x.d * z.d, "conv.benefit.daily");
        if (alt < y) y = alt;
      }
      return y;
    };

    const flows: Flow[] = [];
    const receipts: UnemploymentReceipt[] = [];
    const stops: UnemploymentPensionStop[] = [];
    const at0 = ctx.at(base);
    const reach65 = ageMonth(ctx, base, P.cUntil, member);
    let resetAfter: MonthIndex | null = null;
    // 基本手当を受けた離職の月（高年齢雇用継続基本給付金の被保険者であった期間を切る）
    const claimed: MonthIndex[] = [];

    for (const { p, to } of periods) {
      if (to === null || !EMPLOYEE_TYPES.has(p.type) || !insured.has(to)) continue;
      const L = to;
      // 次に働く月（無ければ表の最後の次の月）。世帯から離れる月（万一の想定の死亡の翌月から）で打ち切る
      let next = addMonths(L, 1);
      const last = leaves === null ? end : (addMonths(leaves, -1) < end ? addMonths(leaves, -1) : end);
      while (next <= last && !working.has(next)) next = addMonths(next, 1);
      const idle = next - addMonths(L, 1);
      if (idle <= 0 || addMonths(L, 14) < base) continue;
      const elderly = ageAt(L, P.age65);
      const senior = !elderly && ageAt(L, P.age60);
      const toEvent = p.to !== null && "event" in p.to ? events.find((e) => e.id === (p.to as { event: string }).event) : undefined;
      const reason: Reason =
        p.endsWith !== undefined && REASONS.has(p.endsWith) ? (p.endsWith as Reason) : p.endsWith === undefined && (ageAt(L, P.age60) || toEvent?.kind === "retirement") ? "retirement" : "voluntary";
      // 受け取ると入れた期間だけ（欄が無ければ受け取らない）
      if (p.unemploymentClaim !== true) continue;
      const atL = ctx.at(L);
      const specific = reason === "involuntary";
      // 受給資格（離職の日以前2年間に12か月。会社都合と65歳以上は1年間に6か月）
      const required = specific || elderly ? atL.paramCount(P.reqSpecific) : atL.paramCount(P.reqGeneral);
      const window = specific || elderly ? atL.paramCount(P.winSpecific) : atL.paramCount(P.winGeneral);
      if (required === null || window === null || insuredWithin(L, window) < required) {
        ctx.notice("N_NOT_ENTITLED", [`${B}.requiredMonths`, p.id]);
        continue;
      }
      const span = insuredSpan(L, resetAfter);
      const years = Math.floor(span / 12);
      // 賃金日額: 離職の前6か月の給与（月の途中で辞めるときは、その月を除いた6か月）
      const lastFull = p.endsOnMonthEnd === false ? addMonths(L, -1) : L;
      let sum = 0;
      for (let k = 0; k < 6; k++) sum += salary.get(addMonths(lastFull, -k)) ?? 0;
      const band = elderly ? "under30" : senior ? "from60" : ageAt(L, P.age45) ? "from45" : ageAt(L, P.age30) ? "from30" : "under30";
      const cap = { under30: P.maxUnder30, from30: P.maxFrom30, from45: P.maxFrom45, from60: P.maxFrom60 }[band];
      const start = addMonths(L, 1);
      const waiting = atL.paramCount(P.waiting) ?? 0;
      const restriction = reason === "voluntary" ? (atL.paramCount(P.restriction) ?? 0) : 0;
      const firstDay = waiting + restriction * DAYS_PER_MONTH;
      const idleDays = idle * DAYS_PER_MONTH;

      if (elderly) {
        // 高年齢求職者給付金（一時金）: 失業の認定の日（待期・給付制限の後）まで働かないときに、その月の翌月に払う
        if (firstDay >= idleDays) continue;
        const m = addMonths(start, Math.floor(firstDay / DAYS_PER_MONTH));
        const at = valuesAt(m);
        const days = (years >= 1 ? atL.paramCount(P.elderlyFrom1) : atL.paramCount(P.elderlyUnder1)) ?? 0;
        const daily = basicDaily(at, wageDaily(at, sum, cap), false);
        const amount = at.money.mulRatio(daily, days, 1, "conv.exact");
        if (amount > 0) flows.push({ row: "cf.income.benefit.unemployment", ym: formatYm(addMonths(m, 1)), amount, accrualYear: yearOf(m), member, object: p.id, formula: "benefit.unemployment.elderlyJobSeeker" });
        resetAfter = L;
        claimed.push(L);
        continue;
      }

      // 所定給付日数
      let total: number | null;
      if (!specific) total = atL.paramCount(years >= 20 ? P.generalFrom20 : years >= 10 ? P.generalFrom10 : P.generalUnder10);
      else if (years < 1) total = atL.paramCount(P.specificUnder1);
      else {
        const age = senior ? "from60" : ageAt(L, P.age45) ? "from45" : ageAt(L, P.age35) ? "from35" : ageAt(L, P.age30) ? "from30" : "under30";
        const yb = years >= 20 ? "from20" : years >= 10 ? "from10" : years >= 5 ? "from5" : "from1";
        // 30歳未満で20年以上は無い区分（notApplicable。10年以上20年未満の日数）
        total = atL.paramCount(SPECIFIC[age][yb]) ?? atL.paramCount(SPECIFIC[age].from10);
      }
      if (total === null || total <= 0) continue;
      const receiptDays = (atL.paramCount(P.receipt) ?? 12) * DAYS_PER_MONTH;
      const lastDay = Math.min(firstDay + total, idleDays, receiptDays);
      if (lastDay <= firstDay) continue;
      const byMonth = new Map<number, number>();
      for (let d = firstDay; d < lastDay; d++) {
        const m = addMonths(start, Math.floor(d / DAYS_PER_MONTH));
        byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
      }
      for (const [m, days] of [...byMonth.entries()].sort((x, y) => x[0] - y[0])) {
        const at = valuesAt(m as MonthIndex);
        const daily = basicDaily(at, wageDaily(at, sum, cap), senior);
        receipts.push({ month: formatYm(m as MonthIndex), days, daily });
        const amount = at.money.mulRatio(daily, days, 1, "conv.exact");
        if (amount > 0) flows.push({ row: "cf.income.benefit.unemployment", ym: formatYm(addMonths(m as MonthIndex, 1)), amount, accrualYear: yearOf(m as MonthIndex), member, object: p.id, formula: "benefit.unemployment.basicAllowance" });
      }
      // 65歳前の老齢厚生年金を止める月: 求職の申込みの月（辞めた月の翌月）の翌月から、受けた日数÷30の切り上げの月数（65歳に達する月まで）
      const paid = lastDay - firstDay;
      const stopFrom = addMonths(start, 1);
      for (let k = 0; k < Math.ceil(paid / DAYS_PER_MONTH); k++) {
        const m = addMonths(stopFrom, k);
        if (m <= reach65) stops.push({ month: formatYm(m), kind: "basicAllowance" });
      }
      resetAfter = L;
      claimed.push(L);
    }

    // 高年齢雇用継続基本給付金（60歳に達した月〈5年に満たなければ満たした月〉から65歳に達する月まで）
    const reach60 = ageMonth(ctx, base, P.cFrom, member);
    const required = at0.paramCount(P.cRequired);
    const lastC = leaves === null ? (reach65 < end ? reach65 : end) : [reach65, end, addMonths(leaves, -1)].reduce((x, y) => (y < x ? y : x));
    // 受け取ると入れた働き方の期間（欄が無ければ受け取らない）
    const continuationPeriods = new Set(periods.filter((x) => x.p.elderlyContinuationClaim === true).map((x) => x.p.id));
    if (continuationPeriods.size > 0 && required !== null && reach60 <= lastC && addMonths(reach65, 1) > base) {
      const resetBefore = (m: MonthIndex): MonthIndex | null => {
        let r: MonthIndex | null = null;
        for (const c of claimed) if (c < m && (r === null || c > r)) r = c;
        return r;
      };
      // 5年を満たす最初の月（60歳に達した月から）
      let q: MonthIndex | null = null;
      for (let m = reach60; m <= lastC; m = addMonths(m, 1)) {
        if (insured.has(m) && insuredSpan(m, resetBefore(m)) >= required) {
          q = m;
          break;
        }
      }
      if (q !== null) {
        const atQ = valuesAt(q);
        // 60歳到達時（5年を満たした時）の賃金月額: その前6か月の給与÷180（60歳以上65歳未満の上限・下限）×30。給与の計算の始まりより前は期間の年額の12分の1
        let sum = 0;
        for (let k = 1; k <= 6; k++) {
          const m = addMonths(q, -k);
          const s = salary.get(m);
          if (s !== undefined) sum += s;
          else {
            const pp = periods.find((x) => x.from <= m && (x.to === null || x.to >= m) && EMPLOYEE_TYPES.has(x.p.type));
            sum += pp === undefined ? 0 : ctx.money.divInt(boxValue(pp.p.salary?.annual) ?? yen(0), 12, "conv.salary.monthly");
          }
        }
        const W = ctx.money.mulRatio(wageDaily(atQ, sum, P.maxFrom60), DAYS_PER_MONTH, 1, "conv.exact");
        // 率は60歳に達した日（5年を満たした日）で決まる
        const atRate = ctx.at(q);
        const maxRate = atRate.paramRate(P.cMax);
        const full = atRate.paramRate(P.cFull);
        const threshold = atRate.paramRate(P.cThreshold);
        const stopMax = atRate.paramRate(P.stopMax);
        if (maxRate !== null && full !== null && threshold !== null && W > 0) {
          const r = fractionOf(ctx, maxRate);
          const f = fractionOf(ctx, full);
          const t = fractionOf(ctx, threshold);
          // 給付の額（w は支給対象月の賃金）: w < f×W なら w×r。f×W 以上 t×W 未満なら、支給率 r×f×(t×W−w)/((t−f)×w) を
          // 0.01%未満で切り捨てて w に掛ける（令和7年4月以後は (−64×w＋48×W)÷110 の率。厚生労働省の Q&A の計算例
          // 「賃金月額30万円・賃金20万円で14,540円」と合う）
          const below = (w: number, num: bigint, den: bigint): boolean => BigInt(w) * den < BigInt(W) * num;
          const amountFor = (at: MonthCtx, w: Yen, rate: { n: bigint; d: bigint }): Yen => {
            if (!below(w, t.n, t.d)) return yen(0);
            if (below(w, f.n, f.d)) return at.money.mulRatio(w, rate.n, rate.d, "conv.benefit.daily");
            const tw = t.n * f.d * BigInt(W) - BigInt(w) * t.d * f.d; // (t×W−w)×td×fd
            const tf = t.n * f.d - f.n * t.d; // (t−f)×td×fd
            // 支給率（1万分の1単位で切り捨て）
            const rate4 = (rate.n * f.n * tw * RATE_UNIT) / (rate.d * f.d * tf * BigInt(w));
            return at.money.mulRatio(w, rate4, RATE_UNIT, "conv.benefit.daily");
          };
          const cov = ctx.call<CoverageOutput>("socialInsurance.coverage", { member, fromYear: yearOf(base) });
          const stdOf = new Map(cov.months.filter((c) => c.pensionStd !== null).map((c) => [parseYm(c.month) as number, c.pensionStd as Yen]));
          const status60 = new Map(status.map((s) => [parseYm(s.month) as number, s]));
          for (let m = q > base ? q : base; m <= lastC; m = addMonths(m, 1)) {
            const st = status60.get(m);
            if (!insured.has(m) || st === undefined || st.period === null || !continuationPeriods.has(st.period) || !EMPLOYEE_TYPES.has(st.type) || insuredSpan(m, resetBefore(m)) < required) continue;
            const w = salary.get(m) ?? yen(0);
            if (w <= 0) continue;
            const at = ctx.at(m);
            let amount = amountFor(at, w, r);
            const limit = valuesAt(m).paramYen(P.cLimit);
            if (limit !== null) {
              if (w >= limit) amount = yen(0);
              else if (w + amount > limit) amount = yen(limit - w);
            }
            const minimum = valuesAt(m).paramYen(P.cMinimum);
            if (minimum !== null && amount <= minimum) amount = yen(0);
            if (amount <= 0) continue;
            flows.push({ row: "cf.income.benefit.unemployment", ym: formatYm(addMonths(m, 1)), amount, accrualYear: yearOf(m), member, formula: "benefit.unemployment.elderlyContinuation" });
            // 年金の停止: 標準報酬月額×（その割合の給付の率）×最大の停止の割合÷最大の給付の率
            const std = stdOf.get(m);
            if (std !== undefined && stopMax !== null) {
              const s = fractionOf(ctx, stopMax);
              const stop = amountFor(at, std, { n: s.n, d: s.d });
              if (stop > 0) stops.push({ month: formatYm(m), kind: "continuation", amount: stop });
            }
          }
        }
      }
    }
    if (assumedLater) ctx.notice("N_ASSUMED", [`${B}.rateBreak`, member]);
    return { flows, receipts, pensionStops: stops };
  },
});

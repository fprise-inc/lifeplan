// 健康保険の種類を導く決まり（0008 の4・追記 2026-10-25 の1）と、被扶養者・第3号の収入の見込み（0174）。
// socialInsurance.healthStatus（健康保険の種類）と pension.category（第3号は健康保険の種類が扶養の月だけ）が同じ決まりで導くための共通の関数
import type { Ctx } from "../registry/ctx.ts";
import type { EmploymentPeriodInput, MemberInput } from "../engine/types.ts";
import { addYen, yen, type Yen } from "../money/yen.ts";
import { addMonths, formatYm, parseYm, type MonthIndex } from "../time/month.ts";
import type {
  BusinessOutput,
  DisabilityPensionOutput,
  EmployeeStatusOutput,
  HealthStatusMonth,
  PensionOutput,
  SalaryOutput,
  SurvivorPensionOutput,
  UnemploymentOutput,
} from "./contracts.ts";
import { ageMonth, EMPLOYER_HEALTH_KINDS, insuranceEndMonth, isOutside } from "./helpers.ts";
import { allowanceRowsAnnual, OUTSIDE_CHILD_SUPPORT_READS } from "./moneyRows.ts";

/** 健康保険の種類を導くときに読む制度の値（使う部品は params に書く） */
export const HEALTH_STATUS_PARAMS = {
  lateElderly: "socialInsurance.health.lateElderlyAge",
  limit: "socialInsurance.dependent.incomeLimit",
  limitElderly: "socialInsurance.dependent.incomeLimitElderly",
  elderlyAge: "socialInsurance.dependent.elderlyAge",
  limitYoung: "socialInsurance.dependent.incomeLimitYoung",
  youngFrom: "socialInsurance.dependent.youngFromAge",
  youngUntil: "socialInsurance.dependent.youngUntilAge",
  continuationMonths: "socialInsurance.health.continuation.maxMonths",
} as const;

/** 健康保険の種類を導くときに読む入力項目（使う部品は reads に書き、memberScope に employment を書く） */
export const HEALTH_STATUS_READS = [
  "member.outside",
  "member.kind",
  "member.birth",
  "member.joins",
  "member.leaves",
  "member.support",
  "employment.healthInsurance.kind",
  "employment.type",
  ...OUTSIDE_CHILD_SUPPORT_READS,
  "periodicExpense.everyYears",
] as const;

/** 雇用保険の給付の日額を年額に直す日数（被扶養者の認定で日額×360 と基準を比べる） */
const DAYS_PER_YEAR = 360;

/** 収入の見込みの元になる、月ごとの収入（source は働き方の期間など、続いているかを見る単位。regular は賞与を除く額） */
export interface OutlookEntry {
  readonly ym: string;
  readonly source: string;
  readonly amount: Yen;
  readonly regular: Yen;
}

/**
 * 被扶養者・第3号の認定の収入の見込み（0174。0008 の追記 2026-10-25 の1 を改めた）: その月の収入の状況が続くとしたらの年額。
 * その月に続いている収入の元（働き方の期間・事業）ごとに、その月からの12か月を数え、元の最後の月より後の月はその1年前の月とみなす
 * （その月の仕事がその先も続くとしたら。賞与も1年分入る）。1年前の月が元の始まりより前なら、その月の賞与を除く額とみなす。
 * その月にまだ始まっていない元・もう終わった元は数えない（働き始めた月から見込みに入り、辞めた翌月から外れる）。
 * 表の外の月（表の最後の月より後）も、元の最後の月より後の月として同じく1年前の月とみなす（表の長さで判定を変えない。0003 の追記）
 */
export function currentOutlook(entries: readonly OutlookEntry[]): (m: MonthIndex) => Yen {
  const sources = new Map<string, { first: MonthIndex; last: MonthIndex; amount: Map<number, Yen>; regular: Map<number, Yen> }>();
  for (const e of entries) {
    const m = parseYm(e.ym);
    let s = sources.get(e.source);
    if (s === undefined) {
      s = { first: m, last: m, amount: new Map(), regular: new Map() };
      sources.set(e.source, s);
    }
    if (m < s.first) s.first = m;
    if (m > s.last) s.last = m;
    s.amount.set(m, addYen(s.amount.get(m) ?? yen(0), e.amount));
    s.regular.set(m, addYen(s.regular.get(m) ?? yen(0), e.regular));
  }
  return (m: MonthIndex): Yen => {
    let total = yen(0);
    for (const s of sources.values()) {
      if (m < s.first || m > s.last) continue;
      for (let k = 0; k < 12; k++) {
        let x = addMonths(m, k);
        if (x > s.last) x = addMonths(x, -12);
        total = addYen(total, x < s.first ? (s.regular.get(m) ?? yen(0)) : (s.amount.get(x) ?? yen(0)));
      }
    }
    return total;
  };
}

/**
 * 月ごとの健康保険の種類（0008 の4: 導く）。決まりは socialInsurance.healthStatus の頭の書き方のとおり。
 * withPensions が false なら、収入の見込みに公的年金（老齢・遺族・障害）を入れず、障害年金を受ける人の基準も使わない
 * （pension.category が使う。年金の額は加入の記録から出し、加入の記録は国民年金の種別から出すので、種別の部品は年金の部品を呼べない）。
 * 呼ぶ部品は requires に contingency.event・socialInsurance.employeeStatus・income.salary・income.business・benefit.unemployment
 * （withPensions なら pension.oldAge・pension.survivor・pension.disability も）、params に HEALTH_STATUS_PARAMS、reads に HEALTH_STATUS_READS を書く
 */
export function deriveHealthStatus(ctx: Ctx, member: string, withPensions: boolean): HealthStatusMonth[] {
  const P = HEALTH_STATUS_PARAMS;
  const { base } = ctx.time;
  const own = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member }).months;
  if (own.length === 0) return [];
  const first = parseYm((own[0] as { month: string }).month);
  const at0 = first < base ? base : first;
  const late = ageMonth(ctx, at0, P.lateElderly, member);
  const elderly = ageMonth(ctx, at0, P.elderlyAge, member);
  const youngFrom = ageMonth(ctx, at0, P.youngFrom, member);
  const youngUntil = ageMonth(ctx, at0, P.youngUntil, member);
  const periods = ctx.list<EmploymentPeriodInput>("employment");
  // 生まれる前・世帯にいない月は、どの保険にも入らない（none）
  const me = ctx.get<MemberInput>("member", member);
  const born = parseYm(me.birth.birthYearMonth);
  const joins = me.joins === null ? null : ctx.time.resolve(me.joins);
  // 世帯から離れる月か、亡くなる月から
  const leaves = insuranceEndMonth(ctx, me);
  const absent = (m: MonthIndex) => m < born || (joins !== null && m < joins) || (leaves !== null && m >= leaves);
  const isCouple = (k: MemberInput["kind"]) => k === "self" || k === "spouse";
  // 親・祖父母は、扶養していると入れたときだけ扶養の候補にする（生計維持の関係は入力でしか分からない）
  // 世帯の外の家族（0035 の4）も、扶養していると入れたときだけ。同居は入れたときだけ（家計が別の家族は別居が既定）
  const elder = me.kind === "parent" || me.kind === "grandparent" || isOutside(me);
  const canBeDependent = !elder || me.support?.dependent === true;
  const cohabiting = isOutside(me) ? me.support?.cohabiting === true : !elder || me.support?.cohabiting !== false;
  const allowanceField = me.support?.allowance !== undefined ? ctx.money.mulRatio(me.support.allowance, 12, 1, "conv.exact") : null;
  // 仕送りの年額（その月を含む仕送りの行があれば行の額、無ければ人の欄。別居の親・祖父母だけ）
  const allowanceAt = (m: MonthIndex): Yen | null => (elder && !cohabiting ? (allowanceRowsAnnual(ctx, member, m) ?? allowanceField) : null);
  const allMembers = ctx.list<MemberInput>("member");
  // 任意継続の月（期間に任意継続を書いた月の続きの始まりから2年まで。健康保険法38条1号）
  // 扶養する人の働き方の期間は読めない（memberScope）ので、socialInsurance.employeeStatus の continuation（約束の版 1.1）で知る（欄が無い差し替えの部品なら、任意継続の人は扶養する人にならない）
  const continuationMonths = (st: readonly EmployeeStatusOutput["months"][number][]): Set<string> => {
    const out = new Set<string>();
    let from: MonthIndex | null = null;
    let lastM: MonthIndex | null = null;
    for (const x of st) {
      if (x.health || x.continuation !== true) continue;
      const m = parseYm(x.month);
      if (from === null || lastM === null || addMonths(lastM, 1) !== m) from = m;
      lastM = m;
      const at = ctx.at(m);
      const max = at.has(P.continuationMonths) ? at.paramCount(P.continuationMonths) : null;
      if (max === null || m - from < max) out.add(x.month);
    }
    return out;
  };
  const supporters = allMembers
    .filter((m) => m.id !== member)
    .sort((a, b) => Number(isCouple(b.kind)) - Number(isCouple(a.kind)))
    .map((m) => {
      const lateS = ageMonth(ctx, at0, P.lateElderly, m.id);
      const st = ctx.call<EmployeeStatusOutput>("socialInsurance.employeeStatus", { member: m.id }).months;
      // 勤め先の健康保険か任意継続に入る月（後期高齢者医療の前・世帯から離れる前・亡くなる前）
      const endS = insuranceEndMonth(ctx, m);
      const cont = continuationMonths(st);
      const insured = new Set(st.filter((x) => (x.health || cont.has(x.month)) && parseYm(x.month) < lateS && (endS === null || parseYm(x.month) < endS)).map((x) => x.month));
      // 世帯の外の家族で、勤め先の健康保険に入っている（outside.employeeInsurance）人は、後期高齢者医療の前の月はいつも扶養する人になれる
      // （0035 の4。世帯の人はその人と別居とみなし、収入の2分の1の決まりは見ない）
      const outsideInsured = isOutside(m) && m.outside?.employeeInsurance === true;
      if (outsideInsured) for (const s of own) if (parseYm(s.month) < lateS) insured.add(s.month);
      return { id: m.id, spouse: isCouple(m.kind) && isCouple(me.kind), apart: isOutside(m) && !isOutside(me), insured };
    });
  // 収入の見込み（0174）: その月の収入の状況が続くとしたらの年額。給与（賞与・通勤手当を含む。働き方の期間ごと）・事業所得（期間ごと）は
  // currentOutlook、公的年金（老齢・遺族・障害。withPensions のときだけ）はその月の年額（月ごとの年額の欄）
  const incomes = new Map<string, { outlook: (m: MonthIndex) => Yen; disabled: (m: MonthIndex) => boolean }>();
  const incomeOf = (id: string) => {
    const hit = incomes.get(id);
    if (hit !== undefined) return hit;
    const entries: OutlookEntry[] = [];
    for (const p of ctx.call<SalaryOutput>("income.salary", { member: id }).payments) {
      const regular = addYen(p.salary, p.commuting);
      entries.push({ ym: p.ym, source: `salary:${p.period}`, amount: addYen(regular, p.bonus), regular });
    }
    for (const f of ctx.call<BusinessOutput>("income.business", { member: id }).flows) {
      entries.push({ ym: f.ym, source: `business:${f.object ?? ""}`, amount: f.amount, regular: f.amount });
    }
    const work = currentOutlook(entries);
    const pension = new Map<string, Yen>();
    const disability = new Set<string>();
    if (withPensions) {
      const put = (ym: string, a: Yen) => pension.set(ym, addYen(pension.get(ym) ?? yen(0), a));
      for (const x of ctx.call<PensionOutput>("pension.oldAge", { member: id }).months) put(x.month, addYen(addYen(x.basic, x.employee), x.special));
      for (const x of ctx.call<SurvivorPensionOutput>("pension.survivor", { member: id }).months) put(x.month, addYen(addYen(x.basic, x.employee), addYen(x.widowAddition, x.widowPension)));
      for (const x of ctx.call<DisabilityPensionOutput>("pension.disability", { member: id }).months) {
        const a = addYen(x.basic, x.employee);
        put(x.month, a);
        if (a > 0) disability.add(x.month);
      }
    }
    const out = {
      outlook: (m: MonthIndex): Yen => addYen(work(m), pension.get(formatYm(m)) ?? yen(0)),
      // 障害年金を受ける（障害厚生年金を受けられる程度の障害がある）とみなす月: その月に障害年金を受ける
      disabled: (m: MonthIndex): boolean => disability.has(formatYm(m)),
    };
    incomes.set(id, out);
    return out;
  };
  const mine = incomeOf(member);
  // 基本手当を受ける月の日額
  const allowanceDaily = new Map(ctx.call<UnemploymentOutput>("benefit.unemployment", { member }).receipts.map((x) => [x.month, x.daily]));
  const months: HealthStatusMonth[] = [];
  // 任意継続を入れた月の続きの始まりの月と、最後に任意継続を入れた月
  let continuationFrom: MonthIndex | null = null;
  let continuationLast: MonthIndex | null = null;
  for (const s of own) {
    const m = parseYm(s.month);
    if (absent(m)) {
      months.push({ month: s.month, kind: "none" });
      continue;
    }
    if (m >= late) {
      months.push({ month: s.month, kind: "lateElderly" });
      continue;
    }
    if (s.health) {
      const emp = periods.find((p) => p.id === s.employer);
      months.push({ month: s.month, kind: (emp?.healthInsurance?.kind ?? "kyokaikenpo") as HealthStatusMonth["kind"] });
      continue;
    }
    // 期間に書いた勤め先以外の健康保険は、FP の上書き
    const explicit = periods.find((p) => p.id === s.period)?.healthInsurance?.kind;
    if (explicit === "continuation") {
      if (continuationFrom === null || continuationLast === null || addMonths(continuationLast, 1) !== m) continuationFrom = m;
      continuationLast = m;
      const at = ctx.at(m);
      const max = at.has(P.continuationMonths) ? at.paramCount(P.continuationMonths) : null;
      // 2年を過ぎた月は任意継続でなくなり、下の決まりで導く
      if (max === null || m - continuationFrom < max) {
        months.push({ month: s.month, kind: "continuation" });
        continue;
      }
    } else if (explicit !== undefined && !EMPLOYER_HEALTH_KINDS.has(explicit)) {
      months.push({ month: s.month, kind: explicit as HealthStatusMonth["kind"] });
      continue;
    }
    const supporter = canBeDependent
      ? supporters.find((x) => {
          if (!x.insured.has(s.month)) return false;
          const at = ctx.at(m < base ? base : m);
          const income = mine.outlook(m);
          const young = !x.spouse && m >= youngFrom && m < youngUntil ? at.paramYen(P.limitYoung) : null;
          const limit = m >= elderly || mine.disabled(m) ? at.paramYen(P.limitElderly) : (young ?? at.paramYen(P.limit));
          if (limit !== null && income >= limit) return false;
          const daily = allowanceDaily.get(s.month);
          if (daily !== undefined && limit !== null && ctx.money.mulRatio(daily, DAYS_PER_YEAR, 1, "conv.exact") >= limit) return false;
          // 同居なら扶養する人の収入の2分の1の未満、別居なら仕送りの額の未満（世帯の外の家族の扶養に入る世帯の人は別居）
          if (x.apart) return true;
          // 収入の見込みが0なら、扶養する人の収入が0でも満たす（0171）
          if (cohabiting) return income === 0 || ctx.money.mulRatio(income, 2, 1, "conv.exact") < incomeOf(x.id).outlook(m);
          const allowance = allowanceAt(m);
          return allowance === null || income < allowance;
        })
      : undefined;
    if (supporter !== undefined) {
      months.push({ month: s.month, kind: "dependent", supporter: supporter.id });
      continue;
    }
    months.push({ month: s.month, kind: "national" });
  }
  return months;
}

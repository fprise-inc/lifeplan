// 0026: 資産運用の入れ方と既定の値を、計算の前に入力に重ねる（overlay.ts の万一・ストレスと同じく、エンジンの1か所だけで行う）。
// - 積立の終わり（contributions[].to）が空の積立は、名義の人の退職の月まで（退職のイベントか、最後の働き方の期間の終わり。
//   働き方の期間が無い人は本人の退職の月。終わりの無い働き方の人と、どちらも分からないときは、今までどおり表の最後まで）。
//   iDeCo・企業型DC の掛金は ideco.contribution が加入の決まりで止めるので書き換えない
// - iDeCo・企業型DC の受け取りの始まりが空なら、名義の人の退職の月の翌月を、60歳に達する月〜65歳に達する月に収めた月（受け取り方も空なら一時金）。
//   退職の月が分からなければ65歳に達する月
// - 入れ方（assumptions.investment.method）:
//   total: 金融資産の器を外し、まとめた金融資産の器（pooled）だけで計算する（不動産・その他の資産・保険の器は残す）。pooled が無ければ口座ごとのまま
//   accounts・allocation: pooled は「まだ口座に分けていない分」。残高は pooled の残高−ほかの金融資産の器の残高の合計（0未満は0）、
//   毎月の積立は月ごとに pooled の積立−ほかの器の本人の積立の合計（0未満は0）。どちらも0なら外す
//   allocation: 運用する器（課税口座・NISA・iDeCo・企業型DC・持株会）に、共通の資産配分と信託報酬を当てる（FP が入れた器の利回りは使わない）
import { addMonths, formatYm, type MonthIndex } from "../time/month.ts";
import type { Timepoint, TimeResolver } from "../time/timepoint.ts";
import { yen, type Yen } from "../money/yen.ts";
import type { AccountInput, EngineInput, ValueBox } from "./types.ts";

/** 金融資産に入れない器 */
const NOT_FINANCIAL: ReadonlySet<string> = new Set(["realEstate", "otherAsset", "insurance"]);
/** 資産配分を当てる運用の器 */
export const INVEST_KINDS: ReadonlySet<string> = new Set(["taxable", "nisa", "childNisa", "juniorNisa", "legacyNisa", "ideco", "corporateDc", "esop"]);
/** 積立の終わりを書き換えない器（加入の決まりで止まる） */
const DC_KINDS: ReadonlySet<string> = new Set(["ideco", "corporateDc"]);
const WORKING: ReadonlySet<string> = new Set(["regular", "contract", "partTime", "civilServant", "executive", "selfEmployed"]);

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const valueOf = (b: ValueBox<number> | undefined): number => (b === undefined || (b.state !== "confirmed" && b.state !== "estimated") ? 0 : (b.value ?? 0));
const at = (m: MonthIndex): Timepoint => ({ at: formatYm(m) });

/**
 * 構成員の積立をやめる月（退職の月）。null は終わりが無い（終わりの無い働き方）、undefined は働き方の入力が無い
 */
export function retirementMonth(input: EngineInput, member: string, time: TimeResolver): MonthIndex | null | undefined {
  const ev = input.household.events.find((e) => e.kind === "retirement" && e.member === member);
  if (ev !== undefined) return time.resolveEvent(ev.id, []);
  let last: MonthIndex | undefined;
  for (const p of input.household.employmentPeriods) {
    if (p.member !== member || !WORKING.has(p.type)) continue;
    if (p.to === null) return null;
    const t = time.resolve(p.to);
    if (last === undefined || t > last) last = t;
  }
  return last;
}

/** 積立をやめる月（名義の人 → 本人の順に退職の月。どちらも分からないか終わりが無ければ null） */
function stopMonthOf(input: EngineInput, owner: string, time: TimeResolver, cache: Map<string, MonthIndex | null>): MonthIndex | null {
  const hit = cache.get(owner);
  if (hit !== undefined) return hit;
  let m = retirementMonth(input, owner, time);
  if (m === undefined) {
    const self = input.household.members.find((x) => x.kind === "self");
    m = self !== undefined && self.id !== owner ? retirementMonth(input, self.id, time) : undefined;
  }
  const out = m ?? null;
  cache.set(owner, out);
  return out;
}

/** iDeCo・企業型DC の受け取りの始まりの既定: 退職の月の翌月を、60歳〜65歳に達する月に収める（退職の月が分からなければ65歳） */
export function defaultPayoutStart(input: EngineInput, owner: string, time: TimeResolver): MonthIndex {
  const reach = (years: number) => time.resolve({ memberAge: { member: owner, years } });
  const lo = reach(60);
  const hi = reach(65);
  const r = retirementMonth(input, owner, time);
  if (r === null || r === undefined) return hi;
  const m = addMonths(r, 1);
  return m < lo ? lo : m > hi ? hi : m;
}

/** 積立の予定を月ごとに足す（from〜to。to が null なら表の最後まで） */
function addMonthly(acc: Map<number, number>, a: AccountInput, time: TimeResolver, base: MonthIndex, end: MonthIndex): void {
  for (const c of a.contributions) {
    if (c.payer === "employer" || c.monthly <= 0) continue;
    const from = time.resolve(c.from);
    const to = c.to === null ? end : time.resolve(c.to);
    for (let m = from > base ? from : base; m <= to && m <= end; m = addMonths(m, 1)) acc.set(m, (acc.get(m) ?? 0) + c.monthly);
  }
}

/** 月ごとの額を、同じ額の続く期間にまとめる（0以下の月は積み立てない） */
function compress(byMonth: Map<number, number>, base: MonthIndex, end: MonthIndex): AccountInput["contributions"] {
  const out: { from: Timepoint; to: Timepoint | null; monthly: Yen }[] = [];
  let cur: { from: MonthIndex; to: MonthIndex; monthly: number } | null = null;
  for (let m = base; m <= end; m = addMonths(m, 1)) {
    const v = Math.max(0, byMonth.get(m) ?? 0);
    if (cur !== null && cur.monthly === v && cur.to === addMonths(m, -1)) {
      cur.to = m;
      continue;
    }
    if (cur !== null && cur.monthly > 0) out.push({ from: at(cur.from), to: at(cur.to), monthly: yen(cur.monthly) });
    cur = { from: m, to: m, monthly: v };
  }
  if (cur !== null && cur.monthly > 0) out.push({ from: at(cur.from), to: at(cur.to), monthly: yen(cur.monthly) });
  return out;
}

/** 入れ方と既定の値を重ねた入力（重ねるものが無ければ同じ物を返す） */
export function applyInvestment(input: EngineInput, time: TimeResolver, base: MonthIndex, end: MonthIndex): EngineInput {
  const h = input.household;
  const setting = input.assumptions.investment;
  const method = setting?.method ?? "accounts";
  let changed = false;
  const stops = new Map<string, MonthIndex | null>();
  let accounts: AccountInput[] = h.accounts.map((a0) => {
    let a = a0;
    // 積立の終わりが空なら退職の月まで
    if (!DC_KINDS.has(a.kind) && a.contributions.some((c) => c.to === null)) {
      const stop = stopMonthOf(input, a.owner, time, stops);
      if (stop !== null) {
        a = { ...a, contributions: a.contributions.map((c) => (c.to === null ? { ...c, to: at(stop) } : c)) };
        changed = true;
      }
    }
    // iDeCo・企業型DC の受け取りの始まりの既定
    if (DC_KINDS.has(a.kind) && a.payout?.start === undefined) {
      a = { ...a, payout: { ...(a.payout ?? { method: "lumpSum" }), start: at(defaultPayoutStart(input, a.owner, time)) } };
      changed = true;
    }
    return a;
  });
  const pooled = accounts.filter((a) => a.kind === "pooled");
  if (method === "total" && pooled.length > 0) {
    accounts = accounts.filter((a) => a.kind === "pooled" || NOT_FINANCIAL.has(a.kind));
    changed = true;
  } else if (pooled.length > 0) {
    // まだ口座に分けていない分（残高と、月ごとの積立の差）
    const others = accounts.filter((a) => a.kind !== "pooled" && !NOT_FINANCIAL.has(a.kind));
    const otherValue = others.reduce((s, a) => s + valueOf(a.marketValue), 0);
    const otherMonthly = new Map<number, number>();
    for (const a of others) addMonthly(otherMonthly, a, time, base, end);
    const out: AccountInput[] = [];
    for (const a of accounts) {
      if (a.kind !== "pooled") {
        out.push(a);
        continue;
      }
      const rest = Math.max(0, valueOf(a.marketValue) - otherValue);
      const monthly = new Map<number, number>();
      addMonthly(monthly, a, time, base, end);
      for (const [m, v] of otherMonthly) if (monthly.has(m)) monthly.set(m, (monthly.get(m) ?? 0) - v);
      const contributions = compress(monthly, base, end);
      if (rest <= 0 && contributions.length === 0) continue;
      const box = { ...a.marketValue, value: yen(rest) } as ValueBox<Yen>;
      const { costBasis: _cost, ...restOf } = a;
      void _cost;
      out.push({ ...restOf, marketValue: box, contributions });
    }
    accounts = out;
    changed = true;
  }
  if (method === "allocation" && setting?.allocation !== undefined) {
    const alloc = setting.allocation;
    accounts = accounts.map((a) => {
      if (!INVEST_KINDS.has(a.kind)) return a;
      const { expectedReturn: _e, ...rest } = a;
      void _e;
      return { ...rest, assetMix: alloc.mix, ...(alloc.fee !== undefined ? { fee: alloc.fee } : {}) } as AccountInput;
    });
    changed = true;
  }
  if (!changed) return input;
  const household = { ...h, accounts } as Mutable<EngineInput["household"]>;
  return { ...input, household };
}

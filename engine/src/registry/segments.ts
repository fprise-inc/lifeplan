// 0006 の追記（区間ごとの計算）: 月ごとに同じ計算を繰り返す部品が、制度の値と入力が変わらない区間ごとに1回だけ計算できるようにする。
// 区間の境目は、指定した制度の値の行が変わる月（行の適用開始・適用終了の翌日、延長の仮定の年の変わり目を、値を引く日の決め方（basis）で
// 計算の月に直したもの）と、部品が渡す境目（breaks）・毎年・毎年度の変わり目
import { EngineError } from "../errors.ts";
import type { MatchContext, RegulationStore, Selected } from "../regulation/reader.ts";
import { lookupFor, type Basis, type LookupContext } from "../time/basis.ts";
import { dateKey } from "../time/civil.ts";
import { monthIndex, yearOf, type MonthIndex } from "../time/month.ts";
import type { MonthCtx, ParamOptions } from "./ctx.ts";

export interface SegmentOptions {
  /** 区間の中で同じ行が選ばれるようにする制度の値（端数処理の規則を含む）。構成員の条件で選ぶ値は [id, { member }] */
  readonly params: readonly (string | readonly [string, ParamOptions])[];
  /** 区間の境目にする月（その月から新しい区間）。範囲の外は使わない */
  readonly breaks?: readonly MonthIndex[];
  /** 毎年（1月）・毎年度（4月）でも区切る */
  readonly every?: "year" | "fiscalYear";
}

/** from〜to（両端を含む）の区間。at は区間のどの月でも同じ値を返す */
export interface Segment {
  readonly from: MonthIndex;
  readonly to: MonthIndex;
  readonly at: MonthCtx;
}

/** 区間の at で読める値の鍵（値ID・構成員・管轄） */
export function segmentKey(id: string, o: ParamOptions | undefined): string {
  const j = o?.jurisdiction;
  const who = o?.member ?? (o?.birth === undefined ? undefined : `@${o.birth.birthYearMonth}${o.birth.bornOnFirst ? "+" : ""}`);
  return `${id}${who === undefined ? "" : `|${who}`}${j === undefined || j === "national" ? "" : `|${j.level}:${j.code}`}`;
}

/** 月の昇順の区間から、月 m を含む区間の番号（無ければ -1。二分探索） */
export function segmentIndex(segments: readonly Segment[], m: MonthIndex): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const s = segments[mid] as Segment;
    if (m < s.from) hi = mid - 1;
    else if (m > s.to) lo = mid + 1;
    else return mid;
  }
  return -1;
}

type LookupOf = (id: string, opts: ParamOptions) => { basis: Basis; lc: LookupContext };
type MatchOf = (id: string, opts: ParamOptions) => MatchContext;
type MakeAt = (from: MonthIndex, to: MonthIndex, allowed: ReadonlySet<string>) => MonthCtx;
type Check = ((id: string, opts: ParamOptions, m: MonthIndex) => Selected | null) | null;

/**
 * 値を引く日の鍵が threshold 以上になる最初の月（from〜to。無ければ null）。引く日は月について単調に増える。
 * 値を引く日の決め方（basis）ごとに式で求める（threshold は「日付の鍵」か「日付の鍵＋1」で、月は1〜12）
 */
function firstAtOrAfter(basis: Basis, lc: LookupContext, from: MonthIndex, to: MonthIndex, threshold: number): MonthIndex | null {
  const y = Math.floor(threshold / 10000);
  const mo = Math.floor(threshold / 100) % 100;
  const d = threshold % 100;
  let m: number;
  switch (basis.type) {
    case "month":
    case "birthDate":
      // その月の1日
      m = (monthIndex(y, mo) as number) + (d <= 1 ? 0 : 1);
      break;
    case "incomeYear":
      m = monthIndex(threshold <= y * 10000 + 101 ? y : y + 1, 1);
      break;
    case "fiscalYear":
    case "priorYearIncome": {
      const s = basis.type === "fiscalYear" ? basis.startMonth : basis.switchMonth;
      m = monthIndex(threshold <= y * 10000 + s * 100 + 1 ? y : y + 1, s);
      break;
    }
    default: {
      // 決まった日（anchor）など: 二分探索
      let lo = from as number;
      let hi = (to as number) + 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (dateKey(lookupFor(basis, mid as MonthIndex, lc).date) >= threshold) hi = mid;
        else lo = mid + 1;
      }
      return lo > to ? null : (lo as MonthIndex);
    }
  }
  if (m < from) return from;
  return m > to ? null : (m as MonthIndex);
}

/** 1つの値の行が変わりうる月（from より後〜to）を cuts に足す */
function addCuts(store: RegulationStore, id: string, basis: Basis, lc: LookupContext, from: MonthIndex, to: MonthIndex, cuts: Set<number>): void {
  if (basis.type === "anchor") return;
  const hints = store.boundaryHints(id);
  for (const k of hints.keys) {
    const m = firstAtOrAfter(basis, lc, from, to, k);
    if (m !== null && m > from) cuts.add(m);
  }
  if (hints.extendFrom !== null) {
    // 延長の仮定の行は、値を引く日の年ごとに別の記録（延長した年）になるので、年の変わり目でも区切る
    const y0 = lookupFor(basis, from, lc).date.year;
    const y1 = lookupFor(basis, to, lc).date.year;
    for (let y = y0 + 1; y <= y1; y++) {
      const k = dateKey({ year: y, month: 1, day: 1 });
      if (k <= hints.extendFrom) continue;
      const m = firstAtOrAfter(basis, lc, from, to, k);
      if (m !== null && m > from) cuts.add(m);
    }
  }
}

/**
 * 部品のマニフェストの値（params）すべてについて、行が変わりうる月で from〜to を区切った区間の始まり（昇順）。
 * ctx.at(m) が、同じ区間の月では同じ値の読み取りを使い回すために使う（0006 の追記: 区間の自動の使い回し）
 */
export function autoStarts(store: RegulationStore, ids: readonly string[], from: MonthIndex, to: MonthIndex): number[] {
  const cuts = new Set<number>();
  for (const id of ids) {
    if (!store.knows(id)) continue;
    addCuts(store, id, store.definition(id).basis, {}, from, to, cuts);
  }
  return [from as number, ...[...cuts].sort((a, b) => a - b)];
}

export function segmentsOf(
  store: RegulationStore,
  lookupOf: LookupOf,
  _matchOf: MatchOf,
  from: MonthIndex,
  to: MonthIndex,
  opts: SegmentOptions,
  makeAt: MakeAt,
  check: Check,
): readonly Segment[] {
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new EngineError("E_ARGUMENT", ["segments.range"]);
  if (to < from) return [];
  const cuts = new Set<number>();
  const allowed = new Set<string>();
  const params: [string, ParamOptions][] = [];
  for (const p of opts.params) {
    const [id, o] = typeof p === "string" ? [p, {} as ParamOptions] : [p[0], p[1]];
    if (o.anchorEvent !== undefined) throw new EngineError("E_ARGUMENT", [id, "segments.options"]);
    params.push([id, o]);
    allowed.add(segmentKey(id, o));
    if (!store.knows(id)) continue;
    const { basis, lc } = lookupOf(id, o);
    addCuts(store, id, basis, lc, from, to, cuts);
  }
  for (const b of opts.breaks ?? []) if (b > from && b <= to) cuts.add(b);
  if (opts.every !== undefined) {
    const startMonth = opts.every === "year" ? 1 : 4;
    for (let y = yearOf(from); y <= yearOf(to) + 1; y++) {
      const m = monthIndex(y, startMonth);
      if (m > from && m <= to) cuts.add(m);
    }
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  let start = from as number;
  for (const c of [...sorted, (to as number) + 1]) {
    const a = start as MonthIndex;
    const b = (c - 1) as MonthIndex;
    out.push(Object.freeze({ from: a, to: b, at: makeAt(a, b, allowed) }));
    // CI とテスト（checkInternal）: 区間のどの月でも同じ行（延長の有無も同じ）が選ばれることを確かめる
    if (check !== null) {
      for (const [id, o] of params) {
        if (!store.knows(id)) continue;
        const first = check(id, o, a);
        for (let m = a + 1; m <= b; m++) {
          const s = check(id, o, m as MonthIndex);
          if (s === first) continue;
          if (s === null || first === null || s.entry !== first.entry || (s.extendedYear === undefined) !== (first.extendedYear === undefined)) {
            throw new EngineError("E_ARGUMENT", [id, "segments.notConstant"]);
          }
        }
      }
    }
    start = c;
  }
  return out;
}

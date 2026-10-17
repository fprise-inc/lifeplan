// 年月（"YYYY-MM"）の計算（0003）。年齢は「その年齢に達する月」で数える（1日生まれは前の月に達する）
import type { Member, Timepoint } from "./types.ts";

export function ymIndex(ym: string): number {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return y * 12 + (m - 1);
}

export function ymFrom(index: number): string {
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

export function addMonths(ym: string, n: number): string {
  return ymFrom(ymIndex(ym) + n);
}

/** 構成員がその年齢に達する月 */
export function reachedMonth(m: Pick<Member, "birth">, age: number): string {
  return addMonths(m.birth.birthYearMonth, age * 12 - (m.birth.bornOnFirst ? 1 : 0));
}

/** その月の満年齢（その月に達した年齢を含む） */
export function ageAt(m: Pick<Member, "birth">, ym: string): number {
  return Math.floor((ymIndex(ym) - ymIndex(reachedMonth(m, 0))) / 12);
}

export interface TimeContext {
  readonly members: readonly Member[];
  readonly events?: readonly { readonly id: string; readonly at: Timepoint }[];
}

/** 時点（絶対の年月・構成員の年齢・イベントからの時点）を年月にする。解決できなければ null */
export function resolveAt(t: Timepoint | null | undefined, ctx: TimeContext, depth = 0): string | null {
  if (t === null || t === undefined || depth > 10) return null;
  if ("at" in t) return t.at;
  if ("memberAge" in t) {
    const m = ctx.members.find((x) => x.id === t.memberAge.member);
    return m === undefined ? null : addMonths(reachedMonth(m, t.memberAge.years), t.memberAge.months ?? 0);
  }
  const e = ctx.events?.find((x) => x.id === t.event);
  const at = e === undefined ? null : resolveAt(e.at, ctx, depth + 1);
  return at === null ? null : addMonths(at, (t.offset?.years ?? 0) * 12 + (t.offset?.months ?? 0));
}

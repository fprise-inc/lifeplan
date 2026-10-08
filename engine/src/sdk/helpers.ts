// 部品が共通に使う小さな関数（公式SDK）。年齢の値（unit: years）の切り替えの月・年度・働き方の種類
import { EngineError } from "../errors.ts";
import type { Ctx } from "../registry/ctx.ts";
import type { AgeSwitch } from "../time/ageSwitch.ts";
import { monthIndex, monthOf, yearOf, type MonthIndex } from "../time/month.ts";

/** 年齢の値（unit: years）と、その値の ageSwitch（0003 の4）で決まる月。値は at の月の値を使う */
export function ageMonth(ctx: Ctx, at: MonthIndex, id: string, member: string): MonthIndex {
  const m = ctx.at(at);
  const sel = m.param(id);
  const years = m.paramCount(id);
  if (years === null || sel.def.ageSwitch === null) throw new EngineError("E_PARAM_KIND", [id]);
  return ctx.time.ageSwitch(member, { years }, sel.def.ageSwitch as AgeSwitch);
}

/** その月の属する年度（4月始まり） */
export function fiscalYearOf(m: MonthIndex): number {
  return monthOf(m) >= 4 ? yearOf(m) : yearOf(m) - 1;
}

/** 年度の最初の月（4月）と最後の月（翌年3月） */
export function fiscalYearStart(fy: number): MonthIndex {
  return monthIndex(fy, 4);
}

export function fiscalYearEnd(fy: number): MonthIndex {
  return monthIndex(fy + 1, 3);
}

/** 給与の出る働き方（会社員・契約・パート・公務員） */
export const EMPLOYEE_TYPES: ReadonlySet<string> = new Set(["regular", "contract", "partTime", "civilServant"]);

/** 勤め先の健康保険（被用者保険） */
export const EMPLOYER_HEALTH_KINDS: ReadonlySet<string> = new Set(["kyokaikenpo", "union", "mutualAid"]);

/** 厚生年金の種別 */
export const EMPLOYEE_PENSION_KINDS: ReadonlySet<string> = new Set(["employee1", "employee2", "employee3", "employee4"]);

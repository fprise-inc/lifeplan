// 部品が共通に使う小さな関数（公式SDK）。年齢の値（unit: years）の切り替えの月・年度・働き方の種類
import { EngineError } from "../errors.ts";
import type { Ctx } from "../registry/ctx.ts";
import type { Flow } from "../engine/types.ts";
import { RATE_ZERO, type Rate } from "../money/rate.ts";
import { yen, type Yen } from "../money/yen.ts";
import type { AgeSwitch } from "../time/ageSwitch.ts";
import { formatYm, monthIndex, monthOf, yearOf, type MonthIndex } from "../time/month.ts";

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

/**
 * 市町村・広域連合が集める保険料（国民健康保険・後期高齢者医療・介護保険の第1号）の年度の納期（PR の提案の既定）。
 * 年金から差し引く（特別徴収）ときは 4・6・8・10・12・2月の6回、それ以外（普通徴収）は 6月〜翌年3月の10回。端数は最初の納期
 */
export function installmentMonths(fy: number, special: boolean): MonthIndex[] {
  if (special) return [monthIndex(fy, 4), monthIndex(fy, 6), monthIndex(fy, 8), monthIndex(fy, 10), monthIndex(fy, 12), monthIndex(fy + 1, 2)];
  return [6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((k) => (k <= 12 ? monthIndex(fy, k) : monthIndex(fy + 1, k - 12)));
}

/**
 * 国民健康保険・後期高齢者医療の均等割・平等割の軽減（7割・5割・2割）の割合。判定の所得（世帯主と被保険者の総所得金額等の合計）が
 * 基準額＋給与・年金の所得者の数に応じた額以下なら7割、＋被保険者1人あたりの額×人数以下なら5割・2割（値は prefix の制度データ）
 */
export function reductionRatio(ctx: Ctx, at: MonthIndex, prefix: string, judged: Yen, earners: number, insured: number, seventyId?: string): Rate {
  const m = ctx.at(at);
  const y = (id: string) => m.paramYen(`${prefix}.reduction.${id}`) ?? yen(0);
  const r = (id: string) => m.paramRate(`${prefix}.reduction.${id}`) ?? RATE_ZERO;
  const base = y("base");
  const full = base + m.money.mulRatio(y("perEarner"), Math.max(earners - 1, 0), 1, "conv.exact");
  if (judged <= full) return seventyId !== undefined && m.has(seventyId) ? (m.paramRate(seventyId) ?? RATE_ZERO) : r("ratioSeventy");
  if (judged <= base + m.money.mulRatio(y("halfPerInsured"), insured, 1, "conv.exact")) return r("ratioHalf");
  if (judged <= base + m.money.mulRatio(y("twentyPerInsured"), insured, 1, "conv.exact")) return r("ratioTwenty");
  return RATE_ZERO;
}

/** 年度の保険料の行ごとの年額を納期に分けたお金の動き（端数は最初の納期） */
export function installmentFlows(
  ctx: Ctx,
  fy: number,
  special: boolean,
  member: string,
  parts: readonly { readonly row: string; readonly amount: Yen; readonly formula: string }[],
): Flow[] {
  const months = installmentMonths(fy, special);
  const out: Flow[] = [];
  for (const p of parts) {
    if (p.amount <= 0) continue;
    const shares = ctx.money.allocate(p.amount, months.map(() => 1), "conv.premium.installment", "first");
    months.forEach((m, i) => {
      const a = shares[i] as Yen;
      if (a > 0) out.push({ row: p.row, ym: formatYm(m), amount: a, accrualYear: fy, member, formula: p.formula });
    });
  }
  return out;
}

/** 世帯の入力の保険料の上書き（決定通知書の年額）。無ければ null */
export function assessedPremium(
  list: readonly { readonly member: string; readonly kind: string; readonly fiscalYear: number; readonly amount: { readonly state: string } }[],
  kind: string,
  member: string,
  fy: number,
): (typeof list)[number] | undefined {
  return list.find((a) => a.kind === kind && a.member === member && a.fiscalYear === fy);
}

/** 世帯の入力の料率の上書きのうち、その年度に効く最後のもの */
export function rateOverride<T extends { readonly kind: string; readonly fromFiscalYear?: number }>(list: readonly T[], kind: string, fy: number): T | undefined {
  let best: T | undefined;
  for (const r of list) {
    if (r.kind !== kind || (r.fromFiscalYear ?? 0) > fy) continue;
    if (best === undefined || (best.fromFiscalYear ?? 0) <= (r.fromFiscalYear ?? 0)) best = r;
  }
  return best;
}

/** 年金から保険料・住民税を差し引く（特別徴収）年金の年額の下限の値ID。読む部品は params と requires（pension.oldAge）に書く */
export const PENSION_SPECIAL_MINIMUM = "socialInsurance.specialCollection.minimumPension";

/** その年度（4月〜翌年3月）に払う年金が、特別徴収の下限（年18万円）以上か */
export function pensionSpecial(ctx: Ctx, member: string, fy: number): boolean {
  const min = ctx.at(fiscalYearStart(fy)).paramYen(PENSION_SPECIAL_MINIMUM);
  if (min === null) return false;
  const from = formatYm(fiscalYearStart(fy));
  const to = formatYm(fiscalYearEnd(fy));
  let s = 0;
  for (const p of ctx.call<{ payments: readonly { ym: string; amount: Yen }[] }>("pension.oldAge", { member }).payments) if (p.ym >= from && p.ym <= to) s += p.amount;
  return s >= min;
}

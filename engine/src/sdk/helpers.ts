// 部品が共通に使う小さな関数（公式SDK）。年齢の値（unit: years）の切り替えの月・年度・働き方の種類
import { EngineError } from "../errors.ts";
import type { Ctx } from "../registry/ctx.ts";
import type { Flow } from "../engine/types.ts";
import { RATE_ZERO, type Rate } from "../money/rate.ts";
import { yen, type Yen } from "../money/yen.ts";
import type { AgeSwitch } from "../time/ageSwitch.ts";
import { formatYm, monthIndex, monthOf, parseYm, yearOf, type MonthIndex } from "../time/month.ts";

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
export const EMPLOYEE_TYPES: ReadonlySet<string> = new Set(["regular", "contract", "partTime", "civilServant", "executive"]);

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
  let s = 0;
  // その年度の支払いだけを読む（ほかの年度の年金が変わっても、呼んだ部品を計算し直さない）
  for (const p of ctx.callMonths<{ ym: string; amount: Yen }>("pension.oldAge", { member }, "payments", fiscalYearStart(fy), fiscalYearEnd(fy))) s += p.amount;
  return s >= min;
}

/**
 * 支払月（ym）の昇順に並んだ配列から、from〜to（"YYYY-MM"。両端を含む）の支払いだけを取り出す（二分探索）。
 * 全期間の配列を年ごと・年度ごとに何度も見る部品が、そのたびに全体をなめないようにする
 */
export function paymentsIn<T extends { readonly ym: string }>(xs: readonly T[], from: string, to: string): readonly T[] {
  const bound = (key: string, strict: boolean): number => {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const m = (xs[mid] as T).ym;
      if (strict ? m <= key : m < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return xs.slice(bound(from, false), bound(to, true));
}

/** その年（1〜12月）の支払い（paymentsIn の暦年の形） */
export function paymentsInYear<T extends { readonly ym: string }>(xs: readonly T[], year: number): readonly T[] {
  return paymentsIn(xs, formatYm(monthIndex(year, 1)), formatYm(monthIndex(year, 12)));
}

/** お金の動きを、支払月の暦年ごとに足した額（年の昇順）。被用者保険・国民年金の保険料の部品が出力に添える（社会保険料控除のため） */
export function paidByYear(flows: readonly Flow[]): { year: number; amount: Yen }[] {
  const sums = new Map<number, number>();
  for (const f of flows) {
    const y = yearOf(parseYm(f.ym));
    sums.set(y, (sums.get(y) ?? 0) + f.amount);
  }
  return [...sums.entries()].sort((a, b) => a[0] - b[0]).map(([year, amount]) => ({ year, amount: yen(amount) }));
}

/** paidByYear の形の列から、その年の額（無ければ 0。年の昇順なので二分探索） */
export function amountInYear(rows: readonly { readonly year: number; readonly amount: Yen }[], year: number): Yen {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const r = rows[mid] as { year: number; amount: Yen };
    if (r.year === year) return r.amount;
    if (r.year < year) lo = mid + 1;
    else hi = mid;
  }
  return yen(0);
}

/** 月の昇順に並んだ配列から、from〜to（"YYYY-MM"。両端を含む）の月だけを取り出す（二分探索） */
export function monthsIn<T extends { readonly month: string }>(xs: readonly T[], from: string, to: string): readonly T[] {
  const bound = (key: string, strict: boolean): number => {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const m = (xs[mid] as T).month;
      if (strict ? m <= key : m < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return xs.slice(bound(from, false), bound(to, true));
}

/**
 * 0003 の3・5: 器1つの1年の運用益。期首残高×年利＋その年の収支×年利×1/2（midYear）を、(期首残高×2＋収支)×年利×月数÷12÷2 の
 * 分数のまま1回で丸める（conv.investment.return）。beginning は収支を期首に、end は期末に動いたとみなす。months は初年度の残りの月数
 */
export function annualReturn(ctx: Ctx, opening: Yen, net: Yen, r: Rate, months: number): Yen {
  const f = ctx.rate.fraction(r);
  const timing = ctx.conventions.investmentTiming;
  const [amount, half] = timing === "midYear" ? [yen(opening + opening + net), 2n] : timing === "beginning" ? [yen(opening + net), 1n] : [opening, 1n];
  return ctx.money.mulRatio(amount, f.num * BigInt(months), f.den * 12n * half, "conv.investment.return");
}

/** 預金・外貨預金の既定の資産クラス（assetMix を省略したとき） */
const CASH_KINDS: Readonly<Record<string, string>> = { deposit: "cash.deposit", fxDeposit: "cash.foreign", realEstate: "realEstate" };

/**
 * 器のその年の利回り: 資産クラスの配分（assetMix）×前提の資産クラスごとの利回り（assumptions.assetReturns）。
 * 前提に無い資産クラスは運用利回り（assumptions.investmentReturn）、ただし不動産は0。assetMix を省略した器は、預金・外貨預金・不動産は
 * その資産クラス、ほかは運用利回り。部品の reads に assumptions.investmentReturn と assumptions.assetReturns が要る
 */
export function accountReturnRate(ctx: Ctx, account: { readonly kind: string; readonly assetMix?: readonly { readonly assetClass: string; readonly share: string }[] }, year: number): Rate {
  const classRate = (cls: string): Rate => {
    const fallback = cls === "realEstate" ? RATE_ZERO : ctx.assumption("investmentReturn", year);
    return ctx.assumptionIn("assetReturns", cls, year, fallback) ?? fallback;
  };
  const mix = account.assetMix;
  if (mix === undefined || mix.length === 0) {
    const cls = CASH_KINDS[account.kind];
    return cls === undefined ? ctx.assumption("investmentReturn", year) : classRate(cls);
  }
  if (mix.length === 1) return classRate((mix[0] as { assetClass: string }).assetClass);
  let r = RATE_ZERO;
  for (const m of mix) r = ctx.rate.add(r, ctx.rate.mul(classRate(m.assetClass), ctx.rate.of(m.share)));
  return r;
}

/**
 * 計算基準年の価格で入れた額を、年ごとに伸ばした額（その年の額）。伸び方は物価上昇率（前提 inflation。教育費は educationInflation が
 * あればそれ）・固定の率・伸ばさないのどれか。fromYear の額が amount で、翌年からその年の率で伸ばす（1年ごとに円未満切り捨て。conv.expense.growth）。
 * 部品のマニフェストの reads に assumptions.inflation（教育費は assumptions.educationInflation も）が要る
 */
export function grownByYear(
  ctx: Ctx,
  amount: Yen,
  growth: { readonly kind: "inflation" | "rate" | "none"; readonly rate?: string } | undefined,
  fromYear: number,
  toYear: number,
  series: "inflation" | "educationInflation" = "inflation",
): Map<number, Yen> {
  const out = new Map<number, Yen>();
  const kind = growth?.kind ?? "inflation";
  const fixed = kind === "rate" ? ctx.rate.of(growth?.rate ?? "0") : RATE_ZERO;
  let v = amount;
  for (let y = fromYear; y <= toYear; y++) {
    if (y > fromYear && kind !== "none") {
      const r =
        kind === "rate"
          ? fixed
          : series === "educationInflation"
            ? ctx.assumption("educationInflation", y, ctx.assumption("inflation", y, RATE_ZERO))
            : ctx.assumption("inflation", y, RATE_ZERO);
      if (ctx.rate.compare(r, RATE_ZERO) !== 0) v = yen(v + ctx.money.mulRate(v, r, "conv.expense.growth"));
    }
    out.set(y, v);
  }
  return out;
}

/** 年額を12か月に分けた額（端数は最初の月。conv.expense.share）。月額 × 12 の年額なら各月は同じ */
export function monthlyParts(ctx: Ctx, annual: Yen): Yen[] {
  return ctx.money.allocate(annual, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.expense.share", "first");
}

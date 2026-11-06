// 部品が共通に使う小さな関数（公式SDK）。年齢の値（unit: years）の切り替えの月・年度・働き方の種類
import { EngineError } from "../errors.ts";
import type { Ctx } from "../registry/ctx.ts";
import type { BuildingStructure, Flow, MemberInput, RealEstateValuationSetting, ReturnStageInput } from "../engine/types.ts";
import { numTable } from "../engine/numTable.ts";
import { RATE_ONE, RATE_ZERO, type Rate } from "../money/rate.ts";
import { addYen, yen, type Yen } from "../money/yen.ts";
import type { AgeSwitch } from "../time/ageSwitch.ts";
import { formatYm, monthIndex, monthOf, parseYm, yearOf, type MonthIndex } from "../time/month.ts";
import { stageAt, stageSteps, type StageStep } from "./stages.ts";
import type { HealthStatusMonth } from "./contracts.ts";

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

/**
 * その月に払っている住民税の年度（6月から翌年5月。前年の所得に対する年度分。0003 の2）。計算基準月のこの年度が、計算が住民税を求める
 * 最初の年度（plan.memberFlows）。それより前の年度の住民税で決まる判定（修学支援・保育料・年金生活者支援給付金）は、この年度の住民税で行う
 * （前の年度の所得の年の制度の値は制度データに無いことがある。0007 の追記: 最初の行より前の日は値が無い）
 */
export function residentTaxYearOf(m: MonthIndex): number {
  return monthOf(m) >= 6 ? yearOf(m) : yearOf(m) - 1;
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

/**
 * 収入の見込み（被扶養者・第3号の認定。その月からの1年）を数える12か月（"YYYY-MM"）。表の外の月（表の最後の月 end より後）は、
 * その1年前の月に置き換える（表の外の収入は計算しないので、0 にすると表の終わりに近い月だけ収入が少なく見え、表の長さで判定が変わる。
 * 0003 の追記）。事業所得の年額も、表の外の年は表の最後の年の額を使う（prospectiveYear）
 */
export function prospectiveMonths(m: MonthIndex, end: MonthIndex): string[] {
  return Array.from({ length: 12 }, (_, k) => {
    const x = (m + k) as MonthIndex;
    return formatYm(x > end ? ((x - 12) as MonthIndex) : x);
  });
}

/** 収入の見込みに使う年（表の外の年は表の最後の年。prospectiveMonths と同じ考え） */
export function prospectiveYear(y: number, end: MonthIndex): number {
  return y > yearOf(end) ? yearOf(end) : y;
}

/** 後期高齢者医療に入る年齢の値ID（socialInsurance.healthStatus と同じ）。healthStatusInFiscalYear を使う部品は params に書く */
export const LATE_ELDERLY_AGE = "socialInsurance.health.lateElderlyAge";

/**
 * その年度（4月〜翌年3月）の月ごとの健康保険の種類（socialInsurance.healthStatus）。年度の保険料（国民健康保険・後期高齢者医療）は
 * 年度の加入の月数で決まるので、表の最後の年の年度の、表の外の月（翌年1〜3月）も数える（0003 の追記: 表の長さで、ある年の額を変えない）。
 * 表の外の月は、表の最後の月の種類が続くとみなす。ただし世帯を離れる月からは none、75歳（後期高齢者医療に入る年齢）の月からは
 * lateElderly（どちらも入力と年齢だけで決まる）。使う部品は reads に member.leaves、params に LATE_ELDERLY_AGE を書く
 */
export function healthStatusInFiscalYear(ctx: Ctx, member: string, fy: number): readonly HealthStatusMonth[] {
  const last = fiscalYearEnd(fy);
  const got = ctx.callMonths<HealthStatusMonth>("socialInsurance.healthStatus", { member }, "months", fiscalYearStart(fy), last);
  const end = ctx.time.end;
  if (last <= end) return got;
  const tail = got.find((x) => parseYm(x.month) === end);
  if (tail === undefined) return got;
  const me = ctx.get<MemberInput>("member", member);
  const leaves = me.leaves === null ? null : ctx.time.resolve(me.leaves);
  const late = ageMonth(ctx, ctx.time.base, LATE_ELDERLY_AGE, member);
  const out = [...got];
  for (let m = (end + 1) as MonthIndex; m <= last; m = (m + 1) as MonthIndex) {
    const month = formatYm(m);
    if (leaves !== null && m >= leaves) out.push({ month, kind: "none" });
    else if (tail.kind !== "none" && m >= late) out.push({ month, kind: "lateElderly" });
    else out.push({ ...tail, month });
  }
  return out;
}

/** 年金から保険料・住民税を差し引く（特別徴収）年金の年額の下限の値ID。読む部品は params と requires（pension.oldAge）に書く */
export const PENSION_SPECIAL_MINIMUM = "socialInsurance.specialCollection.minimumPension";

/**
 * その年度（4月〜翌年3月）に払う年金が、特別徴収の下限（年18万円）以上か。下限は valuesFy の年度の値（計算基準月の年度より前の年度を、
 * 計算基準月の年度の制度の値で計算する保険料の部品のため。省略はその年度）
 */
export function pensionSpecial(ctx: Ctx, member: string, fy: number, valuesFy: number = fy): boolean {
  const min = ctx.at(fiscalYearStart(valuesFy)).paramYen(PENSION_SPECIAL_MINIMUM);
  if (min === null) return false;
  let s = 0;
  // その年度の支払いだけを読む（ほかの年度の年金が変わっても、呼んだ部品を計算し直さない）
  const payments = ctx.callMonths<{ ym: string; amount: Yen }>("pension.oldAge", { member }, "payments", fiscalYearStart(fy), fiscalYearEnd(fy));
  for (const p of payments) s += p.amount;
  // 表の最後の年の年度は、翌年2月の支払いが表の外にある。表の最後の月（12月）の支払いと同じ額とみなして足す（0003 の追記: 表の長さで、
  // ある年の判定を変えない）
  const end = ctx.time.end;
  if (fiscalYearEnd(fy) > end) {
    const lastYm = formatYm(end);
    for (const p of payments) if (p.ym === lastYm) s += p.amount;
  }
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
  // 数の鍵の表で足す（Map より速い。0005 の追記（2026-10-10））。最後に年の昇順に並べる
  const sums = numTable<number>();
  const years: number[] = [];
  for (const f of flows) {
    const y = yearOf(parseYm(f.ym));
    const cur = sums[y];
    if (cur === undefined) years.push(y);
    sums[y] = (cur ?? 0) + f.amount;
  }
  return years.sort((a, b) => a - b).map((year) => ({ year, amount: yen(sums[year] as number) }));
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
/** 預金の利回り（assumptions.depositReturn）を代わりに使う資産クラス（預金・外貨預金。資産配分の現金も同じ） */
const DEPOSIT_CLASSES: ReadonlySet<string> = new Set(["cash.deposit", "cash.foreign"]);
/** 器の利回りも資産の配分も無いときの利回りを0にする器（暗号資産。0122） */
const ZERO_DEFAULT_KINDS: ReadonlySet<string> = new Set(["cryptoAsset"]);
/** 運用する器（資産配分・利回りの書き換え（returnShifts）を当てる。まとめた金融資産の器を含む。0026） */
export const INVEST_KINDS: ReadonlySet<string> = new Set(["taxable", "nisa", "childNisa", "juniorNisa", "legacyNisa", "ideco", "corporateDc", "esop", "pooled"]);

type Mix = readonly { readonly assetClass: string; readonly share: string }[];

/** 器の利回りの決め方（器の利回りか資産の配分。段階の1段もこの形） */
interface ReturnSpec {
  readonly assetMix?: Mix;
  readonly expectedReturn?: string;
}

interface ReturnAccount extends ReturnSpec {
  readonly kind: string;
  readonly fee?: string;
  /** 利回りの段階（0040） */
  readonly returnStages?: readonly ReturnStageInput[];
  /** 利回りの例外の年（0040） */
  readonly returnExceptions?: readonly { readonly year: number; readonly expectedReturn: string }[];
}

/** 利回りの段階を月に解いた並び（段の値は器の利回りか資産の配分のどちらか一方） */
function returnSteps(ctx: Ctx, account: ReturnAccount): StageStep<ReturnSpec>[] {
  return stageSteps(ctx, account.returnStages, (s): ReturnSpec => (s.assetMix !== undefined ? { assetMix: s.assetMix } : { expectedReturn: s.expectedReturn ?? "0" }));
}

/** 器の決め方 spec のその年の利回り（運用の費用・利回りの書き換えの前）。リバランスしない配分のずれは driftFrom の年から数える */
function specRate(ctx: Ctx, kind: string, spec: ReturnSpec, year: number, driftFrom: number): Rate {
  const classRate = (cls: string, y: number): Rate => {
    // 前提に無い資産クラスの代わり: 不動産は0、預金・外貨預金は預金の利回り（省略は運用利回り。前の版の要求は今までどおり）、ほかは運用利回り
    const fallback = cls === "realEstate" ? RATE_ZERO : DEPOSIT_CLASSES.has(cls) ? ctx.assumption("depositReturn", y, ctx.assumption("investmentReturn", y)) : ctx.assumption("investmentReturn", y);
    return ctx.assumptionIn("assetReturns", cls, y, fallback) ?? fallback;
  };
  const mix = spec.assetMix;
  if (spec.expectedReturn !== undefined) return ctx.rate.of(spec.expectedReturn);
  if (mix === undefined || mix.length === 0) {
    // 暗号資産は、器の利回りも資産の配分も無ければ0（根拠を示せる見込みの利回りが無い。0122）
    if (ZERO_DEFAULT_KINDS.has(kind)) return RATE_ZERO;
    const cls = CASH_KINDS[kind];
    return cls === undefined ? ctx.assumption("investmentReturn", year) : classRate(cls, year);
  }
  if (mix.length === 1) return classRate((mix[0] as { assetClass: string }).assetClass, year);
  const setting = INVEST_KINDS.has(kind) ? ctx.setting<{ method?: string; allocation?: { rebalance?: boolean } }>("investment") : undefined;
  const drift = setting?.method === "allocation" && setting.allocation?.rebalance === false;
  // リバランスしないとき: 重み＝割合×driftFrom の年からの増え方（Π(1＋その年の利回り)）
  const weights = mix.map((m) => {
    let w = ctx.rate.of(m.share);
    if (drift) for (let y = driftFrom; y < year; y++) w = ctx.rate.mul(w, ctx.rate.add(RATE_ONE, classRate(m.assetClass, y)));
    return w;
  });
  let total = RATE_ZERO;
  for (const w of weights) total = ctx.rate.add(total, w);
  let r = RATE_ZERO;
  mix.forEach((m, i) => {
    const w = weights[i] as Rate;
    const share = drift && ctx.rate.compare(total, RATE_ZERO) > 0 ? ctx.rate.div(w, total) : w;
    r = ctx.rate.add(r, ctx.rate.mul(classRate(m.assetClass, year), share));
  });
  return r;
}

/**
 * 器のその年の利回り: 資産クラスの配分（assetMix）×前提の資産クラスごとの利回り（assumptions.assetReturns）。
 * 前提に無い資産クラスは運用利回り（assumptions.investmentReturn）、ただし不動産は0、預金・外貨預金（cash.deposit・cash.foreign）は預金の利回り
 * （assumptions.depositReturn。省略は運用利回り）。assetMix を省略した器は、預金・外貨預金・不動産はその資産クラス、暗号資産は0（0122）、
 * ほかは運用利回り。部品の reads に assumptions.investmentReturn・assumptions.depositReturn・assumptions.assetReturns が要る。
 * 0026: FP が入れた器の利回り（expectedReturn）があればそれを使う。運用の費用（fee）を引く。資産配分の入れ方でリバランスしないときは、
 * 資産クラスごとの増え方で割合がずれる（計算基準年からの資産クラスの増え方で重みを付け直す）。運用する器には利回りの書き換え（returnShifts）を当てる。
 * reads に assumptions.investment と assumptions.returnShifts も要る
 * 0040: 利回りの段階（returnStages）があれば、その年の12月の段（器の利回りか資産の配分。段より前の年は器の欄）を使い、リバランスしない
 * 配分のずれは段の始まりの年から数え直す。少しずつ移す途中の年は、前後の段のその年の利回りを進んだ年数で按分する（今＋(次−今)×j÷n）。
 * 利回りの例外の年（returnExceptions）は、その年だけ書いた利回りにする。どちらも運用の費用と利回りの書き換えはその後に当てる。
 * 段階・例外を読むには reads に account.returnStages・account.returnExceptions が要る
 */
export function accountReturnRate(ctx: Ctx, account: ReturnAccount, year: number): Rate {
  const baseYear = yearOf(ctx.time.base);
  let exception: string | undefined;
  for (const e of account.returnExceptions ?? []) if (e.year === year) exception = e.expectedReturn;
  let r: Rate;
  if (exception !== undefined) r = ctx.rate.of(exception);
  else if (account.returnStages === undefined || account.returnStages.length === 0) r = specRate(ctx, account.kind, account, year, baseYear);
  else {
    const steps = returnSteps(ctx, account);
    const hit = stageAt(steps, monthIndex(year, 12));
    if (hit.v === null) r = specRate(ctx, account.kind, account, year, baseYear);
    else {
      const from = Math.max(baseYear, yearOf((steps[hit.k] as StageStep<ReturnSpec>).m));
      r = specRate(ctx, account.kind, hit.v, year, from);
      if (hit.toward !== null) {
        const { v, j, n } = hit.toward;
        const next = specRate(ctx, account.kind, v, year, from);
        r = ctx.rate.add(r, ctx.rate.div(ctx.rate.mul(ctx.rate.sub(next, r), ctx.rate.of(String(j))), ctx.rate.of(String(n))));
      }
    }
  }
  if (account.fee !== undefined) r = ctx.rate.sub(r, ctx.rate.of(account.fee));
  if (INVEST_KINDS.has(account.kind)) {
    for (const s of ctx.setting<readonly { from: number; to?: number; add?: string; cap?: string }[]>("returnShifts") ?? []) {
      if (year < s.from || (s.to !== undefined && year > s.to)) continue;
      if (s.add !== undefined) r = ctx.rate.add(r, ctx.rate.of(s.add));
      if (s.cap !== undefined && ctx.rate.compare(r, ctx.rate.of(s.cap)) > 0) r = ctx.rate.of(s.cap);
    }
  }
  return r;
}

/** 器のその年の資産の配分（0040: 利回りの段階があれば、その年の12月の段の配分。器の利回りの段なら配分なし） */
export function accountMixAt(ctx: Ctx, account: ReturnAccount, year: number): Mix | undefined {
  if (account.returnStages === undefined || account.returnStages.length === 0) return account.assetMix;
  const hit = stageAt(returnSteps(ctx, account), monthIndex(year, 12));
  return hit.v === null ? account.assetMix : hit.v.assetMix;
}

/**
 * 時価の下落（前提 marketShocks の1件）で下げる割合（0026）。資産クラス（assetClasses）を書いた下落は、器の資産の配分のうち、その資産クラスの
 * 割合の合計だけ下げる（配分の無い運用の器は全体、運用でない器（預金など）は下げない＝null）。書いていない下落は全体（1）
 */
export function shockShare(ctx: Ctx, account: { readonly kind: string; readonly assetMix?: readonly { readonly assetClass: string; readonly share: string }[] }, classes: readonly string[] | undefined): Rate | null {
  if (classes === undefined) return RATE_ONE;
  const mix = account.assetMix;
  if (mix === undefined || mix.length === 0) return INVEST_KINDS.has(account.kind) ? RATE_ONE : null;
  let s = RATE_ZERO;
  for (const m of mix) if (classes.includes(m.assetClass)) s = ctx.rate.add(s, ctx.rate.of(m.share));
  return ctx.rate.compare(s, RATE_ZERO) > 0 ? s : null;
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

/**
 * 年金の支払い（偶数月に前2か月分）。months は月ごとの年額（その月に支給される額の12倍）。各支払いは2か月分の年額の合計÷12 の1円未満を
 * roundingId で丸め、3月から翌年2月までの丸めの残りの合計（1円未満は丸める）を2月の支払い（無ければその期間の最後の支払い）に足す
 * （国民年金法18条の2。pension.oldAge と同じ決まり。遺族年金・障害年金の部品が使う）
 */
export function evenMonthPayments(ctx: Ctx, months: readonly { readonly month: string; readonly amount: Yen }[], roundingId: string): { ym: string; amount: Yen; accrualYear: number }[] {
  const pays = new Map<string, { sum: number; accrual: number }>();
  for (const x of months) {
    if (x.amount <= 0) continue;
    const m = parseYm(x.month);
    const paid = formatYm(addMonthsLocal(m, monthOf(m) % 2 === 1 ? 1 : 2));
    const cur = pays.get(paid) ?? { sum: 0, accrual: yearOf(m) };
    cur.sum += x.amount;
    pays.set(paid, cur);
  }
  const remainder = new Map<number, number>();
  const lastOf = new Map<number, string>();
  const list: { ym: string; amount: Yen; accrualYear: number }[] = [];
  for (const [ym, v] of [...pays.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const pm = parseYm(ym);
    const period = monthOf(pm) >= 3 ? yearOf(pm) : yearOf(pm) - 1;
    const amount = ctx.at(pm).money.divInt(yen(v.sum), 12, roundingId);
    remainder.set(period, (remainder.get(period) ?? 0) + (v.sum - ctx.money.mulRatio(amount, 12, 1, "conv.exact")));
    lastOf.set(period, ym);
    list.push({ ym, amount, accrualYear: v.accrual });
  }
  for (const [period, rem] of remainder) {
    const add = ctx.at(monthIndex(period + 1, 2)).money.divInt(yen(rem), 12, roundingId);
    if (add <= 0) continue;
    const feb = formatYm(monthIndex(period + 1, 2));
    const i = list.findIndex((p) => p.ym === feb);
    const k = i >= 0 ? i : list.findIndex((p) => p.ym === lastOf.get(period));
    if (k >= 0) list[k] = { ...(list[k] as { ym: string; amount: Yen; accrualYear: number }), amount: yen((list[k] as { amount: Yen }).amount + add) };
  }
  return list.filter((p) => p.amount > 0);
}

const addMonthsLocal = (m: MonthIndex, k: number): MonthIndex => (m + k) as MonthIndex;

/**
 * その年の中途に万一の想定（死亡）で亡くなった構成員の死亡の月（その年に亡くならなければ null）。
 * 控除対象配偶者・扶養親族などに当たるかは12月31日の現況で判定するが、その時までに亡くなった人は死亡の時の現況で判定する
 * （所得税法85条3項ただし書・地方税法314条の2第8項）。呼ぶ部品は requires に contingency.event を書く
 */
export function deathMonthIn(ctx: Ctx, member: string, year: number): MonthIndex | null {
  const ev = ctx.call<{ event: { kind: string; month: string } | null }>("contingency.event", { member }).event;
  if (ev === null || ev.kind !== "death") return null;
  const m = parseYm(ev.month);
  return yearOf(m) === year ? m : null;
}

/** 関係の辺から、月 m に member の配偶者である構成員（from・to は解決した月で比べる） */
export function spousesAt(
  ctx: Ctx,
  relations: readonly { readonly type: string; readonly a?: string; readonly b?: string; readonly from?: unknown; readonly to?: unknown }[],
  member: string,
  m: MonthIndex,
): string[] {
  const out: string[] = [];
  for (const r of relations) {
    if (r.type !== "spouse" || (r.a !== member && r.b !== member)) continue;
    const from = r.from === null || r.from === undefined ? null : ctx.time.resolve(r.from as never);
    const to = r.to === null || r.to === undefined ? null : ctx.time.resolve(r.to as never);
    if ((from !== null && from > m) || (to !== null && to < m)) continue;
    out.push((r.a === member ? r.b : r.a) as string);
  }
  return out;
}

/**
 * member の子（関係の parentOf があればそれで、無ければ member が本人・配偶者のとき家族の種類が child の構成員）。
 * 構成員と関係は部品が reads に書いて読んだもの（member.kind・relation.type・relation.parent・relation.child が要る）
 */
export function childrenOf<M extends { readonly id: string; readonly kind: string }>(
  members: readonly M[],
  relations: readonly { readonly type: string; readonly parent?: string; readonly child?: string }[],
  member: string,
): M[] {
  const me = members.find((x) => x.id === member);
  const parentsGiven = relations.some((r) => r.type === "parentOf");
  return members.filter((c) =>
    c.kind === "child" && (parentsGiven ? relations.some((r) => r.type === "parentOf" && r.parent === member && r.child === c.id) : me !== undefined && (me.kind === "self" || me.kind === "spouse")),
  );
}

/**
 * 万一のときの扱い（onContingency）の割合: 万一の種類が kinds（省略は死亡だけ）に入り、その月が万一の月より後なら、
 * continue は1、stop は0、ratio はその割合。当てないときは null（そのまま）
 */
export function contingencyRatio(
  ctx: Ctx,
  on: { readonly mode: "continue" | "stop" | "ratio"; readonly ratio?: string; readonly kinds?: readonly string[] } | undefined,
  event: { readonly kind: string; readonly month: string } | null,
  m: MonthIndex,
): Rate | null {
  if (on === undefined || event === null || on.mode === "continue") return null;
  if (!(on.kinds ?? ["death"]).includes(event.kind)) return null;
  if (m <= parseYm(event.month)) return null;
  return on.mode === "stop" ? RATE_ZERO : ctx.rate.of(on.ratio ?? "1");
}

/** 老齢基礎年金の月数に換算する免除の割合の値ID（分子。分母は EXEMPTION_WEIGHT_DENOMINATOR）。国民年金法27条ただし書・平成16年改正法附則10条 */
export const EXEMPTION_WEIGHT_IDS = {
  quarter: "pension.basic.exemptionWeight.quarter",
  half: "pension.basic.exemptionWeight.half",
  threeQuarters: "pension.basic.exemptionWeight.threeQuarters",
  full: "pension.basic.exemptionWeight.full",
} as const;
export const EXEMPTION_WEIGHT_DENOMINATOR = "pension.basic.exemptionWeight.denominator";

/** 第1号の期間の内訳（pension.record の出力 category1 と同じ形） */
export interface ExemptionCounts {
  readonly exemptQuarter: number;
  readonly exemptHalf: number;
  readonly exemptThreeQuarters: number;
  readonly exemptFull: number;
  readonly pre2009?: { readonly exemptQuarter: number; readonly exemptHalf: number; readonly exemptThreeQuarters: number; readonly exemptFull: number };
}

/**
 * 免除の月（4分の1・半額・4分の3・全額。学生納付特例・納付猶予は入れない）を、老齢基礎年金の額の月数に換算した月数（分数）。
 * 割合は免除の月で決まる（2009年3月以前は 5/6・2/3・1/2・1/3、2009年4月以後は 7/8・3/4・5/8・1/2）ので、制度データを2009年3月と2009年4月で引く。
 * 480月を超える分の割合（27条3・5・7号）は扱わない（呼ぶ側が480月で止める）。部品は値IDを params に書くこと
 */
export function exemptionMonths(ctx: Ctx, c: ExemptionCounts): { num: bigint; den: bigint } {
  const pre = c.pre2009 ?? { exemptQuarter: 0, exemptHalf: 0, exemptThreeQuarters: 0, exemptFull: 0 };
  let num = 0n;
  let den = 1n;
  const add = (month: MonthIndex, counts: readonly [string, number][]) => {
    if (counts.every(([, n]) => n <= 0)) return;
    const at = ctx.at(month);
    const d = BigInt(at.paramCount(EXEMPTION_WEIGHT_DENOMINATOR) ?? 1);
    let part = 0n;
    for (const [id, n] of counts) if (n > 0) part += BigInt(n) * BigInt(at.paramCount(id) ?? 0);
    num = num * d + part * den;
    den = den * d;
  };
  add(monthIndex(2009, 3), [
    [EXEMPTION_WEIGHT_IDS.quarter, pre.exemptQuarter],
    [EXEMPTION_WEIGHT_IDS.half, pre.exemptHalf],
    [EXEMPTION_WEIGHT_IDS.threeQuarters, pre.exemptThreeQuarters],
    [EXEMPTION_WEIGHT_IDS.full, pre.exemptFull],
  ]);
  add(monthIndex(2009, 4), [
    [EXEMPTION_WEIGHT_IDS.quarter, c.exemptQuarter - pre.exemptQuarter],
    [EXEMPTION_WEIGHT_IDS.half, c.exemptHalf - pre.exemptHalf],
    [EXEMPTION_WEIGHT_IDS.threeQuarters, c.exemptThreeQuarters - pre.exemptThreeQuarters],
    [EXEMPTION_WEIGHT_IDS.full, c.exemptFull - pre.exemptFull],
  ]);
  return { num, den };
}

// ---- 不動産の評価（土地と建物に分ける。0025 の2。持ち家 housing.valuation と住まい以外の不動産 asset.realEstate で共通）----

/** 構造ごとの耐用年数の目安（年。住宅用の建物の法定耐用年数） */
export const USEFUL_LIFE: Readonly<Record<BuildingStructure, number>> = { wood: 22, lightSteel: 19, steel: 34, rc: 47 };
/** 土地の割合・建物の残りの価値の下限・売却の費用の割合の目安の値ID（sdk/estimates.ts。ctx.estimate で引く。0111 の2回目） */
export const LAND_SHARE = "preset.realEstate.landShare";
export const RESIDUAL_FLOOR = "preset.realEstate.residualFloor";
export const SALE_COST_RATE = "preset.realEstate.saleCostRate";

const VALUATION_RULE = "conv.asset.valuation";

/** 築年数 a の年末の建物の残りの割合（下限つき） */
function remainingShare(ctx: Ctx, age: number, life: number, floor: Rate): Rate {
  if (age <= 0) return RATE_ONE;
  const raw = ctx.rate.sub(RATE_ONE, ctx.rate.div(ctx.rate.of(String(age)), ctx.rate.of(String(life))));
  return ctx.rate.compare(raw, floor) < 0 ? floor : raw;
}

/**
 * 土地と建物に分けた年末の評価額（0025 の2）。基にする額 basis（y0 の年の値）を土地の割合で分け、土地は y0 の翌年から毎年の上昇率
 * （growthOf）を当て（1年ごとに円未満切り捨て）、建物は構造の耐用年数で定額で減らして下限より下げない（建物＝基にする建物の額×f(その年)÷f(y0)）。
 * 返す関数は年の昇順に呼ぶ（土地は前の年の額から伸ばす）
 */
export function landBuildingValuer(
  ctx: Ctx,
  o: {
    readonly basis: Yen;
    readonly y0: number;
    readonly share: string;
    readonly structure: BuildingStructure;
    readonly builtYear: number;
    readonly setting: RealEstateValuationSetting | undefined;
    readonly growthOf: (year: number) => Rate;
    /** 土地の額（入れたら割合で分けずにこの額。基にする額で止める。注文住宅の土地の代金。0115） */
    readonly landAmount?: Yen;
  },
): { readonly land0: Yen; readonly building0: Yen; readonly at: (year: number) => { readonly land: Yen; readonly building: Yen } } {
  const land0 = o.landAmount !== undefined ? (o.landAmount > o.basis ? o.basis : o.landAmount) : ctx.money.mulRate(o.basis, ctx.rate.of(o.share), VALUATION_RULE);
  const building0 = yen(o.basis - land0);
  const life = o.setting?.usefulLife?.[o.structure] ?? USEFUL_LIFE[o.structure];
  const floor = ctx.rate.of(o.setting?.residualFloor ?? String(ctx.estimate(RESIDUAL_FLOOR)));
  const f0 = remainingShare(ctx, o.y0 - o.builtYear, life, floor);
  let land = land0;
  let landYear = o.y0;
  const landAt = (y: number): Yen => {
    while (landYear < y) {
      landYear++;
      const g = o.growthOf(landYear);
      if (ctx.rate.compare(g, RATE_ZERO) !== 0) land = addYen(land, ctx.money.mulRate(land, g, VALUATION_RULE));
    }
    return y < o.y0 ? land0 : land;
  };
  const buildingAt = (y: number): Yen => {
    const f = remainingShare(ctx, y - o.builtYear, life, floor);
    // 下限が0で、基にする年にもう耐用年数を過ぎていたときは、入れた建物の額のまま
    if (ctx.rate.compare(f, f0) === 0 || ctx.rate.compare(f0, RATE_ZERO) === 0) return building0;
    return ctx.money.mulRate(building0, ctx.rate.div(f, f0), VALUATION_RULE);
  };
  return { land0, building0, at: (y) => ({ land: landAt(y), building: buildingAt(y) }) };
}

/** 失業の給付を受け取ると推定する、辞めてから次に働くまでの月数（推定の決まり。制度の値ではない。0037） */
export const UNEMPLOYMENT_ESTIMATE_MIN_IDLE_MONTHS = 3;

/**
 * 辞めた後に雇用保険の失業の給付（基本手当）を受け取るかの推定（0037）。画面が新しい世帯を作るときに働き方の期間の
 * `unemploymentClaim` に入れる値で、エンジン（benefit.unemployment）は欄が無ければ受け取らない（開いた世帯を黙って変えない）。
 * 65歳未満（elderlyAge は制度の値 employmentInsurance.basicAllowance.elderlyAge。省略は65）で辞め、次に働くまで3か月以上あり、
 * 辞め方が休業のまま辞める（sickLeave）でなければ受け取る。65歳以上の高年齢求職者給付金は推定では受け取らない
 */
export function estimateUnemploymentClaim(o: { readonly ageAtLeaving: number; readonly idleMonths: number; readonly endsWith?: string; readonly elderlyAge?: number }): boolean {
  return o.ageAtLeaving < (o.elderlyAge ?? 65) && o.idleMonths >= UNEMPLOYMENT_ESTIMATE_MIN_IDLE_MONTHS && o.endsWith !== "sickLeave";
}

// ---- 世帯の外の家族（0035 の4） ----

/** 世帯の外の家族（家計を世帯と別にする家族。構成員の印 outside）か */
export function isOutside(m: { readonly outside?: unknown }): boolean {
  return m.outside !== undefined && m.outside !== null;
}

/**
 * 世帯の外の家族の、月 month の家計を1つにする期間の印（期間に入っていなければ null）。living は生活費の人数に入れる（既定 true）、
 * income は年金・給与などの収入を世帯に入れる（既定 false）。期間の終わりの月を含む。
 * 世帯の外の家族の leaves は亡くなる見込みなので、その月からは期間に入れない（期間の終わりが無くても、亡くなる見込みの月で切る。0035 の4 の追記）
 */
export function outsidePeriodAt(ctx: Ctx, m: MemberInput, month: MonthIndex): { living: boolean; income: boolean } | null {
  if (m.leaves !== null && month >= ctx.time.resolve(m.leaves)) return null;
  for (const p of m.outside?.periods ?? []) {
    const from = p.from === null ? null : ctx.time.resolve(p.from);
    const to = p.to === null ? null : ctx.time.resolve(p.to);
    if ((from === null || from <= month) && (to === null || to >= month)) return { living: p.living ?? true, income: p.income ?? false };
  }
  return null;
}

/**
 * 世帯の外の家族のお金（member.wallet。0042）を計算するか: 世帯の外の家族で、預金（balance）を入れたときだけ（預金の欄が空なら、
 * その人のお金は見ず、介護の費用は今までどおり世帯が払う）
 */
export function hasWallet(m: MemberInput): boolean {
  return isOutside(m) && m.wallet?.balance !== undefined;
}

/** 世帯の外の家族が、どこかの期間で収入を世帯に入れるか */
export function outsideIncomeEver(m: MemberInput): boolean {
  return (m.outside?.periods ?? []).some((p) => p.income === true);
}

/** 世帯の中の構成員（世帯の外の家族を除く。世帯の税・社会保険・給付・遺族の判定の顔ぶれ） */
export function householdMembers<M extends { readonly outside?: unknown }>(members: readonly M[]): M[] {
  return members.filter((m) => !isOutside(m));
}

/**
 * member と同じ世帯（税・社会保険・給付の判定の世帯）の構成員（member を含む）。世帯の中の人なら世帯の中の人。世帯の外の家族なら、
 * その人と、配偶者の関係でつながる世帯の外の家族（両親など。月 at の配偶者だけ。at を省くといつでも）。亡くなる見込み（leaves）の後の
 * 判定は、呼ぶ部品がその月にいる人で絞る（片方が亡くなった後は残る人を単身として判定する）
 */
export function sameHousehold<M extends { readonly id: string; readonly outside?: unknown }>(
  ctx: Ctx,
  members: readonly M[],
  relations: readonly { readonly type: string; readonly a?: string; readonly b?: string; readonly from?: unknown; readonly to?: unknown }[],
  member: string,
  at?: MonthIndex,
): M[] {
  const me = members.find((x) => x.id === member);
  if (me === undefined || !isOutside(me)) return householdMembers(members);
  const spouses = new Set(
    at === undefined ? relations.flatMap((r) => (r.type === "spouse" && (r.a === member || r.b === member) ? [(r.a === member ? r.b : r.a) as string] : [])) : spousesAt(ctx, relations, member, at),
  );
  return members.filter((x) => x.id === member || (spouses.has(x.id) && isOutside(x)));
}

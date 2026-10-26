// お金の行（0044）: 出るお金の行（periodicExpenses）と入るお金の行（incomeFlows）に共通の、支払い・受け取りの月と額の解き方と、
// 入るお金の種類ごとの既定（課税の扱い・表の行）。画面の側の既定（app/src/workspace/input/moneyRows.ts）は同じ表を持つ（テストで突き合わせる）
import type { AmountExceptionInput, AmountStageInput, GrowthInput, IncomeFlowInput, IncomeTaxTreatment, OnContingencyInput, ValueBox } from "../engine/types.ts";
import { INCOME_KIND_DEFAULTS } from "./incomeKinds.ts";

export { INCOME_KIND_DEFAULTS };
import type { Ctx } from "../registry/ctx.ts";
import type { ContingencyEvent } from "./contracts.ts";
import { boxValue } from "./box.ts";
import { contingencyRatio, grownByYear } from "./helpers.ts";
import { stagedYen } from "./stages.ts";
import { addMonths, yearOf, type MonthIndex } from "../time/month.ts";
import type { Timepoint } from "../time/timepoint.ts";
import { yen, type Yen } from "../money/yen.ts";
import type { Rate } from "../money/rate.ts";

/** 1回だけの行か（月額でなく、終わりが始まりと同じ月） */
export function isOnceRow(ctx: Ctx, r: { readonly from: Timepoint; readonly to?: Timepoint | null; readonly monthly?: boolean }): boolean {
  if (r.monthly === true || r.to === undefined || r.to === null) return false;
  return ctx.time.resolve(r.to) === ctx.time.resolve(r.from);
}

/** 入るお金の行の課税の扱い（省略は種類の既定） */
export function incomeTreatment(f: Pick<IncomeFlowInput, "kind" | "taxTreatment">): IncomeTaxTreatment {
  return f.taxTreatment ?? INCOME_KIND_DEFAULTS[f.kind].tax;
}

/** 入るお金の行の表の行（省略は種類の既定。1回の行とくり返す行で違う種類がある） */
export function incomeRow(ctx: Ctx, f: IncomeFlowInput): string {
  if (f.row !== undefined) return f.row;
  const d = INCOME_KIND_DEFAULTS[f.kind];
  return isOnceRow(ctx, f) ? d.once : d.repeat;
}

/** お金の行の1回の支払い・受け取り */
export interface MoneyRowPayment {
  readonly month: MonthIndex;
  /** 段階・例外の年を当てた計算基準年の価格の額 */
  readonly base: Yen;
  /** 伸び方と万一のときの扱いを当てた額 */
  readonly amount: Yen;
  /** 万一のときの扱いを当てたか */
  readonly contingency: boolean;
}

/** お金の行の、計算に使う欄 */
export interface MoneyRowInput {
  readonly from: Timepoint;
  readonly to?: Timepoint | null;
  readonly everyYears: number;
  readonly monthly?: boolean;
  readonly amount: ValueBox<Yen>;
  readonly growth?: GrowthInput;
  readonly stages?: readonly AmountStageInput[];
  readonly exceptions?: readonly AmountExceptionInput[];
  readonly onContingency?: OnContingencyInput;
}

/**
 * お金の行の支払い・受け取り（計算基準月より前は除く）。最初の月から n年ごと（同じ月）に1回の額を、月額の行は毎月その額を、終わりの月まで。
 * 額は計算基準年の価格で、伸び方（省略は物価上昇率）で伸ばす。段階は支払いの月の段の額、例外の年はその年の支払いだけ例外の額（0040）。
 * 万一のときの扱いは、万一の想定の月の翌月から当てる（ev は当てる万一。払う人・受け取る人を入れた行は、その人の万一だけ）
 */
export function moneyRowPayments(ctx: Ctx, r: MoneyRowInput, ev: ContingencyEvent | null, roundingId: string): MoneyRowPayment[] {
  const { base, end } = ctx.time;
  const from = ctx.time.resolve(r.from);
  const to = r.to === undefined || r.to === null ? end : ctx.time.resolve(r.to);
  const amount = boxValue(r.amount) ?? yen(0);
  const staged = stagedYen(ctx, amount, r, roundingId);
  const out: MoneyRowPayment[] = [];
  if ((amount <= 0 && !staged.anyPositive) || from > end) return out;
  const series = new Map<number, Map<number, Yen>>();
  const grownOf = (a: Yen): Map<number, Yen> => {
    let g = series.get(a);
    if (g === undefined) {
      g = grownByYear(ctx, a, r.growth, yearOf(base), yearOf(end));
      series.set(a, g);
    }
    return g;
  };
  const step = r.monthly === true ? 1 : 12 * r.everyYears;
  for (let m: MonthIndex = from; m <= to && m <= end; m = addMonths(m, step)) {
    if (m < base) continue;
    const a = staged.plain ? amount : staged.at(m);
    if (a <= 0) continue;
    const v0 = grownOf(a).get(yearOf(m)) ?? a;
    const cr: Rate | null = contingencyRatio(ctx, r.onContingency, ev, m);
    const v = cr === null ? v0 : ctx.money.mulRate(v0, cr, roundingId);
    if (v > 0) out.push({ month: m, base: a, amount: v, contingency: cr !== null });
  }
  return out;
}

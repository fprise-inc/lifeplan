// 0003 の9: 制度の値を「どの時点の値を使うか」。引く日はここ1か所で決める
import { EngineError } from "../errors.ts";
import type { CivilDate } from "./civil.ts";
import { monthOf, yearOf, type MonthIndex } from "./month.ts";

export type AnchorKind = "moveIn" | "contract" | "acquisition" | "enrollment" | "benefitStart";
export const ANCHOR_KINDS: readonly AnchorKind[] = ["moveIn", "contract", "acquisition", "enrollment", "benefitStart"];

export type Basis =
  | { readonly type: "incomeYear" }
  | { readonly type: "priorYearIncome"; readonly switchMonth: number }
  | { readonly type: "month" }
  | { readonly type: "fiscalYear"; readonly startMonth: number }
  | { readonly type: "anchor"; readonly anchor: AnchorKind }
  | { readonly type: "birthDate" };

export type BasisType = Basis["type"];

/** 文字列の省略形を正規の形にする（引数のある型は既定値。anchor は省略できない） */
export function normalizeBasis(raw: unknown): Basis {
  const b = typeof raw === "string" ? { type: raw } : raw;
  if (typeof b !== "object" || b === null) throw new EngineError("E_ARGUMENT", ["basis"]);
  const o = b as Record<string, unknown>;
  switch (o.type) {
    case "incomeYear":
    case "month":
    case "birthDate":
      return { type: o.type };
    case "priorYearIncome":
      return { type: "priorYearIncome", switchMonth: monthArg(o.switchMonth, 6) };
    case "fiscalYear":
      return { type: "fiscalYear", startMonth: monthArg(o.startMonth, 4) };
    case "anchor":
      if (typeof o.anchor !== "string" || !(ANCHOR_KINDS as readonly string[]).includes(o.anchor)) {
        throw new EngineError("E_ARGUMENT", ["basis.anchor"]);
      }
      return { type: "anchor", anchor: o.anchor as AnchorKind };
    default:
      throw new EngineError("E_ARGUMENT", ["basis.type"]);
  }
}

function monthArg(v: unknown, dflt: number): number {
  if (v === undefined) return dflt;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 12) throw new EngineError("E_ARGUMENT", ["basis.month"]);
  return v;
}

export interface Lookup {
  /** 適用期間を引く日 */
  readonly date: CivilDate;
  /** 判定に使う所得の年（incomeYear・priorYearIncome のとき） */
  readonly incomeYear?: number;
}

export interface LookupContext {
  /** basis が anchor のとき、対象の物のその出来事の月（エンジンがイベントから解決したもの） */
  readonly anchorMonth?: MonthIndex;
}

/** 計算している月と basis から、値を引く日を決める */
export function lookupFor(basis: Basis, calc: MonthIndex, lc: LookupContext = {}): Lookup {
  const y = yearOf(calc);
  const m = monthOf(calc);
  switch (basis.type) {
    case "incomeYear":
      return { date: { year: y, month: 1, day: 1 }, incomeYear: y };
    case "priorYearIncome":
      // 切り替え月以降なら「前年の所得・今年の年度の値」、前なら「前々年の所得・前年の年度の値」
      return m >= basis.switchMonth
        ? { date: { year: y, month: basis.switchMonth, day: 1 }, incomeYear: y - 1 }
        : { date: { year: y - 1, month: basis.switchMonth, day: 1 }, incomeYear: y - 2 };
    case "month":
    case "birthDate":
      return { date: { year: y, month: m, day: 1 } };
    case "fiscalYear":
      return { date: { year: m >= basis.startMonth ? y : y - 1, month: basis.startMonth, day: 1 } };
    case "anchor": {
      if (lc.anchorMonth === undefined) throw new EngineError("E_ARGUMENT", ["basis.anchor.missing"]);
      return { date: { year: yearOf(lc.anchorMonth), month: monthOf(lc.anchorMonth), day: 1 } };
    }
    default:
      throw new EngineError("E_ARGUMENT", ["basis.type"]);
  }
}

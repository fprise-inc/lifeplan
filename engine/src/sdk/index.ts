// 計算部品が import してよい公式SDK（0006 の2）。丸め関数はここに置かず ctx.money だけで使う（0002・0006 の7）
export { defineComponent, type ComponentDefinition } from "../registry/define.ts";
export type { Ctx, MonthCtx, MoneyApi, RateApi, TimeApi, ParamOptions } from "../registry/ctx.ts";
export type { AnnualRow, CalcConventions, Flow, FlowsOutput, FlowInput, AnnualLumpSumInput } from "../engine/types.ts";
export { yen, addYen, subYen, negYen, sumYen, YEN_ZERO, type Yen, type Money } from "../money/yen.ts";
export { rate, RATE_ZERO, RATE_ONE, type Rate } from "../money/rate.ts";
export { addMonths, formatYm, monthIndex, monthOf, parseYm, yearOf, type MonthIndex } from "../time/month.ts";
export type { Timepoint } from "../time/timepoint.ts";
export { isUnder } from "../ids/cfTree.ts";
export { netByYear, tableYear } from "../engine/aggregate.ts";

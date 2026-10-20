// 持ち帰り用のレポートで顧客が動かすつまみを、プランの計算の要求に当てる（0030）。
// 当て方はアプリの結果の画面の対策と同じ部品（workspace/levers.ts の applyLevers・applyAdvisoryFee）を使う（同じ値なら同じ要求になる）。
import type { EngineRequest } from "../engine/types.ts";
import { monthlyMan } from "../presentation/format.ts";
import { advisoryFeeInCurrent, applyAdvisoryFee, applyLevers, readLevers } from "../workspace/levers.ts";
import type { TakeawayLeverKey, TakeawayPayload } from "./model.ts";

export type LeverConfig = TakeawayPayload["levers"];

/** 顧客が動かした値（動かしていない項目は持たない） */
export interface TryValues {
  levers: Partial<Record<TakeawayLeverKey, number>>;
  fee?: boolean;
}

export const NO_TRY: TryValues = { levers: {} };

/** そのプランのつまみの今の値（読めない項目は undefined） */
export function leverValues(req: EngineRequest, cfg: LeverConfig): Partial<Record<TakeawayLeverKey, number>> {
  const all = readLevers(req, cfg.self);
  const out: Partial<Record<TakeawayLeverKey, number>> = {};
  for (const it of cfg.items) {
    const v = all[it.key];
    if (v !== undefined) out[it.key] = v;
  }
  return out;
}

/** そのプランで FP顧問料を入れているか */
export const feeOn = (req: EngineRequest): boolean => advisoryFeeInCurrent(req);

/** 顧客が動かした値をプランの要求に当てる（元の要求は変えない）。許していないつまみは当てない */
export function applyTry(req: EngineRequest, cfg: LeverConfig, v: TryValues): EngineRequest {
  const allowed = new Set(cfg.items.map((i) => i.key));
  const lv: Partial<Record<TakeawayLeverKey, number>> = {};
  for (const [k, x] of Object.entries(v.levers) as [TakeawayLeverKey, number][]) {
    const it = cfg.items.find((i) => i.key === k);
    if (it === undefined || !allowed.has(k) || !Number.isFinite(x)) continue;
    lv[k] = Math.max(it.min, Math.min(it.max, x));
  }
  let out = Object.keys(lv).length > 0 ? applyLevers(req, cfg.self, lv, cfg.reemployment !== null ? { reemployment: cfg.reemployment } : {}) : req;
  if (v.fee !== undefined && cfg.fee !== null) out = applyAdvisoryFee(out, v.fee);
  return out;
}

/** つまみの値の文字（アプリの対策と同じ書き方） */
export function leverText(k: TakeawayLeverKey, v: number): string {
  if (k === "retireAge") return `${v}歳まで`;
  if (k === "pensionAge") return `${v}歳から`;
  if (k === "nisaMonthly") return v === 0 ? "なし" : `月${monthlyMan(v)}`;
  return `月${monthlyMan(v)}`;
}

/** 目盛りの文字 */
export const tickText = (k: TakeawayLeverKey, v: number): string => (k === "nisaMonthly" || k === "livingMonthly" ? (v === 0 ? "0" : `${v / 10000}万`) : String(v));

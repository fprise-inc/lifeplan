// エンジンの公開の入口
export { checkPacksJson, createSession, runBatch, runBatchJson, runEngine, runJson, type EngineResult, type RunOptions, type Session } from "./engine/run.ts";
export { EngineError } from "./errors.ts";
// お金の3つの分け方（説明用。計算の結果から出す。runEngine の結果には混ぜない。0032）
export {
  moneyThree,
  MONEY_THREE_MONTHS,
  MONEY_THREE_REGULAR_KINDS,
  MONEY_THREE_YEARS,
  type MoneyThreeCell,
  type MoneyThreeEventKind,
  type MoneyThreeEventPart,
  type MoneyThreeOptions,
  type MoneyThreePlacement,
  type MoneyThreeRegularKind,
  type MoneyThreeRequest,
  type MoneyThreeResult,
  type MoneyThreeStatus,
  type MoneyThreeYear,
} from "./explain/moneyThree.ts";

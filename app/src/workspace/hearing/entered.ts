// Web のヒアリングの「今の世帯で値のある問い」（見直しで確かめてもらう項目・前回の値・世帯にもう値が入っているかの注意）を決める所。
// FP の画面（web.ts）と、AI接続の同梱の JS（app/src/connector/hearing.ts。get_hearing_options の filled・見直し・足りない所だけ）が同じ関数を使い、
// 画面と AI で同じ答えになるようにする（0222 の追記 2026-11-19）。まだ何も入れていない新しい世帯は、初めの値（性別・働き方など）と仮の値しか
// ないので「値なし」と読む（入力のホームの「新しい世帯」と同じ決め方。0192 の追記 2026-11-19）
import type { SheetDefinition } from "../../../../hearing/src/definition.ts";
import { exportAnswers } from "../../../../hearing/src/export.ts";
import type { EngineRequest as HearingEngineRequest } from "../../../../hearing/src/types.ts";
import type { Answer } from "../../../../hearing/src/answers.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { inputItems, nothingEnteredYet } from "../input/items.ts";

/** 今の世帯の値をその票で書き出した答え（仮の値を入れた欄は書き出さない。形の違う世帯は無し） */
function answersOf(wh: WorkingHousehold, def: SheetDefinition): Answer[] {
  try {
    return [...exportAnswers(def, wh.request as unknown as HearingEngineRequest, { assumed: wh.assumed }).answers];
  } catch {
    return [];
  }
}

/** 今の世帯の値（確かめてもらう項目の前回の値。詳細のシートだけ） */
export function prefillOf(wh: WorkingHousehold, def: SheetDefinition): Answer[] {
  return def.sheetId === "full" ? answersOf(wh, def) : [];
}

/** まだ何も入れていない新しい世帯か（入力のホームの「新しい世帯」と同じ決め方） */
export function nothingEntered(wh: WorkingHousehold): boolean {
  return nothingEnteredYet(wh, inputItems(wh));
}

/**
 * 今の世帯で値のある問いのキー（その票で空でない答えのある項目）。まだ何も入れていない新しい世帯は無しと読む。nothing は「まだ何も入れて
 * いない」かを呼ぶ側が決めて渡すとき（AI接続の側は、画面の入力の進み具合〔保存した・足した入力項目〕を数だけ受け取るので、数と
 * nothingEntered で決めてから渡す）
 */
export function enteredKeys(wh: WorkingHousehold, def: SheetDefinition, nothing: boolean = nothingEntered(wh)): Set<string> {
  if (nothing) return new Set();
  return new Set(answersOf(wh, def).filter((a) => a.status !== "blank").map((a) => a.key));
}

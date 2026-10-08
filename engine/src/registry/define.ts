// 0006 の1: 計算部品の形（マニフェスト＋計算の関数）
import { EngineError } from "../errors.ts";
import { checkId, isDottedId } from "../ids/ids.ts";
import { isRange } from "../regulation/versions.ts";
import type { Ctx } from "./ctx.ts";

export interface ComponentDefinition<I = unknown, O = unknown> {
  /** 計算部品ID（0004） */
  readonly id: string;
  /** 入出力の約束の版 MAJOR.MINOR */
  readonly contract: string;
  /** 実装の改訂（不具合修正・制度改正のたびに1ずつ増やす） */
  readonly revision: number;
  /** 画面・登録簿に出す名前（0004 の5） */
  readonly title?: string;
  /** 呼ぶ部品と約束の版の範囲（例 ">=1 <2"。"1" はその省略形。0006 の追記） */
  readonly requires: Readonly<Record<string, string>>;
  /** 読む制度の値ID（端数処理の規則IDを含む） */
  readonly params: readonly string[];
  /** 読む入力項目ID */
  readonly reads: readonly string[];
  /** 呼ぶ差し込み口 */
  readonly slots?: readonly string[];
  /** 公式部品だけが持つ。差し替えを許すか */
  readonly replaceable?: boolean;
  /** 入力・出力の JSON Schema のキー（schemas/ のファイル名） */
  readonly input: string;
  readonly output: string;
  compute(input: I, ctx: Ctx): O;
}

const CONTRACT_PATTERN = /^\d+\.\d+$/;

export function defineComponent<I, O>(def: ComponentDefinition<I, O>): ComponentDefinition<I, O> {
  const id = typeof def.id === "string" ? def.id : "";
  const bad = (what: string): never => {
    throw new EngineError("E_COMPONENT_DEFINITION", [id, what]);
  };
  checkId("component", def.id);
  if (!CONTRACT_PATTERN.test(def.contract)) bad("contract");
  if (!Number.isSafeInteger(def.revision) || def.revision < 1) bad("revision");
  for (const [dep, range] of Object.entries(def.requires)) {
    if (!isDottedId(dep) || !isRange(range)) bad("requires");
  }
  for (const p of def.params) if (!isDottedId(p)) bad("params");
  for (const r of def.reads) if (!isDottedId(r)) bad("reads");
  for (const s of def.slots ?? []) if (!s.startsWith("slot.")) bad("slots");
  if (typeof def.compute !== "function") bad("compute");
  return Object.freeze({ ...def });
}

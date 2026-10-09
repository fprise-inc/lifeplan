// 0006 の1: 計算部品の形（マニフェスト＋計算の関数）
import { EngineError } from "../errors.ts";
import { checkId, isDottedId } from "../ids/ids.ts";
import { isRange } from "../regulation/versions.ts";
import { ITEMS } from "./items.ts";
import type { Ctx } from "./ctx.ts";

/**
 * 部品の書き方の約束（ctx の API とマニフェスト）の版。1.1 → 1.2（0006 の追記（2026-10-09））: 年ごとの列でない前提を読む ctx.setting と、
 * キーごとの年ごとの列（資産クラスごとの利回り）を読む ctx.assumptionIn を足した。0006 の追記（2回目の見直し）で 1.0 → 1.1:
 * ctx.segments・ctx.callMonths・ParamOptions.birth・マニフェストの memberScope を足し、依存の記録の決まり（部品は ctx を通して読んだものだけで
 * 結果を決める・同じ依存なら同じ順に同じものを読む）を明文にした。今の部品の書き方はそのまま使える
 */
export const COMPONENT_API_VERSION = "1.2";

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
  /**
   * 入力の member の構成員の物だけを読む集まり（0006 の追記: 構成員ごとの依存）。ctx.list・ctx.get はその構成員の物（x-owner）だけを返し、
   * 依存もその構成員の分だけになる（配偶者の入力を変えても、本人のこの部品は計算し直さない）。入力に member（構成員のID）が要る
   */
  readonly memberScope?: readonly string[];
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
  for (const c of def.memberScope ?? []) {
    if (ITEMS.owners[c] === undefined || !def.reads.some((r) => ITEMS.items[r]?.collection === c)) bad("memberScope");
  }
  if (typeof def.compute !== "function") bad("compute");
  return Object.freeze({ ...def });
}

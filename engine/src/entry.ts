// まとめた JS の入口。グローバルの FinanciaEngine に run と runBatch を置く（esbuild の iife）
import { checkPacksJson, createSession as create, runBatchJson, runJson, type Session } from "./engine/run.ts";

export function run(requestJson: string, packsJson: string, optionsJson?: string): string {
  return runJson(requestJson, packsJson, optionsJson);
}

/** 案×想定をまとめて計算する（requestsJson は要求の配列。0005 の7・追記） */
export function runBatch(requestsJson: string, packsJson: string, optionsJson?: string): string {
  return runBatchJson(requestsJson, packsJson, optionsJson);
}

/** 画面側の先出しのためのセッション（呼び出しをまたいで部品の結果を使い回す。0005 の5・追記） */
export function createSession(packsJson: string, optionsJson?: string): Session {
  return create(packsJson, optionsJson);
}

/** 本体がパックを読み込んだとき（署名を確かめた後）に1回だけ: パックの形を確かめ、検査済みの指紋を返す（計算の options の packsChecked に渡す） */
export function checkPacks(packsJson: string): string {
  return checkPacksJson(packsJson);
}

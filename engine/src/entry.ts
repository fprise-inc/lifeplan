// まとめた JS の入口。グローバルの FinanciaEngine に run と runBatch を置く（esbuild の iife）
import { createSession as create, runBatchJson, runJson, type Session } from "./engine/run.ts";

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

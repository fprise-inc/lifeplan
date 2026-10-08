// まとめた JS の入口。グローバルの FinanciaEngine に run だけを置く（esbuild の iife）
import { runJson } from "./engine/run.ts";

export function run(requestJson: string, packsJson: string, optionsJson?: string): string {
  return runJson(requestJson, packsJson, optionsJson);
}

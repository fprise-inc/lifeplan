// 道具とテストの共通部分: 本物のエンジン（engine/dist/engine.js。本体が埋め込むものと同じまとめた JS）を Node で動かす。
// 数字の正は本体の quickjs-ng の計算（0005 の2）で、Node・quickjs-ng・JavaScriptCore で同じ結果になることは一致テスト（npm run parity）が確かめている
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import type { EngineOutput, EngineRequest, Run } from "../src/bundle.ts";

export const REPORT_DIR = fileURLToPath(new URL("..", import.meta.url));
export const REPO_DIR = join(REPORT_DIR, "..");
export const ENGINE_DIST = join(REPO_DIR, "engine", "dist");

interface WebEngine {
  runBatch(requestsJson: string, packsJson: string, optionsJson: string): string;
}

let cached: { engine: WebEngine; packs: string } | null = null;

function realEngine(): { engine: WebEngine; packs: string } {
  if (cached !== null) return cached;
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  let js: string;
  try {
    js = readFileSync(join(ENGINE_DIST, "engine.js"), "utf8");
  } catch {
    throw new Error("engine/dist/engine.js がありません。先に engine/ で `npm ci && npm run build` を流してください");
  }
  vm.runInContext(js + ";globalThis.FinanciaEngine=FinanciaEngine;", ctx);
  const dir = join(ENGINE_DIST, "regulation");
  const packs = `[${readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => readFileSync(join(dir, f), "utf8")).join(",")}]`;
  cached = { engine: ctx.FinanciaEngine as WebEngine, packs };
  return cached;
}

export function modelHousehold(id: string): EngineRequest {
  return JSON.parse(readFileSync(join(REPO_DIR, "data", "modelHouseholds", `${id}.json`), "utf8")) as EngineRequest;
}

/** まとめて計算（表示の形）。アプリの正の計算（host.compute）と同じ形の結果 */
export function runAll(reqs: readonly EngineRequest[]): Run[] {
  const { engine, packs } = realEngine();
  const out = JSON.parse(engine.runBatch(JSON.stringify(reqs), packs, '{"preview":true}')) as (EngineOutput & { error?: unknown })[];
  return out.map((r, i) => {
    if (r.error !== undefined) throw new Error(`計算の失敗（${i}件目）: ${JSON.stringify(r.error)}`);
    return { request: reqs[i] as EngineRequest, result: r };
  });
}

export function run(req: EngineRequest): Run {
  return runAll([req])[0] as Run;
}

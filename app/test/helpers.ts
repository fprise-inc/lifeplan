// テストの道具: 本物のエンジン（engine/dist/engine.js）を Node で動かす（画面側のエンジンと同じまとめた JS）
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import type { WebEngine } from "../src/engine/host.ts";
import type { EngineRequest, FullResult, PreviewResult } from "../src/engine/types.ts";
import { ENGINE_DIST, REPO_DIR } from "../scripts/lib.ts";

let cached: { engine: WebEngine; packs: string } | null = null;

export function realEngine(): { engine: WebEngine; packs: string } {
  if (cached !== null) return cached;
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ENGINE_DIST, "engine.js"), "utf8") + ";globalThis.FinanciaEngine=FinanciaEngine;", ctx);
  const dir = join(ENGINE_DIST, "regulation");
  const packs = `[${readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => readFileSync(join(dir, f), "utf8")).join(",")}]`;
  cached = { engine: ctx.FinanciaEngine as WebEngine, packs };
  return cached;
}

export function modelHousehold(id: string): EngineRequest {
  return JSON.parse(readFileSync(join(REPO_DIR, "data", "modelHouseholds", `${id}.json`), "utf8")) as EngineRequest;
}

export function preview(req: EngineRequest): PreviewResult {
  const { engine, packs } = realEngine();
  const out = JSON.parse(engine.runBatch(JSON.stringify([req]), packs, '{"preview":true}')) as unknown[];
  const r = out[0] as PreviewResult & { error?: unknown };
  if (r.error !== undefined) throw new Error(JSON.stringify(r.error));
  return r;
}

export function full(req: EngineRequest): FullResult {
  const { engine, packs } = realEngine();
  const r = JSON.parse(engine.run(JSON.stringify({ ...req, trace: "full" }), packs, "{}")) as FullResult & { error?: unknown };
  if (r.error !== undefined) throw new Error(JSON.stringify(r.error));
  return r;
}

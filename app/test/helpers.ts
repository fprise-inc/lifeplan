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

/**
 * 見本の棚の世帯を、未入力を埋める前（2026-11-07 より前）の形にする。見本の未入力は埋めた（失業給付は「受け取らない」・終身保険の死亡保険金と
 * 解約返戻率・専門学校の学費・配偶者の退職金の「制度が無い」）ので、未入力・確かめの一覧・計算の知らせの仕組みを見るテストはこの形で見る
 */
export function modelWithGaps(id: string): EngineRequest {
  const req = structuredClone(modelHousehold(id));
  const h = req.input.household;
  for (const p of h.employmentPeriods ?? []) {
    if (p.unemploymentClaim === false && (p.valueStates as Record<string, unknown> | undefined)?.["employment.unemploymentClaim"] === undefined) delete p.unemploymentClaim;
    const vs = p.valueStates as Record<string, { state?: string }> | undefined;
    if (vs?.["employment.retirementBenefit"]?.state === "notApplicable" && id === "lifetime100Plan") {
      delete vs["employment.retirementBenefit"];
      if (Object.keys(vs).length === 0) delete p.valueStates;
    }
  }
  for (const c of h.insuranceContracts ?? [])
    if (c.id === "64286f3e-7cba-4f7f-85c0-0ab25c94ec1b") {
      delete c.coverages;
      delete c.simple;
    }
  for (const g of h.goals ?? [])
    for (const st of g.education?.stages ?? [])
      if (st.stage === "vocational" && id === "sampleSingleParent") {
        delete st.annualOverride;
        delete st.entranceOverride;
      }
  return req;
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

// 0035 の5: 同じ2人の配偶者の関係を、期間を分けて複数持てる（事実婚 → 入籍）。エンジンが2本の関係を期間どおりに読むこと
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { realPacks } from "./helpers.ts";

type Obj = Record<string, unknown>;
/** 計算の結果（お金の動き・年ごとの行・表・要約・見出しの知らせ）。入力の指紋は比べない */
const results = (r: EngineResult) => JSON.stringify([r.flows, r.annual, r.table, r.summary, (r.header as { notices?: unknown }).notices ?? null]);
const model = (id: string): EngineRequest => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "data", "modelHouseholds", `${id}.json`), "utf8")) as EngineRequest;

/** 配偶者の関係を、入籍の前の事実婚の期間と入籍の後の2本に分ける（入籍の月から後は今までと同じ法律婚） */
function split(req: EngineRequest, legalFrom: string, beforeTo: string): EngineRequest {
  const r = structuredClone(req) as unknown as { input: { household: { relations: Obj[] } } };
  const rels = r.input.household.relations;
  const i = rels.findIndex((x) => x.type === "spouse");
  if (i < 0) throw new Error("配偶者の関係が無い見本");
  const sp = rels[i] as Obj;
  rels.splice(i, 1, { ...sp, marriage: "deFacto", from: null, to: { at: beforeTo } }, { ...sp, marriage: "legal", from: { at: legalFrom }, to: sp.to });
  return r as unknown as EngineRequest;
}

function withLegalFrom(req: EngineRequest, legalFrom: string): EngineRequest {
  const r = structuredClone(req) as unknown as { input: { household: { relations: Obj[] } } };
  const sp = r.input.household.relations.find((x) => x.type === "spouse") as Obj;
  sp.marriage = "legal";
  sp.from = { at: legalFrom };
  return r as unknown as EngineRequest;
}

describe("同じ2人の関係を期間で分けて持つ（0035 の5）", () => {
  it("計算基準月より前に終わった事実婚の期間を足しても、今の法律婚の1本と同じ結果になる", () => {
    for (const id of ["dualHighTwoKids", "dualNoKids", "partTimeSpouse"]) {
      const base = withLegalFrom(model(id), "2011-04");
      const two = split(model(id), "2011-04", "2011-03");
      const a = runEngine(base, realPacks(), {});
      const b = runEngine(two, realPacks(), {});
      expect(results(b), id).toBe(results(a));
    }
  });
});

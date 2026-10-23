// テストの共通部分: シート定義・モデル世帯・本物の計算エンジン（engine/dist/engine.js）・.xlsx の書き換え（xlsx/test/helpers.ts）
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { OFFICIAL_SHEETS, type SheetDefinition } from "../src/index.ts";
import type { EngineRequest } from "../src/types.ts";

export const HEARING_DIR = join(import.meta.dirname, "..");
export const REPO_DIR = join(HEARING_DIR, "..");
export const ENGINE_DIST = join(REPO_DIR, "engine", "dist");

export const basic = (): SheetDefinition => OFFICIAL_SHEETS.find((d) => d.sheetId === "basic" && d.version === 1) as SheetDefinition;

export const OFFICE = { name: "【架空】みらいFP事務所", purpose: "ライフプランの作成と、家計・保険・資産運用のご相談のため", privacyContact: "【架空】みらいFP事務所 個人情報の窓口（privacy@example.invalid）" };

export function modelNames(): string[] {
  return readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

/** 架空のモデル世帯（data/modelHouseholds。CC0） */
export function modelHousehold(name: string): EngineRequest {
  return JSON.parse(readFileSync(join(REPO_DIR, "data", "modelHouseholds", `${name}.json`), "utf8")) as EngineRequest;
}

/** 決まった文字列から作る UUID 第4版の形の ID の列（テストの結果を毎回同じにする） */
export function idSeq(seed: string): () => string {
  let i = 0;
  return () => {
    const h = createHash("sha256").update(`financia-hearing-test:${seed}:${i++}`).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[Number.parseInt(h[16] as string, 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
}

interface WebEngine {
  runBatch(requests: string, packs: string, options: string): string;
}
let cached: { engine: WebEngine; packs: string } | null = null;

export const engineAvailable = (): boolean => existsSync(join(ENGINE_DIST, "engine.js"));

/** 本物の計算エンジンで計算する（画面と同じまとめた JS）。エラーなら投げる */
export function preview(req: EngineRequest): { error?: unknown } & Record<string, unknown> {
  if (cached === null) {
    const ctx: Record<string, unknown> = {};
    vm.createContext(ctx);
    vm.runInContext(readFileSync(join(ENGINE_DIST, "engine.js"), "utf8") + ";globalThis.FinanciaEngine=FinanciaEngine;", ctx);
    const dir = join(ENGINE_DIST, "regulation");
    const packs = `[${readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => readFileSync(join(dir, f), "utf8")).join(",")}]`;
    cached = { engine: ctx.FinanciaEngine as WebEngine, packs };
  }
  const out = JSON.parse(cached.engine.runBatch(JSON.stringify([req]), cached.packs, '{"preview":true}')) as ({ error?: unknown } & Record<string, unknown>)[];
  return out[0] as { error?: unknown } & Record<string, unknown>;
}

// .xlsx の書き換え（顧客の手元での編集・別のソフトでの保存し直しを試す）は、表計算のファイルの土台（xlsx/）のテストの部品を使う
export { bytes, editXlsx, insertRow, rezip, setCell, text, toSharedStrings, unzip } from "../../xlsx/test/helpers.ts";

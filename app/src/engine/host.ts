// 本体（Rust）と画面側のエンジンへの入口
import { invoke } from "@tauri-apps/api/core";
import type { EngineError, EngineRequest, FullResult, PreviewResult } from "./types.ts";

/** 画面側のエンジンのセッション（engine/src/engine/run.ts の Session。JSON の文字列で受け渡す） */
export interface WebSession {
  set(slotsJson: string): string;
  compute(idsJson?: string, optionsJson?: string): string;
  results(idsJson?: string): string;
  status(): string;
  slide(slotsJson: string, focusId: string): string;
  release(optionsJson?: string): string;
}

/** まとめた JS（public/engine/engine.js）がグローバルに置くもの */
export interface WebEngine {
  createSession(packsJson: string, optionsJson?: string): WebSession;
  run(requestJson: string, packsJson: string, optionsJson?: string): string;
  runBatch(requestsJson: string, packsJson: string, optionsJson?: string): string;
}

export function webEngine(): WebEngine | null {
  const e = (globalThis as { FinanciaEngine?: WebEngine }).FinanciaEngine;
  return e !== undefined && typeof e.createSession === "function" ? e : null;
}

export interface SlotRequest {
  id: string;
  rev: number;
  request: string;
}

export interface ComputeResponse {
  /** 本体の中での時間（ミリ秒） */
  ms: number;
  slots: Record<string, { rev: number; ms: number; result: PreviewResult | EngineError }>;
}

/** 本体の命令（0016 の1: 用途ごとの命令だけ） */
export interface HostApi {
  readonly kind: "tauri" | "browser-dev";
  /** 制度データ・マスタのパック（JSON の配列の文字列） */
  packs(): Promise<string>;
  listHouseholds(): Promise<string[]>;
  openHousehold(id: string): Promise<EngineRequest>;
  /** 正の計算（表示の形） */
  compute(slots: SlotRequest[]): Promise<ComputeResponse>;
  /** 根拠の記録「全部」での計算 */
  evidence(requestJson: string): Promise<FullResult | EngineError>;
}

export function tauriHost(): HostApi {
  return {
    kind: "tauri",
    packs: async () => JSON.stringify(await invoke<unknown[]>("engine_packs")),
    listHouseholds: () => invoke<string[]>("list_households"),
    openHousehold: (id) => invoke<EngineRequest>("open_household", { id }),
    compute: (slots) => invoke<ComputeResponse>("compute", { slots }),
    evidence: (request) => invoke<FullResult | EngineError>("evidence", { request }),
  };
}

/**
 * 開発用のサーバーだけ（import.meta.env.DEV）: Tauri の外のブラウザで画面を確かめるための代わり。
 * 正の計算の代わりに画面側のエンジンで計算する（quickjs-ng ではない。数字は一致テストで同じことを確かめている）
 */
export function devBrowserHost(engine: WebEngine): HostApi {
  let packsText: string | null = null;
  const packs = async (): Promise<string> => {
    packsText ??= await (await fetch("/__dev/packs")).text();
    return packsText;
  };
  return {
    kind: "browser-dev",
    packs,
    listHouseholds: async () => (await fetch("/__dev/households")).json() as Promise<string[]>,
    openHousehold: async (id) => (await fetch(`/__dev/households/${encodeURIComponent(id)}`)).json() as Promise<EngineRequest>,
    compute: async (slots) => {
      const p = await packs();
      const t0 = performance.now();
      const out: ComputeResponse["slots"] = {};
      for (const s of slots) {
        const t = performance.now();
        const r = JSON.parse(engine.runBatch(`[${s.request}]`, p, '{"preview":true}')) as unknown;
        out[s.id] = { rev: s.rev, ms: performance.now() - t, result: (Array.isArray(r) ? r[0] : r) as PreviewResult | EngineError };
      }
      return { ms: performance.now() - t0, slots: out };
    },
    evidence: async (request) => JSON.parse(engine.run(request, await packs(), "{}")) as FullResult | EngineError,
  };
}

export function isTauri(): boolean {
  return typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === "object";
}

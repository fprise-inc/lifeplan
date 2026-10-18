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

/** 提案書の PDF を作った結果（PDF のバイトは本体の中に置き、画面には渡さない） */
export interface RenderInfo {
  pages: number;
  /** ページの大きさ（pt。幅・高さ） */
  sizes: [number, number][];
  bytes: number;
  /** 本体の中で PDF を作った時間（ミリ秒） */
  ms: number;
  noticesPageAdded: boolean;
}

/** 平文の書き出しの出口（本体）で保存した結果。保存しなかったときは saved: false */
export interface SaveOutcome {
  saved: boolean;
  fileName: string | null;
  syncFolder: boolean;
  digest: string | null;
}

/** 提案書の PDF（0009）: 刻印・必須の記載は本体が決める。保存先は本体が OS のダイアログで FP に選ばせる */
export interface ReportHost {
  /** 帳票の入力（JSON）から PDF を作る。宛名は出力の PDF に重ねるだけ（保存しない） */
  render(inputJson: string, addressee: string | null): Promise<RenderInfo>;
  /** 見本の1ページ（0 から）の PNG */
  page(index: number, scale: number): Promise<Blob>;
  save(): Promise<SaveOutcome>;
  /** 作った PDF を本体から捨てる（画面を離れたとき） */
  discard(): Promise<void>;
}

/** ヒアリングシート（0018）の保存と、記入済みのシートを選んで読むこと */
export interface SheetHost {
  save(bytes: Uint8Array, meta: { customerNo: string; exportedOn: string; prefilled: boolean }): Promise<SaveOutcome>;
  /** 選ばなかったときは null */
  open(): Promise<Uint8Array | null>;
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
  report: ReportHost;
  sheets: SheetHost;
}

const bytesOf = (b: ArrayBuffer | Uint8Array | number[]): Uint8Array => (b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : Uint8Array.from(b));

export function tauriHost(): HostApi {
  return {
    kind: "tauri",
    packs: async () => JSON.stringify(await invoke<unknown[]>("engine_packs")),
    listHouseholds: () => invoke<string[]>("list_households"),
    openHousehold: (id) => invoke<EngineRequest>("open_household", { id }),
    compute: (slots) => invoke<ComputeResponse>("compute", { slots }),
    evidence: (request) => invoke<FullResult | EngineError>("evidence", { request }),
    report: {
      render: (input, addressee) => invoke<RenderInfo>("proposal_render", { input, addressee }),
      page: async (page, scale) => new Blob([bytesOf(await invoke<ArrayBuffer>("proposal_page", { page, scale })) as Uint8Array<ArrayBuffer>], { type: "image/png" }),
      save: () => invoke<SaveOutcome>("proposal_save"),
      discard: () => invoke<void>("proposal_discard"),
    },
    sheets: {
      save: (bytes, m) => invoke<SaveOutcome>("hearing_save", bytes, { headers: { "x-customer-no": m.customerNo, "x-exported-on": m.exportedOn, "x-prefilled": m.prefilled ? "1" : "0" } }),
      open: async () => {
        const b = bytesOf(await invoke<ArrayBuffer>("hearing_open"));
        return b.length === 0 ? null : b;
      },
    },
  };
}

/** 開発用のサーバーの答え（失敗は符号の文字列で投げる。本体の命令と同じ） */
async function devJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw (await res.text()) || `E_DEV_${res.status}`;
  return (await res.json()) as T;
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
    // 提案書の PDF とヒアリングシート: 開発用のサーバーが report-pdf のコマンドを呼ぶ・FINANCIA_DEV_SAVE_DIR に書く
    report: {
      render: async (input, addressee) => devJson<RenderInfo>(await fetch("/__dev/report/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input, addressee }) })),
      page: async (page) => {
        const res = await fetch(`/__dev/report/page/${page + 1}`);
        if (!res.ok) throw `E_DEV_${res.status}`;
        return res.blob();
      },
      save: async () => devJson<SaveOutcome>(await fetch("/__dev/report/save", { method: "POST" })),
      discard: async () => void (await fetch("/__dev/report/discard", { method: "POST" })),
    },
    sheets: {
      save: async (bytes, m) =>
        devJson<SaveOutcome>(await fetch(`/__dev/sheets/save?customerNo=${encodeURIComponent(m.customerNo)}&exportedOn=${encodeURIComponent(m.exportedOn)}&prefilled=${m.prefilled ? 1 : 0}`, { method: "POST", body: bytes as Uint8Array<ArrayBuffer> })),
      open: async () => {
        const res = await fetch("/__dev/sheets/open");
        if (res.status === 204) return null;
        if (!res.ok) throw (await res.text()) || `E_DEV_${res.status}`;
        return new Uint8Array(await res.arrayBuffer());
      },
    },
  };
}

export function isTauri(): boolean {
  return typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === "object";
}

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
  /** 見本の1ページ（0 から）の PNG（ページの縮小一覧。scale は 1pt あたりの画素） */
  page(index: number, scale: number): Promise<Blob>;
  /** 見本の1ページ（0 から）の SVG の文字列（本体の見本。拡大してもぼやけない） */
  pageSvg(index: number): Promise<string>;
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

/** 保存の状態（本体の household-store の Status） */
export interface StoreStatus {
  state: "ready" | "needsRecovery";
  firstRun: boolean;
  recoveryAcknowledged: boolean;
  recoveryVerifiedAt: string | null;
  lastOpened: string | null;
  deletionsPending: number;
  deletionsCompleted: number;
}

/** 保存した世帯の一覧の1件（表示用の顧客番号と構成の要約だけ。氏名は持たない。0012） */
export interface StoredHousehold {
  id: string;
  customerNo: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

/** 開いた世帯（本文は JSON の文字列。0011 の2） */
export interface StoredOpened {
  id: string;
  customerNo: string;
  body: string;
  readOnly: boolean;
  generation: number;
}

/**
 * 世帯ファイルの保存（0011・0013）。暗号化・鍵・ファイルの読み書きはすべて本体が行い、画面はパスを渡さない・受け取らない（0016 の1）。
 * 世帯は本体が振る内部ID だけで指す
 */
export interface StoreHost {
  status(): Promise<StoreStatus>;
  list(): Promise<StoredHousehold[]>;
  create(body: string, summary: string): Promise<StoredOpened>;
  open(id: string): Promise<StoredOpened>;
  save(id: string, body: string, summary: string): Promise<{ generation: number; savedAt: string }>;
  rename(id: string, customerNo: string): Promise<{ customerNo: string; duplicate: boolean }>;
  /** 完全削除（confirm は FP が打った顧客番号） */
  remove(id: string, confirm: string): Promise<void>;
  /** 復元キー（72文字）。表示のためだけに受け取り、どこにも保存しない */
  recoveryKey(): Promise<string>;
  acknowledgeRecovery(): Promise<StoreStatus>;
  testRecoveryKey(key: string): Promise<StoreStatus>;
  restoreWithRecoveryKey(key: string): Promise<StoreStatus>;
  /** アプリを閉じる前の保存が済んだことを本体に知らせる（本体が閉じる） */
  closeReady(): Promise<void>;
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
  store: StoreHost;
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
      pageSvg: async (page) => new TextDecoder().decode(bytesOf(await invoke<ArrayBuffer>("proposal_page", { page, scale: 1, format: "svg" }))),
      save: () => invoke<SaveOutcome>("proposal_save"),
      discard: () => invoke<void>("proposal_discard"),
    },
    store: {
      status: () => invoke<StoreStatus>("store_status"),
      list: () => invoke<StoredHousehold[]>("store_list"),
      create: (body, summary) => invoke<StoredOpened>("store_create", { body, summary }),
      open: (id) => invoke<StoredOpened>("store_open", { id }),
      save: (id, body, summary) => invoke<{ generation: number; savedAt: string }>("store_save", { id, body, summary }),
      rename: (id, customerNo) => invoke<{ customerNo: string; duplicate: boolean }>("store_rename", { id, customerNo }),
      remove: (id, confirm) => invoke<void>("store_delete", { id, confirm }),
      recoveryKey: () => invoke<string>("recovery_key_show"),
      acknowledgeRecovery: () => invoke<StoreStatus>("recovery_key_acknowledge"),
      testRecoveryKey: (key) => invoke<StoreStatus>("recovery_key_test", { key }),
      restoreWithRecoveryKey: (key) => invoke<StoreStatus>("recovery_key_restore", { key }),
      closeReady: () => invoke<void>("app_close_ready"),
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

const devStore = (op: string, args: Record<string, string> = {}) => fetch(`/__dev/store/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });

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
      pageSvg: async (page) => {
        const res = await fetch(`/__dev/report/svg/${page + 1}`);
        if (!res.ok) throw `E_DEV_${res.status}`;
        return res.text();
      },
      save: async () => devJson<SaveOutcome>(await fetch("/__dev/report/save", { method: "POST" })),
      discard: async () => void (await fetch("/__dev/report/discard", { method: "POST" })),
    },
    // 世帯の保存: 開発用のサーバーのメモリの中だけ（暗号化もファイルへの保存もしない。画面の確かめ用）
    store: {
      status: async () => devJson<StoreStatus>(await devStore("status")),
      list: async () => devJson<StoredHousehold[]>(await devStore("list")),
      create: async (body, summary) => devJson<StoredOpened>(await devStore("create", { body, summary })),
      open: async (id) => devJson<StoredOpened>(await devStore("open", { id })),
      save: async (id, body, summary) => devJson<{ generation: number; savedAt: string }>(await devStore("save", { id, body, summary })),
      rename: async (id, customerNo) => devJson<{ customerNo: string; duplicate: boolean }>(await devStore("rename", { id, customerNo })),
      remove: async (id, confirm) => void (await devJson<unknown>(await devStore("delete", { id, confirm }))),
      recoveryKey: async () => devJson<string>(await devStore("recoveryKey")),
      acknowledgeRecovery: async () => devJson<StoreStatus>(await devStore("acknowledge")),
      testRecoveryKey: async (key) => devJson<StoreStatus>(await devStore("test", { key })),
      restoreWithRecoveryKey: async (key) => devJson<StoreStatus>(await devStore("restore", { key })),
      closeReady: async () => undefined,
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

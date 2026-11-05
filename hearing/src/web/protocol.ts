// Web のヒアリング（0125）の、受け付けのサーバー（hearing/relay/）とのやりとりの形。お客さまのページ・FP のアプリ・サーバーで同じものを使う。
// - 送り先の道（path）は API の頭（例 /api/hearing/v1）の後ろ。体は JSON で、暗号文は base64url の文字。サーバーは暗号文の中身を見ない
// - 合言葉は Authorization: Bearer で渡す（送るときの合言葉はお客さま、受け取りの合言葉は FP）。サーバーはハッシュと比べるだけ
// - 依頼の名前（id）は問いの鍵の元から導いた16バイト（22字）。お客さまの書類のファイルの番号（fileId）は12バイトの乱数（16字）
import { DOCUMENT_LIMITS } from "./documents.ts";

export const API_PREFIX = "/api/hearing/v1";
export const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** 上限（暗号文の文字数。中身の上限に封筒の分を足した目安） */
export const RELAY_LIMITS = {
  questionsChars: 400 * 1024,
  answersChars: 800 * 1024,
  documentChars: Math.ceil((DOCUMENT_LIMITS.fileBytes * 4) / 3) + 1024,
  totalDocumentChars: Math.ceil((DOCUMENT_LIMITS.totalBytes * 4) / 3) + 64 * 1024,
  files: DOCUMENT_LIMITS.files + 10,
  /** 有効期限の上限と下限（日） */
  maxDays: 30,
  minDays: 1,
} as const;

export interface CreateBody {
  readonly id: string;
  readonly questions: string;
  readonly submitHash: string;
  readonly pickupHash: string;
  readonly expiresAt: string;
}

export interface QuestionsView {
  readonly questions: string;
  readonly expiresAt: string;
  readonly submitted: boolean;
}

export interface StatusView {
  readonly expiresAt: string;
  readonly submitted: boolean;
  readonly submittedAt: string | null;
  readonly files: readonly { readonly fileId: string; readonly chars: number }[];
}

export interface RelayRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly path: string;
  readonly token?: string;
  readonly body?: string;
}

export interface RelayResponse {
  readonly status: number;
  readonly body: string;
}

/** 受け付けのサーバーへの通り道（お客さまのページは fetch、FP のアプリは本体の命令。試しは手元の処理） */
export type RelayTransport = (r: RelayRequest) => Promise<RelayResponse>;

/** サーバーの答えの符号（画面で言葉にする） */
export type RelayError = "E_RELAY_GONE" | "E_RELAY_EXPIRED" | "E_RELAY_SUBMITTED" | "E_RELAY_TOO_LARGE" | "E_RELAY_DENIED" | "E_RELAY_BUSY" | "E_RELAY_BAD" | "E_RELAY_EXISTS" | "E_RELAY_UNREACHABLE";

export function relayError(status: number): RelayError {
  if (status === 404) return "E_RELAY_GONE";
  if (status === 410) return "E_RELAY_EXPIRED";
  if (status === 409) return "E_RELAY_SUBMITTED";
  if (status === 413) return "E_RELAY_TOO_LARGE";
  if (status === 401 || status === 403) return "E_RELAY_DENIED";
  if (status === 429) return "E_RELAY_BUSY";
  if (status === 0 || status >= 500) return "E_RELAY_UNREACHABLE";
  return "E_RELAY_BAD";
}

async function call<T>(t: RelayTransport, r: RelayRequest, ok: readonly number[]): Promise<T | null> {
  let res: RelayResponse;
  try {
    res = await t(r);
  } catch {
    throw new Error("E_RELAY_UNREACHABLE");
  }
  if (!ok.includes(res.status)) throw new Error(relayError(res.status));
  if (res.status === 204 || res.body === "") return null;
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new Error("E_RELAY_BAD");
  }
}

const enc = encodeURIComponent;

export const relay = {
  create: (t: RelayTransport, b: CreateBody) => call<{ expiresAt: string }>(t, { method: "POST", path: "/requests", body: JSON.stringify(b) }, [201]),
  questions: async (t: RelayTransport, id: string) => (await call<QuestionsView>(t, { method: "GET", path: `/requests/${enc(id)}` }, [200])) as QuestionsView,
  putFile: (t: RelayTransport, id: string, fileId: string, data: string, submitToken: string) => call<null>(t, { method: "PUT", path: `/requests/${enc(id)}/files/${enc(fileId)}`, token: submitToken, body: JSON.stringify({ data }) }, [201, 204]),
  deleteFile: (t: RelayTransport, id: string, fileId: string, submitToken: string) => call<null>(t, { method: "DELETE", path: `/requests/${enc(id)}/files/${enc(fileId)}`, token: submitToken }, [204]),
  submit: (t: RelayTransport, id: string, data: string, submitToken: string) => call<null>(t, { method: "PUT", path: `/requests/${enc(id)}/answers`, token: submitToken, body: JSON.stringify({ data }) }, [201]),
  status: async (t: RelayTransport, id: string, pickupToken: string) => (await call<StatusView>(t, { method: "GET", path: `/requests/${enc(id)}/status`, token: pickupToken }, [200])) as StatusView,
  answers: async (t: RelayTransport, id: string, pickupToken: string) => ((await call<{ data: string }>(t, { method: "GET", path: `/requests/${enc(id)}/answers`, token: pickupToken }, [200])) as { data: string }).data,
  file: async (t: RelayTransport, id: string, fileId: string, pickupToken: string) => ((await call<{ data: string }>(t, { method: "GET", path: `/requests/${enc(id)}/files/${enc(fileId)}`, token: pickupToken }, [200])) as { data: string }).data,
  remove: (t: RelayTransport, id: string, pickupToken: string) => call<null>(t, { method: "DELETE", path: `/requests/${enc(id)}`, token: pickupToken }, [204, 404]),
};

/** fetch で通る通り道（お客さまのページ・開発用のサーバー）。base は API の頭までの URL（同じ所なら API_PREFIX） */
export function fetchTransport(base: string, f: typeof fetch = fetch): RelayTransport {
  return async (r) => {
    const headers: Record<string, string> = {};
    if (r.token !== undefined) headers.authorization = `Bearer ${r.token}`;
    if (r.body !== undefined) headers["content-type"] = "application/json";
    const res = await f(`${base}${r.path}`, { method: r.method, headers, ...(r.body !== undefined ? { body: r.body } : {}), credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    return { status: res.status, body: await res.text() };
  };
}

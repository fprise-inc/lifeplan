// 受け付けのサーバー（0125）の API の処理（Cloudflare Workers・試し・開発用のサーバーで同じものを動かす。Web 標準の Request と Response だけ）。
// - 置くのは、問いの暗号文・答えの暗号文・書類の暗号文・2つの合言葉のハッシュ・日時だけ。暗号を解く鍵は届かない（URL のフラグメントはサーバーに送られない）
// - 有効期限（最長30日）を過ぎたもの・FP が受け取って消したものは断る（期限を過ぎたものは見つけたときに消す。R2 の期限の決まりでも消す）
// - 大きさの上限・回数の制限（あれば Cloudflare の回数の制限の部品）。答えは1回だけ（2回目は 409）。送った後は書類も足せない
// - ログに中身・IP・合言葉を書かない（このファイルは console を使わない。誤りの答えにも中身を入れない）
import { API_PREFIX, FILE_ID_PATTERN, HASH_PATTERN, ID_PATTERN, RELAY_LIMITS, TOKEN_PATTERN, type CreateBody, type StatusView } from "../src/web/protocol.ts";
import type { RelayStore } from "./store.ts";

export interface RateLimiter {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

export interface RelayEnv {
  readonly store: RelayStore;
  readonly now: () => Date;
  /** 依頼を作る回数の制限（鍵は接続元。数えるだけで残さない） */
  readonly createLimiter?: RateLimiter;
  /** 依頼ごとの回数の制限（鍵は依頼の名前） */
  readonly requestLimiter?: RateLimiter;
}

interface Meta {
  readonly v: 1;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly submitHash: string;
  readonly pickupHash: string;
  readonly submittedAt: string | null;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const json = (status: number, body: unknown): Response => new Response(body === null ? null : JSON.stringify(body), { status, headers: JSON_HEADERS });
const fail = (status: number, code: string): Response => json(status, { error: code });

const metaKey = (id: string) => `r/${id}/meta`;
const questionsKey = (id: string) => `r/${id}/q`;
const answersKey = (id: string) => `r/${id}/a`;
const filePrefix = (id: string) => `r/${id}/f/`;

async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 長さの同じ16進の文字を、時間で中身が分からないように比べる */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function bodyText(req: Request, max: number): Promise<string | null> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > max) return null;
  const t = await req.text();
  return t.length > max ? null : t;
}

function bearer(req: Request): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.get("authorization") ?? "");
  return m === null ? null : (m[1] as string);
}

async function readMeta(env: RelayEnv, id: string): Promise<Meta | "gone" | "expired"> {
  const o = await env.store.get(metaKey(id));
  if (o === null) return "gone";
  let m: Meta;
  try {
    m = JSON.parse(o.text) as Meta;
  } catch {
    return "gone";
  }
  if (Date.parse(m.expiresAt) <= env.now().getTime()) {
    await removeAll(env, id);
    return "expired";
  }
  return m;
}

async function removeAll(env: RelayEnv, id: string): Promise<void> {
  const files = await env.store.list(filePrefix(id));
  await env.store.delete([...files.map((f) => f.key), answersKey(id), questionsKey(id), metaKey(id)]);
}

async function authorized(req: Request, hash: string): Promise<boolean> {
  const t = bearer(req);
  return t !== null && TOKEN_PATTERN.test(t) && sameHex(await sha256Hex(t), hash);
}

/** 同じ所（お客さまのページ）か、Origin の無い呼び出し（FP のアプリの本体）だけを受ける */
function originOk(req: Request): boolean {
  const o = req.headers.get("origin");
  if (o === null) return true;
  try {
    return new URL(o).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

export async function handleApi(req: Request, env: RelayEnv): Promise<Response> {
  try {
    return await route(req, env);
  } catch {
    return fail(500, "E_RELAY_INTERNAL");
  }
}

async function route(req: Request, env: RelayEnv): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(`${API_PREFIX}/`)) return fail(404, "E_RELAY_NOT_FOUND");
  if (url.search !== "") return fail(400, "E_RELAY_BAD");
  if (!originOk(req)) return fail(403, "E_RELAY_ORIGIN");
  const parts = url.pathname.slice(API_PREFIX.length + 1).split("/");
  const m = req.method;

  // 依頼を作る（FP のアプリ）
  if (parts.length === 1 && parts[0] === "requests" && m === "POST") {
    const who = req.headers.get("cf-connecting-ip") ?? "local";
    if (env.createLimiter !== undefined && !(await env.createLimiter.limit({ key: who })).success) return fail(429, "E_RELAY_BUSY");
    const text = await bodyText(req, RELAY_LIMITS.questionsChars + 1024);
    if (text === null) return fail(413, "E_RELAY_TOO_LARGE");
    let b: CreateBody;
    try {
      b = JSON.parse(text) as CreateBody;
    } catch {
      return fail(400, "E_RELAY_BAD");
    }
    if (typeof b !== "object" || b === null || !ID_PATTERN.test(String(b.id)) || typeof b.questions !== "string" || !/^1\.[A-Za-z0-9_.-]+$/.test(b.questions) || !HASH_PATTERN.test(String(b.submitHash)) || !HASH_PATTERN.test(String(b.pickupHash)) || b.submitHash === b.pickupHash || typeof b.expiresAt !== "string") return fail(400, "E_RELAY_BAD");
    const now = env.now().getTime();
    const exp = Date.parse(b.expiresAt);
    if (!Number.isFinite(exp) || exp < now + RELAY_LIMITS.minDays * 86400_000 - 3600_000 || exp > now + RELAY_LIMITS.maxDays * 86400_000 + 3600_000) return fail(400, "E_RELAY_EXPIRY");
    const meta: Meta = { v: 1, createdAt: env.now().toISOString(), expiresAt: new Date(exp).toISOString(), submitHash: b.submitHash, pickupHash: b.pickupHash, submittedAt: null };
    if (!(await env.store.put(metaKey(b.id), JSON.stringify(meta), true))) return fail(409, "E_RELAY_EXISTS");
    await env.store.put(questionsKey(b.id), b.questions);
    return json(201, { expiresAt: meta.expiresAt });
  }

  if (parts[0] !== "requests" || parts.length < 2) return fail(404, "E_RELAY_NOT_FOUND");
  const id = parts[1] as string;
  if (!ID_PATTERN.test(id)) return fail(404, "E_RELAY_NOT_FOUND");
  if (env.requestLimiter !== undefined && !(await env.requestLimiter.limit({ key: id })).success) return fail(429, "E_RELAY_BUSY");
  const meta = await readMeta(env, id);
  if (meta === "gone") return fail(404, "E_RELAY_GONE");
  if (meta === "expired") return fail(410, "E_RELAY_EXPIRED");
  const rest = parts.slice(2);

  // お客さまのページ: 問いの暗号文
  if (rest.length === 0 && m === "GET") {
    const q = await env.store.get(questionsKey(id));
    if (q === null) return fail(404, "E_RELAY_GONE");
    return json(200, { questions: q.text, expiresAt: meta.expiresAt, submitted: meta.submittedAt !== null });
  }
  // FP: 消す（受け取った後・取り消し）
  if (rest.length === 0 && m === "DELETE") {
    if (!(await authorized(req, meta.pickupHash))) return fail(401, "E_RELAY_DENIED");
    await removeAll(env, id);
    return json(204, null);
  }
  // お客さま: 書類のファイルを置く・外す（送る前だけ）
  if (rest.length === 2 && rest[0] === "files" && (m === "PUT" || m === "DELETE")) {
    const fileId = rest[1] as string;
    if (!FILE_ID_PATTERN.test(fileId)) return fail(404, "E_RELAY_NOT_FOUND");
    if (!(await authorized(req, meta.submitHash))) return fail(401, "E_RELAY_DENIED");
    if (meta.submittedAt !== null) return fail(409, "E_RELAY_SUBMITTED");
    const key = `${filePrefix(id)}${fileId}`;
    if (m === "DELETE") {
      await env.store.delete([key]);
      return json(204, null);
    }
    const text = await bodyText(req, RELAY_LIMITS.documentChars + 64);
    if (text === null) return fail(413, "E_RELAY_TOO_LARGE");
    const data = envelopeOf(text);
    if (data === null) return fail(400, "E_RELAY_BAD");
    const files = await env.store.list(filePrefix(id));
    const others = files.filter((f) => f.key !== key);
    if (others.length + 1 > RELAY_LIMITS.files || others.reduce((s, f) => s + f.size, 0) + data.length > RELAY_LIMITS.totalDocumentChars) return fail(413, "E_RELAY_TOO_LARGE");
    await env.store.put(key, data);
    return json(201, null);
  }
  // お客さま: 答えを送る（1回だけ）
  if (rest.length === 1 && rest[0] === "answers" && m === "PUT") {
    if (!(await authorized(req, meta.submitHash))) return fail(401, "E_RELAY_DENIED");
    if (meta.submittedAt !== null) return fail(409, "E_RELAY_SUBMITTED");
    const text = await bodyText(req, RELAY_LIMITS.answersChars + 64);
    if (text === null) return fail(413, "E_RELAY_TOO_LARGE");
    const data = envelopeOf(text);
    if (data === null) return fail(400, "E_RELAY_BAD");
    if (!(await env.store.put(answersKey(id), data, true))) return fail(409, "E_RELAY_SUBMITTED");
    await env.store.put(metaKey(id), JSON.stringify({ ...meta, submittedAt: env.now().toISOString() }));
    return json(201, null);
  }
  // FP: 状況・答え・書類のファイル
  if (m === "GET" && (rest[0] === "status" || rest[0] === "answers" || rest[0] === "files")) {
    if (!(await authorized(req, meta.pickupHash))) return fail(401, "E_RELAY_DENIED");
    if (rest.length === 1 && rest[0] === "status") {
      const files = await env.store.list(filePrefix(id));
      const view: StatusView = { expiresAt: meta.expiresAt, submitted: meta.submittedAt !== null, submittedAt: meta.submittedAt, files: files.map((f) => ({ fileId: f.key.slice(filePrefix(id).length), chars: f.size })) };
      return json(200, view);
    }
    if (rest.length === 1 && rest[0] === "answers") {
      const a = await env.store.get(answersKey(id));
      return a === null ? fail(404, "E_RELAY_NOT_SUBMITTED") : json(200, { data: a.text });
    }
    if (rest.length === 2 && rest[0] === "files" && FILE_ID_PATTERN.test(rest[1] as string)) {
      const f = await env.store.get(`${filePrefix(id)}${rest[1] as string}`);
      return f === null ? fail(404, "E_RELAY_GONE") : json(200, { data: f.text });
    }
  }
  return fail(404, "E_RELAY_NOT_FOUND");
}

/** 体 {"data": "1.…"} の暗号文（封筒の形だけを確かめる。中身は見ない） */
function envelopeOf(text: string): string | null {
  try {
    const v = JSON.parse(text) as { data?: unknown };
    return typeof v.data === "string" && /^1\.[A-Za-z0-9_.-]+$/.test(v.data) && Object.keys(v).length === 1 ? v.data : null;
  } catch {
    return null;
  }
}

/** お客さまのページ・API の答えに付ける守りの見出し（0016 の考え方。外のスクリプト・フォント・枠を読まない） */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; font-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "strict-transport-security": "max-age=31536000",
};

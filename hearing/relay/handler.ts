// 受け付けのサーバー（0125・0158）の API の処理（Cloudflare Workers・試し・開発用のサーバーで同じものを動かす。Web 標準の Request と Response だけ）。
// - 置くのは、問いの暗号文・答えの暗号文・書類の暗号文・書類の送り状の暗号文・2つの合言葉のハッシュ・日時だけ。暗号を解く鍵は届かない（URL のフラグメントはサーバーに送られない）
// - 有効期限は作った日から30日の決め打ち。FP は延長で押した日から30日に延ばせる（作った日から90日まで）。期限を過ぎたものは断り、見つけたとき・毎日の掃除（sweepExpired）で消す
// - 答えは1回だけ（2回目は 409）。書類は答えと別に、期限まで何回でも送れる（答えの前でも後でも。0158）。送り状に載せたファイルは外せない
// - FP が受け取ったら、受け取った答え・送りだけを消す（依頼と問いは期限まで残り、お客さまは書類を足せる）。FP が依頼を消すと全部消える
// - 大きさの上限・回数の制限（あれば Cloudflare の回数の制限の部品）
// - ログに中身・IP・合言葉を書かない（このファイルは console を使わない。誤りの答えにも中身を入れない）
import { API_PREFIX, BATCH_ID_PATTERN, FILE_ID_PATTERN, HASH_PATTERN, ID_PATTERN, RELAY_LIMITS, TOKEN_PATTERN, type BatchView, type CreateBody, type ExpiryView, type StatusView } from "../src/web/protocol.ts";
import { DOCUMENT_LIMITS } from "../src/web/documents.ts";
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
  /** 延長できる上限（作った日から90日） */
  readonly limitAt: string;
  readonly submitHash: string;
  readonly pickupHash: string;
  readonly submittedAt: string | null;
}

/** 書類の送り（置き場の中身。data は送り状の暗号文、files はその送りのファイルの番号） */
interface StoredBatch {
  readonly data: string;
  readonly files: readonly string[];
  readonly at: string;
}

const DAY = 86400_000;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const json = (status: number, body: unknown): Response => new Response(body === null ? null : JSON.stringify(body), { status, headers: JSON_HEADERS });
const fail = (status: number, code: string): Response => json(status, { error: code });
const iso = (t: number): string => new Date(t).toISOString().replace(/\.\d+Z$/, "Z");

// 置き場の名前: 依頼の記録は m/ の下（毎日の掃除が依頼の記録だけを一覧にできるように）、中身は r/<名前>/ の下
const META_PREFIX = "m/";
const metaKey = (id: string) => `${META_PREFIX}${id}`;
const dataPrefix = (id: string) => `r/${id}/`;
const questionsKey = (id: string) => `r/${id}/q`;
const answersKey = (id: string) => `r/${id}/a`;
const filePrefix = (id: string) => `r/${id}/f/`;
const batchPrefix = (id: string) => `r/${id}/b/`;

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

function parseMeta(text: string): Meta | null {
  try {
    const m = JSON.parse(text) as Meta;
    return typeof m.expiresAt === "string" && typeof m.limitAt === "string" ? m : null;
  } catch {
    return null;
  }
}

async function readMeta(env: RelayEnv, id: string): Promise<Meta | "gone" | "expired"> {
  const o = await env.store.get(metaKey(id));
  if (o === null) return "gone";
  const m = parseMeta(o.text);
  if (m === null) return "gone";
  if (Date.parse(m.expiresAt) <= env.now().getTime()) {
    await removeAll(env, id);
    return "expired";
  }
  return m;
}

/** 依頼の中身を全部消す（中身を先に、依頼の記録を最後に。途中で止まっても、記録が残るので次の掃除で消える） */
async function removeAll(env: RelayEnv, id: string): Promise<void> {
  const all = await env.store.list(dataPrefix(id));
  await env.store.delete(all.map((f) => f.key));
  await env.store.delete([metaKey(id)]);
}

async function readBatches(env: RelayEnv, id: string): Promise<(StoredBatch & { batchId: string })[]> {
  const list = await env.store.list(batchPrefix(id));
  const out: (StoredBatch & { batchId: string })[] = [];
  for (const o of list) {
    const b = await env.store.get(o.key);
    if (b === null) continue;
    try {
      const v = JSON.parse(b.text) as StoredBatch;
      out.push({ batchId: o.key.slice(batchPrefix(id).length), data: v.data, files: v.files, at: v.at });
    } catch {
      // 壊れた送りは無いものとして扱う（FP は受け取れない。期限で消える）
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
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

/** 毎日の掃除（Workers の決まった時刻の呼び出し）: 期限を過ぎた依頼を中身ごと消す。消した数を返す。R2 の期限の決まり（置いてから91日）は、掃除が止まったときの備え */
export async function sweepExpired(env: Pick<RelayEnv, "store" | "now">): Promise<number> {
  const now = env.now().getTime();
  let n = 0;
  for (const o of await env.store.list(META_PREFIX)) {
    const id = o.key.slice(META_PREFIX.length);
    const m = await env.store.get(o.key);
    const meta = m === null ? null : parseMeta(m.text);
    if (meta === null || Date.parse(meta.expiresAt) <= now) {
      await removeAll(env as RelayEnv, id);
      n++;
    }
  }
  return n;
}

async function route(req: Request, env: RelayEnv): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(`${API_PREFIX}/`)) return fail(404, "E_RELAY_NOT_FOUND");
  if (url.search !== "") return fail(400, "E_RELAY_BAD");
  if (!originOk(req)) return fail(403, "E_RELAY_ORIGIN");
  const parts = url.pathname.slice(API_PREFIX.length + 1).split("/");
  const m = req.method;

  // 依頼を作る（FP のアプリ）。期限はサーバーが決める（作った日から30日。延長の上限は90日）
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
    if (typeof b !== "object" || b === null || !ID_PATTERN.test(String(b.id)) || typeof b.questions !== "string" || !/^1\.[A-Za-z0-9_.-]+$/.test(b.questions) || !HASH_PATTERN.test(String(b.submitHash)) || !HASH_PATTERN.test(String(b.pickupHash)) || b.submitHash === b.pickupHash) return fail(400, "E_RELAY_BAD");
    const now = env.now().getTime();
    const meta: Meta = { v: 1, createdAt: iso(now), expiresAt: iso(now + RELAY_LIMITS.days * DAY), limitAt: iso(now + RELAY_LIMITS.maxTotalDays * DAY), submitHash: b.submitHash, pickupHash: b.pickupHash, submittedAt: null };
    if (!(await env.store.put(metaKey(b.id), JSON.stringify(meta), true))) return fail(409, "E_RELAY_EXISTS");
    await env.store.put(questionsKey(b.id), b.questions);
    const view: ExpiryView = { expiresAt: meta.expiresAt, limitAt: meta.limitAt };
    return json(201, view);
  }

  if (parts[0] !== "requests" || parts.length < 2) return fail(404, "E_RELAY_NOT_FOUND");
  const id = parts[1] as string;
  if (!ID_PATTERN.test(id)) return fail(404, "E_RELAY_NOT_FOUND");
  if (env.requestLimiter !== undefined && !(await env.requestLimiter.limit({ key: id })).success) return fail(429, "E_RELAY_BUSY");
  const meta = await readMeta(env, id);
  if (meta === "gone") return fail(404, "E_RELAY_GONE");
  if (meta === "expired") return fail(410, "E_RELAY_EXPIRED");
  const rest = parts.slice(2);

  // お客さまのページ: 問いの暗号文（期限は延長を反映したサーバーの値）
  if (rest.length === 0 && m === "GET") {
    const q = await env.store.get(questionsKey(id));
    if (q === null) return fail(404, "E_RELAY_GONE");
    return json(200, { questions: q.text, expiresAt: meta.expiresAt, submitted: meta.submittedAt !== null, submittedAt: meta.submittedAt });
  }
  // FP: 消す（取り消し・受け付けを終える）
  if (rest.length === 0 && m === "DELETE") {
    if (!(await authorized(req, meta.pickupHash))) return fail(401, "E_RELAY_DENIED");
    await removeAll(env, id);
    return json(204, null);
  }
  // FP: 期限を延ばす（押した日から30日。作った日から90日まで）
  if (rest.length === 1 && rest[0] === "extend" && m === "POST") {
    if (!(await authorized(req, meta.pickupHash))) return fail(401, "E_RELAY_DENIED");
    const cur = Date.parse(meta.expiresAt);
    const cap = Date.parse(meta.limitAt);
    const to = Math.min(env.now().getTime() + RELAY_LIMITS.days * DAY, cap);
    if (to <= cur) {
      if (cur >= cap) return fail(409, "E_RELAY_EXTEND_LIMIT");
      // まだ30日より先まである（今日押しても延びない）: 今の期限のまま
      return json(200, { expiresAt: meta.expiresAt, limitAt: meta.limitAt } satisfies ExpiryView);
    }
    const next: Meta = { ...meta, expiresAt: iso(to) };
    await env.store.put(metaKey(id), JSON.stringify(next));
    return json(200, { expiresAt: next.expiresAt, limitAt: next.limitAt } satisfies ExpiryView);
  }
  // お客さま: 書類のファイルを置く・外す（答えの前でも後でも。送り状に載せたものは外せない）
  if (rest.length === 2 && rest[0] === "files" && (m === "PUT" || m === "DELETE")) {
    const fileId = rest[1] as string;
    if (!FILE_ID_PATTERN.test(fileId)) return fail(404, "E_RELAY_NOT_FOUND");
    if (!(await authorized(req, meta.submitHash))) return fail(401, "E_RELAY_DENIED");
    const key = `${filePrefix(id)}${fileId}`;
    if (m === "DELETE") {
      if ((await readBatches(env, id)).some((b) => b.files.includes(fileId))) return fail(409, "E_RELAY_SEALED");
      await env.store.delete([key]);
      return json(204, null);
    }
    const text = await bodyText(req, RELAY_LIMITS.documentChars + 64);
    if (text === null) return fail(413, "E_RELAY_TOO_LARGE");
    const data = envelopeOf(text);
    if (data === null) return fail(400, "E_RELAY_BAD");
    const files = await env.store.list(filePrefix(id));
    if (files.length + 1 > RELAY_LIMITS.files || files.reduce((s, f) => s + f.size, 0) + data.length > RELAY_LIMITS.totalDocumentChars) return fail(413, "E_RELAY_TOO_LARGE");
    // ファイルの番号は乱数。同じ番号に書き直さない（送り状に載せた後に中身を替えられないように）
    if (!(await env.store.put(key, data, true))) return fail(409, "E_RELAY_EXISTS");
    return json(201, null);
  }
  // お客さま: 書類の送り（送り状の暗号文と、その送りのファイルの番号）。同じ送りをもう一度送るのは受ける（つながりが切れたときの送り直し）
  if (rest.length === 2 && rest[0] === "batches" && m === "PUT") {
    const batchId = rest[1] as string;
    if (!BATCH_ID_PATTERN.test(batchId)) return fail(404, "E_RELAY_NOT_FOUND");
    if (!(await authorized(req, meta.submitHash))) return fail(401, "E_RELAY_DENIED");
    const text = await bodyText(req, RELAY_LIMITS.batchChars + 2048);
    if (text === null) return fail(413, "E_RELAY_TOO_LARGE");
    const body = batchOf(text);
    if (body === null) return fail(400, "E_RELAY_BAD");
    const batches = await readBatches(env, id);
    const same = batches.find((b) => b.batchId === batchId);
    if (same !== undefined) return same.files.length === body.files.length && same.files.every((f, i) => f === body.files[i]) ? json(200, null) : fail(409, "E_RELAY_EXISTS");
    if (batches.length >= RELAY_LIMITS.batches) return fail(413, "E_RELAY_TOO_LARGE");
    const sealed = new Set(batches.flatMap((b) => b.files));
    if (body.files.some((f) => sealed.has(f))) return fail(409, "E_RELAY_SEALED");
    const onServer = new Set((await env.store.list(filePrefix(id))).map((f) => f.key.slice(filePrefix(id).length)));
    if (!body.files.every((f) => onServer.has(f))) return fail(400, "E_RELAY_BAD");
    const stored: StoredBatch = { data: body.data, files: body.files, at: iso(env.now().getTime()) };
    if (!(await env.store.put(`${batchPrefix(id)}${batchId}`, JSON.stringify(stored), true))) return fail(409, "E_RELAY_EXISTS");
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
    await env.store.put(metaKey(id), JSON.stringify({ ...meta, submittedAt: iso(env.now().getTime()) }));
    return json(201, null);
  }
  // FP: 受け取った答え・書類の送りを消す（依頼と問いは期限まで残す）
  if (m === "DELETE" && ((rest.length === 1 && rest[0] === "answers") || (rest.length === 2 && rest[0] === "batches"))) {
    if (!(await authorized(req, meta.pickupHash))) return fail(401, "E_RELAY_DENIED");
    if (rest[0] === "answers") {
      await env.store.delete([answersKey(id)]);
      return json(204, null);
    }
    const batchId = rest[1] as string;
    if (!BATCH_ID_PATTERN.test(batchId)) return fail(404, "E_RELAY_NOT_FOUND");
    const b = (await readBatches(env, id)).find((x) => x.batchId === batchId);
    // ファイルを先に、送り状を最後に（途中で止まっても、送り状が残るのでもう一度消せる）
    if (b !== undefined) await env.store.delete(b.files.map((f) => `${filePrefix(id)}${f}`));
    await env.store.delete([`${batchPrefix(id)}${batchId}`]);
    return json(204, null);
  }
  // FP: 状況・答え・書類の送り・書類のファイル
  if (m === "GET" && (rest[0] === "status" || rest[0] === "answers" || rest[0] === "files" || rest[0] === "batches")) {
    if (!(await authorized(req, meta.pickupHash))) return fail(401, "E_RELAY_DENIED");
    if (rest.length === 1 && rest[0] === "status") {
      const answers = (await env.store.list(answersKey(id))).some((o) => o.key === answersKey(id));
      const batches: BatchView[] = (await readBatches(env, id)).map((b) => ({ batchId: b.batchId, at: b.at, files: b.files }));
      const view: StatusView = { expiresAt: meta.expiresAt, limitAt: meta.limitAt, submitted: meta.submittedAt !== null, submittedAt: meta.submittedAt, answers, batches };
      return json(200, view);
    }
    if (rest.length === 1 && rest[0] === "answers") {
      const a = await env.store.get(answersKey(id));
      return a === null ? fail(404, "E_RELAY_NOT_SUBMITTED") : json(200, { data: a.text });
    }
    if (rest.length === 2 && rest[0] === "batches" && BATCH_ID_PATTERN.test(rest[1] as string)) {
      const b = (await readBatches(env, id)).find((x) => x.batchId === rest[1]);
      return b === undefined ? fail(404, "E_RELAY_GONE") : json(200, { data: b.data, files: b.files, at: b.at });
    }
    if (rest.length === 2 && rest[0] === "files" && FILE_ID_PATTERN.test(rest[1] as string)) {
      const f = await env.store.get(`${filePrefix(id)}${rest[1] as string}`);
      return f === null ? fail(404, "E_RELAY_GONE") : json(200, { data: f.text });
    }
  }
  return fail(404, "E_RELAY_NOT_FOUND");
}

const ENVELOPE = /^1\.[A-Za-z0-9_.-]+$/;

/** 体 {"data": "1.…"} の暗号文（封筒の形だけを確かめる。中身は見ない） */
function envelopeOf(text: string): string | null {
  try {
    const v = JSON.parse(text) as { data?: unknown };
    return typeof v.data === "string" && ENVELOPE.test(v.data) && Object.keys(v).length === 1 ? v.data : null;
  } catch {
    return null;
  }
}

/** 体 {"data": "1.…", "files": [番号…]}（送り状の暗号文と、その送りのファイルの番号。重なり・数の上限を確かめる） */
function batchOf(text: string): { data: string; files: string[] } | null {
  try {
    const v = JSON.parse(text) as { data?: unknown; files?: unknown };
    if (typeof v.data !== "string" || !ENVELOPE.test(v.data) || v.data.length > RELAY_LIMITS.batchChars || !Array.isArray(v.files) || Object.keys(v).length !== 2) return null;
    const files = v.files as unknown[];
    if (files.length === 0 || files.length > DOCUMENT_LIMITS.files || !files.every((f) => typeof f === "string" && FILE_ID_PATTERN.test(f)) || new Set(files).size !== files.length) return null;
    return { data: v.data, files: files as string[] };
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

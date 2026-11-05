var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../src/web/documents.ts
var DOCUMENT_LIMITS = {
  /** 1つのファイル（縮めた後・暗号化する前） */
  fileBytes: 10 * 1024 * 1024,
  /** 1つの依頼の合計 */
  totalBytes: 40 * 1024 * 1024,
  /** 1つの依頼のファイルの数 */
  files: 20,
  /** 1通の書類に付けられるファイルの数 */
  filesPerDocument: 6,
  /** 写真を縮めるときの長い辺の画素 */
  photoMaxSide: 2e3,
  /** 頼める書類の数 */
  documents: 15
};

// ../src/web/protocol.ts
var API_PREFIX = "/api/hearing/v1";
var ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
var FILE_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
var TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
var HASH_PATTERN = /^[0-9a-f]{64}$/;
var RELAY_LIMITS = {
  questionsChars: 400 * 1024,
  answersChars: 800 * 1024,
  documentChars: Math.ceil(DOCUMENT_LIMITS.fileBytes * 4 / 3) + 1024,
  totalDocumentChars: Math.ceil(DOCUMENT_LIMITS.totalBytes * 4 / 3) + 64 * 1024,
  files: DOCUMENT_LIMITS.files + 10,
  /** 有効期限の上限と下限（日） */
  maxDays: 30,
  minDays: 1
};

// handler.ts
var JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
var json = /* @__PURE__ */ __name((status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: JSON_HEADERS }), "json");
var fail = /* @__PURE__ */ __name((status, code) => json(status, { error: code }), "fail");
var metaKey = /* @__PURE__ */ __name((id) => `r/${id}/meta`, "metaKey");
var questionsKey = /* @__PURE__ */ __name((id) => `r/${id}/q`, "questionsKey");
var answersKey = /* @__PURE__ */ __name((id) => `r/${id}/a`, "answersKey");
var filePrefix = /* @__PURE__ */ __name((id) => `r/${id}/f/`, "filePrefix");
async function sha256Hex(s) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function sameHex(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
__name(sameHex, "sameHex");
async function bodyText(req, max) {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > max) return null;
  const t = await req.text();
  return t.length > max ? null : t;
}
__name(bodyText, "bodyText");
function bearer(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.get("authorization") ?? "");
  return m === null ? null : m[1];
}
__name(bearer, "bearer");
async function readMeta(env, id) {
  const o = await env.store.get(metaKey(id));
  if (o === null) return "gone";
  let m;
  try {
    m = JSON.parse(o.text);
  } catch {
    return "gone";
  }
  if (Date.parse(m.expiresAt) <= env.now().getTime()) {
    await removeAll(env, id);
    return "expired";
  }
  return m;
}
__name(readMeta, "readMeta");
async function removeAll(env, id) {
  const files = await env.store.list(filePrefix(id));
  await env.store.delete([...files.map((f) => f.key), answersKey(id), questionsKey(id), metaKey(id)]);
}
__name(removeAll, "removeAll");
async function authorized(req, hash) {
  const t = bearer(req);
  return t !== null && TOKEN_PATTERN.test(t) && sameHex(await sha256Hex(t), hash);
}
__name(authorized, "authorized");
function originOk(req) {
  const o = req.headers.get("origin");
  if (o === null) return true;
  try {
    return new URL(o).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}
__name(originOk, "originOk");
async function handleApi(req, env) {
  try {
    return await route(req, env);
  } catch {
    return fail(500, "E_RELAY_INTERNAL");
  }
}
__name(handleApi, "handleApi");
async function route(req, env) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(`${API_PREFIX}/`)) return fail(404, "E_RELAY_NOT_FOUND");
  if (url.search !== "") return fail(400, "E_RELAY_BAD");
  if (!originOk(req)) return fail(403, "E_RELAY_ORIGIN");
  const parts = url.pathname.slice(API_PREFIX.length + 1).split("/");
  const m = req.method;
  if (parts.length === 1 && parts[0] === "requests" && m === "POST") {
    const who = req.headers.get("cf-connecting-ip") ?? "local";
    if (env.createLimiter !== void 0 && !(await env.createLimiter.limit({ key: who })).success) return fail(429, "E_RELAY_BUSY");
    const text = await bodyText(req, RELAY_LIMITS.questionsChars + 1024);
    if (text === null) return fail(413, "E_RELAY_TOO_LARGE");
    let b;
    try {
      b = JSON.parse(text);
    } catch {
      return fail(400, "E_RELAY_BAD");
    }
    if (typeof b !== "object" || b === null || !ID_PATTERN.test(String(b.id)) || typeof b.questions !== "string" || !/^1\.[A-Za-z0-9_.-]+$/.test(b.questions) || !HASH_PATTERN.test(String(b.submitHash)) || !HASH_PATTERN.test(String(b.pickupHash)) || b.submitHash === b.pickupHash || typeof b.expiresAt !== "string") return fail(400, "E_RELAY_BAD");
    const now = env.now().getTime();
    const exp = Date.parse(b.expiresAt);
    if (!Number.isFinite(exp) || exp < now + RELAY_LIMITS.minDays * 864e5 - 36e5 || exp > now + RELAY_LIMITS.maxDays * 864e5 + 36e5) return fail(400, "E_RELAY_EXPIRY");
    const meta2 = { v: 1, createdAt: env.now().toISOString(), expiresAt: new Date(exp).toISOString(), submitHash: b.submitHash, pickupHash: b.pickupHash, submittedAt: null };
    if (!await env.store.put(metaKey(b.id), JSON.stringify(meta2), true)) return fail(409, "E_RELAY_EXISTS");
    await env.store.put(questionsKey(b.id), b.questions);
    return json(201, { expiresAt: meta2.expiresAt });
  }
  if (parts[0] !== "requests" || parts.length < 2) return fail(404, "E_RELAY_NOT_FOUND");
  const id = parts[1];
  if (!ID_PATTERN.test(id)) return fail(404, "E_RELAY_NOT_FOUND");
  if (env.requestLimiter !== void 0 && !(await env.requestLimiter.limit({ key: id })).success) return fail(429, "E_RELAY_BUSY");
  const meta = await readMeta(env, id);
  if (meta === "gone") return fail(404, "E_RELAY_GONE");
  if (meta === "expired") return fail(410, "E_RELAY_EXPIRED");
  const rest = parts.slice(2);
  if (rest.length === 0 && m === "GET") {
    const q = await env.store.get(questionsKey(id));
    if (q === null) return fail(404, "E_RELAY_GONE");
    return json(200, { questions: q.text, expiresAt: meta.expiresAt, submitted: meta.submittedAt !== null });
  }
  if (rest.length === 0 && m === "DELETE") {
    if (!await authorized(req, meta.pickupHash)) return fail(401, "E_RELAY_DENIED");
    await removeAll(env, id);
    return json(204, null);
  }
  if (rest.length === 2 && rest[0] === "files" && (m === "PUT" || m === "DELETE")) {
    const fileId = rest[1];
    if (!FILE_ID_PATTERN.test(fileId)) return fail(404, "E_RELAY_NOT_FOUND");
    if (!await authorized(req, meta.submitHash)) return fail(401, "E_RELAY_DENIED");
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
  if (rest.length === 1 && rest[0] === "answers" && m === "PUT") {
    if (!await authorized(req, meta.submitHash)) return fail(401, "E_RELAY_DENIED");
    if (meta.submittedAt !== null) return fail(409, "E_RELAY_SUBMITTED");
    const text = await bodyText(req, RELAY_LIMITS.answersChars + 64);
    if (text === null) return fail(413, "E_RELAY_TOO_LARGE");
    const data = envelopeOf(text);
    if (data === null) return fail(400, "E_RELAY_BAD");
    if (!await env.store.put(answersKey(id), data, true)) return fail(409, "E_RELAY_SUBMITTED");
    await env.store.put(metaKey(id), JSON.stringify({ ...meta, submittedAt: env.now().toISOString() }));
    return json(201, null);
  }
  if (m === "GET" && (rest[0] === "status" || rest[0] === "answers" || rest[0] === "files")) {
    if (!await authorized(req, meta.pickupHash)) return fail(401, "E_RELAY_DENIED");
    if (rest.length === 1 && rest[0] === "status") {
      const files = await env.store.list(filePrefix(id));
      const view = { expiresAt: meta.expiresAt, submitted: meta.submittedAt !== null, submittedAt: meta.submittedAt, files: files.map((f) => ({ fileId: f.key.slice(filePrefix(id).length), chars: f.size })) };
      return json(200, view);
    }
    if (rest.length === 1 && rest[0] === "answers") {
      const a = await env.store.get(answersKey(id));
      return a === null ? fail(404, "E_RELAY_NOT_SUBMITTED") : json(200, { data: a.text });
    }
    if (rest.length === 2 && rest[0] === "files" && FILE_ID_PATTERN.test(rest[1])) {
      const f = await env.store.get(`${filePrefix(id)}${rest[1]}`);
      return f === null ? fail(404, "E_RELAY_GONE") : json(200, { data: f.text });
    }
  }
  return fail(404, "E_RELAY_NOT_FOUND");
}
__name(route, "route");
function envelopeOf(text) {
  try {
    const v = JSON.parse(text);
    return typeof v.data === "string" && /^1\.[A-Za-z0-9_.-]+$/.test(v.data) && Object.keys(v).length === 1 ? v.data : null;
  } catch {
    return null;
  }
}
__name(envelopeOf, "envelopeOf");
var PAGE_HEADERS = {
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; font-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "strict-transport-security": "max-age=31536000"
};

// r2.ts
function r2Store(b) {
  return {
    get: /* @__PURE__ */ __name(async (k) => {
      const o = await b.get(k);
      return o === null ? null : { text: await o.text() };
    }, "get"),
    // 1回だけ書く: If-None-Match: * の条件つきで書き、もうあれば R2 は書かずに null を返す
    put: /* @__PURE__ */ __name(async (k, t, onlyIfAbsent) => await b.put(k, t, onlyIfAbsent === true ? { onlyIf: new Headers({ "if-none-match": "*" }) } : void 0) !== null, "put"),
    delete: /* @__PURE__ */ __name(async (keys) => {
      if (keys.length > 0) await b.delete([...keys]);
    }, "delete"),
    list: /* @__PURE__ */ __name(async (prefix) => {
      const out = [];
      let cursor;
      for (let n = 0; n < 10; n++) {
        const r = await b.list({ prefix, limit: 1e3, ...cursor !== void 0 ? { cursor } : {} });
        out.push(...r.objects.map((o) => ({ key: o.key, size: o.size })));
        if (!r.truncated) break;
        cursor = r.cursor;
      }
      return out;
    }, "list")
  };
}
__name(r2Store, "r2Store");

// worker.ts
function withHeaders(res, extra) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}
__name(withHeaders, "withHeaders");
var worker_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
      const res2 = await handleApi(req, { store: r2Store(env.HEARING), now: /* @__PURE__ */ __name(() => /* @__PURE__ */ new Date(), "now"), ...env.LIMIT_CREATE !== void 0 ? { createLimiter: env.LIMIT_CREATE } : {}, ...env.LIMIT_REQUEST !== void 0 ? { requestLimiter: env.LIMIT_REQUEST } : {} });
      return withHeaders(res2, PAGE_HEADERS);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: PAGE_HEADERS });
    if (!url.pathname.startsWith("/h/")) return new Response(null, { status: 404, headers: PAGE_HEADERS });
    const res = await env.ASSETS.fetch(req);
    return withHeaders(res, { ...PAGE_HEADERS, "cache-control": "no-cache" });
  }
};

// ../../../../../../../.npm/_npx/d32e5042964412f9/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../../../.npm/_npx/d32e5042964412f9/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-4f381e/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../../../../.npm/_npx/d32e5042964412f9/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-4f381e/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map

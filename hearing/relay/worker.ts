// 受け付けのサーバー（0125）の入口（Cloudflare Workers）。API（/api/hearing/v1/…）は handler.ts、ほかはお客さまのページ（静的なファイル）。
// どの答えにも守りの見出しを付ける。ログに中身・IP を書かない（console を使わない。wrangler.toml で観測のログを切る）
// 毎日決まった時刻に、期限を過ぎた依頼を中身ごと消す（scheduled。wrangler.toml の [triggers]。0158）
import { API_PREFIX } from "../src/web/protocol.ts";
import { handleApi, PAGE_HEADERS, sweepExpired, type RateLimiter } from "./handler.ts";
import { r2Store, type R2BucketLike } from "./r2.ts";

interface Env {
  readonly HEARING: R2BucketLike;
  readonly ASSETS: { fetch(req: Request): Promise<Response> };
  readonly LIMIT_CREATE?: RateLimiter;
  readonly LIMIT_REQUEST?: RateLimiter;
}

function withHeaders(res: Response, extra: Readonly<Record<string, string>>): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}

interface ScheduledContext {
  waitUntil(p: Promise<unknown>): void;
}

export default {
  scheduled(_event: unknown, env: Env, ctx: ScheduledContext): void {
    ctx.waitUntil(sweepExpired({ store: r2Store(env.HEARING), now: () => new Date() }));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
      const res = await handleApi(req, { store: r2Store(env.HEARING), now: () => new Date(), ...(env.LIMIT_CREATE !== undefined ? { createLimiter: env.LIMIT_CREATE } : {}), ...(env.LIMIT_REQUEST !== undefined ? { requestLimiter: env.LIMIT_REQUEST } : {}) });
      return withHeaders(res, PAGE_HEADERS);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: PAGE_HEADERS });
    // お客さまのページは /h/ の下だけ
    if (!url.pathname.startsWith("/h/")) return new Response(null, { status: 404, headers: PAGE_HEADERS });
    const res = await env.ASSETS.fetch(req);
    return withHeaders(res, { ...PAGE_HEADERS, "cache-control": "no-cache" });
  },
};

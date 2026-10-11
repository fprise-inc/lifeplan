/// <reference types="vitest/config" />
// 画面のビルド（Vite）と単体テスト（Vitest）の設定
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { ENGINE_DIST, REPO_DIR } from "./scripts/lib.ts";

/**
 * 開発用のサーバーだけの入口（本番のビルドには入らない）: Tauri の外（ふつうのブラウザ・ヘッドレスの Chrome）で画面を確かめるために、
 * 本体の命令の代わりに、架空のモデル世帯と制度データを返す。画面の側は import.meta.env.DEV のときだけ使う
 */
function devHost(): Plugin {
  const households = join(REPO_DIR, "data", "modelHouseholds");
  const regulation = join(ENGINE_DIST, "regulation");
  return {
    name: "financia-dev-host",
    apply: "serve",
    configureServer(server) {
      // FINANCIA_DEVLOG=1 のとき、画面からの要求を1行ずつ出す（WebView の中が見えないときの切り分け用）
      if (process.env.FINANCIA_DEVLOG === "1") server.middlewares.use((req, _res, next) => (console.log(`[dev] ${req.method} ${req.url}`), next()));
      server.middlewares.use("/__dev/", (req, res) => {
        const path = (req.url ?? "").replace(/^\/+/, "");
        // 画面の自己確認（#selfcheck）の待ち
        const sl = /^sleep\/(\d+)$/.exec(path);
        if (sl !== null) {
          setTimeout(() => res.end(), Math.min(Number(sl[1]), 10_000));
          return;
        }
        // 画面の自己確認（#selfcheck）の区切り（画面を撮る合図）
        if (path.startsWith("stage/")) {
          console.log(`[stage] ${decodeURIComponent(path.slice(6))}`);
          res.end();
          return;
        }
        // 画面の自己確認（#selfcheck）の結果を受け取る。FINANCIA_REPORT があればそのファイルに書く
        if (path === "report" && req.method === "POST") {
          let body = "";
          req.on("data", (c: Buffer) => (body += c.toString("utf8")));
          req.on("end", () => {
            const out = process.env.FINANCIA_REPORT;
            if (out !== undefined && out !== "") writeFileSync(out, body);
            else console.log(body);
            res.end();
          });
          return;
        }
        const send = (body: string) => {
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(body);
        };
        if (path === "households") return send(JSON.stringify(readdirSync(households).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort()));
        if (path === "packs") return send(`[${readdirSync(regulation).filter((f) => f.endsWith(".json")).sort().map((f) => readFileSync(join(regulation, f), "utf8")).join(",")}]`);
        const m = /^households\/([A-Za-z0-9]+)$/.exec(path);
        if (m !== null) return send(readFileSync(join(households, `${m[1]}.json`), "utf8"));
        res.statusCode = 404;
        res.end();
      });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [devHost()],
  server: { port: 1420, strictPort: true },
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: {
    target: "es2022",
    // 0016: CSP（img-src・font-src は 'self' だけ）の下で data: の URI を作らない
    assetsInlineLimit: 0,
    // 計算エンジン（public/engine/engine.js）は大きいが、まとめずにそのまま写す
    chunkSizeWarningLimit: 1024,
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
    testTimeout: 60_000,
  },
});

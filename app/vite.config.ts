/// <reference types="vitest/config" />
// 画面のビルド（Vite）と単体テスト（Vitest）の設定
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { APP_DIR, ENGINE_DIST, REPO_DIR } from "./scripts/lib.ts";

/**
 * 開発用のサーバーだけの入口（本番のビルドには入らない）: Tauri の外（ふつうのブラウザ・ヘッドレスの Chrome）で画面を確かめるために、
 * 本体の命令の代わりに、架空のモデル世帯と制度データを返す。画面の側は import.meta.env.DEV のときだけ使う
 */
/** 必須の記載（本体の app/src-tauri/src/report.rs と同じ文。開発用のサーバーで見本を作るときだけ使う） */
const DEV_NOTICES = [
  "この提案書は、お伺いした情報と前提条件にもとづく試算です。将来の金額や結果を保証するものではありません。",
  "公的データの出典: 国税庁、厚生労働省、日本年金機構、文部科学省、金融庁、総務省統計局の公表資料（加工して作成）",
  "前提条件や計算方法の一部は担当FPが設定しています。",
];
const DEV_REFORM = "遺族年金は2028年4月の見直し前の制度で計算しています（2028年4月以後に亡くなる想定）。";

function readBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((ok, ng) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", ng);
  });
}

/** 開発用のサーバーの世帯の保存（メモリの中だけ。再起動で消える） */
const devStore = {
  households: new Map<string, { customerNo: string; summary: string; createdAt: string; updatedAt: string; body: string; generation: number }>(),
  lastOpened: null as string | null,
  acknowledgedAt: null as string | null,
  verifiedAt: null as string | null,
  next: 1,
  // 見本の復元キー（開発用。本物の親鍵ではない）
  recoveryKey: Array.from({ length: 58 }, (_, i) => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[(i * 7 + 3) % 32]).join("").replace(/(.{4})(?=.)/g, "$1-"),
  deletions: 0,
};

function devStoreOp(op: string, a: Record<string, string>): { ok: true; value?: unknown } | { ok: false; code: string } {
  const s = devStore;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const status = () => ({ state: "ready", firstRun: s.households.size === 0 && s.acknowledgedAt === null, recoveryAcknowledged: s.acknowledgedAt !== null, recoveryVerifiedAt: s.verifiedAt, lastOpened: s.lastOpened, deletionsPending: s.deletions, deletionsCompleted: 0 });
  const norm = (k: string) => k.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  const withMeta = (body: string, customerNo: string) => JSON.stringify({ ...(JSON.parse(body) as object), meta: { format: "lifeplan.household", formatVersion: "0.1", savedAt: now, appVersion: "dev", customerNo } });
  const h = a.id !== undefined ? s.households.get(a.id) : undefined;
  switch (op) {
    case "status":
      return { ok: true, value: status() };
    case "list":
      return { ok: true, value: [...s.households.entries()].map(([id, e]) => ({ id, customerNo: e.customerNo, summary: e.summary, createdAt: e.createdAt, updatedAt: e.updatedAt })).sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : -1)) };
    case "create": {
      const id = crypto.randomUUID();
      const customerNo = `D${String(s.next++).padStart(4, "0")}`;
      s.households.set(id, { customerNo, summary: a.summary ?? "", createdAt: now, updatedAt: now, body: a.body ?? "{}", generation: 1 });
      s.lastOpened = id;
      return { ok: true, value: { id, customerNo, body: withMeta(a.body ?? "{}", customerNo), readOnly: false, generation: 1 } };
    }
    case "open":
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      s.lastOpened = a.id ?? null;
      return { ok: true, value: { id: a.id, customerNo: h.customerNo, body: withMeta(h.body, h.customerNo), readOnly: false, generation: h.generation } };
    case "save":
      if (h === undefined) return { ok: false, code: "E_STORE_NOT_OPEN" };
      Object.assign(h, { body: a.body, summary: a.summary, updatedAt: now, generation: h.generation + 1 });
      return { ok: true, value: { generation: h.generation, savedAt: now } };
    case "rename":
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      if (!/^[A-Za-z0-9_-]{1,16}$/.test((a.customerNo ?? "").trim())) return { ok: false, code: "E_STORE_CUSTOMER_NO" };
      h.customerNo = (a.customerNo ?? "").trim();
      return { ok: true, value: { customerNo: h.customerNo, duplicate: [...s.households.entries()].some(([k, e]) => k !== a.id && e.customerNo === h.customerNo) } };
    case "delete":
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      if ((a.confirm ?? "").trim() !== h.customerNo) return { ok: false, code: "E_STORE_CONFIRM" };
      s.households.delete(a.id as string);
      if (s.lastOpened === a.id) s.lastOpened = null;
      s.deletions++;
      return { ok: true };
    case "recoveryKey":
      return { ok: true, value: s.recoveryKey };
    case "acknowledge":
      s.acknowledgedAt = now;
      return { ok: true, value: status() };
    case "test":
    case "restore": {
      const k = norm(a.key ?? "");
      if (k.length !== 58) return { ok: false, code: "E_RECOVERY_TYPO" };
      if (k !== norm(s.recoveryKey)) return { ok: false, code: "E_RECOVERY_MISMATCH" };
      if (op === "test") s.verifiedAt = now;
      return { ok: true, value: status() };
    }
  }
  return { ok: false, code: "E_DEV_STORE_OP" };
}

function devHost(): Plugin {
  const households = join(REPO_DIR, "data", "modelHouseholds");
  const regulation = join(ENGINE_DIST, "regulation");
  // 提案書の見本（開発用）: 最後に作った PDF とページの PNG の置き場
  let lastReport: { dir: string; issuedOn: string } | null = null;
  const saveDir = () => process.env.FINANCIA_DEV_SAVE_DIR ?? "";
  const reportBin = () => [process.env.REPORT_PDF_BIN, join(REPO_DIR, "target", "release", "report-pdf"), join(REPO_DIR, "target", "debug", "report-pdf")].find((p): p is string => p !== undefined && p !== "" && existsSync(p)) ?? null;
  const dataSetLabel = (baseMonth: string) => {
    const ids = readdirSync(regulation)
      .filter((f) => f.endsWith(".json"))
      .map((f) => (JSON.parse(readFileSync(join(regulation, f), "utf8")) as { pack: { packId: string; version: string } }).pack)
      .map((p) => `${p.packId}@${p.version}`)
      .sort();
    return `${baseMonth.replace("-", ".")}-${createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 8)}`;
  };
  return {
    name: "financia-dev-host",
    apply: "serve",
    configureServer(server) {
      // FINANCIA_DEVLOG=1 のとき、画面からの要求を1行ずつ出す（WebView の中が見えないときの切り分け用）
      if (process.env.FINANCIA_DEVLOG === "1") server.middlewares.use((req, _res, next) => (console.log(`[dev] ${req.method} ${req.url}`), next()));
      server.middlewares.use("/__dev/", (req, res, next) => {
        const path = (req.url ?? "").replace(/^\/+/, "");
        // 提案書の PDF（本体の proposal_render・proposal_page・proposal_save の代わり。report-pdf のコマンドを呼ぶ）
        if (path === "report/render" && req.method === "POST") {
          void (async () => {
            const t0 = performance.now();
            const { input, addressee } = JSON.parse((await readBody(req)).toString("utf8")) as { input: string; addressee: string | null };
            const bin = reportBin();
            if (bin === null) return void ((res.statusCode = 500), res.end("E_DEV_NO_REPORT_PDF"));
            const data = JSON.parse(input) as { basis: { baseMonth: string }; document: { issuedOn: string }; assumptions: { survivorReform: boolean } };
            const label = dataSetLabel(data.basis.baseMonth);
            const frame = { stamp: { dataSetLabel: label, baseMonth: data.basis.baseMonth }, beta: true, notices: [...DEV_NOTICES, ...(data.assumptions.survivorReform ? [DEV_REFORM] : [])], internal: { snapshotId: null, dataSetId: label, customDigests: [] } };
            const dir = mkdtempSync(join(tmpdir(), "financia-dev-report-"));
            writeFileSync(join(dir, "input.json"), input);
            writeFileSync(join(dir, "frame.json"), JSON.stringify(frame));
            const args = ["render", "--input", join(dir, "input.json"), "--frame", join(dir, "frame.json"), "--out", join(dir, "out.pdf"), "--meta", join(dir, "meta.json"), "--pages-dir", dir, "--scale", "0.5"];
            if (addressee !== null && addressee.trim() !== "") args.push("--addressee", addressee);
            execFile(bin, args, (err, _out, stderr) => {
              if (err !== null) return void ((res.statusCode = 500), res.end(/"code":"([A-Z_]+)"/.exec(stderr)?.[1] ?? "E_DEV_REPORT"));
              const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { pages: number; bytes: number; noticesPageAdded: boolean; sizes: [number, number][] };
              lastReport = { dir, issuedOn: data.document.issuedOn };
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ pages: meta.pages, sizes: meta.sizes, bytes: meta.bytes, ms: performance.now() - t0, noticesPageAdded: meta.noticesPageAdded }));
            });
          })();
          return;
        }
        const pg = /^report\/(page|svg)\/(\d+)$/.exec(path);
        if (pg !== null) {
          const svg = pg[1] === "svg";
          const f = lastReport === null ? null : join(lastReport.dir, `page-${pg[2]}.${svg ? "svg" : "png"}`);
          if (f === null || !existsSync(f)) return void ((res.statusCode = 404), res.end());
          res.setHeader("content-type", svg ? "image/svg+xml" : "image/png");
          return void res.end(readFileSync(f));
        }
        if (path === "report/save" && req.method === "POST") {
          if (lastReport === null) return void ((res.statusCode = 400), res.end("E_REPORT_NONE"));
          if (saveDir() === "") return void ((res.statusCode = 400), res.end("E_DEV_NO_SAVE_DIR"));
          const name = `提案書_${lastReport.issuedOn}.pdf`;
          copyFileSync(join(lastReport.dir, "out.pdf"), join(saveDir(), name));
          const digest = `sha256:${createHash("sha256").update(readFileSync(join(saveDir(), name))).digest("hex")}`;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return void res.end(JSON.stringify({ saved: true, fileName: name, syncFolder: false, digest }));
        }
        if (path === "report/discard" && req.method === "POST") {
          lastReport = null;
          return void res.end();
        }
        // ヒアリングシート（本体の hearing_save・hearing_open の代わり）
        if (path.startsWith("sheets/save") && req.method === "POST") {
          void (async () => {
            const body = await readBody(req);
            if (saveDir() === "") return void ((res.statusCode = 400), res.end("E_DEV_NO_SAVE_DIR"));
            const q = new URL(req.url ?? "", "http://localhost").searchParams;
            const no = /^[A-Za-z0-9_-]{1,16}$/.test(q.get("customerNo") ?? "") ? `_${q.get("customerNo")}` : "";
            const on = /^\d{4}-\d{2}-\d{2}$/.test(q.get("exportedOn") ?? "") ? `_${q.get("exportedOn")}` : "";
            const name = `ヒアリングシート${no}${on}.xlsx`;
            writeFileSync(join(saveDir(), name), body);
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ saved: true, fileName: name, syncFolder: false, digest: `sha256:${createHash("sha256").update(body).digest("hex")}` }));
          })();
          return;
        }
        if (path === "sheets/open") {
          const f = process.env.FINANCIA_DEV_OPEN_FILE || join(REPO_DIR, "hearing", "samples", "basic-1-sample.xlsx");
          res.setHeader("content-type", "application/octet-stream");
          return void res.end(readFileSync(f));
        }
        // 世帯の保存（本体の store_*・recovery_key_* の代わり）: 開発用のサーバーのメモリの中だけ。暗号化もファイルへの保存もしない
        const st = /^store\/([a-zA-Z]+)$/.exec(path);
        if (st !== null && req.method === "POST") {
          void (async () => {
            const args = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, string>;
            const r = devStoreOp(st[1] as string, args);
            res.statusCode = r.ok ? 200 : 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(r.ok ? JSON.stringify(r.value ?? null) : r.code);
          })();
          return;
        }
        void next;
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
  // hearing/・report/ の部品（npm の依存なしの TypeScript）を画面から読む
  server: { port: 1420, strictPort: true, fs: { allow: [APP_DIR, join(REPO_DIR, "hearing"), join(REPO_DIR, "report"), join(REPO_DIR, "engine", "src")] } },
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

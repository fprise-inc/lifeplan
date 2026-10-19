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

/**
 * 開発用のサーバーの AI接続口（本体の ai_* の代わり。メモリの中だけ）。画面の確かめ用で、本物の受け口は開けない。
 * 決まり（既定はオフ・同意が無ければ渡さない・撤回で共有を止める・候補は判断を1回だけ）は本体（ai-share）と同じにしてある。
 * `/__dev/ai/simulate?kind=read|propose` で、AI からの読み取り・プランの候補が届いたことにする
 */
const devAi = {
  enabled: false,
  books: new Map<string, { consents: Record<string, unknown>[]; records: Record<string, unknown>[]; candidates: Record<string, unknown>[] }>(),
  share: null as null | { householdId: string; shareId: string; alias: string; expiresMs: number },
};
const DEV_AI_EXPLANATION = "（開発用の見本）ご相談の内容をもとにしたライフプランの計算や見直しの検討に、FPが契約している外部のAIを使うことがあります。\nAIに渡すのは、計算に必要な項目だけです。お名前・ご住所・FPのメモは渡しません。\nこの同意はいつでも撤回でき、撤回した後はAIに渡しません。";

function devAiOp(op: string, a: Record<string, unknown>): { ok: true; value?: unknown } | { ok: false; code: string } {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const id = typeof a.id === "string" ? a.id : "";
  const book = () => {
    let b = devAi.books.get(id);
    if (b === undefined) devAi.books.set(id, (b = { consents: [], records: [], candidates: [] }));
    return b;
  };
  const active = () => (devAi.share !== null && devAi.share.expiresMs > Date.now() ? devAi.share : null);
  const shareStatus = () => {
    const s = active();
    return s === null ? null : { shareId: s.shareId, alias: s.alias, householdId: s.householdId, customerNumber: devStore.households.get(s.householdId)?.customerNo ?? null, expiresInSec: Math.floor((s.expiresMs - Date.now()) / 1000) };
  };
  const end = (reason: string) => {
    const s = active();
    if (s === null) return;
    const r = devAi.books.get(s.householdId)?.records.find((x) => x.shareId === s.shareId);
    if (r !== undefined && r.endedAt === null) Object.assign(r, { endedAt: now, endReason: reason });
    devAi.share = null;
  };
  const consentState = (b: ReturnType<typeof book>) => (b.consents.at(-1)?.decision as string | undefined) ?? "none";
  const view = () => {
    const b = book();
    const sh = shareStatus();
    return { consentState: consentState(b), consents: b.consents, explanation: DEV_AI_EXPLANATION, explanationRef: "sha256:dev", share: sh !== null && sh.householdId === id ? sh : null, records: b.records, candidates: b.candidates, allowlistVersion: "reduced@1", fields: ["member.birth", "income.salary.annual", "livingExpense.monthly", "account.marketValue", "assumptions.inflation"], saved: devStore.households.has(id) };
  };
  const setup = (title: string, client: string, text: string) => ({ client, title, text });
  switch (op) {
    case "status": {
      const sh = shareStatus();
      return {
        ok: true,
        value: {
          enabled: devAi.enabled,
          running: devAi.enabled,
          problem: null,
          storeReady: true,
          connector: { found: true, version: "0.1.0", versionMatches: true },
          shares: sh === null ? [] : [sh],
          setup: [
            setup("コマンドで登録するAIアプリ（claude mcp add）", "command", 'claude mcp add --transport stdio --scope user -e LIFEPLAN_RUNTIME_DIR="<開発用の作業フォルダ>" fprise-lifeplan -- "<接続口の場所>" mcp'),
            setup("JSON の設定ファイル（mcpServers）に書くAIアプリ", "json", '{\n  "mcpServers": {\n    "fprise-lifeplan": {\n      "args": ["mcp"],\n      "command": "<接続口の場所>",\n      "env": { "LIFEPLAN_RUNTIME_DIR": "<開発用の作業フォルダ>" }\n    }\n  }\n}'),
            setup("TOML の設定ファイル（mcp_servers）に書くAIアプリ", "toml", '[mcp_servers.fprise-lifeplan]\ncommand = "<接続口の場所>"\nargs = ["mcp"]'),
          ],
          durations: [15, 60, 120, 240, 480],
          dev: true,
        },
      };
    }
    case "setEnabled":
      devAi.enabled = a.enabled === true;
      if (!devAi.enabled) end("revoked");
      return devAiOp("status", {});
    case "copySetup":
      return { ok: true, value: false };
    case "household":
      return devStore.households.has(id) ? { ok: true, value: view() } : { ok: false, code: "E_STORE_NOT_OPEN" };
    case "recordConsent": {
      const i = a.input as Record<string, unknown>;
      const b = book();
      if (i.fpConfirmed !== true) return { ok: false, code: "E_AI_CONSENT_FP_CONFIRM" };
      if (i.decision === "given" && consentState(b) === "given") return { ok: false, code: "E_AI_CONSENT_ALREADY" };
      if (i.decision === "withdrawn" && consentState(b) !== "given") return { ok: false, code: "E_AI_CONSENT_NOT_GIVEN" };
      b.consents.push({ id: crypto.randomUUID(), kind: "externalAi", decision: i.decision, obtainedOn: i.obtainedOn, method: i.method, explanationRef: "sha256:dev", ...(i.decision === "given" ? { externalAi: { company: i.company, country: i.country, noTrainingConfirmed: i.noTrainingConfirmed }, scope: "reduced" } : {}), fpConfirmed: true, recordedAt: now, origin: "thisOffice" });
      if (i.decision !== "given" && active()?.householdId === id) end("consentWithdrawn");
      return { ok: true, value: view() };
    }
    case "startShare": {
      const b = book();
      if (!devAi.enabled) return { ok: false, code: "E_AI_OFF" };
      if (consentState(b) !== "given") return { ok: false, code: "E_AI_NO_CONSENT" };
      if (active() !== null) return { ok: false, code: "E_AI_ALREADY_SHARED" };
      const minutes = Number(a.minutes);
      const shareId = `s-${crypto.randomUUID().slice(0, 8)}`;
      devAi.share = { householdId: id, shareId, alias: "共有中の世帯A", expiresMs: Date.now() + minutes * 60_000 };
      b.records.push({ id: crypto.randomUUID(), kind: "household", shareId, grantedAt: now, expiresAt: new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.\d+Z$/, "Z"), endedAt: null, endReason: null, scope: "reduced", allowlistVersion: "reduced@1", fields: view().fields, householdRevision: "generation-dev", destinationDeclared: String(a.destination), consentAtGrant: { state: "given", recordId: (b.consents.at(-1)?.id as string) ?? null, warned: false }, reads: [], proposals: [] });
      return { ok: true, value: view() };
    }
    case "stopShare":
      if (active()?.householdId === id) end("revoked");
      return { ok: true, value: view() };
    case "decide": {
      const c = book().candidates.find((x) => x.id === a.candidate);
      if (c === undefined) return { ok: false, code: "E_AI_CANDIDATE_UNKNOWN" };
      if (c.status !== "pending") return { ok: false, code: "E_AI_CANDIDATE_DECIDED" };
      Object.assign(c, { status: a.accept === true ? "accepted" : "rejected", decidedAt: now, decidedBy: "fp", planId: a.accept === true ? a.plan : null });
      return { ok: true, value: view() };
    }
    case "simulate": {
      const s = active();
      if (s === null) return { ok: false, code: "E_AI_NOT_SHARED" };
      const b = devAi.books.get(s.householdId)!;
      const r = b.records.find((x) => x.shareId === s.shareId)! as { reads: Record<string, unknown>[]; proposals: Record<string, unknown>[] };
      if (a.kind === "propose") {
        const cid = crypto.randomUUID();
        b.candidates.push({ id: cid, source: "ai", shareId: s.shareId, receivedAt: now, title: "物価の上がり方を年1.5%で見直したプラン", summary: "物価の前提を少し高めにし、老後の金融資産がどれだけ変わるかを比べるためのプランです。", diffs: [{ id: crypto.randomUUID(), target: { plan: "assumptions" }, item: "assumptions.inflation", op: "set", value: "0.015", note: "最近の物価の動きに合わせて高めに見る" }, { id: crypto.randomUUID(), target: { plan: "assumptions" }, item: "assumptions.marketShocks", op: "set", value: [{ year: 2030, drop: "0.3" }], note: "下落の年を足す" }], origin: { kind: "ai", connector: "dev-client 1.0" }, status: "pending", decidedAt: null, decidedBy: null, planId: null });
        r.proposals.push({ candidateId: cid, at: now });
      } else {
        const last = r.reads.at(-1);
        if (last !== undefined && last.tool === "get_shared_household") Object.assign(last, { count: (last.count as number) + 1, lastAt: now });
        else r.reads.push({ firstAt: now, lastAt: now, count: 1, tool: "get_shared_household", fields: view().fields, digest: "sha256:3f6c0a9d2b71e4c85a0f19d6b2c3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b", caller: { connectorPid: 4242, connectorExe: "lifeplan", parentExe: "ai-app", mcpClientDeclared: "dev-client 1.0" } });
      }
      return { ok: true };
    }
  }
  return { ok: false, code: "E_DEV_AI_OP" };
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
        // AI接続口（本体の ai_* の代わり）: 開発用のサーバーのメモリの中だけ。本物の受け口は開けない
        const ai = /^ai\/([a-zA-Z]+)(?:\?|$)/.exec(path);
        if (ai !== null) {
          void (async () => {
            const args = req.method === "POST" ? (JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>) : Object.fromEntries(new URL(req.url ?? "", "http://x").searchParams);
            const r = devAiOp(ai[1] as string, args);
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

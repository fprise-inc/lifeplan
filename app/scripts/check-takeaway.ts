// 持ち帰り用のレポート（0030）を、ネットワークを切ったヘッドレスのブラウザで開いて確かめる（npm の依存なし。ブラウザの DevTools の口（CDP）を Node の WebSocket で使う）。
// - 外への通信: ページが出したリクエストのうち、file:・blob:・data: 以外が1件でもあれば失敗（ネットワークは切ってあるので、届きはしないが試みも数える）
// - CSP の違反（securitypolicyviolation）が1件でもあれば失敗
// - グラフが出る・つまみを動かすと計算し直す（結論の文と線が変わる）・1つ前に戻す・最初に戻す（FP の提案の値）
// - パスワードありのファイル: 違うパスワードで開かない・正しいパスワードで開く
// - スマホの幅（375px）でも、グラフ・つまみが出て、横にはみ出さない
// 使い方: node scripts/check-takeaway.ts <パスワードなしの HTML> [<パスワードありの HTML> <パスワード>] [--shots <写真の置き場>]
// ブラウザの場所は環境変数 HEADLESS_BROWSER（無ければ CI の実行機が用意している CHROME_BIN）。見つからなければ、何もせず知らせて終わる（--require なら失敗）
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1] ?? null;
  args.splice(i, 2);
  return v;
};
const shots = flag("--shots");
const require = args.includes("--require");
const files = args.filter((a) => !a.startsWith("--"));
const [plainFile, lockedFile, password] = files;
if (plainFile === undefined) {
  console.error("使い方: node scripts/check-takeaway.ts <パスワードなしの HTML> [<パスワードありの HTML> <パスワード>] [--shots <dir>]");
  process.exit(2);
}

const browserPath = [process.env.HEADLESS_BROWSER, process.env.CHROME_BIN].find((p): p is string => p !== undefined && p !== "" && existsSync(p));
if (browserPath === undefined) {
  console.log("ヘッドレスのブラウザが見つからないので、持ち帰り用のレポートの確かめを飛ばします（HEADLESS_BROWSER で場所を渡せます）");
  process.exit(require ? 1 : 0);
}

const profile = mkdtempSync(join(tmpdir(), "financia-takeaway-check-"));
const browser = spawn(browserPath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--host-resolver-rules=MAP * ~NOTFOUND", ...(process.env.CI !== undefined ? ["--no-sandbox"] : []), "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise<string>((ok, ng) => {
  let buf = "";
  const t = setTimeout(() => ng(new Error("ブラウザの DevTools の口が開きませんでした")), 20_000);
  browser.stderr.on("data", (c: Buffer) => {
    buf += c.toString();
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m !== null) {
      clearTimeout(t);
      ok(m[1] as string);
    }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
let nextId = 1;
const pending = new Map<number, { ok: (v: unknown) => void; ng: (e: Error) => void }>();
type Listener = (params: Record<string, unknown>, sessionId: string | undefined) => void;
const listeners: { method: string; fn: Listener }[] = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error !== undefined) p?.ng(new Error(msg.error.message));
    else p?.ok(msg.result);
  } else if (msg.method !== undefined) for (const l of listeners) if (l.method === msg.method) l.fn(msg.params ?? {}, msg.sessionId);
});
function send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId !== undefined ? { sessionId } : {}) }));
  return new Promise<T>((ok, ng) => pending.set(id, { ok: ok as (v: unknown) => void, ng }));
}
const on = (method: string, fn: Listener) => listeners.push({ method, fn });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Page {
  session: string;
  eval<T>(expr: string): Promise<T>;
  until(expr: string, timeout?: number): Promise<void>;
  shot(name: string): Promise<void>;
  requests: string[];
}

async function openPage(file: string, viewport: { w: number; h: number; mobile: boolean }): Promise<Page> {
  const { targetId } = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  const requests: string[] = [];
  on("Network.requestWillBeSent", (p, s) => {
    if (s === sessionId) requests.push(String((p.request as { url: string }).url));
  });
  await send("Network.enable", {}, sessionId);
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: viewport.w, height: viewport.h, deviceScaleFactor: viewport.mobile ? 2 : 1, mobile: viewport.mobile }, sessionId);
  // CSP の違反を数える（DevTools から入れるので、ページの CSP の外）
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));" }, sessionId);
  await send("Page.navigate", { url: pathToFileURL(resolve(file)).href }, sessionId);
  const page: Page = {
    session: sessionId,
    requests,
    eval: async <T,>(expr: string) => {
      const r = await send<{ result: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails !== undefined) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value as T;
    },
    until: async (expr: string, timeout = 20_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await page.eval<boolean>(`!!(${expr})`).catch(() => false)) return;
        await sleep(100);
      }
      throw new Error(`待ちきれませんでした: ${expr}`);
    },
    shot: async (name: string) => {
      if (shots === null) return;
      mkdirSync(shots, { recursive: true });
      const { data } = await send<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true }, sessionId);
      writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
    },
  };
  return page;
}

const report: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  report.push({ name, ok, detail });
  console.log(`${ok ? "OK " : "NG "} ${name}${detail !== "" ? `（${detail}）` : ""}`);
};

const verdict = (p: Page) => p.eval<string>("document.querySelector('[data-verdict]')?.textContent ?? ''");
const linePath = (p: Page) => p.eval<string>("[...document.querySelectorAll('[data-result-card] svg path')].map(x=>x.getAttribute('d')).join('|').length + ':' + [...document.querySelectorAll('[data-result-card] svg path')].map(x=>x.getAttribute('d')).join('|').slice(0,4000)");
const slide = (p: Page, key: string, to: "min" | "max") =>
  p.eval<string>(`(()=>{const el=document.querySelector('[data-lever="${key}"]');if(!el)return'none';const v=el.${to};const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return v})()`);

async function commonChecks(p: Page, label: string) {
  await p.until("document.querySelector('[data-result-card] svg path')");
  check(`${label}: グラフが出る`, true);
  const v0 = await verdict(p);
  const l0 = await linePath(p);
  const levers = await p.eval<string[]>("[...document.querySelectorAll('[data-lever]')].map(x=>x.getAttribute('data-lever'))");
  check(`${label}: つまみが出る`, levers.length > 0, levers.join("・"));
  const key = levers.includes("livingMonthly") ? "livingMonthly" : (levers[0] ?? "");
  await slide(p, key, "max");
  await sleep(1200);
  const v1 = await verdict(p);
  const l1 = await linePath(p);
  check(`${label}: つまみ（${key}）で計算し直す`, l1 !== l0, `${v0} → ${v1}`);
  await p.eval("document.querySelector('[data-takeaway-undo]').click()");
  await sleep(1200);
  check(`${label}: 1つ前に戻す`, (await linePath(p)) === l0);
  await slide(p, key, "min");
  await sleep(600);
  await p.eval("document.querySelector('[data-takeaway-reset]').click()");
  await sleep(1200);
  check(`${label}: 最初に戻す`, (await linePath(p)) === l0);
  const overflow = await p.eval<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  check(`${label}: 横にはみ出さない`, overflow <= 1, `はみ出し ${overflow}px`);
}

async function finish(p: Page, label: string) {
  const csp = await p.eval<string[]>("window.__csp");
  check(`${label}: CSP の違反が無い`, csp.length === 0, csp.join(", "));
  const external = p.requests.filter((u) => !/^(file|blob|data):/.test(u));
  check(`${label}: 外への通信が無い`, external.length === 0, `リクエスト ${p.requests.length}件（外 ${external.length}件${external.length > 0 ? `: ${external.join(", ")}` : ""}）`);
}

try {
  // パスワードなし・広い画面
  const desk = await openPage(plainFile, { w: 1280, h: 900, mobile: false });
  await commonChecks(desk, "パスワードなし・広い画面");
  await desk.eval("window.scrollTo(0,0)");
  await desk.shot("01_パスワードなし_広い画面");
  await desk.eval("document.querySelector('[data-result-card] svg')?.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:700,clientY:400}))");
  await finish(desk, "パスワードなし・広い画面");

  // パスワードなし・スマホの幅
  const phone = await openPage(plainFile, { w: 375, h: 812, mobile: true });
  await commonChecks(phone, "パスワードなし・スマホの幅");
  await phone.eval("window.scrollTo(0,0)");
  await phone.shot("02_パスワードなし_スマホ");
  await finish(phone, "パスワードなし・スマホの幅");

  if (lockedFile !== undefined && password !== undefined) {
    const lp = await openPage(lockedFile, { w: 1280, h: 900, mobile: false });
    await lp.until("document.querySelector('[data-takeaway-gate]')");
    await lp.shot("03_パスワードあり_入力の画面");
    const typeAndOpen = (pw: string) =>
      lp.eval(`(()=>{const el=document.querySelector('[data-takeaway-password]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,${JSON.stringify(pw)});el.dispatchEvent(new Event('input',{bubbles:true}));setTimeout(()=>document.querySelector('[data-takeaway-open]').click(),50);})()`);
    await typeAndOpen("wrong-password");
    await lp.until("document.querySelector('[data-takeaway-error]')", 30_000);
    check("パスワードあり: 違うパスワードで開かない", (await lp.eval<boolean>("!document.querySelector('[data-takeaway]')")) === true);
    await lp.shot("04_パスワードあり_違うパスワード");
    await typeAndOpen(password);
    await lp.until("document.querySelector('[data-takeaway]')", 30_000);
    check("パスワードあり: 正しいパスワードで開く", true);
    await commonChecks(lp, "パスワードあり");
    await lp.eval("window.scrollTo(0,0)");
    await lp.shot("05_パスワードあり_開いた後");
    await finish(lp, "パスワードあり");
  }
} catch (e) {
  check("確かめの途中で止まりました", false, e instanceof Error ? e.message : String(e));
} finally {
  ws.close();
  browser.kill();
}

const ng = report.filter((r) => !r.ok);
if (shots !== null) writeFileSync(join(shots, "check.json"), JSON.stringify(report, null, 2));
console.log(ng.length === 0 ? `すべて通りました（${report.length}件）` : `通らなかったもの ${ng.length}件`);
process.exit(ng.length === 0 ? 0 : 1);

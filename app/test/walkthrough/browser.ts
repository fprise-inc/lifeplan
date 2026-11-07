// 通しの入力のテストの道具: 開発用のサーバー（Vite）と見えないブラウザ（DevTools の口 CDP を Node の WebSocket で使う。npm の依存なし）を起こし、
// 画面を人と同じ操作（押す・打つ・Tab）で動かす。持ち帰り用のレポートの確かめ（scripts/check-takeaway.ts）と同じやり方。
// ポートは空いている物を OS に選ばせる（開発中のアプリのポート 1420 は使わない）
// 待ち方（0132 の追記 2026-11-07）: 決まった時間を延ばすのでなく、物が出たことを待つ。ブラウザは DevTools の口が開いて答えるまで待ち、
// 起動に失敗したら1回だけ起こし直す（scripts/headless.ts）。開発用のサーバーは入口の読み込みが落ち着くまで待ってから画面を開き、
// 画面が出ない・読み込みが壊れた（依存のまとめ直しで古い部品を読んだ）ときは1回だけ読み直す。押す物・欄は、出るまで少し待って探し直す
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { launchHeadless, openSocket } from "../../scripts/headless.ts";
import { APP_DIR } from "../../scripts/lib.ts";
import { AUTOSAVE_MS } from "../../src/workspace/store/autosave.ts";
import { PAGE_HELPERS } from "./pageHelpers.ts";

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** 見えないブラウザの場所（環境変数 HEADLESS_BROWSER、無ければ CI の実行機が用意している CHROME_BIN、手元の Mac なら Chrome）。無ければ null */
export function browserPath(): string | null {
  return [process.env.HEADLESS_BROWSER, process.env.CHROME_BIN, process.platform === "darwin" ? MAC_CHROME : undefined].find((p): p is string => p !== undefined && p !== "" && existsSync(p)) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 押す物・欄が出るまで探し直す上限（ミリ秒）。出ればすぐ押す */
const LOCATE_MS = 8_000;
/** 画面の読み込みが壊れた印（依存のまとめ直しで古い部品を読んだ・部品を読めなかった） */
const BROKEN_LOAD = /Outdated Optimize Dep|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/;

export interface Session {
  url: string;
  page: Page;
  close(): Promise<void>;
}

/** 開発用のサーバーとブラウザを起こし、アプリの画面を開いたページを返す */
export async function start(): Promise<Session> {
  const exe = browserPath();
  if (exe === null) throw new Error("見えないブラウザが見つかりません（HEADLESS_BROWSER で場所を渡せます）");
  // 開発用のサーバー: 設定は vite.config.ts のまま、ポートだけ空いている物にする（port 0）
  const server: ViteDevServer = await createServer({ configFile: join(APP_DIR, "vite.config.ts"), root: APP_DIR, logLevel: "warn", server: { port: 0, strictPort: false, host: "127.0.0.1", hmr: false } });
  await server.listen();
  const addr = server.httpServer?.address();
  if (addr === null || addr === undefined || typeof addr === "string") throw new Error("開発用のサーバーのポートが分かりません");
  const url = `http://127.0.0.1:${addr.port}/`;
  // 入口を先に読ませ、静的な読み込みが落ち着くまで待つ（初めの依存のまとめを画面を開く前に済ませ、開いた後のまとめ直しを減らす）
  await server.warmupRequest("/src/main.tsx").catch(() => undefined);
  await server.waitForRequestsIdle().catch(() => undefined);
  const { proc, wsUrl } = await launchHeadless(exe, ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--lang=ja", ...(process.env.CI !== undefined ? ["--no-sandbox"] : []), "about:blank"], { prefix: "financia-walkthrough-" });
  const cdp = await connect(wsUrl);
  const page = await openPage(cdp, url);
  return {
    url,
    page,
    close: async () => {
      if (process.env.WALKTHROUGH_TIMING === "1") {
        const w = [...page.waits].sort((a, b) => b.ms - a.ms);
        if (page.stuck.length > 0) console.log(`計算しています が出たまま: ${page.stuck.slice(0, 10).join("、")}（${page.stuck.length}回）`);
        if (page.covered.length > 0) console.log(`隠れていた欄・ボタン: ${page.covered.join("、")}`);
        console.log(`待ち ${w.length}回・合計 ${Math.round(w.reduce((a, x) => a + x.ms, 0) / 1000)}秒・長い順: ${w.slice(0, 15).map((x) => `${x.what} ${x.ms}ms`).join("、")}`);
      }
      cdp.close();
      proc.kill();
      await server.close();
    },
  };
}

interface Cdp {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
  on(method: string, fn: (params: Record<string, unknown>, sessionId: string | undefined) => void): void;
  close(): void;
}

async function connect(wsUrl: string): Promise<Cdp> {
  const ws = await openSocket(wsUrl);
  let nextId = 1;
  const pending = new Map<number, { ok: (v: unknown) => void; ng: (e: Error) => void }>();
  const listeners: { method: string; fn: (p: Record<string, unknown>, s: string | undefined) => void }[] = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error !== undefined) p?.ng(new Error(msg.error.message));
      else p?.ok(msg.result);
    } else if (msg.method !== undefined) for (const l of listeners) if (l.method === msg.method) l.fn(msg.params ?? {}, msg.sessionId);
  });
  return {
    send: <T,>(method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params, ...(sessionId !== undefined ? { sessionId } : {}) }));
      return new Promise<T>((ok, ng) => pending.set(id, { ok: ok as (v: unknown) => void, ng }));
    },
    on: (method, fn) => void listeners.push({ method, fn }),
    close: () => ws.close(),
  };
}

/** 画面の要素の真ん中（押す所） */
interface Point {
  x: number;
  y: number;
  /** ほかの物に隠れていて押せない（欄なら Tab で来たのと同じく入る） */
  covered?: boolean;
}

/** アプリの画面を開いたページ。押す・打つは本物の入力の出来事（Input.dispatch*）で送る */
export class Page {
  /** ページで出た JavaScript の例外（画面が落ちていないかを見る） */
  readonly errors: string[] = [];
  private readonly cdp: Cdp;
  private readonly session: string;
  private constructor(cdp: Cdp, session: string) {
    this.cdp = cdp;
    this.session = session;
  }

  static async create(cdp: Cdp, session: string): Promise<Page> {
    const p = new Page(cdp, session);
    cdp.on("Runtime.exceptionThrown", (params, s) => {
      if (s === session) p.errors.push(String((params.exceptionDetails as { exception?: { description?: string }; text?: string }).exception?.description ?? (params.exceptionDetails as { text?: string }).text).slice(0, 300));
    });
    return p;
  }

  /** ページの中で式を評価する（手助けの関数 __wt を使える） */
  async eval<T>(expr: string): Promise<T> {
    const r = await this.cdp.send<{ result: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression: `(async()=>{const w=window.__wt;${expr}})()`, awaitPromise: true, returnByValue: true }, this.session);
    if (r.exceptionDetails !== undefined) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }

  /**
   * 押す物・欄の場所を探す（ページの中の式。見つかれば座標、無ければ理由の文字）。描き直しの途中で無いことがあるので、
   * 見つからなければ少しずつ待って探し直す（決まった時間を待つのでなく、出たらすぐ返す。上限 wait ミリ秒。最後の理由の文字を返す）
   */
  private async locate(expr: string, wait = LOCATE_MS): Promise<Point | string> {
    const t0 = Date.now();
    for (;;) {
      const r = await this.eval<Point | string>(expr).catch((e: unknown) => `探せませんでした: ${e instanceof Error ? e.message : String(e)}`);
      if (typeof r !== "string" || Date.now() - t0 >= wait) return r;
      await sleep(200);
    }
  }

  async until(expr: string, what: string, timeout = 30_000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await this.eval<boolean>(`return !!(${expr})`).catch(() => false)) return;
      await sleep(100);
    }
    throw new Error(`待ちきれませんでした: ${what}`);
  }

  /** 画面が落ち着くまで待つ（計算中の札が消え、描き直しが止まる） */
  /** 「計算しています」が出たままだった所 */
  readonly stuck: string[] = [];
  /** 待った時間の記録（WALKTHROUGH_TIMING=1 で終わりに出す） */
  readonly waits: { what: string; ms: number }[] = [];

  async settle(what = ""): Promise<void> {
    const t0 = Date.now();
    await sleep(150);
    // 「計算しています…」の札が出ている間は待つ（5秒まで。ずっと出たままの所は stuck に残す）
    await this.until("!document.body.innerText.includes('計算しています…')", "計算が終わる", 5_000).catch(async () => {
      this.stuck.push(`${what}: ${await this.eval<string>(`const el = [...document.querySelectorAll("body *")].filter((e) => w.vis(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes("計算しています…"))).at(-1); return el ? (el.className + " " + w.txt(el.parentElement ?? el).slice(0, 80)) : ""`).catch(() => "")}`);
    });
    await sleep(150);
    this.waits.push({ what, ms: Date.now() - t0 });
  }

  /** 欄に入る: 押す。隠れていれば押さずに欄に入る（隠れていた欄は covered に残す。パネルの下の帯に隠れる欄の手がかり） */
  readonly covered: string[] = [];
  private async enter(pt: Point, label: string): Promise<void> {
    if (pt.covered !== true) return this.press(pt);
    this.covered.push(label);
    if (!(await this.eval<boolean>("return w.focusCovered()"))) throw new Error(`欄に入れません: ${label}`);
  }

  private async press(pt: Point): Promise<void> {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await this.cdp.send("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 }, this.session);
  }

  private async key(key: string, code: string, vk: number, commands?: string[]): Promise<void> {
    await this.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, ...(commands !== undefined ? { commands } : {}) }, this.session);
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk }, this.session);
  }

  /** 文字で探した押せる物（ボタン・タブ・リンク）を押す。within はパネルの中だけ（panel）か画面全体（page） */
  async click(text: string, o: { within?: "panel" | "page" | "dialog"; nth?: number; exact?: boolean; row?: string } = {}): Promise<void> {
    const pt = await this.locate(`return w.target(${JSON.stringify(text)}, ${JSON.stringify(o.within ?? "page")}, ${o.nth ?? 0}, ${o.exact === true}, ${JSON.stringify(o.row ?? null)})`);
    if (typeof pt === "string") throw new Error(pt);
    // 隠れていれば、Tab で来て Enter を押すのと同じにする
    if (pt.covered === true) {
      await this.enter(pt, text);
      await this.key("Enter", "Enter", 13);
    } else await this.press(pt);
    await this.settle(`押す ${text}`);
  }

  /** 欄（名前で探す）を押して中を全部選び、文字を打って Tab で次へ（空の文字なら Backspace で消す） */
  async type(label: string, text: string, o: { nth?: number; within?: string } = {}): Promise<void> {
    const pt = await this.locate(`return w.field(${JSON.stringify(label)}, ${o.nth ?? 0}, ${JSON.stringify(o.within ?? null)})`);
    if (typeof pt === "string") throw new Error(pt);
    await this.enter(pt, label);
    // 人と同じく、中を全部選んでそのまま打つ（選んだ文字が打った文字に置き換わる。途中で空にしない）
    await this.key("a", "KeyA", 65, ["selectAll"]);
    if (text !== "") await this.cdp.send("Input.insertText", { text }, this.session);
    else await this.key("Backspace", "Backspace", 8);
    await this.key("Tab", "Tab", 9);
    await this.settle(`打つ ${label}`);
  }

  /** 欄の中の文字を Backspace で消す（打つ途中の空で物が消えないかを見る） */
  async clear(label: string, o: { nth?: number; within?: string } = {}): Promise<void> {
    const pt = await this.locate(`return w.field(${JSON.stringify(label)}, ${o.nth ?? 0}, ${JSON.stringify(o.within ?? null)})`);
    if (typeof pt === "string") throw new Error(pt);
    await this.enter(pt, label);
    await this.key("a", "KeyA", 65, ["selectAll"]);
    await this.key("Backspace", "Backspace", 8);
    await this.key("Tab", "Tab", 9);
    await this.settle();
  }

  /** 選ぶ欄（select）で選択肢を選ぶ。選択肢の一覧はブラウザの外に出るので、押して開いた後、値を選んで変更の出来事を送る */
  async choose(label: string, option: string, o: { nth?: number; within?: string } = {}): Promise<void> {
    // 欄が出るまで探し直す（選んだら "ok"。選べない理由の文字は探し直しの対象）
    const r = await this.locate(`const r = w.choose(${JSON.stringify(label)}, ${JSON.stringify(option)}, ${o.nth ?? 0}, ${JSON.stringify(o.within ?? null)}); return r === "ok" ? { x: 0, y: 0 } : r`);
    if (typeof r === "string") throw new Error(r);
    await this.settle();
  }

  /** 開いているパネルの文字 */
  panelText(): Promise<string> {
    return this.eval<string>("return w.panelText()");
  }

  async shot(dir: string | undefined, name: string): Promise<void> {
    if (dir === undefined || dir === "") return;
    mkdirSync(dir, { recursive: true });
    const { data } = await this.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" }, this.session);
    writeFileSync(join(dir, `${name}.png`), Buffer.from(data, "base64"));
  }

  /** 開発用のサーバーの世帯の置き場（メモリの中）から、いま開いている世帯の本文を読む */
  async savedBody(): Promise<string> {
    // 自動の保存は、変えてから少し待って書く（AUTOSAVE_MS）
    await sleep(AUTOSAVE_MS + 1000);
    return this.eval<string>(`const l=await (await fetch("/__dev/store/list",{method:"POST",body:"{}"})).json(); if(l.length===0) throw new Error("保存された世帯がありません"); const o=await (await fetch("/__dev/store/open",{method:"POST",body:JSON.stringify({id:l[0].id})})).json(); return o.body`);
  }
}

async function openPage(cdp: Cdp, url: string): Promise<Page> {
  const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  const page = await Page.create(cdp, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_HELPERS }, sessionId);
  await cdp.send("Page.navigate", { url }, sessionId);
  // 画面が出て（上の帯の世帯の名前のボタンか、初めての起動の問い）、読み込みが壊れていないことを待つ。出ない・壊れたら1回だけ読み直す
  // （初めの依存のまとめ〔Vite〕で時間がかかる・開いた後にまとめ直して古い部品を読むことがある）
  for (let i = 0; ; i++) {
    const broken = () => page.errors.some((e) => BROKEN_LOAD.test(e));
    try {
      await page.until(`document.querySelector('[role=tab], nav button') && (w.all("header button").some((b) => /[▼▲]$/.test(w.txt(b))) || !!w.dialog())`, "アプリの画面が出る", i === 0 ? 120_000 : 180_000);
      await page.settle();
      if (!broken()) return page;
      if (i >= 1) throw new Error(`アプリの画面の読み込みが壊れています（${page.errors.filter((e) => BROKEN_LOAD.test(e)).slice(0, 2).join(" / ")}）`);
    } catch (e) {
      if (i >= 1) throw e;
    }
    page.errors.length = 0;
    await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
  }
}

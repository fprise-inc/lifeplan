// 見えないブラウザ（Chrome）を起こして、DevTools の口（CDP）が開くのを待つ。持ち帰り用のレポートの確かめ（check-takeaway.ts）と
// 通しの入力のテスト（test/walkthrough/browser.ts）で共通（npm の依存なし）。
// - 決まった時間を待つのでなく、口が開いた印（標準エラーの「DevTools listening on」か、作業用のフォルダの DevToolsActivePort）を待ち、
//   その口が答える（/json/version）ことまで確かめてから返す
// - ブラウザが途中で終わったら、待たずにすぐ失敗にする。起動に失敗したら（口が開かない・すぐ終わる）、新しい作業用のフォルダで1回だけやり直す
//   （手元でも CI でも、初めの起動はたまに遅い・失敗する）
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Headless {
  proc: ChildProcess;
  /** DevTools の口（ブラウザ全体の WebSocket の URL） */
  wsUrl: string;
  /** 作業用のフォルダ（ユーザーのデータ） */
  profile: string;
}

export interface LaunchOptions {
  /** 作業用のフォルダの名前の頭 */
  prefix: string;
  /** 1回の起動で口が開くのを待つ上限（ミリ秒。既定 60 秒） */
  timeoutMs?: number;
  /** 起動を試す回数（既定 2 = 1回だけやり直す） */
  tries?: number;
  /** やり直すときの知らせ（既定は標準エラーに1行） */
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 口が答えるか（/json/version）。答えればブラウザ全体の WebSocket の URL */
async function answers(port: string): Promise<string | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2_000) });
    if (!r.ok) return null;
    const v = (await r.json()) as { webSocketDebuggerUrl?: string };
    return typeof v.webSocketDebuggerUrl === "string" ? v.webSocketDebuggerUrl : null;
  } catch {
    return null;
  }
}

/** 1回起こして、口が開いて答えるまで待つ（開かない・ブラウザが終わったら失敗。失敗したらブラウザを止める） */
async function launchOnce(exe: string, args: readonly string[], prefix: string, timeoutMs: number): Promise<Headless> {
  const profile = mkdtempSync(join(tmpdir(), prefix));
  const proc = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, ...args], { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  // ブラウザが終わった・起こせなかったときの文（出来事の中で書くので、入れ物に持つ）
  const st: { exited: string | null } = { exited: null };
  proc.stderr?.on("data", (c: Buffer) => {
    err = (err + c.toString()).slice(-4_000);
  });
  proc.on("exit", (code, signal) => {
    st.exited = `終わりました（code ${String(code)}・${String(signal)}）`;
  });
  proc.on("error", (e) => {
    st.exited = `起こせませんでした（${e.message}）`;
  });
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < timeoutMs) {
      if (st.exited !== null) throw new Error(`ブラウザが${st.exited}`);
      // 口の番号: 標準エラーの1行か、作業用のフォルダの DevToolsActivePort（1行目が番号）
      const fromErr = /DevTools listening on ws:\/\/[^:/]+:(\d+)\//.exec(err)?.[1];
      const file = join(profile, "DevToolsActivePort");
      const fromFile = existsSync(file) ? /^(\d+)\s/.exec(readFileSync(file, "utf8"))?.[1] : undefined;
      const port = fromErr ?? fromFile;
      if (port !== undefined) {
        const ws = await answers(port);
        if (ws !== null) return { proc, wsUrl: ws, profile };
      }
      await sleep(100);
    }
    throw new Error(`${Math.round(timeoutMs / 1000)}秒待っても開きません`);
  } catch (e) {
    proc.kill("SIGKILL");
    const tail = err.trim().split("\n").slice(-3).join(" / ");
    throw new Error(`${e instanceof Error ? e.message : String(e)}${tail !== "" ? `（ブラウザの出力: ${tail.slice(0, 400)}）` : ""}`, { cause: e });
  }
}

/** 見えないブラウザを起こし、DevTools の口が開いて答えるのを待つ。起動に失敗したら、新しい作業用のフォルダで（既定で）1回だけやり直す */
export async function launchHeadless(exe: string, args: readonly string[], o: LaunchOptions): Promise<Headless> {
  const tries = o.tries ?? 2;
  const log = o.log ?? ((l: string) => console.error(l));
  const problems: string[] = [];
  for (let i = 1; i <= tries; i++) {
    try {
      return await launchOnce(exe, args, o.prefix, o.timeoutMs ?? 60_000);
    } catch (e) {
      problems.push(`${i}回目: ${e instanceof Error ? e.message : String(e)}`);
      if (i < tries) log(`ブラウザの DevTools の口が開かなかったので、起こし直します（${problems.at(-1)}）`);
    }
  }
  throw new Error(`ブラウザの DevTools の口が開きませんでした（${problems.join("。")}）`);
}

/** WebSocket の口につなぐ（開くまで待つ。開けない・時間内に開かなければ失敗） */
export function openSocket(wsUrl: string, timeoutMs = 15_000): Promise<WebSocket> {
  return new Promise((ok, ng) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => {
      ws.close();
      ng(new Error("ブラウザの DevTools の口につなげませんでした（時間切れ）"));
    }, timeoutMs);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(t);
        ok(ws);
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(t);
        ng(new Error("ブラウザの DevTools の口につなげませんでした"));
      },
      { once: true },
    );
  });
}

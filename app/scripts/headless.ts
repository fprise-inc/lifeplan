// 見えないブラウザ（Chrome）を起こして、DevTools の口（CDP）が開くのを待つ。持ち帰り用のレポートの確かめ（check-takeaway.ts）と
// 通しの入力のテスト（test/walkthrough/browser.ts）で共通（npm の依存なし）。
// - 決まった時間を待つのでなく、口が開いた印（標準エラーの「DevTools listening on」か、作業用のフォルダの DevToolsActivePort）を待ち、
//   その口が答える（/json/version）ことまで確かめてから返す
// - ブラウザが途中で終わったら、待たずにすぐ失敗にする。起動に失敗したら（口が開かない・すぐ終わる）、新しい作業用のフォルダで1回だけやり直す
//   （手元でも CI でも、初めの起動はたまに遅い・失敗する）
// - 途中で止まったときに見えないブラウザを残さない:
//   - 止めるのは close()（ブラウザを止め、作業用のフォルダを消す）。呼ぶ側は finally・afterAll で必ず通す
//   - close() まで行かなくても: このプロセスが終わるとき（捕まえていない例外を含む）と Ctrl+C・SIGTERM・SIGHUP で止める
//   - このプロセスが強制終了（SIGKILL）されたときは、上のどれも動かないので、ブラウザと一緒に起こす小さな見張り役（別のプロセス）が
//     親がいなくなったことを見てブラウザを止め、作業用のフォルダを消す（Mac・Linux。Windows では見張り役を起こさない）
//   - 起こす前に、前回の残り（作業用のフォルダが一時フォルダの financia- で始まり、起こしたプロセスがもういないブラウザ）を止める
//     （Mac・Linux。--user-data-dir がそこを指すものだけ。ふだんの Chrome には触らない）
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Headless {
  proc: ChildProcess;
  /** DevTools の口（ブラウザ全体の WebSocket の URL） */
  wsUrl: string;
  /** 作業用のフォルダ（ユーザーのデータ） */
  profile: string;
  /** ブラウザを止め（少し待っても終わらなければ強制で）、作業用のフォルダを消す。何回呼んでもよい */
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** 作業用のフォルダの名前の頭（financia- で始める。前回の残りとして片づけるのは、これで始まるものだけ） */
  prefix: string;
  /** 1回の起動で口が開くのを待つ上限（ミリ秒。既定 60 秒） */
  timeoutMs?: number;
  /** 起動を試す回数（既定 2 = 1回だけやり直す） */
  tries?: number;
  /** やり直すとき・前回の残りを止めたときの知らせ（既定は標準エラーに1行） */
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 作業用のフォルダの名前の頭（一時フォルダの中で、これで始まるものだけを前回の残りとして片づける） */
const PROFILE_HEAD = "financia-";
/** 作業用のフォルダに置く、起こしたプロセスの番号（前回の残りかどうかを見分ける） */
const OWNER_FILE = "financia-owner";
/** 見張り役・前回の残りの片づけを使うか（Mac・Linux。Windows ではプロセスの探し方・止め方が違うので何もしない） */
const POSIX = process.platform !== "win32";

/** いま動いているか（ほかの人のプロセスで確かめられないときは、動いているとみなす） */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const removeProfile = (profile: string) => rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);

/** このプロセスが起こして、まだ止めていないブラウザ */
interface Live {
  proc: ChildProcess;
  profile: string;
  watcher: ChildProcess | null;
  closing: Promise<void> | null;
}
const live = new Set<Live>();

/** すぐ止める（終わるとき・Ctrl+C のとき。待てないので強制で止め、作業用のフォルダもその場で消す） */
function killNow(b: Live): void {
  live.delete(b);
  b.proc.kill("SIGKILL");
  try {
    rmSync(b.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // 消せなければ見張り役か、次に起こすときの片づけに任せる
  }
}

/** 止める（ふつうは SIGTERM で終わるのを待ち、5秒で終わらなければ強制で。force ならはじめから強制で）。止めたら作業用のフォルダを消す */
function shut(b: Live, force = false): Promise<void> {
  b.closing ??= (async () => {
    const { proc } = b;
    if (proc.pid !== undefined && proc.exitCode === null && proc.signalCode === null) {
      const gone = new Promise<boolean>((r) => proc.once("exit", () => r(true)));
      proc.kill(force ? "SIGKILL" : "SIGTERM");
      if (!(await Promise.race([gone, sleep(5_000).then(() => false)]))) {
        proc.kill("SIGKILL");
        await Promise.race([gone, sleep(2_000)]);
      }
    }
    await removeProfile(b.profile);
    b.watcher?.kill("SIGKILL");
    live.delete(b);
  })();
  return b.closing;
}

let handlersOn = false;
/** このプロセスが終わるとき（捕まえていない例外を含む）と Ctrl+C・SIGTERM・SIGHUP で、まだ止めていないブラウザを止める */
function stopOnExit(): void {
  if (handlersOn) return;
  handlersOn = true;
  process.on("exit", () => {
    for (const b of [...live]) killNow(b);
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    const on = () => {
      for (const b of [...live]) killNow(b);
      // 受け手を足すとふだんの「終わる」が止まるので、ほかに受け手がいなければ、受け手を外してふだんどおり終わる
      if (process.listenerCount(sig) === 1) {
        process.removeListener(sig, on);
        process.kill(process.pid, sig);
      }
    };
    process.on(sig, on);
  }
}

/**
 * 見張り役（別のプロセス）。親（このプロセス）がいなくなったら（強制終了でも）ブラウザを止め、作業用のフォルダを消して終わる。
 * ブラウザが先に終われば、何もせず終わる。端末の Ctrl+C が届かないよう、別のまとまり（detached）で起こす
 */
const WATCHER = `
const fs = require("node:fs");
const owner = Number(process.argv[1]);
const browser = Number(process.argv[2]);
const profile = process.argv[3];
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (alive(browser)) try { process.kill(browser, "SIGTERM"); } catch {}
  const t0 = Date.now();
  const t = setInterval(() => {
    if (alive(browser) && Date.now() - t0 < 3000) return;
    clearInterval(t);
    if (alive(browser)) try { process.kill(browser, "SIGKILL"); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    process.exit(0);
  }, 100);
}
process.on("SIGINT", () => {});
process.on("SIGHUP", () => {});
process.on("SIGTERM", stop);
setInterval(() => {
  if (stopping) return;
  if (process.ppid !== owner || !alive(owner)) stop();
  else if (!alive(browser)) process.exit(0);
}, 300);
`;

function watch(proc: ChildProcess, profile: string): ChildProcess | null {
  if (!POSIX || proc.pid === undefined) return null;
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  try {
    const w = spawn(process.execPath, ["-e", WATCHER, String(process.pid), String(proc.pid), profile], { detached: true, stdio: "ignore", env });
    w.on("error", () => undefined);
    w.unref();
    return w;
  } catch {
    return null;
  }
}

/** 作業用のフォルダに書いた、起こしたプロセスの番号（無ければ null） */
function ownerOf(profile: string): number | null {
  try {
    const n = Number(readFileSync(join(profile, OWNER_FILE), "utf8").trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** ブラウザの作業用のフォルダの印（番号を書いていない古いフォルダを、ブラウザの物と見分ける） */
const BROWSER_MARKS = ["Default", "RunningChromeVersion", "Local State", "DevToolsActivePort"];

/** 動いているプロセスの一覧（Mac・Linux。番号・親の番号・コマンドライン）。調べられなければ空 */
function processes(): Promise<{ pid: number; ppid: number; args: string }[]> {
  return new Promise((ok) => {
    execFile("ps", ["-A", "-ww", "-o", "pid=,ppid=,args="], { maxBuffer: 64 * 1024 * 1024 }, (e, out) => {
      if (e !== null) return ok([]);
      const rows: { pid: number; ppid: number; args: string }[] = [];
      for (const line of out.split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (m !== null) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] ?? "" });
      }
      ok(rows);
    });
  });
}

/**
 * 前回の残りを片づける（Mac・Linux。Windows では何もしない）。止めたブラウザ（プロセス）の数を返す。
 * - 止めるのは、--user-data-dir が一時フォルダの financia- で始まるフォルダを指し、起こしたプロセス（作業用のフォルダに書いた番号。
 *   書いていない古い物は親）がもういないものだけ。動いているほかのテストのブラウザ・ふだんの Chrome には触らない
 * - 作業用のフォルダも消す。プロセスの無い古いフォルダも、起こしたプロセスがもういない（番号を書いていない物は、ブラウザの印〔Default など〕があって1時間より古い）なら消す
 */
export async function sweepLeftovers(): Promise<number> {
  if (!POSIX) return 0;
  const head = join(tmpdir(), PROFILE_HEAD);
  const escaped = head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`--user-data-dir=(${escaped}[^\\s/]+)`);
  const mine = new Set([...live].map((b) => b.profile));
  const groups = new Map<string, { pid: number; ppid: number }[]>();
  for (const p of await processes()) {
    const profile = pattern.exec(p.args)?.[1];
    if (profile === undefined || p.pid === process.pid || mine.has(profile)) continue;
    groups.set(profile, [...(groups.get(profile) ?? []), p]);
  }
  let stopped = 0;
  for (const [profile, ps] of groups) {
    const owner = ownerOf(profile);
    const pids = new Set(ps.map((p) => p.pid));
    // 番号を書いていない古い物は、まとまりの頭（親がまとまりの外のもの）の親がもういない（1 に引き取られた）かで見る
    const left = owner !== null ? !alive(owner) : ps.filter((p) => !pids.has(p.ppid)).every((p) => p.ppid === 1 || !alive(p.ppid));
    if (!left) continue;
    for (const p of ps) {
      try {
        process.kill(p.pid, "SIGKILL");
      } catch {
        // もう終わっている
      }
    }
    stopped++;
    await removeProfile(profile);
  }
  // プロセスの無い古い作業用のフォルダ
  const names = await readdir(tmpdir()).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.startsWith(PROFILE_HEAD)) continue;
    const dir = join(tmpdir(), name);
    if (groups.has(dir) || mine.has(dir)) continue;
    const owner = ownerOf(dir);
    let stale = false;
    if (owner !== null) stale = !alive(owner);
    else if (BROWSER_MARKS.some((m) => existsSync(join(dir, m)))) stale = Date.now() - ((await stat(dir).catch(() => null))?.mtimeMs ?? Date.now()) > 3_600_000;
    if (stale) await removeProfile(dir);
  }
  return stopped;
}

let swept: Promise<void> | null = null;

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
  // 起こしたプロセスの番号を書いておく（前回の残りかどうかを、次に起こすときに見分ける）
  writeFileSync(join(profile, OWNER_FILE), String(process.pid));
  stopOnExit();
  const proc = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, ...args], { stdio: ["ignore", "ignore", "pipe"] });
  const b: Live = { proc, profile, watcher: null, closing: null };
  live.add(b);
  b.watcher = watch(proc, profile);
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
        if (ws !== null) return { proc, wsUrl: ws, profile, close: () => shut(b) };
      }
      await sleep(100);
    }
    throw new Error(`${Math.round(timeoutMs / 1000)}秒待っても開きません`);
  } catch (e) {
    await shut(b, true);
    const tail = err.trim().split("\n").slice(-3).join(" / ");
    throw new Error(`${e instanceof Error ? e.message : String(e)}${tail !== "" ? `（ブラウザの出力: ${tail.slice(0, 400)}）` : ""}`, { cause: e });
  }
}

/** 見えないブラウザを起こし、DevTools の口が開いて答えるのを待つ。起動に失敗したら、新しい作業用のフォルダで（既定で）1回だけやり直す */
export async function launchHeadless(exe: string, args: readonly string[], o: LaunchOptions): Promise<Headless> {
  const tries = o.tries ?? 2;
  const log = o.log ?? ((l: string) => console.error(l));
  // 前回の残りを片づける（このプロセスで初めて起こすときだけ）
  swept ??= sweepLeftovers().then(
    (n) => {
      if (n > 0) log(`前回の残りの見えないブラウザを止めました（${n}個）`);
    },
    () => undefined,
  );
  await swept;
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

// 見えないブラウザの起動の待ち方（scripts/headless.ts。0132 の追記 2026-11-07）: 決まった時間でなく DevTools の口が開いて答えるのを待ち、
// ブラウザがすぐ終わったら待たずに失敗にし、起動に失敗したら1回だけやり直す。本物のブラウザの代わりに、口の真似をする小さなプログラムで確かめる。
// 途中で止まったときに見えないブラウザを残さない（close()・親の強制終了の見張り役・前回の残りの片づけ）も同じ真似で確かめる
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { launchHeadless, sweepLeftovers } from "../scripts/headless.ts";

const dir = mkdtempSync(join(tmpdir(), "financia-headless-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** ブラウザの真似（mode: exit＝すぐ終わる、stderr＝標準エラーに口を出す、file＝作業用のフォルダに DevToolsActivePort を書く、flaky＝1回目はすぐ終わり2回目は stderr） */
function fakeBrowser(mode: "exit" | "stderr" | "file" | "flaky"): string {
  const path = join(dir, `fake-${mode}.mjs`);
  const marker = join(dir, `ran-${mode}`);
  writeFileSync(
    path,
    `#!/usr/bin/env node
import { createServer } from "node:http";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const mode = ${JSON.stringify(mode)};
const first = !existsSync(${JSON.stringify(marker)});
writeFileSync(${JSON.stringify(marker)}, "1");
if (mode === "exit" || (mode === "flaky" && first)) { process.stderr.write("起動できませんでした\\n"); process.exit(3); }
const profile = process.argv.find((a) => a.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);
const server = createServer((req, res) => {
  const port = server.address().port;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/devtools/browser/fake" }));
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  setTimeout(() => {
    if (mode === "file") writeFileSync(join(profile, "DevToolsActivePort"), port + "\\n/devtools/browser/fake\\n");
    else process.stderr.write("\\nDevTools listening on ws://127.0.0.1:" + port + "/devtools/browser/fake\\n");
  }, 300);
});
setTimeout(() => process.exit(0), 20000);
`,
  );
  chmodSync(path, 0o755);
  return path;
}

describe("見えないブラウザの起動の待ち方", () => {
  it("標準エラーの「DevTools listening on」で口を知り、口が答えるのを確かめて返す", async () => {
    const b = await launchHeadless(fakeBrowser("stderr"), [], { prefix: "financia-headless-a-", timeoutMs: 10_000, log: () => undefined });
    expect(b.wsUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/fake$/);
    await b.close();
  });

  it("標準エラーに出なくても、作業用のフォルダの DevToolsActivePort で口を知る", async () => {
    const b = await launchHeadless(fakeBrowser("file"), [], { prefix: "financia-headless-b-", timeoutMs: 10_000, log: () => undefined });
    expect(existsSync(join(b.profile, "DevToolsActivePort"))).toBe(true);
    expect(b.wsUrl).toContain("/devtools/browser/fake");
    await b.close();
  });

  it("1回目の起動ですぐ終わったら、待たずに新しい作業用のフォルダで1回だけ起こし直す", async () => {
    const logs: string[] = [];
    const t0 = Date.now();
    const b = await launchHeadless(fakeBrowser("flaky"), [], { prefix: "financia-headless-c-", timeoutMs: 10_000, log: (l) => logs.push(l) });
    expect(Date.now() - t0).toBeLessThan(8_000);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("起こし直します");
    expect(b.wsUrl).toContain("/devtools/browser/fake");
    await b.close();
  });

  it("2回とも起動に失敗したら、決まった時間を待たずに理由（ブラウザの出力）つきで失敗する", async () => {
    const t0 = Date.now();
    const got = await launchHeadless(fakeBrowser("exit"), [], { prefix: "financia-headless-d-", timeoutMs: 30_000, log: () => undefined }).catch((e: unknown) => e);
    expect(got).toBeInstanceOf(Error);
    const err = got as Error;
    expect(err.message).toContain("ブラウザの DevTools の口が開きませんでした");
    expect(err.message).toContain("1回目");
    expect(err.message).toContain("2回目");
    expect(err.message).toContain("起動できませんでした");
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number | undefined) => {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** 条件が成り立つまで待つ（上限 ms。成り立てば true） */
async function waitFor(ok: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (ok()) return true;
    await sleep(100);
  }
  return ok();
}
const POSIX = process.platform !== "win32";

describe("途中で止まったときに見えないブラウザを残さない", () => {
  it("close() でブラウザを止め、作業用のフォルダを消す（何回呼んでもよい）", async () => {
    const b = await launchHeadless(fakeBrowser("stderr"), [], { prefix: "financia-headless-e-", timeoutMs: 10_000, log: () => undefined });
    expect(existsSync(b.profile)).toBe(true);
    await b.close();
    await b.close();
    expect(alive(b.proc.pid)).toBe(false);
    expect(existsSync(b.profile)).toBe(false);
  });

  /** 見えないブラウザ（真似）を起こすだけの親を起こし、ブラウザの番号と作業用のフォルダを受け取る（then="throw" なら、起こした後に捕まえていない例外で落ちる） */
  async function parentWithBrowser(then: "wait" | "throw"): Promise<{ child: ChildProcess; exited: Promise<{ code: number | null; signal: string | null }>; pid: number; profile: string }> {
    const parent = join(dir, "parent.mjs");
    writeFileSync(
      parent,
      `import { launchHeadless } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "..", "scripts", "headless.ts")).href)};
const b = await launchHeadless(process.argv[2], [], { prefix: "financia-headless-f-", timeoutMs: 10000, log: () => undefined });
process.stdout.write(JSON.stringify({ pid: b.proc.pid, profile: b.profile }) + "\\n");
if (process.argv[3] === "throw") setTimeout(() => { throw new Error("途中で失敗"); }, 200);
setInterval(() => undefined, 1000);
`,
    );
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", parent, fakeBrowser("stderr"), then], { stdio: ["ignore", "pipe", "ignore"] });
    const exited = new Promise<{ code: number | null; signal: string | null }>((r) => child.on("exit", (code, signal) => r({ code, signal })));
    const got = await new Promise<{ pid: number; profile: string }>((ok, ng) => {
      let out = "";
      child.stdout?.on("data", (c: Buffer) => {
        out += c.toString();
        if (out.includes("\n")) ok(JSON.parse(out.split("\n")[0] ?? "") as { pid: number; profile: string });
      });
      void exited.then(() => ng(new Error(`親が先に終わりました（${out}）`)));
    });
    expect(alive(got.pid)).toBe(true);
    expect(existsSync(got.profile)).toBe(true);
    return { child, exited, ...got };
  }

  it.skipIf(!POSIX)("起こしたプロセスが強制終了（SIGKILL）されても、見張り役がブラウザを止めて作業用のフォルダを消す", async () => {
    const p = await parentWithBrowser("wait");
    p.child.kill("SIGKILL");
    expect(await waitFor(() => !alive(p.pid) && !existsSync(p.profile), 8_000)).toBe(true);
  });

  it.skipIf(!POSIX).each(["SIGINT", "SIGTERM"] as const)("%s で止められたら、ブラウザを止めて作業用のフォルダを消し、ふだんどおり終わる", async (sig) => {
    const p = await parentWithBrowser("wait");
    p.child.kill(sig);
    expect((await p.exited).signal).toBe(sig);
    expect(await waitFor(() => !alive(p.pid) && !existsSync(p.profile), 3_000)).toBe(true);
  });

  it.skipIf(!POSIX)("捕まえていない例外で落ちても、ブラウザを止めて作業用のフォルダを消す", async () => {
    const p = await parentWithBrowser("throw");
    expect((await p.exited).code).toBe(1);
    expect(await waitFor(() => !alive(p.pid) && !existsSync(p.profile), 3_000)).toBe(true);
  });

  it.skipIf(!POSIX)("起こす前に前回の残り（起こしたプロセスがもういないもの）だけを止める。動いているもの・financia- で始まらないものには触らない", async () => {
    // もういないプロセスの番号
    const gone = spawn(process.execPath, ["-e", ""]);
    await new Promise((r) => gone.on("exit", r));
    const fake = fakeBrowser("stderr");
    const run = (profile: string, owner: number | null): ChildProcess => {
      if (owner !== null) writeFileSync(join(profile, "financia-owner"), String(owner));
      return spawn(fake, [`--user-data-dir=${profile}`], { stdio: "ignore" });
    };
    const leftDir = mkdtempSync(join(tmpdir(), "financia-headless-g-"));
    const liveDir = mkdtempSync(join(tmpdir(), "financia-headless-h-"));
    const otherDir = mkdtempSync(join(tmpdir(), "lifeplan-headless-i-"));
    const left = run(leftDir, gone.pid ?? 0);
    const living = run(liveDir, process.pid);
    const other = run(otherDir, gone.pid ?? 0);
    try {
      await sleep(500);
      expect(await sweepLeftovers()).toBeGreaterThanOrEqual(1);
      expect(await waitFor(() => !alive(left.pid) && !existsSync(leftDir), 5_000)).toBe(true);
      expect(alive(living.pid)).toBe(true);
      expect(existsSync(liveDir)).toBe(true);
      expect(alive(other.pid)).toBe(true);
      expect(existsSync(otherDir)).toBe(true);
    } finally {
      for (const p of [left, living, other]) p.kill("SIGKILL");
    }
  });
});

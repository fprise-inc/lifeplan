// 見えないブラウザの起動の待ち方（scripts/headless.ts。0132 の追記 2026-11-07）: 決まった時間でなく DevTools の口が開いて答えるのを待ち、
// ブラウザがすぐ終わったら待たずに失敗にし、起動に失敗したら1回だけやり直す。本物のブラウザの代わりに、口の真似をする小さなプログラムで確かめる
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchHeadless } from "../scripts/headless.ts";

const dir = mkdtempSync(join(tmpdir(), "financia-headless-test-"));

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
    b.proc.kill();
  });

  it("標準エラーに出なくても、作業用のフォルダの DevToolsActivePort で口を知る", async () => {
    const b = await launchHeadless(fakeBrowser("file"), [], { prefix: "financia-headless-b-", timeoutMs: 10_000, log: () => undefined });
    expect(existsSync(join(b.profile, "DevToolsActivePort"))).toBe(true);
    expect(b.wsUrl).toContain("/devtools/browser/fake");
    b.proc.kill();
  });

  it("1回目の起動ですぐ終わったら、待たずに新しい作業用のフォルダで1回だけ起こし直す", async () => {
    const logs: string[] = [];
    const t0 = Date.now();
    const b = await launchHeadless(fakeBrowser("flaky"), [], { prefix: "financia-headless-c-", timeoutMs: 10_000, log: (l) => logs.push(l) });
    expect(Date.now() - t0).toBeLessThan(8_000);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("起こし直します");
    expect(b.wsUrl).toContain("/devtools/browser/fake");
    b.proc.kill();
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

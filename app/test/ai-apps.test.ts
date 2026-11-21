// AI のアプリへの登録の画面（0228）: 状態ごとのボタン・押せない理由・書く場所と中身・試していないことの表示
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { APP_DIR } from "../scripts/lib.ts";
import type { AiAppsStatus, AiAppView, AiHost } from "../src/engine/host.ts";
import { AiAppRegister } from "../src/workspace/ai/AiAppRegister.tsx";

const no = () => Promise.reject(new Error("呼ばない"));
const host = (withApps: boolean): AiHost =>
  ({
    status: no,
    setEnabled: no,
    copySetup: no,
    household: no,
    recordConsent: no,
    startShare: no,
    stopShare: no,
    decide: no,
    takeDocuments: no,
    householdCandidates: no,
    discardHouseholdCandidate: no,
    createFromCandidate: no,
    displayCandidates: no,
    takeDisplayChange: no,
    takeHouseholdDisplayChange: no,
    ...(withApps ? { apps: no, registerApp: no, unregisterApp: no } : {}),
  }) as AiHost;

const app = (client: AiAppView["client"], title: string, state: AiAppView["state"], extra: Partial<AiAppView> = {}): AiAppView => ({
  client,
  title,
  state,
  target: client === "claudeCode" ? "claude mcp add --scope user" : "~/.codex/config.toml",
  preview: '[mcp_servers.fprise-lifeplan]\ncommand = "<AI とつなぐ道具の場所>"\nargs = ["mcp"]\n',
  how: client === "claudeCode" ? "command" : "file",
  blocked: null,
  tested: client !== "gemini",
  ...extra,
});

const status = (apps: AiAppView[], locationProblem: string | null = null): AiAppsStatus => ({ apps, serverName: "fprise-lifeplan", locationProblem });

const render = (s: AiAppsStatus) => renderToString(h(AiAppRegister, { ai: host(true), initial: s }));

describe("AI のアプリへの登録の画面（0228）", () => {
  it("状態ごとに「登録する」「場所を直す」「登録を外す」を出す", () => {
    const html = render(
      status([
        app("claudeDesktop", "Claude Desktop", "unregistered"),
        app("claudeCode", "Claude Code", "registered"),
        app("codex", "Codex", "stale"),
        app("gemini", "Gemini CLI", "missing"),
      ]),
    );
    const part = (client: string) => html.slice(html.indexOf(`data-ai-app="${client}"`), html.indexOf("</li>", html.indexOf(`data-ai-app="${client}"`)));
    expect(part("claudeDesktop")).toContain("未登録");
    expect(part("claudeDesktop")).toContain("登録する");
    expect(part("claudeDesktop")).not.toContain("登録を外す");
    expect(part("claudeDesktop")).toContain("完全に終了してから");
    expect(part("claudeCode")).toContain("登録済み");
    expect(part("claudeCode")).toContain("登録を外す");
    expect(part("claudeCode")).toContain("呼ぶコマンド");
    expect(part("codex")).toContain("場所が古い");
    expect(part("codex")).toContain("場所を直す");
    expect(part("codex")).toContain("登録を外す");
    expect(part("codex")).toContain("~/.codex/config.toml");
    expect(part("gemini")).toContain("このPCに見つかりません");
    expect(part("gemini")).not.toContain("<button");
  });

  it("押せない理由と、手動で登録する手順への戻り方を出す", () => {
    const html = render(
      status([
        app("claudeDesktop", "Claude Desktop", "unregistered", { blocked: "E_AI_APP_RUNNING" }),
        app("claudeCode", "Claude Code", "unregistered", { blocked: "E_AI_APP_NO_COMMAND" }),
        app("codex", "Codex", "unreadable", { blocked: "E_AI_APP_UNREADABLE" }),
      ]),
    );
    expect(html).toContain("Claude Desktop が起動しています");
    expect(html).toContain("claude コマンドが見つかりません");
    expect(html).toContain("設定のファイルを読めないため、書き込みませんでした");
    expect(html).toContain("手動で登録する");
    // 押せない行の「登録する」は押せない
    expect(html.match(/<button[^>]*disabled[^>]*data-ai-app-register/g)?.length).toBe(2);
  });

  it("Gemini CLI は試していないことを書く", () => {
    const html = render(status([app("gemini", "Gemini CLI", "unregistered")]));
    expect(html).toContain("まだ試していません");
  });

  it("アプリが一時的な場所で開かれているときは、どれも登録できない", () => {
    const html = render(status([app("codex", "Codex", "unregistered")], "E_AI_APP_LOCATION"));
    expect(html).toContain("「アプリケーション」フォルダに入れてから");
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-ai-app-register/);
  });

  it("登録の命令が無い本体（開発用のブラウザ）では出さない", () => {
    expect(renderToString(h(AiAppRegister, { ai: host(false), initial: status([app("codex", "Codex", "unregistered")]) }))).toBe("");
  });

  it("画面の文に「接続口」と書かない", () => {
    const src = readFileSync(join(APP_DIR, "src", "workspace", "ai", "AiAppRegister.tsx"), "utf8");
    const texts = [...src.matchAll(/"([^"]*)"|`([^`]*)`|>([^<>{}]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
    expect(texts.filter((t) => t.includes("接続口"))).toEqual([]);
  });
});

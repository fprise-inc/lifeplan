// AI のアプリへの登録の画面（0228 と追記 2026-11-20）: 行は「Claude」と「Codex」。Claude の行は2つの書く先（チャットのアプリ・Claude Code）をまとめる。
// 状態ごとのボタン・片方だけ登録するときの説明（起動中・コマンドなし・アプリなし）・書く場所と中身を確かめる
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { APP_DIR } from "../scripts/lib.ts";
import type { AiAppPart, AiAppsStatus, AiAppView, AiHost } from "../src/engine/host.ts";
import { AiAppRegister, RUNNING_CODE_ONLY, afterRegister, claudeNotes, rowButtons, rowStateText } from "../src/workspace/ai/AiAppRegister.tsx";

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

type State = AiAppPart["state"];
const LABEL: Record<AiAppPart["id"], string> = { claudeDesktop: "チャット（アプリ）", claudeCode: "Claude Code", codex: "Codex" };
const TARGET: Record<AiAppPart["id"], string> = {
  claudeDesktop: "~/Library/Application Support/Claude/claude_desktop_config.json",
  claudeCode: "claude mcp add --scope user",
  codex: "~/.codex/config.toml",
};
const PREVIEW: Record<AiAppPart["id"], string> = {
  claudeDesktop: '{ "mcpServers": { "fprise-lifeplan": { "command": "<AI と接続する道具の場所>", "args": ["mcp"] } } }',
  claudeCode: 'claude mcp add --scope user fprise-lifeplan -- "<AI と接続する道具の場所>" mcp',
  codex: '[mcp_servers.fprise-lifeplan]\ncommand = "<AI と接続する道具の場所>"\nargs = ["mcp"]\n',
};

const part = (id: AiAppPart["id"], state: State, blocked: string | null = null): AiAppPart => ({ id, label: LABEL[id], state, target: TARGET[id], preview: PREVIEW[id], how: id === "claudeCode" ? "command" : "file", blocked });

/** 行の状態（本体の決め方と同じ。見つからない・この OS で使えない書く先は数えない） */
const rowState = (parts: AiAppPart[]): AiAppView["state"] => {
  const s = parts.map((p) => p.state).filter((x) => x !== "missing" && x !== "unsupported");
  if (s.length === 0) return parts.every((p) => p.state === "unsupported") ? "unsupported" : "missing";
  if (s.includes("stale")) return "stale";
  if (s.every((x) => x === "registered")) return "registered";
  if (s.includes("registered")) return "partial";
  return s.includes("unregistered") ? "unregistered" : "unreadable";
};

/** Claude の行。desk・code はそれぞれの書く先の状態と、押せない理由 */
const claude = (desk: [State, (string | null)?], code: [State, (string | null)?]): AiAppView => {
  const parts = [part("claudeDesktop", desk[0], desk[1] ?? null), part("claudeCode", code[0], code[1] ?? null)];
  return { client: "claude", title: "Claude", state: rowState(parts), parts };
};
const codex = (state: State, blocked: string | null = null): AiAppView => {
  const parts = [part("codex", state, blocked)];
  return { client: "codex", title: "Codex", state: rowState(parts), parts };
};

const status = (apps: AiAppView[], locationProblem: string | null = null): AiAppsStatus => ({ apps, serverName: "fprise-lifeplan", locationProblem });
const render = (s: AiAppsStatus) => renderToString(h(AiAppRegister, { ai: host(true), initial: s }));
/** 1つの行の HTML */
const row = (html: string, client: string) => html.slice(html.indexOf(`data-ai-app="${client}"`), html.indexOf("</li>", html.indexOf(`data-ai-app="${client}"`)));
const disabledRegister = /<button[^>]*disabled[^>]*data-ai-app-register/;

describe("AI のアプリへの登録の画面（0228）", () => {
  it("行は Claude と Codex の2つ。Claude の行は、2つの書く先の状態を並べる", () => {
    const html = render(status([claude(["unregistered"], ["unregistered"]), codex("stale")]));
    expect([...html.matchAll(/data-ai-app="([^"]+)"/g)].map((m) => m[1])).toEqual(["claude", "codex"]);
    const c = row(html, "claude");
    expect(c).toContain("<b>Claude</b>");
    expect(c).toContain("チャット（アプリ）: 未登録／Claude Code: 未登録");
    expect(c).toContain("1回押すと、チャット（Claude のアプリ）と Claude Code の両方に登録します。");
    expect(c).toContain("完全に終了してから");
    expect(c).toContain("登録する");
    expect(c).not.toContain("登録を外す");
    expect(c).not.toMatch(disabledRegister);
    // 書く場所と中身は、書く先ごとに見せる
    expect(c).toContain('data-ai-app-part="claudeDesktop"');
    expect(c).toContain("~/Library/Application Support/Claude/claude_desktop_config.json");
    expect(c).toContain('data-ai-app-part="claudeCode"');
    expect(c).toContain("呼ぶコマンド");
    // 片方だけになる事情が無ければ、その説明は出さない
    expect(c).not.toContain("data-ai-app-note");

    const x = row(html, "codex");
    expect(x).toContain("パソコン用の Codex（アプリ・ターミナル）。ブラウザの ChatGPT は接続できません。");
    expect(x).toContain("場所が古い");
    expect(x).toContain("場所を直す");
    expect(x).toContain("登録を外す");
    expect(x).toContain("~/.codex/config.toml");
    // 書く先が1つの行は、書く先の名前を重ねて出さない
    expect(x).not.toContain("Codex: ");
    expect(x).not.toContain('class="ai-app-part"');
  });

  it("Gemini CLI の行は出さない", () => {
    const html = render(status([claude(["registered"], ["registered"]), codex("unregistered")]));
    expect(html).not.toContain("Gemini");
    expect(html).not.toContain("まだ試していません");
  });

  it("両方あり: 1回で両方に登録する。登録済みなら「登録を外す」だけを出す", () => {
    const before = claude(["unregistered"], ["unregistered"]);
    expect(rowButtons(before)).toEqual({ register: "登録する", canRegister: true, unregister: false });
    expect(claudeNotes(before)).toEqual([]);

    const after = claude(["registered"], ["registered"]);
    expect(after.state).toBe("registered");
    expect(rowStateText(after)).toBe("チャット（アプリ）: 登録済み／Claude Code: 登録済み");
    expect(rowButtons(after)).toEqual({ register: null, canRegister: false, unregister: true });
    expect(afterRegister(after)).toBe("Claude に登録しました。Claude のアプリを起動すると、道具の一覧に出ます。Claude Code は、新しく始めた会話から使えます。");
    const c = row(render(status([after])), "claude");
    expect(c).not.toContain("data-ai-app-register");
    expect(c).toContain("data-ai-app-unregister");
    // 両方とも登録済みなら、Claude のアプリが起動中でも注意を出さない（書く必要が無い）
    expect(claudeNotes(claude(["registered", "E_AI_APP_RUNNING"], ["registered"]))).toEqual([]);

    // 片方の場所だけ古いときは「場所を直す」。片方が未登録なら「登録する」
    expect(rowButtons(claude(["stale"], ["registered"])).register).toBe("場所を直す");
    expect(rowButtons(claude(["stale"], ["unregistered"])).register).toBe("登録する");
  });

  it("起動中: 押す前は Claude Code の側だけ登録することを知らせ、押したあとはその理由と、もう一度押す手順を出す", () => {
    // 押す前（起動中かどうかは、押したときに本体が確かめ直すので、ボタンは押せる）
    const before = claude(["unregistered", "E_AI_APP_RUNNING"], ["unregistered"]);
    expect(rowButtons(before)).toEqual({ register: "登録する", canRegister: true, unregister: false });
    expect(claudeNotes(before)).toHaveLength(1);
    expect(claudeNotes(before)[0]).toContain("Claude のアプリが起動中です。いま押すと、Claude Code の側だけ登録します。");
    expect(row(render(status([before])), "claude")).not.toMatch(disabledRegister);

    // 押したあと: Claude Code の側だけ登録済み
    const after = claude(["unregistered", "E_AI_APP_RUNNING"], ["registered"]);
    expect(after.state).toBe("partial");
    expect(RUNNING_CODE_ONLY).toBe(
      "Claude のアプリが起動中のため、Claude Code の側だけ登録しました。アプリは終了するときに設定を書き直すので、起動中に書き込んだ登録は消えてしまいます。チャットでも使うときは、Claude のアプリを完全に終了してから、もう一度押してください。",
    );
    expect(claudeNotes(after)).toEqual([RUNNING_CODE_ONLY]);
    expect(afterRegister(after)).toBe("Claude: Claude Code の側だけ登録しました。Claude Code は、新しく始めた会話から使えます。");
    const c = row(render(status([after])), "claude");
    expect(c).toContain('data-ai-app-state="partial"');
    expect(c).toContain("チャット（アプリ）: 未登録／Claude Code: 登録済み");
    expect(c).toContain(RUNNING_CODE_ONLY);
    // もう一度押せる（終了してから押すと、チャットの側も登録する）。Claude Code の側は外せる
    expect(c).toContain("登録する");
    expect(c).not.toMatch(disabledRegister);
    expect(c).toContain("登録を外す");

    // Claude のアプリを終了したあとは、注意が消える
    expect(claudeNotes(claude(["unregistered"], ["registered"]))).toEqual([]);

    // 起動中で、Claude Code の側も登録できない（claude コマンドが無い）ときは、押せない
    const stuck = claude(["unregistered", "E_AI_APP_RUNNING"], ["unregistered", "E_AI_APP_NO_COMMAND"]);
    expect(rowButtons(stuck).canRegister).toBe(true); // チャットの側は、終了してから押せば書ける
    expect(claudeNotes(stuck)[0]).toContain("メニューの「終了」で完全に終了してから押してください。");
  });

  it("コマンドなし: チャット（アプリ）の側だけ登録して、短く出す", () => {
    // claude コマンドも Claude Code の設定も無い
    const none = claude(["unregistered"], ["missing"]);
    expect(rowButtons(none)).toEqual({ register: "登録する", canRegister: true, unregister: false });
    expect(claudeNotes(none)).toEqual(["Claude Code（claude コマンド）が見つからないため、登録するのはチャット（アプリ）の側だけです。"]);
    const done = claude(["registered"], ["missing"]);
    expect(done.state).toBe("registered");
    expect(rowStateText(done)).toBe("チャット（アプリ）: 登録済み／Claude Code: このPCに見つかりません");
    expect(afterRegister(done)).toBe("Claude に登録しました。Claude のアプリを起動すると、道具の一覧に出ます。");
    expect(rowButtons(done).register).toBeNull();
    // 見つからない書く先の「書き込む場所と中身」は出さない
    const c = row(render(status([done])), "claude");
    expect(c).toContain('data-ai-app-part="claudeDesktop"');
    expect(c).not.toContain('data-ai-app-part="claudeCode"');

    // Claude Code の設定はあるが、claude コマンドが見つからない: 手動で登録する手順への戻り方も出す
    const noCommand = claude(["registered"], ["unregistered", "E_AI_APP_NO_COMMAND"]);
    expect(noCommand.state).toBe("partial");
    expect(claudeNotes(noCommand)).toHaveLength(1);
    expect(claudeNotes(noCommand)[0]).toContain("登録するのはチャット（アプリ）の側だけです。");
    expect(claudeNotes(noCommand)[0]).toContain("下の「手動で登録する」の文面をコピーして、ターミナルで実行してください。");
    expect(afterRegister(noCommand)).toBe("Claude: チャット（アプリ）の側だけ登録しました。Claude のアプリを起動すると、道具の一覧に出ます。");
    // 残りは claude コマンドが無いと書けないので、「登録する」は押せない
    expect(rowButtons(noCommand)).toEqual({ register: "登録する", canRegister: false, unregister: true });
    expect(row(render(status([noCommand])), "claude")).toMatch(disabledRegister);
  });

  it("アプリなし: Claude Code の側だけ登録する", () => {
    const mac = claude(["missing"], ["unregistered"]);
    expect(rowButtons(mac)).toEqual({ register: "登録する", canRegister: true, unregister: false });
    expect(claudeNotes(mac)).toEqual(["Claude のアプリ（デスクトップ）が見つからないため、登録するのは Claude Code の側だけです。"]);
    const done = claude(["missing"], ["registered"]);
    expect(done.state).toBe("registered");
    expect(rowStateText(done)).toBe("チャット（アプリ）: このPCに見つかりません／Claude Code: 登録済み");
    expect(afterRegister(done)).toBe("Claude に登録しました。Claude Code は、新しく始めた会話から使えます。");
    // Claude のアプリが無い OS では、アプリが見つからないとは書かない
    const linux = claude(["unsupported"], ["unregistered"]);
    expect(claudeNotes(linux)).toEqual([]);
    expect(rowStateText(linux)).toBe("チャット（アプリ）: この OS では使えません／Claude Code: 未登録");
    expect(rowButtons(linux).canRegister).toBe(true);
  });

  it("両方なし: 「見つかりません」と出し、ボタンは出さない", () => {
    const neither = claude(["missing"], ["missing"]);
    expect(neither.state).toBe("missing");
    expect(rowStateText(neither)).toBe("このPCに見つかりません");
    expect(rowButtons(neither)).toEqual({ register: null, canRegister: false, unregister: false });
    expect(claudeNotes(neither)).toEqual([]);
    const c = row(render(status([neither, codex("missing")])), "claude");
    expect(c).toContain("このPCに見つかりません");
    expect(c).not.toContain("<button");
    expect(c).not.toContain("書き込む場所と中身");
  });

  it("設定のファイルを読めない書く先は、手動で登録する手順への戻り方を出す", () => {
    const html = render(status([claude(["unreadable", "E_AI_APP_UNREADABLE"], ["registered"]), codex("unreadable", "E_AI_APP_UNREADABLE")]));
    expect(row(html, "claude")).toContain("チャット（アプリ）: 設定のファイルを読めないため、書き込みませんでした");
    expect(row(html, "codex")).toContain("設定のファイルを読めないため、書き込みませんでした");
    expect(html).toContain("手動で登録する");
    // 読めないファイルには書かないので、「登録する」は出さない（登録済みの側は外せる）
    expect(row(html, "claude")).not.toContain("data-ai-app-register");
    expect(row(html, "claude")).toContain("data-ai-app-unregister");
    expect(row(html, "codex")).not.toContain("<button");
  });

  it("アプリが一時的な場所で開かれているときは、どれも登録できない", () => {
    const html = render(status([claude(["unregistered"], ["unregistered"]), codex("unregistered")], "E_AI_APP_LOCATION"));
    expect(html).toContain("「アプリケーション」フォルダに入れてから");
    expect(html.match(new RegExp(disabledRegister, "g"))?.length).toBe(2);
  });

  it("登録の命令が無い本体（開発用のブラウザ）では出さない", () => {
    expect(renderToString(h(AiAppRegister, { ai: host(false), initial: status([codex("unregistered")]) }))).toBe("");
  });

  it("画面の文に「接続口」と書かず、AI との接続は「接続する」と書く", () => {
    const src = readFileSync(join(APP_DIR, "src", "workspace", "ai", "AiAppRegister.tsx"), "utf8");
    const texts = [...src.matchAll(/"([^"]*)"|`([^`]*)`|>([^<>{}]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
    expect(texts.filter((t) => t.includes("接続口"))).toEqual([]);
    expect(texts.filter((t) => /つな[ぐげいがっ]/.test(t))).toEqual([]);
  });
});

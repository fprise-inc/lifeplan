// AI のアプリへの登録（事務所の設定の AI の区画。0015 の10・0228）:
// - AI のアプリごとに、状態（登録済み・未登録・場所が古い）と「登録する」「場所を直す」「登録を外す」を出す
// - 書く場所（ホームを ~ にした表示）と書く中身（AI とつなぐ道具の場所を伏せた文面）を先に見せ、押したときだけ本体が書く
// - 書けないとき（Claude Desktop が起動中・claude コマンドが無い・設定のファイルを読めない）は、下の「手動で登録する」の文面のコピーに戻す
import { useCallback, useEffect, useState } from "preact/hooks";
import type { AiAppsStatus, AiAppView, AiHost } from "../../engine/host.ts";
import { codeOf } from "./model.ts";

const STATE_TEXT: Record<string, string> = {
  registered: "登録済み",
  unregistered: "未登録",
  stale: "場所が古い",
  unreadable: "設定のファイルを読めません",
  missing: "このPCに見つかりません",
  unsupported: "この OS では使えません",
};

/** 押したあとに出す文（AI のアプリごと） */
const AFTER_REGISTER: Record<string, string> = {
  claudeDesktop: "Claude Desktop を起動すると、道具の一覧に出ます。",
  claudeCode: "新しく始めた Claude Code の会話から使えます。",
  codex: "Codex を起動し直すと使えます。",
  gemini: "Gemini CLI を起動し直すと使えます。",
};

const NOTE: Record<string, string> = {
  claudeDesktop: "Claude Desktop を完全に終了してから押してください（メニューの「終了」。ウィンドウを閉じるだけでは足りません）。起動中に書くと、Claude Desktop が終了するときに消えます。",
  claudeCode: "claude コマンド（claude mcp add）で登録します。設定のファイルは直接書きません。",
  codex: "Codex のアプリと CLI は、同じ設定のファイルを使います。",
  gemini: "Gemini CLI での動作は、まだ試していません（書く形は Gemini CLI の説明書のとおりです）。",
};

const ERRORS: Record<string, string> = {
  E_AI_APP_RUNNING: "Claude Desktop が起動しています。完全に終了してから「もう一度確かめる」を押してください。",
  E_AI_APP_NO_COMMAND: "claude コマンドが見つかりません。下の「手動で登録する」の文面をコピーして、ターミナルで実行してください。",
  E_AI_APP_UNREADABLE: "設定のファイルを読めないため、書き込みませんでした（コメントが入っているなど）。下の「手動で登録する」の文面をコピーして、手で足してください。",
  E_AI_APP_COMMAND: "claude コマンドで登録できませんでした。下の「手動で登録する」の文面をコピーして、ターミナルで実行してください。",
  E_AI_APP_WRITE: "設定のファイルに書き込めませんでした。下の「手動で登録する」の文面をコピーして、手で足してください。",
  E_AI_APP_BACKUP: "元の設定のファイルの控えを残せなかったため、書き込みませんでした。",
  E_AI_APP_MISSING: "この AI のアプリが、このPCに見つかりません。",
  E_AI_APP_LOCATION: "アプリを「アプリケーション」フォルダに入れてから、開き直してください。今の場所のまま登録すると、アプリを閉じたあとに AI のアプリから見つからなくなります。",
  E_AI_CONNECTOR_MISSING: "AI とつなぐ道具の実行ファイルが見つかりません。アプリを入れ直してください。",
};
const errorText = (code: string) => ERRORS[code] ?? `登録できませんでした（${code}）。下の「手動で登録する」の文面をコピーして、手で足してください。`;

export function AiAppRegister({ ai, initial = null }: { ai: AiHost; /** 最初に見せる状態（テスト用。ふだんは開いたときに本体に聞く） */ initial?: AiAppsStatus | null }) {
  const [status, setStatus] = useState<AiAppsStatus | null>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = ai.apps;

  const refresh = useCallback(async () => {
    if (load === undefined) return;
    try {
      setStatus(await load());
    } catch (e) {
      setMsg({ ok: false, text: errorText(codeOf(e)) });
    }
  }, [load]);
  useEffect(() => void refresh(), [refresh]);

  if (load === undefined || ai.registerApp === undefined || ai.unregisterApp === undefined) return null;
  const register = ai.registerApp;
  const unregister = ai.unregisterApp;

  const run = async (app: AiAppView, fn: () => Promise<AiAppsStatus>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      setStatus(await fn());
      setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: `${app.title}: ${errorText(codeOf(e))}` });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const problem = status?.locationProblem ?? null;
  return (
    <div class="ai-apps" data-ai-apps>
      <p class="in-note">
        お使いの AI のアプリの設定に、このアプリの AI とつなぐ道具を「{status?.serverName ?? "fprise-lifeplan"}」という名前で登録します。
        「登録する」を押したときだけ書き込み、ほかの設定は消しません。書く前の設定のファイルは、このアプリのデータの場所に控えを残します。
        アプリを入れ直した・動かしたときは「場所が古い」と出るので、「場所を直す」を押してください。
      </p>
      {problem !== null ? <p class="hh-warn">{errorText(problem)}</p> : null}
      {msg !== null ? (
        <p class={msg.ok ? "rk-ok" : "hh-err"} role="status" data-ai-apps-msg>
          {msg.text}
        </p>
      ) : null}
      {status === null ? null : (
        <ul class="ai-apps-list">
          {status.apps.map((a) => {
            const usable = a.state !== "missing" && a.state !== "unsupported";
            const canWrite = usable && problem === null && a.blocked === null && !busy;
            return (
              <li key={a.client} data-ai-app={a.client} data-ai-app-state={a.state}>
                <div class="ai-app-head">
                  <b>{a.title}</b>
                  <span class={`ai-app-state s-${a.state}`}>{STATE_TEXT[a.state] ?? a.state}</span>
                  {a.state === "unregistered" || a.state === "stale" ? (
                    <button
                      type="button"
                      class="btn primary"
                      disabled={!canWrite}
                      onClick={() => void run(a, () => register(a.client), `${a.title} に登録しました。${AFTER_REGISTER[a.client] ?? ""}`)}
                      data-ai-app-register
                    >
                      {a.state === "stale" ? "場所を直す" : "登録する"}
                    </button>
                  ) : null}
                  {a.state === "registered" || a.state === "stale" ? (
                    <button
                      type="button"
                      class="btn"
                      disabled={!usable || a.blocked !== null || busy}
                      onClick={() => void run(a, () => unregister(a.client), `${a.title} の登録を外しました（ほかの設定はそのままです）。`)}
                      data-ai-app-unregister
                    >
                      登録を外す
                    </button>
                  ) : null}
                </div>
                {usable ? (
                  <>
                    <p class="in-note">{NOTE[a.client]}</p>
                    {a.state === "stale" ? <p class="hh-warn">登録した場所が、今のアプリの場所と違います（アプリを入れ直した・動かしたときなど）。「場所を直す」で今の場所に書き直します。</p> : null}
                    {a.blocked !== null ? <p class="hh-warn">{errorText(a.blocked)}</p> : null}
                    <details class="ai-setup">
                      <summary>{a.how === "command" ? "呼ぶコマンド" : "書き込む場所と中身"}</summary>
                      {a.how === "file" ? (
                        <p class="in-note">
                          場所: <code>{a.target}</code>（<code>mcpServers</code> などの中の「{status.serverName}」の所だけを足す・直す・外します）
                        </p>
                      ) : null}
                      <pre>{a.preview}</pre>
                    </details>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" class="btn" disabled={busy} onClick={() => void refresh()} data-ai-apps-refresh>
        もう一度確かめる
      </button>
    </div>
  );
}

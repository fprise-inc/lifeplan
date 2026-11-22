// AI のアプリへの登録（事務所の設定の AI の区画。0015 の10・0228）:
// - 行は「Claude」と「Codex」。Claude の行は、チャットのアプリと Claude Code の2つの書く先をまとめ、1回押すと両方に登録する（0228 の追記 2026-11-20）
// - 行ごとに、状態（登録済み・未登録・場所が古い）と「登録する」「場所を直す」「登録を外す」を出す
// - 書く場所（ホームを ~ にした表示）と書く中身（AI と接続する道具の場所を伏せた文面）を先に見せ、押したときだけ本体が書く
// - Claude のアプリが起動中のときは Claude Code の側だけ登録し、そのことを行に出す（起動中かどうかは、押したときに本体が確かめ直す）
// - 書けないとき（claude コマンドが無い・設定のファイルを読めない）は、下の「手動で登録する」の文面のコピーに戻す
import { useCallback, useEffect, useState } from "preact/hooks";
import type { AiAppPart, AiAppsStatus, AiAppView, AiHost } from "../../engine/host.ts";
import { codeOf } from "./model.ts";

const STATE_TEXT: Record<string, string> = {
  registered: "登録済み",
  unregistered: "未登録",
  stale: "場所が古い",
  unreadable: "設定のファイルを読めません",
  missing: "このPCに見つかりません",
  unsupported: "この OS では使えません",
};

/** 登録したあとに出す文（書く先ごと） */
const AFTER_REGISTER: Record<string, string> = {
  claudeDesktop: "Claude のアプリを起動すると、道具の一覧に出ます。",
  claudeCode: "Claude Code は、新しく始めた会話から使えます。",
  codex: "Codex を起動し直すと使えます。",
};

/** 行の説明 */
const NOTE: Record<string, string> = {
  claude:
    "1回押すと、チャット（Claude のアプリ）と Claude Code の両方に登録します。チャットで使うときは、Claude のアプリを完全に終了してから押してください（メニューの「終了」。ウィンドウを閉じるだけでは足りません）。Claude Code の側は、claude コマンド（claude mcp add）で登録します。",
  codex: "パソコン用の Codex（アプリ・ターミナル）。ブラウザの ChatGPT は接続できません。",
};

const WHY_RUNNING = "アプリは終了するときに設定を書き直すので、起動中に書き込んだ登録は消えてしまいます。";
/** Claude のアプリが起動中で、Claude Code の側だけ登録してあるとき */
export const RUNNING_CODE_ONLY = `Claude のアプリが起動中のため、Claude Code の側だけ登録しました。${WHY_RUNNING}チャットでも使うときは、Claude のアプリを完全に終了してから、もう一度押してください。`;
const RUNNING_BEFORE = `Claude のアプリが起動中です。いま押すと、Claude Code の側だけ登録します。${WHY_RUNNING}チャットでも使うときは、Claude のアプリを完全に終了してから押してください。`;
const RUNNING_ONLY = `Claude のアプリが起動しています。メニューの「終了」で完全に終了してから押してください。${WHY_RUNNING}`;
const NO_DESKTOP = "Claude のアプリ（デスクトップ）が見つからないため、登録するのは Claude Code の側だけです。";
const NO_CODE = "Claude Code（claude コマンド）が見つからないため、登録するのはチャット（アプリ）の側だけです。";
const NO_COMMAND_HINT = "Claude Code でも使うときは、下の「手動で登録する」の文面をコピーして、ターミナルで実行してください。";
const NO_COMMAND = "claude コマンドが見つかりません。下の「手動で登録する」の文面をコピーして、ターミナルで実行してください。";

const ERRORS: Record<string, string> = {
  E_AI_APP_RUNNING: "Claude のアプリが起動しています。メニューの「終了」で完全に終了してから、もう一度押してください。",
  E_AI_APP_NO_COMMAND: NO_COMMAND,
  E_AI_APP_UNREADABLE: "設定のファイルを読めないため、書き込みませんでした（コメントが入っているなど）。下の「手動で登録する」の文面をコピーして、手で足してください。",
  E_AI_APP_COMMAND: "claude コマンドで登録できませんでした。下の「手動で登録する」の文面をコピーして、ターミナルで実行してください。",
  E_AI_APP_WRITE: "設定のファイルに書き込めませんでした。下の「手動で登録する」の文面をコピーして、手で足してください。",
  E_AI_APP_BACKUP: "元の設定のファイルの控えを残せなかったため、書き込みませんでした。",
  E_AI_APP_MISSING: "この AI のアプリが、このPCに見つかりません。",
  E_AI_APP_LOCATION: "アプリを「アプリケーション」フォルダに入れてから、開き直してください。今の場所のまま登録すると、アプリを閉じたあとに AI のアプリから見つからなくなります。",
  E_AI_CONNECTOR_MISSING: "AI と接続する道具の実行ファイルが見つかりません。アプリを入れ直してください。",
};
const errorText = (code: string) => ERRORS[code] ?? `登録できませんでした（${code}）。下の「手動で登録する」の文面をコピーして、手で足してください。`;
/** 外すときに Claude のアプリが起動中だった（Claude Code の側は外している） */
const UNREGISTER_RUNNING = "Claude のアプリが起動中のため、チャット（アプリ）の側の登録は外せませんでした。メニューの「終了」で完全に終了してから、もう一度押してください。";

const usable = (p: AiAppPart) => p.state !== "missing" && p.state !== "unsupported";
/** これから書く（登録する・場所を直す）書く先か */
const needs = (p: AiAppPart) => p.state === "unregistered" || p.state === "stale";
/** 押したときに本体が書ける書く先か。Claude のアプリが起動中かどうかは、押したときに本体が確かめ直すので、ここでは止めない */
const writable = (p: AiAppPart) => needs(p) && (p.blocked === null || p.blocked === "E_AI_APP_RUNNING");

/** 行の状態の文。Claude の行は、2つの書く先の状態を並べる（どちらも無ければ1つの文） */
export function rowStateText(a: AiAppView): string {
  if (a.parts.length <= 1 || a.state === "missing" || a.state === "unsupported") return STATE_TEXT[a.state] ?? a.state;
  return a.parts.map((p) => `${p.label}: ${STATE_TEXT[p.state] ?? p.state}`).join("／");
}

/** 行に出すボタン。register は「登録する」「場所を直す」のどちらを出すか（出さないなら null） */
export function rowButtons(a: AiAppView): { register: "登録する" | "場所を直す" | null; canRegister: boolean; unregister: boolean } {
  const todo = a.parts.filter(needs);
  return {
    register: todo.length === 0 ? null : todo.some((p) => p.state === "unregistered") ? "登録する" : "場所を直す",
    canRegister: todo.some(writable),
    unregister: a.parts.some((p) => p.state === "registered" || p.state === "stale"),
  };
}

/** Claude の行で、片方だけ登録する（した）ときの説明。どちらも無い・どちらも登録できるなら出さない */
export function claudeNotes(a: AiAppView): string[] {
  const desk = a.parts.find((p) => p.id === "claudeDesktop");
  const code = a.parts.find((p) => p.id === "claudeCode");
  if (desk === undefined || code === undefined || (!usable(desk) && !usable(code))) return [];
  const out: string[] = [];
  if (needs(desk) && desk.blocked === "E_AI_APP_RUNNING") out.push(code.state === "registered" ? RUNNING_CODE_ONLY : writable(code) ? RUNNING_BEFORE : RUNNING_ONLY);
  if (desk.state === "missing") out.push(NO_DESKTOP);
  if (needs(code) && code.blocked === "E_AI_APP_NO_COMMAND") out.push(usable(desk) ? `${NO_CODE}${NO_COMMAND_HINT}` : NO_COMMAND);
  else if (code.state === "missing") out.push(NO_CODE);
  return out;
}

/** 「登録する」「場所を直す」を押したあとの文（押したあとの状態から決める） */
export function afterRegister(a: AiAppView): string {
  const done = a.parts.filter((p) => p.state === "registered");
  const names = done.map((p) => p.label).join("・");
  // 英字で終わる名前（Claude Code）のあとだけ、間を空ける
  const head = a.parts.length <= 1 || a.state === "registered" || done.length === 0 ? `${a.title} に登録しました。` : `${a.title}: ${names}${/[A-Za-z]$/.test(names) ? " " : ""}の側だけ登録しました。`;
  return head + done.map((p) => AFTER_REGISTER[p.id] ?? "").join("");
}

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

  const run = async (app: AiAppView, fn: () => Promise<AiAppsStatus>, done: (after: AiAppView) => string, failed: (code: string) => string) => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await fn();
      setStatus(next);
      setMsg({ ok: true, text: done(next.apps.find((a) => a.client === app.client) ?? app) });
    } catch (e) {
      setMsg({ ok: false, text: `${app.title}: ${failed(codeOf(e))}` });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const problem = status?.locationProblem ?? null;
  return (
    <div class="ai-apps" data-ai-apps>
      <p class="in-note">
        お使いの AI のアプリの設定に、このアプリの AI と接続する道具を「{status?.serverName ?? "fprise-lifeplan"}」という名前で登録します。
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
            const shown = a.parts.filter(usable);
            const b = rowButtons(a);
            const many = a.parts.length > 1;
            return (
              <li key={a.client} data-ai-app={a.client} data-ai-app-state={a.state}>
                <div class="ai-app-head">
                  <b>{a.title}</b>
                  <span class={`ai-app-state s-${a.state}`} data-ai-app-state-text>
                    {rowStateText(a)}
                  </span>
                  {b.register !== null ? (
                    <button type="button" class="btn small primary" disabled={!b.canRegister || problem !== null || busy} onClick={() => void run(a, () => register(a.client), afterRegister, errorText)} data-ai-app-register>
                      {b.register}
                    </button>
                  ) : null}
                  {b.unregister ? (
                    <button
                      type="button"
                      class="btn small"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          a,
                          () => unregister(a.client),
                          () => `${a.title} の登録を外しました（ほかの設定はそのままです）。`,
                          (code) => (code === "E_AI_APP_RUNNING" ? UNREGISTER_RUNNING : errorText(code)),
                        )
                      }
                      data-ai-app-unregister
                    >
                      登録を外す
                    </button>
                  ) : null}
                </div>
                {shown.length > 0 ? (
                  <>
                    <p class="in-note">{NOTE[a.client]}</p>
                    {claudeNotes(a).map((t) => (
                      <p class="hh-warn" key={t} data-ai-app-note>
                        {t}
                      </p>
                    ))}
                    {a.state === "stale" ? <p class="hh-warn">登録した場所が、今のアプリの場所と違います（アプリを入れ直した・動かしたときなど）。「{b.register ?? "場所を直す"}」で今の場所に書き直します。</p> : null}
                    {shown
                      .filter((p) => p.blocked === "E_AI_APP_UNREADABLE")
                      .map((p) => (
                        <p class="hh-warn" key={p.id}>
                          {many ? `${p.label}: ` : ""}
                          {ERRORS.E_AI_APP_UNREADABLE}
                        </p>
                      ))}
                    <details class="ai-setup">
                      <summary>書き込む場所と中身</summary>
                      {shown.map((p) => (
                        <div key={p.id} data-ai-app-part={p.id} data-ai-app-part-state={p.state}>
                          {many ? <p class="ai-app-part">{p.label}</p> : null}
                          {p.how === "file" ? (
                            <p class="in-note">
                              場所: <code>{p.target}</code>（<code>mcpServers</code> などの中の「{status.serverName}」の所だけを足す・直す・外します）
                            </p>
                          ) : (
                            <p class="in-note">呼ぶコマンド（設定のファイルは直接書きません）</p>
                          )}
                          <pre>{p.preview}</pre>
                        </div>
                      ))}
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

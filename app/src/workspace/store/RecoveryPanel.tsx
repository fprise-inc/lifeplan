// 復元キーの案内（中央のパネル。0013 の3）:
// - 初回: 復元キーを表示して、保管を強く勧める（保管するかは FP が選ぶ）。「保管した」を記録する
// - 「復元キーで実際に開けるか試す」（データは変えない）
// - 保管庫に親鍵が無いとき: 復元キーを入れて戻す
// - 事務所で共有しているとき（shared）: 事務所の復元キー（共有の事務所の鍵）。試して開けたら保管済みとして記録する（0023 の5）
// 復元キーは表示のためだけに受け取り、パネルを閉じたら消す（画面はどこにも保存しない。0016 の1）
import { useEffect, useRef, useState } from "preact/hooks";
import type { StoreHost, StoreStatus } from "../../engine/host.ts";

export type RecoveryMode = "first" | "manage" | "restore";

const MESSAGES: Record<string, string> = {
  E_RECOVERY_TYPO: "打ち間違いがあります。文字を確かめてください（大文字・小文字、区切りの有無は問いません）",
  E_RECOVERY_MISMATCH: "この事務所の復元キーではありません",
};
const message = (code: string) => MESSAGES[code] ?? `確かめられませんでした（${code}）`;
const codeOf = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "E_STORE");

/** 復元キーを5組ずつの行に分ける（表示用） */
export function keyLines(key: string): string[] {
  const groups = key.split("-");
  const out: string[] = [];
  for (let i = 0; i < groups.length; i += 5) out.push(groups.slice(i, i + 5).join("-"));
  return out;
}

export function RecoveryPanel({ mode, store, status, onStatus, onClose, shared = false }: { mode: RecoveryMode; store: StoreHost; status: StoreStatus | null; onStatus: (s: StoreStatus) => void; onClose: () => void; shared?: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode === "first") void store.recoveryKey().then(setKey, () => setKey(null));
    panel.current?.focus({ preventScroll: true });
    return () => setKey(null);
  }, [mode, store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && mode !== "restore" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const tryKey = async () => {
    setBusy(true);
    setResult(null);
    try {
      const s = mode === "restore" ? await store.restoreWithRecoveryKey(input) : await store.testRecoveryKey(input);
      onStatus(s);
      setInput("");
      setResult({ ok: true, text: mode === "restore" ? "事務所の鍵を戻しました。保存した世帯を開けます" : shared ? "この復元キーで開けることを確かめました。事務所の復元キーを保管済みとして記録しました" : "この復元キーで開けることを確かめました" });
    } catch (e) {
      setResult({ ok: false, text: message(codeOf(e)) });
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "restore" ? "復元キーで事務所の鍵を戻す" : shared ? "事務所の復元キー" : "復元キー";
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={mode === "restore" ? undefined : onClose} />
      <div ref={panel} class="rk-panel" role="dialog" aria-modal="true" aria-labelledby="rk-title" tabIndex={-1} data-recovery-panel={mode}>
        <h2 id="rk-title">{title}</h2>
        {mode === "restore" ? (
          <p>
            この PC の資格情報の保管庫に、事務所の鍵が見つかりません（OS の入れ直し・PC の交換など）。保管しておいた復元キーを入れると、鍵を戻して、保存した世帯を開けるようになります。
          </p>
        ) : (
          <>
            {shared ? (
              <p data-recovery-shared>
                共有している事務所の世帯は、事務所の鍵で暗号化しています。<b>事務所の全員の PC が使えなくなったときは、この復元キーで新しい PC を事務所に加えられます。復元キーが無いと、誰も読めなくなります（提供元にも戻せません）。</b>
                復元キーを持つ人は事務所のすべての世帯を開けるので、事務所の代表の方が保管してください。メンバーを外すたびに新しくなります（古い控えは破棄してください）。保管するまで、参加の承認とメンバーを外す操作は止まります。
              </p>
            ) : (
              <p>
                保存した世帯は、この PC の資格情報の保管庫にある事務所の鍵で暗号化しています。ふだんはパスワードの入力は要りません。
                <b>PC の故障・入れ替え・OS の入れ直しで鍵がなくなったときは、復元キーが無いと、すべての世帯とバックアップを誰も読めなくなります（提供元にも戻せません）。</b>
              </p>
            )}
            <p class="rk-advice">印刷するか、パスワード管理のソフトに保存してください。画面の写真やメールでの保管は避けてください。</p>
            {key !== null ? (
              <div class="rk-key" data-recovery-key>
                {keyLines(key).map((l) => (
                  <div key={l}>{l}</div>
                ))}
              </div>
            ) : mode === "manage" ? (
              <button type="button" class="btn" onClick={() => void store.recoveryKey().then(setKey, () => setKey(null))} data-show-key>
                復元キーを表示する
              </button>
            ) : null}
            {key !== null && status?.recoveryAcknowledged !== true ? (
              <div class="rk-ack">
                <label>
                  <input type="checkbox" checked={kept} onChange={(e) => setKept((e.currentTarget as HTMLInputElement).checked)} data-kept />
                  復元キーを安全な場所に保管しました
                </label>
                <button
                  type="button"
                  class="btn primary"
                  disabled={!kept || busy}
                  onClick={() => {
                    setBusy(true);
                    void store
                      .acknowledgeRecovery()
                      .then((s) => {
                        onStatus(s);
                        onClose();
                      })
                      .catch(() => setResult({ ok: false, text: "記録できませんでした" }))
                      .finally(() => setBusy(false));
                  }}
                  data-acknowledge
                >
                  保管した
                </button>
              </div>
            ) : null}
            {status?.recoveryAcknowledged === true ? <p class="in-note">復元キーは保管済みとして記録しています。</p> : null}
          </>
        )}
        <form
          class="rk-test"
          onSubmit={(e) => {
            e.preventDefault();
            void tryKey();
          }}
        >
          <h3>{mode === "restore" ? "復元キーを入れる" : "復元キーで実際に開けるか試す"}</h3>
          {mode !== "restore" ? (
            <p class="in-note">
              保管した控えが正しいかを確かめます。世帯のデータは変えません。{shared ? "開けたら、事務所の復元キーを保管済みとして記録します。" : ""}
              {status?.recoveryVerifiedAt != null ? "（前に確かめた控えがあります）" : ""}
            </p>
          ) : null}
          <div class="rk-row">
            <input value={input} onInput={(e) => setInput((e.currentTarget as HTMLInputElement).value)} placeholder="XXXX-XXXX-…（72文字）" aria-label="復元キー" autoComplete="off" spellcheck={false} data-recovery-input />
            <button type="submit" class="btn" disabled={busy || input.trim() === ""} data-recovery-try>
              {mode === "restore" ? "戻す" : "試す"}
            </button>
          </div>
          {result !== null ? <p class={result.ok ? "rk-ok" : "hh-err"} role="status">{result.text}</p> : null}
        </form>
        {mode !== "restore" && !shared ? (
          <div class="rk-later">
            <h3>別の PC で使う・同期フォルダに置く</h3>
            <p class="in-note">複数の PC・複数の FP で使うときは、世帯の一覧の「事務所の共有」から始めます。共有を始めると事務所の復元キーは新しくなり、保管が必須になります。</p>
          </div>
        ) : null}
        {mode !== "restore" ? (
          <div class="rk-foot">
            <button type="button" class="btn" onClick={onClose} data-recovery-close>
              {status?.recoveryAcknowledged === true ? "閉じる" : "あとで"}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

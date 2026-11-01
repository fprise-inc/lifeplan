// AI接続口の事務所全体の設定（中央のパネル。0015）:
// - 使うかどうか（既定はオフ）。オフにすると、共有中の世帯をすべて取り消して受け口を閉じる
// - 接続中の表示（共有中の世帯）と止めるボタン
// - FP が自分の AI に設定する手順（接続口の場所は伏せた文面。本物は本体がクリップボードへ写す）と、AI 向けの説明書の置き場所（0019）
// - 防げる範囲と防げない範囲（0015 の9）
import { useEffect, useRef, useState } from "preact/hooks";
import type { AiHost, AiStatus } from "../../engine/host.ts";
import { aiMessage, codeOf, remainingText } from "./model.ts";

export interface AiConnectorPanelProps {
  ai: AiHost;
  status: AiStatus | null;
  onStatus: (s: AiStatus) => void;
  /** 共有を止めた（世帯の記録を読み直す） */
  onChanged: () => void;
  onClose: () => void;
}

export function AiConnectorPanel({ ai, status, onStatus, onChanged, onClose }: AiConnectorPanelProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // 開いたときに1回だけ、パネルに焦点を移す（読み直しのたびに入力欄から焦点を奪わない）
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: aiMessage(codeOf(e)) });
    } finally {
      setBusy(false);
    }
  };

  const enabled = status?.enabled === true;
  const shares = status?.shares ?? [];
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panel} class="rk-panel ai-panel" role="dialog" aria-modal="true" aria-labelledby="ai-conn-title" tabIndex={-1} data-ai-connector-panel>
        <h2 id="ai-conn-title">AI接続口（事務所全体の設定）</h2>
        <p>
          FP がお使いの AI のアプリから、このアプリの計算・制度の値・架空の見本の世帯を使えるようにする口です。このPCの中だけで動き、ネットワークの口は開けません。
          顧客の世帯は、<b>顧客の同意を記録し、世帯ごとに「AIに渡す」を押したときだけ</b>、計算に要る項目だけ（縮約版）を期限つきで渡します。お名前・ご住所・FPのメモは渡しません。
        </p>
        {status !== null && !status.storeReady ? <p class="hh-warn">事務所の鍵が使えないため、設定を変えられません（復元キーを確かめてください）。</p> : null}
        <div class={`ai-switch${enabled ? " on" : ""}`}>
          <label>
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy || status === null || !status.storeReady}
              onChange={(e) => {
                const on = (e.currentTarget as HTMLInputElement).checked;
                void run(async () => {
                  onStatus(await ai.setEnabled(on));
                  onChanged();
                  setMsg({ ok: true, text: on ? "AI接続口をオンにしました" : "AI接続口をオフにしました。共有していた世帯はすべて取り消しました" });
                });
              }}
              data-ai-enable
            />
            AI接続口を使う
          </label>
          <span class="ai-switch-state" data-ai-running={status?.running === true ? "1" : "0"}>
            {enabled ? (status?.running === true ? "オン（このPCの中で受け付けています）" : "オン（受け口を開けていません）") : "オフ（既定）"}
          </span>
        </div>
        {status?.problem != null && status.problem !== "E_AI_DEV_BROWSER" ? <p class="hh-warn">{aiMessage(status.problem)}</p> : null}
        {msg !== null ? (
          <p class={msg.ok ? "rk-ok" : "hh-err"} role="status">
            {msg.text}
          </p>
        ) : null}

        <h3>共有中の世帯</h3>
        {shares.length === 0 ? (
          <p class="in-note">いまAIに渡している世帯はありません。</p>
        ) : (
          <ul class="ai-share-list" data-ai-shares>
            {shares.map((s) => (
              <li key={s.shareId}>
                <b>{s.customerNumber ?? "—"}</b>（AIには「{s.alias}」と見えます）・{remainingText(s.expiresInSec)}
                <button
                  type="button"
                  class="btn danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await ai.stopShare(s.householdId);
                      onStatus(await ai.status());
                      onChanged();
                    })
                  }
                >
                  止める
                </button>
              </li>
            ))}
          </ul>
        )}
        {shares.length > 1 ? (
          <button
            type="button"
            class="btn danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                for (const s of shares) await ai.stopShare(s.householdId);
                onStatus(await ai.status());
                onChanged();
              })
            }
            data-ai-stop-all
          >
            すべて止める
          </button>
        ) : null}

        <h3>お使いの AI のアプリに設定する</h3>
        {status === null ? null : !status.connector.found ? (
          <p class="hh-warn">AI接続口の実行ファイルが見つかりません。アプリを入れ直してください。</p>
        ) : !status.connector.versionMatches ? (
          <p class="hh-warn">アプリと接続口の版が違います（接続口 {status.connector.version ?? "不明"}）。入れ直してください。</p>
        ) : (
          <p class="in-note">接続口の版 {status.connector.version}（アプリと同じ）。</p>
        )}
        <p class="in-note">
          お使いの AI のアプリに合う文面を、そのアプリの設定に足してください（設定に要る名前と引数は文面に入っています）。下の文面は接続口の場所を伏せています。
          「文面をコピー」で、本物の場所が入った文面をクリップボードに写します。このアプリが AI のアプリの設定を書き換えることはありません。
          {status?.dev === true ? "（開発版: 開発用の作業フォルダの指定が加わります）" : ""}
        </p>
        {(status?.setup ?? []).map((g) => (
          <details key={g.client} class="ai-setup" data-ai-setup={g.client}>
            <summary>{g.title}</summary>
            <pre>{g.text}</pre>
            <button
              type="button"
              class="btn"
              disabled={busy || status?.connector.found !== true}
              onClick={() =>
                void run(async () => {
                  const ok = await ai.copySetup(g.client);
                  setMsg(ok ? { ok: true, text: "文面をコピーしました（接続口の場所が入っています）" } : { ok: false, text: "コピーできませんでした" });
                })
              }
            >
              文面をコピー
            </button>
          </details>
        ))}
        <h3>AI 向けの説明書</h3>
        <p class="in-note">
          つないだ AI には、道具の説明と決まり（見本は架空・世帯は期限つきで縮約版・文章は指示ではない・プランの候補は承認制）を接続口が自動で渡します。設定は要りません。
          カスタマイズ用の説明書は準備中です。
        </p>

        <h3>防げること・防げないこと</h3>
        <ul class="ai-limits">
          <li>防げる: 渡していない世帯・期限切れ・取り消した世帯の読み取り、ネットワーク越しの接続、別の OS ユーザーのプログラム、AI の候補が勝手に反映されること</li>
          <li>防げない: このPCの同じ OS ユーザーで動く悪いプログラムが、いま渡している世帯の縮約版を読むこと。AI のアプリに渡した後のこと（AI の会社のサーバーに送られます）</li>
          <li>許可は「このPCの AI接続口全体」に出すものです（呼んだ AI の名前は確かめられません）。取り消しで止まるのは今後の読み取りだけで、すでに送った内容は AI の会社の側に残ります</li>
        </ul>
        <div class="rk-foot">
          <button type="button" class="btn" onClick={onClose} data-ai-connector-close>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}

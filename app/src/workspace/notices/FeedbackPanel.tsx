// 要望・不具合を送る（0087 の6）。受付番号を大きく出し、「フォームを開く」を押すと、その番号をこの PC に覚えて既定のブラウザで要望のフォームを開く。
// フォームの URL に差し込むのは受付番号・アプリの版・OS だけ。アプリ自身は送らない。
// フォームが番号の差し込みに対応していないときのために、番号は「写す」で写せる。別の PC で送った番号は手で入れて覚えられる
import { useEffect, useRef, useState } from "preact/hooks";
import { dateText } from "./center.ts";
import { feedbackFormUrl, newReceiptCode, readReceiptInput, type Receipt } from "./receipts.ts";

export interface FeedbackPanelProps {
  receipts: readonly Receipt[];
  /** フォームの URL のひな形（config/distribution.toml） */
  template: string;
  appVersion: string;
  os: string;
  /** 受付番号を覚えて、フォームを開く（開けなかったら投げる） */
  onSend: (code: string) => Promise<void>;
  /** 手で入れた受付番号を覚える */
  onAdd: (code: string) => void;
  /** 本体で受付番号を写す（写せたら true。無いときや写せないときは、ブラウザの仕組みで写す） */
  onCopy?: ((code: string) => Promise<boolean>) | undefined;
  onClose: () => void;
  /** 最初に出す受付番号（画面の確かめ用。ふつうは作る） */
  initialCode?: string | undefined;
}

export function FeedbackPanel(p: FeedbackPanelProps) {
  const [code, setCode] = useState(() => p.initialCode ?? newReceiptCode());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [typedMsg, setTypedMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const codeEl = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);
  const sent = p.receipts.find((r) => r.code === code);
  const url = feedbackFormUrl(p.template, { code, appVersion: p.appVersion, os: p.os });
  const copy = async () => {
    try {
      if (!(await p.onCopy?.(code).catch(() => false))) await navigator.clipboard.writeText(code);
      setMsg({ ok: true, text: `受付番号 ${code} を写しました。フォームの受付番号の欄に貼り付けてください` });
    } catch {
      // 写せないときは番号を選んだ状態にする（選んで写す）
      const sel = window.getSelection();
      if (codeEl.current !== null && sel !== null) {
        const r = document.createRange();
        r.selectNodeContents(codeEl.current);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      setMsg({ ok: false, text: "写せませんでした。選んだ番号を写すか、そのまま書き写してください" });
    }
  };
  const send = async () => {
    setBusy(true);
    try {
      await p.onSend(code);
      setMsg({ ok: true, text: `受付番号 ${code} をこの PC に覚えて、ブラウザでフォームを開きました。フォームに番号が入っていないときは、上の番号を写して入れてください` });
    } catch {
      setMsg({ ok: false, text: `フォームを開けませんでした。受付番号 ${code} はこの PC に覚えています。ブラウザで次の場所を開いてください: ${url}` });
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    const r = readReceiptInput(typed);
    if ("error" in r) return setTypedMsg({ ok: false, text: r.error });
    if (p.receipts.some((x) => x.code === r.code)) return setTypedMsg({ ok: true, text: `${r.code} はもう覚えています` });
    p.onAdd(r.code);
    setTyped("");
    setTypedMsg({ ok: true, text: `${r.code} を覚えました。対応のお知らせが届くと、お知らせの一覧に出ます` });
  };
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={p.onClose} />
      <div ref={panel} class="rk-panel fb-panel" role="dialog" aria-modal="true" aria-labelledby="fb-title" tabIndex={-1} data-feedback-panel>
        <h2 id="fb-title">要望・不具合を送る</h2>
        <p class="pl-sub">
          ファイナンシアへの要望や、不具合の知らせを、ブラウザのフォームから送っていただけます。「フォームを開く」を押すと、下の受付番号をこの PC に覚えて、既定のブラウザでフォームを開きます。このアプリ自身は何も送りません。
        </p>
        <div class="fb-code" data-feedback-code={code}>
          <span class="fb-code-lbl">受付番号</span>
          <span class="fb-code-no" ref={codeEl}>
            {code}
          </span>
          <button type="button" class="btn" onClick={() => void copy()} data-feedback-copy>
            写す
          </button>
        </div>
        <p class="fb-note">
          フォームには受付番号・アプリの版（{p.appVersion}）・OS（{p.os}）だけを入れます。お客さまの名前・金額など世帯の情報は書かないでください（画面の写しを付けるときも、写らないようにしてください）。対応したときは、この番号を覚えている PC のお知らせの一覧に「あなたの要望に対応しました」と出ます。
        </p>
        <div class="fb-actions">
          <button type="button" class="btn primary" disabled={busy} onClick={() => void send()} data-feedback-send>
            フォームを開く
          </button>
          {sent !== undefined ? (
            <button
              type="button"
              class="link-btn"
              onClick={() => {
                setCode(newReceiptCode());
                setMsg(null);
              }}
              data-feedback-new
            >
              別の要望を新しい受付番号で送る
            </button>
          ) : null}
        </div>
        {msg !== null ? (
          <p class={msg.ok ? "fb-msg" : "fb-msg err"} role="status" data-feedback-msg>
            {msg.text}
          </p>
        ) : null}
        <section class="fb-sec" aria-labelledby="fb-list">
          <h3 id="fb-list">覚えている受付番号（{p.receipts.length}件）</h3>
          {p.receipts.length === 0 ? (
            <p class="pl-sub">まだありません</p>
          ) : (
            <ul class="fb-list" data-feedback-receipts>
              {p.receipts.map((r) => (
                <li key={r.code} data-feedback-receipt={r.code}>
                  <span class="fb-list-no">{r.code}</span>
                  <span class="fb-list-on">{dateText(r.on)}</span>
                  <span class="fb-list-how">{r.manual === true ? "手で入れた番号" : "この PC で送った番号"}</span>
                </li>
              ))}
            </ul>
          )}
          <h3>別の PC で送った受付番号を入れる</h3>
          <p class="pl-sub">アプリを入れ直したときや、別の PC で送ったときは、送ったときの受付番号を入れると、対応のお知らせがこの PC にも出ます。</p>
          <form
            class="fb-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input type="text" value={typed} placeholder="R-7K2Q" maxLength={12} aria-label="受付番号" onInput={(e) => setTyped((e.target as HTMLInputElement).value)} data-feedback-input />
            <button type="submit" class="btn" data-feedback-add>
              覚える
            </button>
          </form>
          {typedMsg !== null ? (
            <p class={typedMsg.ok ? "fb-msg" : "fb-msg err"} role="status" data-feedback-typed-msg>
              {typedMsg.text}
            </p>
          ) : null}
        </section>
        <div class="rk-actions">
          <button type="button" class="btn" onClick={p.onClose}>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}

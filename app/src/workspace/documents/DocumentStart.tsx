// 「この書類を読む」の画面（0154 の3・0159）: 書類のお願いの1通（保険証券）・入力の欄の「書類待ち」・保険の入力項目の見出しから開き、その書類の読み方を選ぶ。
// - 読めるのは保険証券・ご契約内容のお知らせ・設計書だけ（0159）
// - AI で読み取る（保存した世帯だけ。取り込むの「AI で書類を読み取る」と同じボタン）。AI から届いた候補は、書類の読み取りの確認画面に届く
// - 見本の世帯は AI に渡せないので、架空の見本で書類の読み取りの確認画面を試せる
// - AI の答えを貼り付ける道は、利用者の判断（2026-11-20）でなくした（0151 の追記）
// 世帯は変えない
import { useEffect, useRef } from "preact/hooks";
import { CloseX, useEscClose } from "../../presentation/CloseX.tsx";
import type { WorkingHousehold } from "../input/household.ts";
import type { DocStart } from "./start.ts";

export interface DocumentStartProps {
  wh: WorkingHousehold;
  start: DocStart;
  /** AI で読み取る（保存した世帯だけ。AI と接続していれば同意と共有の画面、していなければ AI との接続の設定を開く） */
  ai?: { connected: boolean; onOpen: () => void };
  /** 架空の見本で試す（見本の世帯だけ） */
  onSamples?: () => void;
  onClose: () => void;
}

export function DocumentStart(p: DocumentStartProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  useEscClose(p.onClose);
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={p.onClose} />
      <div ref={panel} class="rk-panel dr-panel ds-panel" role="dialog" aria-modal="true" aria-labelledby="ds-title" tabIndex={-1} data-documents-start={p.start.docType}>
        <CloseX onClose={p.onClose} what="この書類を読む" />
        <h2 id="ds-title">この書類を読む: {p.start.title}</h2>
        <p class="in-note">保険証券・ご契約内容のお知らせ・設計書から読んだ値は候補として届き、書類の読み取りの確認画面で承認したものだけが現状に入ります。書類の名義の人も、その画面で選びます。</p>
        <ul class="ds-ways">
          {p.ai !== undefined ? (
            <li data-documents-start-ai>
              <b>AI で読み取る</b>
              <span>ファイナンシアと接続した AI に書類を渡すと、読んだ値が候補として届きます（同意と共有で、この世帯を渡してから。書類を AI に渡すことを含む同意の世帯だけ）。</span>
              <button type="button" class="btn" onClick={p.ai.onOpen} data-documents-start-ai-open>
                {p.ai.connected ? "この世帯を AI に渡す" : "AI と接続する"}
              </button>
            </li>
          ) : (
            <li data-documents-start-ai-unsaved>
              <b>AI で読み取る</b>
              <span>{p.onSamples !== undefined ? "見本の世帯は AI に渡せません。" : "保存していない世帯は AI に渡せません。世帯を保存してから使ってください。"}</span>
            </li>
          )}
          {p.onSamples !== undefined ? (
            <li data-documents-start-samples>
              <b>架空の見本で試す</b>
              <span>架空の保険証券の見本を読み、AI が読んだ書類と同じ書類の読み取りの確認画面を試せます（見本の世帯だけ）。</span>
              <button type="button" class="btn" onClick={p.onSamples} data-documents-start-samples-open>
                架空の保険証券の見本で試す
              </button>
            </li>
          ) : null}
          <li>
            <b>欄に打つ</b>
            <span>書類を見ながら入力の欄に打ってもかまいません（書類待ちの欄は、値を打つと消えます）。</span>
          </li>
        </ul>
        <div class="dr-foot">
          <button type="button" class="btn" onClick={p.onClose} data-documents-start-close>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}

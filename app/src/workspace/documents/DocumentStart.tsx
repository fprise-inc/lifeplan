// 「この書類を読む」の画面（0154 の3・0159）: 書類のお願いの1通（保険証券）・入力の欄の「書類待ち」・保険の入力項目の見出しから開き、その書類の読み方を選ぶ。
// - 読めるのは保険証券・ご契約内容のお知らせ・設計書だけ（0159）
// - AI の答えを貼り付ける（保険の書類の読み方の手引きを写せる形で開く。外部AIへの同意のある世帯だけ。0151）
// - AI接続口から届く候補も、同じ確かめの画面に届く
// 名義の人・書類の物の初めの値は、読んだ記録に入れる（start.ts の withStart）。世帯は変えない
import { useEffect, useRef } from "preact/hooks";
import type { WorkingHousehold } from "../input/household.ts";
import { roles } from "../roles.ts";
import type { DocStart } from "./start.ts";

export interface DocumentStartProps {
  wh: WorkingHousehold;
  start: DocStart;
  /** AI の答えを貼り付ける画面を開く */
  onPaste: () => void;
  /** AI に資料を渡す（同意と共有）を開く（保存した世帯だけ） */
  onAiShare?: () => void;
  onClose: () => void;
}

export function DocumentStart(p: DocumentStartProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);
  const holder = p.start.holder === null ? null : (roles(p.wh.request).find((r) => r.member.id === p.start.holder)?.label ?? null);
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={p.onClose} />
      <div ref={panel} class="rk-panel dr-panel ds-panel" role="dialog" aria-modal="true" aria-labelledby="ds-title" tabIndex={-1} data-documents-start={p.start.docType}>
        <h2 id="ds-title">この書類を読む: {p.start.title}</h2>
        <p class="in-note">
          保険証券・ご契約内容のお知らせ・設計書から読んだ値は候補として届き、確かめの画面で承認したものだけが現状に入ります。
          {holder !== null ? `書類の名義の人は「${holder}」にしておきます（確かめの画面で変えられます）。` : "書類の名義の人は、確かめの画面で選びます。"}
        </p>
        <ul class="ds-ways">
          <li data-documents-start-paste>
            <b>AI の答えを貼り付ける</b>
            <span>書類を、お名前・番号を伏せてウェブのチャット AI に読ませ、答えを貼り付けます（書類を AI に渡すことを含む、外部AIへの提供の同意がある世帯だけ）。AI に渡す読み方の手引きは、貼り付けの画面で写せます。</span>
            <button type="button" class="btn" onClick={p.onPaste} data-documents-start-paste-open>
              AI の答えを貼り付ける
            </button>
          </li>
          {p.onAiShare !== undefined ? (
            <li data-documents-start-ai>
              <b>AI接続口で読む</b>
              <span>AI接続口を使う AI に書類を渡すと、読んだ値が候補として届きます（同意と共有で、この世帯を渡してから。書類を AI に渡すことを含む同意の世帯だけ）。</span>
              <button type="button" class="btn" onClick={p.onAiShare} data-documents-start-ai-open>
                同意と共有を開く
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

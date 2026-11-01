// 書類のお願い（入力のホームの道具。0102）: 書類待ちの欄から作った「送ってほしい書類の一覧」と、お客さまに貼るお願いの文の写し、
// 書類の受け取り方の注意（FP 向け）、書類ごとの写す欄（今の代わりの値と、欄へ移る「開く」）を出す。
// - 一覧は世帯から毎回作る（docRequests.ts。保存しない）。欄に書類の値を打つと、その欄はすぐ一覧から消える
// - お名前・事務所名は文に入れるだけで保存しない（アプリを開いている間だけ覚える）
// - 世帯は直さない（移るだけ）
import { useMemo, useState } from "preact/hooks";
import { Help } from "../../presentation/Help.tsx";
import type { Level } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { docRequests, requestMessage, SAFE_SENDING } from "./docRequests.ts";

interface Props {
  wh: WorkingHousehold;
  /** 入力項目を開いて欄に移る */
  onOpen: (card: string, fieldKey: string | null, level: Level) => void;
  onClose?: () => void;
}

/** お名前・事務所名（アプリを開いている間だけ覚える。保存しない） */
const remembered = { name: "", office: "" };

export function DocRequests({ wh, onOpen, onClose }: Props) {
  const reqs = useMemo(() => docRequests(wh), [wh]);
  const [name, setName] = useState(remembered.name);
  const [office, setOffice] = useState(remembered.office);
  const [note, setNote] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const text = requestMessage(reqs, { name, office });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setShown(null);
      setNote("写しました。メールやメッセージに貼り付けて、送る前に読み直してください（金額・番号は入っていません）");
    } catch {
      // 写せないときは文を見せる（選んで写す）
      setNote(null);
      setShown(text);
    }
  };
  const values = reqs.reduce((n, r) => n + r.values.length, 0);
  return (
    <section class="ck dr" aria-label="書類のお願い" data-doc-requests>
      <div class="ck-head">
        <h2>
          書類のお願い
          <Help label="書類のお願い" id="docRequests">
            <p>欄で「書類で確かめる」にした所（書類待ち）から、お客さまに送ってもらう書類を、人・契約・ローンごとに1通ずつまとめます。</p>
            <p>書類ごとに、その書類から写す欄と今の代わりの値を並べます。「開く」でその欄に移り、書類の値を打つと書類待ちが消え、この一覧からも消えます。</p>
            <p>「文をコピー」は、メール・メッセージに貼るお願いの文を写します。書類の名前と見たい所だけで、金額・番号・顧客番号は入りません。お名前・事務所名は文に入れるだけで、保存しません。</p>
            <p>同じ一覧は、ヒアリングシートを書き出すときに1枚目の「今回お願いしたい書類」にも載ります。</p>
          </Help>
        </h2>
        <p class="ck-lead">
          {reqs.length > 0 ? `書類 ${reqs.length}通・写す欄 ${values}` : "書類待ちの欄はありません。入力の欄で「書類で確かめる」にすると、ここに並びます。"}
        </p>
      </div>
      {reqs.length > 0 ? (
        <ol class="dr-list">
          {reqs.map((r) => (
            <li key={r.id} data-dr-doc={r.id}>
              <span class="dr-title">{r.title}</span>
              <ul>
                {r.values.map((v) => (
                  <li key={v.rowId} data-dr-value={v.rowId}>
                    <span class="ck-card">{v.cardLabel}</span>
                    <span class="ck-label">{v.label}</span>
                    {v.value !== null ? (
                      <span class="ck-value" data-dr-sub>
                        代わりの値 {v.value}
                      </span>
                    ) : null}
                    <span class="ck-acts">
                      <button type="button" class="link-btn" onClick={() => onOpen(v.card, v.fieldKey, v.level)} data-dr-open={v.rowId} title="この欄に移って、書類の値を打ちます">
                        開く
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}
      {reqs.length > 0 ? (
        <div class="dr-msg" data-dr-message>
          <h3>お客さまへのお願いの文</h3>
          <div class="ck-tools">
            <label>
              お名前
              <input
                type="text"
                value={name}
                maxLength={40}
                autocomplete="off"
                placeholder="入れなければ「〇〇」"
                onInput={(e) => {
                  remembered.name = (e.currentTarget as HTMLInputElement).value;
                  setName(remembered.name);
                }}
                data-dr-name
              />
            </label>
            <label>
              事務所名
              <input
                type="text"
                value={office}
                maxLength={60}
                autocomplete="off"
                placeholder="入れなければ「（事務所名）」"
                onInput={(e) => {
                  remembered.office = (e.currentTarget as HTMLInputElement).value;
                  setOffice(remembered.office);
                }}
                data-dr-office
              />
            </label>
            <button type="button" class="add-btn" onClick={() => void copy()} data-dr-copy title="メール・メッセージに貼るお願いの文を写します">
              文をコピー
            </button>
          </div>
          <p class="rp-note">お名前・事務所名は文に入れるだけで、保存しません。</p>
          {note !== null ? (
            <p class="in-note" role="status">
              {note}
            </p>
          ) : null}
          {shown !== null ? <textarea class="ck-copy" readOnly value={shown} rows={Math.min(16, shown.split("\n").length + 1)} aria-label="お願いの文" data-dr-text /> : null}
          <details class="dr-preview">
            <summary>文を見る</summary>
            <pre class="dr-pre" data-dr-preview>
              {text}
            </pre>
          </details>
        </div>
      ) : null}
      <details class="dr-safe" data-dr-safe>
        <summary>書類を安全に受け取るには（FP 向け）</summary>
        <ul>
          {SAFE_SENDING.map((s) => (
            <li key={s.title}>
              <b>{s.title}</b>
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      </details>
      {onClose !== undefined ? (
        <div class="rp-actions">
          <button type="button" class="btn" onClick={onClose} data-dr-close>
            閉じる
          </button>
        </div>
      ) : null}
    </section>
  );
}

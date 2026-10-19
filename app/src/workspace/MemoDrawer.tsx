// FP用のメモの引き出し（作業の層の部品）: 画面には出さず、上部の「メモ」ボタンで開いたときだけ右の端に出す。
// 提示層の部品には渡さない（0016 の2）。開いている間も、グラフや表の上には重ねない（広い画面では本文を左に寄せる）
// 事務所で共有しているときは、行ごとに書いた人を残し（変わらない行は前の人のまま）、引き出しの下に一覧で出す（0023 の6）
import { useEffect, useRef, useState } from "preact/hooks";
import type { WorkingHousehold } from "./input/household.ts";
import { memoAuthors } from "./store/office.ts";

export interface MemoDrawerProps {
  wh: WorkingHousehold;
  onEdit: (w: WorkingHousehold) => void;
  onClose: () => void;
  /** 事務所で共有しているときの自分（メンバーの内部ID） */
  me?: string | null;
  /** メンバーの内部ID → 表示名（世帯ファイルの記録と、事務所の名簿から） */
  names?: Record<string, string>;
}

export function MemoDrawer({ wh, onEdit, onClose, me = null, names = {} }: MemoDrawerProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = wh.memo.join("\n");
  const area = useRef<HTMLTextAreaElement>(null);
  const commit = () => {
    if (draft !== null) {
      const memo = draft.split("\n").filter((l) => l.trim() !== "");
      const track = me !== null || wh.memoBy !== undefined;
      onEdit({ ...wh, memo, ...(track ? { memoBy: memoAuthors(wh.memo, wh.memoBy, memo, me) } : {}) });
    }
    setDraft(null);
  };
  const authors = wh.memoBy !== undefined && wh.memoBy.some((x) => x !== null) ? wh.memo.map((line, i) => ({ line, by: wh.memoBy?.[i] ?? null })) : null;
  useEffect(() => {
    area.current?.focus({ preventScroll: true });
  }, []);
  return (
    <aside
      class="drawer memo-drawer"
      aria-labelledby="memo-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          commit();
          onClose();
        }
      }}
    >
      <div class="drawer-head">
        <h2 id="memo-title" class="memo-h">
          メモ（顧客には見せない）
        </h2>
        <button
          type="button"
          class="x-btn"
          aria-label="メモを閉じる（Esc）"
          title="閉じる（Esc）"
          onClick={() => {
            commit();
            onClose();
          }}
        >
          ×
        </button>
      </div>
      <div class="drawer-body">
        <p class="drawer-note">世帯ごとのメモです。画面には出さず、ここを開いたときだけ見えます。1行に1つ書きます。</p>
        <textarea ref={area} rows={14} value={draft ?? text} aria-label="FP用のメモ" onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)} onBlur={commit} data-memo />
        {authors !== null ? (
          <ul class="memo-authors" aria-label="メモの行ごとの書いた人" data-memo-authors>
            {authors.map((a, i) => (
              <li key={i}>
                <span class="memo-line">{a.line}</span>
                <span class="memo-by">{a.by === null ? "—" : (names[a.by] ?? "メンバー")}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </aside>
  );
}

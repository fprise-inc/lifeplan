// FP用のメモの引き出し（作業の層の部品）: 画面には出さず、上部の「メモ」ボタンで開いたときだけ右の端に出す。
// 提示層の部品には渡さない（0016 の2）。開いている間も、グラフや表の上には重ねない（広い画面では本文を左に寄せる）
import { useEffect, useRef, useState } from "preact/hooks";
import type { WorkingHousehold } from "./input/household.ts";

export function MemoDrawer({ wh, onEdit, onClose }: { wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = wh.memo.join("\n");
  const area = useRef<HTMLTextAreaElement>(null);
  const commit = () => {
    if (draft !== null) onEdit({ ...wh, memo: draft.split("\n").filter((l) => l.trim() !== "") });
    setDraft(null);
  };
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
      </div>
    </aside>
  );
}

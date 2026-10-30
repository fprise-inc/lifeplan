// 説明の欄（作業の層）: 値ではなく扱いの説明の文（例: 退職金の「万一亡くなったときの扱い」）を、まとまりの幅いっぱいに出す。
// 見出しの左に ⓘ を置き、見出しを押すと折りたたむ・開く（その場で開閉する折りたたみなので、小窓の印は付けない）。
// 本文がすでに説明なので「?」は付けない。どこで額を入れられるかは本文の中に書く。
// 折りたたんだ状態は、アプリを開いている間だけ覚える（同じ種類の説明は、人や世帯が違っても同じ状態。既定は開いた状態）。
// 画面の側には保存しない（0016 の「画面に保存しない」: localStorage などは使えない）
import { useEffect, useState } from "preact/hooks";

/** 折りたたんである説明の欄のキー（アプリを開いている間だけ） */
const folded = new Set<string>();
const listeners = new Set<() => void>();

/** 折りたたんであるか */
export const isNoteFolded = (fold: string): boolean => folded.has(fold);

/** 折りたたむ・開く（同じキーの説明の欄をすべて描き直す） */
export function setNoteFolded(fold: string, on: boolean): void {
  if (on === folded.has(fold)) return;
  if (on) folded.add(fold);
  else folded.delete(fold);
  for (const f of listeners) f();
}

/** ⓘ の印（丸に i。文字の色で描く。読み上げない） */
function InfoMark() {
  return (
    <svg class="info-i" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v6" />
      <circle cx="12" cy="7.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function InfoNote({ title, text, fold, groupKey }: { title: string; text: string; fold: string; groupKey: string }) {
  const [shut, setShut] = useState(() => isNoteFolded(fold));
  useEffect(() => {
    const f = () => setShut(isNoteFolded(fold));
    listeners.add(f);
    f();
    return () => void listeners.delete(f);
  }, [fold]);
  // その場で開閉する折りたたみ（details）。開いているかは読み上げにもそのまま伝わる
  return (
    <details
      class="in-group info-note"
      open={!shut}
      data-info-note={groupKey}
      onToggle={(e) => {
        const open = (e.currentTarget as HTMLDetailsElement).open;
        if (open === shut) setNoteFolded(fold, !open);
      }}
    >
      {/* 押したときに欄からフォーカスを外さない（外すと、欄の値が入れ直されて「保存していない変更」になるため） */}
      <summary class="info-note-h" onMouseDown={(e) => e.preventDefault()}>
        <InfoMark />
        <span class="info-note-title">{title}</span>
        <span class="info-note-fold" aria-hidden="true">
          {shut ? "▸ 開く" : "▾ たたむ"}
        </span>
      </summary>
      <p class="info-note-body">{text}</p>
    </details>
  );
}

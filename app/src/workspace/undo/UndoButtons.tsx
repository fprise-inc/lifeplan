// 上部の ↶ ↷ のボタン（元に戻す・やり直す）。キー操作・メニューと同じ入口（run）を通る。
// 押してもフォーカスを動かさない（文字の欄にいるときは、キー操作と同じく欄の中の文字から戻す）
import { useEffect, useState } from "preact/hooks";
import { undoController, type UndoController } from "./controller.ts";

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function UndoButtons({ c = undoController }: { c?: UndoController }) {
  const [, setTick] = useState(0);
  useEffect(() => c.subscribe(() => setTick((t) => t + 1)), [c]);
  const top = c.top;
  const canUndo = top?.canUndo() ?? false;
  const canRedo = top?.canRedo() ?? false;
  const nu = top?.nextUndo?.() ?? null;
  const nr = top?.nextRedo?.() ?? null;
  const undoKey = mac ? "⌘Z" : "Ctrl+Z";
  const redoKey = mac ? "⌘⇧Z" : "Ctrl+Y";
  return (
    <span class="undo-btns" role="group" aria-label="元に戻す・やり直す">
      <button
        type="button"
        class="undo-btn"
        disabled={!canUndo}
        title={`元に戻す（${undoKey}）${nu !== null ? `: ${nu}` : ""}`}
        aria-label="元に戻す"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => c.run("undo")}
        data-undo
      >
        ↶
      </button>
      <button
        type="button"
        class="undo-btn"
        disabled={!canRedo}
        title={`やり直す（${redoKey}）${nr !== null ? `: ${nr}` : ""}`}
        aria-label="やり直す"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => c.run("redo")}
        data-redo
      >
        ↷
      </button>
    </span>
  );
}

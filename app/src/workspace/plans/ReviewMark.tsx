// プランの一覧の名前の右の「! 要確認 n」（0250）。押せるボタンにして、押すと（Enter・Space でも）小さな吹き出しに、
// 確かめることを1行ずつ出す。文は結果のタブの対策の「変えたこと」と同じ（plans.ts の changesOf の reviewNote）。
// - カーソルを合わせたときは短い説明（title「確かめること n件。押すと一覧」）だけ
// - 閉じ方: もう一度押す・Esc（重ねた順のいちばん上。0239 の useEscClose）・外を押す・吹き出しの「閉じる」
// - 吹き出しは画面に固定して置く（表の枠の横送りに切られない・表の行の高さを変えない）。置き場所は説明の「?」と同じ決め方（helpPlace）
// - 吹き出しの下の「対策で確かめる」で、このプランを選び、結果のタブの対策の「変えたこと」（要確認が上に並び、「確認した（このまま）」
//   「この差分を外す」で直せる）を開く。入力の画面の違いの一覧は、結果のタブで動かした値の「現状が変わった」を要確認に出さないので、そちらへは送らない
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { closeLabel, useEscClose } from "../../presentation/CloseX.tsx";
import { helpPlace, type HelpSide } from "../../presentation/Help.tsx";
import type { ChangeRow } from "./plans.ts";

/** カーソルを合わせたときの短い説明 */
export const reviewMarkTitle = (n: number): string => `確かめること ${n}件。押すと一覧`;

export interface ReviewMarkProps {
  /** 要確認の行（changesOf で state が ok でない物） */
  rows: readonly ChangeRow[];
  /** プランの名前（吹き出しの読み上げの名前に使う） */
  planName: string;
  /** 対策の「変えたこと」で確かめる（無ければボタンを出さない） */
  onShow?: () => void;
  /** 開いた状態で描く（画面の確かめ用） */
  initialOpen?: boolean;
}

export function ReviewMark({ rows, planName, onShow, initialOpen = false }: ReviewMarkProps) {
  const [open, setOpen] = useState(initialOpen);
  const [pos, setPos] = useState<{ top: number; left: number; side: HelpSide } | null>(null);
  const popId = `rv-${useId()}`;
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  /** 閉じる。吹き出しの中にフォーカスがあったら印に戻す（Esc・「閉じる」で閉じたとき、フォーカスを失わない） */
  const close = () => {
    if (pop.current !== null && pop.current.contains(document.activeElement)) btn.current?.focus();
    setOpen(false);
  };
  useEscClose(close, open);
  // 開いている間: 外を押すと閉じる・動いたら置き直す
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && (wrap.current?.contains(e.target) ?? false)) return;
      setOpen(false);
    };
    const re = () => {
      if (btn.current !== null && pop.current !== null) setPos(place(btn.current, pop.current));
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", re, true);
    window.addEventListener("resize", re);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", re, true);
      window.removeEventListener("resize", re);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (open && btn.current !== null && pop.current !== null) setPos(place(btn.current, pop.current));
    if (!open) setPos(null);
  }, [open]);
  const n = rows.length;
  return (
    <span class="rv-mark" ref={wrap}>
      <button type="button" ref={btn} class="pb-review sm" aria-expanded={open} aria-controls={popId} title={reviewMarkTitle(n)} onClick={() => setOpen(!open)} data-plan-review-mark>
        ! 要確認 {n}
      </button>
      {open ? (
        <div
          ref={pop}
          id={popId}
          role="dialog"
          aria-label={`${planName}の要確認`}
          class="help-pop rv-pop"
          style={pos !== null ? { top: `${pos.top}px`, left: `${pos.left}px` } : { visibility: "hidden" }}
          data-side={pos?.side}
          data-plan-review-pop
        >
          <div class="rv-head">
            <b>確かめること（{n}件）</b>
            <button type="button" class="link-btn" aria-label={closeLabel("要確認の一覧")} title="閉じる（Esc）" onClick={close} data-plan-review-close>
              閉じる
            </button>
          </div>
          <ul class="rv-list">
            {rows.map((c) => (
              <li key={c.key} data-plan-review-row>
                <b>{c.label}</b>
                {c.reviewNote !== null ? <span class="rv-note">{c.reviewNote}</span> : null}
              </li>
            ))}
          </ul>
          {onShow !== undefined ? (
            <div class="rv-foot">
              <span>対策の「変えたこと」で、そのままにするか外すかを選べます</span>
              <button
                type="button"
                class="btn small"
                onClick={() => {
                  setOpen(false);
                  onShow();
                }}
                data-plan-review-open
              >
                対策で確かめる
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

/** 吹き出しの置き場所（説明の「?」と同じ。transform のかかった枠の中では、今の位置との差から基準を求めて引く） */
function place(b: HTMLElement, p: HTMLElement): { top: number; left: number; side: HelpSide } {
  const r = b.getBoundingClientRect();
  const now = p.getBoundingClientRect();
  const ox = now.left - (Number.parseFloat(p.style.left) || 0);
  const oy = now.top - (Number.parseFloat(p.style.top) || 0);
  return helpPlace({ left: r.left, top: r.top, bottom: r.bottom }, { w: p.offsetWidth, h: p.offsetHeight }, { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }, { x: ox, y: oy });
}

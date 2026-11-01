// 結果の見方（0044 の追記・0036 の6）: グラフの上に「すべて入れる｜確実な分だけ」の切り替えと「外している物（○件）▾」。
// 一覧を開くと、入れ外しできる物（見込みが「当てにしない」の入るお金・優先度が「できれば」の出るお金と子への援助・夢プランの夢〔札「夢」。0103〕・
// 基本の計算に入れない受け取る相続・贈与と受け継ぐ借金）の名前・額・時期が並び、1件ずつ入れたり外したりできる。どれも見方の切り替えで、保存しない（プランの差分にしない）。
// 入れ外しできる物の無い世帯では出さない。説明は「?」の中（0077）
import { useEffect, useRef, useState } from "preact/hooks";
import { isAllRows, type RowsView } from "../engine/moneyRows.ts";
import { Help } from "../presentation/Help.tsx";
import type { ViewRow } from "./rowsView.ts";

export interface RowsViewBarProps {
  rows: readonly ViewRow[];
  view: RowsView;
  /** 「すべて入れる」（false）・「確実な分だけ」（true）を選んだ */
  onMode: (certainOnly: boolean) => void;
  /** 1件を入れる（true）・外す（false） */
  onPick: (row: ViewRow, include: boolean) => void;
}

export function RowsViewBar({ rows, view, onMode, onPick }: RowsViewBarProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (wrap.current !== null && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  if (rows.length === 0 && isAllRows(view)) return null;
  const off = rows.filter((r) => r.excluded).length;
  return (
    <div
      class={`rows-view${isAllRows(view) ? "" : " on"}`}
      ref={wrap}
      data-rows-view
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <span class="seg-g" role="group" aria-label="計算に入れる物">
        <button type="button" aria-pressed={!view.certainOnly} onClick={() => onMode(false)} data-view-mode="all">
          すべて入れる
        </button>
        <button type="button" aria-pressed={view.certainOnly} onClick={() => onMode(true)} data-view-mode="certain">
          確実な分だけ
        </button>
      </span>
      {/* 説明の「?」は切り替えのすぐ右（説明する物の右。0077 の 2026-10-29 の追記） */}
      <Help label="計算に入れる物" id="rows-view">
        「確実な分だけ」は、見込みが「当てにしない」の入るお金と、優先度が「できれば」の出るお金・子への援助と、夢プランの夢を外して、並べた全部のプランを計算し直します。
        「外している物」を開くと、1件ずつ入れたり外したりできます（チェックの入っている物を計算に入れます）。
        見込みが「当てにしない」の受け取る相続・贈与と相続で受け継ぐ借金、「計算に入れない」にした夢は、ふだんも外れています。ここで入れて見られます。
        どれも見方の切り替えで、保存はしません。プランに残すときは、入力の画面で見込み・優先度・夢の「計算に入れるか」（受け取る相続・贈与なら「基本の計算に入れる」）を直してください。
      </Help>
      <span class="rows-view-pop">
        <button type="button" class="link-btn" aria-expanded={open} onClick={() => setOpen(!open)} data-view-list>
          外している物（{off}件）▾
        </button>
        {open ? (
          <div class="rows-view-list" role="group" aria-label="入れ外しできる物" data-view-items>
            {rows.length === 0 ? <p class="rows-view-empty">入れ外しできる物はありません</p> : null}
            {rows.map((r) => (
              <label class={`rows-view-row${r.excluded ? " off" : ""}`} key={r.key} data-view-item={r.key} data-excluded={r.excluded ? "1" : "0"}>
                <input type="checkbox" checked={!r.excluded} onChange={(e) => onPick(r, (e.currentTarget as HTMLInputElement).checked)} aria-label={`${r.name}を計算に入れる`} />
                <span class="rv-dir">{r.side === "in" ? "入" : "出"}</span>
                <span class="rv-name">{r.name}</span>
                <span class="rv-amt num">{r.amount}</span>
                <span class="rv-when">{r.when}</span>
                <span class="rv-tag">{r.tag}</span>
              </label>
            ))}
          </div>
        ) : null}
      </span>
    </div>
  );
}

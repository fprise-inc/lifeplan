// 計算の知らせ（結果のタブ。0064）: 計算エンジンの知らせを、種類ごとにまとめて出す。閉じているときは1行（種類ごとの数）。
// 入力で直せる知らせは「入力で開く」でそのカードを開く（開くだけ。値は変えない）
import { useState } from "preact/hooks";
import type { StageId } from "./input/form.ts";
import { NOTICE_KINDS, noticeCounts, noticeMeta, type NoticeRow } from "./engineNotices.ts";

export function CalcNotices({ rows, onOpenCard, initialOpen = false }: { rows: readonly NoticeRow[]; onOpenCard?: (card: StageId) => void; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  if (rows.length === 0) return null;
  const counts = noticeCounts(rows);
  const urgent = counts.input + counts.missing;
  return (
    <div class={`calc-notices${urgent > 0 ? " urgent" : ""}`} data-calc-notices={rows.length}>
      <div class="cn-bar">
        <span class="fee-tag">計算の知らせ</span>
        <span class="cn-counts">
          {NOTICE_KINDS.filter((k) => counts[k.id] > 0)
            .map((k) => `${k.short} ${counts[k.id]}`)
            .join("・")}
        </span>
        <button type="button" class="link-btn" aria-expanded={open} onClick={() => setOpen(!open)} data-calc-notices-open>
          {open ? "閉じる" : "見る"}
        </button>
      </div>
      {open ? (
        <div class="cn-body">
          {NOTICE_KINDS.map((k) => {
            const list = rows.filter((r) => r.kind === k.id);
            if (list.length === 0) return null;
            return (
              <div class={`cn-kind cn-${k.id}`} key={k.id} data-cn-kind={k.id}>
                <h3>
                  {k.label}（{list.length}）
                </h3>
                <ul>
                  {list.map((r) => {
                    const meta = noticeMeta(r);
                    return (
                      <li key={r.key} data-cn-row={r.key}>
                        <span class="cn-text">{r.text}</span>
                        {r.card !== null && onOpenCard !== undefined ? (
                          <button type="button" class="link-btn" onClick={() => onOpenCard(r.card as StageId)} data-cn-open={r.card}>
                            入力で開く
                          </button>
                        ) : null}
                        {meta.length > 0 ? <span class="cn-meta">{meta.join("／")}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
